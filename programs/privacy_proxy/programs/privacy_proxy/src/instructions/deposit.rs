/// Deposit to pool - ONLY callable by authorized relayer
/// The relayer verified the user's unblinded token off-chain, then deposits using its own funds
/// The relayer maintains the authoritative Poseidon-based Merkle tree, that matches the ZK circuit
/// On-chain we just track commitments and verify during withdrawal via ZK proofs
use anchor_lang::prelude::*;
use anchor_lang::system_program;

use crate::constants::*;
use crate::errors::PrivacyProxyError;
use crate::state::{
    DepositPool, EncryptedNote, GlobalConfig, HistoricalRoots, UsedToken, HISTORICAL_ROOTS_SEED,
};

#[derive(Accounts)]
#[instruction(bucket_id: u8, commitment: [u8; 32], token_hash: [u8; 32])]
pub struct Deposit<'info> {
    /// Relayer executing the deposit (pays fees and funds)
    #[account(mut)]
    pub relayer: Signer<'info>,

    /// Global config - we only read authorized_relayer field
    /// CHECK: We manually verify this is the correct config PDA in the handler
    pub config: UncheckedAccount<'info>,

    /// Deposit pool for this bucket
    #[account(
        mut,
        seeds = [POOL_SEED, &[bucket_id]],
        bump = pool.bump,
    )]
    pub pool: Account<'info, DepositPool>,

    /// Historical roots account for this pool
    #[account(
        mut,
        seeds = [HISTORICAL_ROOTS_SEED, pool.key().as_ref(), &[0u8]],
        bump = historical_roots.bump,
    )]
    pub historical_roots: Account<'info, HistoricalRoots>,

    /// Used token record - prevents double-redemption
    /// Include bucket_id in seeds to prevent token replay across pools
    /// Uses new format with bucket_id for security
    #[account(
        init,
        payer = relayer,
        space = UsedToken::SIZE,
        seeds = [USED_TOKEN_SEED, &[bucket_id], &token_hash],
        bump,
    )]
    pub used_token: Account<'info, UsedToken>,

    /// Encrypted note for user recovery
    #[account(
        init,
        payer = relayer,
        space = EncryptedNote::SIZE,
        seeds = [NOTE_SEED, pool.key().as_ref(), &pool.next_index.to_le_bytes()],
        bump,
    )]
    pub encrypted_note: Account<'info, EncryptedNote>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<Deposit>,
    bucket_id: u8,
    _commitment: [u8; 32],
    token_hash: [u8; 32],
    encrypted_note_data: Vec<u8>,
    merkle_root: [u8; 32], // Actual Merkle root from relayer
) -> Result<()> {
    // Verify config is the correct PDA
    let (expected_config_pda, _) = Pubkey::find_program_address(
        &[CONFIG_SEED],
        ctx.program_id,
    );
    require!(
        ctx.accounts.config.key() == expected_config_pda,
        PrivacyProxyError::UnauthorizedRelayer
    );
    
    // Manually deserialize only the fields we need from GlobalConfig
    // This avoids loading the entire 300+ byte struct onto the stack
    let config_data = ctx.accounts.config.try_borrow_data()?;
    
    // OLD GlobalConfig layout (434 bytes):
    // 8: discriminator
    // 32: admin (8-39)
    // 32: relayer_treasury (40-71)
    // 32: authorized_relayer (72-103)
    // 256: relayer_signing_key_n (104-359)
    // 4: relayer_signing_key_e (360-363)
    // 2: fee_bps (364-365)
    // 1: min_delay_hours (366)
    // 1: max_delay_hours (367)
    // 1: paused (368)
    // 1: bump (369)
    // 64: padding (370-433)
    
    if config_data.len() < 369 {
        return Err(PrivacyProxyError::UnauthorizedRelayer.into());
    }
    
    let mut authorized_relayer_bytes = [0u8; 32];
    authorized_relayer_bytes.copy_from_slice(&config_data[72..104]);
    let authorized_relayer = Pubkey::new_from_array(authorized_relayer_bytes);
    
    // Verify relayer is authorized
    require!(
        ctx.accounts.relayer.key() == authorized_relayer,
        PrivacyProxyError::UnauthorizedRelayer
    );
    
    // Check if paused (at offset 368)
    let paused = config_data[368] != 0;
    require!(!paused, PrivacyProxyError::ProtocolPaused);

    let pool = &mut ctx.accounts.pool;
    let historical_roots = &mut ctx.accounts.historical_roots;
    let used_token = &mut ctx.accounts.used_token;
    let note = &mut ctx.accounts.encrypted_note;

    // Validate bucket
    require!(
        (bucket_id as usize) < NUM_BUCKETS,
        PrivacyProxyError::InvalidBucketId
    );

    // Validate encrypted note size
    require!(
        encrypted_note_data.len() <= MAX_ENCRYPTED_NOTE_SIZE,
        PrivacyProxyError::NoteTooLarge
    );

    let amount = BUCKET_AMOUNTS[bucket_id as usize];

    // Transfer funds from relayer to pool
    system_program::transfer(
        CpiContext::new(
            ctx.accounts.system_program.to_account_info(),
            system_program::Transfer {
                from: ctx.accounts.relayer.to_account_info(),
                to: pool.to_account_info(),
            },
        ),
        amount,
    )?;

    // Save current root to history before updating
    historical_roots.add_root(pool.merkle_root);
    pool.add_root_to_history();

    // The relayer maintains the authoritative Poseidon-based Merkle tree, that matches the ZK circuit
    pool.merkle_root = merkle_root;

    let leaf_index = pool.next_index;
    pool.next_index = pool
        .next_index
        .checked_add(1)
        .ok_or(PrivacyProxyError::PoolFull)?;
    pool.total_deposits = pool
        .total_deposits
        .checked_add(1)
        .ok_or(PrivacyProxyError::Overflow)?;
    pool.anonymity_set_size = pool
        .anonymity_set_size
        .checked_add(1)
        .ok_or(PrivacyProxyError::Overflow)?;

    // Mark token as used
    used_token.bucket_id = bucket_id;
    used_token.token_hash = token_hash;
    used_token.redeemed_at = Clock::get()?.unix_timestamp;
    used_token.bump = ctx.bumps.used_token;

    // Store encrypted note
    note.pool = pool.key();
    note.leaf_index = leaf_index;
    note.ciphertext[..encrypted_note_data.len()].copy_from_slice(&encrypted_note_data);
    note.ciphertext_len = encrypted_note_data.len() as u16;
    note.created_at = Clock::get()?.unix_timestamp;
    note.bump = ctx.bumps.encrypted_note;

    msg!("Deposit successful");
    msg!("Pool: bucket {}", bucket_id);
    msg!("Amount: {} lamports", amount);
    msg!("Leaf index: {}", leaf_index);
    msg!("Merkle root: {:?}", &merkle_root[..8]);

    Ok(())
}
