import { useState } from "react";
import { useDeposit } from "@/hooks/useDeposit";
import { useCreditsStore, type Credit } from "@/hooks/useCredits";

export function DepositForm() {
  const { credits } = useCreditsStore();
  const {
    deposit,
    verifyTor,
    isDepositing,
    step,
    delayRemaining,
    torVerified,
    torExitIp,
    error,
  } = useDeposit();

  const [selectedCredit, setSelectedCredit] = useState<Credit | null>(null);
  const [success, setSuccess] = useState(false);
  const [txSignature, setTxSignature] = useState<string | null>(null);

  const availableCredits = credits.filter((c) => !c.used);

  const handleDeposit = async () => {
    if (!selectedCredit) return;

    setSuccess(false);
    setTxSignature(null);

    try {
      const result = await deposit(selectedCredit, { skipDelay: false });
      setSuccess(true);
      setTxSignature(result.txSignature);
      setSelectedCredit(null);
    } catch (err) {
      console.error("Deposit failed:", err);
    }
  };

  const formatDelay = (ms: number) => {
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);

    if (hours > 0) return `${hours}h ${minutes}m ${seconds}s`;
    if (minutes > 0) return `${minutes}m ${seconds}s`;
    return `${seconds}s`;
  };

  const getStepLabel = () => {
    switch (step) {
      case "verifying-tor":
        return "Verifying Tor connection...";
      case "waiting-delay":
        return `Waiting (timing protection): ${formatDelay(delayRemaining || 0)}`;
      case "generating-commitment":
        return "Generating commitment...";
      case "submitting":
        return "Submitting deposit via Tor...";
      default:
        return "";
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6 max-w-md">
      <h2 className="text-xl font-semibold mb-4">Anonymous Deposit</h2>

      <p className="text-gray-600 text-sm mb-4">
        Redeem your credit for an anonymous deposit. Your wallet will NOT appear
        in the deposit transaction - only the relayer's wallet is visible.
      </p>

      {/* Tor Status */}
      <div className="mb-4 p-3 bg-gray-50 rounded-lg">
        <div className="flex items-center gap-2">
          <div
            className={`w-3 h-3 rounded-full ${torVerified ? "bg-green-500" : "bg-yellow-500"}`}
          />
          <span className="text-sm font-medium">
            {torVerified ? "Connected via Tor" : "Tor not verified"}
          </span>
        </div>
        {torExitIp && (
          <div className="text-xs text-gray-500 mt-1">Exit IP: {torExitIp}</div>
        )}
        {!torVerified && (
          <button
            onClick={verifyTor}
            className="mt-2 text-sm text-blue-600 hover:text-blue-800"
          >
            Verify Tor Connection
          </button>
        )}
      </div>

      {/* Credit Selection */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Select Credit ({availableCredits.length} available)
        </label>

        {availableCredits.length === 0 ? (
          <div className="p-4 bg-gray-50 rounded-lg text-center text-gray-500">
            No credits available. Purchase credits first.
          </div>
        ) : (
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {availableCredits.map((credit) => (
              <button
                key={credit.id}
                onClick={() => setSelectedCredit(credit)}
                className={`w-full p-3 rounded-lg border-2 text-left transition-colors ${
                  selectedCredit?.id === credit.id
                    ? "border-blue-500 bg-blue-50"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <div className="font-semibold">{credit.amount / 1e9} SOL</div>
                <div className="text-xs text-gray-500">
                  Purchased: {new Date(credit.createdAt).toLocaleDateString()}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Progress */}
      {isDepositing && (
        <div className="mb-4 p-3 bg-blue-50 rounded-lg">
          <div className="flex items-center gap-2">
            <svg
              className="animate-spin h-5 w-5 text-blue-600"
              viewBox="0 0 24 24"
            >
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
            <span className="text-sm text-blue-700">{getStepLabel()}</span>
          </div>
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 p-3 bg-green-50 text-green-700 rounded-lg text-sm">
          <div>Deposit successful!</div>
          {txSignature && (
            <a
              href={`https://explorer.solana.com/tx/${txSignature}?cluster=devnet`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-green-600 hover:underline text-xs"
            >
              View transaction →
            </a>
          )}
        </div>
      )}

      <button
        onClick={handleDeposit}
        disabled={!selectedCredit || isDepositing}
        className={`w-full py-3 px-4 rounded-lg font-semibold transition-colors ${
          selectedCredit && !isDepositing
            ? "bg-green-600 text-white hover:bg-green-700"
            : "bg-gray-300 text-gray-500 cursor-not-allowed"
        }`}
      >
        {isDepositing ? "Depositing..." : "Deposit via Tor"}
      </button>

      <p className="mt-4 text-xs text-gray-500">
        🔒 Your deposit is routed through Tor with a random delay to prevent
        timing analysis. Your wallet never appears in the pool transaction.
      </p>
    </div>
  );
}
