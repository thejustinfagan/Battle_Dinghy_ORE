// Battle Dinghy - Webhook Handlers
//
// Handles incoming webhooks from:
// - Helius (Solana transaction notifications)
// - Custom transaction confirmation callbacks

import { Router, Request, Response } from 'express';
import { createHash } from 'crypto';
import type { GameOrchestrator } from './orchestrator.js';
import { parseOreWebhook, HeliusWebhookPayload } from './ore-integration.js';

// =============================================================================
// Types
// =============================================================================

interface TransactionWebhookPayload {
  gameId: string;
  playerWallet: string;
  txSignature: string;
}

interface HeliusEnhancedPayload extends HeliusWebhookPayload {
  description?: string;
  source?: string;
  fee?: number;
  feePayer?: string;
}

// =============================================================================
// Webhook Routes
// =============================================================================

export function createWebhookRoutes(
  orchestrator: GameOrchestrator | null,
  webhookSecret?: string
): Router {
  const router = Router();

  // ===========================================================================
  // Transaction Confirmation Webhook
  // ===========================================================================

  /**
   * POST /webhooks/tx-confirm
   * Called when a player's buy-in transaction is confirmed.
   * Can be triggered by a frontend, mobile app, or external service.
   */
  router.post('/tx-confirm', async (req: Request, res: Response) => {
    if (!orchestrator) {
      res.status(503).json({ error: 'Orchestrator not available' });
      return;
    }

    const payload = req.body as TransactionWebhookPayload;

    if (!payload.gameId || !payload.playerWallet || !payload.txSignature) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    // Verify webhook signature if secret is configured
    if (webhookSecret) {
      const signature = req.headers['x-webhook-signature'] as string;
      if (!verifyWebhookSignature(payload, signature, webhookSecret)) {
        res.status(401).json({ error: 'Invalid webhook signature' });
        return;
      }
    }

    try {
      const result = await orchestrator.confirmPlayerBuyIn(
        payload.gameId,
        payload.playerWallet,
        payload.txSignature
      );

      if (!result.success) {
        res.status(400).json({ error: result.error });
        return;
      }

      res.json({ success: true });
    } catch (error) {
      console.error('Error processing tx-confirm webhook:', error);
      res.status(500).json({ error: 'Internal error' });
    }
  });

  // ===========================================================================
  // Helius Webhook
  // ===========================================================================

  /**
   * POST /webhooks/helius
   * Receives transaction notifications from Helius.
   * Used for monitoring escrow deposits and ORE mining events.
   */
  router.post('/helius', async (req: Request, res: Response) => {
    // Helius sends an array of transactions
    const transactions = Array.isArray(req.body) ? req.body : [req.body];

    for (const tx of transactions as HeliusEnhancedPayload[]) {
      try {
        await processHeliusTransaction(tx, orchestrator);
      } catch (error) {
        console.error('Error processing Helius webhook:', error);
      }
    }

    // Always respond 200 to acknowledge receipt
    res.json({ received: transactions.length });
  });

  // ===========================================================================
  // Health Check
  // ===========================================================================

  router.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'ok',
      orchestrator: orchestrator?.getStatus() || null,
    });
  });

  return router;
}

// =============================================================================
// Helpers
// =============================================================================

function verifyWebhookSignature(
  payload: unknown,
  signature: string | undefined,
  secret: string
): boolean {
  if (!signature) return false;

  const expectedSignature = createHash('sha256')
    .update(JSON.stringify(payload) + secret)
    .digest('hex');

  return signature === expectedSignature;
}

async function processHeliusTransaction(
  tx: HeliusEnhancedPayload,
  orchestrator: GameOrchestrator | null
): Promise<void> {
  console.log(`Helius webhook: ${tx.type} - ${tx.signature}`);

  // Check for ORE mining events
  const oreResult = parseOreWebhook(tx);
  if (oreResult) {
    console.log(`ORE event detected: Block ${oreResult.winningBlock}`);
    // ORE events are handled by OreMonitorLive, not here
    return;
  }

  // Check for escrow deposits (buy-ins)
  if (tx.nativeTransfers && orchestrator) {
    const escrowWallet = process.env.ESCROW_WALLET;
    if (!escrowWallet) return;

    for (const transfer of tx.nativeTransfers) {
      if (transfer.toUserAccount === escrowWallet) {
        console.log(
          `Escrow deposit detected: ${transfer.amount} lamports from ${transfer.fromUserAccount}`
        );

        // Try to find matching pending game
        const pendingGames = orchestrator.getPendingGames();
        for (const game of pendingGames) {
          // Check if this wallet hasn't already joined
          if (!game.confirmedPlayers.has(transfer.fromUserAccount)) {
            await orchestrator.confirmPlayerBuyIn(
              game.gameId,
              transfer.fromUserAccount,
              tx.signature
            );
            break;
          }
        }
      }
    }
  }
}

// =============================================================================
// Webhook Signature Generator (for testing)
// =============================================================================

export function generateWebhookSignature(
  payload: unknown,
  secret: string
): string {
  return createHash('sha256')
    .update(JSON.stringify(payload) + secret)
    .digest('hex');
}
