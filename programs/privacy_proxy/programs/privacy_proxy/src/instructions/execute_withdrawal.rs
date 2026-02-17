/// Execute withdrawal after timelock expires
/// This is permissionless - anyone can execute once timelock expires. Funds go to the stealth address specified in the request
use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::PrivacyProxyError;
use crate::state::{
    DepositPool, GlobalConfig, NullifierRecord, PendingWithdrawal, WithdrawalStatus,
};

#[derive(Accounts)]
pub struct ExecuteWithdrawal<'info> {
    /// Anyone can execute (permissionless after timelock)
    #[account(mut)]
    pub executor: Signer<'info>,

    /// Global config
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
    )]
    pub config: Account<'info, GlobalConfig>,

    /// Deposit pool (source of funds)
    #[account(
        mut,
        constraint = pool.key() == pending_withdrawal.pool @ PrivacyProxyError::InvalidBucketId,
    )]
    pub pool: Account<'info, DepositPool>,

    /// Pending withdrawal to execute
    #[account(
        mut,
        constraint = pending_withdrawal.status == WithdrawalStatus::Pending @ PrivacyProxyError::WithdrawalNotPending,
    )]
    pub pending_withdrawal: Account<'info, PendingWithdrawal>,

    /// Nullifier record - created to prevent double-spend
    #[account(
        init,
        payer = executor,
        space = NullifierRecord::SIZE,
        seeds = [NULLIFIER_SEED, &pending_withdrawal.nullifier_hash],
        bump,
    )]
    pub nullifier: Account<'info, NullifierRecord>,

    /// Recipient stealth address
    /// CHECK: This is the stealth address from the withdrawal request
    #[account(
        mut,
        constraint = recipient.key() == pending_withdrawal.recipient @ PrivacyProxyError::InvalidProof,
    )]
    pub recipient: AccountInfo<'info>,

    /// Relayer treasury receives fee
    /// CHECK: Validated against config
    #[account(
        mut,
        constraint = relayer_treasury.key() == config.relayer_treasury @ PrivacyProxyError::UnauthorizedRelayer,
    )]
    pub relayer_treasury: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<ExecuteWithdrawal>) -> Result<()> {
    let config = &ctx.accounts.config;
    let pool = &mut ctx.accounts.pool;
    let pending = &mut ctx.accounts.pending_withdrawal;
    let nullifier = &mut ctx.accounts.nullifier;

    // Check protocol not paused
    require!(!config.paused, PrivacyProxyError::ProtocolPaused);

    // Check timelock has expired
    let clock = Clock::get()?;
    require!(
        clock.unix_timestamp >= pending.execute_after,
        PrivacyProxyError::TimelockNotExpired
    );

    // Transfer funds from pool to recipient
    let pool_lamports = pool.to_account_info().lamports();
    require!(
        pool_lamports >= pending.amount + pending.fee,
        PrivacyProxyError::Overflow
    );

    // Transfer to recipient (stealth address)
    **pool.to_account_info().try_borrow_mut_lamports()? -= pending.amount;
    **ctx.accounts.recipient.try_borrow_mut_lamports()? += pending.amount;

    // Transfer fee to relayer treasury
    **pool.to_account_info().try_borrow_mut_lamports()? -= pending.fee;
    **ctx.accounts.relayer_treasury.try_borrow_mut_lamports()? += pending.fee;

    // Update pool anonymity set
    pool.anonymity_set_size = pool.anonymity_set_size.saturating_sub(1);

    // Mark nullifier as spent
    nullifier.nullifier_hash = pending.nullifier_hash;
    nullifier.spent_at = clock.unix_timestamp;
    nullifier.pool = pool.key();
    nullifier.bump = ctx.bumps.nullifier;

    // Mark withdrawal as executed
    pending.status = WithdrawalStatus::Executed;

    msg!("Withdrawal executed");
    msg!("Amount: {} lamports", pending.amount);
    msg!("Fee: {} lamports", pending.fee);
    msg!("Recipient: {}", pending.recipient);
    msg!("Anonymity set remaining: {}", pool.anonymity_set_size);

    Ok(())
}
