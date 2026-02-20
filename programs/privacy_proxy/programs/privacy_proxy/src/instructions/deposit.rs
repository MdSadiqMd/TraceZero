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
    #[account(
        mut,
        constraint = relayer.key() == config.authorized_relayer @ PrivacyProxyError::UnauthorizedRelayer
    )]
    pub relayer: Signer<'info>,

    /// Global config
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
    )]
    pub config: Account<'info, GlobalConfig>,

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
    #[account(
        init,
        payer = relayer,
        space = UsedToken::SIZE,
        seeds = [USED_TOKEN_SEED, &token_hash],
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
    let config = &ctx.accounts.config;
    let pool = &mut ctx.accounts.pool;
    let historical_roots = &mut ctx.accounts.historical_roots;
    let used_token = &mut ctx.accounts.used_token;
    let note = &mut ctx.accounts.encrypted_note;

    // Check protocol not paused
    require!(!config.paused, PrivacyProxyError::ProtocolPaused);

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
