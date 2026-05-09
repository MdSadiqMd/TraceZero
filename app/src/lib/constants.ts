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

function isLocalhost(): boolean {
  if (typeof window === 'undefined') return false;
  const hostname = window.location.hostname;
  return hostname === 'localhost' || hostname === '127.0.0.1';
}

function getRelayerUrl(): string {
  if (typeof window !== 'undefined' && (window as any).__RELAYER_URL__) {
    return (window as any).__RELAYER_URL__;
  }
  if (import.meta.env.VITE_RELAYER_URL) {
    return import.meta.env.VITE_RELAYER_URL;
  }
  return "http://localhost:8080";
}

function getTorGatewayUrl(): string {
  if (typeof window !== 'undefined' && (window as any).__TOR_GATEWAY_URL__) {
    return (window as any).__TOR_GATEWAY_URL__;
  }
  
  if (import.meta.env.VITE_TOR_GATEWAY_URL) {
    return import.meta.env.VITE_TOR_GATEWAY_URL;
  }
  
  // Caddy proxies /tor-gateway/* to the gateway service
  const relayerUrl = getRelayerUrl();
  if (relayerUrl && !relayerUrl.includes('localhost') && !relayerUrl.includes('127.0.0.1')) {
    return `${relayerUrl}/tor-gateway`;
  }
  return "http://localhost:3080";
}

function getSolanaRpcUrl(): string {
  if (typeof window !== 'undefined' && (window as any).__SOLANA_RPC_URL__) {
    return (window as any).__SOLANA_RPC_URL__;
  }
  
  return import.meta.env.VITE_SOLANA_RPC_URL || "https://api.devnet.solana.com";
}

export const TOR_GATEWAY_URL = getTorGatewayUrl();
export const RELAYER_URL = getRelayerUrl();
export const SOLANA_RPC_URL = getSolanaRpcUrl();
export const IS_LOCAL_DEV = isLocalhost();

// Note: For production, SOLANA_RPC_URL should be routed through Tor gateway
// to prevent DNS leaks. Example: http://localhost:3080/rpc (proxied to Solana RPC)

// Domain tags for Poseidon hashes (MUST match circuits/*.circom and SDK)
export const DOMAIN_NULLIFIER = 1853189228n; // "null" as u32
export const DOMAIN_COMMIT = 1668246637n; // "comm" as u32
export const DOMAIN_BIND = 1651076196n; // "bind" as u32
export const DOMAIN_OWNER_BIND = 1869771618n; // "ownb" as u32

// Merkle tree depth
export const MERKLE_TREE_DEPTH = 20;
