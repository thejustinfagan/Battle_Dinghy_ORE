import {
  Connection,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  Transaction,
  Keypair,
  sendAndConfirmTransaction,
  LAMPORTS_PER_SOL,
} from "@solana/web3.js";
import { TOKEN_PROGRAM_ID} from "@solana/spl-token";

// Network configuration - same as solana-escrow.ts
const SOLANA_NETWORK = process.env.SOLANA_NETWORK || "devnet";

// Build Helius RPC URL if API key is provided
const buildHeliusUrl = (network: string) => {
  const apiKey = process.env.HELIUS_API_KEY;
  if (apiKey) {
    return `https://${network}.helius-rpc.com/?api-key=${apiKey}`;
  }
  return null;
};

const SOLANA_RPC_URLS = {
  devnet: buildHeliusUrl("devnet") || process.env.SOLANA_DEVNET_RPC || "https://api.devnet.solana.com",
  mainnet: buildHeliusUrl("mainnet-beta") || process.env.SOLANA_MAINNET_RPC || "https://api.mainnet-beta.solana.com",
};

const SOLANA_RPC_URL = SOLANA_RPC_URLS[SOLANA_NETWORK as keyof typeof SOLANA_RPC_URLS];

// ORE Program ID - v3 on mainnet
export const ORE_PROGRAM_ID = process.env.ORE_PROGRAM_ID 
  ? new PublicKey(process.env.ORE_PROGRAM_ID)
  : new PublicKey("oreV3EG1i9BEgiAJ8b177Z2S2rMarzak4NMv1kULvWv");

// ORE Token mint address (mainnet)
export const ORE_TOKEN_MINT = new PublicKey("oreoU2P8bN6jkk3jbaiVxYnG1dCXcYxwhwyK9jSybcp");

// Instruction discriminators (from ORE v3 program)
const DEPLOY_DISCRIMINATOR = 6;
const CHECKPOINT_DISCRIMINATOR = 2;
const CLAIM_SOL_DISCRIMINATOR = 3;
const CLAIM_ORE_DISCRIMINATOR = 4;

// PDA seeds
const MINER_SEED = Buffer.from("miner");
const BOARD_SEED = Buffer.from("board");
const ROUND_SEED = Buffer.from("round");
const TREASURY_SEED = Buffer.from("treasury");

console.log(`⛏️  ORE Miner - Network: ${SOLANA_NETWORK.toUpperCase()}`);
console.log(`⛏️  ORE Miner - RPC: ${SOLANA_RPC_URL}`);
console.log(`⛏️  ORE Miner - Program ID: ${ORE_PROGRAM_ID.toString()}`);

/**
 * Calculate the squares bitmask for deploying to all 25 blocks
 * Returns a 32-bit integer where the first 25 bits are set to 1
 */
export function calculateAllSquaresMask(): number {
  // Set all 25 bits to 1: 0x1FFFFFF (33554431 in decimal)
  return (1 << 25) - 1;
}

/**
 * Calculate maximum deployment per block accounting for transaction fees
 * @param totalPrizePool Total SOL available in lamports
 * @param estimatedFeesPerRound Estimated transaction fees per round in lamports
 * @param numRounds Number of rounds (25)
 * @returns Max lamports to deploy per block
 */
export function calculateMaxDeployPerBlock(
  totalPrizePool: number,
  estimatedFeesPerRound: number = 10000, // ~0.00001 SOL per tx
  numRounds: number = 25
): number {
  // Reserve SOL for all transaction fees across all rounds
  const totalFeesReserved = estimatedFeesPerRound * numRounds * 5; // Deploy, Checkpoint, ClaimSOL for 25 rounds + 2 final claims
  const availableForDeployment = totalPrizePool - totalFeesReserved;
  
  // Deploy to all 25 blocks for 25 rounds = 625 total deployments
  // But we reclaim SOL after each round, so we only need enough for 25 blocks at a time
  const totalDeployments = 25; // Deploy to 25 blocks per round
  
  const perBlockDeployment = Math.floor(availableForDeployment / totalDeployments);
  
  console.log(`💰 Prize Pool: ${totalPrizePool / LAMPORTS_PER_SOL} SOL`);
  console.log(`💸 Reserved for fees: ${totalFeesReserved / LAMPORTS_PER_SOL} SOL`);
  console.log(`🎯 Available for deployment: ${availableForDeployment / LAMPORTS_PER_SOL} SOL`);
  console.log(`📊 Deploy per block: ${perBlockDeployment / LAMPORTS_PER_SOL} SOL`);
  
  return perBlockDeployment;
}

/**
 * Derive the miner PDA for a given authority
 */
export function getMinerPda(authority: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [MINER_SEED, authority.toBuffer()],
    ORE_PROGRAM_ID
  );
}

/**
 * Get the board PDA (singleton account)
 */
export function getBoardPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [BOARD_SEED],
    ORE_PROGRAM_ID
  );
}

/**
 * Get the round PDA for a given round ID
 */
export function getRoundPda(roundId: number): [PublicKey, number] {
  const roundIdBuffer = Buffer.alloc(8);
  roundIdBuffer.writeBigUInt64LE(BigInt(roundId));
  
  return PublicKey.findProgramAddressSync(
    [ROUND_SEED, roundIdBuffer],
    ORE_PROGRAM_ID
  );
}

/**
 * ORE Round account data structure
 * Matches the on-chain Rust struct
 */
export interface OreRoundData {
  roundNumber: bigint;
  startTime: bigint;
  endTime: bigint;
  winningSquareIndex: number; // 0-24
  totalSolDeployed: bigint;
  solPerSquare: bigint[]; // Array of 25 values
  motherlodeTriggered: boolean;
}

/**
 * Fetch and parse the ORE round PDA account
 * @param connection Solana connection
 * @param roundId The round ID to fetch
 * @returns Parsed round data including winning square index
 */
export async function fetchRoundData(
  connection: Connection,
  roundId: number
): Promise<OreRoundData | null> {
  try {
    const [roundPda] = getRoundPda(roundId);
    const accountInfo = await connection.getAccountInfo(roundPda);
    
    if (!accountInfo) {
      console.log(`⚠️  Round ${roundId} PDA not found - may not be finalized yet`);
      return null;
    }
    
    // Parse the account data
    // ORE v3 uses Anchor's discriminator (8 bytes) + data
    const data = accountInfo.data;
    
    if (data.length < 8) {
      throw new Error("Invalid round account data - too short");
    }
    
    // Skip the 8-byte Anchor discriminator
    let offset = 8;
    
    // Read round_number (u64 = 8 bytes)
    const roundNumber = data.readBigUInt64LE(offset);
    offset += 8;
    
    // Read start_time (i64 = 8 bytes)
    const startTime = data.readBigInt64LE(offset);
    offset += 8;
    
    // Read end_time (i64 = 8 bytes)
    const endTime = data.readBigInt64LE(offset);
    offset += 8;
    
    // Read winning_square_index (u8 = 1 byte) - THIS IS THE KEY VALUE!
    const winningSquareIndex = data.readUInt8(offset);
    offset += 1;
    
    // Align to next 8-byte boundary (padding)
    offset = Math.ceil(offset / 8) * 8;
    
    // Read total_sol_deployed (u64 = 8 bytes)
    const totalSolDeployed = data.readBigUInt64LE(offset);
    offset += 8;
    
    // Read sol_per_square array (25 × u64 = 200 bytes)
    const solPerSquare: bigint[] = [];
    for (let i = 0; i < 25; i++) {
      solPerSquare.push(data.readBigUInt64LE(offset));
      offset += 8;
    }
    
    // Read motherlode_triggered (bool = 1 byte)
    const motherlodeTriggered = data.readUInt8(offset) !== 0;
    
    return {
      roundNumber,
      startTime,
      endTime,
      winningSquareIndex,
      totalSolDeployed,
      solPerSquare,
      motherlodeTriggered,
    };
  } catch (error) {
    console.error(`❌ Error fetching round ${roundId} data:`, error);
    return null;
  }
}

/**
 * Convert ORE winning square index (0-24) to Battle Dinghy coordinate (A1-E5)
 * 
 * ORE Grid Layout (0-24):
 *   0  1  2  3  4
 *   5  6  7  8  9
 *  10 11 12 13 14
 *  15 16 17 18 19
 *  20 21 22 23 24
 * 
 * Battle Dinghy Grid:
 *   A  B  C  D  E
 * 1 □  □  □  □  □
 * 2 □  □  □  □  □
 * 3 □  □  □  □  □
 * 4 □  □  □  □  □
 * 5 □  □  □  □  □
 */
export function oreSquareIndexToCoordinate(squareIndex: number): string {
  if (squareIndex < 0 || squareIndex > 24) {
    throw new Error(`Invalid square index: ${squareIndex}. Must be 0-24.`);
  }
  
  // Calculate row (0-4) and column (0-4)
  const row = Math.floor(squareIndex / 5);
  const col = squareIndex % 5;
  
  // Convert to coordinate string
  const rowLabel = (row + 1).toString(); // 1-5
  const colLabel = String.fromCharCode(65 + col); // A-E
  
  return colLabel + rowLabel; // e.g., "A1", "C3", "E5"
}

/**
 * Get the treasury PDA (singleton account)
 */
export function getTreasuryPda(): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [TREASURY_SEED],
    ORE_PROGRAM_ID
  );
}

/**
 * Fetch the current round number from the board PDA
 * This is the authoritative source for which round has just completed
 */
export async function fetchBoardCurrentRound(connection: Connection): Promise<number | null> {
  try {
    const [boardPda] = getBoardPda();
    const accountInfo = await connection.getAccountInfo(boardPda);
    
    if (!accountInfo || !accountInfo.data) {
      console.error("❌ Board account not found");
      return null;
    }
    
    // Board account structure (simplified - we only need the round number):
    // Discriminator: 8 bytes
    // Round number (u64): 8 bytes at offset 8
    if (accountInfo.data.length < 16) {
      console.error("❌ Board account data too short");
      return null;
    }
    
    const currentRound = Number(accountInfo.data.readBigUInt64LE(8));
    return currentRound;
  } catch (error) {
    console.error("❌ Error fetching board current round:", error);
    return null;
  }
}

/**
 * Create Deploy instruction
 * Deploys SOL to claim space on the ORE mining board
 */
export function createDeployInstruction(
  signer: PublicKey,
  authority: PublicKey,
  amount: number, // lamports
  squaresMask: number // 32-bit bitmask
): TransactionInstruction {
  const [minerPda] = getMinerPda(authority);
  const [boardPda] = getBoardPda();
  const [roundPda] = getRoundPda(0); // Will be updated by program
  
  // Build instruction data
  const data = Buffer.alloc(13);
  data.writeUInt8(DEPLOY_DISCRIMINATOR, 0);
  data.writeBigUInt64LE(BigInt(amount), 1); // 8 bytes for amount
  data.writeUInt32LE(squaresMask, 9); // 4 bytes for squares mask
  
  return new TransactionInstruction({
    programId: ORE_PROGRAM_ID,
    keys: [
      { pubkey: signer, isSigner: true, isWritable: false },
      { pubkey: authority, isSigner: false, isWritable: true },
      { pubkey: PublicKey.default, isSigner: false, isWritable: true }, // automation (empty for now)
      { pubkey: boardPda, isSigner: false, isWritable: true },
      { pubkey: minerPda, isSigner: false, isWritable: true },
      { pubkey: roundPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * Create Checkpoint instruction
 * Checkpoints rewards from completed rounds
 */
export function createCheckpointInstruction(
  signer: PublicKey,
  authority: PublicKey,
  roundId: number
): TransactionInstruction {
  const [minerPda] = getMinerPda(authority);
  const [boardPda] = getBoardPda();
  const [roundPda] = getRoundPda(roundId);
  const [treasuryPda] = getTreasuryPda();
  
  // Build instruction data (no arguments, just discriminator)
  const data = Buffer.alloc(1);
  data.writeUInt8(CHECKPOINT_DISCRIMINATOR, 0);
  
  return new TransactionInstruction({
    programId: ORE_PROGRAM_ID,
    keys: [
      { pubkey: signer, isSigner: true, isWritable: false },
      { pubkey: boardPda, isSigner: false, isWritable: false },
      { pubkey: minerPda, isSigner: false, isWritable: true },
      { pubkey: roundPda, isSigner: false, isWritable: true },
      { pubkey: treasuryPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * Create ClaimSOL instruction
 * Claims SOL mining rewards from the miner account
 */
export function createClaimSolInstruction(
  signer: PublicKey,
  authority: PublicKey
): TransactionInstruction {
  const [minerPda] = getMinerPda(authority);
  
  // Build instruction data (no arguments, just discriminator)
  const data = Buffer.alloc(1);
  data.writeUInt8(CLAIM_SOL_DISCRIMINATOR, 0);
  
  return new TransactionInstruction({
    programId: ORE_PROGRAM_ID,
    keys: [
      { pubkey: signer, isSigner: true, isWritable: true },
      { pubkey: minerPda, isSigner: false, isWritable: true },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * Create ClaimORE instruction
 * Claims ORE token mining rewards (10% refining fee applies)
 */
export function createClaimOreInstruction(
  signer: PublicKey,
  authority: PublicKey,
  minerTokenAccount: PublicKey
): TransactionInstruction {
  const [minerPda] = getMinerPda(authority);
  const [treasuryPda] = getTreasuryPda();
  
  // Build instruction data (no arguments, just discriminator)
  const data = Buffer.alloc(1);
  data.writeUInt8(CLAIM_ORE_DISCRIMINATOR, 0);
  
  return new TransactionInstruction({
    programId: ORE_PROGRAM_ID,
    keys: [
      { pubkey: signer, isSigner: true, isWritable: false },
      { pubkey: minerPda, isSigner: false, isWritable: true },
      { pubkey: minerTokenAccount, isSigner: false, isWritable: true },
      { pubkey: treasuryPda, isSigner: false, isWritable: true },
      { pubkey: ORE_TOKEN_MINT, isSigner: false, isWritable: true },
      { pubkey: TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data,
  });
}

/**
 * Execute a Deploy transaction
 */
export async function executeDeploy(
  connection: Connection,
  payer: Keypair,
  authority: PublicKey,
  amount: number,
  squaresMask: number
): Promise<string> {
  const instruction = createDeployInstruction(payer.publicKey, authority, amount, squaresMask);
  const transaction = new Transaction().add(instruction);
  
  const signature = await sendAndConfirmTransaction(connection, transaction, [payer]);
  console.log(`✅ Deploy transaction confirmed: ${signature}`);
  
  return signature;
}

/**
 * Execute a Checkpoint transaction
 */
export async function executeCheckpoint(
  connection: Connection,
  payer: Keypair,
  authority: PublicKey,
  roundId: number
): Promise<string> {
  const instruction = createCheckpointInstruction(payer.publicKey, authority, roundId);
  const transaction = new Transaction().add(instruction);
  
  const signature = await sendAndConfirmTransaction(connection, transaction, [payer]);
  console.log(`✅ Checkpoint transaction confirmed: ${signature}`);
  
  return signature;
}

/**
 * Execute a ClaimSOL transaction
 */
export async function executeClaimSol(
  connection: Connection,
  payer: Keypair,
  authority: PublicKey
): Promise<string> {
  const instruction = createClaimSolInstruction(payer.publicKey, authority);
  const transaction = new Transaction().add(instruction);
  
  const signature = await sendAndConfirmTransaction(connection, transaction, [payer]);
  console.log(`✅ ClaimSOL transaction confirmed: ${signature}`);
  
  return signature;
}

/**
 * Execute a ClaimORE transaction
 */
export async function executeClaimOre(
  connection: Connection,
  payer: Keypair,
  authority: PublicKey,
  minerTokenAccount: PublicKey
): Promise<string> {
  const instruction = createClaimOreInstruction(payer.publicKey, authority, minerTokenAccount);
  const transaction = new Transaction().add(instruction);
  
  const signature = await sendAndConfirmTransaction(connection, transaction, [payer]);
  console.log(`✅ ClaimORE transaction confirmed: ${signature}`);
  
  return signature;
}

/**
 * Get miner account balance
 */
export async function getMinerBalance(
  connection: Connection,
  authority: PublicKey
): Promise<number> {
  const [minerPda] = getMinerPda(authority);
  
  try {
    const balance = await connection.getBalance(minerPda);
    return balance;
  } catch (error) {
    console.error("Error fetching miner balance:", error);
    return 0;
  }
}

export class OreMiner {
  private connection: Connection;
  private escrowKeypair: Keypair;
  private authority: PublicKey;
  private minerPda: PublicKey;
  private minerBump: number;
  
  constructor(escrowKeypair: Keypair) {
    this.connection = new Connection(SOLANA_RPC_URL, "confirmed");
    this.escrowKeypair = escrowKeypair;
    this.authority = escrowKeypair.publicKey;
    
    const [minerPda, minerBump] = getMinerPda(this.authority);
    this.minerPda = minerPda;
    this.minerBump = minerBump;
    
    console.log(`⛏️  OreMiner initialized`);
    console.log(`  Authority: ${this.authority.toString()}`);
    console.log(`  Miner PDA: ${this.minerPda.toString()}`);
    console.log(`  Bump: ${this.minerBump}`);
  }
  
  /**
   * Deploy SOL to all 25 blocks
   */
  async deploy(amountPerBlock: number): Promise<string> {
    const squaresMask = calculateAllSquaresMask();
    return await executeDeploy(
      this.connection,
      this.escrowKeypair,
      this.authority,
      amountPerBlock,
      squaresMask
    );
  }
  
  /**
   * Checkpoint rewards from a completed round
   */
  async checkpoint(roundId: number): Promise<string> {
    return await executeCheckpoint(
      this.connection,
      this.escrowKeypair,
      this.authority,
      roundId
    );
  }
  
  /**
   * Claim accumulated SOL rewards
   */
  async claimSol(): Promise<string> {
    return await executeClaimSol(
      this.connection,
      this.escrowKeypair,
      this.authority
    );
  }
  
  /**
   * Claim accumulated ORE token rewards
   */
  async claimOre(minerTokenAccount: PublicKey): Promise<string> {
    return await executeClaimOre(
      this.connection,
      this.escrowKeypair,
      this.authority,
      minerTokenAccount
    );
  }
  
  /**
   * Get current miner account balance
   */
  async getBalance(): Promise<number> {
    return await getMinerBalance(this.connection, this.authority);
  }
  
  /**
   * Get miner PDA and bump
   */
  getMinerInfo(): { address: string; bump: number } {
    return {
      address: this.minerPda.toString(),
      bump: this.minerBump,
    };
  }
}
