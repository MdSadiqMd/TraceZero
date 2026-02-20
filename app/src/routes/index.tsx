import { createFileRoute, Link } from "@tanstack/react-router";

export const Route = createFileRoute("/")({
  component: Home,
});

function Home() {
  return (
    <div className="max-w-4xl mx-auto">
      {/* Hero Section */}
      <section className="text-center py-16">
        <h1 className="text-5xl font-bold mb-6 bg-gradient-to-r from-primary-400 to-primary-600 bg-clip-text text-transparent">
          Private Transactions on Solana
        </h1>
        <p className="text-xl text-gray-400 mb-8 max-w-2xl mx-auto">
          ZK-powered anonymous transactions with complete sender untraceability.
          Your wallet never appears in pool transactions.
        </p>
        <div className="flex gap-4 justify-center">
          <Link to="/credits" className="btn-primary text-lg px-8 py-3">
            Get Started
          </Link>
          <a
            href="https://github.com/privacy-proxy"
            target="_blank"
            rel="noopener noreferrer"
            className="btn-secondary text-lg px-8 py-3"
          >
            Learn More
          </a>
        </div>
      </section>

      {/* How It Works */}
      <section className="py-16">
        <h2 className="text-3xl font-bold text-center mb-12">How It Works</h2>
        <div className="grid md:grid-cols-3 gap-8">
          <StepCard
            step={1}
            title="Purchase Credits"
            description="Buy blinded credits from the relayer. The relayer signs your token without seeing its value - mathematically unlinkable."
          />
          <StepCard
            step={2}
            title="Deposit via Tor"
            description="Redeem your credit through Tor. The relayer deposits to the pool using its own wallet - your address never appears."
          />
          <StepCard
            step={3}
            title="Withdraw with ZK"
            description="Generate a ZK proof to withdraw to a stealth address. No one can link your deposit to your withdrawal."
          />
        </div>
      </section>

      {/* Privacy Features */}
      <section className="py-16">
        <h2 className="text-3xl font-bold text-center mb-12">
          Privacy Features
        </h2>
        <div className="grid md:grid-cols-2 gap-6">
          <FeatureCard
            title="Blind Signatures"
            description="RSA blind signatures ensure the relayer cannot link your payment to your deposit."
          />
          <FeatureCard
            title="Tor Network"
            description="All sensitive requests are routed through Tor for network-level anonymity."
          />
          <FeatureCard
            title="ZK Proofs"
            description="Groth16 proofs verify your deposit without revealing which one is yours."
          />
          <FeatureCard
            title="Stealth Addresses"
            description="One-time addresses for withdrawals with no on-chain ephemeral keys."
          />
          <FeatureCard
            title="Fixed Denominations"
            description="Pool deposits use fixed amounts to prevent amount-based correlation."
          />
          <FeatureCard
            title="Random Delays"
            description="1-24 hour withdrawal delays break timing analysis attacks."
          />
        </div>
      </section>

      {/* Pool Stats */}
      <section className="py-16">
        <h2 className="text-3xl font-bold text-center mb-12">
          Pool Statistics
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
          <StatCard label="Total Deposits" value="1,234" />
          <StatCard label="Total Volume" value="12,345 SOL" />
          <StatCard label="Active Pools" value="7" />
          <StatCard label="Avg. Anonymity Set" value="156" />
        </div>
      </section>
    </div>
  );
}

function StepCard({
  step,
  title,
  description,
}: {
  step: number;
  title: string;
  description: string;
}) {
  return (
    <div className="card text-center">
      <div className="w-12 h-12 rounded-full bg-primary-600 flex items-center justify-center text-xl font-bold mx-auto mb-4">
        {step}
      </div>
      <h3 className="text-xl font-semibold mb-2">{title}</h3>
      <p className="text-gray-400">{description}</p>
    </div>
  );
}

function FeatureCard({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="card">
      <h3 className="text-lg font-semibold mb-2 text-primary-400">{title}</h3>
      <p className="text-gray-400">{description}</p>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="card text-center">
      <div className="text-2xl font-bold text-primary-400">{value}</div>
      <div className="text-gray-500 text-sm mt-1">{label}</div>
    </div>
  );
}
