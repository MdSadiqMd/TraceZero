/// Seed for global config PDA
pub const CONFIG_SEED: &[u8] = b"config";

/// Seed for deposit pool PDA
pub const POOL_SEED: &[u8] = b"pool";

/// Seed for nullifier PDA
pub const NULLIFIER_SEED: &[u8] = b"nullifier";

/// Seed for used token PDA (prevents double-redemption)
pub const USED_TOKEN_SEED: &[u8] = b"used_token";

/// Seed for pending withdrawal PDA
pub const PENDING_SEED: &[u8] = b"pending";

/// Seed for encrypted note PDA
pub const NOTE_SEED: &[u8] = b"note";

/// Fixed denomination buckets (in lamports)
/// 7 buckets: 0.1, 0.5, 1, 5, 10, 50, 100 SOL
pub const BUCKET_AMOUNTS: [u64; 7] = [
    100_000_000,     // 0.1 SOL
    500_000_000,     // 0.5 SOL
    1_000_000_000,   // 1 SOL
    5_000_000_000,   // 5 SOL
    10_000_000_000,  // 10 SOL
    50_000_000_000,  // 50 SOL
    100_000_000_000, // 100 SOL
];

/// Number of buckets
pub const NUM_BUCKETS: usize = 7;

/// Merkle tree depth (supports 2^20 = ~1M deposits per pool)
pub const MERKLE_TREE_DEPTH: usize = 20;

/// Minimum withdrawal delay in hours
pub const MIN_DELAY_HOURS: u8 = 0;

/// Maximum withdrawal delay in hours
pub const MAX_DELAY_HOURS: u8 = 24;

/// Default fee in basis points (0.5%)
pub const DEFAULT_FEE_BPS: u16 = 50;

/// Maximum encrypted note size
/// REDUCED to 128 bytes to fit within BPF stack limits
pub const MAX_ENCRYPTED_NOTE_SIZE: usize = 128;
