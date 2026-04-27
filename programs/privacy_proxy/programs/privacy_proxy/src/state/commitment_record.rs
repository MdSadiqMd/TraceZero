/// On-chain commitment record for merkle tree verification
/// Each commitment is stored on-chain to enable verification of merkle root construction
use anchor_lang::prelude::*;

#[account]
pub struct CommitmentRecord {
    /// The commitment hash (leaf in merkle tree)
    pub commitment: [u8; 32],
    
    /// Pool this commitment belongs to
    pub pool: Pubkey,
    
    /// Leaf index in the merkle tree
    pub leaf_index: u64,
    
    /// Merkle root after this commitment was added
    pub merkle_root_after: [u8; 32],
    
    /// Timestamp when commitment was added
    pub created_at: i64,
    
    /// PDA bump
    pub bump: u8,
}

impl CommitmentRecord {
    pub const SIZE: usize = 8 + // discriminator
        32 + // commitment
        32 + // pool
        8 + // leaf_index
        32 + // merkle_root_after
        8 + // created_at
        1 + // bump
        32; // padding
}

impl anchor_lang::Space for CommitmentRecord {
    const INIT_SPACE: usize = Self::SIZE;
}
