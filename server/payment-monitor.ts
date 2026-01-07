import { Connection, PublicKey } from "@solana/web3.js";
import type { IStorage, VerificationToken } from "./storage";
import { generateRandomBoard } from "./game-engine";
import { generateBoardImage } from "./board-image-generator";
import { sendPlayerBoard } from "./twitter-bot";

const SOLANA_NETWORK = process.env.SOLANA_NETWORK || "devnet";
const SOLANA_RPC_URLS = {
  devnet: process.env.SOLANA_DEVNET_RPC || "https://api.devnet.solana.com",
  mainnet: process.env.SOLANA_MAINNET_RPC || "https://api.mainnet-beta.solana.com",
};
const SOLANA_RPC_URL = SOLANA_RPC_URLS[SOLANA_NETWORK as keyof typeof SOLANA_RPC_URLS];

const ESCROW_WALLET_PUBLIC_KEY = process.env.ESCROW_WALLET_PUBLIC_KEY || "1aAsVEuiRCkGH8yqKdS2yAp5NZhPuhB8Pad774ibDw2";

console.log(`💰 Payment Monitor - Network: ${SOLANA_NETWORK.toUpperCase()}`);
console.log(`💰 Payment Monitor - RPC: ${SOLANA_RPC_URL}`);
console.log(`💰 Payment Monitor - Escrow: ${ESCROW_WALLET_PUBLIC_KEY}`);

export class PaymentMonitor {
  private connection: Connection;
  private storage: IStorage;
  private escrowPublicKey: PublicKey;
  private lastCheckedSignature: string | null = null;
  private pollingInterval: NodeJS.Timeout | null = null;
  private isProcessing = false;

  constructor(storage: IStorage) {
    this.connection = new Connection(SOLANA_RPC_URL, "confirmed");
    this.storage = storage;
    this.escrowPublicKey = new PublicKey(ESCROW_WALLET_PUBLIC_KEY);
  }

  async start() {
    console.log("💰 Payment Monitor - Starting...");
    
    // Check last 100 transactions on startup to catch any missed payments
    console.log("💰 Payment Monitor - Checking recent transactions (last 100)...");
    try {
      const signatures = await this.connection.getSignaturesForAddress(
        this.escrowPublicKey,
        { limit: 100 }
      );
      
      if (signatures.length > 0) {
        // Process all recent transactions to catch any missed payments
        for (const sigInfo of signatures.reverse()) {
          await this.processTransaction(sigInfo.signature);
        }
        // Set the latest signature as checkpoint for future polling
        this.lastCheckedSignature = signatures[0].signature;
        console.log(`💰 Payment Monitor - Processed ${signatures.length} recent transactions`);
        console.log(`💰 Payment Monitor - Now monitoring from: ${this.lastCheckedSignature.substring(0, 8)}...`);
      }
    } catch (error) {
      console.error("💰 Payment Monitor - Error processing initial transactions:", error);
    }

    // Poll every 10 seconds for new transactions
    this.pollingInterval = setInterval(() => this.checkForNewPayments(), 10000);
    console.log("💰 Payment Monitor - Started (polling every 10 seconds)");
  }

  stop() {
    if (this.pollingInterval) {
      clearInterval(this.pollingInterval);
      this.pollingInterval = null;
      console.log("💰 Payment Monitor - Stopped");
    }
  }

  private async checkForNewPayments() {
    if (this.isProcessing) {
      return; // Skip if already processing
    }

    this.isProcessing = true;
    try {
      const signatures = await this.connection.getSignaturesForAddress(
        this.escrowPublicKey,
        { 
          limit: 10,
          until: this.lastCheckedSignature || undefined,
        }
      );

      if (signatures.length === 0) {
        this.isProcessing = false;
        return;
      }

      console.log(`💰 Payment Monitor - Found ${signatures.length} new transaction(s)`);

      // Process signatures in reverse order (oldest first)
      for (const sigInfo of signatures.reverse()) {
        await this.processTransaction(sigInfo.signature);
        this.lastCheckedSignature = sigInfo.signature;
      }
    } catch (error) {
      console.error("💰 Payment Monitor - Error checking for payments:", error);
    } finally {
      this.isProcessing = false;
    }
  }

  private async processTransaction(signature: string) {
    try {
      console.log(`💰 Payment Monitor - Processing transaction: ${signature.substring(0, 8)}...`);

      const tx = await this.connection.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
      });

      if (!tx || !tx.meta || tx.meta.err) {
        console.log(`💰 Payment Monitor - Transaction failed or not found: ${signature.substring(0, 8)}...`);
        return;
      }

      // Find the transfer instruction
      const instructions = tx.transaction.message.instructions;
      for (const instruction of instructions) {
        if ('parsed' in instruction && instruction.parsed?.type === 'transfer') {
          const { source, destination, lamports } = instruction.parsed.info;
          
          // Check if this is a payment to our escrow wallet
          if (destination === ESCROW_WALLET_PUBLIC_KEY) {
            console.log(`💰 Payment Monitor - Payment detected: ${lamports} lamports from ${source.substring(0, 8)}...`);
            await this.handlePayment(source, lamports, signature);
          }
        }
      }
    } catch (error) {
      console.error(`💰 Payment Monitor - Error processing transaction ${signature.substring(0, 8)}:`, error);
    }
  }

  private async handlePayment(walletAddress: string, lamports: number, txSignature: string) {
    try {
      // Find verification token for this wallet by checking all active tokens
      const tokens = await this.storage.getAllVerificationTokens();
      const token = tokens.find((t: VerificationToken) => t.walletAddress === walletAddress && new Date() <= t.expiresAt);
      
      if (!token) {
        console.log(`💰 Payment Monitor - No verification token found for wallet ${walletAddress.substring(0, 8)}...`);
        return;
      }

      if (new Date() > token.expiresAt) {
        console.log(`💰 Payment Monitor - Token expired for wallet ${walletAddress.substring(0, 8)}...`);
        return;
      }

      const game = await this.storage.getGame(token.gameId);
      if (!game) {
        console.log(`💰 Payment Monitor - Game ${token.gameId} not found`);
        return;
      }

      // Check if payment amount matches entry fee (convert SOL to lamports)
      const expectedLamports = game.entryFeeSol;
      const tolerance = 100; // Allow 100 lamport tolerance for rounding
      if (Math.abs(lamports - expectedLamports) > tolerance) {
        console.log(`💰 Payment Monitor - Payment amount mismatch: ${lamports} lamports vs expected ${expectedLamports} lamports`);
        return;
      }

      // Check if player already joined
      const players = await this.storage.getPlayersByGame(game.id);
      if (players.some(p => p.walletAddress === walletAddress)) {
        console.log(`💰 Payment Monitor - Player ${walletAddress.substring(0, 8)}... already joined`);
        return;
      }

      console.log(`💰 Payment Monitor - Completing join for @${token.twitterHandle} (${walletAddress.substring(0, 8)}...)`);

      // Generate board and join game
      const boardState = generateRandomBoard();
      const result = await this.storage.joinGameSimple(game.id, {
        gameId: game.id,
        twitterHandle: token.twitterHandle,
        walletAddress,
        boardState,
        hullPoints: 6,
        status: "alive",
        txSignature,
      });

      if (!result.success) {
        console.error(`💰 Payment Monitor - Failed to join game:`, result.error);
        return;
      }

      console.log(`✅ Payment Monitor - Player @${token.twitterHandle} joined Game #${game.gameNumber}!`);

      // Post board card to Twitter
      const boardImage = generateBoardImage(boardState, true);
      if (game.threadId) {
        try {
          const boardTweetId = await sendPlayerBoard(
            token.twitterHandle,
            game.gameNumber,
            game.threadId,
            boardImage
          );
          console.log(`✅ Payment Monitor - Board card posted for @${token.twitterHandle}: ${boardTweetId}`);
        } catch (error) {
          console.error(`💰 Payment Monitor - Failed to post board card:`, error);
        }
      } else {
        console.log(`💰 Payment Monitor - No thread ID yet, board card will be posted later`);
      }
    } catch (error) {
      console.error(`💰 Payment Monitor - Error handling payment:`, error);
    }
  }
}
