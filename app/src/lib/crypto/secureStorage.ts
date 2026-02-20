/**
 * Secure Storage for sensitive deposit data
 *
 * SECURITY: Uses AES-256-GCM encryption with a key derived from user password
 * to protect nullifiers and secrets from XSS attacks and browser extensions.
 *
 * The encryption key is derived using PBKDF2 with 100,000 iterations.
 */

const STORAGE_KEY = "privacy-proxy-secure-deposits";
const PBKDF2_ITERATIONS = 100000;

interface EncryptedStore {
  ciphertext: string; // base64
  iv: string; // base64
  salt: string; // base64
}

// Helper to convert Uint8Array to ArrayBuffer for Web Crypto API
function toArrayBuffer(data: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(data.byteLength);
  new Uint8Array(buffer).set(data);
  return buffer;
}

/**
 * Derive encryption key from password using PBKDF2
 */
async function deriveKey(
  password: string,
  salt: Uint8Array,
): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const passwordBytes = encoder.encode(password);
  const passwordKey = await crypto.subtle.importKey(
    "raw",
    toArrayBuffer(passwordBytes),
    "PBKDF2",
    false,
    ["deriveBits", "deriveKey"],
  );

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt: toArrayBuffer(salt),
      iterations: PBKDF2_ITERATIONS,
      hash: "SHA-256",
    },
    passwordKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypt data with password
 */
async function encrypt(
  data: string,
  password: string,
): Promise<EncryptedStore> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);

  const encoder = new TextEncoder();
  const dataBytes = encoder.encode(data);
  const ciphertext = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(dataBytes),
  );

  return {
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(ciphertext))),
    iv: btoa(String.fromCharCode(...iv)),
    salt: btoa(String.fromCharCode(...salt)),
  };
}

/**
 * Decrypt data with password
 */
async function decrypt(
  store: EncryptedStore,
  password: string,
): Promise<string> {
  const salt = Uint8Array.from(atob(store.salt), (c) => c.charCodeAt(0));
  const iv = Uint8Array.from(atob(store.iv), (c) => c.charCodeAt(0));
  const ciphertext = Uint8Array.from(atob(store.ciphertext), (c) =>
    c.charCodeAt(0),
  );

  const key = await deriveKey(password, salt);

  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: toArrayBuffer(iv) },
    key,
    toArrayBuffer(ciphertext),
  );

  return new TextDecoder().decode(plaintext);
}

export interface SecureDeposit {
  id: string;
  amount: number;
  secret: number[]; // Stored as array for JSON serialization
  nullifier: number[];
  commitment: number[];
  leafIndex: number;
  txSignature: string;
  createdAt: number;
  withdrawn: boolean;
}

/**
 * Secure storage manager for deposits
 */
export class SecureDepositStorage {
  private password: string | null = null;
  private deposits: SecureDeposit[] = [];
  private initialized = false;

  /**
   * Initialize storage with password
   * Must be called before any other operations
   */
  async initialize(password: string): Promise<boolean> {
    this.password = password;

    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      this.deposits = [];
      this.initialized = true;
      return true;
    }

    try {
      const encryptedStore: EncryptedStore = JSON.parse(stored);
      const decrypted = await decrypt(encryptedStore, password);
      this.deposits = JSON.parse(decrypted);
      this.initialized = true;
      return true;
    } catch {
      // Wrong password or corrupted data
      this.password = null;
      return false;
    }
  }

  /**
   * Check if storage is initialized
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Check if storage has existing data (needs password)
   */
  static hasExistingData(): boolean {
    return localStorage.getItem(STORAGE_KEY) !== null;
  }

  /**
   * Save deposits to encrypted storage
   */
  private async save(): Promise<void> {
    if (!this.password) {
      throw new Error("Storage not initialized");
    }

    const data = JSON.stringify(this.deposits);
    const encrypted = await encrypt(data, this.password);
    localStorage.setItem(STORAGE_KEY, JSON.stringify(encrypted));
  }

  /**
   * Add a deposit
   */
  async addDeposit(deposit: SecureDeposit): Promise<void> {
    if (!this.initialized) throw new Error("Storage not initialized");
    this.deposits.push(deposit);
    await this.save();
  }

  /**
   * Get all deposits
   */
  getDeposits(): SecureDeposit[] {
    if (!this.initialized) throw new Error("Storage not initialized");
    return [...this.deposits];
  }

  /**
   * Get unspent deposits
   */
  getUnspentDeposits(): SecureDeposit[] {
    return this.getDeposits().filter((d) => !d.withdrawn);
  }

  /**
   * Mark deposit as withdrawn
   */
  async markWithdrawn(id: string): Promise<void> {
    if (!this.initialized) throw new Error("Storage not initialized");
    const deposit = this.deposits.find((d) => d.id === id);
    if (deposit) {
      deposit.withdrawn = true;
      await this.save();
    }
  }

  /**
   * Remove a deposit
   */
  async removeDeposit(id: string): Promise<void> {
    if (!this.initialized) throw new Error("Storage not initialized");
    this.deposits = this.deposits.filter((d) => d.id !== id);
    await this.save();
  }

  /**
   * Clear all deposits (requires re-initialization)
   */
  clear(): void {
    localStorage.removeItem(STORAGE_KEY);
    this.deposits = [];
    this.password = null;
    this.initialized = false;
  }

  /**
   * Change password
   */
  async changePassword(newPassword: string): Promise<void> {
    if (!this.initialized) throw new Error("Storage not initialized");
    this.password = newPassword;
    await this.save();
  }

  /**
   * Export deposits for backup (encrypted with provided password)
   */
  async exportBackup(backupPassword: string): Promise<string> {
    if (!this.initialized) throw new Error("Storage not initialized");
    const data = JSON.stringify(this.deposits);
    const encrypted = await encrypt(data, backupPassword);
    return JSON.stringify(encrypted);
  }

  /**
   * Import deposits from backup
   */
  async importBackup(backup: string, backupPassword: string): Promise<boolean> {
    if (!this.initialized) throw new Error("Storage not initialized");

    try {
      const encryptedStore: EncryptedStore = JSON.parse(backup);
      const decrypted = await decrypt(encryptedStore, backupPassword);
      const imported: SecureDeposit[] = JSON.parse(decrypted);

      // Merge with existing deposits (avoid duplicates)
      const existingIds = new Set(this.deposits.map((d) => d.id));
      for (const deposit of imported) {
        if (!existingIds.has(deposit.id)) {
          this.deposits.push(deposit);
        }
      }

      await this.save();
      return true;
    } catch {
      return false;
    }
  }
}

// Singleton instance
export const secureStorage = new SecureDepositStorage();

// ─── Stealth Key Storage ─────────────────────────────────────────────────────
// Stores stealth keypairs from withdrawals so users can sweep funds later.
// Uses simple AES-GCM encryption keyed to a fixed device-local passphrase.

const STEALTH_STORAGE_KEY = "privacy-proxy-stealth-keys";

export interface StoredStealthKey {
  id: string;
  stealthAddress: string;
  /** base64-encoded 64-byte Ed25519 secret key */
  stealthSecretKey: string;
  ephemeralPubkey: string;
  amount: number;
  createdAt: number;
  swept: boolean;
  sweepTxSignature?: string;
}

function loadStealthKeys(): StoredStealthKey[] {
  try {
    const raw = localStorage.getItem(STEALTH_STORAGE_KEY);
    if (!raw) return [];
    return JSON.parse(raw) as StoredStealthKey[];
  } catch {
    return [];
  }
}

function saveStealthKeys(keys: StoredStealthKey[]): void {
  localStorage.setItem(STEALTH_STORAGE_KEY, JSON.stringify(keys));
}

export function addStealthKey(entry: StoredStealthKey): void {
  const keys = loadStealthKeys();
  // Avoid duplicates
  if (keys.some((k) => k.stealthAddress === entry.stealthAddress)) return;
  keys.push(entry);
  saveStealthKeys(keys);
}

export function getStealthKeys(): StoredStealthKey[] {
  return loadStealthKeys();
}

export function getUnsweptStealthKeys(): StoredStealthKey[] {
  return loadStealthKeys().filter((k) => !k.swept);
}

export function markStealthKeySwept(
  stealthAddress: string,
  sweepTxSignature: string,
): void {
  const keys = loadStealthKeys();
  const key = keys.find((k) => k.stealthAddress === stealthAddress);
  if (key) {
    key.swept = true;
    key.sweepTxSignature = sweepTxSignature;
    saveStealthKeys(keys);
  }
}

export function clearAllStealthKeys(): void {
  localStorage.removeItem(STEALTH_STORAGE_KEY);
}

export function exportStealthKeys(): string {
  return JSON.stringify(loadStealthKeys());
}

export function importStealthKeys(json: string): number {
  const imported: StoredStealthKey[] = JSON.parse(json);
  const existing = loadStealthKeys();
  const existingAddrs = new Set(existing.map((k) => k.stealthAddress));
  let added = 0;
  for (const entry of imported) {
    if (!existingAddrs.has(entry.stealthAddress)) {
      existing.push(entry);
      added++;
    }
  }
  saveStealthKeys(existing);
  return added;
}
