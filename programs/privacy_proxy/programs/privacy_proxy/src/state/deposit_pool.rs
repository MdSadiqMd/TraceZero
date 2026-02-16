/// STACK OPTIMIZED: Reduced historical roots to fit within BPF stack limits
/// The separate HistoricalRoots account provides additional capacity
use anchor_lang::prelude::*;

/// Number of historical roots to keep in the pool itself
/// REDUCED to 2 to fit within BPF stack limits (was 8)
/// Additional roots are stored in the separate HistoricalRoots account
pub const HISTORICAL_ROOTS_COUNT: usize = 2;

/// Deposit pool for a specific denomination
#[account]
pub struct DepositPool {
    /// Bucket ID (0-6)
    pub bucket_id: u8,

    /// Fixed amount in lamports for this pool
    pub amount_lamports: u64,

    /// Current Merkle root of commitments
    pub merkle_root: [u8; 32],

    /// Next leaf index for insertion
    pub next_index: u64,

    /// Total number of deposits ever made
    pub total_deposits: u64,

    /// Current anonymity set size (unspent deposits)
    pub anonymity_set_size: u64,

    /// Historical Merkle roots (small buffer, main storage in HistoricalRoots)
    pub historical_roots: [[u8; 32]; HISTORICAL_ROOTS_COUNT],

    /// Index for circular buffer of historical roots
    pub historical_roots_index: u8,

    /// PDA bump
    pub bump: u8,
}

impl Default for DepositPool {
    fn default() -> Self {
        Self {
            bucket_id: 0,
            amount_lamports: 0,
            merkle_root: [0u8; 32],
            next_index: 0,
            total_deposits: 0,
            anonymity_set_size: 0,
            historical_roots: [[0u8; 32]; HISTORICAL_ROOTS_COUNT],
            historical_roots_index: 0,
            bump: 0,
        }
    }
}

impl DepositPool {
    pub const SIZE: usize = 8 + // discriminator
        1 + // bucket_id
        8 + // amount_lamports
        32 + // merkle_root
        8 + // next_index
        8 + // total_deposits
        8 + // anonymity_set_size
        (32 * HISTORICAL_ROOTS_COUNT) + // historical_roots
        1 + // historical_roots_index
        1 + // bump
        64; // padding

    /// Check if a Merkle root is valid (current or recent historical)
    pub fn is_valid_root(&self, root: &[u8; 32]) -> bool {
        // Check current root
        if &self.merkle_root == root {
            return true;
        }

        // Check historical roots
        for historical in &self.historical_roots {
            if historical == root {
                return true;
            }
        }

        false
    }

    /// Add a new root to history
    pub fn add_root_to_history(&mut self) {
        self.historical_roots[self.historical_roots_index as usize] = self.merkle_root;
        self.historical_roots_index =
            (self.historical_roots_index + 1) % (HISTORICAL_ROOTS_COUNT as u8);
    }
}

// Implement InitSpace for Anchor
impl anchor_lang::Space for DepositPool {
    const INIT_SPACE: usize = Self::SIZE;
}
