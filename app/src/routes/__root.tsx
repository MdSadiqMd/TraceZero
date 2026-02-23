/// <reference types="vite/client" />
import type { ReactNode } from "react";
import {
  Outlet,
  createRootRoute,
  HeadContent,
  Scripts,
  Link,
} from "@tanstack/react-router";
import { SolanaProvider } from "@/components/SolanaProvider";
import { WalletMultiButton } from "@solana/wallet-adapter-react-ui";
import "@/styles/globals.css";

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Privacy Proxy - Anonymous Solana Transactions" },
      {
        name: "description",
        content:
          "ZK-powered private transactions on Solana with complete sender untraceability",
      },
    ],
    links: [{ rel: "icon", href: "/favicon.ico" }],
  }),
  component: RootComponent,
});

function RootComponent() {
  return (
    <RootDocument>
      <SolanaProvider>
        <div className="min-h-screen flex flex-col bg-black">
          <Header />
          <main className="flex-1 pt-20">
            <Outlet />
          </main>
          <Footer />
        </div>
      </SolanaProvider>
    </RootDocument>
  );
}

function Header() {
  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b-2 border-lime/20 bg-black/95 backdrop-blur-sm">
      <div className="max-w-7xl mx-auto px-6 py-4">
        <div className="flex items-center justify-between">
          {/* Logo */}
          <Link to="/" className="flex items-center gap-3 group">
            <div className="w-10 h-10 border-2 border-lime bg-black flex items-center justify-center group-hover:bg-lime transition-colors">
              <span className="text-2xl group-hover:scale-110 transition-transform">
                👁️
              </span>
            </div>
            <span className="font-mono font-black text-lime text-xl">
              TRACE_ZERO
            </span>
          </Link>

          {/* Navigation */}
          <nav className="hidden md:flex items-center gap-1 font-mono text-sm font-bold">
            <Link
              to="/credits"
              className="px-4 py-2 text-white/60 hover:text-lime hover:bg-lime/5 transition-all duration-200 [&.active]:text-lime [&.active]:bg-lime/10 relative group"
            >
              <span className="[&.active]:block hidden absolute left-2 text-lime">
                {">"}
              </span>
              <span className="group-[.active]:ml-4">CREDITS</span>
            </Link>
            <Link
              to="/deposit"
              className="px-4 py-2 text-white/60 hover:text-lime hover:bg-lime/5 transition-all duration-200 [&.active]:text-lime [&.active]:bg-lime/10 relative group"
            >
              <span className="[&.active]:block hidden absolute left-2 text-lime">
                {">"}
              </span>
              <span className="group-[.active]:ml-4">DEPOSIT</span>
            </Link>
            <Link
              to="/withdraw"
              className="px-4 py-2 text-white/60 hover:text-lime hover:bg-lime/5 transition-all duration-200 [&.active]:text-lime [&.active]:bg-lime/10 relative group"
            >
              <span className="[&.active]:block hidden absolute left-2 text-lime">
                {">"}
              </span>
              <span className="group-[.active]:ml-4">WITHDRAW</span>
            </Link>
            <Link
              to="/claim"
              className="px-4 py-2 text-white/60 hover:text-lime hover:bg-lime/5 transition-all duration-200 [&.active]:text-lime [&.active]:bg-lime/10 relative group"
            >
              <span className="[&.active]:block hidden absolute left-2 text-lime">
                {">"}
              </span>
              <span className="group-[.active]:ml-4">CLAIM</span>
            </Link>
          </nav>

          {/* Wallet */}
          <div className="flex items-center gap-3">
            <WalletMultiButton />
          </div>
        </div>
      </div>
    </header>
  );
}

function Footer() {
  return (
    <footer className="border-t-2 border-lime/20 bg-black py-8">
      <div className="max-w-7xl mx-auto px-6">
        {/* Ticker */}
        <div className="overflow-hidden mb-6">
          <div className="flex gap-8 animate-[scroll_20s_linear_infinite] whitespace-nowrap">
            {[...Array(3)].map((_, i) => (
              <div
                key={i}
                className="flex gap-8 font-mono text-xs text-lime/40"
              >
                <span>0xA1B2C3D4E5F6</span>
                <span>•</span>
                <span>MERKLE_ROOT: 0x7G8H9I</span>
                <span>•</span>
                <span>BLOCK_HEIGHT: 234,567</span>
                <span>•</span>
                <span>POOL_TVL: 12.3K_SOL</span>
                <span>•</span>
                <span>ANON_SET: 156</span>
                <span>•</span>
              </div>
            ))}
          </div>
        </div>

        {/* Status indicators */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-6">
          {[
            { label: "ZK_CIRCUITS", status: "ONLINE" },
            { label: "TOR_NETWORK", status: "ACTIVE" },
            { label: "BLIND_SIG", status: "READY" },
            { label: "MERKLE_TREE", status: "SYNCED" },
          ].map((item, i) => (
            <div key={i} className="border-2 border-lime/20 p-3">
              <div className="font-mono text-xs text-white/40 mb-1">
                {item.label}
              </div>
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 bg-lime animate-pulse"></div>
                <span className="font-mono text-xs text-lime font-bold">
                  {item.status}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* Footer text */}
        <div className="flex flex-col md:flex-row justify-between items-center gap-4 pt-6 border-t-2 border-lime/10">
          <div className="font-mono text-xs text-white/40">
            TRACE_ZERO_v1.0.0 // ZERO_KNOWLEDGE_PRIVACY
          </div>
          <div className="flex items-center gap-4 font-mono text-xs text-white/40">
            <span>TOR_ROUTING</span>
            <span>•</span>
            <span>BLIND_SIGNATURES</span>
            <span>•</span>
            <span>STEALTH_ADDRESSES</span>
          </div>
        </div>
      </div>
    </footer>
  );
}

function RootDocument({ children }: Readonly<{ children: ReactNode }>) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}
