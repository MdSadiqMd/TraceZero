import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useCreditsStore, type Credit } from "@/hooks/useCredits";
import { useBlindSignature } from "@/hooks/useBlindSignature";
import { BUCKET_AMOUNTS, RELAYER_FEE_PERCENT } from "@/lib/constants";

export const Route = createFileRoute("/credits")({
  component: CreditsPage,
});

function CreditsPage() {
  const { connected, publicKey } = useWallet();
  const [selectedBucket, setSelectedBucket] = useState<number | null>(null);
  const [isPurchasing, setIsPurchasing] = useState(false);
  const [purchaseError, setPurchaseError] = useState<string | null>(null);
  const [purchaseSuccess, setPurchaseSuccess] = useState(false);
  const { credits, addCredit } = useCreditsStore();
  const {
    createSignedToken,
    isBlinding,
    isSigning,
    isUnblinding,
    error: blindError,
  } = useBlindSignature();

  const handlePurchase = async () => {
    if (!connected || !publicKey || selectedBucket === null) return;

    setIsPurchasing(true);
    setPurchaseError(null);
    setPurchaseSuccess(false);

    try {
      const amount = BUCKET_AMOUNTS[selectedBucket];

      // Create signed token using blind signature protocol
      const { tokenId, signature } = await createSignedToken(amount);

      // Store credit locally
      const credit: Credit = {
        id: crypto.randomUUID(),
        amount,
        tokenId,
        signature,
        createdAt: Date.now(),
        used: false,
      };
      addCredit(credit);
      setPurchaseSuccess(true);
      setSelectedBucket(null);
    } catch (error) {
      console.error("Failed to purchase credit:", error);
      setPurchaseError(
        error instanceof Error ? error.message : "Failed to purchase credit",
      );
    } finally {
      setIsPurchasing(false);
    }
  };

  const isLoading = isPurchasing || isBlinding || isSigning || isUnblinding;
  const displayError = purchaseError || blindError;

  return (
    <div className="max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">Purchase Credits</h1>
      <p className="text-gray-400 mb-8">
        Buy blinded credits to deposit into the privacy pool. The relayer cannot
        link your payment to your deposit.
      </p>

      {!connected ? (
        <div className="card text-center py-12">
          <p className="text-gray-400 mb-4">
            Connect your wallet to purchase credits
          </p>
        </div>
      ) : (
        <>
          {/* Bucket Selection */}
          <div className="card mb-6">
            <h2 className="text-xl font-semibold mb-4">Select Amount</h2>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
              {BUCKET_AMOUNTS.map((amount, index) => (
                <button
                  key={index}
                  onClick={() => setSelectedBucket(index)}
                  className={`p-4 rounded-lg border-2 transition-colors ${
                    selectedBucket === index
                      ? "border-primary-500 bg-primary-500/10"
                      : "border-gray-700 hover:border-gray-600"
                  }`}
                >
                  <div className="text-lg font-semibold">
                    {amount / 1e9} SOL
                  </div>
                  <div className="text-sm text-gray-500">
                    +{RELAYER_FEE_PERCENT}% fee
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Purchase Summary */}
          {selectedBucket !== null && (
            <div className="card mb-6">
              <h2 className="text-xl font-semibold mb-4">Summary</h2>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-gray-400">Amount</span>
                  <span>{BUCKET_AMOUNTS[selectedBucket] / 1e9} SOL</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">
                    Fee ({RELAYER_FEE_PERCENT}%)
                  </span>
                  <span>
                    {(BUCKET_AMOUNTS[selectedBucket] * RELAYER_FEE_PERCENT) /
                      100 /
                      1e9}{" "}
                    SOL
                  </span>
                </div>
                <div className="border-t border-gray-700 pt-2 flex justify-between font-semibold">
                  <span>Total</span>
                  <span>
                    {(BUCKET_AMOUNTS[selectedBucket] *
                      (1 + RELAYER_FEE_PERCENT / 100)) /
                      1e9}{" "}
                    SOL
                  </span>
                </div>
              </div>

              {displayError && (
                <div className="mt-4 p-3 bg-red-500/10 border border-red-500/50 rounded-lg text-red-400 text-sm">
                  {displayError}
                </div>
              )}

              {purchaseSuccess && (
                <div className="mt-4 p-3 bg-green-500/10 border border-green-500/50 rounded-lg text-green-400 text-sm">
                  Credit purchased successfully! You can now make an anonymous
                  deposit.
                </div>
              )}

              <button
                onClick={handlePurchase}
                disabled={isLoading}
                className="btn-primary w-full mt-4"
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
                    {isBlinding
                      ? "Blinding token..."
                      : isSigning
                        ? "Getting signature..."
                        : isUnblinding
                          ? "Unblinding..."
                          : "Processing..."}
                  </span>
                ) : (
                  "Purchase Credit"
                )}
              </button>

              <p className="mt-3 text-xs text-gray-500 text-center">
                🔒 Your payment is visible, but the blinded token makes it
                mathematically impossible to link to your future deposit.
              </p>
            </div>
          )}

          {/* Existing Credits */}
          <div className="card">
            <h2 className="text-xl font-semibold mb-4">Your Credits</h2>
            {credits.length === 0 ? (
              <p className="text-gray-500 text-center py-4">
                No credits yet. Purchase one above.
              </p>
            ) : (
              <div className="space-y-3">
                {credits.map((credit) => (
                  <div
                    key={credit.id}
                    className={`p-4 rounded-lg border ${
                      credit.used
                        ? "border-gray-700 opacity-50"
                        : "border-primary-500/50 bg-primary-500/5"
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <div>
                        <div className="font-semibold">
                          {credit.amount / 1e9} SOL
                        </div>
                        <div className="text-sm text-gray-500">
                          {new Date(credit.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                      <div
                        className={`px-3 py-1 rounded-full text-sm ${
                          credit.used
                            ? "bg-gray-700 text-gray-400"
                            : "bg-green-500/20 text-green-400"
                        }`}
                      >
                        {credit.used ? "Used" : "Available"}
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );
}
