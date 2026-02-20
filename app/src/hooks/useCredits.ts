import { create } from "zustand";
import { persist } from "zustand/middleware";

export interface Credit {
  id: string;
  amount: number;
  tokenId: Uint8Array;
  signature: Uint8Array;
  createdAt: number;
  used: boolean;
}

interface CreditsState {
  credits: Credit[];
  addCredit: (credit: Credit) => void;
  markCreditUsed: (id: string) => void;
  removeCredit: (id: string) => void;
  clearCredits: () => void;
}

// Custom serializer for Uint8Array
const serializeCredit = (credit: Credit) => ({
  ...credit,
  tokenId: Array.from(credit.tokenId),
  signature: Array.from(credit.signature),
});

const deserializeCredit = (
  credit: ReturnType<typeof serializeCredit>,
): Credit => ({
  ...credit,
  tokenId: new Uint8Array(credit.tokenId),
  signature: new Uint8Array(credit.signature),
});

export const useCreditsStore = create<CreditsState>()(
  persist(
    (set) => ({
      credits: [],
      addCredit: (credit) =>
        set((state) => ({ credits: [...state.credits, credit] })),
      markCreditUsed: (id) =>
        set((state) => ({
          credits: state.credits.map((c) =>
            c.id === id ? { ...c, used: true } : c,
          ),
        })),
      removeCredit: (id) =>
        set((state) => ({
          credits: state.credits.filter((c) => c.id !== id),
        })),
      clearCredits: () => set({ credits: [] }),
    }),
    {
      name: "privacy-proxy-credits",
      storage: {
        getItem: (name) => {
          const str = localStorage.getItem(name);
          if (!str) return null;
          const parsed = JSON.parse(str);
          return {
            ...parsed,
            state: {
              ...parsed.state,
              credits: parsed.state.credits.map(deserializeCredit),
            },
          };
        },
        setItem: (name, value) => {
          const serialized = {
            ...value,
            state: {
              ...value.state,
              credits: value.state.credits.map(serializeCredit),
            },
          };
          localStorage.setItem(name, JSON.stringify(serialized));
        },
        removeItem: (name) => localStorage.removeItem(name),
      },
    },
  ),
);
