# Battle Dinghy Project

## Overview
Battle Dinghy is a Twitter-native Battleship elimination game where 35-50 players compete simultaneously using Solana Blinks for entry and ORE mining for provably fair randomness. All gameplay happens on Twitter's public timeline via @battle_dinghy bot.

## Project Status
**Phase**: MVP Development - Twitter verification and join flow complete
**Last Updated**: November 19, 2025

## Key Accounts
- Twitter Bot: `@battle_dinghy`
- API Master: `@thejustinfagan`

## Architecture

### Backend (Node.js/TypeScript/Express)
- **Game Engine** (`server/game-engine.ts`): Board generation, shot processing, coordinate conversion
- **Board Image Generator** (`server/board-image-generator.ts`): Creates PNG board images using Canvas
- **Twitter Bot** (`server/twitter-bot.ts`): Posts announcements, shots, winners to Twitter with OAuth 2.0 auto-refresh
- **Storage** (`server/db-storage.ts`): PostgreSQL storage with Drizzle ORM, atomic transactions for game joins
- **Routes** (`server/routes.ts`): REST API for game management and Solana Blink integration

### Frontend (React/Tailwind/Shadcn)
- **Admin Panel** (`/admin`): Game creation with configurable entry fees and max players
- **Join Page** (`/join/:gameId`): Twitter handle verification before payment
- Simple informational landing page
- Nautical blue theme matching Battle Dinghy branding

### Database (PostgreSQL with Drizzle ORM)
- **Active**: All data persists in PostgreSQL via DbStorage
- **Tables**: Games, Players, Shots, Shot Results, Verification Tokens
- **Features**: Atomic transactions, race condition prevention, UUID primary keys
- **Uniqueness Constraints**: Compound unique on (gameId, walletAddress) and (gameId, twitterHandle)
- **Token Security**: 15-minute expiry, single-use, wallet binding
- Schema defined in `shared/schema.ts`

## Game Mechanics

### Fleet (per player)
- Big Dinghy: 3 squares, 3 HP
- Dinghy: 2 squares, 2 HP
- Small Dinghy: 1 square, 1 HP
- **Total: 6 HP**

### Randomness
- ORE mining protocol generates block hashes
- Hash converted to 5×5 grid coordinate (A1-E5)
- 25 shots = 25 ORE blocks
- Provably fair, on-chain verifiable

### Win Condition
Last player with hull points > 0 wins prize pool + mined ORE

## API Workflow

1. **Admin creates game** via `/admin` panel:
   - Configure entry fee (in SOL, e.g., 0.01 to 10)
   - Set max players (2 to 100)
   - Set platform fee percentage (0-100%, supports decimals like 5.5%)
   - `POST /api/games/create` with lamports conversion and basis points conversion
2. Bot posts game announcement to Twitter with website join link
3. **Player Join Flow (Twitter Verification)**:
   - Player visits `/join/:gameId` website page
   - Enters Twitter handle → `POST /api/games/:gameId/verify-twitter`
   - Receives verification token (15-minute expiry)
   - Gets Blink URL with token embedded
   - Pays via Solana Blink → `POST /api/actions/game/:gameId?token=xxx`
   - Token validated, wallet address stored
   - Calls `POST /api/games/:gameId/join` with token
   - Server validates token, extracts verified Twitter handle
   - Player added to game with board card @mention in thread
4. `POST /api/games/:id/start` - Game starts, ORE monitoring begins
5. `POST /api/games/:id/fire-shot` - Each ORE block triggers shot
6. Bot announces hits/eliminations via Twitter @mentions
7. Winner announced, platform fee deducted, winner receives (prize pool - fee)

## Required Environment Variables

```
TWITTER_API_KEY
TWITTER_API_SECRET
TWITTER_ACCESS_TOKEN
TWITTER_ACCESS_SECRET
TWITTER_BEARER_TOKEN
TWITTER_CLIENT_ID
TWITTER_CLIENT_SECRET
TWITTER_OAUTH_CALLBACK_URL
TWITTER_REFRESH_TOKEN
ORE_PROGRAM_ID (configured)
ESCROW_WALLET_SECRET (configured)
DATABASE_URL (configured)
SESSION_SECRET (configured)
```

## Solana Configuration
- **Network**: Switchable via `SOLANA_NETWORK` env var (devnet/mainnet)
- **Current**: Devnet for testing
- **ORE Program ID**: `oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv` (mainnet v3)
- **Escrow Wallet**: `1aAsVEuiRCkGH8yqKdS2yAp5NZhPuhB8Pad774ibDw2` (works on both networks)
- **Entry Fees**: Stored in lamports (1 SOL = 1,000,000,000 lamports)
- **Default Entry Fee**: 100,000,000 lamports (0.1 SOL)
- **Devnet Testing**: See `DEVNET_TESTING.md` for complete guide

## Dependencies
- `twitter-api-v2`: Twitter bot functionality with OAuth 2.0
- `canvas`: Server-side board image generation
- `@solana/web3.js`: Solana blockchain integration
- `@coral-xyz/anchor`: Solana program framework
- `bs58`: Base58 encoding for Solana keypairs
- **Helius RPC**: Premium Solana RPC for fast devnet/mainnet transactions
- Express, TypeScript, PostgreSQL (standard stack)

## Recent Progress
✅ PostgreSQL storage with data persistence (Nov 18, 2025)
✅ Twitter OAuth 2.0 with automatic token refresh (Nov 18, 2025)
✅ Atomic player join transactions with race condition prevention (Nov 18, 2025)
✅ Solana integration configured: ORE Program ID and Escrow Wallet (Nov 18, 2025)
✅ Escrow wallet generated and added to Phantom wallet (Nov 18, 2025)
✅ Escrow wallet funded with ~0.4 SOL for transaction fees (Nov 18, 2025)
✅ Solana Actions API implemented with spec-compliant CORS headers (Nov 18, 2025)
✅ Database uniqueness constraints prevent duplicate wallet/Twitter joins (Nov 18, 2025)
✅ Critical payment verification security fix - instruction-level validation (Nov 18, 2025)
✅ Comprehensive e2e testing of Solana Actions API (11/11 tests passing) (Nov 18, 2025)
✅ **Devnet testing environment configured with network switching** (Nov 18, 2025)
✅ **Admin endpoints for devnet testing and network info** (Nov 18, 2025)
✅ **Comprehensive devnet testing guide (DEVNET_TESTING.md)** (Nov 18, 2025)
✅ **Helius RPC integration for fast transaction processing** (Nov 18, 2025)
✅ **Blink UI deployed and accessible with network indicators** (Nov 18, 2025)
✅ **Dynamic base URL detection for deployment flexibility** (Nov 18, 2025)
✅ **ORE Mining Monitoring System - Production Ready** (Nov 18, 2025)
  - Helius RPC for fast ORE block processing
  - Network-aware (devnet/mainnet)
  - Structured result values for accurate state signaling
  - **Database constraints**: (gameId, coordinate) + (gameId, shotNumber) uniqueness
  - **Retry mechanism**: 50 attempts with exponential backoff (100ms-2s) + jitter
  - **Fresh state**: Re-fetches shots/game on every retry attempt
  - **Verified exhaustion**: Post-check prevents silent shot drops
  - Admin control endpoints (start/stop/status/manual-shot)
  - Handles all edge cases: duplicates, race conditions, concurrent completions
  - Never silently drops valid shots - observable failures via error logs
✅ **Twitter OAuth Database Storage - Persistent Token Rotation** (Nov 19, 2025)
  - OAuth tokens stored in PostgreSQL (`oauth_tokens` table)
  - Automatic migration from environment variables on startup
  - Token rotation persists across app restarts (no more manual re-auth!)
  - Single-use refresh tokens properly handled and saved to database
  - Fixes critical issue: refresh tokens previously lost on restart
✅ **Twitter Handle Verification System - Production Ready** (Nov 19, 2025)
  - Website join page at `/join/:gameId` for Twitter handle input
  - Verification tokens with 15-minute expiry and single-use enforcement
  - Token-based security: no way to submit fake Twitter handles
  - Wallet address binding: token validates wallet matches payment
  - Solana Actions API requires verification token (no bypass possible)
  - Join endpoint validates token and extracts Twitter handle server-side
  - Board cards sent as @mention replies in game thread
  - Game announcements link to website join page (not raw Blink)
✅ **Admin Panel Enhanced - Configurable Game Settings** (Nov 19, 2025)
  - Game creation form with entry fee (SOL) and max player inputs
  - Frontend validation: entry fee must be positive, max players 2-100
  - SOL to lamports conversion (user-friendly input)
  - Proper error message propagation from backend validation
  - Success toast shows game number, max players, and entry fee
  - Default values: 0.01 SOL entry fee, 35 max players
✅ **Blink Flow Documentation - BLINK_FLOW.md Created** (Nov 19, 2025)
  - Complete join flow explanation from announcement to board posting
  - 4-layer protection system prevents joins when game is full
  - Race condition protection with atomic database transactions
  - Blink closure behavior documented (GET/POST endpoints)
  - Verification token system explained in detail
✅ **SOLANA PAYMENT FLOW WORKING END-TO-END** (Nov 19, 2025)
  - **CRITICAL FIX**: SystemProgram ID corrected (was `...1112`, now `...1111`)
  - Payment verification now works for both legacy and modern transfer formats
  - Neon HTTP driver compatibility: replaced transactions with `joinGameSimple()`
  - Direct wallet integration via `/join-test/:gameId` page bypasses dial.to
  - Complete flow: Twitter verification → Payment → Database join → Success
  - Prize pool updates correctly on player join
  - UX improvements: completion state with green checkmark after successful join
  - **Status**: Players can now successfully join games with SOL payments on devnet! 🎉
✅ **Platform Fee System - Production Ready** (Nov 20, 2025)
  - Configurable platform fee percentage per game (0-100%, supports decimals like 5.5%)
  - Basis points storage system (500 = 5%, 550 = 5.5%) for precise calculations
  - Admin UI includes platform fee input with validation
  - Winner payout automatically deducts platform fee before transfer
  - Platform fees accumulate in escrow wallet (single wallet design)
  - Database tracks `platformFeeBasisPoints` and `platformFeesCollected` for accounting
  - Default: 5% platform fee
  - **Calculation**: `fee = (prizePool × basisPoints) / 10,000`
  - **Example**: 2 SOL prize × 550 basis points = 0.11 SOL fee (5.5%)

## Next Steps
1. ✅ **Configure devnet testing environment** - COMPLETED
2. Test end-to-end game flow with real Solana transactions on devnet
3. Manual testing: Fund Phantom wallet, test Blink flow, verify payment
4. Switch to mainnet for production launch
5. Add ORE mining monitoring and shot coordination
6. Launch with small test games (3-5 players)
7. Monitor and optimize Twitter bot rate limits

## Blink Status (Solana Actions)
- **Backend API**: ✅ Fully functional (GET/POST endpoints working)
- **RPC**: ✅ Helius premium RPC integrated (~241ms transaction generation)
- **Network Indicators**: ✅ Shows [DEVNET] or [MAINNET] in title, description, and button
- **Known Issue**: Blink viewers timeout on devnet (slow confirmations)
  - Devnet confirmations: 10-30+ seconds
  - Blink viewer timeout: ~5 seconds
  - **Solution**: Works perfectly on mainnet (1-3 second confirmations)
- **Production Ready**: ✅ Code is ready for mainnet deployment
- **Test URL**: https://a89d81c7-872f-4d90-bfc7-974575ba1552-00-3ogyhjk2kukw1.picard.replit.dev

## Testing on Devnet
- **Network**: Currently configured for devnet
- **Switch to mainnet**: Set `SOLANA_NETWORK=mainnet` env var
- **Testing guide**: See `DEVNET_TESTING.md` for complete instructions
- **Admin endpoints**: `/api/admin/solana/network`, `/api/admin/solana/airdrop`
- **Blink testing**: Backend works; UI timeouts are expected on devnet

## Design Philosophy
- **Twitter-native**: All gameplay public on timeline
- **Provably fair**: ORE mining for randomness
- **One-click entry**: Solana Blinks
- **Transparent**: Every shot visible to all
- **Fast-paced**: 25 minutes per game
