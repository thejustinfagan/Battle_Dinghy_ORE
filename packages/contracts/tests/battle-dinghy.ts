import * as anchor from "@coral-xyz/anchor";
import { Program } from "@coral-xyz/anchor";
import { PublicKey, Keypair, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { expect } from "chai";
import { BattleDinghy } from "../target/types/battle_dinghy";

describe("battle-dinghy", () => {
  // Configure the client to use the local cluster
  const provider = anchor.AnchorProvider.env();
  anchor.setProvider(provider);

  const program = anchor.workspace.BattleDinghy as Program<BattleDinghy>;

  // Test constants
  const BUY_IN = 0.001 * LAMPORTS_PER_SOL; // 0.001 SOL
  const MAX_PLAYERS = 10;
  const FILL_DEADLINE_HOURS = 24;

  // Helper to generate game ID
  let gameCounter = 0;
  const generateGameId = () => `test-game-${Date.now()}-${gameCounter++}`;

  // Helper to generate seed
  const generateSeed = () => {
    const seed = new Uint8Array(32);
    for (let i = 0; i < 32; i++) {
      seed[i] = Math.floor(Math.random() * 256);
    }
    return Array.from(seed);
  };

  // Helper to get escrow PDA
  const getEscrowPda = (gameId: string) => {
    return PublicKey.findProgramAddressSync(
      [Buffer.from("escrow"), Buffer.from(gameId)],
      program.programId
    );
  };

  // Helper to create test players
  const createTestPlayers = async (count: number) => {
    const players: Keypair[] = [];
    for (let i = 0; i < count; i++) {
      const player = Keypair.generate();
      // Airdrop SOL to player
      const sig = await provider.connection.requestAirdrop(
        player.publicKey,
        2 * LAMPORTS_PER_SOL
      );
      await provider.connection.confirmTransaction(sig);
      players.push(player);
    }
    return players;
  };

  // Helper to wait for time to pass (for testing deadlines)
  const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

  // =============================================================================
  // Create Game Tests
  // =============================================================================

  describe("create_game", () => {
    it("creates a game successfully", async () => {
      const gameId = generateGameId();
      const seed = generateSeed();
      const [escrowPda] = getEscrowPda(gameId);

      await program.methods
        .createGame(gameId, new anchor.BN(BUY_IN), MAX_PLAYERS, new anchor.BN(FILL_DEADLINE_HOURS), seed)
        .accounts({
          escrow: escrowPda,
          operator: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      // Fetch and verify escrow account
      const escrow = await program.account.gameEscrow.fetch(escrowPda);
      expect(escrow.gameId).to.equal(gameId);
      expect(escrow.operator.toString()).to.equal(provider.wallet.publicKey.toString());
      expect(escrow.status).to.deep.equal({ open: {} });
      expect(escrow.buyIn.toNumber()).to.equal(BUY_IN);
      expect(escrow.maxPlayers).to.equal(MAX_PLAYERS);
      expect(escrow.currentPlayers).to.equal(0);
      expect(escrow.players.length).to.equal(0);
    });

    it("verifies PDA derivation", async () => {
      const gameId = generateGameId();
      const seed = generateSeed();
      const [escrowPda, bump] = getEscrowPda(gameId);

      await program.methods
        .createGame(gameId, new anchor.BN(BUY_IN), MAX_PLAYERS, new anchor.BN(FILL_DEADLINE_HOURS), seed)
        .accounts({
          escrow: escrowPda,
          operator: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      const escrow = await program.account.gameEscrow.fetch(escrowPda);
      expect(escrow.bump).to.equal(bump);
    });

    it("rejects game ID that is too long", async () => {
      const gameId = "a".repeat(33); // 33 chars, max is 32
      const seed = generateSeed();
      const [escrowPda] = getEscrowPda(gameId);

      try {
        await program.methods
          .createGame(gameId, new anchor.BN(BUY_IN), MAX_PLAYERS, new anchor.BN(FILL_DEADLINE_HOURS), seed)
          .accounts({
            escrow: escrowPda,
            operator: provider.wallet.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("GameIdTooLong");
      }
    });

    it("rejects zero buy-in", async () => {
      const gameId = generateGameId();
      const seed = generateSeed();
      const [escrowPda] = getEscrowPda(gameId);

      try {
        await program.methods
          .createGame(gameId, new anchor.BN(0), MAX_PLAYERS, new anchor.BN(FILL_DEADLINE_HOURS), seed)
          .accounts({
            escrow: escrowPda,
            operator: provider.wallet.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("InvalidBuyIn");
      }
    });

    it("rejects invalid max players", async () => {
      const gameId = generateGameId();
      const seed = generateSeed();
      const [escrowPda] = getEscrowPda(gameId);

      try {
        await program.methods
          .createGame(gameId, new anchor.BN(BUY_IN), 0, new anchor.BN(FILL_DEADLINE_HOURS), seed)
          .accounts({
            escrow: escrowPda,
            operator: provider.wallet.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("InvalidMaxPlayers");
      }
    });
  });

  // =============================================================================
  // Join Game Tests
  // =============================================================================

  describe("join_game", () => {
    it("joins a game successfully", async () => {
      const gameId = generateGameId();
      const seed = generateSeed();
      const [escrowPda] = getEscrowPda(gameId);

      // Create game
      await program.methods
        .createGame(gameId, new anchor.BN(BUY_IN), MAX_PLAYERS, new anchor.BN(FILL_DEADLINE_HOURS), seed)
        .accounts({
          escrow: escrowPda,
          operator: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      // Create player
      const [player] = await createTestPlayers(1);
      const playerBalanceBefore = await provider.connection.getBalance(player.publicKey);

      // Join game
      await program.methods
        .joinGame()
        .accounts({
          escrow: escrowPda,
          player: player.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([player])
        .rpc();

      // Verify
      const escrow = await program.account.gameEscrow.fetch(escrowPda);
      expect(escrow.currentPlayers).to.equal(1);
      expect(escrow.players.length).to.equal(1);
      expect(escrow.players[0].toString()).to.equal(player.publicKey.toString());

      const playerBalanceAfter = await provider.connection.getBalance(player.publicKey);
      expect(playerBalanceBefore - playerBalanceAfter).to.be.greaterThanOrEqual(BUY_IN);
    });

    it("transfers lamports to escrow", async () => {
      const gameId = generateGameId();
      const seed = generateSeed();
      const [escrowPda] = getEscrowPda(gameId);

      await program.methods
        .createGame(gameId, new anchor.BN(BUY_IN), MAX_PLAYERS, new anchor.BN(FILL_DEADLINE_HOURS), seed)
        .accounts({
          escrow: escrowPda,
          operator: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      const escrowBalanceBefore = await provider.connection.getBalance(escrowPda);

      const [player] = await createTestPlayers(1);
      await program.methods
        .joinGame()
        .accounts({
          escrow: escrowPda,
          player: player.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([player])
        .rpc();

      const escrowBalanceAfter = await provider.connection.getBalance(escrowPda);
      expect(escrowBalanceAfter - escrowBalanceBefore).to.equal(BUY_IN);
    });

    it("sets status to Filled when max players reached", async () => {
      const gameId = generateGameId();
      const seed = generateSeed();
      const [escrowPda] = getEscrowPda(gameId);
      const maxPlayers = 2;

      await program.methods
        .createGame(gameId, new anchor.BN(BUY_IN), maxPlayers, new anchor.BN(FILL_DEADLINE_HOURS), seed)
        .accounts({
          escrow: escrowPda,
          operator: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      const players = await createTestPlayers(2);

      for (const player of players) {
        await program.methods
          .joinGame()
          .accounts({
            escrow: escrowPda,
            player: player.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([player])
          .rpc();
      }

      const escrow = await program.account.gameEscrow.fetch(escrowPda);
      expect(escrow.status).to.deep.equal({ filled: {} });
      expect(escrow.currentPlayers).to.equal(maxPlayers);
    });

    it("rejects when game is full", async () => {
      const gameId = generateGameId();
      const seed = generateSeed();
      const [escrowPda] = getEscrowPda(gameId);
      const maxPlayers = 2;

      await program.methods
        .createGame(gameId, new anchor.BN(BUY_IN), maxPlayers, new anchor.BN(FILL_DEADLINE_HOURS), seed)
        .accounts({
          escrow: escrowPda,
          operator: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      const players = await createTestPlayers(3);

      // First two join successfully
      for (let i = 0; i < 2; i++) {
        await program.methods
          .joinGame()
          .accounts({
            escrow: escrowPda,
            player: players[i].publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([players[i]])
          .rpc();
      }

      // Third should fail
      try {
        await program.methods
          .joinGame()
          .accounts({
            escrow: escrowPda,
            player: players[2].publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([players[2]])
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("GameNotOpen");
      }
    });

    it("rejects when already joined", async () => {
      const gameId = generateGameId();
      const seed = generateSeed();
      const [escrowPda] = getEscrowPda(gameId);

      await program.methods
        .createGame(gameId, new anchor.BN(BUY_IN), MAX_PLAYERS, new anchor.BN(FILL_DEADLINE_HOURS), seed)
        .accounts({
          escrow: escrowPda,
          operator: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      const [player] = await createTestPlayers(1);

      // First join
      await program.methods
        .joinGame()
        .accounts({
          escrow: escrowPda,
          player: player.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([player])
        .rpc();

      // Second join should fail
      try {
        await program.methods
          .joinGame()
          .accounts({
            escrow: escrowPda,
            player: player.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([player])
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("AlreadyJoined");
      }
    });

    it("rejects when operator tries to join", async () => {
      const gameId = generateGameId();
      const seed = generateSeed();
      const [escrowPda] = getEscrowPda(gameId);

      await program.methods
        .createGame(gameId, new anchor.BN(BUY_IN), MAX_PLAYERS, new anchor.BN(FILL_DEADLINE_HOURS), seed)
        .accounts({
          escrow: escrowPda,
          operator: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      try {
        await program.methods
          .joinGame()
          .accounts({
            escrow: escrowPda,
            player: provider.wallet.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("OperatorCannotPlay");
      }
    });
  });

  // =============================================================================
  // Start Game Tests
  // =============================================================================

  describe("start_game", () => {
    it("starts a filled game", async () => {
      const gameId = generateGameId();
      const seed = generateSeed();
      const [escrowPda] = getEscrowPda(gameId);
      const maxPlayers = 2;

      await program.methods
        .createGame(gameId, new anchor.BN(BUY_IN), maxPlayers, new anchor.BN(FILL_DEADLINE_HOURS), seed)
        .accounts({
          escrow: escrowPda,
          operator: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      const players = await createTestPlayers(2);
      for (const player of players) {
        await program.methods
          .joinGame()
          .accounts({
            escrow: escrowPda,
            player: player.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([player])
          .rpc();
      }

      await program.methods
        .startGame()
        .accounts({
          escrow: escrowPda,
          operator: provider.wallet.publicKey,
        })
        .rpc();

      const escrow = await program.account.gameEscrow.fetch(escrowPda);
      expect(escrow.status).to.deep.equal({ active: {} });
      expect(escrow.startedAt).to.not.be.null;
    });

    it("rejects when game not filled", async () => {
      const gameId = generateGameId();
      const seed = generateSeed();
      const [escrowPda] = getEscrowPda(gameId);

      await program.methods
        .createGame(gameId, new anchor.BN(BUY_IN), MAX_PLAYERS, new anchor.BN(FILL_DEADLINE_HOURS), seed)
        .accounts({
          escrow: escrowPda,
          operator: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      try {
        await program.methods
          .startGame()
          .accounts({
            escrow: escrowPda,
            operator: provider.wallet.publicKey,
          })
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("GameNotFilled");
      }
    });

    it("rejects when not operator", async () => {
      const gameId = generateGameId();
      const seed = generateSeed();
      const [escrowPda] = getEscrowPda(gameId);
      const maxPlayers = 2;

      await program.methods
        .createGame(gameId, new anchor.BN(BUY_IN), maxPlayers, new anchor.BN(FILL_DEADLINE_HOURS), seed)
        .accounts({
          escrow: escrowPda,
          operator: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      const players = await createTestPlayers(2);
      for (const player of players) {
        await program.methods
          .joinGame()
          .accounts({
            escrow: escrowPda,
            player: player.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([player])
          .rpc();
      }

      const fakeOperator = Keypair.generate();
      const sig = await provider.connection.requestAirdrop(fakeOperator.publicKey, LAMPORTS_PER_SOL);
      await provider.connection.confirmTransaction(sig);

      try {
        await program.methods
          .startGame()
          .accounts({
            escrow: escrowPda,
            operator: fakeOperator.publicKey,
          })
          .signers([fakeOperator])
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("UnauthorizedOperator");
      }
    });
  });

  // =============================================================================
  // Declare Winner Tests
  // =============================================================================

  describe("declare_winner", () => {
    it("declares winner and transfers funds", async () => {
      const gameId = generateGameId();
      const seed = generateSeed();
      const [escrowPda] = getEscrowPda(gameId);
      const maxPlayers = 2;
      const proofHash = new Array(32).fill(0);

      await program.methods
        .createGame(gameId, new anchor.BN(BUY_IN), maxPlayers, new anchor.BN(FILL_DEADLINE_HOURS), seed)
        .accounts({
          escrow: escrowPda,
          operator: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      const players = await createTestPlayers(2);
      for (const player of players) {
        await program.methods
          .joinGame()
          .accounts({
            escrow: escrowPda,
            player: player.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([player])
          .rpc();
      }

      await program.methods
        .startGame()
        .accounts({
          escrow: escrowPda,
          operator: provider.wallet.publicKey,
        })
        .rpc();

      // Wait for minimum game time (1 minute in the contract, but we're testing locally)
      // In tests, we need to wait or mock time
      await sleep(1500); // Wait a bit to ensure time passes

      const winner = players[0];
      const winnerBalanceBefore = await provider.connection.getBalance(winner.publicKey);

      await program.methods
        .declareWinner(winner.publicKey, proofHash)
        .accounts({
          escrow: escrowPda,
          operator: provider.wallet.publicKey,
          winner: winner.publicKey,
        })
        .rpc();

      const escrow = await program.account.gameEscrow.fetch(escrowPda);
      expect(escrow.status).to.deep.equal({ complete: {} });
      expect(escrow.winner?.toString()).to.equal(winner.publicKey.toString());

      const winnerBalanceAfter = await provider.connection.getBalance(winner.publicKey);
      expect(winnerBalanceAfter).to.be.greaterThan(winnerBalanceBefore);
    });

    it("rejects when winner not a player", async () => {
      const gameId = generateGameId();
      const seed = generateSeed();
      const [escrowPda] = getEscrowPda(gameId);
      const maxPlayers = 2;
      const proofHash = new Array(32).fill(0);

      await program.methods
        .createGame(gameId, new anchor.BN(BUY_IN), maxPlayers, new anchor.BN(FILL_DEADLINE_HOURS), seed)
        .accounts({
          escrow: escrowPda,
          operator: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      const players = await createTestPlayers(2);
      for (const player of players) {
        await program.methods
          .joinGame()
          .accounts({
            escrow: escrowPda,
            player: player.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([player])
          .rpc();
      }

      await program.methods
        .startGame()
        .accounts({
          escrow: escrowPda,
          operator: provider.wallet.publicKey,
        })
        .rpc();

      await sleep(1500);

      const fakeWinner = Keypair.generate();

      try {
        await program.methods
          .declareWinner(fakeWinner.publicKey, proofHash)
          .accounts({
            escrow: escrowPda,
            operator: provider.wallet.publicKey,
            winner: fakeWinner.publicKey,
          })
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("WinnerNotPlayer");
      }
    });
  });

  // =============================================================================
  // Cancel & Refund Tests
  // =============================================================================

  describe("cancel_game and claim_refund", () => {
    it("cancels an open game", async () => {
      const gameId = generateGameId();
      const seed = generateSeed();
      const [escrowPda] = getEscrowPda(gameId);

      await program.methods
        .createGame(gameId, new anchor.BN(BUY_IN), MAX_PLAYERS, new anchor.BN(FILL_DEADLINE_HOURS), seed)
        .accounts({
          escrow: escrowPda,
          operator: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .cancelGame()
        .accounts({
          escrow: escrowPda,
          operator: provider.wallet.publicKey,
        })
        .rpc();

      const escrow = await program.account.gameEscrow.fetch(escrowPda);
      expect(escrow.status).to.deep.equal({ cancelled: {} });
    });

    it("claims refund after cancellation", async () => {
      const gameId = generateGameId();
      const seed = generateSeed();
      const [escrowPda] = getEscrowPda(gameId);

      await program.methods
        .createGame(gameId, new anchor.BN(BUY_IN), MAX_PLAYERS, new anchor.BN(FILL_DEADLINE_HOURS), seed)
        .accounts({
          escrow: escrowPda,
          operator: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      const [player] = await createTestPlayers(1);

      await program.methods
        .joinGame()
        .accounts({
          escrow: escrowPda,
          player: player.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([player])
        .rpc();

      const balanceAfterJoin = await provider.connection.getBalance(player.publicKey);

      await program.methods
        .cancelGame()
        .accounts({
          escrow: escrowPda,
          operator: provider.wallet.publicKey,
        })
        .rpc();

      await program.methods
        .claimRefund()
        .accounts({
          escrow: escrowPda,
          player: player.publicKey,
        })
        .signers([player])
        .rpc();

      const balanceAfterRefund = await provider.connection.getBalance(player.publicKey);
      expect(balanceAfterRefund - balanceAfterJoin).to.be.approximately(BUY_IN, 10000); // Allow for tx fees

      const escrow = await program.account.gameEscrow.fetch(escrowPda);
      expect(escrow.refunded[0]).to.be.true;
    });

    it("prevents double refund", async () => {
      const gameId = generateGameId();
      const seed = generateSeed();
      const [escrowPda] = getEscrowPda(gameId);

      await program.methods
        .createGame(gameId, new anchor.BN(BUY_IN), MAX_PLAYERS, new anchor.BN(FILL_DEADLINE_HOURS), seed)
        .accounts({
          escrow: escrowPda,
          operator: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      const [player] = await createTestPlayers(1);

      await program.methods
        .joinGame()
        .accounts({
          escrow: escrowPda,
          player: player.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .signers([player])
        .rpc();

      await program.methods
        .cancelGame()
        .accounts({
          escrow: escrowPda,
          operator: provider.wallet.publicKey,
        })
        .rpc();

      await program.methods
        .claimRefund()
        .accounts({
          escrow: escrowPda,
          player: player.publicKey,
        })
        .signers([player])
        .rpc();

      try {
        await program.methods
          .claimRefund()
          .accounts({
            escrow: escrowPda,
            player: player.publicKey,
          })
          .signers([player])
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("AlreadyRefunded");
      }
    });

    it("rejects refund when not in game", async () => {
      const gameId = generateGameId();
      const seed = generateSeed();
      const [escrowPda] = getEscrowPda(gameId);

      await program.methods
        .createGame(gameId, new anchor.BN(BUY_IN), MAX_PLAYERS, new anchor.BN(FILL_DEADLINE_HOURS), seed)
        .accounts({
          escrow: escrowPda,
          operator: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      await program.methods
        .cancelGame()
        .accounts({
          escrow: escrowPda,
          operator: provider.wallet.publicKey,
        })
        .rpc();

      const [nonPlayer] = await createTestPlayers(1);

      try {
        await program.methods
          .claimRefund()
          .accounts({
            escrow: escrowPda,
            player: nonPlayer.publicKey,
          })
          .signers([nonPlayer])
          .rpc();
        expect.fail("Should have thrown error");
      } catch (err: any) {
        expect(err.error.errorCode.code).to.equal("PlayerNotInGame");
      }
    });
  });

  // =============================================================================
  // Emergency Halt Tests
  // =============================================================================

  describe("emergency_halt and resume_game", () => {
    it("halts an active game", async () => {
      const gameId = generateGameId();
      const seed = generateSeed();
      const [escrowPda] = getEscrowPda(gameId);
      const maxPlayers = 2;

      await program.methods
        .createGame(gameId, new anchor.BN(BUY_IN), maxPlayers, new anchor.BN(FILL_DEADLINE_HOURS), seed)
        .accounts({
          escrow: escrowPda,
          operator: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      const players = await createTestPlayers(2);
      for (const player of players) {
        await program.methods
          .joinGame()
          .accounts({
            escrow: escrowPda,
            player: player.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([player])
          .rpc();
      }

      await program.methods
        .startGame()
        .accounts({
          escrow: escrowPda,
          operator: provider.wallet.publicKey,
        })
        .rpc();

      await program.methods
        .emergencyHalt()
        .accounts({
          escrow: escrowPda,
          operator: provider.wallet.publicKey,
        })
        .rpc();

      const escrow = await program.account.gameEscrow.fetch(escrowPda);
      expect(escrow.status).to.deep.equal({ paused: {} });
    });

    it("resumes a halted game", async () => {
      const gameId = generateGameId();
      const seed = generateSeed();
      const [escrowPda] = getEscrowPda(gameId);
      const maxPlayers = 2;

      await program.methods
        .createGame(gameId, new anchor.BN(BUY_IN), maxPlayers, new anchor.BN(FILL_DEADLINE_HOURS), seed)
        .accounts({
          escrow: escrowPda,
          operator: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      const players = await createTestPlayers(2);
      for (const player of players) {
        await program.methods
          .joinGame()
          .accounts({
            escrow: escrowPda,
            player: player.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([player])
          .rpc();
      }

      await program.methods
        .startGame()
        .accounts({
          escrow: escrowPda,
          operator: provider.wallet.publicKey,
        })
        .rpc();

      await program.methods
        .emergencyHalt()
        .accounts({
          escrow: escrowPda,
          operator: provider.wallet.publicKey,
        })
        .rpc();

      await program.methods
        .resumeGame()
        .accounts({
          escrow: escrowPda,
          operator: provider.wallet.publicKey,
        })
        .rpc();

      const escrow = await program.account.gameEscrow.fetch(escrowPda);
      expect(escrow.status).to.deep.equal({ active: {} });
    });

    it("cancels a halted game and allows refunds", async () => {
      const gameId = generateGameId();
      const seed = generateSeed();
      const [escrowPda] = getEscrowPda(gameId);
      const maxPlayers = 2;

      await program.methods
        .createGame(gameId, new anchor.BN(BUY_IN), maxPlayers, new anchor.BN(FILL_DEADLINE_HOURS), seed)
        .accounts({
          escrow: escrowPda,
          operator: provider.wallet.publicKey,
          systemProgram: anchor.web3.SystemProgram.programId,
        })
        .rpc();

      const players = await createTestPlayers(2);
      for (const player of players) {
        await program.methods
          .joinGame()
          .accounts({
            escrow: escrowPda,
            player: player.publicKey,
            systemProgram: anchor.web3.SystemProgram.programId,
          })
          .signers([player])
          .rpc();
      }

      await program.methods
        .startGame()
        .accounts({
          escrow: escrowPda,
          operator: provider.wallet.publicKey,
        })
        .rpc();

      await program.methods
        .emergencyHalt()
        .accounts({
          escrow: escrowPda,
          operator: provider.wallet.publicKey,
        })
        .rpc();

      await program.methods
        .cancelGame()
        .accounts({
          escrow: escrowPda,
          operator: provider.wallet.publicKey,
        })
        .rpc();

      const escrow = await program.account.gameEscrow.fetch(escrowPda);
      expect(escrow.status).to.deep.equal({ cancelled: {} });

      // Refund works
      for (const player of players) {
        await program.methods
          .claimRefund()
          .accounts({
            escrow: escrowPda,
            player: player.publicKey,
          })
          .signers([player])
          .rpc();
      }

      const escrowAfter = await program.account.gameEscrow.fetch(escrowPda);
      expect(escrowAfter.refunded.every((r) => r)).to.be.true;
    });
  });
});
