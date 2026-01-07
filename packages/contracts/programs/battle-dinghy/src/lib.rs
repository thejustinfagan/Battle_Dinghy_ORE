use anchor_lang::prelude::*;
use anchor_lang::system_program;

declare_id!("BDghy1111111111111111111111111111111111111");

// =============================================================================
// Constants
// =============================================================================

pub const MAX_GAME_ID_LEN: usize = 32;
pub const MAX_PLAYERS: usize = 10;
pub const MINIMUM_GAME_TIME: i64 = 60; // 1 minute minimum before winner can be declared

// Account size calculation:
// discriminator: 8
// game_id (String): 4 + 32 = 36
// operator: 32
// status: 1
// buy_in: 8
// max_players: 1
// current_players: 1
// players (Vec<Pubkey>): 4 + (32 * 10) = 324
// seed: 32
// winner (Option<Pubkey>): 1 + 32 = 33
// proof_hash (Option<[u8; 32]>): 1 + 32 = 33
// created_at: 8
// fill_deadline: 8
// started_at (Option<i64>): 1 + 8 = 9
// bump: 1
// refunded (Vec<bool>): 4 + 10 = 14
// Total: 8 + 36 + 32 + 1 + 8 + 1 + 1 + 324 + 32 + 33 + 33 + 8 + 8 + 9 + 1 + 14 = 549
// Add padding: 600
pub const ESCROW_SIZE: usize = 600;

// =============================================================================
// Error Codes
// =============================================================================

#[error_code]
pub enum BattleDinghyError {
    #[msg("Game is full")]
    GameFull,
    #[msg("Game is not open for joining")]
    GameNotOpen,
    #[msg("Incorrect buy-in amount")]
    IncorrectBuyIn,
    #[msg("Player has already joined this game")]
    AlreadyJoined,
    #[msg("Not enough players to start")]
    NotEnoughPlayers,
    #[msg("Game has already started")]
    GameAlreadyStarted,
    #[msg("Game is not active")]
    GameNotActive,
    #[msg("Unauthorized: not the operator")]
    UnauthorizedOperator,
    #[msg("Fill deadline has not been reached")]
    DeadlineNotReached,
    #[msg("Fill deadline has passed")]
    DeadlinePassed,
    #[msg("Too early to declare winner")]
    TooEarlyForWinner,
    #[msg("Winner is not a player in this game")]
    WinnerNotPlayer,
    #[msg("Player is not in this game")]
    PlayerNotInGame,
    #[msg("Refund not available")]
    RefundNotAvailable,
    #[msg("Game is paused")]
    GamePaused,
    #[msg("Operator cannot play in their own game")]
    OperatorCannotPlay,
    #[msg("Game ID too long")]
    GameIdTooLong,
    #[msg("Invalid max players")]
    InvalidMaxPlayers,
    #[msg("Invalid buy-in amount")]
    InvalidBuyIn,
    #[msg("Invalid fill deadline")]
    InvalidFillDeadline,
    #[msg("Already refunded")]
    AlreadyRefunded,
    #[msg("Game not cancelled")]
    GameNotCancelled,
    #[msg("Cannot cancel game in current state")]
    CannotCancel,
    #[msg("Game not paused")]
    GameNotPaused,
    #[msg("Game not filled")]
    GameNotFilled,
}

// =============================================================================
// Game Status
// =============================================================================

#[derive(AnchorSerialize, AnchorDeserialize, Clone, Copy, PartialEq, Eq, Debug)]
#[repr(u8)]
pub enum GameStatus {
    Open = 0,
    Filled = 1,
    Active = 2,
    Complete = 3,
    Cancelled = 4,
    Paused = 5,
}

impl Default for GameStatus {
    fn default() -> Self {
        GameStatus::Open
    }
}

// =============================================================================
// Accounts
// =============================================================================

#[account]
#[derive(Default)]
pub struct GameEscrow {
    pub game_id: String,
    pub operator: Pubkey,
    pub status: GameStatus,
    pub buy_in: u64,
    pub max_players: u8,
    pub current_players: u8,
    pub players: Vec<Pubkey>,
    pub seed: [u8; 32],
    pub winner: Option<Pubkey>,
    pub proof_hash: Option<[u8; 32]>,
    pub created_at: i64,
    pub fill_deadline: i64,
    pub started_at: Option<i64>,
    pub bump: u8,
    pub refunded: Vec<bool>,
}

// =============================================================================
// Program Instructions
// =============================================================================

#[program]
pub mod battle_dinghy {
    use super::*;

    /// Create a new game escrow
    pub fn create_game(
        ctx: Context<CreateGame>,
        game_id: String,
        buy_in: u64,
        max_players: u8,
        fill_deadline_hours: u64,
        seed: [u8; 32],
    ) -> Result<()> {
        // Validations
        require!(game_id.len() <= MAX_GAME_ID_LEN, BattleDinghyError::GameIdTooLong);
        require!(max_players > 0 && max_players as usize <= MAX_PLAYERS, BattleDinghyError::InvalidMaxPlayers);
        require!(buy_in > 0, BattleDinghyError::InvalidBuyIn);
        require!(fill_deadline_hours > 0, BattleDinghyError::InvalidFillDeadline);

        let escrow = &mut ctx.accounts.escrow;
        let clock = Clock::get()?;

        escrow.game_id = game_id;
        escrow.operator = ctx.accounts.operator.key();
        escrow.status = GameStatus::Open;
        escrow.buy_in = buy_in;
        escrow.max_players = max_players;
        escrow.current_players = 0;
        escrow.players = Vec::with_capacity(max_players as usize);
        escrow.seed = seed;
        escrow.winner = None;
        escrow.proof_hash = None;
        escrow.created_at = clock.unix_timestamp;
        escrow.fill_deadline = clock.unix_timestamp + (fill_deadline_hours as i64 * 3600);
        escrow.started_at = None;
        escrow.bump = ctx.bumps.escrow;
        escrow.refunded = Vec::with_capacity(max_players as usize);

        msg!("Game {} created with buy-in {} lamports", escrow.game_id, buy_in);
        Ok(())
    }

    /// Join an open game
    pub fn join_game(ctx: Context<JoinGame>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        let player = &ctx.accounts.player;
        let clock = Clock::get()?;

        // Validations
        require!(escrow.status == GameStatus::Open, BattleDinghyError::GameNotOpen);
        require!(escrow.current_players < escrow.max_players, BattleDinghyError::GameFull);
        require!(clock.unix_timestamp < escrow.fill_deadline, BattleDinghyError::DeadlinePassed);
        require!(player.key() != escrow.operator, BattleDinghyError::OperatorCannotPlay);
        require!(!escrow.players.contains(&player.key()), BattleDinghyError::AlreadyJoined);

        // Transfer buy-in from player to escrow
        let transfer_ix = system_program::Transfer {
            from: ctx.accounts.player.to_account_info(),
            to: ctx.accounts.escrow.to_account_info(),
        };
        let cpi_ctx = CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            transfer_ix,
        );
        system_program::transfer(cpi_ctx, escrow.buy_in)?;

        // Add player
        escrow.players.push(player.key());
        escrow.refunded.push(false);
        escrow.current_players += 1;

        // Check if game is now full
        if escrow.current_players == escrow.max_players {
            escrow.status = GameStatus::Filled;
            msg!("Game {} is now filled!", escrow.game_id);
        }

        msg!("Player {} joined game {}", player.key(), escrow.game_id);
        Ok(())
    }

    /// Start a filled game
    pub fn start_game(ctx: Context<StartGame>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        let clock = Clock::get()?;

        // Validations
        require!(escrow.status == GameStatus::Filled, BattleDinghyError::GameNotFilled);
        require!(ctx.accounts.operator.key() == escrow.operator, BattleDinghyError::UnauthorizedOperator);

        escrow.status = GameStatus::Active;
        escrow.started_at = Some(clock.unix_timestamp);

        msg!("Game {} started!", escrow.game_id);
        Ok(())
    }

    /// Declare the winner and transfer funds
    pub fn declare_winner(
        ctx: Context<DeclareWinner>,
        winner: Pubkey,
        proof_hash: [u8; 32],
    ) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        let clock = Clock::get()?;

        // Validations
        require!(escrow.status == GameStatus::Active, BattleDinghyError::GameNotActive);
        require!(ctx.accounts.operator.key() == escrow.operator, BattleDinghyError::UnauthorizedOperator);
        require!(escrow.players.contains(&winner), BattleDinghyError::WinnerNotPlayer);

        // Check minimum game time has passed
        if let Some(started_at) = escrow.started_at {
            require!(
                clock.unix_timestamp >= started_at + MINIMUM_GAME_TIME,
                BattleDinghyError::TooEarlyForWinner
            );
        }

        // Transfer all lamports from escrow to winner
        let escrow_lamports = ctx.accounts.escrow.to_account_info().lamports();
        let rent = Rent::get()?;
        let rent_exempt = rent.minimum_balance(ESCROW_SIZE);
        let transfer_amount = escrow_lamports.saturating_sub(rent_exempt);

        if transfer_amount > 0 {
            **ctx.accounts.escrow.to_account_info().try_borrow_mut_lamports()? -= transfer_amount;
            **ctx.accounts.winner.to_account_info().try_borrow_mut_lamports()? += transfer_amount;
        }

        // Update state
        escrow.winner = Some(winner);
        escrow.proof_hash = Some(proof_hash);
        escrow.status = GameStatus::Complete;

        msg!("Game {} complete! Winner: {}", escrow.game_id, winner);
        Ok(())
    }

    /// Cancel a game (only if Open, or Filled+deadline passed, or Paused)
    pub fn cancel_game(ctx: Context<CancelGame>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        let clock = Clock::get()?;

        // Validations
        require!(ctx.accounts.operator.key() == escrow.operator, BattleDinghyError::UnauthorizedOperator);

        let can_cancel = match escrow.status {
            GameStatus::Open => true,
            GameStatus::Filled => clock.unix_timestamp > escrow.fill_deadline,
            GameStatus::Paused => true,
            _ => false,
        };
        require!(can_cancel, BattleDinghyError::CannotCancel);

        escrow.status = GameStatus::Cancelled;

        msg!("Game {} cancelled", escrow.game_id);
        Ok(())
    }

    /// Claim refund from a cancelled game
    pub fn claim_refund(ctx: Context<ClaimRefund>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;
        let player = &ctx.accounts.player;

        // Validations
        require!(escrow.status == GameStatus::Cancelled, BattleDinghyError::GameNotCancelled);

        // Find player index
        let player_index = escrow
            .players
            .iter()
            .position(|p| p == &player.key())
            .ok_or(BattleDinghyError::PlayerNotInGame)?;

        require!(!escrow.refunded[player_index], BattleDinghyError::AlreadyRefunded);

        // Transfer refund
        **ctx.accounts.escrow.to_account_info().try_borrow_mut_lamports()? -= escrow.buy_in;
        **ctx.accounts.player.to_account_info().try_borrow_mut_lamports()? += escrow.buy_in;

        escrow.refunded[player_index] = true;

        msg!("Player {} refunded {} lamports", player.key(), escrow.buy_in);
        Ok(())
    }

    /// Emergency halt an active game
    pub fn emergency_halt(ctx: Context<EmergencyHalt>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;

        // Validations
        require!(escrow.status == GameStatus::Active, BattleDinghyError::GameNotActive);
        require!(ctx.accounts.operator.key() == escrow.operator, BattleDinghyError::UnauthorizedOperator);

        escrow.status = GameStatus::Paused;

        msg!("Game {} halted", escrow.game_id);
        Ok(())
    }

    /// Resume a paused game
    pub fn resume_game(ctx: Context<ResumeGame>) -> Result<()> {
        let escrow = &mut ctx.accounts.escrow;

        // Validations
        require!(escrow.status == GameStatus::Paused, BattleDinghyError::GameNotPaused);
        require!(ctx.accounts.operator.key() == escrow.operator, BattleDinghyError::UnauthorizedOperator);

        escrow.status = GameStatus::Active;

        msg!("Game {} resumed", escrow.game_id);
        Ok(())
    }
}

// =============================================================================
// Account Contexts
// =============================================================================

#[derive(Accounts)]
#[instruction(game_id: String)]
pub struct CreateGame<'info> {
    #[account(
        init,
        payer = operator,
        space = ESCROW_SIZE,
        seeds = [b"escrow", game_id.as_bytes()],
        bump
    )]
    pub escrow: Account<'info, GameEscrow>,

    #[account(mut)]
    pub operator: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct JoinGame<'info> {
    #[account(
        mut,
        seeds = [b"escrow", escrow.game_id.as_bytes()],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, GameEscrow>,

    #[account(mut)]
    pub player: Signer<'info>,

    pub system_program: Program<'info, System>,
}

#[derive(Accounts)]
pub struct StartGame<'info> {
    #[account(
        mut,
        seeds = [b"escrow", escrow.game_id.as_bytes()],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, GameEscrow>,

    #[account(mut)]
    pub operator: Signer<'info>,
}

#[derive(Accounts)]
pub struct DeclareWinner<'info> {
    #[account(
        mut,
        seeds = [b"escrow", escrow.game_id.as_bytes()],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, GameEscrow>,

    #[account(mut)]
    pub operator: Signer<'info>,

    /// CHECK: Winner account to receive funds, validated against players list
    #[account(mut)]
    pub winner: AccountInfo<'info>,
}

#[derive(Accounts)]
pub struct CancelGame<'info> {
    #[account(
        mut,
        seeds = [b"escrow", escrow.game_id.as_bytes()],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, GameEscrow>,

    #[account(mut)]
    pub operator: Signer<'info>,
}

#[derive(Accounts)]
pub struct ClaimRefund<'info> {
    #[account(
        mut,
        seeds = [b"escrow", escrow.game_id.as_bytes()],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, GameEscrow>,

    #[account(mut)]
    pub player: Signer<'info>,
}

#[derive(Accounts)]
pub struct EmergencyHalt<'info> {
    #[account(
        mut,
        seeds = [b"escrow", escrow.game_id.as_bytes()],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, GameEscrow>,

    #[account(mut)]
    pub operator: Signer<'info>,
}

#[derive(Accounts)]
pub struct ResumeGame<'info> {
    #[account(
        mut,
        seeds = [b"escrow", escrow.game_id.as_bytes()],
        bump = escrow.bump,
    )]
    pub escrow: Account<'info, GameEscrow>,

    #[account(mut)]
    pub operator: Signer<'info>,
}
