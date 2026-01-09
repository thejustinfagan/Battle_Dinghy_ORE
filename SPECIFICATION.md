# Battle Dinghy ORE - Complete Technical Specification

**Version:** 1.0
**Last Updated:** January 2026
**Repository:** https://github.com/thejustinfagan/Battle_Dinghy_ORE
**Production URL:** https://battledinghyore-production.up.railway.app

---

## Table of Contents

1. [Executive Summary](#1-executive-summary)
2. [Functional Specification](#2-functional-specification)
3. [Technical Architecture](#3-technical-architecture)
4. [Tech Stack](#4-tech-stack)
5. [Data Models](#5-data-models)
6. [API Reference](#6-api-reference)
7. [Game Engine Logic](#7-game-engine-logic)
8. [ORE Mining Integration](#8-ore-mining-integration)
9. [Security Model](#9-security-model)
10. [Deployment & Infrastructure](#10-deployment--infrastructure)
11. [Current Status & Known Issues](#11-current-status--known-issues)
12. [Future Development Areas](#12-future-development-areas)

---

## 1. Executive Summary

### What is Battle Dinghy ORE?

Battle Dinghy ORE is a **multiplayer Battleship game** built on Solana blockchain that uses the **ORE mining protocol** for provably fair randomness. Players pay a SOL entry fee to join, and the last player standing wins the entire prize pool plus any ORE mined during gameplay.

### Core Value Proposition

- **Provably Fair:** Game outcomes are determined by ORE blockchain mining, not a central server
- **Winner-Takes-All:** Entry fees pool together; last survivor wins everything
- **Twitter-Integrated:** Games are announced and played via Twitter with deep wallet integration
- **Automated:** From payment to payout, the entire game runs autonomously

### High-Level Flow

```
1. Admin creates game via dashboard → Sets entry fee, max players, deadline
2. Game announced on Twitter with join link
3. Players click link → Opens join page → Connects Solana wallet → Pays entry fee
4. When full OR deadline reached → Game auto-starts
5. ORE mining generates random coordinates → All players hit simultaneously
6. Ships sink → Players eliminated → Last player wins
7. Prize pool + ORE automatically paid to winner
```

---

## 2. Functional Specification

### 2.1 User Roles

| Role | Capabilities |
|------|-------------|
| **Admin** | Create games, configure parameters, post to Twitter, view active games, trigger payouts |
| **Player** | View game info, connect wallet, pay entry fee, join game, receive winnings |
| **Spectator** | View game status (future feature) |

### 2.2 Game Lifecycle States

```
waiting → active → complete
    ↓
cancelled
```

| State | Description |
|-------|-------------|
| `waiting` | Accepting players, not yet started |
| `active` | Game in progress, ORE mining active |
| `complete` | Winner determined, payouts processed |
| `cancelled` | Game cancelled, refunds issued |

### 2.3 Core Features

#### 2.3.1 Game Creation (Admin)

**Inputs:**
- Entry Fee: Minimum 0.0001 SOL
- Max Players: 2-100 players
- Fill Deadline: 15min, 30min, 1hr, 2hr, 4hr, 8hr, 24hr
- Custom Message: Optional tweet text

**Outputs:**
- Unique Game ID (format: `BD-{timestamp_base36}`)
- Twitter announcement with join link
- Game stored in memory with parameters

#### 2.3.2 Player Join Flow

```
┌─────────────────────────────────────────────────────────────┐
│  1. User clicks tweet link                                  │
│     ↓                                                       │
│  2. Opens /join/:gameId page                                │
│     ↓                                                       │
│  3. Page shows: Game ID, Buy-in, Players, Spots Left        │
│     ↓                                                       │
│  4. User clicks "Open in Phantom" or "Open in Solflare"     │
│     ↓                                                       │
│  5. Wallet app opens with Blinks action                     │
│     ↓                                                       │
│  6. User approves SOL transfer to escrow                    │
│     ↓                                                       │
│  7. Transaction confirmed → Player added to game            │
└─────────────────────────────────────────────────────────────┘
```

#### 2.3.3 Game Auto-Start Conditions

Game starts when ANY of these conditions are met:
1. Max players reached
2. Fill deadline expires (with at least 2 players)
3. Admin manually triggers start

#### 2.3.4 Gameplay Mechanics

**Grid:** 5x5 board (cells A1-E5, indexed 0-24)

**Ships per Player:**
| Ship Name | Size | Cells |
|-----------|------|-------|
| Big Dinghy | 3 | 3 |
| Dinghy | 2 | 2 |
| Small Dinghy | 1 | 1 |
| **Total HP** | - | **6** |

**Round Execution:**
1. ORE mining produces block hash
2. Hash converted to coordinate: `BigInt(hash) % 25 → row/col`
3. Shot fired at that coordinate for ALL players simultaneously
4. Hits/misses/sinks calculated
5. Players with all ships sunk are eliminated
6. Continue until 1 player remains

**Sudden Death (if game stalls):**
- Round 31+: Additional random shot per round
- Round 41+: Two additional shots per round
- Max 50 rounds total

### 2.4 Prize Distribution

```
Prize Pool = (Entry Fee × Number of Players)
Platform Fee = 5% (configurable)
Winner Payout = Prize Pool - Platform Fee + Mined ORE
```

### 2.5 Admin Dashboard Features

**URL:** `/admin`

| Feature | Description |
|---------|-------------|
| Create Game | Form to set parameters and post tweet |
| Tweet Preview | See tweet text before posting |
| Active Games | List all games with status |
| System Status | Twitter config, server health |
| Payout Management | Manual payout triggers |

---

## 3. Technical Architecture

### 3.1 System Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                           CLIENTS                                    │
├─────────────────────────────────────────────────────────────────────┤
│  Twitter App    │    Join Page     │    Admin Dashboard              │
│  (Tweet Links)  │   (/join/:id)    │      (/admin)                   │
└────────┬────────┴────────┬─────────┴────────┬───────────────────────┘
         │                 │                   │
         │    HTTPS        │      HTTPS        │      HTTPS
         ▼                 ▼                   ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      EXPRESS SERVER                                  │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐                  │
│  │  Blinks     │  │  API        │  │  Admin      │                  │
│  │  Routes     │  │  Routes     │  │  Routes     │                  │
│  │ /blinks/*   │  │ /api/*      │  │ /api/admin/*│                  │
│  └──────┬──────┘  └──────┬──────┘  └──────┬──────┘                  │
│         │                │                 │                         │
│  ┌──────┴────────────────┴─────────────────┴──────┐                 │
│  │              GAME MANAGER                       │                 │
│  │  - Game state (in-memory Map)                  │                 │
│  │  - Player management                           │                 │
│  │  - Event emitter                               │                 │
│  └──────────────────────┬─────────────────────────┘                 │
│                         │                                            │
│  ┌──────────────────────┴─────────────────────────┐                 │
│  │           GAME ENGINE (Core)                    │                 │
│  │  - Card generator (deterministic PRNG)         │                 │
│  │  - Shot processing                             │                 │
│  │  - Elimination logic                           │                 │
│  └──────────────────────┬─────────────────────────┘                 │
│                         │                                            │
│  ┌──────────────────────┴─────────────────────────┐                 │
│  │         ORE ACTIVE MINING SERVICE               │                 │
│  │  - Deploy SOL to ORE blocks                    │                 │
│  │  - Monitor for block completion                │                 │
│  │  - Checkpoint & claim rewards                  │                 │
│  └──────────────────────┬─────────────────────────┘                 │
└─────────────────────────┼───────────────────────────────────────────┘
                          │
         ┌────────────────┼────────────────┐
         │                │                │
         ▼                ▼                ▼
┌─────────────┐  ┌─────────────┐  ┌─────────────┐
│   Solana    │  │   Twitter   │  │  WebSocket  │
│   RPC       │  │   API v2    │  │   Clients   │
│ (Mainnet)   │  │             │  │             │
└─────────────┘  └─────────────┘  └─────────────┘
```

### 3.2 Directory Structure

```
battle_dinghys_ore/
├── packages/
│   ├── core/                    # Core game engine (npm package)
│   │   └── src/
│   │       ├── game-engine.ts   # Game state machine
│   │       ├── card-generator.ts # Deterministic ship placement
│   │       ├── ore-monitor.ts   # ORE interface (mock included)
│   │       └── types.ts         # Core types
│   │
│   ├── server/                  # Server package
│   │   └── src/
│   │       ├── index.ts         # Express app entry point
│   │       ├── routes.ts        # API routes
│   │       ├── game-manager.ts  # Game state management
│   │       ├── blinks.ts        # Solana Blinks integration
│   │       ├── twitter-bot.ts   # Twitter API integration
│   │       ├── admin-routes.ts  # Admin API endpoints
│   │       ├── orchestrator.ts  # Game lifecycle automation
│   │       ├── ore-integration.ts # ORE protocol integration
│   │       ├── rate-limiter.ts  # API rate limiting
│   │       ├── webhooks.ts      # Webhook handlers
│   │       ├── public/
│   │       │   ├── admin.html   # Admin dashboard UI
│   │       │   └── join.html    # Player join page UI
│   │       └── types.ts         # Server types
│   │
│   └── contracts/               # Solana smart contracts (Rust/Anchor)
│       └── programs/
│           └── battle-dinghy/
│               └── src/lib.rs   # Escrow contract
│
├── server/                      # Legacy server directory (being migrated)
├── client/                      # React frontend (optional)
├── shared/                      # Shared schemas
├── Dockerfile                   # Container build
├── railway.json                 # Railway deployment config
└── pnpm-workspace.yaml          # Monorepo config
```

### 3.3 Key Components

#### GameManager (`game-manager.ts`)
- Manages all active games in memory (Map<gameId, ManagedGame>)
- Handles game creation, player joins, game starts
- Emits events for game state changes
- Integrates with GameEngine for core logic

#### GameEngine (`packages/core/game-engine.ts`)
- Stateless game logic processor
- Processes ORE round results into shots
- Calculates hits, sinks, eliminations
- Determines winner

#### TwitterBot (`twitter-bot.ts`)
- Posts game announcements
- Generates tweet previews
- Uses Twitter API v2 with OAuth 1.0a

#### BlinksRoutes (`blinks.ts`)
- Implements Solana Actions spec
- Returns action metadata for wallets
- Creates payment transactions
- Verifies buy-in transactions

#### OreActiveMiningService (`ore-integration.ts`)
- Manages active ORE mining during games
- Currently uses OreMonitorMock for simulation
- Future: Real ORE protocol integration

---

## 4. Tech Stack

### 4.1 Backend

| Technology | Version | Purpose |
|------------|---------|---------|
| **Node.js** | 18+ | Runtime environment |
| **TypeScript** | 5.6.3 | Type-safe JavaScript |
| **Express.js** | 4.21 | HTTP server framework |
| **WebSocket (ws)** | 8.18 | Real-time communication |
| **@solana/web3.js** | 1.95 | Solana blockchain SDK |
| **twitter-api-v2** | 1.17 | Twitter integration |
| **canvas** | 2.11.2 | Image generation |

### 4.2 Frontend (Join Page & Admin)

| Technology | Purpose |
|------------|---------|
| **Vanilla HTML/CSS/JS** | Static pages served by Express |
| **Tailwind-inspired CSS** | Styling |
| **Fetch API** | HTTP requests |

### 4.3 Blockchain

| Technology | Purpose |
|------------|---------|
| **Solana** | Payment processing, escrow |
| **ORE Protocol v3** | Provably fair randomness |
| **Solana Actions (Blinks)** | Wallet deep linking |

### 4.4 Infrastructure

| Technology | Purpose |
|------------|---------|
| **Railway** | Cloud hosting |
| **Docker** | Containerization |
| **pnpm** | Package management |
| **GitHub** | Version control |

### 4.5 Development Tools

| Tool | Purpose |
|------|---------|
| **Vitest** | Unit testing |
| **tsx** | TypeScript execution |
| **ESLint** | Code linting |

---

## 5. Data Models

### 5.1 Core Types

```typescript
// Game Status
type GameStatus = 'waiting' | 'active' | 'complete' | 'cancelled';

// Managed Game (in-memory)
interface ManagedGame {
  gameId: string;
  config: GameConfig;
  status: GameStatus;
  players: Set<string>;        // Wallet addresses
  spectators: Set<WebSocket>;
  createdAt: number;
  startedAt: number | null;
  completedAt: number | null;
  maxPlayers: number;
  buyInSol: number;
}

// Game Status Response (API)
interface GameStatusResponse {
  gameId: string;
  status: GameStatus;
  players: string[];
  currentRound: number;
  maxPlayers: number;
  buyInSol: number;
  winner: string | null;
  startedAt: number | null;
  completedAt: number | null;
}

// Player Card
interface PlayerCard {
  playerId: string;
  ships: ShipPlacement[];
  hits: Set<CellIndex>;
  isEliminated: boolean;
}

// Ship Placement
interface ShipPlacement {
  size: number;           // 1, 2, or 3
  cells: CellIndex[];     // Array of cell indices (0-24)
}

// Cell Index
type CellIndex = number;  // 0-24 for 5x5 grid
```

### 5.2 API Request/Response Types

```typescript
// Create Game Request (Admin)
interface CreateAndPostRequest {
  entryFeeSol: number;      // Minimum 0.0001
  maxPlayers: number;       // 2-100
  fillDeadlineMinutes?: number;
  customMessage?: string;
}

// Create Game Response
interface CreateAndPostResponse {
  success: boolean;
  gameId?: string;
  tweetId?: string;
  tweetUrl?: string;
  error?: string;
}

// Join Game Request
interface JoinGameRequest {
  gameId: string;
  playerWallet: string;
}

// Blinks Action Response (Solana Actions spec)
interface ActionGetResponse {
  type: 'action';
  icon: string;
  title: string;
  description: string;
  label: string;
  links?: {
    actions: ActionLink[];
  };
  disabled?: boolean;
  error?: ActionError;
}
```

---

## 6. API Reference

### 6.1 Public Endpoints

#### GET /api/games
List all active games.

**Response:**
```json
{
  "games": [
    {
      "gameId": "BD-MK6G0U1L",
      "status": "waiting",
      "players": [],
      "currentRound": 0,
      "maxPlayers": 10,
      "buyInSol": 0.001,
      "winner": null,
      "startedAt": null,
      "completedAt": null
    }
  ]
}
```

#### GET /api/games/:gameId
Get specific game status.

**Response:** Single `GameStatusResponse` object

#### GET /blinks/join/:gameId
Get Solana Actions metadata for wallet rendering.

**Response:** `ActionGetResponse` (Solana Actions spec)

#### POST /blinks/join/:gameId
Execute join transaction.

**Request:**
```json
{
  "account": "base58_wallet_address"
}
```

**Response:**
```json
{
  "transaction": "base64_encoded_transaction",
  "message": "Joining Battle Dinghy game: BD-MK6G0U1L"
}
```

### 6.2 Admin Endpoints

#### GET /api/admin/status
Get system status.

**Response:**
```json
{
  "twitter": {
    "configured": true,
    "hasApiKey": true,
    "hasApiSecret": true,
    "hasAccessToken": true,
    "hasAccessSecret": true
  },
  "server": {
    "baseUrl": "https://battledinghyore-production.up.railway.app",
    "uptime": 3600
  }
}
```

#### POST /api/admin/preview-tweet
Preview tweet before posting.

**Request:**
```json
{
  "entryFeeSol": 0.001,
  "maxPlayers": 10,
  "fillDeadlineMinutes": 60,
  "customMessage": "First game of the day!"
}
```

**Response:**
```json
{
  "text": "First game of the day!\n\n⚓ BATTLE DINGHY ⚓\n\n💰 Buy-in: 0.001 SOL\n👥 Max Players: 10\n⏰ Starts in: 1 hour\n🏆 Winner takes all!\n\nJoin the battle 👇\n\nhttps://battledinghyore-production.up.railway.app/join/GAME_ID",
  "characterCount": 180,
  "blinkUrl": "https://battledinghyore-production.up.railway.app/join/GAME_ID"
}
```

#### POST /api/admin/games/create-and-post
Create game and post to Twitter.

**Request:**
```json
{
  "entryFeeSol": 0.001,
  "maxPlayers": 10,
  "fillDeadlineMinutes": 60,
  "customMessage": "Let's play!"
}
```

**Response:**
```json
{
  "success": true,
  "gameId": "BD-MK6G0U1L",
  "tweetId": "1234567890",
  "tweetUrl": "https://twitter.com/battle_dinghy/status/1234567890"
}
```

#### GET /api/admin/games
List all games with admin details.

### 6.3 Static Pages

| Route | File | Description |
|-------|------|-------------|
| `/admin` | `public/admin.html` | Admin dashboard |
| `/join/:gameId` | `public/join.html` | Player join page |

---

## 7. Game Engine Logic

### 7.1 Deterministic Card Generation

The card generator uses a **seeded PRNG (xorshift128+)** to ensure:
- Same seed = identical board layout
- Any party can verify board was generated fairly
- No server manipulation possible

```typescript
// Seed derivation
const seed = SHA256(gameId + playerWallet + oreMasterSeed);

// PRNG state
let s0: bigint, s1: bigint;  // 128-bit state

// Generate random number
function xorshift128plus(): bigint {
  let t = s0;
  const s = s1;
  s0 = s;
  t ^= t << 23n;
  t ^= t >> 17n;
  t ^= s ^ (s >> 26n);
  s1 = t;
  return (t + s) & ((1n << 64n) - 1n);
}
```

### 7.2 Ship Placement Algorithm

```typescript
function generateCard(seed: Uint8Array): GeneratedCard {
  const prng = new SeededPRNG(seed);
  const ships: ShipPlacement[] = [];
  const occupiedCells = new Set<number>();

  // Place ships in order: 3-cell, 2-cell, 1-cell
  for (const size of [3, 2, 1]) {
    let placed = false;
    while (!placed) {
      const startCell = prng.nextInt(25);
      const horizontal = prng.nextBool();

      const cells = calculateShipCells(startCell, size, horizontal);
      if (isValidPlacement(cells, occupiedCells)) {
        ships.push({ size, cells });
        cells.forEach(c => occupiedCells.add(c));
        placed = true;
      }
    }
  }

  return { ships, allCells: Array.from(occupiedCells) };
}
```

### 7.3 Shot Processing

```typescript
function oreHashToCoordinate(blockHash: string): CellIndex {
  const hashBigInt = BigInt('0x' + blockHash);
  return Number(hashBigInt % 25n);  // 0-24
}

function processShot(players: PlayerCard[], cell: CellIndex): ShotResult[] {
  return players.map(player => {
    if (player.isEliminated) return { hit: false };

    const hit = player.ships.some(ship => ship.cells.includes(cell));
    if (hit) {
      player.hits.add(cell);

      // Check for sunk ships
      const sunkShip = player.ships.find(ship =>
        ship.cells.every(c => player.hits.has(c))
      );

      // Check for elimination
      const allSunk = player.ships.every(ship =>
        ship.cells.every(c => player.hits.has(c))
      );

      if (allSunk) player.isEliminated = true;

      return { hit: true, sunk: sunkShip?.size, eliminated: allSunk };
    }

    return { hit: false };
  });
}
```

---

## 8. ORE Mining Integration

### 8.1 Current Implementation

The system currently uses `OreMonitorMock` which simulates ORE mining:
- Generates random block hashes on a timer
- Triggers game rounds at configurable intervals
- No actual SOL/ORE is mined

### 8.2 Future Real ORE Integration

When connected to real ORE protocol:

```
Round Cycle:
1. Deploy SOL to ORE program (multiple blocks)
2. Wait for block mining (~60 seconds)
3. Monitor for winning block hash
4. Checkpoint transaction (claim mining reward)
5. ClaimSOL transaction (recover deployed SOL)
6. Use block hash for game shot
7. Repeat for 25 rounds
```

**ORE Program Constants:**
```typescript
const ORE_PROGRAM_ID = "oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv";
const ORE_TOKEN_MINT = "oreoU2P8bN6jkk3jbaiVxYnG1dCXcYxwhwyK9jSybcp";
```

### 8.3 Mining Service Interface

```typescript
interface OreActiveMiningService {
  startMining(gameId: string, prizePoolLamports: number): Promise<void>;
  stopMining(gameId: string): Promise<void>;
  isInitialized(): boolean;
  getActiveMiner(gameId: string): OreActiveMiner | undefined;
}
```

---

## 9. Security Model

### 9.1 Race Condition Prevention

**Problem:** Multiple requests could start the same game twice.

**Solution:** Mutex lock using Set:
```typescript
const gamesBeingStarted = new Set<string>();

async function startGame(gameId: string) {
  if (gamesBeingStarted.has(gameId)) {
    return { error: "Game start already in progress" };
  }
  gamesBeingStarted.add(gameId);
  try {
    // Start game logic
  } finally {
    gamesBeingStarted.delete(gameId);
  }
}
```

### 9.2 Prize Pool Safety

**Problem:** ORE mining could result in loss, leaving insufficient funds.

**Solution:** Balance check before payout:
```typescript
async function finalizeGame() {
  const escrowBalance = await connection.getBalance(escrowPubkey);
  const availableBalance = escrowBalance - RENT_EXEMPT_MIN;

  if (availableBalance < expectedPayout) {
    console.warn("PRIZE SHORTFALL - paying available balance");
    actualPayout = availableBalance - platformFee;
  }
}
```

### 9.3 Rate Limiting

```typescript
// API: 100 requests/minute per IP
// Blinks: 50 requests/minute per IP
// Webhooks: 200 requests/minute per IP
```

### 9.4 Input Validation

- Entry fee minimum: 0.0001 SOL
- Max players: 2-100
- Game ID format validation
- Wallet address validation

---

## 10. Deployment & Infrastructure

### 10.1 Environment Variables

```bash
# Server
PORT=3001
HOST=0.0.0.0
NODE_ENV=production
BASE_URL=https://battledinghyore-production.up.railway.app

# Solana
SOLANA_RPC=https://api.mainnet-beta.solana.com
SOLANA_NETWORK=mainnet-beta
ESCROW_WALLET=<base58_private_key>

# Twitter
TWITTER_APP_KEY=<api_key>
TWITTER_APP_SECRET=<api_secret>
TWITTER_ACCESS_TOKEN=<access_token>
TWITTER_ACCESS_SECRET=<access_secret>
```

### 10.2 Railway Configuration

**railway.json:**
```json
{
  "build": {
    "builder": "DOCKERFILE"
  },
  "deploy": {
    "startCommand": "node packages/server/dist/index.js",
    "healthcheckPath": "/api/health"
  }
}
```

### 10.3 Build Process

```bash
# Install dependencies
pnpm install

# Build all packages
pnpm run build

# Build server specifically
cd packages/server && pnpm run build

# Build copies HTML files to dist
# dist/public/admin.html
# dist/public/join.html
```

---

## 11. Current Status & Known Issues

### 11.1 Working Features

- [x] Admin dashboard at `/admin`
- [x] Game creation with parameters
- [x] Twitter posting with announcements
- [x] Join page at `/join/:gameId`
- [x] Solana Blinks integration
- [x] Game state management
- [x] WebSocket real-time updates
- [x] Rate limiting

### 11.2 Known Issues

1. **Phantom Deep Links:** The `https://phantom.app/ul/browse/` format may not work correctly on all devices. Users may need to copy the Blinks URL manually.

2. **Game Persistence:** Games are stored in memory only. Server restart loses all games.

3. **ORE Mining:** Currently simulated with `OreMonitorMock`. Real ORE integration pending.

4. **Escrow:** Escrow wallet needs to be funded with SOL for prize payouts.

### 11.3 Recently Fixed

- Added per-game `maxPlayers` and `buyInSol` storage
- Fixed race conditions in game auto-start
- Added balance check before payouts
- Fixed join page Phantom/Solflare links

---

## 12. Future Development Areas

### 12.1 Immediate Priorities

1. **Fix Phantom Deep Links** - Research and implement correct universal link format
2. **Game Persistence** - Add database storage for games
3. **Real ORE Integration** - Connect to actual ORE mining protocol
4. **Escrow Management** - Admin tools to fund/withdraw escrow

### 12.2 Feature Roadmap

1. **Spectator Mode** - Watch games in progress
2. **Game History** - View past games and results
3. **Player Stats** - Track wins/losses per wallet
4. **Tournament Mode** - Multi-game tournaments
5. **Mobile App** - Native iOS/Android apps
6. **Discord Integration** - Announce games to Discord

### 12.3 Technical Debt

1. Migrate legacy `/server` code to `packages/server`
2. Add comprehensive test coverage
3. Implement proper error handling throughout
4. Add request logging and monitoring
5. Set up CI/CD pipeline

---

## Appendix A: File Reference

### Core Files

| File | Lines | Description |
|------|-------|-------------|
| `packages/server/src/index.ts` | ~220 | Express app setup |
| `packages/server/src/game-manager.ts` | ~300 | Game state management |
| `packages/server/src/blinks.ts` | ~300 | Solana Actions |
| `packages/server/src/twitter-bot.ts` | ~450 | Twitter integration |
| `packages/server/src/admin-routes.ts` | ~280 | Admin API |
| `packages/server/src/types.ts` | ~140 | Type definitions |
| `packages/core/src/game-engine.ts` | ~400 | Core game logic |
| `packages/core/src/card-generator.ts` | ~200 | Board generation |

### Static Files

| File | Description |
|------|-------------|
| `public/admin.html` | Admin dashboard UI |
| `public/join.html` | Player join page |

---

## Appendix B: Quick Start for New Developers

```bash
# Clone repository
git clone https://github.com/thejustinfagan/Battle_Dinghy_ORE.git
cd battle_dinghys_ore

# Install dependencies
pnpm install

# Set environment variables
cp .env.example .env
# Edit .env with your values

# Build
pnpm run build

# Run development server
cd packages/server && pnpm run dev

# Access
# Admin: http://localhost:3001/admin
# API: http://localhost:3001/api/games
```

---

*This specification is intended for sharing with other LLMs or developers to understand the Battle Dinghy ORE system and build additional functionality.*
