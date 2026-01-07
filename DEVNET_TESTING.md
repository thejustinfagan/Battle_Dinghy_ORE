# Battle Dinghy - Devnet Testing Guide

## Overview
This guide explains how to test the complete Battle Dinghy game flow on Solana devnet without using real SOL.

**Current Status**: 
- ✅ Application running on DEVNET
- ✅ Escrow wallet configured: `1aAsVEuiRCkGH8yqKdS2yAp5NZhPuhB8Pad774ibDw2`
- ⚠️ Devnet faucet may be unreliable (rate-limited or temporarily down)

---

## Prerequisites

1. **Phantom Wallet** installed and set to Devnet
   - Install Phantom: https://phantom.app/
   - Switch to Devnet: Settings → Developer Settings → Testnet Mode → Devnet

2. **Devnet SOL** for your test wallet
   - Get SOL from: https://faucet.solana.com
   - Or use Phantom's built-in airdrop feature

---

## Step 1: Get Devnet SOL

### Option A: Web Faucet (Recommended)
1. Go to https://faucet.solana.com
2. Paste your Phantom wallet address
3. Click "Airdrop 1 SOL"
4. Wait ~30 seconds for confirmation

### Option B: Phantom Built-in Airdrop
1. Open Phantom wallet
2. Ensure you're on Devnet (purple badge)
3. Click "Airdrop" in the wallet menu
4. Request 1 SOL

### Option C: Solana CLI
```bash
# Install Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/stable/install)"

# Airdrop to your wallet
solana airdrop 1 YOUR_WALLET_ADDRESS --url devnet

# Airdrop to escrow wallet
solana airdrop 2 1aAsVEuiRCkGH8yqKdS2yAp5NZhPuhB8Pad774ibDw2 --url devnet
```

---

## Step 2: Verify Network Configuration

```bash
# Check that application is running on devnet
curl http://localhost:5000/api/admin/solana/network

# Expected response:
{
  "network": "devnet",
  "rpcUrl": "https://api.devnet.solana.com",
  "escrowAddress": "1aAsVEuiRCkGH8yqKdS2yAp5NZhPuhB8Pad774ibDw2",
  "escrowBalance": 0,
  "escrowBalanceSol": "0.0000"
}
```

---

## Step 3: Create Test Game

```bash
# Create a game with 0.1 SOL entry fee
curl -X POST http://localhost:5000/api/games/create \
  -H "Content-Type: application/json" \
  -d '{
    "entryFeeSol": 100000000,
    "maxPlayers": 5
  }'

# Save the game ID from response
```

---

## Step 4: Test Solana Blink (Actions API)

### A. Test GET Metadata Endpoint
```bash
GAME_ID="<your-game-id>"

# Get Blink metadata
curl http://localhost:5000/api/actions/game/$GAME_ID

# Expected: JSON with icon, title, description, and action link
```

### B. Test POST Transaction Generation
```bash
# Generate payment transaction
curl -X POST http://localhost:5000/api/actions/game/$GAME_ID \
  -H "Content-Type: application/json" \
  -d '{"account": "YOUR_PHANTOM_WALLET_ADDRESS"}'

# Expected: Base64-encoded Solana transaction
```

### C. Create Blink URL for Testing
```bash
GAME_ID="<your-game-id>"
ACTION_URL="https://battle-dinghy.replit.app/api/actions/game/$GAME_ID"
BLINK_URL="https://dial.to/?action=solana-action:$ACTION_URL"

echo "Blink URL: $BLINK_URL"

# Or use URL encoding:
# https://dial.to/?action=https%3A%2F%2Fbattle-dinghy.replit.app%2Fapi%2Factions%2Fgame%2F[GAME_ID]
```

---

## Step 5: Test Full Flow with Phantom

### Manual Wallet Testing:

1. **Get your Phantom wallet address**
   - Open Phantom
   - Ensure on Devnet (purple badge)
   - Copy wallet address

2. **Fund your wallet** (from Step 1)
   - Get 1-2 devnet SOL

3. **Generate transaction**
   ```bash
   GAME_ID="<your-game-id>"
   YOUR_WALLET="<your-phantom-address>"
   
   curl -X POST http://localhost:5000/api/actions/game/$GAME_ID \
     -H "Content-Type: application/json" \
     -d "{\"account\": \"$YOUR_WALLET\"}"
   ```

4. **The transaction is valid!**
   - Contains transfer of 0.1 SOL to escrow
   - Can be signed by Phantom wallet
   - Will be sent to devnet

---

## Step 6: Test Payment Verification

**Note**: Payment verification requires a REAL signed transaction on the blockchain.

To test payment verification:
1. Sign and send the transaction using Phantom
2. Get the transaction signature
3. Call the join endpoint with the signature:

```bash
curl -X POST http://localhost:5000/api/games/$GAME_ID/join \
  -H "Content-Type: application/json" \
  -d '{
    "twitterHandle": "@your_twitter",
    "walletAddress": "YOUR_WALLET_ADDRESS",
    "txSignature": "TRANSACTION_SIGNATURE_FROM_PHANTOM"
  }'
```

**What gets verified**:
- ✅ Transaction exists on blockchain
- ✅ Transaction confirmed/finalized
- ✅ Transfer FROM your wallet
- ✅ Transfer TO escrow wallet
- ✅ Amount equals 0.1 SOL exactly

---

## Troubleshooting

### Airdrop Fails with "Internal error"
**Problem**: Devnet faucet is rate-limited or down
**Solution**: Use web faucet (https://faucet.solana.com) or Phantom's airdrop

### Transaction Generation Fails
**Problem**: Invalid wallet address
**Solution**: Ensure using valid Solana base58 address from Phantom

### Blink Not Loading
**Problem**: CORS headers or metadata format
**Solution**: Check browser console, verify OPTIONS returns 204

### Payment Verification Fails
**Problem**: Transaction not on blockchain or wrong amount
**Solution**: 
- Verify transaction on https://explorer.solana.com/?cluster=devnet
- Check logs for specific validation error

---

## Switching Between Networks

### Switch to Devnet
```bash
# Set environment variable
export SOLANA_NETWORK=devnet

# Restart application (workflow will auto-restart)

# Verify
curl http://localhost:5000/api/admin/solana/network
# Should show: "network": "devnet"
```

### Switch to Mainnet
```bash
# Set environment variable
export SOLANA_NETWORK=mainnet

# Restart application

# Verify
curl http://localhost:5000/api/admin/solana/network
# Should show: "network": "mainnet"
```

---

## Admin Endpoints (Devnet Only)

### Get Network Info
```bash
curl http://localhost:5000/api/admin/solana/network
```

### Request Airdrop to Any Wallet
```bash
curl -X POST http://localhost:5000/api/admin/solana/airdrop \
  -H "Content-Type: application/json" \
  -d '{
    "walletAddress": "YOUR_WALLET_ADDRESS",
    "amount": 1
  }'
```

### Request Airdrop to Escrow Wallet
```bash
curl -X POST http://localhost:5000/api/admin/solana/airdrop-escrow \
  -H "Content-Type: application/json" \
  -d '{"amount": 2}'
```

**Note**: Airdrops may fail due to devnet faucet rate limiting. Use web faucet instead.

---

## Key Devnet URLs

- **Faucet**: https://faucet.solana.com
- **Explorer**: https://explorer.solana.com/?cluster=devnet
- **RPC**: https://api.devnet.solana.com
- **Escrow Wallet**: `1aAsVEuiRCkGH8yqKdS2yAp5NZhPuhB8Pad774ibDw2`

---

## Security Testing on Devnet

Test these attack vectors to verify security:

### 1. Invalid Transaction Signature
```bash
# Try joining with fake signature
curl -X POST http://localhost:5000/api/games/$GAME_ID/join \
  -H "Content-Type: application/json" \
  -d '{
    "twitterHandle": "@test",
    "walletAddress": "YOUR_WALLET",
    "txSignature": "fake_signature_12345"
  }'

# Expected: Payment verification failed
```

### 2. Duplicate Join Attempt
```bash
# Try joining same game twice with same wallet
# First join (should succeed)
curl -X POST http://localhost:5000/api/games/$GAME_ID/join ...

# Second join (should fail)
curl -X POST http://localhost:5000/api/games/$GAME_ID/join ...

# Expected: "This wallet has already joined this game"
```

### 3. Wrong Amount Transaction
Create a transaction for 0.05 SOL instead of 0.1 SOL
- Expected: Payment verification should reject

### 4. Transaction to Wrong Destination
Create a transaction to different address
- Expected: Payment verification should reject

---

## Complete Test Flow Example

```bash
# 1. Verify devnet
curl http://localhost:5000/api/admin/solana/network

# 2. Create game
curl -X POST http://localhost:5000/api/games/create \
  -H "Content-Type: application/json" \
  -d '{"entryFeeSol": 100000000, "maxPlayers": 5}'

# 3. Get game ID from response
GAME_ID="your-game-id-here"

# 4. Test Actions API
curl http://localhost:5000/api/actions/game/$GAME_ID

# 5. Generate transaction for your wallet
YOUR_WALLET="your-phantom-address"
curl -X POST http://localhost:5000/api/actions/game/$GAME_ID \
  -H "Content-Type: application/json" \
  -d "{\"account\": \"$YOUR_WALLET\"}"

# 6. Copy transaction, sign with Phantom wallet

# 7. Get signature from Phantom, then join
curl -X POST http://localhost:5000/api/games/$GAME_ID/join \
  -H "Content-Type: application/json" \
  -d '{
    "twitterHandle": "@battle_test",
    "walletAddress": "'"$YOUR_WALLET"'",
    "txSignature": "YOUR_SIGNATURE_HERE"
  }'

# 8. Verify player joined
curl http://localhost:5000/api/games/$GAME_ID
```

---

## Next Steps After Devnet Testing

1. ✅ Verify all transactions generate correctly
2. ✅ Test payment verification with real signatures
3. ✅ Test full game flow with 2-3 test players
4. ✅ Verify escrow balance accumulates correctly
5. ⏭️ Switch to mainnet for production launch

---

**Last Updated**: November 18, 2025
**Network**: Devnet (switchable via SOLANA_NETWORK env var)
**Default Entry Fee**: 0.1 SOL (100,000,000 lamports)
**Escrow Address**: `1aAsVEuiRCkGH8yqKdS2yAp5NZhPuhB8Pad774ibDw2`
