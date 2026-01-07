// Battle Dinghy - Solana Actions (Blinks) Endpoints
//
// Implements the Solana Actions spec for buy-in transactions via Dialect Blinks.
// See: https://docs.dialect.to/documentation/actions/actions-spec

import { Router, Request, Response } from 'express';
import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
} from '@solana/web3.js';
import type { GameManager } from './game-manager.js';

// =============================================================================
// Constants
// =============================================================================

const DEFAULT_BUY_IN = 0.001 * LAMPORTS_PER_SOL; // 0.001 SOL
const ACTIONS_CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers':
    'Content-Type, Authorization, Content-Encoding, Accept-Encoding',
  'Access-Control-Expose-Headers': 'X-Action-Version, X-Blockchain-Ids',
  'X-Action-Version': '2.1.3',
  'X-Blockchain-Ids': 'solana:5eykt4UsFv8P8NJdTREpY1vzqKqZKvdp', // mainnet
};

// =============================================================================
// Types
// =============================================================================

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

interface ActionLink {
  label: string;
  href: string;
  parameters?: ActionParameter[];
}

interface ActionParameter {
  name: string;
  label: string;
  required?: boolean;
}

interface ActionPostRequest {
  account: string; // base58 public key
}

interface ActionPostResponse {
  transaction: string; // base64 encoded serialized transaction
  message?: string;
}

interface ActionError {
  message: string;
}

// =============================================================================
// Blinks Route Factory
// =============================================================================

export function createBlinksRoutes(
  gameManager: GameManager,
  connection: Connection,
  escrowWallet: PublicKey
): Router {
  const router = Router();

  // CORS preflight for all blinks routes
  router.options('*', (_req: Request, res: Response) => {
    res.set(ACTIONS_CORS_HEADERS);
    res.sendStatus(200);
  });

  // ===========================================================================
  // GET /actions.json - Actions manifest
  // ===========================================================================

  router.get('/actions.json', (_req: Request, res: Response) => {
    res.set(ACTIONS_CORS_HEADERS);
    res.json({
      rules: [
        {
          pathPattern: '/blinks/join/**',
          apiPath: '/blinks/join/**',
        },
      ],
    });
  });

  // ===========================================================================
  // GET /blinks/join/:gameId - Get action metadata
  // ===========================================================================

  router.get('/blinks/join/:gameId', (req: Request, res: Response) => {
    res.set(ACTIONS_CORS_HEADERS);

    const { gameId } = req.params;
    const status = gameManager.getGameStatus(gameId);

    if (!status) {
      const response: ActionGetResponse = {
        type: 'action',
        icon: getIconUrl(req),
        title: 'Battle Dinghy',
        description: 'Game not found',
        label: 'Game Not Found',
        disabled: true,
        error: { message: 'This game does not exist' },
      };
      res.status(404).json(response);
      return;
    }

    if (status.status !== 'waiting') {
      const response: ActionGetResponse = {
        type: 'action',
        icon: getIconUrl(req),
        title: 'Battle Dinghy',
        description: `Game ${gameId} is ${status.status}`,
        label: 'Game Closed',
        disabled: true,
        error: { message: `This game is ${status.status} and not accepting players` },
      };
      res.json(response);
      return;
    }

    const spotsLeft = status.maxPlayers - status.players.length;
    const buyInSol = DEFAULT_BUY_IN / LAMPORTS_PER_SOL;

    const response: ActionGetResponse = {
      type: 'action',
      icon: getIconUrl(req),
      title: `⚓ Battle Dinghy - ${gameId}`,
      description: `Join the battle! ${spotsLeft} spots remaining. Buy-in: ${buyInSol} SOL. Winner takes all!`,
      label: `Join Game (${buyInSol} SOL)`,
      links: {
        actions: [
          {
            label: `Join Game (${buyInSol} SOL)`,
            href: `/blinks/join/${gameId}`,
          },
        ],
      },
    };

    res.json(response);
  });

  // ===========================================================================
  // POST /blinks/join/:gameId - Execute join transaction
  // ===========================================================================

  router.post('/blinks/join/:gameId', async (req: Request, res: Response) => {
    res.set(ACTIONS_CORS_HEADERS);

    const { gameId } = req.params;
    const body = req.body as ActionPostRequest;

    if (!body.account) {
      res.status(400).json({ error: 'Missing account in request body' });
      return;
    }

    let playerPubkey: PublicKey;
    try {
      playerPubkey = new PublicKey(body.account);
    } catch {
      res.status(400).json({ error: 'Invalid account public key' });
      return;
    }

    // Check game status
    const status = gameManager.getGameStatus(gameId);
    if (!status) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }

    if (status.status !== 'waiting') {
      res.status(400).json({ error: `Game is ${status.status}, not accepting players` });
      return;
    }

    if (status.players.includes(body.account)) {
      res.status(400).json({ error: 'You have already joined this game' });
      return;
    }

    if (status.players.length >= status.maxPlayers) {
      res.status(400).json({ error: 'Game is full' });
      return;
    }

    try {
      // Create buy-in transaction
      const { blockhash, lastValidBlockHeight } =
        await connection.getLatestBlockhash();

      const transaction = new Transaction({
        blockhash,
        lastValidBlockHeight,
        feePayer: playerPubkey,
      });

      // Transfer buy-in to escrow
      transaction.add(
        SystemProgram.transfer({
          fromPubkey: playerPubkey,
          toPubkey: escrowWallet,
          lamports: DEFAULT_BUY_IN,
        })
      );

      // Serialize transaction
      const serialized = transaction.serialize({
        requireAllSignatures: false,
        verifySignatures: false,
      });

      const response: ActionPostResponse = {
        transaction: serialized.toString('base64'),
        message: `Joining Battle Dinghy game: ${gameId}`,
      };

      res.json(response);
    } catch (error) {
      console.error('Error creating transaction:', error);
      res.status(500).json({ error: 'Failed to create transaction' });
    }
  });

  return router;
}

// =============================================================================
// Helpers
// =============================================================================

function getIconUrl(req: Request): string {
  const protocol = req.headers['x-forwarded-proto'] || req.protocol;
  const host = req.headers['x-forwarded-host'] || req.get('host');
  return `${protocol}://${host}/static/battle-dinghy-icon.png`;
}

// =============================================================================
// Transaction Confirmation Handler
// =============================================================================

/**
 * Confirms a player's buy-in transaction and adds them to the game.
 * Call this after the transaction is confirmed on-chain.
 */
export async function confirmBuyIn(
  gameManager: GameManager,
  connection: Connection,
  gameId: string,
  playerWallet: string,
  signature: string
): Promise<{ success: boolean; error?: string }> {
  try {
    // Verify transaction
    const tx = await connection.getTransaction(signature, {
      commitment: 'confirmed',
      maxSupportedTransactionVersion: 0,
    });

    if (!tx) {
      return { success: false, error: 'Transaction not found' };
    }

    if (tx.meta?.err) {
      return { success: false, error: 'Transaction failed on-chain' };
    }

    // Add player to game
    const result = gameManager.joinGame(gameId, playerWallet);
    if (!result.success) {
      return { success: false, error: result.error };
    }

    return { success: true };
  } catch (error) {
    console.error('Error confirming buy-in:', error);
    return { success: false, error: 'Failed to confirm transaction' };
  }
}
