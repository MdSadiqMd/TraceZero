import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useWallet, useConnection } from "@solana/wallet-adapter-react";
import { PublicKey, clusterApiUrl } from "@solana/web3.js";
import { useCreditsStore, type Credit } from "@/hooks/useCredits";
import { useBlindSignature } from "@/hooks/useBlindSignature";
import { useDeposit } from "@/hooks/useDeposit";
import { useWithdraw } from "@/hooks/useWithdraw";
import { useClaim } from "@/hooks/useClaim";
import { BUCKET_AMOUNTS, RELAYER_FEE_PERCENT } from "@/lib/constants";

export const Route = createFileRoute("/app")({
  component: OneStepApp,
});

type FlowStep =
  | "idle"
  | "purchasing-credit"
  | "depositing"
  | "withdrawing"
  | "claiming"
  | "complete";

function OneStepApp() {
  const { connected, publicKey } = useWallet();
  const { connection } = useConnection();
  const { addCredit } = useCreditsStore();
  const { claim } = useClaim();

  // Form state
  const [selectedBucket, setSelectedBucket] = useState<number | null>(null);
  const [recipientAddress, setRecipientAddress] = useState("");
  const [devMode, setDevMode] = useState(false);

  // Flow state
  const [flowStep, setFlowStep] = useState<FlowStep>("idle");
  const [error, setError] = useState<string | null>(null);
  const [finalTxSignature, setFinalTxSignature] = useState<string | null>(null);
  const [stealthAddr, setStealthAddr] = useState<string | null>(null);

  // Tor verification state
  const [showTorWarning, setShowTorWarning] = useState(false);
  const [torCheckStarted, setTorCheckStarted] = useState(false);

  // Network check state
  const [isDevnet, setIsDevnet] = useState(true);
  const [showNetworkWarning, setShowNetworkWarning] = useState(false);

  // Balance state
  const [balance, setBalance] = useState<number | null>(null);

  // Hooks
  const {
    createSignedToken,
    isBlinding,
    isSigning,
    isUnblinding,
  } = useBlindSignature();

  const {
    deposit,
    step: depositStep,
    delayRemaining,
    torVerified,
    verifyTor,
  } = useDeposit();

  const {
    withdraw,
    step: withdrawStep,
    proofProgress,
  } = useWithdraw();

  // Verify Tor on mount with 5 second delay
  useEffect(() => {
    if (!torCheckStarted) {
      setTorCheckStarted(true);

      // Start Tor verification immediately
      verifyTor().catch(() => { });

      // Show warning after 5 seconds if Tor is not verified
      const timer = setTimeout(() => {
        setShowTorWarning(true);
      }, 5000);

      return () => clearTimeout(timer);
    }
  }, [verifyTor, torCheckStarted]);

  // Hide Tor warning once verified
  useEffect(() => {
    if (torVerified) {
      setShowTorWarning(false);
    }
  }, [torVerified]);

  // Check network on wallet connection
  useEffect(() => {
    if (connected && connection) {
      const checkNetwork = async () => {
        try {
          // Check if connected to devnet
          const devnetUrl = clusterApiUrl('devnet');
          const isOnDevnet = connection.rpcEndpoint.includes('devnet') ||
            connection.rpcEndpoint === devnetUrl;

          setIsDevnet(isOnDevnet);
          setShowNetworkWarning(!isOnDevnet);
        } catch (err) {
          console.error("Failed to check network:", err);
        }
      };

      checkNetwork();
    }
  }, [connected, connection]);

  // Auto-fill recipient with connected wallet - REMOVED
  // User must explicitly enter recipient address
  // useEffect(() => {
  //   if (publicKey && !recipientAddress) {
  //     setRecipientAddress(publicKey.toBase58());
  //   }
  // }, [publicKey, recipientAddress]);

  // Fetch balance when wallet connects
  useEffect(() => {
    if (connected && publicKey && connection) {
      const fetchBalance = async () => {
        try {
          const bal = await connection.getBalance(publicKey);
          setBalance(bal);
        } catch (err) {
          console.error("Failed to fetch balance:", err);
        }
      };

      fetchBalance();

      // Refresh balance every 10 seconds
      const interval = setInterval(fetchBalance, 10000);
      return () => clearInterval(interval);
    } else {
      setBalance(null);
    }
  }, [connected, publicKey, connection]);

  const getProgressPercentage = (): number => {
    if (flowStep === "purchasing-credit") return 20;
    if (flowStep === "depositing") return 40;
    if (flowStep === "withdrawing") return 60 + (proofProgress / 100) * 20;
    if (flowStep === "claiming") return 90;
    if (flowStep === "complete") return 100;
    return 0;
  };

  const getCurrentStepMessage = (): string => {
    if (flowStep === "purchasing-credit") {
      if (isBlinding) return "BLINDING_TOKEN...";
      if (isSigning) return "REQUESTING_SIGNATURE...";
      if (isUnblinding) return "UNBLINDING_SIGNATURE...";
      return "PROCESSING_PAYMENT...";
    }

    if (flowStep === "depositing") {
      switch (depositStep) {
        case "verifying-tor":
          return "VERIFYING_TOR_CONNECTION...";
        case "waiting-delay":
          return `TIMING_PROTECTION: ${formatDelay(delayRemaining || 0)}`;
        case "generating-commitment":
          return "GENERATING_COMMITMENT...";
        case "submitting":
          return "SUBMITTING_VIA_TOR...";
        default:
          return "PREPARING_DEPOSIT...";
      }
    }

    if (flowStep === "withdrawing") {
      switch (withdrawStep) {
        case "generating-stealth":
          return "GENERATING_STEALTH_ADDRESS...";
        case "fetching-proof":
          return "FETCHING_MERKLE_PROOF...";
        case "verifying-proof":
          return "VERIFYING_PROOF...";
        case "generating-zk-proof":
          return `GENERATING_ZK_PROOF: ${proofProgress}%`;
        case "submitting":
          return "SUBMITTING_WITHDRAWAL...";
        default:
          return "PREPARING_WITHDRAWAL...";
      }
    }

    if (flowStep === "claiming") {
      return "CLAIMING_TO_RECIPIENT...";
    }

    return "READY";
  };

  const formatDelay = (ms: number) => {
    const hours = Math.floor(ms / 3600000);
    const minutes = Math.floor((ms % 3600000) / 60000);
    const seconds = Math.floor((ms % 60000) / 1000);
    return `${hours}h ${minutes}m ${seconds}s`;
  };

  const handleExecuteFlow = async () => {
    if (!connected || !publicKey || selectedBucket === null || !recipientAddress) {
      setError("MISSING_REQUIRED_FIELDS: Please select amount and enter recipient address");
      return;
    }

    // Validate recipient address
    try {
      const recipientPubkey = new PublicKey(recipientAddress);
      
      // Additional validation: Check if it's a valid base58 string
      if (recipientPubkey.toBase58() !== recipientAddress) {
        throw new Error("Invalid address format");
      }
      
      // Check if recipient is the system program (invalid)
      if (recipientPubkey.equals(new PublicKey("11111111111111111111111111111111"))) {
        setError("INVALID_RECIPIENT: Cannot send to system program address");
        return;
      }
      
    } catch {
      setError("INVALID_RECIPIENT_ADDRESS: Please enter a valid Solana address (base58 format)");
      return;
    }

    // Check wallet balance
    try {
      const balance = await connection.getBalance(publicKey);
      const amount = BUCKET_AMOUNTS[selectedBucket];
      const totalRequired = amount * (1 + RELAYER_FEE_PERCENT / 100);
      const rentExemption = 0.002 * 1e9; // ~0.002 SOL for rent
      const totalWithRent = totalRequired + rentExemption;

      if (balance < totalWithRent) {
        setError(
          `INSUFFICIENT_BALANCE: Need ${(totalWithRent / 1e9).toFixed(4)} SOL, have ${(balance / 1e9).toFixed(4)} SOL. ` +
          `Get devnet SOL: solana airdrop 2 ${publicKey.toBase58().slice(0, 8)}...`
        );
        return;
      }
    } catch (err) {
      console.error("Failed to check balance:", err);
      setError("FAILED_TO_CHECK_BALANCE");
      return;
    }

    setError(null);
    setFlowStep("purchasing-credit");

    try {
      // Step 1: Purchase Credit
      const amount = BUCKET_AMOUNTS[selectedBucket];
      console.log(`[FLOW] Selected bucket: ${selectedBucket}, Amount: ${amount / 1e9} SOL`);
      const { tokenId, signature } = await createSignedToken(amount);

      const credit: Credit = {
        id: crypto.randomUUID(),
        amount,
        tokenId,
        signature,
        createdAt: Date.now(),
        used: false,
      };
      addCredit(credit);

      // Step 2: Deposit
      setFlowStep("depositing");
      const depositResult = await deposit(credit, {
        skipDelay: devMode,
        testMode: devMode,
      });

      // Step 3: Withdraw (always to stealth address)
      setFlowStep("withdrawing");
      const withdrawResult = await withdraw(depositResult, {
        delayHours: devMode ? 0 : undefined,
        devMode,
      });

      setStealthAddr(withdrawResult.stealthAddress.toBase58());

      // Step 4: Poll for stealth address balance then claim
      setFlowStep("claiming");

      // Poll until relayer executes the withdrawal (funds arrive at stealth address)
      // Relayer polls every 10s; devMode delay=0 so it executes in the next poll cycle
      // We need to wait for BOTH pre-funding AND actual withdrawal execution
      const stealthPubkey = withdrawResult.stealthAddress.toBase58();
      console.log(`[FLOW] Polling for balance on stealth address: ${stealthPubkey}`);
      const { Connection: SolConn, PublicKey: SolPK } = await import("@solana/web3.js");
      const pollConn = new SolConn(import.meta.env.VITE_SOLANA_RPC_URL || "https://api.devnet.solana.com", "confirmed");
      const maxPolls = devMode ? 30 : 60; // 5 min (devMode) or 10 min
      const pollInterval = 10_000; // 10 seconds
      let funded = false;
      let finalBalance = 0;
      const expectedAmount = BUCKET_AMOUNTS[selectedBucket] * 0.995; // 99.5% after 0.5% fee
      const rentExempt = 890880; // Rent-exempt minimum

      for (let i = 0; i < maxPolls; i++) {
        await new Promise(resolve => setTimeout(resolve, pollInterval));
        try {
          const bal = await pollConn.getBalance(new SolPK(stealthPubkey));
          console.log(`[FLOW] Poll ${i + 1}/${maxPolls}: Balance = ${bal / 1e9} SOL`);

          // Check if we have MORE than just the rent-exempt minimum
          // This means the actual withdrawal has been executed
          if (bal > rentExempt * 1.5) { // 1.5x rent to be safe
            funded = true;
            finalBalance = bal;
            console.log(`[FLOW] ✓ Withdrawal executed! Balance = ${bal / 1e9} SOL`);
            break;
          } else if (bal > 0) {
            console.log(`[FLOW] ⏳ Pre-funded with rent-exempt minimum, waiting for withdrawal execution...`);
          }
        } catch { /* ignore RPC errors, keep polling */ }
      }
      if (!funded) {
        throw new Error("WITHDRAWAL_TIMEOUT: Relayer did not execute within timeout. Funds are safe — check /withdraw/pending or retry claim later.");
      }

      console.log(`[FLOW] Stealth address funded with ${finalBalance / 1e9} SOL, claiming to ${recipientAddress}`);

      // CRITICAL CHECK: Verify the stealth address has the expected amount
      if (finalBalance < expectedAmount * 0.9) { // Allow 10% tolerance for fees
        console.error(`[FLOW] ERROR: Stealth address has ${finalBalance / 1e9} SOL but expected ~${expectedAmount / 1e9} SOL`);
        throw new Error(
          `WITHDRAWAL_AMOUNT_MISMATCH\n\n` +
          `Expected: ~${(expectedAmount / 1e9).toFixed(4)} SOL\n` +
          `Received: ${(finalBalance / 1e9).toFixed(6)} SOL\n\n` +
          `This indicates the relayer's execute_withdrawal transaction failed.\n` +
          `Check relayer logs: docker logs tracezero-relayer-1 --tail 100`
        );
      }

      // Claim funds to recipient address
      const claimTx = await claim(withdrawResult.stealthAddress.toBase58(), recipientAddress);

      setFinalTxSignature(claimTx);
      setFlowStep("complete");
    } catch (err) {
      console.error("Flow failed:", err);
      let errorMessage = "TRANSACTION_FAILED";

      if (err instanceof Error) {
        errorMessage = err.message;

        // Parse common errors
        if (errorMessage.includes("insufficient funds") || errorMessage.includes("account (0)")) {
          errorMessage =
            "RELAYER_WALLET_INSUFFICIENT_FUNDS\n\n" +
            "The relayer's wallet needs SOL to execute transactions.\n\n" +
            "Fix: Run 'solana airdrop 5' in the relayer terminal, then restart the relayer.\n\n" +
            "See RELAYER_SETUP.md for details.";
        } else if (errorMessage.includes("blockhash not found")) {
          errorMessage = "NETWORK_ERROR: Transaction expired, please retry";
        } else if (errorMessage.includes("User rejected")) {
          errorMessage = "TRANSACTION_REJECTED_BY_USER";
        } else if (errorMessage.includes("Payment transaction not found")) {
          errorMessage = "PAYMENT_NOT_CONFIRMED: Wait a moment and retry";
        }
      }

      setError(errorMessage);
      setFlowStep("idle");
    }
  };

  const resetFlow = () => {
    setFlowStep("idle");
    setError(null);
    setFinalTxSignature(null);
    setStealthAddr(null);
    setSelectedBucket(null);
  };

  const isProcessing =
    flowStep === "purchasing-credit" ||
    flowStep === "depositing" ||
    flowStep === "withdrawing" ||
    flowStep === "claiming";

  if (!connected) {
    return (
      <div className="min-h-screen flex items-center justify-center px-6 bg-black">
        <div className="terminal-box max-w-md w-full">
          <div className="flex items-center gap-2 mb-4 pb-4 border-b-2 border-lime/30">
            <div className="w-3 h-3 bg-red-500"></div>
            <div className="w-3 h-3 bg-red-500/50"></div>
            <div className="w-3 h-3 bg-red-500/20"></div>
            <span className="ml-4 text-red-500 font-mono">ERROR</span>
          </div>
          <div className="space-y-2 text-sm">
            <div className="text-red-500">
              <span className="mr-2">{">"}</span>
              WALLET_NOT_CONNECTED
            </div>
            <div className="text-white/60 mt-4">
              <span className="mr-2">{">"}</span>
              CONNECT_WALLET_TO_CONTINUE
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Success screen
  if (flowStep === "complete") {
    return (
      <div className="min-h-screen bg-black text-white py-12 px-6">
        <div className="max-w-4xl mx-auto">
          <div className="mb-12">
            <div className="inline-block border-2 border-lime px-4 py-2 mb-6">
              <span className="font-mono text-lime text-sm font-bold">
                [TRANSACTION_COMPLETE]
              </span>
            </div>
            <h1 className="font-mono font-black text-5xl lg:text-6xl mb-4">
              <span className="text-lime">[</span>
              <span className="text-white">SUCCESS</span>
              <span className="text-lime">]</span>
            </h1>
          </div>

          <div className="border-2 border-lime bg-lime/10 p-6 mb-6">
            <div className="flex items-start gap-2 font-mono text-sm">
              <span className="text-lime">{">"}</span>
              <div className="flex-1">
                <div className="text-lime font-bold mb-2">
                  FUNDS_TRANSFERRED_TO_RECIPIENT
                </div>
                <div className="text-lime/80 mb-4">
                  TRANSACTION_COMPLETED_SUCCESSFULLY
                </div>
                <div className="mb-3">
                  <div className="text-xs text-lime/60 mb-1">RECIPIENT:</div>
                  <code className="text-xs break-all text-lime/80">
                    {recipientAddress}
                  </code>
                </div>
                {finalTxSignature && (
                  <div className="mb-3">
                    <div className="text-xs text-lime/60 mb-1">TX_SIGNATURE:</div>
                    <code className="text-xs break-all text-lime">
                      {finalTxSignature}
                    </code>
                  </div>
                )}
                {stealthAddr && (
                  <div>
                    <div className="text-xs text-lime/60 mb-1">STEALTH_ADDR:</div>
                    <code className="text-xs break-all text-white/40">
                      {stealthAddr}
                    </code>
                  </div>
                )}
              </div>
            </div>
          </div>

          <div className="flex gap-4">
            <button onClick={resetFlow} className="btn-terminal flex-1">
              [NEW_TRANSACTION]
            </button>
            <a href="/" className="btn-terminal flex-1 text-center">
              [GO_HOME]
            </a>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white py-12 px-6">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        {/* <div className="mb-12">
          <div className="flex items-center justify-between mb-6">
            <div className="inline-block border-2 border-lime px-4 py-2">
              <span className="font-mono text-lime text-sm font-bold">
                [PRIVATE_TRANSFER]
              </span>
            </div>
            {balance !== null && (
              <div></div>
              // <div className="border-2 border-lime/30 px-4 py-2">
              //   <span className="font-mono text-xs text-white/60 mr-2">BALANCE:</span>
              //   <span className="font-mono text-lime font-bold tabular-nums">
              //     {(balance / 1e9).toFixed(4)} SOL
              //   </span>
              // </div>
            )}
          </div>
        </div> */}

        {/* Network Warning - Force Devnet */}
        {showNetworkWarning && !isProcessing && (
          <div className="border-2 border-red-500 bg-red-500/10 p-6 mb-8">
            <div className="flex items-start gap-3">
              <span className="text-red-500 text-2xl">⚠</span>
              <div>
                <div className="font-mono text-red-500 font-bold mb-2">
                  MAINNET_NOT_SUPPORTED
                </div>
                <div className="font-mono text-sm text-red-400/80 mb-3">
                  {">"} THIS_IS_BETA_SOFTWARE
                  <br />
                  {">"} PLEASE_SWITCH_TO_DEVNET_IN_YOUR_WALLET
                </div>
                <div className="text-xs font-mono text-white/40 mb-3">
                  Current network: {isDevnet ? 'DEVNET' : 'MAINNET'}
                </div>
                <div className="border-2 border-red-500/30 bg-black/30 p-3 text-xs font-mono text-red-400">
                  {">"} TRANSACTIONS_DISABLED_ON_MAINNET
                  <br />
                  {">"} SWITCH_TO_DEVNET_TO_CONTINUE
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Tor Warning - Only show after 5 seconds if not verified */}
        {showTorWarning && !torVerified && !isProcessing && (
          <div className="border-2 border-yellow-500 bg-yellow-500/10 p-6 mb-8">
            <div className="flex items-start gap-3">
              <span className="text-yellow-500 text-2xl">⚠</span>
              <div>
                <div className="font-mono text-yellow-500 font-bold mb-2">
                  TOR_CONNECTION_REQUIRED
                </div>
                <div className="font-mono text-sm text-yellow-400/80 mb-3">
                  {">"} START_TOR_GATEWAY_BEFORE_PROCEEDING
                </div>
                <div className="text-xs font-mono text-white/40 mb-3">
                  docker compose -f crates/network/docker-compose.yml up -d
                </div>
                <button
                  onClick={() => verifyTor()}
                  className="border-2 border-yellow-500 text-yellow-500 px-4 py-2 text-xs font-bold hover:bg-yellow-500 hover:text-black transition-colors"
                >
                  [RETRY_CONNECTION]
                </button>
              </div>
            </div>
          </div>
        )}

        <div className="grid lg:grid-cols-2 gap-8">
          {/* Left - Configuration */}
          <div className="space-y-6">
            {/* Amount Selection */}
            <div className="terminal-box">
              <div className="flex items-center gap-2 mb-4 pb-4 border-b-2 border-lime/30">
                <div className="w-3 h-3 bg-lime"></div>
                <div className="w-3 h-3 bg-lime/50"></div>
                <div className="w-3 h-3 bg-lime/20"></div>
                <span className="ml-4 text-lime">AMOUNT</span>
              </div>

              <div className="grid grid-cols-2 gap-3">
                {BUCKET_AMOUNTS.map((amount, index) => {
                  const hexCode = `0x${(index + 1).toString(16).toUpperCase().padStart(2, "0")}`;
                  return (
                    <button
                      key={index}
                      onClick={() => setSelectedBucket(index)}
                      disabled={isProcessing}
                      className={`p-4 border-2 transition-all duration-200 font-mono ${selectedBucket === index
                          ? "border-lime bg-lime/10 text-lime"
                          : "border-lime/20 text-white/60 hover:border-lime/50 hover:bg-lime/5"
                        } ${isProcessing ? "opacity-50 cursor-not-allowed" : ""}`}
                    >
                      <div className="text-xs text-lime/60 mb-2">{hexCode}</div>
                      <div className="text-2xl font-black tabular-nums">
                        {amount / 1e9}
                      </div>
                      <div className="text-xs opacity-70">SOL</div>
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Recipient Address */}
            <div className="terminal-box">
              <div className="flex items-center gap-2 mb-4 pb-4 border-b-2 border-lime/30">
                <div className="w-3 h-3 bg-lime"></div>
                <div className="w-3 h-3 bg-lime/50"></div>
                <div className="w-3 h-3 bg-lime/20"></div>
                <span className="ml-4 text-lime">RECIPIENT</span>
                <span className="ml-auto text-xs text-red-500 font-mono">*REQUIRED</span>
              </div>
              <div>
                <label className="block font-mono text-xs text-lime/60 mb-2">
                  DESTINATION_ADDRESS:
                </label>
                <input
                  type="text"
                  value={recipientAddress}
                  onChange={(e) => setRecipientAddress(e.target.value.trim())}
                  placeholder="Enter Solana address (e.g., 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU)"
                  disabled={isProcessing}
                  className={`w-full bg-black border-2 px-4 py-3 font-mono text-sm text-white focus:border-lime focus:outline-none disabled:opacity-50 ${
                    recipientAddress ? 'border-lime/30' : 'border-red-500/50'
                  }`}
                />
                <div className="text-xs font-mono text-white/40 mt-2">
                  {">"} FUNDS_WILL_BE_SENT_DIRECTLY_HERE
                </div>
              </div>
            </div>

            {/* Dev Mode */}
            <div className="border-2 border-yellow-500/50 p-6">
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="font-mono text-yellow-500 font-bold mb-1">
                    DEV_MODE
                  </div>
                  <div className="font-mono text-xs text-white/60">
                    Skip timing delays
                  </div>
                </div>
                <button
                  onClick={() => setDevMode(!devMode)}
                  disabled={isProcessing}
                  className={`border-2 px-4 py-2 font-mono font-bold text-sm transition-colors ${devMode
                      ? "border-yellow-500 bg-yellow-500 text-black"
                      : "border-yellow-500/50 text-yellow-500 hover:bg-yellow-500/10"
                    } ${isProcessing ? "opacity-50 cursor-not-allowed" : ""}`}
                >
                  [{devMode ? "ON" : "OFF"}]
                </button>
              </div>
            </div>
          </div>

          {/* Right - Preview & Execute */}
          <div className="space-y-6">
            {/* Info */}
                <div className="border-2 border-lime/20 p-6">
                  <div className="text-xs text-lime/60 font-mono mb-3">
                    EXECUTION_FLOW:
                  </div>
                  <div className="space-y-2 text-sm text-white/60 font-mono">
                    <div className="flex gap-2">
                      <span className="text-lime">1.</span>
                      <span>PURCHASE_BLINDED_CREDIT</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="text-lime">2.</span>
                      <span>DEPOSIT_VIA_TOR</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="text-lime">3.</span>
                      <span>WITHDRAW_WITH_ZK_PROOF</span>
                    </div>
                    <div className="flex gap-2">
                      <span className="text-lime">4.</span>
                      <span>AUTO_CLAIM_TO_RECIPIENT</span>
                    </div>
                    <div className="flex gap-2 mt-3 pt-3 border-t-2 border-lime/10">
                      <span className="text-lime">{">"}</span>
                      <span className="text-lime/80">FULLY_UNLINKABLE</span>
                    </div>
                  </div>
                </div>
            {selectedBucket !== null ? (
              <>
                {/* Transaction Preview */}
                <div className="terminal-box">
                  <div className="flex items-center gap-2 mb-4 pb-4 border-b-2 border-lime/30">
                    <div className="w-3 h-3 bg-lime"></div>
                    <div className="w-3 h-3 bg-lime/50"></div>
                    <div className="w-3 h-3 bg-lime/20"></div>
                    <span className="ml-4 text-lime">PREVIEW</span>
                  </div>

                  <div className="space-y-3 text-sm font-mono">
                    <div className="flex justify-between">
                      <span className="text-white/60">AMOUNT:</span>
                      <span className="text-lime tabular-nums">
                        {BUCKET_AMOUNTS[selectedBucket] / 1e9} SOL
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/60">RELAYER_FEE:</span>
                      <span className="text-lime tabular-nums">
                        {(BUCKET_AMOUNTS[selectedBucket] * RELAYER_FEE_PERCENT) / 100 / 1e9} SOL
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/60">WITHDRAW_FEE:</span>
                      <span className="text-lime tabular-nums">
                        {(BUCKET_AMOUNTS[selectedBucket] * 0.005) / 1e9} SOL
                      </span>
                    </div>
                    <div className="border-t-2 border-lime/30 pt-3 flex justify-between">
                      <span className="text-white font-bold">TOTAL_PAYMENT:</span>
                      <span className="text-lime font-black text-lg tabular-nums">
                        {(BUCKET_AMOUNTS[selectedBucket] * (1 + RELAYER_FEE_PERCENT / 100)) / 1e9} SOL
                      </span>
                    </div>
                    <div className="flex justify-between">
                      <span className="text-white/60">RECIPIENT_GETS:</span>
                      <span className="text-lime font-bold tabular-nums">
                        {(BUCKET_AMOUNTS[selectedBucket] * 0.995) / 1e9} SOL
                      </span>
                    </div>
                  </div>
                </div>

                {/* Progress Display */}
                {isProcessing && (
                  <div className="border-2 border-lime p-6">
                    <div className="font-mono text-sm text-lime mb-4">
                      {">"} {getCurrentStepMessage()}
                    </div>
                    <div className="h-2 bg-black border-2 border-lime/30 overflow-hidden mb-2">
                      <div
                        className="h-full bg-lime transition-all duration-500"
                        style={{ width: `${getProgressPercentage()}%` }}
                      ></div>
                    </div>
                    <div className="font-mono text-xs text-lime/60 tabular-nums">
                      PROGRESS: {Math.round(getProgressPercentage())}%
                    </div>
                    <div className="mt-3 font-mono text-xs text-lime/40">
                      PROCESSING_0x{Math.random().toString(16).substr(2, 8).toUpperCase()}...
                    </div>
                  </div>
                )}

                {/* Error Display */}
                {error && (
                  <div className="border-2 border-red-500 bg-red-500/10 p-4">
                    <div className="flex items-start gap-2 font-mono text-sm">
                      <span className="text-red-500">{">"}</span>
                      <div className="flex-1">
                        <div className="text-red-500 font-bold mb-1">ERROR:</div>
                        <div className="text-red-400 whitespace-pre-line">{error}</div>
                      </div>
                    </div>
                  </div>
                )}

                {/* Execute Button */}
                <button
                  onClick={handleExecuteFlow}
                  disabled={isProcessing || !torVerified || !recipientAddress || !isDevnet}
                  className="btn-terminal w-full text-lg"
                >
                  {isProcessing ? "[PROCESSING...]" : "[EXECUTE_TRANSACTION]"}
                </button>

                {!isDevnet && (
                  <div className="text-center font-mono text-xs text-red-500">
                    {">"} MAINNET_NOT_SUPPORTED_USE_DEVNET
                  </div>
                )}

                {isDevnet && !torVerified && (
                  <div className="text-center font-mono text-xs text-yellow-500">
                    {">"} TOR_CONNECTION_REQUIRED
                  </div>
                )}

                {/* Get Devnet SOL */}
                {balance !== null && balance < 1e9 && (
                  <div className="border-2 border-yellow-500/50 bg-yellow-500/5 p-4">
                    <div className="text-xs text-yellow-500 font-mono mb-2">
                      {">"} LOW_BALANCE_DETECTED
                    </div>
                    <div className="text-xs text-white/60 font-mono mb-3">
                      Get devnet SOL for testing:
                    </div>
                    <code className="text-xs text-lime bg-black/50 px-3 py-2 rounded block">
                      solana airdrop 2
                    </code>
                  </div>
                )}
              </>
            ) : (
              <div className="terminal-box h-[50%] flex items-center justify-center py-20">
                <div className="text-center">
                  <div className="text-4xl text-lime/20 mb-4">[ ]</div>
                  <div className="font-mono text-white/40 text-sm">
                    {">"} SELECT_AMOUNT_TO_CONTINUE
                  </div>
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
