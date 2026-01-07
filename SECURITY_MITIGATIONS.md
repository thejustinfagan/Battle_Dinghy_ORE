# Battle Dinghy Security Mitigations

This document tracks the implementation status of security mitigations identified during threat modeling.

## Implemented Mitigations

### A1: Reentrancy Guards (VERIFIED)

**Location:** `packages/contracts/programs/battle-dinghy/src/lib.rs`

**Status:** Already implemented. The Anchor contract follows the CEI (Checks-Effects-Interactions) pattern in critical functions like `declare_winner` and `claim_refund`.

**Key Points:**
- All state updates occur before external calls
- CPI (Cross-Program Invocation) to token programs happens last
- No callbacks that could re-enter the program

### E1: API Rate Limiting (IMPLEMENTED)

**Location:** `packages/server/src/rate-limiter.ts`

**Status:** Implemented with comprehensive test coverage.

**Features:**
- Sliding window rate limiting algorithm
- Per-IP request tracking
- Configurable limits for different endpoints:
  - General API: 100 requests/minute
  - Game creation: 5 games/hour
  - Join attempts: 20/minute
  - Webhooks: 1000/minute
  - Blinks: 50/minute
- Express middleware integration
- WebSocket support via `isRateLimited()` method

**Tests:** 11 tests in `packages/server/tests/rate-limiter.test.ts`

### D1: Sybil Prevention (IMPLEMENTED)

**Location:** `packages/server/src/sybil-prevention.ts`

**Status:** Implemented with comprehensive test coverage.

**Features:**
- Twitter account validation with configurable requirements:
  - Minimum account age (30 days default)
  - Minimum followers (5 default)
  - Minimum tweets (3 default)
  - Profile picture required
  - Bio required with minimum length
- Risk scoring system (0-100 scale)
- Wallet graph analysis for detecting connected wallets
- Cluster detection for suspicious wallet relationships

**Tests:** 20 tests in `packages/server/tests/sybil-prevention.test.ts`

### C1: Commit-Reveal Scheme (IMPLEMENTED)

**Location:** `packages/core/src/commit-reveal.ts`

**Status:** Implemented with comprehensive test coverage.

**Purpose:** Prevents operator from manipulating board generation seed.

**Protocol:**
1. **Commit Phase:** Each player submits `H(secret || wallet)` before seeing others
2. **Reveal Phase:** Players reveal their secrets, verified against commitments
3. **Finalize:** Final seed = `H(all_secrets || ore_block_hash)`

**Features:**
- `CommitRevealManager` class for server-side management
- `PlayerCommitmentHelper` class for client-side usage
- Deterministic seed computation with sorted player ordering
- Fallback to commitment hash if player doesn't reveal (prevents selective exclusion)
- Serialization/deserialization for state persistence
- Phase management with configurable timeouts

**Security Properties:**
- No single party (including operator) can predict the seed
- Non-revealing players still contribute entropy via their commitment hash
- ORE block hash adds external unpredictability

**Tests:** 40 tests in `packages/core/tests/commit-reveal.test.ts`

### C2: ORE Block Commitment (IMPLEMENTED)

**Location:** `packages/core/src/ore-block-commitment.ts`

**Status:** Implemented with comprehensive test coverage.

**Purpose:** Prevents operator from selectively choosing favorable ORE blocks.

**Protocol:**
1. **Before game starts:** Operator commits to a specific future ORE block height
2. **Commitment includes:** `H(gameId || targetBlockHeight || timestamp || operatorWallet)`
3. **After block is mined:** Anyone can verify commitment was made before mining
4. **Verification checks:**
   - Commitment was made before block was mined (with buffer time)
   - Commitment hash matches components
   - Block height matches commitment

**Features:**
- `OreBlockCommitmentManager` class for managing commitments
- Configurable minimum blocks ahead (default: 3)
- Configurable commitment buffer time (default: 30 seconds)
- Async waiting for committed block with polling
- Serialization/deserialization for persistence
- Mock factory for testing

**Security Properties:**
- Operator must commit BEFORE knowing block hash
- Late commitments (after block mined) are rejected
- Minimum blocks ahead prevents last-second commits
- Commitment hash is verifiable by anyone

**Integration with C1:**
```typescript
// 1. Operator commits to block before game
await oreManager.createCommitment(gameId, operatorWallet);

// 2. Players do commit-reveal (C1)
commitRevealManager.submitCommitment(wallet, hash);
// ... reveals ...

// 3. Wait for committed ORE block
const oreHash = await oreManager.waitForBlock(gameId);

// 4. Finalize with verified ORE hash
commitRevealManager.finalize(oreHash);
```

**Tests:** 37 tests in `packages/core/tests/ore-block-commitment.test.ts`

---

## Test Coverage Summary

| Mitigation | Test File | Tests |
|------------|-----------|-------|
| E1 Rate Limiting | `packages/server/tests/rate-limiter.test.ts` | 11 |
| D1 Sybil Prevention | `packages/server/tests/sybil-prevention.test.ts` | 20 |
| C1 Commit-Reveal | `packages/core/tests/commit-reveal.test.ts` | 40 |
| C2 ORE Block Commitment | `packages/core/tests/ore-block-commitment.test.ts` | 37 |

**Total: 108 security-focused tests**

## Running Security Tests

```bash
# Run all tests
pnpm test

# Run specific security test suites
cd packages/server && pnpm test rate-limiter
cd packages/server && pnpm test sybil-prevention
cd packages/core && pnpm test commit-reveal
cd packages/core && pnpm test ore-block-commitment
```

## Security Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                     GAME FLOW WITH SECURITY                      │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  1. GAME CREATION                                               │
│     ├── D1: Sybil check on players (Twitter validation)        │
│     ├── E1: Rate limit game creation (5/hour)                  │
│     └── C2: Operator commits to future ORE block               │
│                                                                  │
│  2. PLAYER JOIN                                                 │
│     ├── D1: Sybil check (wallet graph + Twitter)               │
│     ├── E1: Rate limit joins (20/min)                          │
│     └── C1: Player submits commitment H(secret || wallet)      │
│                                                                  │
│  3. GAME START                                                  │
│     ├── C1: Transition to reveal phase                         │
│     └── C1: Players reveal secrets, verified against commits   │
│                                                                  │
│  4. SEED FINALIZATION                                           │
│     ├── C2: Wait for committed ORE block                       │
│     ├── C2: Verify commitment was before block mining          │
│     └── C1: Compute seed = H(secrets || ore_hash)              │
│                                                                  │
│  5. GAME PLAY                                                   │
│     ├── E1: Rate limit all API calls                           │
│     └── A1: Reentrancy guards on prize claims                  │
│                                                                  │
│  6. PRIZE DISTRIBUTION                                          │
│     └── A1: CEI pattern in declare_winner/claim_refund         │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Attack Vectors Mitigated

| Attack | Mitigation | Status |
|--------|------------|--------|
| Operator predicts seed | C1 + C2 | Mitigated |
| Operator selects favorable ORE block | C2 | Mitigated |
| Sybil attack (multiple fake players) | D1 | Mitigated |
| API abuse / DoS | E1 | Mitigated |
| Reentrancy on prize claim | A1 | Verified |
| Player exclusion from seed | C1 (fallback to commitment hash) | Mitigated |
