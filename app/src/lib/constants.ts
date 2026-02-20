// Bucket amounts in lamports (1 SOL = 1e9 lamports)
export const BUCKET_AMOUNTS = [
  0.1 * 1e9, // 0.1 SOL
  0.5 * 1e9, // 0.5 SOL
  1 * 1e9, // 1 SOL
  5 * 1e9, // 5 SOL
  10 * 1e9, // 10 SOL
  50 * 1e9, // 50 SOL
  100 * 1e9, // 100 SOL
] as const;

export const RELAYER_FEE_PERCENT = 0.5; // 0.5%
export const TOR_GATEWAY_URL = "http://localhost:3080";
export const RELAYER_URL = "http://localhost:8080";
export const SOLANA_RPC_URL = "https://api.devnet.solana.com";

// Domain tags for Poseidon hashes (MUST match circuits/*.circom and SDK)
export const DOMAIN_NULLIFIER = 1853189228n; // "null" as u32
export const DOMAIN_COMMIT = 1668246637n; // "comm" as u32
export const DOMAIN_BIND = 1651076196n; // "bind" as u32
export const DOMAIN_OWNER_BIND = 1869771618n; // "ownb" as u32

// Merkle tree depth
export const MERKLE_TREE_DEPTH = 20;
