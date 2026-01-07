// Commit-Reveal Tests (Security Mitigation C1)
//
// Tests that the commit-reveal scheme correctly prevents seed manipulation.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  CommitRevealManager,
  PlayerCommitmentHelper,
  generateSecret,
  createCommitment,
  verifyReveal,
  computeFinalSeed,
  DEFAULT_CONFIG,
} from '../src/commit-reveal.js';

describe('Commit-Reveal Utilities', () => {
  describe('generateSecret', () => {
    it('should generate 64 character hex string (256 bits)', () => {
      const secret = generateSecret();
      expect(secret).toHaveLength(64);
      expect(/^[a-f0-9]{64}$/.test(secret)).toBe(true);
    });

    it('should generate unique secrets', () => {
      const secrets = new Set<string>();
      for (let i = 0; i < 100; i++) {
        secrets.add(generateSecret());
      }
      expect(secrets.size).toBe(100);
    });
  });

  describe('createCommitment', () => {
    it('should create a 64 character hex hash', () => {
      const secret = generateSecret();
      const wallet = 'wallet123';
      const commitment = createCommitment(secret, wallet);

      expect(commitment).toHaveLength(64);
      expect(/^[a-f0-9]{64}$/.test(commitment)).toBe(true);
    });

    it('should produce deterministic output for same inputs', () => {
      const secret = 'test-secret';
      const wallet = 'test-wallet';

      const commitment1 = createCommitment(secret, wallet);
      const commitment2 = createCommitment(secret, wallet);

      expect(commitment1).toBe(commitment2);
    });

    it('should produce different output for different secrets', () => {
      const wallet = 'test-wallet';
      const commitment1 = createCommitment('secret1', wallet);
      const commitment2 = createCommitment('secret2', wallet);

      expect(commitment1).not.toBe(commitment2);
    });

    it('should produce different output for different wallets', () => {
      const secret = 'test-secret';
      const commitment1 = createCommitment(secret, 'wallet1');
      const commitment2 = createCommitment(secret, 'wallet2');

      expect(commitment1).not.toBe(commitment2);
    });
  });

  describe('verifyReveal', () => {
    it('should verify correct reveal', () => {
      const secret = generateSecret();
      const wallet = 'test-wallet';
      const commitment = createCommitment(secret, wallet);

      expect(verifyReveal(commitment, secret, wallet)).toBe(true);
    });

    it('should reject wrong secret', () => {
      const secret = generateSecret();
      const wallet = 'test-wallet';
      const commitment = createCommitment(secret, wallet);

      expect(verifyReveal(commitment, 'wrong-secret', wallet)).toBe(false);
    });

    it('should reject wrong wallet', () => {
      const secret = generateSecret();
      const wallet = 'test-wallet';
      const commitment = createCommitment(secret, wallet);

      expect(verifyReveal(commitment, secret, 'wrong-wallet')).toBe(false);
    });
  });

  describe('computeFinalSeed', () => {
    it('should produce 32 byte seed', () => {
      const commitments = [
        {
          wallet: 'wallet1',
          commitmentHash: createCommitment('secret1', 'wallet1'),
          revealedSecret: 'secret1',
          committedAt: Date.now(),
          revealedAt: Date.now(),
        },
        {
          wallet: 'wallet2',
          commitmentHash: createCommitment('secret2', 'wallet2'),
          revealedSecret: 'secret2',
          committedAt: Date.now(),
          revealedAt: Date.now(),
        },
      ];

      const oreHash = 'a'.repeat(64);
      const seed = computeFinalSeed(commitments, oreHash);

      expect(seed).toBeInstanceOf(Uint8Array);
      expect(seed.length).toBe(32);
    });

    it('should produce deterministic output for same inputs', () => {
      const commitments = [
        {
          wallet: 'wallet1',
          commitmentHash: 'hash1',
          revealedSecret: 'secret1',
          committedAt: 1000,
        },
      ];

      const oreHash = 'b'.repeat(64);
      const seed1 = computeFinalSeed(commitments, oreHash);
      const seed2 = computeFinalSeed(commitments, oreHash);

      expect(Buffer.from(seed1).toString('hex')).toBe(
        Buffer.from(seed2).toString('hex')
      );
    });

    it('should use commitment hash when secret not revealed', () => {
      const commitment = {
        wallet: 'wallet1',
        commitmentHash: 'hash-used-as-entropy',
        committedAt: Date.now(),
        // No revealedSecret
      };

      const oreHash = 'c'.repeat(64);
      const seed = computeFinalSeed([commitment], oreHash);

      // Should not throw and should produce valid seed
      expect(seed.length).toBe(32);
    });

    it('should sort by wallet for deterministic ordering', () => {
      const commitment1 = {
        wallet: 'zzzz-wallet',
        commitmentHash: 'hash1',
        revealedSecret: 'secret1',
        committedAt: Date.now(),
      };
      const commitment2 = {
        wallet: 'aaaa-wallet',
        commitmentHash: 'hash2',
        revealedSecret: 'secret2',
        committedAt: Date.now(),
      };

      const oreHash = 'd'.repeat(64);

      // Order shouldn't matter
      const seed1 = computeFinalSeed([commitment1, commitment2], oreHash);
      const seed2 = computeFinalSeed([commitment2, commitment1], oreHash);

      expect(Buffer.from(seed1).toString('hex')).toBe(
        Buffer.from(seed2).toString('hex')
      );
    });
  });
});

describe('CommitRevealManager', () => {
  let manager: CommitRevealManager;
  const gameId = 'test-game-123';

  beforeEach(() => {
    manager = new CommitRevealManager(gameId, {
      commitPhaseDurationSec: 300,
      revealPhaseDurationSec: 120,
      minPlayers: 2,
    });
  });

  describe('phase management', () => {
    it('should start in committing phase', () => {
      expect(manager.getPhase()).toBe('committing');
    });

    it('should transition to revealing phase manually', () => {
      // Need minimum players
      manager.submitCommitment('wallet1', 'a'.repeat(64));
      manager.submitCommitment('wallet2', 'b'.repeat(64));

      expect(manager.startRevealPhase()).toBe(true);
      expect(manager.getPhase()).toBe('revealing');
    });

    it('should not transition without minimum players', () => {
      manager.submitCommitment('wallet1', 'a'.repeat(64));

      expect(manager.startRevealPhase()).toBe(false);
      expect(manager.getPhase()).toBe('committing');
    });
  });

  describe('commit phase', () => {
    it('should accept valid commitment', () => {
      const result = manager.submitCommitment('wallet1', 'a'.repeat(64));

      expect(result.success).toBe(true);
      expect(result.commitmentHash).toBe('a'.repeat(64));
    });

    it('should reject duplicate commitment', () => {
      manager.submitCommitment('wallet1', 'a'.repeat(64));
      const result = manager.submitCommitment('wallet1', 'b'.repeat(64));

      expect(result.success).toBe(false);
      expect(result.error).toContain('already committed');
    });

    it('should reject invalid hash format', () => {
      const result = manager.submitCommitment('wallet1', 'invalid');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid commitment hash');
    });

    it('should track committed players', () => {
      manager.submitCommitment('wallet1', 'a'.repeat(64));
      manager.submitCommitment('wallet2', 'b'.repeat(64));

      expect(manager.hasCommitted('wallet1')).toBe(true);
      expect(manager.hasCommitted('wallet2')).toBe(true);
      expect(manager.hasCommitted('wallet3')).toBe(false);

      expect(manager.getCommittedPlayers()).toEqual(['wallet1', 'wallet2']);
    });
  });

  describe('reveal phase', () => {
    const secret1 = generateSecret();
    const secret2 = generateSecret();

    beforeEach(() => {
      // Set up commitments
      manager.submitCommitment('wallet1', createCommitment(secret1, 'wallet1'));
      manager.submitCommitment('wallet2', createCommitment(secret2, 'wallet2'));
      manager.startRevealPhase();
    });

    it('should accept valid reveal', () => {
      const result = manager.revealSecret('wallet1', secret1);

      expect(result.success).toBe(true);
      expect(result.verified).toBe(true);
    });

    it('should reject invalid reveal', () => {
      const result = manager.revealSecret('wallet1', 'wrong-secret');

      expect(result.success).toBe(false);
      expect(result.verified).toBe(false);
      expect(result.error).toContain('does not match');
    });

    it('should reject reveal for non-committed player', () => {
      const result = manager.revealSecret('wallet3', 'any-secret');

      expect(result.success).toBe(false);
      expect(result.error).toContain('No commitment found');
    });

    it('should reject duplicate reveal', () => {
      manager.revealSecret('wallet1', secret1);
      const result = manager.revealSecret('wallet1', secret1);

      expect(result.success).toBe(false);
      expect(result.error).toContain('already revealed');
    });

    it('should track revealed players', () => {
      manager.revealSecret('wallet1', secret1);

      expect(manager.hasRevealed('wallet1')).toBe(true);
      expect(manager.hasRevealed('wallet2')).toBe(false);

      expect(manager.getRevealedPlayers()).toEqual(['wallet1']);
      expect(manager.getMissingReveals()).toEqual(['wallet2']);
    });
  });

  describe('finalization', () => {
    const secret1 = generateSecret();
    const secret2 = generateSecret();
    const validOreHash = 'e'.repeat(64);

    beforeEach(() => {
      manager.submitCommitment('wallet1', createCommitment(secret1, 'wallet1'));
      manager.submitCommitment('wallet2', createCommitment(secret2, 'wallet2'));
      manager.startRevealPhase();
      manager.revealSecret('wallet1', secret1);
      manager.revealSecret('wallet2', secret2);
    });

    it('should finalize successfully', () => {
      const result = manager.finalize(validOreHash);

      expect(result.success).toBe(true);
      expect(result.seed).toBeInstanceOf(Uint8Array);
      expect(result.seed!.length).toBe(32);
      expect(result.seedHex).toHaveLength(64);
      expect(result.participantCount).toBe(2);
    });

    it('should transition to finalized phase', () => {
      manager.finalize(validOreHash);
      expect(manager.getPhase()).toBe('finalized');
    });

    it('should return same seed on re-finalization', () => {
      const result1 = manager.finalize(validOreHash);
      const result2 = manager.finalize(validOreHash);

      expect(result1.seedHex).toBe(result2.seedHex);
    });

    it('should reject invalid ORE hash format', () => {
      const result = manager.finalize('invalid-hash');

      expect(result.success).toBe(false);
      expect(result.error).toContain('Invalid ORE block hash');
    });

    it('should allow finalization with partial reveals', () => {
      // Create new manager with only one reveal
      const mgr = new CommitRevealManager('game2', { minPlayers: 2 });
      mgr.submitCommitment('wallet1', createCommitment(secret1, 'wallet1'));
      mgr.submitCommitment('wallet2', createCommitment(secret2, 'wallet2'));
      mgr.startRevealPhase();
      mgr.revealSecret('wallet1', secret1);
      // wallet2 doesn't reveal

      const result = mgr.finalize(validOreHash);

      expect(result.success).toBe(true);
      // Should still produce valid seed using commitment hash for wallet2
      expect(result.seed!.length).toBe(32);
    });
  });

  describe('state access', () => {
    it('should return final seed after finalization', () => {
      const secret1 = generateSecret();
      const secret2 = generateSecret();

      manager.submitCommitment('wallet1', createCommitment(secret1, 'wallet1'));
      manager.submitCommitment('wallet2', createCommitment(secret2, 'wallet2'));
      manager.startRevealPhase();
      manager.revealSecret('wallet1', secret1);
      manager.revealSecret('wallet2', secret2);
      manager.finalize('f'.repeat(64));

      expect(manager.getFinalSeed()).not.toBeNull();
      expect(manager.getFinalSeedHex()).not.toBeNull();
    });

    it('should return null for seed before finalization', () => {
      expect(manager.getFinalSeed()).toBeNull();
      expect(manager.getFinalSeedHex()).toBeNull();
    });

    it('should provide stats', () => {
      manager.submitCommitment('wallet1', 'a'.repeat(64));

      const stats = manager.getStats();

      expect(stats.phase).toBe('committing');
      expect(stats.totalCommitments).toBe(1);
      expect(stats.totalReveals).toBe(0);
      expect(stats.isFinalized).toBe(false);
    });
  });

  describe('serialization', () => {
    it('should serialize and deserialize state', () => {
      const secret = generateSecret();
      manager.submitCommitment('wallet1', createCommitment(secret, 'wallet1'));
      manager.submitCommitment('wallet2', 'b'.repeat(64));

      const json = manager.serialize();
      const restored = CommitRevealManager.deserialize(json);

      expect(restored.hasCommitted('wallet1')).toBe(true);
      expect(restored.hasCommitted('wallet2')).toBe(true);
      expect(restored.getCommittedPlayers()).toEqual(['wallet1', 'wallet2']);
    });
  });
});

describe('PlayerCommitmentHelper', () => {
  it('should generate valid commitment', () => {
    const helper = new PlayerCommitmentHelper('test-wallet');
    const hash = helper.getCommitmentHash();

    expect(hash).toHaveLength(64);
    expect(/^[a-f0-9]{64}$/.test(hash)).toBe(true);
  });

  it('should verify its own commitment', () => {
    const helper = new PlayerCommitmentHelper('test-wallet');
    expect(helper.verify()).toBe(true);
  });

  it('should provide secret for reveal', () => {
    const wallet = 'test-wallet';
    const helper = new PlayerCommitmentHelper(wallet);

    const secret = helper.getSecret();
    const hash = helper.getCommitmentHash();

    expect(verifyReveal(hash, secret, wallet)).toBe(true);
  });
});

describe('Security Properties', () => {
  it('should prevent operator from predicting seed without all reveals', () => {
    // Operator cannot predict the final seed because:
    // 1. They don't know player secrets until reveal phase
    // 2. ORE block hash adds external entropy

    const manager = new CommitRevealManager('game', { minPlayers: 2 });

    // Players commit (operator sees hashes but not secrets)
    const secret1 = generateSecret();
    const secret2 = generateSecret();

    manager.submitCommitment('wallet1', createCommitment(secret1, 'wallet1'));
    manager.submitCommitment('wallet2', createCommitment(secret2, 'wallet2'));

    // At this point, operator cannot compute final seed
    // because they don't know secret1 or secret2

    manager.startRevealPhase();

    // Players reveal secrets
    manager.revealSecret('wallet1', secret1);
    manager.revealSecret('wallet2', secret2);

    // Now with ORE hash, seed can be computed
    const oreHash = generateSecret(); // Random ORE hash
    const result = manager.finalize(oreHash);

    expect(result.success).toBe(true);
  });

  it('should produce different seeds with different ORE hashes', () => {
    const setup = () => {
      const mgr = new CommitRevealManager('game', { minPlayers: 2 });
      const s1 = 'fixed-secret-1';
      const s2 = 'fixed-secret-2';

      mgr.submitCommitment('wallet1', createCommitment(s1, 'wallet1'));
      mgr.submitCommitment('wallet2', createCommitment(s2, 'wallet2'));
      mgr.startRevealPhase();
      mgr.revealSecret('wallet1', s1);
      mgr.revealSecret('wallet2', s2);

      return mgr;
    };

    const mgr1 = setup();
    const mgr2 = setup();

    const result1 = mgr1.finalize('a'.repeat(64));
    const result2 = mgr2.finalize('b'.repeat(64));

    expect(result1.seedHex).not.toBe(result2.seedHex);
  });

  it('should handle non-revealing players by using commitment hash', () => {
    // This prevents selective exclusion attacks
    const manager = new CommitRevealManager('game', { minPlayers: 2 });

    const secret1 = generateSecret();
    const hash2 = 'b'.repeat(64); // Player 2's commitment

    manager.submitCommitment('wallet1', createCommitment(secret1, 'wallet1'));
    manager.submitCommitment('wallet2', hash2);

    manager.startRevealPhase();
    manager.revealSecret('wallet1', secret1);
    // wallet2 doesn't reveal

    const oreHash = 'c'.repeat(64);
    const result = manager.finalize(oreHash);

    expect(result.success).toBe(true);
    // Seed still includes wallet2's entropy via their commitment hash
  });
});
