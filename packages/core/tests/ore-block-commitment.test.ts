// ORE Block Commitment Tests (Security Mitigation C2)
//
// Tests that the ORE block commitment scheme prevents selective block choice.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  OreBlockCommitmentManager,
  createCommitmentHash,
  verifyCommitmentHash,
  estimateBlockMiningTime,
  createMockOreBlockCommitmentManager,
  DEFAULT_ORE_COMMITMENT_CONFIG,
} from '../src/ore-block-commitment.js';

describe('ORE Block Commitment Utilities', () => {
  describe('createCommitmentHash', () => {
    it('should create a 64 character hex hash', () => {
      const hash = createCommitmentHash('game-1', 100, Date.now(), 'operator-wallet');
      expect(hash).toHaveLength(64);
      expect(/^[a-f0-9]{64}$/.test(hash)).toBe(true);
    });

    it('should produce deterministic output for same inputs', () => {
      const timestamp = 1704067200000;
      const hash1 = createCommitmentHash('game-1', 100, timestamp, 'wallet');
      const hash2 = createCommitmentHash('game-1', 100, timestamp, 'wallet');
      expect(hash1).toBe(hash2);
    });

    it('should produce different output for different game IDs', () => {
      const timestamp = Date.now();
      const hash1 = createCommitmentHash('game-1', 100, timestamp, 'wallet');
      const hash2 = createCommitmentHash('game-2', 100, timestamp, 'wallet');
      expect(hash1).not.toBe(hash2);
    });

    it('should produce different output for different block heights', () => {
      const timestamp = Date.now();
      const hash1 = createCommitmentHash('game-1', 100, timestamp, 'wallet');
      const hash2 = createCommitmentHash('game-1', 101, timestamp, 'wallet');
      expect(hash1).not.toBe(hash2);
    });
  });

  describe('verifyCommitmentHash', () => {
    it('should verify valid commitment', () => {
      const gameId = 'game-1';
      const targetBlockHeight = 100;
      const committedAt = Date.now();
      const operatorWallet = 'wallet';

      const commitment = {
        gameId,
        targetBlockHeight,
        committedAt,
        operatorWallet,
        commitmentHash: createCommitmentHash(gameId, targetBlockHeight, committedAt, operatorWallet),
      };

      expect(verifyCommitmentHash(commitment)).toBe(true);
    });

    it('should reject tampered commitment', () => {
      const commitment = {
        gameId: 'game-1',
        targetBlockHeight: 100,
        committedAt: Date.now(),
        operatorWallet: 'wallet',
        commitmentHash: 'a'.repeat(64), // Wrong hash
      };

      expect(verifyCommitmentHash(commitment)).toBe(false);
    });
  });

  describe('estimateBlockMiningTime', () => {
    it('should estimate future block time', () => {
      const currentTime = 1704067200000;
      const estimate = estimateBlockMiningTime(100, 105, currentTime);

      // 5 blocks * 60000ms = 300000ms ahead
      expect(estimate).toBe(currentTime + 300000);
    });

    it('should return current time for already mined blocks', () => {
      const currentTime = Date.now();
      const estimate = estimateBlockMiningTime(100, 95, currentTime);

      expect(estimate).toBe(currentTime);
    });
  });
});

describe('OreBlockCommitmentManager', () => {
  let mockSetup: ReturnType<typeof createMockOreBlockCommitmentManager>;
  let manager: OreBlockCommitmentManager;

  beforeEach(() => {
    mockSetup = createMockOreBlockCommitmentManager({
      minBlocksAhead: 3,
      maxWaitTimeMs: 60000,
      commitmentBufferMs: 5000,
    });
    manager = mockSetup.manager;
  });

  describe('createCommitment', () => {
    it('should create valid commitment', async () => {
      const result = await manager.createCommitment('game-1', 'operator-wallet');

      expect(result.success).toBe(true);
      expect(result.commitment).toBeDefined();
      expect(result.commitment!.gameId).toBe('game-1');
      expect(result.commitment!.targetBlockHeight).toBe(103); // 100 + 3 minBlocksAhead
      expect(result.commitment!.operatorWallet).toBe('operator-wallet');
    });

    it('should create commitment with custom target height', async () => {
      const result = await manager.createCommitment('game-1', 'operator-wallet', 110);

      expect(result.success).toBe(true);
      expect(result.commitment!.targetBlockHeight).toBe(110);
    });

    it('should reject duplicate commitment for same game', async () => {
      await manager.createCommitment('game-1', 'operator-wallet');
      const result = await manager.createCommitment('game-1', 'operator-wallet');

      expect(result.success).toBe(false);
      expect(result.error).toContain('already exists');
    });

    it('should reject target too close to current height', async () => {
      const result = await manager.createCommitment('game-1', 'operator-wallet', 101);

      expect(result.success).toBe(false);
      expect(result.error).toContain('at least 3 blocks ahead');
    });

    it('should allow commitment for different games', async () => {
      const result1 = await manager.createCommitment('game-1', 'operator-wallet');
      const result2 = await manager.createCommitment('game-2', 'operator-wallet');

      expect(result1.success).toBe(true);
      expect(result2.success).toBe(true);
    });
  });

  describe('getCommitment', () => {
    it('should return existing commitment', async () => {
      await manager.createCommitment('game-1', 'operator-wallet');
      const commitment = manager.getCommitment('game-1');

      expect(commitment).not.toBeNull();
      expect(commitment!.gameId).toBe('game-1');
    });

    it('should return null for non-existent commitment', () => {
      const commitment = manager.getCommitment('non-existent');
      expect(commitment).toBeNull();
    });
  });

  describe('verifyCommitment', () => {
    it('should verify valid commitment after block is mined', async () => {
      // Create commitment at height 100, targeting 103
      await manager.createCommitment('game-1', 'operator-wallet');

      // Simulate block being mined in the future
      const futureTime = Date.now() + 60000; // 1 minute later
      mockSetup.addBlock(103, 'block-hash-103', futureTime);
      mockSetup.setBlockHeight(103);

      const result = await manager.verifyCommitment('game-1');

      expect(result.success).toBe(true);
      expect(result.verification).toBeDefined();
      expect(result.verification!.verified).toBe(true);
      expect(result.verification!.actualBlockHash).toBe('block-hash-103');
    });

    it('should fail if commitment made after block was mined', async () => {
      // Add block first
      const pastTime = Date.now() - 1000; // 1 second ago
      mockSetup.addBlock(103, 'block-hash-103', pastTime);

      // Then create commitment (this simulates cheating)
      await manager.createCommitment('game-1', 'operator-wallet');

      mockSetup.setBlockHeight(103);

      const result = await manager.verifyCommitment('game-1');

      expect(result.success).toBe(false);
      expect(result.verification!.failureReason).toBe('COMMITMENT_AFTER_BLOCK');
    });

    it('should return pending if block not yet mined', async () => {
      await manager.createCommitment('game-1', 'operator-wallet');

      // Block not added yet
      const result = await manager.verifyCommitment('game-1');

      expect(result.success).toBe(false);
      expect(result.error).toContain('not yet mined');
    });

    it('should return same result on re-verification', async () => {
      await manager.createCommitment('game-1', 'operator-wallet');

      const futureTime = Date.now() + 60000;
      mockSetup.addBlock(103, 'block-hash-103', futureTime);
      mockSetup.setBlockHeight(103);

      const result1 = await manager.verifyCommitment('game-1');
      const result2 = await manager.verifyCommitment('game-1');

      expect(result1.verification!.actualBlockHash).toBe(result2.verification!.actualBlockHash);
    });

    it('should fail for non-existent commitment', async () => {
      const result = await manager.verifyCommitment('non-existent');

      expect(result.success).toBe(false);
      expect(result.error).toContain('No commitment found');
    });
  });

  describe('getVerifiedBlockHash', () => {
    it('should return hash after successful verification', async () => {
      await manager.createCommitment('game-1', 'operator-wallet');

      const futureTime = Date.now() + 60000;
      mockSetup.addBlock(103, 'verified-hash', futureTime);
      mockSetup.setBlockHeight(103);

      await manager.verifyCommitment('game-1');

      const hash = manager.getVerifiedBlockHash('game-1');
      expect(hash).toBe('verified-hash');
    });

    it('should return null before verification', async () => {
      await manager.createCommitment('game-1', 'operator-wallet');

      const hash = manager.getVerifiedBlockHash('game-1');
      expect(hash).toBeNull();
    });

    it('should return null after failed verification', async () => {
      const pastTime = Date.now() - 1000;
      mockSetup.addBlock(103, 'block-hash', pastTime);

      await manager.createCommitment('game-1', 'operator-wallet');
      mockSetup.setBlockHeight(103);

      await manager.verifyCommitment('game-1');

      const hash = manager.getVerifiedBlockHash('game-1');
      expect(hash).toBeNull();
    });
  });

  describe('isWaitingForBlock', () => {
    it('should return true while waiting', async () => {
      await manager.createCommitment('game-1', 'operator-wallet');

      expect(manager.isWaitingForBlock('game-1')).toBe(true);
    });

    it('should return false after verification', async () => {
      await manager.createCommitment('game-1', 'operator-wallet');

      const futureTime = Date.now() + 60000;
      mockSetup.addBlock(103, 'block-hash', futureTime);
      mockSetup.setBlockHeight(103);

      await manager.verifyCommitment('game-1');

      expect(manager.isWaitingForBlock('game-1')).toBe(false);
    });

    it('should return false for non-existent commitment', () => {
      expect(manager.isWaitingForBlock('non-existent')).toBe(false);
    });
  });

  describe('getEstimatedWaitTime', () => {
    it('should estimate wait time for future block', async () => {
      await manager.createCommitment('game-1', 'operator-wallet');

      const waitTime = await manager.getEstimatedWaitTime('game-1');

      // 3 blocks ahead * 60000ms = ~180000ms (with some tolerance for timing)
      expect(waitTime).toBeGreaterThan(150000);
      expect(waitTime).toBeLessThan(200000);
    });

    it('should return 0 if block already mined', async () => {
      await manager.createCommitment('game-1', 'operator-wallet');

      mockSetup.setBlockHeight(110); // Past target

      const waitTime = await manager.getEstimatedWaitTime('game-1');
      expect(waitTime).toBe(0);
    });

    it('should return 0 for non-existent commitment', async () => {
      const waitTime = await manager.getEstimatedWaitTime('non-existent');
      expect(waitTime).toBe(0);
    });
  });

  describe('clearGame', () => {
    it('should remove commitment and verification', async () => {
      await manager.createCommitment('game-1', 'operator-wallet');

      const futureTime = Date.now() + 60000;
      mockSetup.addBlock(103, 'block-hash', futureTime);
      mockSetup.setBlockHeight(103);

      await manager.verifyCommitment('game-1');

      manager.clearGame('game-1');

      expect(manager.getCommitment('game-1')).toBeNull();
      expect(manager.getVerification('game-1')).toBeNull();
    });
  });

  describe('getPendingCommitments', () => {
    it('should return only pending commitments', async () => {
      await manager.createCommitment('game-1', 'operator-wallet');
      await manager.createCommitment('game-2', 'operator-wallet');

      // Verify one
      const futureTime = Date.now() + 60000;
      mockSetup.addBlock(103, 'block-hash', futureTime);
      mockSetup.setBlockHeight(103);
      await manager.verifyCommitment('game-1');

      const pending = manager.getPendingCommitments();

      expect(pending).toHaveLength(1);
      expect(pending[0].gameId).toBe('game-2');
    });
  });

  describe('serialization', () => {
    it('should serialize and restore state', async () => {
      await manager.createCommitment('game-1', 'operator-wallet');

      const json = manager.serialize();

      // Create new manager and restore
      const newMock = createMockOreBlockCommitmentManager();
      newMock.manager.restore(json);

      const commitment = newMock.manager.getCommitment('game-1');
      expect(commitment).not.toBeNull();
      expect(commitment!.gameId).toBe('game-1');
    });
  });
});

describe('Security Properties', () => {
  it('should prevent operator from choosing favorable block', async () => {
    // This test demonstrates the security property:
    // Operator must commit to a specific block BEFORE it's mined

    const mockSetup = createMockOreBlockCommitmentManager({
      minBlocksAhead: 3,
      commitmentBufferMs: 5000,
    });
    const manager = mockSetup.manager;

    // Operator creates commitment before knowing block hash
    await manager.createCommitment('game-1', 'operator');

    // Later, block is mined with a random hash
    // Operator cannot change their commitment
    const futureTime = Date.now() + 60000;
    mockSetup.addBlock(103, 'random-unpredictable-hash', futureTime);
    mockSetup.setBlockHeight(103);

    const result = await manager.verifyCommitment('game-1');

    expect(result.success).toBe(true);
    // The hash used is the one that was actually mined, not chosen by operator
    expect(result.verification!.actualBlockHash).toBe('random-unpredictable-hash');
  });

  it('should reject late commitments (after block mined)', async () => {
    const mockSetup = createMockOreBlockCommitmentManager({
      minBlocksAhead: 1,
      commitmentBufferMs: 5000,
    });
    const manager = mockSetup.manager;

    // Block is mined first
    const pastTime = Date.now() - 10000; // 10 seconds ago
    mockSetup.addBlock(101, 'already-mined-hash', pastTime);

    // Operator tries to commit after seeing the favorable hash
    await manager.createCommitment('game-1', 'operator');

    mockSetup.setBlockHeight(101);

    const result = await manager.verifyCommitment('game-1');

    expect(result.success).toBe(false);
    expect(result.verification!.failureReason).toBe('COMMITMENT_AFTER_BLOCK');
  });

  it('should enforce minimum blocks ahead to prevent last-second commits', async () => {
    const mockSetup = createMockOreBlockCommitmentManager({
      minBlocksAhead: 5,
    });
    const manager = mockSetup.manager;

    // Try to commit to next block (only 1 ahead)
    const result = await manager.createCommitment('game-1', 'operator', 101);

    expect(result.success).toBe(false);
    expect(result.error).toContain('at least 5 blocks ahead');
  });

  it('should use deterministic hashes that can be verified by anyone', async () => {
    const mockSetup = createMockOreBlockCommitmentManager();
    const manager = mockSetup.manager;

    const createResult = await manager.createCommitment('game-1', 'operator');
    const commitment = createResult.commitment!;

    // Anyone can verify the commitment hash matches the components
    const verified = verifyCommitmentHash(commitment);
    expect(verified).toBe(true);

    // If any component is tampered, verification fails
    const tamperedCommitment = { ...commitment, targetBlockHeight: 999 };
    expect(verifyCommitmentHash(tamperedCommitment)).toBe(false);
  });
});

describe('Integration with Commit-Reveal', () => {
  it('should provide block hash for final seed computation', async () => {
    // This demonstrates how C2 integrates with C1
    const mockSetup = createMockOreBlockCommitmentManager();
    const manager = mockSetup.manager;

    // 1. Operator commits to block before game starts
    await manager.createCommitment('game-1', 'operator');

    // 2. Game runs, players do commit-reveal (C1)
    // ... (handled by CommitRevealManager)

    // 3. After reveals, wait for committed block
    const futureTime = Date.now() + 60000;
    mockSetup.addBlock(103, 'ore-block-hash-for-seed', futureTime);
    mockSetup.setBlockHeight(103);

    await manager.verifyCommitment('game-1');

    // 4. Get verified hash for seed computation
    const oreBlockHash = manager.getVerifiedBlockHash('game-1');

    expect(oreBlockHash).toBe('ore-block-hash-for-seed');
    // This hash would be passed to computeFinalSeed() from C1
  });
});
