// Battle Dinghy - ORE Monitor
//
// This module provides an interface for monitoring ORE mining rounds.
// The OreMonitorMock implementation allows testing without real ORE.

import { EventEmitter } from 'events';
import { createHash } from 'crypto';
import { TOTAL_CELLS } from './types.js';

// =============================================================================
// Types
// =============================================================================

/**
 * Result of an ORE mining round
 */
export interface OreRoundResult {
  readonly roundNumber: number;
  readonly winningBlock: number; // 0-24
  readonly timestamp: number;
  readonly proof: string; // For verification and derived shot calculation
}

// =============================================================================
// Abstract OreMonitor
// =============================================================================

/**
 * Abstract base class for ORE round monitoring.
 * Extend this class to implement real ORE monitoring or mocks.
 */
export abstract class OreMonitor extends EventEmitter {
  protected _isRunning: boolean = false;
  protected _currentRound: number = 0;

  /**
   * Start monitoring for ORE rounds.
   */
  abstract start(): Promise<void>;

  /**
   * Stop monitoring.
   */
  abstract stop(): void;

  /**
   * Get the current round number.
   */
  abstract getCurrentRound(): Promise<number>;

  /**
   * Wait for a specific round to be reached.
   * @param target - Target round number
   * @param timeoutMs - Optional timeout in milliseconds
   * @returns Promise resolving to the round result
   */
  abstract waitForRound(
    target: number,
    timeoutMs?: number
  ): Promise<OreRoundResult>;

  /**
   * Check if monitor is currently running.
   */
  isRunning(): boolean {
    return this._isRunning;
  }
}

// =============================================================================
// OreMonitorMock
// =============================================================================

/**
 * Mock implementation of OreMonitor for testing.
 * Emits rounds at configurable intervals or on demand via triggerRound().
 */
export class OreMonitorMock extends OreMonitor {
  private intervalMs: number;
  private intervalId: NodeJS.Timeout | null = null;
  private roundHistory: OreRoundResult[] = [];
  private pendingWaiters: Map<
    number,
    { resolve: (result: OreRoundResult) => void; reject: (err: Error) => void }[]
  > = new Map();

  /**
   * Create a mock ORE monitor.
   * @param intervalMs - Interval between automatic rounds (default 1000ms)
   *                     Set to 0 to disable automatic rounds (manual trigger only)
   */
  constructor(intervalMs: number = 1000) {
    super();
    this.intervalMs = intervalMs;
  }

  /**
   * Start emitting rounds at the configured interval.
   */
  async start(): Promise<void> {
    if (this._isRunning) {
      return;
    }

    this._isRunning = true;

    if (this.intervalMs > 0) {
      this.intervalId = setInterval(() => {
        this.emitNextRound();
      }, this.intervalMs);
    }
  }

  /**
   * Stop emitting rounds.
   */
  stop(): void {
    this._isRunning = false;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    // Reject all pending waiters
    for (const [, waiters] of this.pendingWaiters) {
      for (const waiter of waiters) {
        waiter.reject(new Error('Monitor stopped'));
      }
    }
    this.pendingWaiters.clear();
  }

  /**
   * Get the current round number.
   */
  async getCurrentRound(): Promise<number> {
    return this._currentRound;
  }

  /**
   * Wait for a specific round to be reached.
   */
  waitForRound(target: number, timeoutMs?: number): Promise<OreRoundResult> {
    // Check if we already have this round
    const existing = this.roundHistory.find(r => r.roundNumber === target);
    if (existing) {
      return Promise.resolve(existing);
    }

    // If target is in the past, reject
    if (target <= this._currentRound) {
      return Promise.reject(
        new Error(`Round ${target} has already passed (current: ${this._currentRound})`)
      );
    }

    return new Promise((resolve, reject) => {
      // Add to pending waiters
      if (!this.pendingWaiters.has(target)) {
        this.pendingWaiters.set(target, []);
      }
      this.pendingWaiters.get(target)!.push({ resolve, reject });

      // Set up timeout if specified
      if (timeoutMs !== undefined && timeoutMs > 0) {
        setTimeout(() => {
          const waiters = this.pendingWaiters.get(target);
          if (waiters) {
            const index = waiters.findIndex(w => w.resolve === resolve);
            if (index >= 0) {
              waiters.splice(index, 1);
              reject(new Error(`Timeout waiting for round ${target}`));
            }
          }
        }, timeoutMs);
      }
    });
  }

  /**
   * Manually trigger a round emission.
   * @param winningBlock - Optional specific winning block (random if not specified)
   * @returns The emitted round result
   */
  triggerRound(winningBlock?: number): OreRoundResult {
    return this.emitNextRound(winningBlock);
  }

  /**
   * Get the history of all emitted rounds.
   */
  getHistory(): readonly OreRoundResult[] {
    return [...this.roundHistory];
  }

  /**
   * Reset the monitor state (for testing).
   */
  reset(): void {
    this.stop();
    this._currentRound = 0;
    this.roundHistory = [];
    this.pendingWaiters.clear();
  }

  /**
   * Set the interval for automatic rounds.
   */
  setInterval(intervalMs: number): void {
    const wasRunning = this._isRunning;

    if (this.intervalId) {
      clearInterval(this.intervalId);
      this.intervalId = null;
    }

    this.intervalMs = intervalMs;

    if (wasRunning && intervalMs > 0) {
      this.intervalId = setInterval(() => {
        this.emitNextRound();
      }, intervalMs);
    }
  }

  /**
   * Emit the next round.
   */
  private emitNextRound(winningBlock?: number): OreRoundResult {
    this._currentRound++;

    const timestamp = Date.now();
    const block =
      winningBlock !== undefined
        ? winningBlock % TOTAL_CELLS
        : Math.floor(Math.random() * TOTAL_CELLS);

    // Generate deterministic proof from round and timestamp
    const proof = createHash('sha256')
      .update(`ore-proof-${this._currentRound}-${timestamp}`)
      .digest('hex');

    const result: OreRoundResult = {
      roundNumber: this._currentRound,
      winningBlock: block,
      timestamp,
      proof,
    };

    this.roundHistory.push(result);

    // Emit event
    this.emit('round', result);

    // Resolve any waiters for this round
    const waiters = this.pendingWaiters.get(this._currentRound);
    if (waiters) {
      for (const waiter of waiters) {
        waiter.resolve(result);
      }
      this.pendingWaiters.delete(this._currentRound);
    }

    return result;
  }
}

// =============================================================================
// Utility Functions
// =============================================================================

/**
 * Create a deterministic proof for testing.
 */
export function createDeterministicProof(
  roundNumber: number,
  timestamp: number
): string {
  return createHash('sha256')
    .update(`ore-proof-${roundNumber}-${timestamp}`)
    .digest('hex');
}
