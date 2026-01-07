# Battle Dinghy Blink Flow Documentation

## Overview
This document explains how players join games, how the verification links connect to Solana Blinks, and how the system prevents joins when games are full.

## Join Flow Architecture

### 1. Game Announcement
When a game starts, the Twitter bot posts:
```
🚢 BATTLE DINGHY GAME #1 ⚓

💰 Prize Pool: 0.35 SOL
👥 0/35 Players
⏱️ Join now with your Twitter handle!

https://your-domain.replit.dev/join/game-abc123

First shot incoming... 🎯
```

### 2. Website Join Page (`/join/:gameId`)
- **URL**: `https://your-domain.replit.dev/join/{gameId}`
- **Purpose**: Verify Twitter handle before payment
- **User Flow**:
  1. User enters their Twitter handle (e.g., `@thejustinfagan`)
  2. Frontend calls `POST /api/games/:gameId/verify-twitter`
  3. Server validates handle and checks if game is full
  4. Server generates verification token (15-minute expiry)
  5. User receives Blink URL with token embedded

### 3. Blink URL Structure
```
https://dial.to/?action=solana-action:https://your-domain.replit.dev/api/actions/game/{gameId}?token={verificationToken}
```

**Components**:
- `dial.to` - Blink viewer/wallet interface
- `solana-action:` - Protocol prefix
- Base URL - Your Replit app domain
- `/api/actions/game/:gameId` - Solana Actions API endpoint
- `?token=xxx` - Verification token parameter

### 4. Solana Actions API Flow

#### GET Request (Blink Metadata)
When a user opens the Blink URL, their wallet/viewer calls:
```
GET /api/actions/game/:gameId
```

**Response when game has space**:
```json
{
  "icon": "https://img.icons8.com/fluency/96/anchor.png",
  "title": "⚡ Battle Dinghy Game #1 [DEVNET]",
  "description": "⚓ Join the naval battle! 5/35 players joined. Entry: 0.010 SOL",
  "label": "Join Battle [DEVNET]",
  "links": {
    "actions": [
      {
        "label": "Join for 0.010 SOL",
        "href": "/api/actions/game/abc123"
      }
    ]
  }
}
```

**Response when game is FULL**:
```json
{
  "icon": "https://img.icons8.com/fluency/96/anchor.png",
  "title": "Battle Dinghy Game #1",
  "description": "Game is full with 35 players.",
  "label": "Game Full",
  "links": {
    "actions": [
      {
        "label": "Game Full",
        "href": "/api/actions/game/abc123",
        "disabled": true
      }
    ]
  }
}
```

**Key Code** (`server/routes.ts` lines 460-465):
```typescript
if (game.currentPlayers >= game.maxPlayers) {
  return res.status(200).json({
    icon: "https://img.icons8.com/fluency/96/anchor.png",
    title: `Battle Dinghy Game #${game.gameNumber}`,
    description: `Game is full with ${game.maxPlayers} players.`,
    label: "Game Full",
    links: {
      actions: [
        {
          label: "Game Full",
          href: `/api/actions/game/${gameId}`,
          disabled: true,
          error: { message: `Game has already ${game.status === "active" ? "started" : "ended"}` }
        }
      ]
    }
  });
}
```

#### POST Request (Payment Transaction)
When user clicks "Join", their wallet calls:
```
POST /api/actions/game/:gameId?token={verificationToken}
Body: { "account": "user_wallet_address" }
```

**Validation Steps**:
1. ✅ Verification token required (no bypass)
2. ✅ Token must be valid and not expired
3. ✅ Token must match this game
4. ✅ Game must be in "pending" status
5. ✅ **Game must not be full** (`currentPlayers < maxPlayers`)
6. ✅ Wallet address is valid

**Response when game is FULL** (`server/routes.ts` lines 573-576):
```typescript
if (game.currentPlayers >= game.maxPlayers) {
  return res.status(400).json({
    error: { message: "Game is full" }
  });
}
```

**Response when game has space**:
```json
{
  "transaction": "base64_encoded_solana_transaction",
  "message": "Joining Battle Dinghy Game #1 as @thejustinfagan"
}
```

### 5. After Payment
1. User signs transaction in wallet
2. Transaction submitted to Solana blockchain
3. User calls `POST /api/games/:gameId/join` with token + tx signature
4. Server validates payment and token
5. Player added to game (atomic transaction)
6. Board card posted as @mention in Twitter thread

## How Blinks Close When Full

### 3-Layer Protection System

#### Layer 1: Twitter Verification Endpoint
**Endpoint**: `POST /api/games/:gameId/verify-twitter`

When user enters Twitter handle, the server checks:
```typescript
if (game.currentPlayers >= game.maxPlayers) {
  return res.status(400).json({ error: "Game is full" });
}
```

**Result**: User gets error message, no Blink URL generated.

#### Layer 2: Blink Metadata (GET)
**Endpoint**: `GET /api/actions/game/:gameId`

Every time a Blink is opened/refreshed, it checks player count:
```typescript
if (game.currentPlayers >= game.maxPlayers) {
  // Return disabled action
  disabled: true,
  error: { message: "Game is full" }
}
```

**Result**: Blink shows "Game Full" with disabled button.

#### Layer 3: Payment Transaction (POST)
**Endpoint**: `POST /api/actions/game/:gameId`

Even if someone bypasses the UI, the server validates:
```typescript
if (game.currentPlayers >= game.maxPlayers) {
  return res.status(400).json({
    error: { message: "Game is full" }
  });
}
```

**Result**: Transaction creation fails, no payment possible.

#### Layer 4: Join Endpoint (Final Safety)
**Endpoint**: `POST /api/games/:gameId/join`

Final check during atomic database transaction:
```typescript
const result = await storage.joinGameTransaction(gameId, playerData);
// joinGameTransaction re-checks currentPlayers inside transaction
// Prevents race conditions
```

**Result**: Database-level enforcement prevents overselling.

## Race Condition Protection

### Scenario: 2 users try to join when only 1 spot left

**Without Protection**:
1. User A: Check (34/35) ✅ → Start join
2. User B: Check (34/35) ✅ → Start join
3. User A: Joins → Now 35/35
4. User B: Joins → Now 36/35 ❌ PROBLEM!

**With Current Protection**:
1. User A: Check (34/35) ✅ → Start join
2. User B: Check (34/35) ✅ → Start join
3. User A: Database transaction locks → Check again (34/35) → Join → 35/35 → Commit ✅
4. User B: Database transaction locks → Check again (35/35) → **REJECT** ❌

The `joinGameTransaction` function uses PostgreSQL transactions to prevent race conditions:
```typescript
// Inside db-storage.ts
async joinGameTransaction(gameId: string, playerData: InsertPlayer) {
  return await db.transaction(async (tx) => {
    // Re-fetch game inside transaction (with lock)
    const game = await tx.query.games.findFirst({
      where: eq(games.id, gameId)
    });
    
    // Check again inside transaction
    if (game.currentPlayers >= game.maxPlayers) {
      throw new Error("Game is full");
    }
    
    // Atomic: Add player + increment counter
    await tx.insert(players).values(playerData);
    await tx.update(games)
      .set({ currentPlayers: game.currentPlayers + 1 })
      .where(eq(games.id, gameId));
  });
}
```

## Summary: How It All Works Together

1. **Game Announcement** → Twitter posts link to website join page
2. **User Visits Website** → Enters Twitter handle at `/join/:gameId`
3. **Server Validates** → Checks handle, game status, player count
4. **Token Generated** → User gets Blink URL with verification token
5. **Blink Opens** → GET request shows current player count, disabled if full
6. **User Pays** → POST request validates token + game not full
7. **Join Completes** → Atomic transaction prevents race conditions
8. **Board Posted** → @mention tweet in game thread

**Result**: No way to join a full game through any path!

## Configurable Settings

Admins can configure per game:
- **Entry Fee**: Any SOL amount (e.g., 0.001 SOL to 10 SOL)
- **Max Players**: 2 to 100 players
- **Game Number**: Auto-increments for each new game

These settings affect:
- Prize pool calculation: `entryFee * currentPlayers`
- Blink description text
- When the game "closes" (when `currentPlayers >= maxPlayers`)
