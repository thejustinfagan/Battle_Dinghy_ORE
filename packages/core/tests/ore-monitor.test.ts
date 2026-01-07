import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { OreMonitorMock, OreRoundResult } from '../src/ore-monitor.js';
import { TOTAL_CELLS } from '../src/types.js';

// =============================================================================
// Test Setup
// =============================================================================

describe('OreMonitorMock', () => {
  let monitor: OreMonitorMock;

  beforeEach(() => {
    vi.useFakeTimers();
    monitor = new OreMonitorMock(1000); // 1 second interval
  });

  afterEach(() => {
    monitor.stop();
    vi.useRealTimers();
  });

  // ===========================================================================
  // Basic Functionality
  // ===========================================================================

  describe('Basic Functionality', () => {
    it('starts and emits rounds at configured interval', async () => {
      const rounds: OreRoundResult[] = [];
      monitor.on('round', (result) => {
        rounds.push(result);
      });

      await monitor.start();

      // No rounds yet
      expect(rounds.length).toBe(0);

      // Advance time by 1 second
      vi.advanceTimersByTime(1000);
      expect(rounds.length).toBe(1);

      // Advance time by another second
      vi.advanceTimersByTime(1000);
      expect(rounds.length).toBe(2);

      // Advance by 3 more seconds
      vi.advanceTimersByTime(3000);
      expect(rounds.length).toBe(5);
    });

    it('each round has incrementing roundNumber', async () => {
      const rounds: OreRoundResult[] = [];
      monitor.on('round', (result) => {
        rounds.push(result);
      });

      await monitor.start();

      vi.advanceTimersByTime(5000);

      expect(rounds.length).toBe(5);
      for (let i = 0; i < rounds.length; i++) {
        expect(rounds[i].roundNumber).toBe(i + 1);
      }
    });

    it('winningBlock is always 0-24', async () => {
      const rounds: OreRoundResult[] = [];
      monitor.on('round', (result) => {
        rounds.push(result);
      });

      await monitor.start();

      // Generate many rounds
      vi.advanceTimersByTime(100000);

      for (const round of rounds) {
        expect(round.winningBlock).toBeGreaterThanOrEqual(0);
        expect(round.winningBlock).toBeLessThan(TOTAL_CELLS);
      }
    });

    it('proof is a valid hex string', async () => {
      const rounds: OreRoundResult[] = [];
      monitor.on('round', (result) => {
        rounds.push(result);
      });

      await monitor.start();
      vi.advanceTimersByTime(1000);

      expect(rounds.length).toBe(1);
      expect(rounds[0].proof).toMatch(/^[0-9a-f]{64}$/); // SHA256 hex
    });

    it('stop() halts emission', async () => {
      const rounds: OreRoundResult[] = [];
      monitor.on('round', (result) => {
        rounds.push(result);
      });

      await monitor.start();
      vi.advanceTimersByTime(3000);
      expect(rounds.length).toBe(3);

      monitor.stop();

      vi.advanceTimersByTime(5000);
      expect(rounds.length).toBe(3); // No more rounds after stop
    });

    it('isRunning() returns correct state', async () => {
      expect(monitor.isRunning()).toBe(false);

      await monitor.start();
      expect(monitor.isRunning()).toBe(true);

      monitor.stop();
      expect(monitor.isRunning()).toBe(false);
    });
  });

  // ===========================================================================
  // Manual Trigger
  // ===========================================================================

  describe('Manual Trigger', () => {
    it('triggerRound() emits immediately', async () => {
      const rounds: OreRoundResult[] = [];
      monitor.on('round', (result) => {
        rounds.push(result);
      });

      // Don't start automatic emission
      const result = monitor.triggerRound();

      expect(rounds.length).toBe(1);
      expect(rounds[0]).toBe(result);
      expect(result.roundNumber).toBe(1);
    });

    it('triggerRound() with specific winningBlock', () => {
      const result = monitor.triggerRound(15);
      expect(result.winningBlock).toBe(15);
    });

    it('triggerRound() wraps winningBlock to 0-24', () => {
      const result = monitor.triggerRound(30);
      expect(result.winningBlock).toBe(5); // 30 % 25 = 5
    });

    it('multiple triggerRound() calls increment roundNumber', () => {
      const r1 = monitor.triggerRound();
      const r2 = monitor.triggerRound();
      const r3 = monitor.triggerRound();

      expect(r1.roundNumber).toBe(1);
      expect(r2.roundNumber).toBe(2);
      expect(r3.roundNumber).toBe(3);
    });
  });

  // ===========================================================================
  // getCurrentRound
  // ===========================================================================

  describe('getCurrentRound', () => {
    it('returns 0 before any rounds', async () => {
      const round = await monitor.getCurrentRound();
      expect(round).toBe(0);
    });

    it('returns correct round after emissions', async () => {
      monitor.triggerRound();
      monitor.triggerRound();
      monitor.triggerRound();

      const round = await monitor.getCurrentRound();
      expect(round).toBe(3);
    });
  });

  // ===========================================================================
  // waitForRound
  // ===========================================================================

  describe('waitForRound', () => {
    it('resolves when target round is reached', async () => {
      const promise = monitor.waitForRound(3);

      // Trigger rounds
      monitor.triggerRound();
      monitor.triggerRound();

      // Round 3 not yet reached
      await vi.advanceTimersByTimeAsync(0);

      monitor.triggerRound(); // This is round 3

      const result = await promise;
      expect(result.roundNumber).toBe(3);
    });

    it('resolves immediately if round already exists', async () => {
      // Trigger some rounds first
      monitor.triggerRound();
      monitor.triggerRound();
      monitor.triggerRound();

      // Wait for already-passed round
      const result = await monitor.waitForRound(2);
      expect(result.roundNumber).toBe(2);
    });

    it('rejects on timeout', async () => {
      const promise = monitor.waitForRound(5, 1000);

      // Only trigger 2 rounds
      monitor.triggerRound();
      monitor.triggerRound();

      // Advance past timeout
      vi.advanceTimersByTime(1500);

      await expect(promise).rejects.toThrow('Timeout waiting for round 5');
    });

    it('multiple waiters for same round all resolve', async () => {
      const promises = [
        monitor.waitForRound(2),
        monitor.waitForRound(2),
        monitor.waitForRound(2),
      ];

      monitor.triggerRound();
      monitor.triggerRound();

      const results = await Promise.all(promises);

      expect(results.length).toBe(3);
      for (const result of results) {
        expect(result.roundNumber).toBe(2);
      }
    });
  });

  // ===========================================================================
  // History
  // ===========================================================================

  describe('History', () => {
    it('getHistory() returns all emitted rounds', () => {
      monitor.triggerRound(5);
      monitor.triggerRound(10);
      monitor.triggerRound(15);

      const history = monitor.getHistory();

      expect(history.length).toBe(3);
      expect(history[0].roundNumber).toBe(1);
      expect(history[0].winningBlock).toBe(5);
      expect(history[1].roundNumber).toBe(2);
      expect(history[1].winningBlock).toBe(10);
      expect(history[2].roundNumber).toBe(3);
      expect(history[2].winningBlock).toBe(15);
    });

    it('reset() clears history and round number', async () => {
      monitor.triggerRound();
      monitor.triggerRound();
      monitor.triggerRound();

      expect(await monitor.getCurrentRound()).toBe(3);
      expect(monitor.getHistory().length).toBe(3);

      monitor.reset();

      expect(await monitor.getCurrentRound()).toBe(0);
      expect(monitor.getHistory().length).toBe(0);
    });
  });

  // ===========================================================================
  // Interval Configuration
  // ===========================================================================

  describe('Interval Configuration', () => {
    it('zero interval disables automatic emission', async () => {
      const zeroMonitor = new OreMonitorMock(0);
      const rounds: OreRoundResult[] = [];
      zeroMonitor.on('round', (result) => {
        rounds.push(result);
      });

      await zeroMonitor.start();

      vi.advanceTimersByTime(10000);

      expect(rounds.length).toBe(0);

      // Manual trigger still works
      zeroMonitor.triggerRound();
      expect(rounds.length).toBe(1);

      zeroMonitor.stop();
    });

    it('setInterval() changes emission rate', async () => {
      const rounds: OreRoundResult[] = [];
      monitor.on('round', (result) => {
        rounds.push(result);
      });

      await monitor.start();

      // 1 second interval
      vi.advanceTimersByTime(3000);
      expect(rounds.length).toBe(3);

      // Change to 500ms interval
      monitor.setInterval(500);

      vi.advanceTimersByTime(1000);
      expect(rounds.length).toBe(5); // 2 more rounds in 1 second
    });

    it('custom interval in constructor', async () => {
      const fastMonitor = new OreMonitorMock(100);
      const rounds: OreRoundResult[] = [];
      fastMonitor.on('round', (result) => {
        rounds.push(result);
      });

      await fastMonitor.start();

      vi.advanceTimersByTime(1000);
      expect(rounds.length).toBe(10);

      fastMonitor.stop();
    });
  });

  // ===========================================================================
  // Error Handling
  // ===========================================================================

  describe('Error Handling', () => {
    it('stop() rejects pending waiters', async () => {
      const promise = monitor.waitForRound(10);

      monitor.triggerRound();
      monitor.stop();

      await expect(promise).rejects.toThrow('Monitor stopped');
    });

    it('multiple starts are idempotent', async () => {
      await monitor.start();
      await monitor.start();
      await monitor.start();

      const rounds: OreRoundResult[] = [];
      monitor.on('round', (result) => {
        rounds.push(result);
      });

      vi.advanceTimersByTime(1000);

      // Should only have 1 round, not 3
      expect(rounds.length).toBe(1);
    });
  });
});

// =============================================================================
// Real Timer Tests (for async behavior verification)
// =============================================================================

describe('OreMonitorMock - Real Timers', () => {
  it('works with real timers for quick intervals', async () => {
    const monitor = new OreMonitorMock(10); // 10ms interval
    const rounds: OreRoundResult[] = [];

    monitor.on('round', (result) => {
      rounds.push(result);
    });

    await monitor.start();

    // Wait longer to account for timing variance
    await new Promise((resolve) => setTimeout(resolve, 100));

    monitor.stop();

    // Should have at least a couple rounds (timing can be imprecise)
    expect(rounds.length).toBeGreaterThanOrEqual(2);
  });
});
