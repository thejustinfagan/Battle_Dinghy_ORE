// Rate Limiter Tests (Security Mitigation E1)
//
// Tests that rate limiting correctly blocks excessive requests

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { RateLimiter, createApiRateLimiter } from '../src/rate-limiter.js';

describe('RateLimiter', () => {
  let rateLimiter: RateLimiter;

  afterEach(() => {
    if (rateLimiter) {
      rateLimiter.stop();
    }
  });

  describe('isRateLimited', () => {
    it('should allow requests under the limit', () => {
      rateLimiter = new RateLimiter({
        maxRequests: 5,
        windowMs: 60_000,
      });

      const key = 'test-ip-1';

      // First 5 requests should not be rate limited
      for (let i = 0; i < 5; i++) {
        expect(rateLimiter.isRateLimited(key)).toBe(false);
      }
    });

    it('should block requests over the limit', () => {
      rateLimiter = new RateLimiter({
        maxRequests: 3,
        windowMs: 60_000,
      });

      const key = 'test-ip-2';

      // First 3 requests allowed
      expect(rateLimiter.isRateLimited(key)).toBe(false);
      expect(rateLimiter.isRateLimited(key)).toBe(false);
      expect(rateLimiter.isRateLimited(key)).toBe(false);

      // 4th request blocked
      expect(rateLimiter.isRateLimited(key)).toBe(true);
      expect(rateLimiter.isRateLimited(key)).toBe(true);
    });

    it('should track different keys independently', () => {
      rateLimiter = new RateLimiter({
        maxRequests: 2,
        windowMs: 60_000,
      });

      const key1 = 'ip-1';
      const key2 = 'ip-2';

      // Exhaust key1's limit
      expect(rateLimiter.isRateLimited(key1)).toBe(false);
      expect(rateLimiter.isRateLimited(key1)).toBe(false);
      expect(rateLimiter.isRateLimited(key1)).toBe(true); // blocked

      // key2 should still work
      expect(rateLimiter.isRateLimited(key2)).toBe(false);
      expect(rateLimiter.isRateLimited(key2)).toBe(false);
      expect(rateLimiter.isRateLimited(key2)).toBe(true); // now blocked
    });
  });

  describe('getRemaining', () => {
    it('should return correct remaining count', () => {
      rateLimiter = new RateLimiter({
        maxRequests: 5,
        windowMs: 60_000,
      });

      const key = 'test-ip-3';

      expect(rateLimiter.getRemaining(key)).toBe(5);

      rateLimiter.isRateLimited(key);
      expect(rateLimiter.getRemaining(key)).toBe(4);

      rateLimiter.isRateLimited(key);
      rateLimiter.isRateLimited(key);
      expect(rateLimiter.getRemaining(key)).toBe(2);
    });

    it('should return 0 when over limit', () => {
      rateLimiter = new RateLimiter({
        maxRequests: 2,
        windowMs: 60_000,
      });

      const key = 'test-ip-4';

      rateLimiter.isRateLimited(key);
      rateLimiter.isRateLimited(key);
      rateLimiter.isRateLimited(key); // over limit

      expect(rateLimiter.getRemaining(key)).toBe(0);
    });
  });

  describe('reset', () => {
    it('should reset rate limit for a key', () => {
      rateLimiter = new RateLimiter({
        maxRequests: 2,
        windowMs: 60_000,
      });

      const key = 'test-ip-5';

      // Exhaust limit
      rateLimiter.isRateLimited(key);
      rateLimiter.isRateLimited(key);
      expect(rateLimiter.isRateLimited(key)).toBe(true);

      // Reset
      rateLimiter.reset(key);

      // Should work again
      expect(rateLimiter.isRateLimited(key)).toBe(false);
      expect(rateLimiter.getRemaining(key)).toBe(1);
    });
  });

  describe('window expiration', () => {
    it('should reset after window expires', async () => {
      rateLimiter = new RateLimiter({
        maxRequests: 2,
        windowMs: 100, // 100ms window for testing
      });

      const key = 'test-ip-6';

      // Exhaust limit
      rateLimiter.isRateLimited(key);
      rateLimiter.isRateLimited(key);
      expect(rateLimiter.isRateLimited(key)).toBe(true);

      // Wait for window to expire
      await new Promise(resolve => setTimeout(resolve, 150));

      // Should work again
      expect(rateLimiter.isRateLimited(key)).toBe(false);
    });
  });

  describe('factory functions', () => {
    it('createApiRateLimiter should create limiter with correct config', () => {
      const limiter = createApiRateLimiter();

      // Should allow 100 requests
      const key = 'api-test';
      for (let i = 0; i < 100; i++) {
        expect(limiter.isRateLimited(key)).toBe(false);
      }

      // 101st should be blocked
      expect(limiter.isRateLimited(key)).toBe(true);

      limiter.stop();
    });
  });
});

describe('Rate Limiting Security Tests', () => {
  let rateLimiter: RateLimiter;

  afterEach(() => {
    if (rateLimiter) {
      rateLimiter.stop();
    }
  });

  it('should prevent brute force attack simulation', () => {
    rateLimiter = new RateLimiter({
      maxRequests: 10,
      windowMs: 60_000,
    });

    const attackerIp = 'attacker-ip';
    let blockedRequests = 0;
    let allowedRequests = 0;

    // Simulate 100 rapid requests (brute force)
    for (let i = 0; i < 100; i++) {
      if (rateLimiter.isRateLimited(attackerIp)) {
        blockedRequests++;
      } else {
        allowedRequests++;
      }
    }

    // Should have blocked 90 of 100 requests
    expect(allowedRequests).toBe(10);
    expect(blockedRequests).toBe(90);
  });

  it('should not block legitimate users during attack', () => {
    rateLimiter = new RateLimiter({
      maxRequests: 10,
      windowMs: 60_000,
    });

    const attackerIp = 'attacker-ip';
    const legitimateIp = 'legitimate-ip';

    // Attacker exhausts their limit
    for (let i = 0; i < 20; i++) {
      rateLimiter.isRateLimited(attackerIp);
    }

    // Legitimate user should not be affected
    expect(rateLimiter.isRateLimited(legitimateIp)).toBe(false);
    expect(rateLimiter.getRemaining(legitimateIp)).toBe(9);
  });

  it('should handle many different IPs efficiently', () => {
    rateLimiter = new RateLimiter({
      maxRequests: 5,
      windowMs: 60_000,
    });

    // Simulate 1000 different IPs
    for (let i = 0; i < 1000; i++) {
      const ip = `ip-${i}`;
      expect(rateLimiter.isRateLimited(ip)).toBe(false);
    }

    // Each IP should have 4 remaining
    expect(rateLimiter.getRemaining('ip-0')).toBe(4);
    expect(rateLimiter.getRemaining('ip-999')).toBe(4);
  });
});
