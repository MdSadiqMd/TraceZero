import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useWallet } from "@solana/wallet-adapter-react";
import { useCreditsStore, type Credit } from "@/hooks/useCredits";
import { useDepositStore, useDeposit } from "@/hooks/useDeposit";

export const Route = createFileRoute("/deposit")({
  component: DepositPage,
});

function DepositPage() {
  const { connected } = useWallet();
  const { credits } = useCreditsStore();
  const { deposits } = useDepositStore();
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
  const [depositSuccess, setDepositSuccess] = useState(false);
  const [lastTxSignature, setLastTxSignature] = useState<string | null>(null);
  const [devMode, setDevMode] = useState(false); // Skip delay for testing

  const availableCredits = credits.filter((c) => !c.used);

  // Check Tor on mount
  useEffect(() => {
    verifyTor().catch(() => {});
  }, [verifyTor]);

  const handleDeposit = async () => {
    if (!selectedCredit) return;

    setDepositSuccess(false);
    setLastTxSignature(null);

    try {
      const result = await deposit(selectedCredit, {
        skipDelay: devMode,
        testMode: devMode,
      });
      setDepositSuccess(true);
      setLastTxSignature(result.txSignature);
      setSelectedCredit(null);
    } catch (err) {
      console.error("Failed to deposit:", err);
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
    <div className="max-w-2xl mx-auto">
      <h1 className="text-3xl font-bold mb-2">Deposit via Tor</h1>
      <p className="text-gray-400 mb-8">
        Redeem your credit to deposit into the privacy pool. All requests go
        through Tor - your wallet never appears in the deposit transaction.
      </p>

      {/* Tor Status */}
      <div className="card mb-6">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold">Tor Connection</h2>
            <p className="text-sm text-gray-500">
              Required for anonymous deposits
            </p>
          </div>
          <div
            className={`px-3 py-1 rounded-full text-sm ${
              torVerified
                ? "bg-green-500/20 text-green-400"
                : "bg-yellow-500/20 text-yellow-400"
            }`}
          >
            {torVerified ? "● Connected" : "● Checking..."}
          </div>
        </div>
        {torExitIp && (
          <p className="text-sm text-gray-500 mt-2">Exit IP: {torExitIp}</p>
        )}
        {!torVerified && (
          <div className="mt-2">
            <p className="text-sm text-yellow-400 mb-2">
              Start Tor: docker compose -f crates/network/docker-compose.yml up
              -d
            </p>
            <button
              onClick={() => verifyTor()}
              className="text-sm text-primary-400 hover:text-primary-300"
            >
              Retry connection →
            </button>
          </div>
        )}
      </div>

      {/* Dev Mode Toggle */}
      <div className="card mb-6 border-yellow-500/30">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="font-semibold text-yellow-400">🧪 Dev Mode</h2>
            <p className="text-sm text-gray-500">
              Skip timing delay for faster local testing
            </p>
          </div>
          <button
            onClick={() => setDevMode(!devMode)}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              devMode
                ? "bg-yellow-500 text-black"
                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            }`}
          >
            {devMode ? "ON" : "OFF"}
          </button>
        </div>
        {devMode && (
          <p className="text-xs text-yellow-400 mt-2">
            ⚠️ Timing delay skipped. Tor verification still required.
          </p>
        )}
      </div>

      {!connected ? (
        <div className="card text-center py-12">
          <p className="text-gray-400 mb-4">Connect your wallet to deposit</p>
        </div>
      ) : availableCredits.length === 0 ? (
        <div className="card text-center py-12">
          <p className="text-gray-400 mb-4">No available credits</p>
          <a href="/credits" className="btn-primary">
            Purchase Credits
          </a>
        </div>
      ) : (
        <>
          {/* Credit Selection */}
          <div className="card mb-6">
            <h2 className="text-xl font-semibold mb-4">Select Credit</h2>
            <div className="space-y-3">
              {availableCredits.map((credit) => (
                <button
                  key={credit.id}
                  onClick={() => setSelectedCredit(credit)}
                  className={`w-full p-4 rounded-lg border-2 text-left transition-colors ${
                    selectedCredit?.id === credit.id
                      ? "border-primary-500 bg-primary-500/10"
                      : "border-gray-700 hover:border-gray-600"
                  }`}
                >
                  <div className="flex justify-between items-center">
                    <div>
                      <div className="font-semibold">
                        {credit.amount / 1e9} SOL
                      </div>
                      <div className="text-sm text-gray-500">
                        Purchased{" "}
                        {new Date(credit.createdAt).toLocaleDateString()}
                      </div>
                    </div>
                    <div className="text-primary-400">
                      {selectedCredit?.id === credit.id
                        ? "✓ Selected"
                        : "Select"}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </div>

          {/* Deposit Action */}
          {selectedCredit && (
            <div className="card mb-6">
              <h2 className="text-xl font-semibold mb-4">Deposit Summary</h2>
              <div className="space-y-2 text-sm mb-4">
                <div className="flex justify-between">
                  <span className="text-gray-400">Amount</span>
                  <span>{selectedCredit.amount / 1e9} SOL</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Network</span>
                  <span className="text-green-400">Via Tor</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-gray-400">Your Wallet in TX</span>
                  <span className="text-green-400">Never</span>
                </div>
              </div>
              <div className="bg-yellow-500/10 border border-yellow-500/30 rounded-lg p-3 mb-4">
                <p className="text-sm text-yellow-400">
                  ⚠️ Save your deposit note after this transaction. You'll need
                  it to withdraw.
                </p>
              </div>

              {/* Progress indicator */}
              {isDepositing && (
                <div className="mb-4 p-3 bg-primary-500/10 border border-primary-500/30 rounded-lg">
                  <div className="flex items-center gap-2">
                    <svg
                      className="animate-spin h-5 w-5 text-primary-400"
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
                    <span className="text-sm text-primary-400">
                      {getStepLabel()}
                    </span>
                  </div>
                </div>
              )}

              {error && (
                <div className="mb-4 p-3 bg-red-500/10 border border-red-500/50 rounded-lg text-red-400 text-sm">
                  {error}
                </div>
              )}

              {depositSuccess && (
                <div className="mb-4 p-3 bg-green-500/10 border border-green-500/50 rounded-lg text-green-400 text-sm">
                  <div>
                    Deposit successful! Your wallet was NOT in the transaction.
                  </div>
                  {lastTxSignature && (
                    <a
                      href={`https://explorer.solana.com/tx/${lastTxSignature}?cluster=devnet`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-green-300 hover:underline text-xs"
                    >
                      View transaction →
                    </a>
                  )}
                </div>
              )}

              <button
                onClick={handleDeposit}
                disabled={isDepositing || !torVerified}
                className="btn-primary w-full"
              >
                {isDepositing ? "Depositing via Tor..." : "Deposit Now"}
              </button>
              {!torVerified && (
                <p className="text-xs text-yellow-400 mt-2 text-center">
                  Tor connection required. Start Tor gateway first.
                </p>
              )}
            </div>
          )}

          {/* Existing Deposits */}
          <div className="card">
            <h2 className="text-xl font-semibold mb-4">Your Deposits</h2>
            {deposits.length === 0 ? (
              <p className="text-gray-500 text-center py-4">No deposits yet.</p>
            ) : (
              <div className="space-y-3">
                {deposits.map((deposit) => (
                  <div
                    key={deposit.id}
                    className={`p-4 rounded-lg border ${
                      deposit.withdrawn
                        ? "border-gray-700 opacity-50"
                        : "border-green-500/50 bg-green-500/5"
                    }`}
                  >
                    <div className="flex justify-between items-center">
                      <div>
                        <div className="font-semibold">
                          {deposit.amount / 1e9} SOL
                        </div>
                        <div className="text-sm text-gray-500">
                          Leaf #{deposit.leafIndex} •{" "}
                          {new Date(deposit.createdAt).toLocaleDateString()}
                        </div>
                      </div>
                      <div
                        className={`px-3 py-1 rounded-full text-sm ${
                          deposit.withdrawn
                            ? "bg-gray-700 text-gray-400"
                            : "bg-green-500/20 text-green-400"
                        }`}
                      >
                        {deposit.withdrawn ? "Withdrawn" : "Available"}
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
