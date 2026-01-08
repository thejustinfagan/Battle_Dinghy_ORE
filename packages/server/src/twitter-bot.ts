// Battle Dinghy - Twitter Bot
//
// Posts game announcements, round results, and winner announcements to Twitter.

import { TwitterApi, TwitterApiReadWrite, SendTweetV2Params } from 'twitter-api-v2';
import { CellIndex, cellToPosition } from '@battle-dinghy/core';
import {
  renderCard,
  renderRoundResult,
  renderWinner,
} from './card-renderer.js';
import type { GameManager } from './game-manager.js';

// =============================================================================
// Types
// =============================================================================

export interface TwitterBotConfig {
  appKey: string;
  appSecret: string;
  accessToken: string;
  accessSecret: string;
  baseUrl: string; // Base URL for Blinks, e.g., https://battledinghy.com
}

export interface GameAnnouncement {
  gameId: string;
  buyInSol: number;
  maxPlayers: number;
  fillDeadlineMinutes?: number; // Minutes until game auto-starts
  startTime?: Date; // When the game will auto-start
  customMessage?: string; // Optional custom message to prepend
}

// =============================================================================
// Twitter Bot
// =============================================================================

export class TwitterBot {
  private client: TwitterApiReadWrite;
  private baseUrl: string;
  private gameManager: GameManager;

  constructor(config: TwitterBotConfig, gameManager: GameManager) {
    const userClient = new TwitterApi({
      appKey: config.appKey,
      appSecret: config.appSecret,
      accessToken: config.accessToken,
      accessSecret: config.accessSecret,
    });

    this.client = userClient.readWrite;
    this.baseUrl = config.baseUrl;
    this.gameManager = gameManager;

    // Set up event listeners
    this.setupEventListeners();
  }

  // ===========================================================================
  // Event Listeners
  // ===========================================================================

  private setupEventListeners(): void {
    this.gameManager.on('game_started', async (event) => {
      await this.announceGameStart(event.gameId, event.players);
    });

    this.gameManager.on('round_complete', async (event) => {
      await this.postRoundResult(event.gameId, event.summary);
    });

    this.gameManager.on('player_eliminated', async (event) => {
      await this.announceElimination(event.gameId, event.player, event.round);
    });

    this.gameManager.on('game_complete', async (event) => {
      await this.announceWinner(event.gameId, event.winner, event.totalRounds);
    });
  }

  // ===========================================================================
  // Game Announcement
  // ===========================================================================

  async announceNewGame(announcement: GameAnnouncement): Promise<string | null> {
    const { gameId, buyInSol, maxPlayers, customMessage } = announcement;
    const blinkUrl = `${this.baseUrl}/blinks/join/${gameId}`;

    // Build tweet with optional custom message
    let text = '';

    if (customMessage && customMessage.trim()) {
      text += `${customMessage.trim()}\n\n`;
    }

    text += `⚓ BATTLE DINGHY ⚓

💰 Buy-in: ${buyInSol} SOL
👥 Max Players: ${maxPlayers}
🏆 Winner takes all!

Join the battle 👇

${blinkUrl}`;

    try {
      const tweet = await this.client.v2.tweet(text);
      console.log(`Posted new game announcement: ${tweet.data.id}`);
      return tweet.data.id;
    } catch (error) {
      console.error('Failed to post game announcement:', error);
      return null;
    }
  }

  /**
   * Generate the tweet text for preview (without posting).
   */
  generateTweetPreview(announcement: GameAnnouncement): { text: string; blinkUrl: string } {
    const { gameId, buyInSol, maxPlayers, fillDeadlineMinutes, customMessage } = announcement;
    const blinkUrl = `${this.baseUrl}/blinks/join/${gameId}`;

    let text = '';

    if (customMessage && customMessage.trim()) {
      text += `${customMessage.trim()}\n\n`;
    }

    // Format deadline display
    let deadlineText = '';
    if (fillDeadlineMinutes) {
      if (fillDeadlineMinutes >= 60) {
        const hours = Math.floor(fillDeadlineMinutes / 60);
        deadlineText = `${hours} hour${hours > 1 ? 's' : ''}`;
      } else {
        deadlineText = `${fillDeadlineMinutes} min`;
      }
    }

    text += `⚓ BATTLE DINGHY ⚓

💰 Buy-in: ${buyInSol} SOL
👥 Max Players: ${maxPlayers}${deadlineText ? `\n⏰ Starts in: ${deadlineText}` : ''}
🏆 Winner takes all!

Join the battle 👇

${blinkUrl}`;

    return { text, blinkUrl };
  }

  // ===========================================================================
  // Game Start
  // ===========================================================================

  async announceGameStart(gameId: string, players: string[]): Promise<string | null> {
    const text = `🚀 BATTLE DINGHY STARTED! 🚀

Game ${gameId} is now LIVE with ${players.length} players!

Ships are deployed, cannons are loaded.
Let the battle begin! ⚓💥

#BattleDinghy #Solana`;

    try {
      const tweet = await this.client.v2.tweet(text);
      console.log(`Posted game start: ${tweet.data.id}`);
      return tweet.data.id;
    } catch (error) {
      console.error('Failed to post game start:', error);
      return null;
    }
  }

  // ===========================================================================
  // Round Results
  // ===========================================================================

  async postRoundResult(
    gameId: string,
    summary: {
      roundNumber: number;
      primaryShot: CellIndex;
      hits: string[];
      eliminations: string[];
    }
  ): Promise<string | null> {
    const status = this.gameManager.getGameStatus(gameId);
    if (!status) return null;

    const remainingPlayers = status.players.filter((p) => {
      const card = this.gameManager.getPlayerCard(gameId, p);
      return card && !card.isEliminated;
    }).length;

    // Generate round result image
    const imageBuffer = renderRoundResult({
      gameId,
      roundNumber: summary.roundNumber,
      shotCell: summary.primaryShot,
      hits: summary.hits,
      eliminations: summary.eliminations,
      remainingPlayers,
    });

    const pos = cellToPosition(summary.primaryShot);
    const cellLabel = `${String.fromCharCode(65 + pos.col)}${pos.row + 1}`;

    let text = `⚓ Round ${summary.roundNumber} - ${gameId}

🎯 Shot: ${cellLabel}`;

    if (summary.hits.length > 0) {
      text += `\n💥 ${summary.hits.length} HIT${summary.hits.length > 1 ? 'S' : ''}!`;
    }

    if (summary.eliminations.length > 0) {
      text += `\n☠️ ${summary.eliminations.length} ELIMINATED!`;
    }

    text += `\n\n👥 ${remainingPlayers} players remaining`;

    try {
      // Upload image
      const mediaId = await this.client.v1.uploadMedia(imageBuffer, {
        mimeType: 'image/png',
      });

      // Post tweet with image
      const tweet = await this.client.v2.tweet({
        text,
        media: { media_ids: [mediaId] },
      });

      console.log(`Posted round result: ${tweet.data.id}`);
      return tweet.data.id;
    } catch (error) {
      console.error('Failed to post round result:', error);
      return null;
    }
  }

  // ===========================================================================
  // Elimination
  // ===========================================================================

  async announceElimination(
    gameId: string,
    player: string,
    round: number
  ): Promise<string | null> {
    // Get player's card to show their final state
    const card = this.gameManager.getPlayerCard(gameId, player);
    if (!card) return null;

    const status = this.gameManager.getGameStatus(gameId);
    if (!status) return null;

    const playerIndex = status.players.indexOf(player);

    // Generate card image showing the eliminated state
    const imageBuffer = renderCard({
      playerId: player,
      playerIndex,
      gameId,
      shipCells: new Set(card.allCells as CellIndex[]),
      hitCells: new Set(card.hitCells as CellIndex[]),
      isEliminated: true,
      currentRound: round,
      showShips: true,
    });

    const shortWallet = `${player.slice(0, 6)}...${player.slice(-4)}`;
    const text = `☠️ PLAYER ELIMINATED ☠️

Player ${playerIndex + 1} (${shortWallet}) has been sunk in Round ${round}!

Their ships have been revealed. 🚢💀

Game: ${gameId}`;

    try {
      const mediaId = await this.client.v1.uploadMedia(imageBuffer, {
        mimeType: 'image/png',
      });

      const tweet = await this.client.v2.tweet({
        text,
        media: { media_ids: [mediaId] },
      });

      console.log(`Posted elimination: ${tweet.data.id}`);
      return tweet.data.id;
    } catch (error) {
      console.error('Failed to post elimination:', error);
      return null;
    }
  }

  // ===========================================================================
  // Winner
  // ===========================================================================

  async announceWinner(
    gameId: string,
    winner: string,
    totalRounds: number
  ): Promise<string | null> {
    const status = this.gameManager.getGameStatus(gameId);
    if (!status) return null;

    const winnerIndex = status.players.indexOf(winner);
    const prizePool = `${(status.players.length * 0.001).toFixed(3)} SOL`;

    // Generate winner image
    const imageBuffer = renderWinner({
      gameId,
      winnerWallet: winner,
      winnerIndex,
      totalRounds,
      prizePool,
    });

    const shortWallet = `${winner.slice(0, 6)}...${winner.slice(-4)}`;

    const text = `🏆 BATTLE DINGHY WINNER! 🏆

🎉 Player ${winnerIndex + 1} (${shortWallet}) wins ${prizePool}!

The battle lasted ${totalRounds} rounds.

Congratulations to the last dinghy standing! ⚓

Game: ${gameId}

#BattleDinghy #Solana #Winner`;

    try {
      const mediaId = await this.client.v1.uploadMedia(imageBuffer, {
        mimeType: 'image/png',
      });

      const tweet = await this.client.v2.tweet({
        text,
        media: { media_ids: [mediaId] },
      });

      console.log(`Posted winner: ${tweet.data.id}`);
      return tweet.data.id;
    } catch (error) {
      console.error('Failed to post winner:', error);
      return null;
    }
  }

  // ===========================================================================
  // Send Player Card (DM or Reply)
  // ===========================================================================

  async sendPlayerCard(
    gameId: string,
    playerWallet: string,
    replyToTweetId?: string
  ): Promise<string | null> {
    const card = this.gameManager.getPlayerCard(gameId, playerWallet);
    if (!card) return null;

    const status = this.gameManager.getGameStatus(gameId);
    if (!status) return null;

    const playerIndex = status.players.indexOf(playerWallet);

    // Generate card image (ships visible to owner)
    const imageBuffer = renderCard({
      playerId: playerWallet,
      playerIndex,
      gameId,
      shipCells: new Set(card.allCells as CellIndex[]),
      hitCells: new Set(card.hitCells as CellIndex[]),
      isEliminated: card.isEliminated,
      currentRound: status.currentRound,
      showShips: true,
    });

    const shortWallet = `${playerWallet.slice(0, 6)}...${playerWallet.slice(-4)}`;
    const text = `🎴 Your Battle Card - Player ${playerIndex + 1}

Wallet: ${shortWallet}
Game: ${gameId}

Keep your ships secret! 🤫⚓`;

    try {
      const mediaId = await this.client.v1.uploadMedia(imageBuffer, {
        mimeType: 'image/png',
      });

      const tweetOptions: SendTweetV2Params = {
        text,
        media: { media_ids: [mediaId] as [string] },
      };

      if (replyToTweetId) {
        tweetOptions.reply = { in_reply_to_tweet_id: replyToTweetId };
      }

      const tweet = await this.client.v2.tweet(tweetOptions);

      console.log(`Posted player card: ${tweet.data.id}`);
      return tweet.data.id;
    } catch (error) {
      console.error('Failed to post player card:', error);
      return null;
    }
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createTwitterBot(
  gameManager: GameManager,
  config?: Partial<TwitterBotConfig>
): TwitterBot | null {
  const appKey = config?.appKey || process.env.TWITTER_APP_KEY;
  const appSecret = config?.appSecret || process.env.TWITTER_APP_SECRET;
  const accessToken = config?.accessToken || process.env.TWITTER_ACCESS_TOKEN;
  const accessSecret = config?.accessSecret || process.env.TWITTER_ACCESS_SECRET;
  const baseUrl = config?.baseUrl || process.env.BASE_URL || 'http://localhost:3001';

  if (!appKey || !appSecret || !accessToken || !accessSecret) {
    console.warn('Twitter credentials not configured, bot disabled');
    return null;
  }

  return new TwitterBot(
    { appKey, appSecret, accessToken, accessSecret, baseUrl },
    gameManager
  );
}
