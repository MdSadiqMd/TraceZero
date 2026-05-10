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
      { title: "TraceZero - Privacy proxy for your Solana Transactions" },
      {
        name: "description",
        content:
          "ZK-powered private transactions on Solana with complete sender untraceability",
      },
    ],
    links: [{ rel: "icon", href: "/logo.jpeg" }],
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
            <div className="w-10 h-10 overflow-hidden rounded-sm group-hover:opacity-80 transition-opacity">
              <img 
                src="/logo.jpeg" 
                alt="TraceZero" 
                className="w-full h-full object-cover"
              />
            </div>
            <div className="flex flex-col">
              <span className="font-mono font-black text-lime text-xl leading-none">
                TRACE_ZERO
              </span>
              <div className="flex items-center gap-2 mt-1">
                <div className="w-1.5 h-1.5 bg-lime rounded-full animate-pulse"></div>
                <span className="font-mono text-[10px] text-lime/80 font-bold tracking-wider">
                  LIVE_ON_DEVNET
                </span>
              </div>
            </div>
          </Link>

          {/* Navigation */}
          {/* <nav className="hidden md:flex items-center gap-1 font-mono text-sm font-bold">
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
            </Link>
          </nav> */}

          {/* Social & Wallet */}
          <div className="flex items-center gap-3">
            {/* GitHub */}
            <a
              href="https://github.com/MdSadiqMd/TraceZero"
              target="_blank"
              rel="noopener noreferrer"
              className="w-10 h-10 border-2 border-lime/30 hover:border-lime flex items-center justify-center transition-colors group"
              title="GitHub"
            >
              <svg className="w-5 h-5 text-lime/60 group-hover:text-lime transition-colors" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/>
              </svg>
            </a>
            
            {/* Twitter */}
            <a
              href="https://x.com/Md_Sadiq_Md/status/2030684954611610065?s=20"
              target="_blank"
              rel="noopener noreferrer"
              className="w-10 h-10 border-2 border-lime/30 hover:border-lime flex items-center justify-center transition-colors group"
              title="Twitter"
            >
              <svg className="w-5 h-5 text-lime/60 group-hover:text-lime transition-colors" fill="currentColor" viewBox="0 0 24 24">
                <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24H16.17l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z"/>
              </svg>
            </a>
            
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
