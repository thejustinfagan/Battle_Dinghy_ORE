import {
  Connection,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  Keypair,
} from "@solana/web3.js";

// Network configuration - defaults to devnet for testing
const SOLANA_NETWORK = process.env.SOLANA_NETWORK || "devnet"; // "devnet" or "mainnet"

// Helius RPC is blocked from Replit - use public Solana RPC endpoints
const SOLANA_RPC_URLS = {
  devnet: process.env.SOLANA_DEVNET_RPC || "https://api.devnet.solana.com",
  mainnet: process.env.SOLANA_MAINNET_RPC || "https://api.mainnet-beta.solana.com",
};

const SOLANA_RPC_URL = SOLANA_RPC_URLS[SOLANA_NETWORK as keyof typeof SOLANA_RPC_URLS];
const ESCROW_WALLET = process.env.ESCROW_WALLET_SECRET 
  ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(process.env.ESCROW_WALLET_SECRET)))
  : null;

console.log(`🌐 Solana Network: ${SOLANA_NETWORK.toUpperCase()}`);
console.log(`📡 RPC URL: ${SOLANA_RPC_URL}`);

export class SolanaEscrow {
  private connection: Connection;

  constructor() {
    this.connection = new Connection(SOLANA_RPC_URL, "confirmed");
  }

  getEscrowKeypair(): Keypair {
    if (!ESCROW_WALLET) {
      throw new Error("Escrow wallet not configured");
    }
    return ESCROW_WALLET;
  }

  async createPaymentTransaction(
    playerWallet: PublicKey,
    entryFeeLamports: number
  ): Promise<string> {
    if (!ESCROW_WALLET) {
      throw new Error("Escrow wallet not configured");
    }

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: playerWallet,
        toPubkey: ESCROW_WALLET.publicKey,
        lamports: entryFeeLamports,
      })
    );

    const { blockhash } = await this.connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = playerWallet;

    const serialized = transaction.serialize({
      requireAllSignatures: false,
      verifySignatures: false,
    });

    return serialized.toString("base64");
  }

  async verifyPayment(
    signature: string,
    expectedPlayerWallet: PublicKey,
    expectedAmountLamports: number
  ): Promise<boolean> {
    try {
      if (!ESCROW_WALLET) {
        console.error("Escrow wallet not configured");
        return false;
      }

      // Fetch the full transaction details with retries (devnet can be slow)
      let tx = null;
      const maxRetries = 5;
      for (let i = 0; i < maxRetries; i++) {
        tx = await this.connection.getTransaction(signature, {
          maxSupportedTransactionVersion: 0,
          commitment: "confirmed",
        });
        
        if (tx) break;
        
        console.log(`Transaction not found yet, retry ${i + 1}/${maxRetries}...`);
        await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1 second
      }

      if (!tx) {
        console.error("Transaction not found after retries:", signature);
        return false;
      }

      // Check transaction is confirmed or finalized
      if (!tx.meta || tx.meta.err) {
        console.error("Transaction failed or has no metadata:", signature);
        return false;
      }

      // Get all account keys (including from address lookup tables)
      const accountKeys = tx.transaction.message.getAccountKeys({
        accountKeysFromLookups: tx.meta.loadedAddresses,
      });

      // Find the SystemProgram transfer instruction
      const escrowAddress = ESCROW_WALLET.publicKey;
      const SYSTEM_PROGRAM_ID = new PublicKey("11111111111111111111111111111111");
      
      let transferVerified = false;

      // Debug logging
      console.log(`🔍 Verifying payment for signature: ${signature}`);
      console.log(`   Expected: ${expectedAmountLamports} lamports from ${expectedPlayerWallet.toString()}`);
      console.log(`   Instructions found: ${tx.transaction.message.compiledInstructions.length}`);

      // Parse each instruction to find the transfer
      for (const ix of tx.transaction.message.compiledInstructions) {
        // Check if this is a SystemProgram instruction
        const programId = accountKeys.get(ix.programIdIndex);
        
        console.log(`   Checking instruction - Program: ${programId?.toString()}`);
        
        if (!programId || !programId.equals(SYSTEM_PROGRAM_ID)) {
          continue;
        }

        // Decode the transfer instruction
        // SystemProgram has multiple transfer instruction types:
        // Type 2: Transfer (legacy) - 12 bytes: [2, 0, 0, 0, ...lamports u64]
        // Type 3: Transfer with seed - variable length
        // But sometimes wallets send just the 8-byte amount!
        
        console.log(`   Instruction data length: ${ix.data.length}`);
        console.log(`   Instruction data (hex): ${Buffer.from(ix.data).toString('hex')}`);
        console.log(`   Account indexes: ${JSON.stringify(ix.accountKeyIndexes)}`);

        // Get accounts involved: [0] = from, [1] = to
        if (ix.accountKeyIndexes.length < 2) {
          console.log(`   ❌ Not enough accounts`);
          continue;
        }

        const fromAccount = accountKeys.get(ix.accountKeyIndexes[0]);
        const toAccount = accountKeys.get(ix.accountKeyIndexes[1]);

        console.log(`   From: ${fromAccount?.toString()}`);
        console.log(`   To: ${toAccount?.toString()}`);

        if (!fromAccount || !toAccount) {
          console.log(`   ❌ Missing from/to accounts`);
          continue;
        }

        // Verify this transfer is FROM player TO escrow
        if (!fromAccount.equals(expectedPlayerWallet)) {
          console.log(`   ❌ From account mismatch`);
          continue;
        }
        
        if (!toAccount.equals(escrowAddress)) {
          console.log(`   ❌ To account mismatch`);
          continue;
        }

        // Try to decode lamports amount
        // Modern format: just 8 bytes of lamports (u64 little-endian)
        // Legacy format: [2, 0, 0, 0, ...8 bytes lamports]
        let lamportsAmount: bigint;
        
        if (ix.data.length === 8) {
          // Direct 8-byte amount (modern format)
          const lamportsBuffer = Buffer.from(ix.data);
          lamportsAmount = lamportsBuffer.readBigUInt64LE();
          console.log(`   Modern format: ${lamportsAmount} lamports`);
        } else if (ix.data.length >= 12 && ix.data[0] === 2) {
          // Legacy format with instruction discriminator
          const lamportsBuffer = Buffer.from(ix.data.slice(4, 12));
          lamportsAmount = lamportsBuffer.readBigUInt64LE();
          console.log(`   Legacy format: ${lamportsAmount} lamports`);
        } else {
          console.log(`   ❌ Unrecognized instruction data format`);
          continue;
        }

        // Verify the amount matches expected entry fee
        if (Number(lamportsAmount) !== expectedAmountLamports) {
          console.error(
            `Transfer amount mismatch. Expected: ${expectedAmountLamports}, Got: ${lamportsAmount}`
          );
          continue;
        }

        // All checks passed!
        transferVerified = true;
        console.log(
          `✅ Payment verified: ${lamportsAmount} lamports from ${expectedPlayerWallet.toString()} to escrow ${escrowAddress.toString()}`
        );
        break;
      }

      if (!transferVerified) {
        console.error("No valid transfer instruction found in transaction");
        return false;
      }

      return true;
    } catch (error) {
      console.error("Error verifying payment:", error);
      return false;
    }
  }

  async sendPrizeToWinner(
    winnerWallet: PublicKey,
    prizeLamports: number
  ): Promise<string> {
    if (!ESCROW_WALLET) {
      throw new Error("Escrow wallet not configured");
    }

    const transaction = new Transaction().add(
      SystemProgram.transfer({
        fromPubkey: ESCROW_WALLET.publicKey,
        toPubkey: winnerWallet,
        lamports: prizeLamports,
      })
    );

    const { blockhash } = await this.connection.getLatestBlockhash();
    transaction.recentBlockhash = blockhash;
    transaction.feePayer = ESCROW_WALLET.publicKey;

    transaction.sign(ESCROW_WALLET);

    const signature = await this.connection.sendRawTransaction(
      transaction.serialize()
    );

    await this.connection.confirmTransaction(signature);

    return signature;
  }

  async getEscrowBalance(): Promise<number> {
    if (!ESCROW_WALLET) {
      return 0;
    }

    const balance = await this.connection.getBalance(ESCROW_WALLET.publicKey);
    return balance;
  }

  getEscrowAddress(): string | null {
    return ESCROW_WALLET?.publicKey.toString() || null;
  }

  getNetwork(): string {
    return SOLANA_NETWORK;
  }

  async requestDevnetAirdrop(walletAddress: PublicKey, lamports: number = LAMPORTS_PER_SOL): Promise<string> {
    if (SOLANA_NETWORK !== "devnet") {
      throw new Error("Airdrops are only available on devnet");
    }

    try {
      const signature = await this.connection.requestAirdrop(walletAddress, lamports);
      await this.connection.confirmTransaction(signature);
      console.log(`✅ Airdropped ${lamports / LAMPORTS_PER_SOL} SOL to ${walletAddress.toString()}`);
      return signature;
    } catch (error) {
      console.error("Error requesting airdrop:", error);
      throw error;
    }
  }

  async getNetworkInfo(): Promise<{
    network: string;
    rpcUrl: string;
    escrowAddress: string | null;
    escrowBalance: number;
    escrowBalanceSol: string;
  }> {
    const balance = await this.getEscrowBalance();
    return {
      network: SOLANA_NETWORK,
      rpcUrl: SOLANA_RPC_URL,
      escrowAddress: this.getEscrowAddress(),
      escrowBalance: balance,
      escrowBalanceSol: (balance / LAMPORTS_PER_SOL).toFixed(4),
    };
  }
}

export const solanaEscrow = new SolanaEscrow();
