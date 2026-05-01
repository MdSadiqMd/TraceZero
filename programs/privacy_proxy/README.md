# Privacy Proxy Programs

Solana programs for the privacy proxy system.

## Quick Start

### Prerequisites

- [Rust](https://rustup.rs/) (latest stable)
- [Solana CLI](https://docs.solana.com/cli/install-solana-cli-tools) (v1.18+)
- [Anchor](https://www.anchor-lang.com/docs/installation) (v0.30+)
- [Just](https://github.com/casey/just) (command runner)

### Install Just

```bash
# macOS
brew install just

# Linux/WSL
cargo install just

# Or download from https://github.com/casey/just/releases
```

### Build

```bash
# Build programs with automatic IDL verification
just build

# Or simply
just
```

This will:
1. Run `anchor build`
2. Fix IDL addresses automatically
3. Verify IDL addresses are correct
4. Fail if verification fails

### Other Commands

```bash
# List all available commands
just list

# Deploy to devnet
just deploy-devnet

# Run tests
just test

# Watch mode (rebuild on file changes)
just watch

# Format and lint
just fmt
just lint

# Full check (format, lint, build, test)
just full-check

# CI build (strict mode)
just ci-build
```

## Programs

### Privacy Proxy
**Program ID**: `Dzpj74oeEhpyXwaiLUFKgzVz1Dcj4ZobsoczYdHiMaB3`

Main program handling deposits and withdrawals with ZK proofs.

### ZK Verifier
**Program ID**: `2ntZ79MomBLsLyaExjGW6F7kkYtmprhdzZzQaMXSMZRu`

Groth16 ZK proof verification program.

## Development

### IDL Address Fix

Anchor has a known issue with multi-program workspaces where it generates incorrect IDL addresses. Our build process automatically fixes this:

1. `anchor build` generates IDLs with wrong addresses
2. `scripts/fix-idl.sh` corrects the addresses
3. `scripts/verify-idl.sh` verifies they're correct

**This is all automated when you use `just build`.**

### Manual Build (Not Recommended)

If you need to build manually:

```bash
anchor build
bash scripts/fix-idl.sh
bash scripts/verify-idl.sh
```

But really, just use `just build` 😊

## Testing

```bash
# Run all tests
just test

# Run specific test
anchor test --skip-local-validator -- test_name
```

## Deployment

### Devnet

```bash
just deploy-devnet
```

### Mainnet

```bash
just deploy-mainnet
# You'll be prompted to confirm
```

## CI/CD

For CI environments:

```bash
just ci-build
```

This runs in strict mode and fails on any verification errors.

## Troubleshooting

### IDL Address Mismatch

If you see errors about incorrect program IDs:

```bash
just fix-idl
just verify-idl
```

### Build Fails

```bash
# Clean and rebuild
just clean
just build
```

### Tests Fail

Make sure you've built first:

```bash
just build
just test
```

## Documentation

- [Security Audit](../../docs/SECURITY_AUDIT.md)
- [Domain Tags Specification](../../docs/DOMAIN_TAGS.md)
- [All Security Fixes](../../COMPLETE_SECURITY_AUDIT_FIXES.md)

## License

See [LICENSE](../../LICENSE) file.
