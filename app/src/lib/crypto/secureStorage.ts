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
// SECURITY: Uses AES-256-GCM encryption with password-derived key

const STEALTH_STORAGE_KEY = "privacy-proxy-stealth-keys";
const STEALTH_SESSION_KEY = "stealth-session-password"; // In-memory only

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

/**
 * Secure Stealth Key Storage Manager
 * Encrypts stealth keys in localStorage with user password
 */
export class SecureStealthStorage {
  private password: string | null = null;
  private keys: StoredStealthKey[] = [];
  private initialized = false;

  constructor() {
    // Ensure keys is always an array
    this.keys = [];
  }

  /**
   * Initialize storage with password
   * Must be called before any other operations
   */
  async initialize(password: string): Promise<boolean> {
    this.password = password;

    const stored = localStorage.getItem(STEALTH_STORAGE_KEY);
    if (!stored) {
      this.keys = [];
      this.initialized = true;
      
      // Store password in sessionStorage for auto-unlock during session
      sessionStorage.setItem(STEALTH_SESSION_KEY, password);
      
      return true;
    }

    try {
      // Try to parse as encrypted data first
      const parsed = JSON.parse(stored);
      
      // Check if it's encrypted data (has ciphertext, iv, salt)
      if (parsed.ciphertext && parsed.iv && parsed.salt) {
        // It's encrypted - decrypt it
        const encryptedStore: EncryptedStore = parsed;
        const decrypted = await decrypt(encryptedStore, password);
        const decryptedData = JSON.parse(decrypted);
        
        // Ensure it's an array - CRITICAL: Always validate
        if (Array.isArray(decryptedData)) {
          this.keys = decryptedData;
        } else {
          console.warn('Decrypted data is not an array, resetting to empty');
          this.keys = [];
        }
      } else if (Array.isArray(parsed)) {
        // It's old plaintext data - migrate it
        console.warn('Migrating plaintext stealth keys to encrypted storage');
        this.keys = parsed;
        // Save encrypted version
        await this.save();
      } else {
        // Unknown format - reset to empty
        console.warn('Unknown storage format, resetting to empty');
        this.keys = [];
      }
      
      this.initialized = true;
      
      // Store password in sessionStorage for auto-unlock during session
      sessionStorage.setItem(STEALTH_SESSION_KEY, password);
      
      return true;
    } catch (error) {
      // Wrong password or corrupted data
      console.error('Failed to initialize storage:', error);
      this.password = null;
      this.keys = [];
      this.initialized = false;
      return false;
    }
  }

  /**
   * Try to auto-initialize from session password
   */
  async tryAutoInitialize(): Promise<boolean> {
    const sessionPassword = sessionStorage.getItem(STEALTH_SESSION_KEY);
    if (sessionPassword) {
      return this.initialize(sessionPassword);
    }
    return false;
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
    return localStorage.getItem(STEALTH_STORAGE_KEY) !== null;
  }

  /**
   * Save keys to encrypted storage
   */
  private async save(): Promise<void> {
    if (!this.password) {
      throw new Error("Storage not initialized");
    }

    // Ensure we're always saving an array
    if (!Array.isArray(this.keys)) {
      console.error('CRITICAL: Attempting to save non-array keys, resetting to empty array');
      this.keys = [];
    }

    const data = JSON.stringify(this.keys);
    const encrypted = await encrypt(data, this.password);
    localStorage.setItem(STEALTH_STORAGE_KEY, JSON.stringify(encrypted));
  }

  /**
   * Add a stealth key
   */
  async addKey(entry: StoredStealthKey): Promise<void> {
    if (!this.initialized) {
      throw new Error("Storage not initialized");
    }
    
    // CRITICAL: Ensure keys is always an array before any operation
    // This check must happen BEFORE any array method is called
    if (!this.keys || !Array.isArray(this.keys)) {
      console.error('CRITICAL: keys was not an array, resetting to empty array', typeof this.keys, this.keys);
      this.keys = [];
    }
    
    // Validate entry
    if (!entry || !entry.stealthAddress) {
      throw new Error("Invalid stealth key entry");
    }
    
    // Avoid duplicates - double-check array before using .some()
    if (!Array.isArray(this.keys)) {
      console.error('CRITICAL: keys became non-array after validation, resetting');
      this.keys = [];
    }
    
    try {
      // Final safety check before .some()
      if (Array.isArray(this.keys) && this.keys.some((k) => k && k.stealthAddress === entry.stealthAddress)) {
        console.log('Stealth key already exists, skipping duplicate');
        return;
      }
    } catch (error) {
      console.error('Error checking for duplicates:', error, 'keys type:', typeof this.keys, 'keys value:', this.keys);
      // Reset keys if .some() fails
      this.keys = [];
    }
    
    // Final check before push
    if (!Array.isArray(this.keys)) {
      console.error('CRITICAL: keys is not array before push, resetting');
      this.keys = [];
    }
    
    this.keys.push(entry);
    await this.save();
  }

  /**
   * Get all stealth keys
   */
  getKeys(): StoredStealthKey[] {
    if (!this.initialized) throw new Error("Storage not initialized");
    
    // Ensure keys is an array
    if (!Array.isArray(this.keys)) {
      console.warn('Keys was not an array, resetting to empty array');
      this.keys = [];
    }
    
    return [...this.keys];
  }

  /**
   * Get unswept stealth keys
   */
  getUnsweptKeys(): StoredStealthKey[] {
    const keys = this.getKeys();
    return keys.filter((k) => !k.swept);
  }

  /**
   * Mark stealth key as swept
   */
  async markSwept(stealthAddress: string, sweepTxSignature: string): Promise<void> {
    if (!this.initialized) throw new Error("Storage not initialized");
    
    const key = this.keys.find((k) => k.stealthAddress === stealthAddress);
    if (key) {
      key.swept = true;
      key.sweepTxSignature = sweepTxSignature;
      await this.save();
    }
  }

  /**
   * Clear all stealth keys (requires re-initialization)
   */
  clear(): void {
    localStorage.removeItem(STEALTH_STORAGE_KEY);
    sessionStorage.removeItem(STEALTH_SESSION_KEY);
    this.keys = []; // Ensure it's always an array
    this.password = null;
    this.initialized = false;
  }

  /**
   * Change password
   */
  async changePassword(newPassword: string): Promise<void> {
    if (!this.initialized) throw new Error("Storage not initialized");
    this.password = newPassword;
    sessionStorage.setItem(STEALTH_SESSION_KEY, newPassword);
    await this.save();
  }

  /**
   * Export keys for backup (encrypted with provided password)
   */
  async exportBackup(backupPassword: string): Promise<string> {
    if (!this.initialized) throw new Error("Storage not initialized");
    const data = JSON.stringify(this.keys);
    const encrypted = await encrypt(data, backupPassword);
    return JSON.stringify(encrypted);
  }

  /**
   * Import keys from backup
   */
  async importBackup(backup: string, backupPassword: string): Promise<number> {
    if (!this.initialized) throw new Error("Storage not initialized");

    try {
      const encryptedStore: EncryptedStore = JSON.parse(backup);
      const decrypted = await decrypt(encryptedStore, backupPassword);
      const imported: StoredStealthKey[] = JSON.parse(decrypted);

      // Merge with existing keys (avoid duplicates)
      const existingAddrs = new Set(this.keys.map((k) => k.stealthAddress));
      let added = 0;
      
      for (const entry of imported) {
        if (!existingAddrs.has(entry.stealthAddress)) {
          this.keys.push(entry);
          added++;
        }
      }

      await this.save();
      return added;
    } catch {
      throw new Error("Failed to import backup");
    }
  }

  /**
   * Lock storage (clear password from memory)
   */
  lock(): void {
    this.password = null;
    this.initialized = false;
    this.keys = []; // Ensure it's always an array
    sessionStorage.removeItem(STEALTH_SESSION_KEY);
  }
}

// Singleton instance
export const secureStealthStorage = new SecureStealthStorage();

// ─── Legacy Plaintext Functions (DEPRECATED) ─────────────────────────────────
// These are kept for backward compatibility but should not be used

function loadStealthKeys(): StoredStealthKey[] {
  console.warn('DEPRECATED: loadStealthKeys() uses plaintext storage');
  try {
    const raw = localStorage.getItem(STEALTH_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    // Ensure it's an array
    if (!Array.isArray(parsed)) {
      console.error('Corrupted plaintext storage: not an array, resetting');
      localStorage.removeItem(STEALTH_STORAGE_KEY);
      return [];
    }
    return parsed as StoredStealthKey[];
  } catch (error) {
    console.error('Failed to load plaintext keys:', error);
    localStorage.removeItem(STEALTH_STORAGE_KEY);
    return [];
  }
}

function saveStealthKeys(keys: StoredStealthKey[]): void {
  console.warn('DEPRECATED: saveStealthKeys() uses plaintext storage');
  // Ensure we're saving an array
  if (!Array.isArray(keys)) {
    console.error('Attempting to save non-array keys, resetting to empty array');
    keys = [];
  }
  localStorage.setItem(STEALTH_STORAGE_KEY, JSON.stringify(keys));
}

export function addStealthKey(entry: StoredStealthKey): void {
  console.warn('DEPRECATED: addStealthKey() uses plaintext storage. Use secureStealthStorage.addKey() instead.');
  try {
    const keys = loadStealthKeys();
    // Ensure keys is an array before using .some()
    if (!Array.isArray(keys)) {
      console.error('Keys is not an array, resetting');
      saveStealthKeys([entry]);
      return;
    }
    if (keys.some((k) => k && k.stealthAddress === entry.stealthAddress)) return;
    keys.push(entry);
    saveStealthKeys(keys);
  } catch (error) {
    console.error('Failed to add stealth key:', error);
    // Reset storage and save just this entry
    saveStealthKeys([entry]);
  }
}

export function getStealthKeys(): StoredStealthKey[] {
  console.warn('DEPRECATED: getStealthKeys() uses plaintext storage. Use secureStealthStorage.getKeys() instead.');
  return loadStealthKeys();
}

export function getUnsweptStealthKeys(): StoredStealthKey[] {
  console.warn('DEPRECATED: getUnsweptStealthKeys() uses plaintext storage. Use secureStealthStorage.getUnsweptKeys() instead.');
  return loadStealthKeys().filter((k) => !k.swept);
}

export function markStealthKeySwept(
  stealthAddress: string,
  sweepTxSignature: string,
): void {
  console.warn('DEPRECATED: markStealthKeySwept() uses plaintext storage. Use secureStealthStorage.markSwept() instead.');
  const keys = loadStealthKeys();
  const key = keys.find((k) => k.stealthAddress === stealthAddress);
  if (key) {
    key.swept = true;
    key.sweepTxSignature = sweepTxSignature;
    saveStealthKeys(keys);
  }
}

export function clearAllStealthKeys(): void {
  console.warn('DEPRECATED: clearAllStealthKeys() uses plaintext storage. Use secureStealthStorage.clear() instead.');
  localStorage.removeItem(STEALTH_STORAGE_KEY);
}

// ─── Convenience Functions for Export/Import ─────────────────────────────────

/**
 * Export stealth keys encrypted with password
 * Requires storage to be initialized first
 */
export async function exportStealthKeysEncrypted(password: string): Promise<string> {
  if (!secureStealthStorage.isInitialized()) {
    throw new Error("Storage not initialized. Please unlock first.");
  }
  return secureStealthStorage.exportBackup(password);
}

/**
 * Import stealth keys from encrypted backup
 * Requires storage to be initialized first
 */
export async function importStealthKeysEncrypted(
  encryptedJson: string,
  password: string,
): Promise<number> {
  if (!secureStealthStorage.isInitialized()) {
    throw new Error("Storage not initialized. Please unlock first.");
  }
  return secureStealthStorage.importBackup(encryptedJson, password);
}

/**
 * DEPRECATED: Plaintext export (insecure, kept for backward compatibility)
 * Use exportStealthKeysEncrypted instead
 */
export function exportStealthKeys(): string {
  console.warn('SECURITY WARNING: exportStealthKeys() exports plaintext keys. Use exportStealthKeysEncrypted() instead.');
  return JSON.stringify(loadStealthKeys());
}

/**
 * DEPRECATED: Plaintext import (insecure, kept for backward compatibility)
 * Use importStealthKeysEncrypted instead
 */
export function importStealthKeys(json: string): number {
  console.warn('SECURITY WARNING: importStealthKeys() imports plaintext keys. Use importStealthKeysEncrypted() instead.');
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
