use std::collections::HashMap;
use std::sync::Arc;
use std::time::{Duration, Instant};
use tokio::sync::RwLock;
use tracing::{debug, warn};

/// Rate limiter for expensive operations (ZK proof verification, on-chain transactions)
/// Uses multiple strategies to prevent DoS:
/// 1. Per-nullifier rate limiting (prevents spam of same withdrawal)
/// 2. Global operation rate limiting (prevents overwhelming the relayer)
/// 3. Proof structure validation (cheap checks before expensive verification)
#[derive(Clone)]
pub struct ExpensiveOpRateLimiter {
    /// Track last request time per nullifier hash
    nullifier_requests: Arc<RwLock<HashMap<[u8; 32], Instant>>>,
    /// Track global operation counts in time windows
    global_ops: Arc<RwLock<GlobalOpTracker>>,
    /// Configuration
    config: RateLimitConfig,
}

#[derive(Clone)]
pub struct RateLimitConfig {
    /// Minimum time between requests for same nullifier (seconds)
    pub nullifier_cooldown_secs: u64,
    /// Maximum withdrawal requests per minute (global)
    pub max_withdrawals_per_minute: usize,
    /// Maximum deposit requests per minute (global)
    pub max_deposits_per_minute: usize,
    /// Maximum proof verifications per minute (global)
    pub max_proofs_per_minute: usize,
}

impl Default for RateLimitConfig {
    fn default() -> Self {
        Self {
            nullifier_cooldown_secs: 10, // 10 seconds between same nullifier attempts
            max_withdrawals_per_minute: 30, // 30 withdrawals/min = 0.5/sec
            max_deposits_per_minute: 60, // 60 deposits/min = 1/sec
            max_proofs_per_minute: 30, // 30 proofs/min = 0.5/sec
        }
    }
}

struct GlobalOpTracker {
    withdrawal_requests: Vec<Instant>,
    deposit_requests: Vec<Instant>,
    proof_verifications: Vec<Instant>,
}

impl GlobalOpTracker {
    fn new() -> Self {
        Self {
            withdrawal_requests: Vec::new(),
            deposit_requests: Vec::new(),
            proof_verifications: Vec::new(),
        }
    }

    /// Clean up old entries and return count in last minute
    fn clean_and_count(entries: &mut Vec<Instant>) -> usize {
        let cutoff = Instant::now() - Duration::from_secs(60);
        entries.retain(|&t| t > cutoff);
        entries.len()
    }

    fn record_withdrawal(&mut self) {
        Self::clean_and_count(&mut self.withdrawal_requests);
        self.withdrawal_requests.push(Instant::now());
    }

    fn record_deposit(&mut self) {
        Self::clean_and_count(&mut self.deposit_requests);
        self.deposit_requests.push(Instant::now());
    }

    fn record_proof(&mut self) {
        Self::clean_and_count(&mut self.proof_verifications);
        self.proof_verifications.push(Instant::now());
    }

    fn withdrawal_count(&mut self) -> usize {
        Self::clean_and_count(&mut self.withdrawal_requests)
    }

    fn deposit_count(&mut self) -> usize {
        Self::clean_and_count(&mut self.deposit_requests)
    }

    fn proof_count(&mut self) -> usize {
        Self::clean_and_count(&mut self.proof_verifications)
    }
}

impl ExpensiveOpRateLimiter {
    pub fn new(config: RateLimitConfig) -> Self {
        Self {
            nullifier_requests: Arc::new(RwLock::new(HashMap::new())),
            global_ops: Arc::new(RwLock::new(GlobalOpTracker::new())),
            config,
        }
    }

    /// Check if a withdrawal request should be allowed
    /// Returns Ok(()) if allowed, Err with reason if denied
    pub async fn check_withdrawal(&self, nullifier_hash: &[u8; 32]) -> Result<(), String> {
        // Check per-nullifier rate limit
        {
            let mut nullifiers = self.nullifier_requests.write().await;
            if let Some(&last_request) = nullifiers.get(nullifier_hash) {
                let elapsed = Instant::now().duration_since(last_request);
                let cooldown = Duration::from_secs(self.config.nullifier_cooldown_secs);
                if elapsed < cooldown {
                    let remaining = cooldown.saturating_sub(elapsed).as_secs();
                    warn!(
                        "Rate limit: Same nullifier requested too quickly. Cooldown: {} seconds remaining",
                        remaining
                    );
                    return Err(format!(
                        "Rate limit exceeded: Please wait {} seconds before retrying this withdrawal",
                        remaining
                    ));
                }
            }
            nullifiers.insert(*nullifier_hash, Instant::now());
        }

        // Check global withdrawal rate limit
        {
            let mut global = self.global_ops.write().await;
            let current_count = global.withdrawal_count();
            if current_count >= self.config.max_withdrawals_per_minute {
                warn!(
                    "Rate limit: Global withdrawal limit reached ({}/min)",
                    self.config.max_withdrawals_per_minute
                );
                return Err(format!(
                    "Rate limit exceeded: Too many withdrawal requests. Maximum {} per minute. Please try again later.",
                    self.config.max_withdrawals_per_minute
                ));
            }
            global.record_withdrawal();
            debug!(
                "Withdrawal rate limit check passed: {}/{} requests in last minute",
                current_count + 1,
                self.config.max_withdrawals_per_minute
            );
        }

        Ok(())
    }

    /// Check if a deposit request should be allowed
    pub async fn check_deposit(&self) -> Result<(), String> {
        let mut global = self.global_ops.write().await;
        let current_count = global.deposit_count();
        if current_count >= self.config.max_deposits_per_minute {
            warn!(
                "Rate limit: Global deposit limit reached ({}/min)",
                self.config.max_deposits_per_minute
            );
            return Err(format!(
                "Rate limit exceeded: Too many deposit requests. Maximum {} per minute. Please try again later.",
                self.config.max_deposits_per_minute
            ));
        }
        global.record_deposit();
        debug!(
            "Deposit rate limit check passed: {}/{} requests in last minute",
            current_count + 1,
            self.config.max_deposits_per_minute
        );
        Ok(())
    }

    /// Check if a proof verification should be allowed
    pub async fn check_proof_verification(&self) -> Result<(), String> {
        let mut global = self.global_ops.write().await;
        let current_count = global.proof_count();
        if current_count >= self.config.max_proofs_per_minute {
            warn!(
                "Rate limit: Global proof verification limit reached ({}/min)",
                self.config.max_proofs_per_minute
            );
            return Err(format!(
                "Rate limit exceeded: Too many proof verification requests. Maximum {} per minute. Please try again later.",
                self.config.max_proofs_per_minute
            ));
        }
        global.record_proof();
        debug!(
            "Proof verification rate limit check passed: {}/{} requests in last minute",
            current_count + 1,
            self.config.max_proofs_per_minute
        );
        Ok(())
    }

    /// Cleanup old entries periodically (call this from a background task)
    pub async fn cleanup(&self) {
        // Clean up old nullifier entries (older than 5 minutes)
        {
            let mut nullifiers = self.nullifier_requests.write().await;
            let cutoff = Instant::now() - Duration::from_secs(300);
            nullifiers.retain(|_, &mut last_request| last_request > cutoff);
            debug!("Cleaned up old nullifier entries. Remaining: {}", nullifiers.len());
        }

        // Global ops are cleaned automatically on each check
    }
}

/// Validate proof structure before expensive verification
/// These are cheap checks that can filter out obviously invalid proofs
pub fn validate_proof_structure(proof_a: &[u8], proof_b: &[u8], proof_c: &[u8]) -> Result<(), String> {
    // G1 points (proof_a, proof_c) should be 64 bytes (uncompressed) or 32 bytes (compressed)
    // G2 points (proof_b) should be 128 bytes (uncompressed) or 64 bytes (compressed)
    
    // Check proof_a length (G1 point)
    if proof_a.len() != 64 && proof_a.len() != 32 {
        return Err(format!(
            "Invalid proof_a length: expected 32 or 64 bytes, got {}",
            proof_a.len()
        ));
    }

    // Check proof_b length (G2 point)
    if proof_b.len() != 128 && proof_b.len() != 64 {
        return Err(format!(
            "Invalid proof_b length: expected 64 or 128 bytes, got {}",
            proof_b.len()
        ));
    }

    // Check proof_c length (G1 point)
    if proof_c.len() != 64 && proof_c.len() != 32 {
        return Err(format!(
            "Invalid proof_c length: expected 32 or 64 bytes, got {}",
            proof_c.len()
        ));
    }

    // Check for all-zero proofs (obviously invalid)
    if proof_a.iter().all(|&b| b == 0) {
        return Err("Invalid proof: proof_a is all zeros".to_string());
    }
    if proof_b.iter().all(|&b| b == 0) {
        return Err("Invalid proof: proof_b is all zeros".to_string());
    }
    if proof_c.iter().all(|&b| b == 0) {
        return Err("Invalid proof: proof_c is all zeros".to_string());
    }

    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_nullifier_rate_limit() {
        let config = RateLimitConfig {
            nullifier_cooldown_secs: 1,
            ..Default::default()
        };
        let limiter = ExpensiveOpRateLimiter::new(config);
        let nullifier = [1u8; 32];

        // First request should succeed
        assert!(limiter.check_withdrawal(&nullifier).await.is_ok());

        // Immediate second request should fail
        assert!(limiter.check_withdrawal(&nullifier).await.is_err());

        // After cooldown, should succeed
        tokio::time::sleep(Duration::from_secs(2)).await;
        assert!(limiter.check_withdrawal(&nullifier).await.is_ok());
    }

    #[tokio::test]
    async fn test_global_withdrawal_limit() {
        let config = RateLimitConfig {
            max_withdrawals_per_minute: 2,
            nullifier_cooldown_secs: 0, // Disable nullifier cooldown for this test
            ..Default::default()
        };
        let limiter = ExpensiveOpRateLimiter::new(config);

        // First two requests should succeed
        assert!(limiter.check_withdrawal(&[1u8; 32]).await.is_ok());
        assert!(limiter.check_withdrawal(&[2u8; 32]).await.is_ok());

        // Third request should fail
        assert!(limiter.check_withdrawal(&[3u8; 32]).await.is_err());
    }

    #[test]
    fn test_proof_structure_validation() {
        // Valid proof lengths
        assert!(validate_proof_structure(&[1u8; 64], &[1u8; 128], &[1u8; 64]).is_ok());
        assert!(validate_proof_structure(&[1u8; 32], &[1u8; 64], &[1u8; 32]).is_ok());

        // Invalid lengths
        assert!(validate_proof_structure(&[1u8; 30], &[1u8; 128], &[1u8; 64]).is_err());
        assert!(validate_proof_structure(&[1u8; 64], &[1u8; 100], &[1u8; 64]).is_err());

        // All-zero proofs
        assert!(validate_proof_structure(&[0u8; 64], &[1u8; 128], &[1u8; 64]).is_err());
        assert!(validate_proof_structure(&[1u8; 64], &[0u8; 128], &[1u8; 64]).is_err());
    }
}
