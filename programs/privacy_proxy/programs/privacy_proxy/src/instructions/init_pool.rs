/// Initialize a deposit pool and its historical roots account
/// Creates both the DepositPool and HistoricalRoots accounts for a bucket
/// Must be called once per bucket before deposits can be made
use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::PrivacyProxyError;
use crate::state::{DepositPool, GlobalConfig, HistoricalRoots, HISTORICAL_ROOTS_SEED};

#[derive(Accounts)]
#[instruction(bucket_id: u8)]
pub struct InitPool<'info> {
    /// Admin initializing the pool
    #[account(
        mut,
        constraint = admin.key() == config.admin @ PrivacyProxyError::UnauthorizedRelayer
    )]
    pub admin: Signer<'info>,

    /// Global config
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
    )]
    pub config: Account<'info, GlobalConfig>,

    /// Deposit pool to initialize
    #[account(
        init,
        payer = admin,
        space = DepositPool::SIZE,
        seeds = [POOL_SEED, &[bucket_id]],
        bump,
    )]
    pub pool: Account<'info, DepositPool>,

    /// Historical roots account for this pool
    #[account(
        init,
        payer = admin,
        space = HistoricalRoots::SIZE,
        seeds = [HISTORICAL_ROOTS_SEED, pool.key().as_ref(), &[0u8]],
        bump,
    )]
    pub historical_roots: Account<'info, HistoricalRoots>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<InitPool>, bucket_id: u8) -> Result<()> {
    // Validate bucket ID
    require!(
        (bucket_id as usize) < NUM_BUCKETS,
        PrivacyProxyError::InvalidBucketId
    );

    let pool = &mut ctx.accounts.pool;
    let historical_roots = &mut ctx.accounts.historical_roots;

    // Initialize pool
    pool.bucket_id = bucket_id;
    pool.amount_lamports = BUCKET_AMOUNTS[bucket_id as usize];
    pool.merkle_root = get_initial_merkle_root();
    pool.next_index = 0;
    pool.total_deposits = 0;
    pool.anonymity_set_size = 0;
    pool.historical_roots_index = 0;
    pool.bump = ctx.bumps.pool;

    // Initialize historical roots
    historical_roots.pool = pool.key();
    historical_roots.bucket_id = bucket_id;
    historical_roots.account_index = 0;
    historical_roots.write_index = 0;
    historical_roots.count = 0;
    historical_roots.bump = ctx.bumps.historical_roots;

    msg!("Pool initialized");
    msg!("Bucket ID: {}", bucket_id);
    msg!("Amount: {} lamports", pool.amount_lamports);

    Ok(())
}

/// Get the initial Merkle root for an empty tree
/// This is the root of a tree with all zero leaves
fn get_initial_merkle_root() -> [u8; 32] {
    // For an empty Merkle tree, the root is computed by hashing
    // zero values up the tree. This should match the circuit

    // In production, this should be a precomputed constant
    // For now, using zeros as placeholder
    [0u8; 32]
}
