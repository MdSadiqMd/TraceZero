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

/// This must match the SDK's Poseidon-based zero values
/// The relayer is authoritative for the Merkle tree and uses Poseidon
/// The on-chain program stores the root provided by the relayer
/// This is a precomputed constant: the Poseidon hash of zero values, propagated up a tree of depth 20
fn get_initial_merkle_root() -> [u8; 32] {
    // Precomputed: Poseidon hash of zeros at depth 20
    // Computed by: privacy-proxy-sdk's MerkleTree::new(20).root()
    //
    // This is the result of:
    // Level 0: [0u8; 32]
    // Level n: Poseidon(level_{n-1}, level_{n-1})
    // Repeated 20 times
    //
    // Hex: 2134e76ac5d21aab186c2be1dd8f84ee880a1e46eaf712f9d371b6df22191f3e
    [
        0x21, 0x34, 0xe7, 0x6a, 0xc5, 0xd2, 0x1a, 0xab, 0x18, 0x6c, 0x2b, 0xe1, 0xdd, 0x8f, 0x84,
        0xee, 0x88, 0x0a, 0x1e, 0x46, 0xea, 0xf7, 0x12, 0xf9, 0xd3, 0x71, 0xb6, 0xdf, 0x22, 0x19,
        0x1f, 0x3e,
    ]
}
