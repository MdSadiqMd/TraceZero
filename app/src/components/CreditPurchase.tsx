import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useBlindSignature } from "@/hooks/useBlindSignature";
import { useCreditsStore, type Credit } from "@/hooks/useCredits";
import { BUCKET_AMOUNTS, RELAYER_FEE_PERCENT } from "@/lib/constants";

const BUCKET_OPTIONS = BUCKET_AMOUNTS.map((amount, idx) => ({
  id: idx,
  amount,
  label: `${amount / 1e9} SOL`,
  fee: (amount * RELAYER_FEE_PERCENT) / 100,
  totalWithFee: amount * (1 + RELAYER_FEE_PERCENT / 100),
}));

export function CreditPurchase() {
  const { connected } = useWallet();
  const {
    createSignedToken,
    isPaying,
    isBlinding,
    isSigning,
    isUnblinding,
    error,
  } = useBlindSignature();
  const { addCredit } = useCreditsStore();

  const [selectedBucket, setSelectedBucket] = useState(0);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [success, setSuccess] = useState(false);

  const handlePurchase = async () => {
    if (!connected) return;

    setIsPurchasing(true);
    setSuccess(false);

    try {
      const bucket = BUCKET_OPTIONS[selectedBucket];
      const { tokenId, signature } = await createSignedToken(bucket.amount);

      const credit: Credit = {
        id: crypto.randomUUID(),
        amount: bucket.amount,
        tokenId,
        signature,
        createdAt: Date.now(),
        used: false,
      };

      addCredit(credit);
      setSuccess(true);
    } catch (err) {
      console.error("Purchase failed:", err);
    } finally {
      setIsPurchasing(false);
    }
  };

  const isLoading =
    isPurchasing || isPaying || isBlinding || isSigning || isUnblinding;

  const getStatusText = () => {
    if (isPaying) return "Sending payment...";
    if (isBlinding) return "Blinding token...";
    if (isSigning) return "Getting signature...";
    if (isUnblinding) return "Unblinding...";
    return "Processing...";
  };

  return (
    <div className="card">
      <h2 className="text-xl font-semibold mb-4">Purchase Credits</h2>

      <p className="text-gray-400 text-sm mb-4">
        Purchase blinded credits that can be redeemed for anonymous deposits.
        The relayer cannot link your payment to your future deposit.
      </p>

      {/* How it works */}
      <div className="bg-gray-800/50 rounded-lg p-3 mb-4 text-xs text-gray-400">
        <p className="font-medium text-gray-300 mb-1">How it works:</p>
        <ol className="list-decimal list-inside space-y-0.5">
          <li>You pay SOL to the relayer (visible on-chain)</li>
          <li>Relayer signs a blinded token (can't see the token)</li>
          <li>Later, you deposit via Tor using the token</li>
          <li>Relayer can't link payment → deposit</li>
        </ol>
      </div>

      <div className="mb-4">
        <label className="block text-sm font-medium mb-2">Select Amount</label>
        <div className="grid grid-cols-2 gap-2">
          {BUCKET_OPTIONS.map((bucket, idx) => (
            <button
              key={bucket.id}
              onClick={() => setSelectedBucket(idx)}
              disabled={isLoading}
              className={`p-3 rounded-lg border-2 transition-colors ${
                selectedBucket === idx
                  ? "border-primary-500 bg-primary-500/10"
                  : "border-gray-700 hover:border-gray-600"
              } ${isLoading ? "opacity-50 cursor-not-allowed" : ""}`}
            >
              <div className="font-semibold">{bucket.label}</div>
              <div className="text-xs text-gray-500">
                +{RELAYER_FEE_PERCENT}% fee
              </div>
            </button>
          ))}
        </div>
      </div>

      <div className="mb-4 p-3 bg-gray-800/50 rounded-lg">
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Deposit amount:</span>
          <span>{BUCKET_OPTIONS[selectedBucket].label}</span>
        </div>
        <div className="flex justify-between text-sm">
          <span className="text-gray-400">Fee ({RELAYER_FEE_PERCENT}%):</span>
          <span>
            {(BUCKET_OPTIONS[selectedBucket].fee / 1e9).toFixed(4)} SOL
          </span>
        </div>
        <div className="flex justify-between font-semibold mt-2 pt-2 border-t border-gray-700">
          <span>You pay now:</span>
          <span>
            {(BUCKET_OPTIONS[selectedBucket].totalWithFee / 1e9).toFixed(4)} SOL
          </span>
        </div>
      </div>

      {error && (
        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/30 rounded-lg text-sm text-red-400">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 p-3 bg-green-500/10 border border-green-500/30 rounded-lg text-sm text-green-400">
          ✓ Credit purchased! You can now make an anonymous deposit.
        </div>
      )}

      <button
        onClick={handlePurchase}
        disabled={!connected || isLoading}
        className={`w-full py-3 px-4 rounded-lg font-semibold transition-colors ${
          connected && !isLoading
            ? "bg-primary-600 text-white hover:bg-primary-700"
            : "bg-gray-700 text-gray-500 cursor-not-allowed"
        }`}
      >
        {isLoading ? (
          <span className="flex items-center justify-center gap-2">
            <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
              <circle
                className="opacity-25"
                cx="12"
                cy="12"
                r="10"
                stroke="currentColor"
                strokeWidth="4"
                fill="none"
              />
              <path
                className="opacity-75"
                fill="currentColor"
                d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
              />
            </svg>
            {getStatusText()}
          </span>
        ) : connected ? (
          `Pay ${(BUCKET_OPTIONS[selectedBucket].totalWithFee / 1e9).toFixed(4)} SOL`
        ) : (
          "Connect Wallet"
        )}
      </button>

      <p className="mt-4 text-xs text-gray-500">
        🔒 Your payment is visible on-chain, but the blinded token makes it
        mathematically impossible to link to your future deposit.
      </p>
    </div>
  );
}
