import { TOR_GATEWAY_URL, RELAYER_URL } from "../constants";
import { encryptPayload } from "../crypto/encryption";

export interface PurchaseCreditsRequest {
  blindedToken: string;
  amount: number;
  paymentTx: string; // Transaction signature of SOL payment to relayer
  payer: string; // Payer's public key (base58)
}

export interface PurchaseCreditsResponse {
  blindedSignature: string;
  publicKey: { n: string; e: string };
}

export interface DepositRequest {
  tokenId: string;
  signature: string;
  commitment: string;
  amount: number;
  encryptedNote?: string;
}

export interface DepositResponse {
  txSignature: string;
  leafIndex: number;
  merkleRoot: string;
}

export interface WithdrawalRequest {
  proof: string;
  publicInputs: string[];
  nullifierHash: string;
  recipient: string; // Hex-encoded 32 bytes (field element from circuit)
  relayer: string; // Hex-encoded 32 bytes (field element from circuit)
  fee: number;
  merkleRoot: string;
  bindingHash: string;
  delayHours: number;
  amount: number; // Amount in lamports
}

export interface WithdrawalResponse {
  success: boolean;
  txSignature?: string;
  error?: string;
}

export interface MerkleProofResponse {
  success: boolean;
  siblings: string[];
  pathIndices: number[];
  leafIndex: number;
}

export interface PoolInfo {
  bucketId: number;
  amountLamports: number;
  amountSol: number;
  treeSize: number;
  merkleRoot: string;
}

export interface RelayerInfo {
  pubKeyN: string;
  pubKeyE: string;
  solanaPubkey: string; // Relayer's Solana pubkey (base58)
  feeBps: number;
  buckets: Array<{
    id: number;
    amountLamports: number;
    amountSol: number;
    totalWithFee: number;
  }>;
}

export interface PendingWithdrawalInfo {
  pda: string;
  poolPda: string;
  bucketId: number;
  nullifierHash: string;
  recipient: string;
  executeAfter: number;
  amount: number;
  fee: number;
  executed: boolean;
}

// Request timeout in milliseconds
// Increased to 120s to handle slow devnet RPC and tree sync operations
const REQUEST_TIMEOUT = 120000;

// ECDH key pair for request encryption
let clientKeyPair: CryptoKeyPair | null = null;
let relayerPublicKey: CryptoKey | null = null;
let sharedSecret: Uint8Array | null = null;
let clientPublicKeyHex: string | null = null;

// Helper to convert Uint8Array to ArrayBuffer for Web Crypto API
function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  return buffer;
}

/**
 * Initialize ECDH key exchange with relayer
 * SECURITY: Uses proper X25519 ECDH for shared secret derivation
 */
async function initializeKeyExchange(
  relayerPubkeyHex: string,
): Promise<Uint8Array> {
  // Generate client's X25519 keypair if not already done
  if (!clientKeyPair) {
    clientKeyPair = (await crypto.subtle.generateKey({ name: "X25519" }, true, [
      "deriveBits",
    ])) as CryptoKeyPair;

    // Export client's public key for sending with encrypted requests
    const clientPubkeyRaw = await crypto.subtle.exportKey(
      "raw",
      clientKeyPair.publicKey,
    );
    clientPublicKeyHex = uint8ArrayToHex(new Uint8Array(clientPubkeyRaw));
  }

  // Import relayer's public key
  const relayerPubkeyBytes = hexToUint8Array(relayerPubkeyHex);
  relayerPublicKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(relayerPubkeyBytes),
    { name: "X25519" },
    false,
    [],
  );

  // Derive shared secret via ECDH
  const sharedSecretBits = await crypto.subtle.deriveBits(
    { name: "X25519", public: relayerPublicKey },
    clientKeyPair.privateKey,
    256,
  );
  sharedSecret = new Uint8Array(sharedSecretBits);

  return sharedSecret;
}

async function getSharedSecret(relayerPubkeyHex?: string): Promise<Uint8Array> {
  if (sharedSecret) {
    return sharedSecret;
  }

  if (!relayerPubkeyHex) {
    // Fetch relayer's public key if not provided
    const info = (await fetch(`${RELAYER_URL}/info`).then((r) => r.json())) as {
      ecdh_pubkey?: string;
    };
    if (!info.ecdh_pubkey) {
      // SECURITY: ECDH is REQUIRED - no fallback to plaintext
      throw new Error(
        "Relayer does not support ECDH encryption. Cannot proceed without encryption.",
      );
    }
    relayerPubkeyHex = info.ecdh_pubkey;
  }

  return initializeKeyExchange(relayerPubkeyHex);
}

function hexToUint8Array(hex: string): Uint8Array {
  const bytes = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    bytes[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return bytes;
}

function uint8ArrayToHex(bytes: Uint8Array): string {
  return Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

class RelayerClient {
  private useTor: boolean;
  private torVerified: boolean = false;

  constructor(useTor = true) {
    this.useTor = useTor;
  }

  /**
   * Verify Tor connection is working
   * SECURITY: Must be called before any sensitive operation
   */
  async verifyTorConnection(): Promise<{ isTor: boolean; exitIp: string }> {
    try {
      const response = await fetch(`${TOR_GATEWAY_URL}/verify-tor`, {
        method: "GET",
        signal: AbortSignal.timeout(REQUEST_TIMEOUT),
      });

      if (!response.ok) {
        throw new Error("Tor verification failed");
      }

      const data = (await response.json()) as {
        isTor: boolean;
        exitIp: string;
      };
      this.torVerified = data.isTor;

      if (!data.isTor) {
        throw new Error("Not connected through Tor network");
      }

      return data;
    } catch (error) {
      this.torVerified = false;
      throw new Error(`Tor verification failed: ${error}`);
    }
  }

  /**
   * Check if Tor gateway is available (quick health check)
   */
  async checkTorConnection(): Promise<boolean> {
    try {
      const response = await fetch(`${TOR_GATEWAY_URL}/health`, {
        method: "GET",
        signal: AbortSignal.timeout(5000),
      });
      return response.ok;
    } catch {
      return false;
    }
  }

  /**
   * Ensure Tor is verified before sensitive operations
   */
  private async ensureTor(): Promise<void> {
    if (!this.useTor) {
      console.warn("⚠️ Operating without Tor - privacy compromised!");
      return;
    }

    if (!this.torVerified) {
      await this.verifyTorConnection();
    }
  }

  /**
   * Make a request through Tor gateway
   */
  private async fetchViaTor<T>(
    targetUrl: string,
    options: RequestInit = {},
  ): Promise<T> {
    await this.ensureTor();

    // Route through Tor gateway's proxy endpoint
    const proxyUrl = `${TOR_GATEWAY_URL}/proxy?url=${encodeURIComponent(targetUrl)}`;

    const response = await fetch(proxyUrl, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Relayer error: ${error}`);
    }

    return response.json();
  }

  /**
   * Make a direct request (for non-sensitive operations)
   */
  private async fetchDirect<T>(
    endpoint: string,
    options: RequestInit = {},
  ): Promise<T> {
    const url = `${RELAYER_URL}${endpoint}`;

    const response = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...options.headers,
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT),
    });

    if (!response.ok) {
      const error = await response.text();
      throw new Error(`Relayer error: ${error}`);
    }

    return response.json();
  }

  /**
   * Get relayer info including RSA public key
   */
  async getRelayerInfo(): Promise<RelayerInfo> {
    const data = await this.fetchDirect<{
      pub_key_n: string;
      pub_key_e: string;
      solana_pubkey: string;
      fee_bps: number;
      buckets: Array<{
        id: number;
        amount_lamports: number;
        amount_sol: number;
        total_with_fee: number;
      }>;
    }>("/info");

    return {
      pubKeyN: data.pub_key_n,
      pubKeyE: data.pub_key_e,
      solanaPubkey: data.solana_pubkey,
      feeBps: data.fee_bps,
      buckets: data.buckets.map((b) => ({
        id: b.id,
        amountLamports: b.amount_lamports,
        amountSol: b.amount_sol,
        totalWithFee: b.total_with_fee,
      })),
    };
  }

  /**
   * Get relayer's RSA public key for blind signatures
   */
  async getPublicKey(): Promise<{ n: string; e: string }> {
    const info = await this.getRelayerInfo();
    return { n: info.pubKeyN, e: info.pubKeyE };
  }

  /**
   * Purchase credits with blinded token
   * This is done WITHOUT Tor (payment is visible, but unlinkable due to blind signature)
   *
   * REQUIRES: User must first send SOL payment to relayer, then provide tx signature
   */
  async purchaseCredits(
    request: PurchaseCreditsRequest,
  ): Promise<PurchaseCreditsResponse> {
    const data = await this.fetchDirect<{
      success: boolean;
      signature?: string;
      error?: string;
    }>("/sign", {
      method: "POST",
      body: JSON.stringify({
        blinded_token: request.blindedToken,
        amount: request.amount,
        payment_tx: request.paymentTx,
        payer: request.payer,
      }),
    });

    if (!data.success || !data.signature) {
      throw new Error(data.error || "Signing failed");
    }

    const pubKey = await this.getPublicKey();

    return {
      blindedSignature: data.signature,
      publicKey: pubKey,
    };
  }

  /**
   * Request deposit using signed token (via Tor)
   * SECURITY: Encrypts payload with ECDH + AES-256-GCM and routes through Tor
   * Both encryption AND Tor are MANDATORY - no bypasses allowed
   */
  async requestDeposit(request: DepositRequest): Promise<DepositResponse> {
    if (!this.useTor) {
      console.error("❌ CRITICAL: Deposit without Tor exposes your identity!");
      throw new Error("Tor required for deposits");
    }

    // Convert base64url strings to byte arrays for Rust deserialization
    const tokenIdBytes = base64UrlToBytes(request.tokenId);
    const signatureBytes = base64UrlToBytes(request.signature);
    const commitmentBytes = base64UrlToBytes(request.commitment);

    // SECURITY: Encryption is MANDATORY - no plaintext fallback
    const secret = await getSharedSecret();
    if (!clientPublicKeyHex) {
      throw new Error("ECDH key exchange failed - cannot encrypt payload");
    }

    // Encrypt payload with ECDH shared secret
    const plaintext = new TextEncoder().encode(
      JSON.stringify({
        credit: {
          token_id: Array.from(tokenIdBytes),
          signature: Array.from(signatureBytes),
          amount: request.amount,
        },
        commitment: Array.from(commitmentBytes),
        encrypted_note: request.encryptedNote
          ? Array.from(new TextEncoder().encode(request.encryptedNote))
          : null,
      }),
    );
    const encrypted = await encryptPayload(plaintext, secret);
    const body = JSON.stringify({
      encrypted: true,
      ciphertext: Array.from(encrypted.ciphertext),
      nonce: Array.from(encrypted.nonce),
      client_pubkey: clientPublicKeyHex,
    });

    const response = await this.fetchViaTor<{
      success: boolean;
      tx_signature?: string;
      leaf_index?: number;
      merkle_root?: string;
      error?: string;
    }>(`${RELAYER_URL}/deposit`, {
      method: "POST",
      body,
    });

    if (!response.success) {
      throw new Error(response.error || "Deposit failed");
    }

    return {
      txSignature: response.tx_signature!,
      leafIndex: response.leaf_index!,
      merkleRoot: response.merkle_root!,
    };
  }

  /**
   * Request withdrawal with ZK proof (via Tor)
   * SECURITY: Routes through Tor to hide IP
   */
  async requestWithdrawal(
    request: WithdrawalRequest,
  ): Promise<WithdrawalResponse> {
    if (!this.useTor) {
      console.error(
        "❌ CRITICAL: Withdrawal without Tor exposes your identity!",
      );
      throw new Error("Tor required for withdrawals");
    }

    // recipient and relayer are now hex-encoded field elements from the circuit
    // These are the EXACT values the circuit used (potentially reduced mod BN254)
    const response = await this.fetchViaTor<{
      success: boolean;
      tx_signature?: string;
      error?: string;
    }>(`${RELAYER_URL}/withdraw`, {
      method: "POST",
      body: JSON.stringify({
        request: {
          proof: {
            a: Array.from(hexToBytes(request.proof.slice(0, 128))),
            b: Array.from(hexToBytes(request.proof.slice(128, 384))),
            c: Array.from(hexToBytes(request.proof.slice(384, 512))),
          },
          public_inputs: {
            root: Array.from(hexToBytes(request.merkleRoot)),
            nullifier_hash: Array.from(hexToBytes(request.nullifierHash)),
            recipient: Array.from(hexToBytes(request.recipient)), // Now hex, not base58
            amount: request.amount,
            relayer: Array.from(hexToBytes(request.relayer)), // Now hex, not base58
            fee: request.fee,
            binding_hash: Array.from(hexToBytes(request.bindingHash)),
          },
        },
        delay_hours: request.delayHours,
      }),
    });

    return {
      success: response.success,
      txSignature: response.tx_signature,
      error: response.error,
    };
  }

  /**
   * Get Merkle proof for a commitment
   */
  async getMerkleProof(
    bucketId: number,
    leafIndex: number,
  ): Promise<MerkleProofResponse> {
    const data = await this.fetchDirect<{
      success: boolean;
      siblings?: string[];
      path_indices?: number[];
      leaf_index?: number;
      error?: string;
    }>(`/proof/${bucketId}/${leafIndex}`);

    if (!data.success) {
      throw new Error(data.error || "Failed to get merkle proof");
    }

    return {
      success: true,
      siblings: data.siblings!,
      pathIndices: data.path_indices!,
      leafIndex: data.leaf_index!,
    };
  }

  /**
   * Get pool information
   */
  async getPoolInfo(bucketId: number): Promise<PoolInfo> {
    const data = await this.fetchDirect<{
      bucket_id: number;
      amount_lamports: number;
      amount_sol: number;
      tree_size: number;
      merkle_root: string;
    }>(`/pools/${bucketId}`);

    return {
      bucketId: data.bucket_id,
      amountLamports: data.amount_lamports,
      amountSol: data.amount_sol,
      treeSize: data.tree_size,
      merkleRoot: data.merkle_root,
    };
  }

  /**
   * Get all pools information
   */
  async getAllPools(): Promise<PoolInfo[]> {
    const data = await this.fetchDirect<{
      pools: Array<{
        bucket_id: number;
        amount_lamports: number;
        amount_sol: number;
        tree_size: number;
        merkle_root: string;
      }>;
    }>("/pools");

    return data.pools.map((p) => ({
      bucketId: p.bucket_id,
      amountLamports: p.amount_lamports,
      amountSol: p.amount_sol,
      treeSize: p.tree_size,
      merkleRoot: p.merkle_root,
    }));
  }

  /**
   * Check if a nullifier has been used
   */
  async checkNullifier(_nullifierHash: string): Promise<{ used: boolean }> {
    // This would query the Solana program directly
    // For now, return false (not implemented)
    return { used: false };
  }

  /**
   * Get pending withdrawals from relayer
   */
  async getPendingWithdrawals(): Promise<PendingWithdrawalInfo[]> {
    const data = await this.fetchDirect<{
      pending: Array<{
        pda: string;
        pool_pda: string;
        bucket_id: number;
        nullifier_hash: string;
        recipient: string;
        execute_after: number;
        amount: number;
        fee: number;
        executed: boolean;
      }>;
    }>("/withdraw/pending");

    return data.pending.map((p) => ({
      pda: p.pda,
      poolPda: p.pool_pda,
      bucketId: p.bucket_id,
      nullifierHash: p.nullifier_hash,
      recipient: p.recipient,
      executeAfter: p.execute_after,
      amount: p.amount,
      fee: p.fee,
      executed: p.executed,
    }));
  }

  /**
   * Manually trigger execution of a pending withdrawal
   */
  async executeWithdrawal(nullifierHash: string): Promise<WithdrawalResponse> {
    const response = await this.fetchDirect<{
      success: boolean;
      tx_signature?: string;
      error?: string;
    }>("/withdraw/execute", {
      method: "POST",
      body: JSON.stringify({ nullifier_hash: nullifierHash }),
    });

    return {
      success: response.success,
      txSignature: response.tx_signature,
      error: response.error,
    };
  }
}

// Helper to convert hex string to byte array
function hexToBytes(hex: string): number[] {
  if (hex.startsWith("0x")) hex = hex.slice(2);
  const bytes: number[] = [];
  for (let i = 0; i < hex.length; i += 2) {
    bytes.push(parseInt(hex.slice(i, i + 2), 16));
  }
  return bytes;
}

// Helper to convert base64url string to byte array
function base64UrlToBytes(base64url: string): Uint8Array {
  // Convert base64url to base64
  let base64 = base64url.replace(/-/g, "+").replace(/_/g, "/");
  // Add padding if needed
  while (base64.length % 4) {
    base64 += "=";
  }
  // Decode base64
  const binaryString = atob(base64);
  const bytes = new Uint8Array(binaryString.length);
  for (let i = 0; i < binaryString.length; i++) {
    bytes[i] = binaryString.charCodeAt(i);
  }
  return bytes;
}

// Export singleton instances
export const relayerClient = new RelayerClient(true);
export const relayerClientDirect = new RelayerClient(false);

export default relayerClient;
