/// Multi-account historical root validation
/// Support checking multiple chained HistoricalRoots accounts
use anchor_lang::prelude::*;
use crate::errors::PrivacyProxyError;
use crate::state::{HistoricalRoots, HISTORICAL_ROOTS_SEED, ROOTS_PER_ACCOUNT, MAX_CHAINED_ACCOUNTS};

/// Maximum number of historical root accounts to check
/// This limits the compute units used for root validation
pub const MAX_ACCOUNTS_TO_CHECK: u8 = 4;

/// Total historical root capacity with multiple accounts
pub const TOTAL_ROOT_CAPACITY: usize = (ROOTS_PER_ACCOUNT * MAX_ACCOUNTS_TO_CHECK as usize);

/// Calculate minimum deposits needed before oldest root expires
/// With 8 roots per account and 4 accounts checked = 32 roots total
/// Plus 2 roots in DepositPool = 34 roots total capacity
pub const ROOT_EXPIRATION_THRESHOLD: u64 = 34;

/// Validate a merkle root against pool and historical roots
/// Checks current pool root, pool history, and multiple chained historical accounts
pub fn validate_merkle_root(
    merkle_root: &[u8; 32],
    pool_current_root: &[u8; 32],
    pool_historical_roots: &[[u8; 32]],
    historical_roots_account: &HistoricalRoots,
    remaining_accounts: &[AccountInfo],
    pool_pubkey: &Pubkey,
    program_id: &Pubkey,
) -> Result<bool> {
    // 1. Check current pool root
    if merkle_root == pool_current_root {
        return Ok(true);
    }

    // 2. Check pool's historical roots (small buffer in DepositPool)
    for root in pool_historical_roots {
        if merkle_root == root {
            return Ok(true);
        }
    }

    // 3. Check first historical roots account (account_index = 0)
    if historical_roots_account.contains_root(merkle_root) {
        return Ok(true);
    }

    // 4. M-11 FIX: Check additional chained historical root accounts
    // Parse remaining_accounts for additional HistoricalRoots accounts
    let mut accounts_checked = 1; // Already checked account 0
    
    for (idx, account_info) in remaining_accounts.iter().enumerate() {
        if accounts_checked >= MAX_ACCOUNTS_TO_CHECK {
            break; // Limit compute units
        }

        // Verify this is a valid HistoricalRoots account for this pool
        let account_index = (idx + 1) as u8; // Start from 1 (0 is already checked)
        
        let (expected_pda, _) = Pubkey::find_program_address(
            &[HISTORICAL_ROOTS_SEED, pool_pubkey.as_ref(), &[account_index]],
            program_id,
        );

        if account_info.key() != expected_pda {
            continue; // Skip invalid accounts
        }

        // Deserialize and check this account
        let data = account_info.try_borrow_data()?;
        if data.len() < HistoricalRoots::SIZE {
            continue; // Invalid size
        }

        // Parse the account (manual deserialization to avoid stack issues)
        let historical_roots = parse_historical_roots(&data)?;
        
        if historical_roots.contains_root(merkle_root) {
            return Ok(true);
        }

        accounts_checked += 1;
    }

    // Root not found in any checked accounts
    Ok(false)
}

/// Manually parse HistoricalRoots account data
/// Avoids loading full struct onto stack
fn parse_historical_roots(data: &[u8]) -> Result<HistoricalRoots> {
    if data.len() < HistoricalRoots::SIZE {
        return Err(PrivacyProxyError::InvalidMerkleRoot.into());
    }

    let mut offset = 8; // Skip discriminator

    // Parse pool (32 bytes)
    let mut pool_bytes = [0u8; 32];
    pool_bytes.copy_from_slice(&data[offset..offset + 32]);
    let pool = Pubkey::new_from_array(pool_bytes);
    offset += 32;

    // Parse bucket_id (1 byte)
    let bucket_id = data[offset];
    offset += 1;

    // Parse account_index (1 byte)
    let account_index = data[offset];
    offset += 1;

    // Parse write_index (1 byte)
    let write_index = data[offset];
    offset += 1;

    // Parse count (1 byte)
    let count = data[offset];
    offset += 1;

    // Parse roots (32 * ROOTS_PER_ACCOUNT bytes)
    let mut roots = [[0u8; 32]; ROOTS_PER_ACCOUNT];
    for i in 0..ROOTS_PER_ACCOUNT {
        roots[i].copy_from_slice(&data[offset..offset + 32]);
        offset += 32;
    }

    // Parse bump (1 byte)
    let bump = data[offset];

    Ok(HistoricalRoots {
        pool,
        bucket_id,
        account_index,
        write_index,
        count,
        roots,
        bump,
    })
}

/// Calculate how many deposits until a root expires
/// Returns None if root is not found
pub fn deposits_until_expiration(
    merkle_root: &[u8; 32],
    pool_current_root: &[u8; 32],
    _pool_next_index: u64,
    pool_historical_roots: &[[u8; 32]],
    historical_roots_account: &HistoricalRoots,
) -> Option<u64> {
    // If it's the current root, it won't expire until ROOT_EXPIRATION_THRESHOLD deposits
    if merkle_root == pool_current_root {
        return Some(ROOT_EXPIRATION_THRESHOLD);
    }

    // Check pool historical roots (most recent)
    for (i, root) in pool_historical_roots.iter().enumerate() {
        if merkle_root == root {
            // This root is i positions behind current
            let deposits_behind = (i + 1) as u64;
            let remaining = ROOT_EXPIRATION_THRESHOLD.saturating_sub(deposits_behind);
            return Some(remaining);
        }
    }

    // Check historical roots account
    // This is more complex as it's a circular buffer
    if historical_roots_account.contains_root(merkle_root) {
        // Conservative estimate: assume it's near the oldest position
        // In reality, we'd need to track the exact position
        return Some(ROOT_EXPIRATION_THRESHOLD / 2);
    }

    // Root not found
    None
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_root_capacity() {
        // Verify our capacity calculations
        assert_eq!(TOTAL_ROOT_CAPACITY, 32); // 8 roots * 4 accounts
        assert_eq!(ROOT_EXPIRATION_THRESHOLD, 34); // 32 + 2 in pool
    }

    #[test]
    fn test_parse_historical_roots() {
        // Create mock data
        let mut data = vec![0u8; HistoricalRoots::SIZE];
        
        // Discriminator
        data[0..8].copy_from_slice(&[1, 2, 3, 4, 5, 6, 7, 8]);
        
        // Pool
        let pool = Pubkey::new_unique();
        data[8..40].copy_from_slice(pool.as_ref());
        
        // bucket_id
        data[40] = 5;
        
        // account_index
        data[41] = 1;
        
        // write_index
        data[42] = 3;
        
        // count
        data[43] = 8;
        
        // roots (skip for brevity)
        
        // bump
        data[44 + (32 * ROOTS_PER_ACCOUNT)] = 255;

        let parsed = parse_historical_roots(&data).unwrap();
        assert_eq!(parsed.pool, pool);
        assert_eq!(parsed.bucket_id, 5);
        assert_eq!(parsed.account_index, 1);
        assert_eq!(parsed.write_index, 3);
        assert_eq!(parsed.count, 8);
        assert_eq!(parsed.bump, 255);
    }
}
