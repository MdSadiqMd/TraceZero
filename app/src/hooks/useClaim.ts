import { useState, useCallback, useEffect } from "react";
import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  Transaction,
} from "@solana/web3.js";
import {
  secureStealthStorage,
  exportStealthKeysEncrypted,
  importStealthKeysEncrypted,
  type StoredStealthKey,
} from "@/lib/crypto/secureStorage";
import { SOLANA_RPC_URL } from "@/lib/constants";

const RPC_URL = SOLANA_RPC_URL;

export interface ClaimableEntry extends StoredStealthKey {
  balance: number; // lamports
}

export function useClaim() {
  const [entries, setEntries] = useState<ClaimableEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [claiming, setClaiming] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isUnlocked, setIsUnlocked] = useState(false);

  // Try to auto-unlock from session on mount
  useEffect(() => {
    const tryUnlock = async () => {
      const unlocked = await secureStealthStorage.tryAutoInitialize();
      setIsUnlocked(unlocked);
    };
    tryUnlock();
  }, []);

  const unlock = useCallback(async (password: string): Promise<boolean> => {
    try {
      const success = await secureStealthStorage.initialize(password);
      setIsUnlocked(success);
      return success;
    } catch {
      return false;
    }
  }, []);

  const lock = useCallback(() => {
    secureStealthStorage.lock();
    setIsUnlocked(false);
    setEntries([]);
  }, []);

  const refresh = useCallback(async () => {
    if (!isUnlocked) {
      setError("Storage locked. Please unlock first.");
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const conn = new Connection(RPC_URL, "confirmed");
      const keys = secureStealthStorage.getUnsweptKeys();
      const results: ClaimableEntry[] = [];

      for (const k of keys) {
        try {
          const balance = await conn.getBalance(
            new PublicKey(k.stealthAddress),
          );
          results.push({ ...k, balance });
        } catch {
          results.push({ ...k, balance: 0 });
        }
      }
      setEntries(results);
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Failed to load stealth balances",
      );
    } finally {
      setLoading(false);
    }
  }, [isUnlocked]);

  const claim = useCallback(
    async (stealthAddress: string, destination: string): Promise<string> => {
      if (!isUnlocked) {
        const sessionPassword = sessionStorage.getItem("stealth-session-password");
        if (sessionPassword) {
          const unlocked = await secureStealthStorage.initialize(sessionPassword);
          if (unlocked) {
            setIsUnlocked(true);
          } else {
            throw new Error("Failed to auto-unlock storage");
          }
        } else {
          throw new Error("Storage locked. Please unlock first.");
        }
      }

      setClaiming(stealthAddress);
      setError(null);
      try {
        const conn = new Connection(RPC_URL, "confirmed");
        const all = secureStealthStorage.getKeys();
        const entry = all.find((k) => k.stealthAddress === stealthAddress);
        if (!entry) throw new Error("Stealth key not found");

        // Decode the secret key
        const secretBytes = Uint8Array.from(atob(entry.stealthSecretKey), (c) =>
          c.charCodeAt(0),
        );
        const stealthKp = Keypair.fromSecretKey(secretBytes);

        // Verify the keypair matches the expected address
        if (stealthKp.publicKey.toBase58() !== stealthAddress) {
          throw new Error(
            "Stealth keypair mismatch — secret key does not match address",
          );
        }

        const destPubkey = new PublicKey(destination);
        const balance = await conn.getBalance(stealthKp.publicKey);
        if (balance === 0) throw new Error("No balance on stealth address");

        // Solana requires accounts to either:
        //   (a) remain rent-exempt after a transfer, OR
        //   (b) be drained to 0 lamports (account auto-closed by runtime)
        // Empty system accounts need ~890_880 lamports to be rent-exempt.
        // For stealth (single-use) addresses, draining to 0 is correct.
        // The fee (5000 lamports) is deducted automatically from the signer.
        const FEE = 5000;
        if (balance <= FEE) {
          throw new Error("Balance too low to cover transaction fee");
        }
        // Transfer EVERYTHING except the fee — account becomes 0 lamports → auto-closed
        const transferAmount = balance - FEE;

        const tx = new Transaction().add(
          SystemProgram.transfer({
            fromPubkey: stealthKp.publicKey,
            toPubkey: destPubkey,
            lamports: transferAmount,
          }),
        );

        // Use sendTransaction with skipPreflight to bypass the rent simulation check.
        // The runtime correctly handles draining (account closes), but the simulator
        // flags it as a rent-exempt violation. skipPreflight lets the actual tx through.
        const blockhash = await conn.getLatestBlockhash("confirmed");
        tx.recentBlockhash = blockhash.blockhash;
        tx.feePayer = stealthKp.publicKey;
        tx.sign(stealthKp);

        const sig = await conn.sendRawTransaction(tx.serialize(), {
          skipPreflight: true,
          preflightCommitment: "confirmed",
        });
        await conn.confirmTransaction(
          {
            signature: sig,
            blockhash: blockhash.blockhash,
            lastValidBlockHeight: blockhash.lastValidBlockHeight,
          },
          "confirmed",
        );
        await secureStealthStorage.markSwept(stealthAddress, sig);

        // Update local state
        setEntries((prev) =>
          prev.filter((e) => e.stealthAddress !== stealthAddress),
        );

        return sig;
      } catch (e) {
        const msg = e instanceof Error ? e.message : "Claim failed";
        setError(msg);
        throw e;
      } finally {
        setClaiming(null);
      }
    },
    [isUnlocked],
  );

  const clearKeys = useCallback(() => {
    secureStealthStorage.clear();
    setIsUnlocked(false);
    setEntries([]);
  }, []);

  return {
    entries,
    loading,
    claiming,
    error,
    isUnlocked,
    unlock,
    lock,
    refresh,
    claim,
    exportKeys: exportStealthKeysEncrypted,
    importKeys: importStealthKeysEncrypted,
    clearKeys,
  };
}
