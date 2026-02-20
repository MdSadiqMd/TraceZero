import { useState } from "react";
import { useWithdraw } from "@/hooks/useWithdraw";
import { useDepositStore, type Deposit } from "@/hooks/useDeposit";

export function WithdrawForm() {
  const { deposits } = useDepositStore();
  const {
    withdraw,
    verifyTor,
    isWithdrawing,
    step,
    torVerified,
    torExitIp,
    isGenerating,
    proofProgress,
    error,
  } = useWithdraw();

  const [selectedDeposit, setSelectedDeposit] = useState<Deposit | null>(null);
  const [delayHours, setDelayHours] = useState(6);
  const [success, setSuccess] = useState(false);
  const [txSignature, setTxSignature] = useState<string | null>(null);
  const [stealthAddress, setStealthAddress] = useState<string | null>(null);

  const availableDeposits = deposits.filter((d) => !d.withdrawn);

  const handleWithdraw = async () => {
    if (!selectedDeposit) return;

    setSuccess(false);
    setTxSignature(null);
    setStealthAddress(null);

    try {
      const result = await withdraw(selectedDeposit, {
        delayHours,
        // fee is now computed automatically from relayer's feeBps
      });

      setSuccess(true);
      setTxSignature(result.txSignature);
      setStealthAddress(result.stealthAddress.toBase58());
      setSelectedDeposit(null);
    } catch (err) {
      console.error("Withdrawal failed:", err);
    }
  };

  const getStepLabel = () => {
    switch (step) {
      case "verifying-tor":
        return "Verifying Tor connection...";
      case "generating-stealth":
        return "Generating stealth address...";
      case "fetching-proof":
        return "Fetching merkle proof...";
      case "verifying-proof":
        return "Verifying merkle proof...";
      case "generating-zk-proof":
        return `Generating ZK proof... ${proofProgress}%`;
      case "submitting":
        return "Submitting withdrawal request...";
      default:
        return "";
    }
  };

  return (
    <div className="bg-white rounded-lg shadow-md p-6 max-w-md">
      <h2 className="text-xl font-semibold mb-4">Anonymous Withdrawal</h2>

      <p className="text-gray-600 text-sm mb-4">
        Withdraw to a stealth address using a ZK proof. Nobody can link this
        withdrawal to your original deposit.
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

      {/* Deposit Selection */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Select Deposit ({availableDeposits.length} available)
        </label>

        {availableDeposits.length === 0 ? (
          <div className="p-4 bg-gray-50 rounded-lg text-center text-gray-500">
            No deposits available. Make a deposit first.
          </div>
        ) : (
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {availableDeposits.map((deposit) => (
              <button
                key={deposit.id}
                onClick={() => setSelectedDeposit(deposit)}
                className={`w-full p-3 rounded-lg border-2 text-left transition-colors ${
                  selectedDeposit?.id === deposit.id
                    ? "border-purple-500 bg-purple-50"
                    : "border-gray-200 hover:border-gray-300"
                }`}
              >
                <div className="font-semibold">{deposit.amount / 1e9} SOL</div>
                <div className="text-xs text-gray-500">
                  Deposited: {new Date(deposit.createdAt).toLocaleDateString()}
                </div>
                <div className="text-xs text-gray-400 font-mono">
                  Leaf #{deposit.leafIndex}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Delay Selection */}
      <div className="mb-4">
        <label className="block text-sm font-medium text-gray-700 mb-2">
          Withdrawal Delay (hours)
        </label>
        <input
          type="range"
          min="1"
          max="24"
          value={delayHours}
          onChange={(e) => setDelayHours(parseInt(e.target.value))}
          className="w-full"
        />
        <div className="flex justify-between text-xs text-gray-500">
          <span>1h (less private)</span>
          <span className="font-semibold">{delayHours}h</span>
          <span>24h (more private)</span>
        </div>
      </div>

      {/* Progress */}
      {isWithdrawing && (
        <div className="mb-4 p-3 bg-purple-50 rounded-lg">
          <div className="flex items-center gap-2">
            <svg
              className="animate-spin h-5 w-5 text-purple-600"
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
            <span className="text-sm text-purple-700">{getStepLabel()}</span>
          </div>
          {isGenerating && (
            <div className="mt-2 bg-purple-200 rounded-full h-2">
              <div
                className="bg-purple-600 h-2 rounded-full transition-all"
                style={{ width: `${proofProgress}%` }}
              />
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="mb-4 p-3 bg-red-50 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      )}

      {success && (
        <div className="mb-4 p-3 bg-green-50 text-green-700 rounded-lg text-sm">
          <div>Withdrawal request submitted!</div>
          <div className="text-xs mt-1">
            Funds will arrive at stealth address after {delayHours}h delay.
          </div>
          {stealthAddress && (
            <div className="text-xs font-mono mt-1 break-all">
              Stealth: {stealthAddress}
            </div>
          )}
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
        onClick={handleWithdraw}
        disabled={!selectedDeposit || isWithdrawing}
        className={`w-full py-3 px-4 rounded-lg font-semibold transition-colors ${
          selectedDeposit && !isWithdrawing
            ? "bg-purple-600 text-white hover:bg-purple-700"
            : "bg-gray-300 text-gray-500 cursor-not-allowed"
        }`}
      >
        {isWithdrawing ? "Processing..." : "Withdraw to Stealth Address"}
      </button>

      <p className="mt-4 text-xs text-gray-500">
        🔒 A ZK proof proves you own a deposit without revealing which one.
        Funds go to a one-time stealth address only you can spend from.
      </p>
    </div>
  );
}
