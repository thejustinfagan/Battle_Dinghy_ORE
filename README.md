# 🚢 Battle Dinghy

A Twitter-native Battleship elimination game where 35-50 players compete simultaneously using Solana Blinks for entry and ORE mining for provably fair randomness.

## Game Overview

Battle Dinghy is a unique elimination-style lottery game that runs entirely on Twitter:

- **35-50 players** compete simultaneously in each game
- Players pay entry fee via **Solana Blink** embedded in tweets
- Each player receives a randomized **5×5 Battleship board** with 3 ships
- **ORE mining protocol** generates 25 random coordinates over ~25 minutes
- Each coordinate is fired at ALL players simultaneously
- **Last player with unsunk ships wins** the prize pool + mined ORE

## Core Features

### Twitter Integration
- Bot account: `@battle_dinghy`
- API master: `@thejustinfagan`
- All gameplay happens in public Twitter threads
- Players receive boards via @mentions
- Real-time shot announcements with hit notifications

### Solana Blockchain
- One-click entry via Solana Blinks
- Prize pool escrow on-chain
- Automated winner payouts
- Transaction signatures tracked

### ORE Mining Randomness
- Provably fair coordinate generation
- ORE block hashes converted to grid positions
- 25 shots = 25 ORE blocks
- Transparent, verifiable randomness

## Fleet Configuration

Each player receives 3 ships:

| Ship | Size | HP | Symbol |
|------|------|----|----|
| Big Dinghy | 3 squares | 3 HP | 🔵🔵🔵 |
| Dinghy | 2 squares | 2 HP | 🔵🔵 |
| Small Dinghy | 1 square | 1 HP | 🔵 |

**Total: 6 HP per player**

## API Endpoints

### Game Management
- `POST /api/games/create` - Create a new game
- `POST /api/games/:gameId/start` - Start game and post to Twitter
- `POST /api/games/:gameId/fire-shot` - Fire a shot using ORE hash
- `GET /api/games/:gameId` - Get game status

### Player Actions
- `POST /api/games/:gameId/join` - Join game after payment
- `GET /api/blink/game/:gameId` - Solana Blink metadata

## Environment Variables

### Required - Twitter Bot
```bash
TWITTER_API_KEY=your_api_key
TWITTER_API_SECRET=your_api_secret
TWITTER_ACCESS_TOKEN=your_access_token
TWITTER_ACCESS_SECRET=your_access_secret
```

### Required - Solana & ORE
```bash
SOLANA_RPC_URL=https://api.mainnet-beta.solana.com
ORE_PROGRAM_ID=<actual_ore_program_id>
ESCROW_WALLET_SECRET=<json_array_of_keypair>
```

### Required - Admin Authentication (Production Only)
```bash
ADMIN_API_KEY=your_secure_admin_key
```
**Note**: In development (`NODE_ENV=development`), localhost requests are automatically authorized. In production, all admin endpoints require the `x-admin-api-key` header.

### Database (Auto-configured)
```bash
DATABASE_URL=postgresql://...
```

## Security Features

- **Admin Authentication**: All administrative endpoints require `x-admin-api-key` header
- **Transactional Player Joins**: Atomic database transactions prevent race conditions
- **Payment Verification**: Solana transaction verification before player creation
- **Duplicate Prevention**: Wallet and Twitter handle uniqueness per game
- **Input Validation**: Zod schema validation on all endpoints

## Tech Stack

### Backend
- Node.js + Express
- TypeScript
- PostgreSQL (Supabase)
- Twitter API v2
- Solana Web3.js
- ORE Protocol
- Canvas (for board images)

### Frontend
- React + Wouter
- Tailwind CSS + Shadcn UI
- Simple informational page

## Game Flow

1. **Game Creation**: Admin creates game with entry fee and max players
2. **Player Entry**: Players click Solana Blink in tweet → pay → join
3. **Board Generation**: Each player gets randomized ship placement
4. **Game Start**: Bot posts announcement tweet when game is full
5. **Shot Sequence**: 25 ORE blocks generate 25 coordinates
6. **Damage Processing**: Each shot checks all players simultaneously
7. **Elimination**: Players with 0 HP are eliminated
8. **Winner**: Last player standing wins the prize pool
9. **Payout**: Automated Solana transfer to winner

## Development

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Database push (sync schema)
npm run db:push
```

## Architecture Highlights

- **PostgreSQL database** with Drizzle ORM for persistent storage
- **Atomic player joins** using SQL increment to prevent race conditions
- **ORE Monitor** subscribes to Solana ORE program logs and auto-fires shots
- Proper subscription lifecycle management (start/stop/cleanup)
- Game engine handles board generation, shot processing, damage calculation
- Board image generator creates PNG boards for each player
- Twitter bot manages all social media interactions
- Solana Blink integration for one-click payments
- Escrow wallet system for prize pool management
- ORE hash-to-coordinate algorithm ensures fair randomness

## Design Philosophy

- **Twitter-first**: All gameplay visible on public timeline
- **Transparency**: Every action is public and verifiable
- **Simplicity**: One-click entry, automated gameplay
- **Fairness**: ORE mining provides cryptographic randomness
- **Nautical theme**: Ocean blues, dinghy boats, maritime aesthetics

---

Built by @thejustinfagan | Bot: @battle_dinghy | Powered by Solana & ORE
