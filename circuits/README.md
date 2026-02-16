# Privacy-Proxy ZK Circuits (Security Hardened v2)

Zero-knowledge circuits for the privacy-proxy withdrawal protocol using Circom 2.2.x and Groth16.

## Security Audit Fixes Applied (v2)

This version includes critical security fixes from the audit:

| Issue | Severity | Fix Applied |
|-------|----------|-------------|
| Recipient/relayer not constrained | MEDIUM | Added binding hash output that cryptographically binds proof to recipient/relayer/fee |
| Ownership binding not verifiable | MEDIUM | Ownership proof now outputs binding hash for on-chain verification |
| Fee validation broken | CRITICAL | Uses `LessThan` comparator instead of broken field arithmetic |
| Missing domain separation | MEDIUM | All hashes now include domain tags |
| Zero value attacks | MEDIUM | Nullifier, secret, and amount must be non-zero |

## Overview

These circuits enable users to prove they have a valid deposit in the privacy pool without revealing which deposit is theirs.

### Circuits

| Circuit | Purpose | Public Inputs | Public Outputs | Constraints |
|---------|---------|---------------|----------------|-------------|
| `withdrawal.circom` | Prove valid deposit for withdrawal | root, nullifierHash, recipient, amount, relayer, fee | bindingHash | ~27,000 |
| `ownership.circom` | Prove nullifier ownership (for cancellation) | nullifierHash, pendingWithdrawalId | bindingHash | ~350 |

## Domain Separation

All hash functions use domain separation to prevent cross-protocol attacks:

```
DOMAIN_NULLIFIER  = 1853189228  // "null" as u32
DOMAIN_COMMIT     = 1668246637  // "comm" as u32
DOMAIN_BIND       = 1651076196  // "bind" as u32
DOMAIN_OWNER_BIND = 1869771618  // "ownb" as u32

nullifierHash = Poseidon(DOMAIN_NULLIFIER, nullifier)
commitment    = Poseidon(DOMAIN_COMMIT, nullifier, secret, amount)
bindingHash   = Poseidon(DOMAIN_BIND, nullifierHash, recipient, relayer, fee)
ownerBinding  = Poseidon(DOMAIN_OWNER_BIND, nullifier, pendingWithdrawalId)
```

## Binding Hashes (Security v2)

Both circuits now output a binding hash that MUST be verified on-chain:

### Withdrawal Binding Hash
```
bindingHash = Poseidon(DOMAIN_BIND, nullifierHash, recipient, relayer, fee)
```
This cryptographically binds the proof to specific recipient/relayer/fee values.
The smart contract MUST verify this matches the expected value computed from
the transaction parameters.

### Ownership Binding Hash
```
bindingHash = Poseidon(DOMAIN_OWNER_BIND, nullifier, pendingWithdrawalId)
```
This binds the ownership proof to a specific pending withdrawal.
Since `nullifier` is private, the smart contract cannot recompute this directly,
but the circuit guarantees the binding is correct.

## Prerequisites

1. **Circom 2.2.x** (Rust-based compiler)
   ```bash
   cargo install circom
   circom --version  # Should show 2.2.x
   ```

2. **Node.js 18+** with yarn
   ```bash
   node --version  # Should be 18+
   ```

## Quick Start

```bash
yarn install
./scripts/compile.sh
./scripts/setup.sh withdrawal
./scripts/setup.sh ownership
yarn test
./scripts/export_vk.sh withdrawal
./scripts/export_vk.sh ownership
```

## Circuit Details

### Withdrawal Circuit

**Public Inputs:**
- `root` - Current Merkle root
- `nullifierHash` - Poseidon(DOMAIN_NULLIFIER, nullifier)
- `recipient` - Stealth address
- `amount` - Withdrawal amount (must be > 0)
- `relayer` - Relayer address
- `fee` - Relayer fee (must be < amount)

**Public Outputs:**
- `bindingHash` - Poseidon(DOMAIN_BIND, nullifierHash, recipient, relayer, fee)

**Private Inputs:**
- `nullifier` - Random value (must be non-zero)
- `secret` - Random value (must be non-zero)
- `pathElements[20]` - Merkle proof siblings
- `pathIndices[20]` - Merkle proof directions

**Security Constraints Enforced:**
1. `nullifier != 0`
2. `secret != 0`
3. `amount != 0`
4. `fee < amount` (proper range check)
5. Domain-separated hashes
6. Valid Merkle proof
7. Binding hash output

### Ownership Circuit

**Public Inputs:**
- `nullifierHash` - Poseidon(DOMAIN_NULLIFIER, nullifier)
- `pendingWithdrawalId` - ID of withdrawal being cancelled

**Public Outputs:**
- `bindingHash` - Poseidon(DOMAIN_OWNER_BIND, nullifier, pendingWithdrawalId)

**Private Inputs:**
- `nullifier` - The actual nullifier value (must be non-zero)

## Security Considerations

1. **Nullifier entropy**: Use cryptographically secure random (256 bits)
2. **Domain separation**: MUST match between circuit and SDK
3. **Fee validation**: Circuit enforces fee < amount
4. **Binding verification**: Smart contract MUST verify binding hashes
5. **Trusted setup**: Use proper MPC ceremony for production

## License

MIT
