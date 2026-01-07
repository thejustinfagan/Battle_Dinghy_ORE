import { TwitterApi } from "twitter-api-v2";
import type { Game, Player } from "@shared/schema";
import { dbStorage } from "./db-storage";

const TWITTER_API_KEY = process.env.TWITTER_API_KEY || "";
const TWITTER_API_SECRET = process.env.TWITTER_API_SECRET || "";

// OAuth 2.0 credentials
const TWITTER_CLIENT_ID = process.env.TWITTER_CLIENT_ID || "";
const TWITTER_CLIENT_SECRET = process.env.TWITTER_CLIENT_SECRET || "";

// Twitter client (will be initialized from database tokens)
let twitterClient: TwitterApi | null = null;

/**
 * Initialize Twitter OAuth tokens from environment variables into database
 * This should be called once on server startup to migrate env var tokens to database
 */
export async function initializeTwitterTokensFromEnv(): Promise<void> {
  // Check if tokens already exist in database
  const existingToken = await dbStorage.getOauthToken("twitter");
  
  if (existingToken) {
    console.log("✅ Twitter tokens already in database");
    return;
  }

  // Try to get tokens from environment variables
  const accessToken = process.env.TWITTER_ACCESS_TOKEN || "";
  const refreshToken = process.env.TWITTER_REFRESH_TOKEN || "";

  if (!accessToken || !refreshToken) {
    console.log("⚠️  No Twitter tokens in environment variables or database. Please authorize via admin dashboard.");
    return;
  }

  // Migrate tokens to database
  console.log("🔄 Migrating Twitter tokens from environment variables to database...");
  
  try {
    await dbStorage.upsertOauthToken({
      provider: "twitter",
      accessToken,
      refreshToken,
      expiresAt: new Date(Date.now() + 2 * 60 * 60 * 1000), // Assume 2 hours from now
    });
    
    console.log("✅ Twitter tokens migrated to database successfully");
  } catch (error) {
    console.error("❌ Failed to migrate Twitter tokens to database:", error);
  }
}

export async function checkTwitterCredentials(): Promise<{
  configured: boolean;
  hasApiKey: boolean;
  hasApiSecret: boolean;
  hasAccessToken: boolean;
  hasAccessSecret: boolean;
}> {
  const token = await dbStorage.getOauthToken("twitter");
  
  return {
    configured: !!(
      TWITTER_CLIENT_ID &&
      TWITTER_CLIENT_SECRET &&
      token?.accessToken
    ),
    hasApiKey: !!TWITTER_API_KEY,
    hasApiSecret: !!TWITTER_API_SECRET,
    hasAccessToken: !!token?.accessToken,
    hasAccessSecret: !!token?.refreshToken,
  };
}

export async function refreshTwitterToken(): Promise<void> {
  const currentToken = await dbStorage.getOauthToken("twitter");
  
  if (!TWITTER_CLIENT_ID || !TWITTER_CLIENT_SECRET || !currentToken?.refreshToken) {
    throw new Error("Cannot refresh token: Missing OAuth 2.0 credentials or refresh token");
  }

  console.log("🔄 Refreshing Twitter OAuth 2.0 token...");

  const client = new TwitterApi({
    clientId: TWITTER_CLIENT_ID,
    clientSecret: TWITTER_CLIENT_SECRET,
  });

  const { accessToken, refreshToken, expiresIn } = await client.refreshOAuth2Token(currentToken.refreshToken);

  // Calculate expiration time (OAuth 2.0 tokens typically expire in 2 hours)
  const expiresAt = new Date(Date.now() + (expiresIn || 7200) * 1000);

  // Save updated tokens to database (critical: refresh tokens rotate!)
  await dbStorage.upsertOauthToken({
    provider: "twitter",
    accessToken,
    refreshToken: refreshToken || currentToken.refreshToken,
    expiresAt,
  });

  // Reset client to force re-initialization with new token
  twitterClient = null;

  console.log("✅ Twitter token refreshed and saved to database. Expires in:", expiresIn || 7200, "seconds");
}

export async function initTwitterClient(): Promise<TwitterApi> {
  const token = await dbStorage.getOauthToken("twitter");
  
  if (!token?.accessToken) {
    throw new Error("No Twitter access token available. Please authorize @battle_dinghy via the admin dashboard.");
  }

  // Check if token is expired or about to expire (within 5 minutes)
  const tokenWillExpireSoon = token.expiresAt && Date.now() >= token.expiresAt.getTime() - 5 * 60 * 1000;

  if (tokenWillExpireSoon && token.refreshToken) {
    try {
      await refreshTwitterToken();
      // Re-fetch token after refresh
      const refreshedToken = await dbStorage.getOauthToken("twitter");
      if (!refreshedToken) {
        throw new Error("Token refresh succeeded but unable to retrieve refreshed token");
      }
      // Reset client to use new token
      twitterClient = new TwitterApi(refreshedToken.accessToken);
    } catch (error) {
      console.error("Failed to refresh Twitter token:", error);
      throw new Error("Twitter token expired and refresh failed. Please re-authorize the app.");
    }
  }

  if (!twitterClient) {
    // Use OAuth 2.0 User Context (allows posting as @battle_dinghy)
    twitterClient = new TwitterApi(token.accessToken);
  }

  return twitterClient;
}

// Helper function to execute Twitter API calls with automatic token refresh on auth failures
export async function executeWithRefresh<T>(
  operation: (client: TwitterApi) => Promise<T>
): Promise<T> {
  try {
    const client = await initTwitterClient();
    return await operation(client);
  } catch (error: any) {
    // Check if this is an authentication error (401/403)
    const isAuthError = error?.code === 401 || error?.code === 403 || 
                       error?.status === 401 || error?.status === 403;
    
    const token = await dbStorage.getOauthToken("twitter");
    
    if (isAuthError && token?.refreshToken) {
      console.log("⚠️  Authentication failed, attempting token refresh...");
      
      try {
        await refreshTwitterToken();
        const client = await initTwitterClient();
        return await operation(client);
      } catch (refreshError) {
        console.error("Failed to refresh and retry:", refreshError);
        throw new Error("Twitter authentication failed. Please re-authorize the app in the admin dashboard.");
      }
    }
    
    throw error;
  }
}

export async function postGameAnnouncement(
  game: Game,
  joinUrl: string
): Promise<{ tweetId: string; threadId: string }> {
  return await executeWithRefresh(async (client) => {
    const tweetText = `🚢 BATTLE DINGHY GAME #${game.gameNumber} ⚓

💰 Prize Pool: ${(game.prizePoolSol / 1_000_000_000).toFixed(2)} SOL
👥 ${game.currentPlayers}/${game.maxPlayers} Players
⏱️ Join now with your Twitter handle!

${joinUrl}

First shot incoming... 🎯`;

    const tweet = await client.v2.tweet(tweetText);
    
    return {
      tweetId: tweet.data.id,
      threadId: tweet.data.id,
    };
  });
}

export async function postShotAnnouncement(
  game: Game,
  shotNumber: number,
  coordinate: string,
  hitPlayers: Array<{ player: Player; result: string; shipHit: string | null }>,
  alivePlayers: number,
  imageBuffer?: Buffer
): Promise<string> {
  return await executeWithRefresh(async (client) => {
    let mediaId: string | undefined;
    if (imageBuffer) {
      const upload = await client.v1.uploadMedia(imageBuffer, { mimeType: "image/png" });
      mediaId = upload;
    }

    const hits = hitPlayers.filter(h => h.result !== "miss");
    const missCount = hitPlayers.length - hits.length;

    let tweetText = `⚡ SHOT #${shotNumber}: ${coordinate} ⚡\n\n`;

    if (hits.length > 0) {
      tweetText += `🎯 HITS:\n`;
      for (const { player, result, shipHit } of hits) {
        const shipName = shipHit === "big_dinghy" ? "Big Dinghy" : shipHit === "dinghy" ? "Dinghy" : "Small Dinghy";
        
        if (result === "eliminated") {
          tweetText += `@${player.twitterHandle} - ${shipName} SUNK! ELIMINATED! 💀\n`;
        } else if (result === "sunk") {
          tweetText += `@${player.twitterHandle} - ${shipName} SUNK! ⚰️\n`;
        } else {
          tweetText += `@${player.twitterHandle} - ${shipName} damaged!\n`;
        }
      }
      tweetText += `\n`;
    }

    if (missCount > 0) {
      tweetText += `💨 MISSES: ${missCount} players\n\n`;
    }

    tweetText += `👥 ${alivePlayers} players remaining`;

    const tweetOptions: any = {
      text: tweetText,
      reply: {
        in_reply_to_tweet_id: game.threadId!,
      },
    };

    if (mediaId) {
      tweetOptions.media = { media_ids: [mediaId] };
    }

    const tweet = await client.v2.tweet(tweetOptions);
    
    return tweet.data.id;
  });
}

export async function postWinnerAnnouncement(
  game: Game,
  winner: Player,
  finalStats: {
    shotsTotal: number;
    hullRemaining: number;
  }
): Promise<string> {
  return await executeWithRefresh(async (client) => {
    const prizeSol = (game.prizePoolSol / 1_000_000_000).toFixed(2);

    const tweetText = `🏆 GAME #${game.gameNumber} COMPLETE! 🏆

WINNER: @${winner.twitterHandle}
Prize: ${prizeSol} SOL 💎

📊 Final Stats:
- Survived: ${finalStats.shotsTotal}/25 shots
- Hull: ${finalStats.hullRemaining}/6 HP remaining

Next game starting soon ⏰`;

    const tweet = await client.v2.tweet({
      text: tweetText,
      reply: {
        in_reply_to_tweet_id: game.threadId!,
      },
    });
    
    return tweet.data.id;
  });
}

export async function sendPlayerBoard(
  playerHandle: string,
  gameNumber: number,
  threadId: string,
  imageBuffer: Buffer
): Promise<string> {
  return await executeWithRefresh(async (client) => {
    const mediaId = await client.v1.uploadMedia(imageBuffer, { mimeType: "image/png" });

    const message = `@${playerHandle} 🚢 Your Battle Dinghy board for Game #${gameNumber}! 

Your ships:
🔵 Big Dinghy (3 HP)
🔵 Dinghy (2 HP)  
🔵 Small Dinghy (1 HP)

Good luck! ⚓`;

    const tweet = await client.v2.tweet(message, {
      reply: { in_reply_to_tweet_id: threadId },
      media: { media_ids: [mediaId] }
    });

    return tweet.data.id;
  });
}

// OAuth 2.0 PKCE flow for authorizing @battle_dinghy account
// Map to store code verifiers keyed by state (prevents concurrent auth collision)
const oauth2CodeVerifiers = new Map<string, string>();
// Map to store callback URLs keyed by state
const oauth2CallbackUrls = new Map<string, string>();

export async function initiateOAuthFlow(callbackUrl: string): Promise<string> {
  if (!TWITTER_CLIENT_ID || !TWITTER_CLIENT_SECRET) {
    throw new Error("Twitter OAuth 2.0 Client ID and Secret not configured");
  }

  const client = new TwitterApi({
    clientId: TWITTER_CLIENT_ID,
    clientSecret: TWITTER_CLIENT_SECRET,
  });

  // Generate OAuth 2.0 authorization link with PKCE
  const { url, codeVerifier, state } = client.generateOAuth2AuthLink(
    callbackUrl,
    { 
      scope: ['tweet.read', 'tweet.write', 'users.read', 'offline.access']
    }
  );
  
  // Store the code verifier and callback URL keyed by state to support concurrent flows
  oauth2CodeVerifiers.set(state, codeVerifier);
  oauth2CallbackUrls.set(state, callbackUrl);
  
  return url;
}

export async function handleOAuthCallback(
  code: string,
  state: string
): Promise<{ accessToken: string; refreshToken: string | undefined; screenName: string }> {
  // Retrieve the stored code verifier and callback URL for this specific state
  const codeVerifier = oauth2CodeVerifiers.get(state);
  const callbackUrl = oauth2CallbackUrls.get(state);
  
  if (!codeVerifier || !callbackUrl) {
    throw new Error("OAuth session not found or expired. Please restart the authorization flow.");
  }

  // Clear the stored data immediately to prevent reuse
  oauth2CodeVerifiers.delete(state);
  oauth2CallbackUrls.delete(state);

  const client = new TwitterApi({
    clientId: TWITTER_CLIENT_ID,
    clientSecret: TWITTER_CLIENT_SECRET,
  });

  // Use the exact callback URL that was used to initiate the OAuth flow
  const { client: loggedClient, accessToken, refreshToken } = 
    await client.loginWithOAuth2({
      code,
      codeVerifier,
      redirectUri: callbackUrl,
    });

  // Get the authenticated user's info
  const { data: user } = await loggedClient.v2.me();

  return { 
    accessToken, 
    refreshToken,
    screenName: user.username 
  };
}
