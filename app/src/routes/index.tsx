import { createFileRoute, Link } from "@tanstack/react-router";
import { useWallet } from "@solana/wallet-adapter-react";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import { useState, useEffect } from "react";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  const { connected } = useWallet();
  const [bootComplete, setBootComplete] = useState(false);
  const [currentLine, setCurrentLine] = useState(0);

  const bootSequence = [
    "INITIALIZING PRIVACY PROTOCOL...",
    "LOADING ZK-SNARK CIRCUITS...",
    "CONNECTING TO TOR NETWORK...",
    "VERIFYING BLIND SIGNATURE MODULE...",
    "SYSTEM READY",
  ];

  useEffect(() => {
    if (currentLine < bootSequence.length) {
      const timer = setTimeout(() => {
        setCurrentLine(currentLine + 1);
      }, 300);
      return () => clearTimeout(timer);
    } else {
      setTimeout(() => setBootComplete(true), 500);
    }
  }, [currentLine]);

  if (!bootComplete) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-black">
        <div className="terminal-box max-w-2xl w-full">
          <div className="flex items-center gap-2 mb-4 pb-4 border-b-2 border-lime/30">
            <div className="w-3 h-3 bg-lime"></div>
            <div className="w-3 h-3 bg-lime/50"></div>
            <div className="w-3 h-3 bg-lime/20"></div>
            <span className="ml-4 text-lime">TRACE_ZERO_v1.0.0</span>
          </div>
          {bootSequence.slice(0, currentLine).map((line, i) => (
            <div key={i} className="text-lime/80 mb-2">
              <span className="text-lime mr-2">{">"}</span>
              {line}
            </div>
          ))}
          {currentLine < bootSequence.length && (
            <div className="text-lime terminal-cursor"></div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-black text-white crt">
      <div className="scanline"></div>

      {/* Hero */}
      <section className="min-h-screen flex items-center justify-center px-6 relative overflow-hidden">
        {/* Matrix rain background */}
        <div className="absolute inset-0 opacity-5">
          {[...Array(20)].map((_, i) => (
            <div
              key={i}
              className="absolute text-lime font-mono text-xs"
              style={{
                left: `${i * 5}%`,
                animation: `matrix-rain ${5 + Math.random() * 5}s linear infinite`,
                animationDelay: `${Math.random() * 5}s`,
              }}
            >
              {Array.from({ length: 20 }, () =>
                String.fromCharCode(33 + Math.floor(Math.random() * 94)),
              ).join("\n")}
            </div>
          ))}
        </div>

        <div className="relative z-10 max-w-7xl mx-auto">
          <div className="grid lg:grid-cols-2 gap-12 items-center">
            {/* Left side */}
            <div>
              <div className="mb-8">
                <div className="inline-block border-2 border-lime px-4 py-2 mb-6">
                  <span className="font-mono text-lime text-sm font-bold">
                    [ZERO_KNOWLEDGE_PROTOCOL]
                  </span>
                </div>
                <h1 className="font-mono font-black text-6xl lg:text-7xl mb-6 leading-none">
                  <span className="text-white">UNTRACEABLE</span>
                  <br />
                  <span className="text-lime neon-lime">TRANSACTIONS</span>
                </h1>
                <p className="text-xl text-white/60 font-mono mb-8">
                  Complete anonymity on Solana using ZK proofs, blind
                  signatures, and Tor routing
                </p>
              </div>

              <div className="flex flex-col sm:flex-row gap-4">
                {connected ? (
                  <Link
                    to="/credits"
                    className="btn-terminal inline-block text-center"
                  >
                    [LAUNCH_APP]
                  </Link>
                ) : (
                  <WalletMultiButton />
                )}
                <a
                  href="https://github.com/privacy-proxy"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="border-2 border-white/20 hover:border-lime px-6 py-3 font-mono font-bold text-center transition-all duration-200 hover:bg-lime hover:text-black"
                >
                  [DOCUMENTATION]
                </a>
              </div>

              {/* Stats */}
              <div className="grid grid-cols-3 gap-4 mt-12">
                {[
                  { label: "DEPOSITS", value: "1,234" },
                  { label: "VOLUME_SOL", value: "12.3K" },
                  { label: "ANON_SET", value: "156" },
                ].map((stat, i) => (
                  <div key={i} className="border-2 border-lime/20 p-4">
                    <div className="font-mono text-2xl font-black text-lime mb-1 tabular-nums">
                      {stat.value}
                    </div>
                    <div className="font-mono text-xs text-white/40">
                      {stat.label}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Right side - Terminal */}
            <div className="terminal-box">
              <div className="flex items-center gap-2 mb-4 pb-4 border-b-2 border-lime/30">
                <div className="w-3 h-3 bg-lime"></div>
                <div className="w-3 h-3 bg-lime/50"></div>
                <div className="w-3 h-3 bg-lime/20"></div>
                <span className="ml-4 text-lime">SYSTEM_STATUS</span>
              </div>
              <div className="space-y-2 text-sm">
                <div className="flex justify-between">
                  <span className="text-white/60">ZK_CIRCUITS:</span>
                  <span className="text-lime">LOADED</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/60">TOR_NETWORK:</span>
                  <span className="text-lime">CONNECTED</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/60">BLIND_SIG:</span>
                  <span className="text-lime">ACTIVE</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/60">MERKLE_TREE:</span>
                  <span className="text-lime">SYNCED</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-white/60">STEALTH_ADDR:</span>
                  <span className="text-lime">READY</span>
                </div>
              </div>
              <div className="mt-6 pt-4 border-t-2 border-lime/30">
                <div className="text-lime/60 text-xs mb-2">
                  RECENT_ACTIVITY:
                </div>
                <div className="space-y-1 text-xs">
                  <div className="text-white/40">
                    <span className="text-lime mr-2">{">"}</span>
                    DEPOSIT_0x7a3f...2b1c [0.5 SOL]
                  </div>
                  <div className="text-white/40">
                    <span className="text-lime mr-2">{">"}</span>
                    WITHDRAW_0x9c2e...4d8a [1.0 SOL]
                  </div>
                  <div className="text-white/40">
                    <span className="text-lime mr-2">{">"}</span>
                    CREDIT_PURCHASE [2.0 SOL]
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* How it works */}
      <section className="py-32 px-6 border-t-2 border-lime/10">
        <div className="max-w-7xl mx-auto">
          <div className="mb-16">
            <h2 className="font-mono font-black text-5xl mb-4">
              <span className="text-lime">[</span>
              <span className="text-white">PROTOCOL_FLOW</span>
              <span className="text-lime">]</span>
            </h2>
            <p className="font-mono text-white/60">
              Three-step process for complete anonymity
            </p>
          </div>

          <div className="data-grid grid-cols-1 lg:grid-cols-3">
            {[
              {
                num: "01",
                title: "PURCHASE_CREDITS",
                desc: "Buy blinded credits using RSA blind signatures. Relayer signs without seeing token value.",
                hex: "0xA1B2C3",
              },
              {
                num: "02",
                title: "DEPOSIT_VIA_TOR",
                desc: "Redeem credit through Tor network. Your wallet address never appears in pool transaction.",
                hex: "0xD4E5F6",
              },
              {
                num: "03",
                title: "WITHDRAW_WITH_ZK",
                desc: "Generate Groth16 proof to withdraw to stealth address. Fully unlinkable from deposit.",
                hex: "0x7G8H9I",
              },
            ].map((step, i) => (
              <div
                key={i}
                className="data-cell group hover:bg-lime/5 transition-colors cursor-default"
              >
                <div className="flex items-start justify-between mb-4">
                  <div className="text-4xl font-black text-lime/20 font-mono">
                    {step.num}
                  </div>
                  <div className="text-xs text-lime/60 font-mono">
                    {step.hex}
                  </div>
                </div>
                <h3 className="font-mono font-bold text-lg text-lime mb-3 group-hover:neon-lime transition-all">
                  {step.title}
                </h3>
                <p className="text-sm text-white/60 leading-relaxed">
                  {step.desc}
                </p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* Features */}
      <section className="py-32 px-6 border-t-2 border-lime/10">
        <div className="max-w-7xl mx-auto">
          <div className="mb-16">
            <h2 className="font-mono font-black text-5xl mb-4">
              <span className="text-lime">[</span>
              <span className="text-white">SECURITY_FEATURES</span>
              <span className="text-lime">]</span>
            </h2>
          </div>

          <div className="grid md:grid-cols-2 lg:grid-cols-3 gap-px bg-lime/20">
            {[
              {
                code: "RSA_BLIND_SIG",
                title: "Blind Signatures",
                desc: "Mathematically unlinkable payments",
              },
              {
                code: "TOR_ROUTING",
                title: "Tor Network",
                desc: "Network-level anonymity",
              },
              {
                code: "ZK_GROTH16",
                title: "ZK Proofs",
                desc: "Verify without revealing",
              },
              {
                code: "STEALTH_ADDR",
                title: "Stealth Addresses",
                desc: "One-time addresses",
              },
              {
                code: "FIXED_DENOM",
                title: "Fixed Amounts",
                desc: "Prevent correlation",
              },
              {
                code: "RANDOM_DELAY",
                title: "Timing Protection",
                desc: "Break timing analysis",
              },
            ].map((feature, i) => (
              <div
                key={i}
                className="bg-black p-6 hover:bg-lime/5 transition-colors group cursor-default"
              >
                <div className="text-xs text-lime/60 font-mono mb-3">
                  {feature.code}
                </div>
                <h3 className="font-mono font-bold text-white mb-2 group-hover:text-lime transition-colors">
                  {feature.title}
                </h3>
                <p className="text-sm text-white/50">{feature.desc}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* CTA */}
      <section className="py-32 px-6 border-t-2 border-lime/10">
        <div className="max-w-4xl mx-auto text-center">
          <h2 className="font-mono font-black text-5xl lg:text-6xl mb-8">
            <span className="text-white">READY_TO_</span>
            <span className="text-lime neon-lime">DEPLOY</span>
            <span className="text-white">?</span>
          </h2>
          <p className="font-mono text-xl text-white/60 mb-12">
            Start making untraceable transactions on Solana
          </p>
          {connected ? (
            <Link to="/credits" className="btn-terminal inline-block">
              [LAUNCH_APPLICATION]
            </Link>
          ) : (
            <WalletMultiButton />
          )}
        </div>
      </section>
    </div>
  );
}
