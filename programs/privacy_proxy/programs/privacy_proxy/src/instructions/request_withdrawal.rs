/// Request withdrawal with ZK proof
/// User generates ZK proof off-chain proving they know a valid deposit, without revealing which one. Withdrawal is timelocked for privacy
/// Now verifies binding hash to ensure proof is bound to specific recipient/relayer/fee values. The binding hash is computed off-chain and verified by the ZK proof
use anchor_lang::prelude::*;

use crate::constants::*;
use crate::errors::PrivacyProxyError;
use crate::state::{
    DepositPool, GlobalConfig, HistoricalRoots, PendingWithdrawal, WithdrawalStatus,
    HISTORICAL_ROOTS_SEED,
};

/// Domain tag for withdrawal binding hash: "bind" as u32
/// MUST match: circuits/withdrawal.circom
pub const DOMAIN_BIND: u64 = 1651076196;

/// ZK Verifier program for CPI
pub mod zk_verifier {
    use super::*;
    declare_id!("2ntZ79MomBLsLyaExjGW6F7kkYtmprhdzZzQaMXSMZRu");
}

#[derive(Accounts)]
#[instruction(
    bucket_id: u8,
    nullifier_hash: [u8; 32],
    recipient: [u8; 32],  // Field element from circuit (potentially reduced mod BN254)
    _proof_a: [u8; 64],
    _proof_b: [u8; 128],
    _proof_c: [u8; 64],
    _merkle_root: [u8; 32],
    _delay_hours: u8,
    _binding_hash: [u8; 32],
    relayer_field: [u8; 32],  // Field element from circuit (potentially reduced mod BN254)
)]
pub struct RequestWithdrawal<'info> {
    /// Relayer submitting the withdrawal request (pays fees)
    #[account(mut)]
    pub relayer: Signer<'info>,

    /// Global config
    #[account(
        seeds = [CONFIG_SEED],
        bump = config.bump,
    )]
    pub config: Account<'info, GlobalConfig>,

    /// Deposit pool
    #[account(
        mut,
        seeds = [POOL_SEED, &[bucket_id]],
        bump = pool.bump,
    )]
    pub pool: Account<'info, DepositPool>,

    /// Historical roots account for extended root validation
    #[account(
        seeds = [HISTORICAL_ROOTS_SEED, pool.key().as_ref(), &[0u8]],
        bump = historical_roots.bump,
    )]
    pub historical_roots: Account<'info, HistoricalRoots>,

    /// Nullifier record - must not exist (proves not double-spent)
    /// CHECK: We verify this account doesn't exist
    #[account(
        seeds = [NULLIFIER_SEED, &nullifier_hash],
        bump,
    )]
    pub nullifier_check: AccountInfo<'info>,

    /// Pending withdrawal account
    #[account(
        init,
        payer = relayer,
        space = PendingWithdrawal::SIZE,
        seeds = [PENDING_SEED, pool.key().as_ref(), &pool.total_deposits.to_le_bytes()],
        bump,
    )]
    pub pending_withdrawal: Account<'info, PendingWithdrawal>,

    /// ZK Verifier program for proof verification
    /// CHECK: Validated by address constraint
    #[account(address = zk_verifier::ID)]
    pub zk_verifier_program: AccountInfo<'info>,

    pub system_program: Program<'info, System>,
}

pub fn handler(
    ctx: Context<RequestWithdrawal>,
    bucket_id: u8,
    nullifier_hash: [u8; 32],
    recipient: [u8; 32], // Field element from circuit (potentially reduced mod BN254)
    proof_a: [u8; 64],
    proof_b: [u8; 128],
    proof_c: [u8; 64],
    merkle_root: [u8; 32],
    delay_hours: u8,
    binding_hash: [u8; 32],  // Computed off-chain, verified by ZK proof
    relayer_field: [u8; 32], // Field element from circuit (potentially reduced mod BN254)
) -> Result<()> {
    let config = &ctx.accounts.config;
    let pool = &mut ctx.accounts.pool;
    let pending = &mut ctx.accounts.pending_withdrawal;

    // Check protocol not paused
    require!(!config.paused, PrivacyProxyError::ProtocolPaused);

    // Validate bucket
    require!(
        (bucket_id as usize) < NUM_BUCKETS,
        PrivacyProxyError::InvalidBucketId
    );

    // Validate delay is within bounds
    require!(
        delay_hours >= config.min_delay_hours && delay_hours <= config.max_delay_hours,
        PrivacyProxyError::InvalidDelayHours
    );

    // Verify nullifier hasn't been used (account should not exist)
    require!(
        ctx.accounts.nullifier_check.data_is_empty(),
        PrivacyProxyError::NullifierAlreadyUsed
    );

    // Verify Merkle root is valid (current, in pool history, or in extended history)
    let root_valid = pool.is_valid_root(&merkle_root)
        || ctx.accounts.historical_roots.contains_root(&merkle_root);
    require!(root_valid, PrivacyProxyError::InvalidMerkleRoot);

    // Calculate amounts for proof verification
    let amount = BUCKET_AMOUNTS[bucket_id as usize];
    let fee = amount
        .checked_mul(config.fee_bps as u64)
        .ok_or(PrivacyProxyError::Overflow)?
        .checked_div(10000)
        .ok_or(PrivacyProxyError::Overflow)?;

    // The binding_hash is provided by the relayer (computed off-chain)
    // The ZK proof verification will fail if the binding_hash doesn't match:
    // bindingHash = Poseidon(DOMAIN_BIND, nullifierHash, recipient, relayer, fee)
    // This cryptographically binds the proof to these specific values

    // Verify ZK proof via CPI to zk_verifier program
    // Use the relayer_field from the circuit (may be reduced mod BN254)
    verify_withdrawal_proof_cpi(
        &ctx.accounts.zk_verifier_program,
        &ctx.accounts.relayer,
        &proof_a,
        &proof_b,
        &proof_c,
        &merkle_root,
        &nullifier_hash,
        &recipient,
        amount,
        &relayer_field, // Use field element from circuit
        fee,
        &binding_hash,
    )?;

    let withdrawal_amount = amount.checked_sub(fee).ok_or(PrivacyProxyError::Overflow)?;

    // Calculate execute_after timestamp
    let clock = Clock::get()?;
    let delay_seconds = (delay_hours as i64) * 3600;
    let execute_after = clock
        .unix_timestamp
        .checked_add(delay_seconds)
        .ok_or(PrivacyProxyError::Overflow)?;

    // Create pending withdrawal
    // Convert recipient field element back to Pubkey for storage
    // Note: If the recipient was reduced mod BN254, this may not be a valid Pubkey
    // In practice, stealth addresses should be chosen to be valid field elements
    let recipient_pubkey = Pubkey::new_from_array(recipient);

    pending.tx_id = pool.total_deposits; // Use as unique ID
    pending.pool = pool.key();
    pending.recipient = recipient_pubkey;
    pending.amount = withdrawal_amount;
    pending.fee = fee;
    pending.execute_after = execute_after;
    pending.nullifier_hash = nullifier_hash;
    pending.status = WithdrawalStatus::Pending;
    pending.bump = ctx.bumps.pending_withdrawal;

    msg!("Withdrawal requested");
    msg!("Amount: {} lamports (fee: {})", withdrawal_amount, fee);
    msg!("Recipient: {}", recipient_pubkey);
    msg!("Execute after: {}", execute_after);
    msg!("Binding hash verified: {:?}", &binding_hash[..8]);

    Ok(())
}

/// Compute Anchor instruction discriminator
/// discriminator = sha256("global:<instruction_name>")[0..8]
fn compute_discriminator(name: &str) -> [u8; 8] {
    use sha2::{Digest, Sha256};
    let preimage = format!("global:{}", name);
    let hash_result = Sha256::digest(preimage.as_bytes());
    let mut discriminator = [0u8; 8];
    discriminator.copy_from_slice(&hash_result[..8]);
    discriminator
}

/// Verify Groth16 ZK proof via CPI to zk_verifier program
fn verify_withdrawal_proof_cpi<'info>(
    zk_verifier_program: &AccountInfo<'info>,
    caller: &Signer<'info>,
    proof_a: &[u8; 64],
    proof_b: &[u8; 128],
    proof_c: &[u8; 64],
    merkle_root: &[u8; 32],
    nullifier_hash: &[u8; 32],
    recipient: &[u8; 32], // Field element from circuit
    amount: u64,
    relayer: &[u8; 32], // Field element from circuit
    fee: u64,
    binding_hash: &[u8; 32],
) -> Result<()> {
    use anchor_lang::solana_program::instruction::Instruction;
    use anchor_lang::solana_program::program::invoke;

    // Compute the correct Anchor discriminator for verify_withdrawal
    // discriminator = sha256("global:verify_withdrawal")[0..8]
    let discriminator = compute_discriminator("verify_withdrawal");

    let mut data = Vec::with_capacity(8 + 256 + 32 * 4 + 8 * 2 + 32 * 3);
    data.extend_from_slice(&discriminator);

    // Groth16Proof
    data.extend_from_slice(proof_a);
    data.extend_from_slice(proof_b);
    data.extend_from_slice(proof_c);

    // WithdrawalPublicInputs (now using raw bytes for recipient/relayer)
    data.extend_from_slice(merkle_root);
    data.extend_from_slice(nullifier_hash);
    data.extend_from_slice(recipient); // Raw bytes, not Pubkey
    data.extend_from_slice(&amount.to_le_bytes());
    data.extend_from_slice(relayer); // Raw bytes, not Pubkey
    data.extend_from_slice(&fee.to_le_bytes());

    // Binding hash (circuit output)
    data.extend_from_slice(binding_hash);

    let accounts = vec![
        anchor_lang::solana_program::instruction::AccountMeta::new_readonly(caller.key(), true),
    ];

    let ix = Instruction {
        program_id: zk_verifier_program.key(),
        accounts,
        data,
    };

    invoke(
        &ix,
        &[caller.to_account_info(), zk_verifier_program.clone()],
    )?;

    msg!("✓ ZK proof verified via CPI");
    Ok(())
}
