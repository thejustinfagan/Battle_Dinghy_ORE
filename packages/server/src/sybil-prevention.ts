// Battle Dinghy - Sybil Prevention
//
// Security mitigation D1: Prevents Sybil attacks by validating Twitter accounts
// and tracking wallet relationships.

import { TwitterApi } from 'twitter-api-v2';

// =============================================================================
// Types
// =============================================================================

export interface TwitterAccountRequirements {
  /** Minimum account age in days */
  minAccountAgeDays: number;
  /** Minimum number of followers */
  minFollowers: number;
  /** Minimum number of tweets */
  minTweets: number;
  /** Require a non-default profile picture */
  requireProfilePic: boolean;
  /** Require a bio */
  requireBio: boolean;
  /** Minimum bio length if required */
  minBioLength: number;
}

export interface SybilCheckResult {
  eligible: boolean;
  reason?: SybilRejectionReason;
  riskScore: number; // 0-100, higher = more suspicious
  details: {
    accountAgeDays?: number;
    followers?: number;
    tweets?: number;
    hasProfilePic?: boolean;
    hasBio?: boolean;
    bioLength?: number;
  };
  warnings: string[];
}

export type SybilRejectionReason =
  | 'ACCOUNT_NOT_FOUND'
  | 'ACCOUNT_TOO_NEW'
  | 'NOT_ENOUGH_FOLLOWERS'
  | 'NOT_ENOUGH_TWEETS'
  | 'NO_PROFILE_PIC'
  | 'NO_BIO'
  | 'BIO_TOO_SHORT'
  | 'HIGH_RISK_SCORE'
  | 'RATE_LIMITED'
  | 'API_ERROR';

export interface WalletConnection {
  wallet1: string;
  wallet2: string;
  connectionType: 'DIRECT_TRANSFER' | 'COMMON_SOURCE' | 'COMMON_DESTINATION';
  confidence: number; // 0-1
}

export interface SybilPreventionConfig {
  /** Twitter API client (optional - if not provided, Twitter checks are skipped) */
  twitterClient?: TwitterApi;
  /** Account requirements */
  requirements: TwitterAccountRequirements;
  /** Maximum risk score to allow joining (0-100) */
  maxRiskScore: number;
  /** Enable wallet graph analysis */
  enableWalletAnalysis: boolean;
}

// =============================================================================
// Default Configuration
// =============================================================================

export const DEFAULT_REQUIREMENTS: TwitterAccountRequirements = {
  minAccountAgeDays: 30,
  minFollowers: 5,
  minTweets: 3,
  requireProfilePic: true,
  requireBio: true,
  minBioLength: 10,
};

// =============================================================================
// Sybil Prevention Service
// =============================================================================

export class SybilPreventionService {
  private twitter: TwitterApi | null;
  private requirements: TwitterAccountRequirements;
  private maxRiskScore: number;
  private enableWalletAnalysis: boolean;

  // Cache for wallet connections (in production, use Redis or similar)
  private walletConnections: Map<string, Set<string>> = new Map();
  private checkedAccounts: Map<string, { result: SybilCheckResult; timestamp: number }> = new Map();
  private readonly CACHE_TTL_MS = 3600_000; // 1 hour

  constructor(config: Partial<SybilPreventionConfig> = {}) {
    this.twitter = config.twitterClient ?? null;
    this.requirements = config.requirements ?? DEFAULT_REQUIREMENTS;
    this.maxRiskScore = config.maxRiskScore ?? 60;
    this.enableWalletAnalysis = config.enableWalletAnalysis ?? true;
  }

  // ===========================================================================
  // Twitter Account Verification
  // ===========================================================================

  /**
   * Check if a Twitter account meets the Sybil prevention requirements.
   */
  async checkTwitterAccount(handle: string): Promise<SybilCheckResult> {
    // Check cache first
    const cached = this.checkedAccounts.get(handle.toLowerCase());
    if (cached && Date.now() - cached.timestamp < this.CACHE_TTL_MS) {
      return cached.result;
    }

    // If no Twitter client, skip verification
    if (!this.twitter) {
      const result: SybilCheckResult = {
        eligible: true,
        riskScore: 0,
        details: {},
        warnings: ['Twitter verification disabled - no client configured'],
      };
      return result;
    }

    try {
      const user = await this.twitter.v2.userByUsername(handle, {
        'user.fields': [
          'created_at',
          'public_metrics',
          'profile_image_url',
          'description',
        ],
      });

      if (!user.data) {
        return {
          eligible: false,
          reason: 'ACCOUNT_NOT_FOUND',
          riskScore: 100,
          details: {},
          warnings: [],
        };
      }

      const result = this.evaluateAccount(user.data);

      // Cache the result
      this.checkedAccounts.set(handle.toLowerCase(), {
        result,
        timestamp: Date.now(),
      });

      return result;
    } catch (error: unknown) {
      const errorMessage = error instanceof Error ? error.message : 'Unknown error';

      // Handle rate limiting
      if (errorMessage.includes('429') || errorMessage.includes('rate limit')) {
        return {
          eligible: false,
          reason: 'RATE_LIMITED',
          riskScore: 50,
          details: {},
          warnings: ['Twitter API rate limited - try again later'],
        };
      }

      console.error('Error checking Twitter account:', error);
      return {
        eligible: false,
        reason: 'API_ERROR',
        riskScore: 50,
        details: {},
        warnings: [`API error: ${errorMessage}`],
      };
    }
  }

  /**
   * Evaluate a Twitter user against requirements.
   */
  private evaluateAccount(user: {
    created_at?: string;
    public_metrics?: {
      followers_count?: number;
      tweet_count?: number;
    };
    profile_image_url?: string;
    description?: string;
  }): SybilCheckResult {
    const warnings: string[] = [];
    let riskScore = 0;
    const details: SybilCheckResult['details'] = {};

    // Check account age
    if (user.created_at) {
      const createdAt = new Date(user.created_at);
      const ageDays = (Date.now() - createdAt.getTime()) / (1000 * 60 * 60 * 24);
      details.accountAgeDays = Math.floor(ageDays);

      if (ageDays < this.requirements.minAccountAgeDays) {
        return {
          eligible: false,
          reason: 'ACCOUNT_TOO_NEW',
          riskScore: 80,
          details,
          warnings: [`Account is ${Math.floor(ageDays)} days old, minimum is ${this.requirements.minAccountAgeDays}`],
        };
      }

      // Add risk for newer accounts
      if (ageDays < 90) {
        riskScore += 20;
        warnings.push('Account less than 90 days old');
      } else if (ageDays < 180) {
        riskScore += 10;
        warnings.push('Account less than 180 days old');
      }
    }

    // Check followers
    if (user.public_metrics) {
      details.followers = user.public_metrics.followers_count ?? 0;
      details.tweets = user.public_metrics.tweet_count ?? 0;

      if (details.followers < this.requirements.minFollowers) {
        return {
          eligible: false,
          reason: 'NOT_ENOUGH_FOLLOWERS',
          riskScore: 70,
          details,
          warnings: [`Account has ${details.followers} followers, minimum is ${this.requirements.minFollowers}`],
        };
      }

      if (details.tweets < this.requirements.minTweets) {
        return {
          eligible: false,
          reason: 'NOT_ENOUGH_TWEETS',
          riskScore: 70,
          details,
          warnings: [`Account has ${details.tweets} tweets, minimum is ${this.requirements.minTweets}`],
        };
      }

      // Add risk for low engagement
      if (details.followers < 20) {
        riskScore += 15;
        warnings.push('Low follower count');
      }
      if (details.tweets < 10) {
        riskScore += 15;
        warnings.push('Low tweet count');
      }
    }

    // Check profile picture
    if (this.requirements.requireProfilePic) {
      const hasDefaultPic = !user.profile_image_url ||
        user.profile_image_url.includes('default_profile');
      details.hasProfilePic = !hasDefaultPic;

      if (hasDefaultPic) {
        return {
          eligible: false,
          reason: 'NO_PROFILE_PIC',
          riskScore: 60,
          details,
          warnings: ['Account has default profile picture'],
        };
      }
    }

    // Check bio
    if (this.requirements.requireBio) {
      const bioLength = user.description?.length ?? 0;
      details.hasBio = bioLength > 0;
      details.bioLength = bioLength;

      if (bioLength === 0) {
        return {
          eligible: false,
          reason: 'NO_BIO',
          riskScore: 50,
          details,
          warnings: ['Account has no bio'],
        };
      }

      if (bioLength < this.requirements.minBioLength) {
        return {
          eligible: false,
          reason: 'BIO_TOO_SHORT',
          riskScore: 50,
          details,
          warnings: [`Bio is ${bioLength} characters, minimum is ${this.requirements.minBioLength}`],
        };
      }
    }

    // Check overall risk score
    if (riskScore > this.maxRiskScore) {
      return {
        eligible: false,
        reason: 'HIGH_RISK_SCORE',
        riskScore,
        details,
        warnings,
      };
    }

    return {
      eligible: true,
      riskScore,
      details,
      warnings,
    };
  }

  // ===========================================================================
  // Wallet Analysis
  // ===========================================================================

  /**
   * Record a wallet connection (for graph analysis).
   */
  recordWalletConnection(wallet1: string, wallet2: string): void {
    if (!this.enableWalletAnalysis) return;

    // Add bidirectional connection
    if (!this.walletConnections.has(wallet1)) {
      this.walletConnections.set(wallet1, new Set());
    }
    if (!this.walletConnections.has(wallet2)) {
      this.walletConnections.set(wallet2, new Set());
    }

    this.walletConnections.get(wallet1)!.add(wallet2);
    this.walletConnections.get(wallet2)!.add(wallet1);
  }

  /**
   * Get all wallets connected to a given wallet.
   */
  getConnectedWallets(wallet: string): string[] {
    return Array.from(this.walletConnections.get(wallet) ?? []);
  }

  /**
   * Check if game participants have suspicious connections.
   */
  analyzeGameParticipants(wallets: string[]): {
    suspiciousClusters: string[][];
    connectionDensity: number;
    warnings: string[];
  } {
    if (!this.enableWalletAnalysis) {
      return {
        suspiciousClusters: [],
        connectionDensity: 0,
        warnings: ['Wallet analysis disabled'],
      };
    }

    const warnings: string[] = [];
    const clusters: string[][] = [];
    let totalConnections = 0;

    // Find connected clusters within the game
    const visited = new Set<string>();

    for (const wallet of wallets) {
      if (visited.has(wallet)) continue;

      const cluster: string[] = [];
      const queue = [wallet];

      while (queue.length > 0) {
        const current = queue.shift()!;
        if (visited.has(current)) continue;
        visited.add(current);

        // Only include wallets that are in the game
        if (wallets.includes(current)) {
          cluster.push(current);
        }

        // Check connections
        const connections = this.walletConnections.get(current);
        if (connections) {
          for (const connected of connections) {
            if (!visited.has(connected) && wallets.includes(connected)) {
              queue.push(connected);
              totalConnections++;
            }
          }
        }
      }

      if (cluster.length > 1) {
        clusters.push(cluster);
        warnings.push(`Found cluster of ${cluster.length} connected wallets`);
      }
    }

    // Calculate connection density
    const maxConnections = (wallets.length * (wallets.length - 1)) / 2;
    const density = maxConnections > 0 ? totalConnections / maxConnections : 0;

    if (density > 0.3) {
      warnings.push(`High connection density: ${(density * 100).toFixed(1)}%`);
    }

    return {
      suspiciousClusters: clusters,
      connectionDensity: density,
      warnings,
    };
  }

  // ===========================================================================
  // Full Verification
  // ===========================================================================

  /**
   * Perform full Sybil check for a player joining a game.
   */
  async verifyPlayer(
    wallet: string,
    twitterHandle?: string,
    existingPlayers?: string[]
  ): Promise<{
    allowed: boolean;
    reason?: string;
    warnings: string[];
    riskScore: number;
  }> {
    const warnings: string[] = [];
    let totalRiskScore = 0;

    // Check Twitter account if provided
    if (twitterHandle) {
      const twitterResult = await this.checkTwitterAccount(twitterHandle);

      if (!twitterResult.eligible) {
        return {
          allowed: false,
          reason: `Twitter check failed: ${twitterResult.reason}`,
          warnings: twitterResult.warnings,
          riskScore: twitterResult.riskScore,
        };
      }

      totalRiskScore += twitterResult.riskScore;
      warnings.push(...twitterResult.warnings);
    } else {
      // No Twitter handle - add risk
      totalRiskScore += 20;
      warnings.push('No Twitter account linked');
    }

    // Check wallet connections if other players exist
    if (existingPlayers && existingPlayers.length > 0 && this.enableWalletAnalysis) {
      const analysis = this.analyzeGameParticipants([...existingPlayers, wallet]);

      // Check if this wallet is in a suspicious cluster
      for (const cluster of analysis.suspiciousClusters) {
        if (cluster.includes(wallet)) {
          totalRiskScore += 30;
          warnings.push(`Wallet connected to ${cluster.length - 1} other players`);
        }
      }

      if (analysis.connectionDensity > 0.5) {
        totalRiskScore += 20;
        warnings.push('Game has high wallet connection density');
      }
    }

    // Final decision
    if (totalRiskScore > this.maxRiskScore) {
      return {
        allowed: false,
        reason: `Risk score ${totalRiskScore} exceeds maximum ${this.maxRiskScore}`,
        warnings,
        riskScore: totalRiskScore,
      };
    }

    return {
      allowed: true,
      warnings,
      riskScore: totalRiskScore,
    };
  }

  // ===========================================================================
  // Configuration
  // ===========================================================================

  /**
   * Update requirements at runtime.
   */
  setRequirements(requirements: Partial<TwitterAccountRequirements>): void {
    this.requirements = { ...this.requirements, ...requirements };
  }

  /**
   * Update max risk score.
   */
  setMaxRiskScore(score: number): void {
    this.maxRiskScore = Math.max(0, Math.min(100, score));
  }

  /**
   * Clear the cache.
   */
  clearCache(): void {
    this.checkedAccounts.clear();
    this.walletConnections.clear();
  }

  /**
   * Get current configuration.
   */
  getConfig(): {
    requirements: TwitterAccountRequirements;
    maxRiskScore: number;
    enableWalletAnalysis: boolean;
    hasTwitterClient: boolean;
  } {
    return {
      requirements: { ...this.requirements },
      maxRiskScore: this.maxRiskScore,
      enableWalletAnalysis: this.enableWalletAnalysis,
      hasTwitterClient: this.twitter !== null,
    };
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createSybilPreventionService(
  twitterClient?: TwitterApi,
  config?: Partial<SybilPreventionConfig>
): SybilPreventionService {
  return new SybilPreventionService({
    twitterClient,
    ...config,
  });
}

export default SybilPreventionService;
