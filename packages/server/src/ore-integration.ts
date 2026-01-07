// Battle Dinghy - ORE Mining Integration
//
// Connects to ORE mining to get real randomness for game rounds.
// ORE is a Solana-based proof-of-work mining protocol.

import { Connection, PublicKey } from '@solana/web3.js';
import { OreMonitor, OreRoundResult, TOTAL_CELLS } from '@battle-dinghy/core';
import { createHash } from 'crypto';

// =============================================================================
// Constants
// =============================================================================

// ORE Program ID (mainnet)
const ORE_PROGRAM_ID = new PublicKey('oreV2ZymfyeXgNgBdqMkumTqqAprVqgBWQfoYkrtKWQ');

// Poll interval for checking ORE state
const DEFAULT_POLL_INTERVAL_MS = 60_000; // 1 minute

// =============================================================================
// OreMonitorLive
// =============================================================================

/**
 * Live implementation of OreMonitor that connects to actual ORE mining.
 * Polls the ORE program state and emits rounds based on mining progress.
 */
export class OreMonitorLive extends OreMonitor {
  private connection: Connection;
  private pollIntervalMs: number;
  private pollInterval: NodeJS.Timeout | null = null;
  private lastProcessedHash: string | null = null;
  private roundHistory: OreRoundResult[] = [];

  constructor(connection: Connection, pollIntervalMs = DEFAULT_POLL_INTERVAL_MS) {
    super();
    this.connection = connection;
    this.pollIntervalMs = pollIntervalMs;
  }

  async start(): Promise<void> {
    if (this._isRunning) return;
    this._isRunning = true;

    console.log('ORE Monitor started');

    // Initial poll
    await this.pollOreState();

    // Set up polling interval
    this.pollInterval = setInterval(async () => {
      try {
        await this.pollOreState();
      } catch (error) {
        console.error('Error polling ORE state:', error);
      }
    }, this.pollIntervalMs);
  }

  stop(): void {
    this._isRunning = false;

    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }

    console.log('ORE Monitor stopped');
  }

  async getCurrentRound(): Promise<number> {
    return this._currentRound;
  }

  async waitForRound(target: number, timeoutMs = 300_000): Promise<OreRoundResult> {
    // Check if we already have this round
    const existing = this.roundHistory.find(r => r.roundNumber === target);
    if (existing) {
      return existing;
    }

    return new Promise((resolve, reject) => {
      const startTime = Date.now();

      const checkInterval = setInterval(() => {
        const round = this.roundHistory.find(r => r.roundNumber === target);
        if (round) {
          clearInterval(checkInterval);
          resolve(round);
          return;
        }

        if (Date.now() - startTime > timeoutMs) {
          clearInterval(checkInterval);
          reject(new Error(`Timeout waiting for round ${target}`));
        }
      }, 1000);
    });
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private async pollOreState(): Promise<void> {
    try {
      // Get ORE treasury/proof accounts to find latest mining result
      // This is a simplified version - real implementation would parse ORE account data

      const accounts = await this.connection.getProgramAccounts(ORE_PROGRAM_ID, {
        commitment: 'confirmed',
        dataSlice: { offset: 0, length: 64 }, // Get first 64 bytes for hash
      });

      if (accounts.length === 0) {
        return;
      }

      // Find the most recent proof (in practice, you'd parse the actual ORE data structure)
      // For now, we use account data to derive randomness
      const latestAccount = accounts[0];
      const dataHash = createHash('sha256')
        .update(latestAccount.account.data)
        .digest('hex');

      // Skip if we've already processed this
      if (dataHash === this.lastProcessedHash) {
        return;
      }

      this.lastProcessedHash = dataHash;
      this._currentRound++;

      // Derive winning block from hash (use first 4 bytes as uint32, mod TOTAL_CELLS)
      const hashBuffer = Buffer.from(dataHash, 'hex');
      const randomValue = hashBuffer.readUInt32BE(0);
      const winningBlock = randomValue % TOTAL_CELLS;

      const result: OreRoundResult = {
        roundNumber: this._currentRound,
        winningBlock,
        timestamp: Date.now(),
        proof: dataHash,
      };

      this.roundHistory.push(result);
      this.emit('round', result);

      console.log(`ORE Round ${this._currentRound}: Block ${winningBlock}, Proof: ${dataHash.slice(0, 16)}...`);
    } catch (error) {
      console.error('Error polling ORE state:', error);
    }
  }
}

// =============================================================================
// Factory
// =============================================================================

export function createOreMonitor(
  connection: Connection,
  options?: { pollIntervalMs?: number; useMock?: boolean }
): OreMonitor {
  if (options?.useMock) {
    // Import and return mock for testing
    const { OreMonitorMock } = require('@battle-dinghy/core');
    return new OreMonitorMock(options.pollIntervalMs ?? 60_000);
  }

  return new OreMonitorLive(connection, options?.pollIntervalMs);
}

// =============================================================================
// Helius Webhook Handler
// =============================================================================

/**
 * Parse a Helius webhook payload for ORE mining events.
 * Use this with Helius webhooks for real-time ORE event notifications.
 */
export interface HeliusWebhookPayload {
  type: string;
  signature: string;
  slot: number;
  timestamp: number;
  nativeTransfers?: Array<{
    fromUserAccount: string;
    toUserAccount: string;
    amount: number;
  }>;
  accountData?: Array<{
    account: string;
    data: string;
  }>;
}

export function parseOreWebhook(payload: HeliusWebhookPayload): OreRoundResult | null {
  // Check if this is an ORE-related transaction
  const isOreTransaction = payload.accountData?.some(
    a => a.account === ORE_PROGRAM_ID.toString()
  );

  if (!isOreTransaction) {
    return null;
  }

  // Derive randomness from transaction signature
  const hash = createHash('sha256')
    .update(payload.signature)
    .digest('hex');

  const hashBuffer = Buffer.from(hash, 'hex');
  const randomValue = hashBuffer.readUInt32BE(0);
  const winningBlock = randomValue % TOTAL_CELLS;

  return {
    roundNumber: 0, // Will be set by the game engine
    winningBlock,
    timestamp: payload.timestamp * 1000,
    proof: payload.signature,
  };
}
