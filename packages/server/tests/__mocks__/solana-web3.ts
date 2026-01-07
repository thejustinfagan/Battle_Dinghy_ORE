// Mock @solana/web3.js for testing
// Provides minimal implementations for routes tests that don't need actual Solana functionality

export const LAMPORTS_PER_SOL = 1_000_000_000;

export class PublicKey {
  private _key: string;

  constructor(value: string | Uint8Array) {
    this._key = typeof value === 'string' ? value : Buffer.from(value).toString('base64');
  }

  toString(): string {
    return this._key;
  }

  toBase58(): string {
    return this._key;
  }

  equals(other: PublicKey): boolean {
    return this._key === other._key;
  }
}

export class Connection {
  private _endpoint: string;

  constructor(endpoint: string) {
    this._endpoint = endpoint;
  }

  async getLatestBlockhash() {
    return {
      blockhash: 'mock-blockhash-' + Date.now(),
      lastValidBlockHeight: 1000000,
    };
  }

  async getTransaction(_signature: string, _options?: unknown) {
    return null;
  }

  async sendTransaction(_tx: unknown) {
    return 'mock-signature-' + Date.now();
  }
}

export class Transaction {
  private instructions: unknown[] = [];
  public blockhash?: string;
  public lastValidBlockHeight?: number;
  public feePayer?: PublicKey;

  constructor(options?: { blockhash?: string; lastValidBlockHeight?: number; feePayer?: PublicKey }) {
    if (options) {
      this.blockhash = options.blockhash;
      this.lastValidBlockHeight = options.lastValidBlockHeight;
      this.feePayer = options.feePayer;
    }
  }

  add(instruction: unknown): this {
    this.instructions.push(instruction);
    return this;
  }

  serialize(_options?: unknown): Buffer {
    return Buffer.from(JSON.stringify({ instructions: this.instructions.length }));
  }
}

export const SystemProgram = {
  transfer(params: { fromPubkey: PublicKey; toPubkey: PublicKey; lamports: number }) {
    return {
      programId: new PublicKey('11111111111111111111111111111111'),
      keys: [
        { pubkey: params.fromPubkey, isSigner: true, isWritable: true },
        { pubkey: params.toPubkey, isSigner: false, isWritable: true },
      ],
      data: Buffer.from([params.lamports]),
    };
  },
};

export class Keypair {
  public publicKey: PublicKey;
  public secretKey: Uint8Array;

  constructor() {
    this.publicKey = new PublicKey('mock-pubkey-' + Math.random().toString(36).slice(2));
    this.secretKey = new Uint8Array(64);
  }

  static generate(): Keypair {
    return new Keypair();
  }

  static fromSecretKey(_secretKey: Uint8Array): Keypair {
    return new Keypair();
  }
}
