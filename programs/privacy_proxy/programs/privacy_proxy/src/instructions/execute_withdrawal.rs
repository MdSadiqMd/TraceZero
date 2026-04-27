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

    /// Global config - we only read paused and relayer_treasury
    /// CHECK: We manually verify this is the correct config PDA in the handler
    pub config: UncheckedAccount<'info>,

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
    /// CHECK: We manually verify this matches config.relayer_treasury
    #[account(mut)]
    pub relayer_treasury: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(ctx: Context<ExecuteWithdrawal>) -> Result<()> {
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
        return Err(PrivacyProxyError::ProtocolPaused.into());
    }
    
    let mut relayer_treasury_bytes = [0u8; 32];
    relayer_treasury_bytes.copy_from_slice(&config_data[40..72]);
    let relayer_treasury = Pubkey::new_from_array(relayer_treasury_bytes);
    let paused = config_data[368] != 0;
    
    // Verify relayer_treasury matches
    require!(
        ctx.accounts.relayer_treasury.key() == relayer_treasury,
        PrivacyProxyError::UnauthorizedRelayer
    );
    
    let pool = &mut ctx.accounts.pool;
    let pending = &mut ctx.accounts.pending_withdrawal;
    let nullifier = &mut ctx.accounts.nullifier;

    // Check protocol not paused
    require!(!paused, PrivacyProxyError::ProtocolPaused);

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

    // Atomic lamport transfers
    // Calculate all balances first, then apply all changes atomically
    // This ensures either all transfers succeed or all fail
    let pool_info = pool.to_account_info();
    let recipient_info = ctx.accounts.recipient.to_account_info();
    let treasury_info = ctx.accounts.relayer_treasury.to_account_info();

    // Get current balances
    let pool_balance = pool_info.lamports();
    let recipient_balance = recipient_info.lamports();
    let treasury_balance = treasury_info.lamports();

    // Verify pool has sufficient funds
    require!(
        pool_balance >= pending.amount + pending.fee,
        PrivacyProxyError::Overflow
    );

    // Calculate new balances (all checked arithmetic)
    let new_pool_balance = pool_balance
        .checked_sub(pending.amount)
        .and_then(|b| b.checked_sub(pending.fee))
        .ok_or(PrivacyProxyError::Overflow)?;
    
    let new_recipient_balance = recipient_balance
        .checked_add(pending.amount)
        .ok_or(PrivacyProxyError::Overflow)?;
    
    let new_treasury_balance = treasury_balance
        .checked_add(pending.fee)
        .ok_or(PrivacyProxyError::Overflow)?;

    // Verify conservation of lamports (total before = total after)
    let total_before = pool_balance
        .checked_add(recipient_balance)
        .and_then(|t| t.checked_add(treasury_balance))
        .ok_or(PrivacyProxyError::Overflow)?;
    
    let total_after = new_pool_balance
        .checked_add(new_recipient_balance)
        .and_then(|t| t.checked_add(new_treasury_balance))
        .ok_or(PrivacyProxyError::Overflow)?;
    
    require!(
        total_before == total_after,
        PrivacyProxyError::Overflow
    );

    // Apply all balance changes atomically
    // If any of these fail, the entire transaction reverts
    **pool_info.try_borrow_mut_lamports()? = new_pool_balance;
    **recipient_info.try_borrow_mut_lamports()? = new_recipient_balance;
    **treasury_info.try_borrow_mut_lamports()? = new_treasury_balance;

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
