use anchor_lang::prelude::*;

#[error_code]
pub enum PrivacyProxyError {
    #[msg("Invalid bucket ID")]
    InvalidBucketId,

    #[msg("Invalid deposit amount for bucket")]
    InvalidDepositAmount,

    #[msg("Unauthorized relayer")]
    UnauthorizedRelayer,

    #[msg("Protocol is paused")]
    ProtocolPaused,

    #[msg("Invalid ZK proof")]
    InvalidProof,

    #[msg("Nullifier already used (double-spend attempt)")]
    NullifierAlreadyUsed,

    #[msg("Invalid Merkle root")]
    InvalidMerkleRoot,

    #[msg("Withdrawal delay out of range")]
    InvalidDelayHours,

    #[msg("Withdrawal timelock not expired")]
    TimelockNotExpired,

    #[msg("Withdrawal already executed or cancelled")]
    WithdrawalNotPending,

    #[msg("Token already redeemed")]
    TokenAlreadyRedeemed,

    #[msg("Invalid blinded token")]
    InvalidBlindedToken,

    #[msg("Insufficient payment for credits")]
    InsufficientPayment,

    #[msg("Encrypted note too large")]
    NoteTooLarge,

    #[msg("Arithmetic overflow")]
    Overflow,

    #[msg("Pool is full")]
    PoolFull,

    #[msg("Invalid binding hash - proof not bound to these parameters")]
    InvalidBindingHash,
}
