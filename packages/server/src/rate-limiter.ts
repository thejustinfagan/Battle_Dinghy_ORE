// Battle Dinghy - Rate Limiter
//
// Security mitigation E1: Prevents API abuse and DoS attacks.
// Uses a sliding window algorithm for accurate rate limiting.

import { Request, Response, NextFunction, RequestHandler } from 'express';

// =============================================================================
// Types
// =============================================================================

export interface RateLimitConfig {
  /** Maximum requests allowed in the window */
  maxRequests: number;
  /** Time window in milliseconds */
  windowMs: number;
  /** Optional key generator function (default: IP address) */
  keyGenerator?: (req: Request) => string;
  /** Message to return when rate limited */
  message?: string;
  /** Skip rate limiting for certain requests */
  skip?: (req: Request) => boolean;
}

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

// =============================================================================
// Rate Limiter Class
// =============================================================================

export class RateLimiter {
  private store: Map<string, RateLimitEntry> = new Map();
  private readonly config: Required<RateLimitConfig>;
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor(config: RateLimitConfig) {
    this.config = {
      maxRequests: config.maxRequests,
      windowMs: config.windowMs,
      keyGenerator: config.keyGenerator ?? this.defaultKeyGenerator,
      message: config.message ?? 'Too many requests, please try again later',
      skip: config.skip ?? (() => false),
    };

    // Clean up expired entries every minute
    this.cleanupInterval = setInterval(() => this.cleanup(), 60_000);
  }

  /**
   * Express middleware handler
   */
  middleware(): RequestHandler {
    return (req: Request, res: Response, next: NextFunction): void => {
      // Skip if configured
      if (this.config.skip(req)) {
        next();
        return;
      }

      const key = this.config.keyGenerator(req);
      const now = Date.now();
      const entry = this.store.get(key);

      // Check if window has expired
      if (!entry || now >= entry.resetAt) {
        // Start new window
        this.store.set(key, {
          count: 1,
          resetAt: now + this.config.windowMs,
        });
        this.setHeaders(res, 1);
        next();
        return;
      }

      // Increment counter
      entry.count++;

      // Check if over limit
      if (entry.count > this.config.maxRequests) {
        this.setHeaders(res, entry.count);
        res.status(429).json({
          error: 'RATE_LIMITED',
          message: this.config.message,
          retryAfter: Math.ceil((entry.resetAt - now) / 1000),
        });
        return;
      }

      this.setHeaders(res, entry.count);
      next();
    };
  }

  /**
   * Check if a key is rate limited (for WebSocket)
   */
  isRateLimited(key: string): boolean {
    const now = Date.now();
    const entry = this.store.get(key);

    if (!entry || now >= entry.resetAt) {
      this.store.set(key, {
        count: 1,
        resetAt: now + this.config.windowMs,
      });
      return false;
    }

    entry.count++;
    return entry.count > this.config.maxRequests;
  }

  /**
   * Get remaining requests for a key
   */
  getRemaining(key: string): number {
    const entry = this.store.get(key);
    if (!entry || Date.now() >= entry.resetAt) {
      return this.config.maxRequests;
    }
    return Math.max(0, this.config.maxRequests - entry.count);
  }

  /**
   * Reset rate limit for a key
   */
  reset(key: string): void {
    this.store.delete(key);
  }

  /**
   * Stop the cleanup interval
   */
  stop(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  // ===========================================================================
  // Private Methods
  // ===========================================================================

  private defaultKeyGenerator(req: Request): string {
    // Use X-Forwarded-For header if behind proxy, otherwise remote address
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string') {
      return forwarded.split(',')[0].trim();
    }
    return req.ip || req.socket.remoteAddress || 'unknown';
  }

  private setHeaders(res: Response, count: number): void {
    res.setHeader('X-RateLimit-Limit', this.config.maxRequests);
    res.setHeader('X-RateLimit-Remaining', Math.max(0, this.config.maxRequests - count));
  }

  private cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.store) {
      if (now >= entry.resetAt) {
        this.store.delete(key);
      }
    }
  }
}

// =============================================================================
// Pre-configured Rate Limiters
// =============================================================================

/**
 * General API rate limiter: 100 requests per minute per IP
 */
export function createApiRateLimiter(): RateLimiter {
  return new RateLimiter({
    maxRequests: 100,
    windowMs: 60_000, // 1 minute
    message: 'Too many API requests, please try again later',
  });
}

/**
 * Game creation rate limiter: 5 games per hour per IP
 * Prevents spam game creation
 */
export function createGameCreationRateLimiter(): RateLimiter {
  return new RateLimiter({
    maxRequests: 5,
    windowMs: 3600_000, // 1 hour
    message: 'Too many games created, please try again later',
  });
}

/**
 * Join game rate limiter: 20 joins per minute per IP
 * Prevents rapid-fire join attempts
 */
export function createJoinRateLimiter(): RateLimiter {
  return new RateLimiter({
    maxRequests: 20,
    windowMs: 60_000, // 1 minute
    message: 'Too many join attempts, please try again later',
  });
}

/**
 * Webhook rate limiter: 1000 requests per minute
 * Higher limit for legitimate webhook traffic
 */
export function createWebhookRateLimiter(): RateLimiter {
  return new RateLimiter({
    maxRequests: 1000,
    windowMs: 60_000, // 1 minute
    message: 'Webhook rate limit exceeded',
    keyGenerator: (req) => {
      // Rate limit by webhook source, not individual IP
      return req.headers['x-webhook-source']?.toString() || 'default';
    },
  });
}

/**
 * Blinks rate limiter: 50 requests per minute per IP
 * Moderate limit for Solana Actions
 */
export function createBlinksRateLimiter(): RateLimiter {
  return new RateLimiter({
    maxRequests: 50,
    windowMs: 60_000, // 1 minute
    message: 'Too many Blink requests, please try again later',
  });
}

// =============================================================================
// Exports
// =============================================================================

export default RateLimiter;
