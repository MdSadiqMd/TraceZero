/// Stores historical Merkle roots for delayed withdrawals. Separated from DepositPool to avoid stack size limits
/// Reduced to 8 roots per account to fit within BPF limits. Multiple chained accounts can be used for additional capacity
use anchor_lang::prelude::*;

/// Number of roots per HistoricalRoots account
/// REDUCED to 8 to fit within BPF stack limits (was 32)
pub const ROOTS_PER_ACCOUNT: usize = 8;

/// Maximum number of chained accounts per pool
pub const MAX_CHAINED_ACCOUNTS: u8 = 32;

/// Historical Merkle roots for a deposit pool
/// Stores roots in a circular buffer for efficient updates
#[account]
pub struct HistoricalRoots {
    /// The pool this account belongs to
    pub pool: Pubkey,

    /// Bucket ID for quick lookup
    pub bucket_id: u8,

    /// Account index (for chaining multiple accounts)
    /// Account 0 stores roots 0-31, Account 1 stores 32-63, etc.
    pub account_index: u8,

    /// Current write index in the circular buffer
    pub write_index: u8,

    /// Number of valid roots stored (up to ROOTS_PER_ACCOUNT)
    pub count: u8,

    /// The historical roots (circular buffer)
    pub roots: [[u8; 32]; ROOTS_PER_ACCOUNT],

    /// PDA bump
    pub bump: u8,
}

impl Default for HistoricalRoots {
    fn default() -> Self {
        Self {
            pool: Pubkey::default(),
            bucket_id: 0,
            account_index: 0,
            write_index: 0,
            count: 0,
            roots: [[0u8; 32]; ROOTS_PER_ACCOUNT],
            bump: 0,
        }
    }
}

impl HistoricalRoots {
    pub const SIZE: usize = 8 + // discriminator
        32 + // pool
        1 + // bucket_id
        1 + // account_index
        1 + // write_index
        1 + // count
        (32 * ROOTS_PER_ACCOUNT) + // roots (32 * 32 = 1024 bytes)
        1 + // bump
        8; // padding

    pub fn add_root(&mut self, root: [u8; 32]) {
        self.roots[self.write_index as usize] = root;
        self.write_index = ((self.write_index as usize + 1) % ROOTS_PER_ACCOUNT) as u8;
        if (self.count as usize) < ROOTS_PER_ACCOUNT {
            self.count += 1;
        }
    }

    pub fn contains_root(&self, root: &[u8; 32]) -> bool {
        let count = self.count as usize;
        for i in 0..count {
            if &self.roots[i] == root {
                return true;
            }
        }
        false
    }

    pub fn get_latest_root(&self) -> Option<[u8; 32]> {
        if self.count == 0 {
            return None;
        }
        let idx = if self.write_index == 0 {
            ROOTS_PER_ACCOUNT - 1
        } else {
            (self.write_index - 1) as usize
        };
        Some(self.roots[idx])
    }

    pub fn is_full(&self) -> bool {
        self.count as usize >= ROOTS_PER_ACCOUNT
    }

    pub fn next_account_index(&self) -> Option<u8> {
        if self.account_index < MAX_CHAINED_ACCOUNTS - 1 {
            Some(self.account_index + 1)
        } else {
            None // Wrap around to account 0
        }
    }
}

pub const HISTORICAL_ROOTS_SEED: &[u8] = b"historical_roots";

pub fn derive_historical_roots_pda(
    pool: &Pubkey,
    account_index: u8,
    program_id: &Pubkey,
) -> (Pubkey, u8) {
    Pubkey::find_program_address(
        &[HISTORICAL_ROOTS_SEED, pool.as_ref(), &[account_index]],
        program_id,
    )
}
