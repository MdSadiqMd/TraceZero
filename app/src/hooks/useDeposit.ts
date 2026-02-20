import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Deposit {
  id: string;
  amount: number;
  secret: Uint8Array;
  nullifier: Uint8Array;
  commitment: Uint8Array;
  leafIndex: number;
  txSignature: string;
  createdAt: number;
  withdrawn: boolean;
}

interface DepositState {
  deposits: Deposit[];
  addDeposit: (deposit: Deposit) => void;
  markWithdrawn: (id: string) => void;
  removeDeposit: (id: string) => void;
  clearDeposits: () => void;
}

// Custom serializer for Uint8Array
const serializeDeposit = (deposit: Deposit) => ({
  ...deposit,
  secret: Array.from(deposit.secret),
  nullifier: Array.from(deposit.nullifier),
  commitment: Array.from(deposit.commitment),
});

const deserializeDeposit = (
  deposit: ReturnType<typeof serializeDeposit>,
): Deposit => ({
  ...deposit,
  secret: new Uint8Array(deposit.secret),
  nullifier: new Uint8Array(deposit.nullifier),
  commitment: new Uint8Array(deposit.commitment),
});

export const useDepositStore = create<DepositState>()(
  persist(
    (set) => ({
      deposits: [],
      addDeposit: (deposit) =>
        set((state) => ({ deposits: [...state.deposits, deposit] })),
      markWithdrawn: (id) =>
        set((state) => ({
          deposits: state.deposits.map((d) =>
            d.id === id ? { ...d, withdrawn: true } : d,
          ),
        })),
      removeDeposit: (id) =>
        set((state) => ({
          deposits: state.deposits.filter((d) => d.id !== id),
        })),
      clearDeposits: () => set({ deposits: [] }),
    }),
    {
      name: "privacy-proxy-deposits",
      storage: {
        getItem: (name) => {
          const str = localStorage.getItem(name);
          if (!str) return null;
          const parsed = JSON.parse(str);
          return {
            ...parsed,
            state: {
              ...parsed.state,
              deposits: parsed.state.deposits.map(deserializeDeposit),
            },
          };
        },
        setItem: (name, value) => {
          const serialized = {
            ...value,
            state: {
              ...value.state,
              deposits: value.state.deposits.map(serializeDeposit),
            },
          };
          localStorage.setItem(name, JSON.stringify(serialized));
        },
        removeItem: (name) => localStorage.removeItem(name),
      },
    },
  ),
);

// ============================================================================
// Deposit Hook with Security Features
// ============================================================================

import { useState, useCallback } from "react";
import { useCreditsStore, type Credit } from "./useCredits";
import relayerClient from "@/lib/api/relayer";
import { generateCommitment, randomSecret } from "@/lib/crypto/poseidon";
import { base64UrlEncode } from "@/lib/blind";
import { BUCKET_AMOUNTS } from "@/lib/constants";

// Random delay range in milliseconds (1-24 hours as per architecture)
const MIN_DELAY_MS = 1 * 60 * 60 * 1000; // 1 hour
const MAX_DELAY_MS = 24 * 60 * 60 * 1000; // 24 hours

// For testing, use shorter delays
const TEST_MIN_DELAY_MS = 1000; // 1 second
const TEST_MAX_DELAY_MS = 5000; // 5 seconds

interface DepositHookState {
  isDepositing: boolean;
  step:
    | "idle"
    | "verifying-tor"
    | "waiting-delay"
    | "generating-commitment"
    | "submitting";
  error: string | null;
  delayRemaining: number | null;
  torVerified: boolean;
  torExitIp: string | null;
}

export function useDeposit() {
  const [state, setState] = useState<DepositHookState>({
    isDepositing: false,
    step: "idle",
    error: null,
    delayRemaining: null,
    torVerified: false,
    torExitIp: null,
  });

  const { addDeposit } = useDepositStore();
  const { markCreditUsed } = useCreditsStore();

  /**
   * Verify Tor connection before deposit
   */
  const verifyTor = useCallback(async (): Promise<boolean> => {
    setState((s) => ({ ...s, step: "verifying-tor", error: null }));

    try {
      const result = await relayerClient.verifyTorConnection();
      setState((s) => ({
        ...s,
        torVerified: result.isTor,
        torExitIp: result.exitIp,
      }));
      return result.isTor;
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Tor verification failed";
      setState((s) => ({ ...s, error: message, torVerified: false }));
      return false;
    }
  }, []);

  /**
   * Execute deposit with security features:
   * 1. Verify Tor connection (MANDATORY)
   * 2. Apply random delay (timing analysis protection) - can be skipped in dev
   * 3. Generate commitment
   * 4. Submit via Tor with encrypted payload
   *
   * SECURITY: Tor and encryption are ALWAYS required. Only timing delay can be skipped.
   */
  const deposit = useCallback(
    async (
      credit: Credit,
      options: { skipDelay?: boolean; testMode?: boolean } = {},
    ): Promise<Deposit> => {
      setState({
        isDepositing: true,
        step: "idle",
        error: null,
        delayRemaining: null,
        torVerified: false,
        torExitIp: null,
      });

      try {
        // Step 1: Verify Tor connection (ALWAYS REQUIRED - no bypass)
        setState((s) => ({ ...s, step: "verifying-tor" }));
        const torOk = await verifyTor();
        if (!torOk) {
          throw new Error("Tor connection required for deposits");
        }

        // Step 2: Apply random delay (unless skipped for testing)
        if (!options.skipDelay) {
          const minDelay = options.testMode ? TEST_MIN_DELAY_MS : MIN_DELAY_MS;
          const maxDelay = options.testMode ? TEST_MAX_DELAY_MS : MAX_DELAY_MS;
          const delay =
            Math.floor(Math.random() * (maxDelay - minDelay)) + minDelay;

          setState((s) => ({
            ...s,
            step: "waiting-delay",
            delayRemaining: delay,
          }));

          // Update countdown every second
          const startTime = Date.now();
          await new Promise<void>((resolve) => {
            const interval = setInterval(() => {
              const elapsed = Date.now() - startTime;
              const remaining = Math.max(0, delay - elapsed);
              setState((s) => ({ ...s, delayRemaining: remaining }));

              if (remaining <= 0) {
                clearInterval(interval);
                resolve();
              }
            }, 1000);
          });
        }

        // Step 3: Generate commitment
        setState((s) => ({
          ...s,
          step: "generating-commitment",
          delayRemaining: null,
        }));

        const nullifier = randomSecret();
        const secret = randomSecret();
        const amount = BigInt(credit.amount);
        const commitment = await generateCommitment(nullifier, secret, amount);

        // Step 4: Submit deposit via Tor
        setState((s) => ({ ...s, step: "submitting" }));

        // Find bucket ID
        const bucketId = BUCKET_AMOUNTS.findIndex((b) => b === credit.amount);
        if (bucketId === -1) {
          throw new Error("Invalid credit amount");
        }

        const response = await relayerClient.requestDeposit({
          tokenId: base64UrlEncode(credit.tokenId),
          signature: base64UrlEncode(credit.signature),
          commitment: base64UrlEncode(commitment),
          amount: credit.amount,
        });

        // Create deposit record
        const deposit: Deposit = {
          id: crypto.randomUUID(),
          amount: credit.amount,
          secret,
          nullifier,
          commitment,
          leafIndex: response.leafIndex,
          txSignature: response.txSignature,
          createdAt: Date.now(),
          withdrawn: false,
        };

        // Save deposit and mark credit as used
        addDeposit(deposit);
        markCreditUsed(credit.id);

        setState({
          isDepositing: false,
          step: "idle",
          error: null,
          delayRemaining: null,
          torVerified: true,
          torExitIp: state.torExitIp,
        });

        return deposit;
      } catch (error) {
        const message =
          error instanceof Error ? error.message : "Deposit failed";
        setState((s) => ({
          ...s,
          isDepositing: false,
          step: "idle",
          error: message,
        }));
        throw error;
      }
    },
    [addDeposit, markCreditUsed, verifyTor, state.torExitIp],
  );

  return {
    ...state,
    verifyTor,
    deposit,
  };
}
