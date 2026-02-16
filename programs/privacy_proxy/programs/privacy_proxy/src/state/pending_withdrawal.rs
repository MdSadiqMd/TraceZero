use anchor_lang::prelude::*;

#[derive(AnchorSerialize, AnchorDeserialize, Clone, PartialEq, Eq, Default)]
pub enum WithdrawalStatus {
    #[default]
    Pending,
    Executed,
    Cancelled,
}

#[account]
#[derive(Default)]
pub struct PendingWithdrawal {
    /// Unique transaction ID within the pool
    pub tx_id: u64,

    /// Pool this withdrawal is from
    pub pool: Pubkey,

    /// Recipient stealth address
    pub recipient: Pubkey,

    /// Amount to withdraw (in lamports)
    pub amount: u64,

    /// Fee to relayer (in lamports)
    pub fee: u64,

    /// Timestamp after which withdrawal can be executed
    pub execute_after: i64,

    /// Nullifier hash (to mark as spent on execution)
    pub nullifier_hash: [u8; 32],

    /// Current status
    pub status: WithdrawalStatus,

    /// PDA bump
    pub bump: u8,
}

impl PendingWithdrawal {
    pub const SIZE: usize = 8 + // discriminator
        8 + // tx_id
        32 + // pool
        32 + // recipient
        8 + // amount
        8 + // fee
        8 + // execute_after
        32 + // nullifier_hash
        1 + // status
        1 + // bump
        32; // padding
}
