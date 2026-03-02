# WASM Usage in TRACE_ZERO

This document explains how and why we use WebAssembly (WASM) in TRACE_ZERO.

## Overview

WASM is used for **Zero-Knowledge Proof (ZK) generation** in the browser during the withdrawal process.

## The Withdrawal Flow

1. **User initiates withdrawal** on the Withdraw page
2. **Frontend generates ZK proof** using WASM:
   - Computes witness (private inputs) for the withdrawal circuit
   - Uses `withdrawal.wasm` to generate the proof
   - Uses `withdrawal_final.zkey` (proving key from trusted setup)
3. **Proof is sent to relayer** via Tor
4. **Relayer submits to on-chain program** which verifies using `withdrawal_vk.json` (verification key)

## WASM Files

Located in `app/public/circuits/`:

### `withdrawal.wasm` (Witness Computation)
- Compiled Circom circuit for witness generation
- Takes private inputs (nullifier, secret, path, etc.)
- Outputs witness values for proof generation
- Size: ~500KB

### `withdrawal_final.zkey` (Proving Key)
- Generated during trusted setup ceremony
- Contains circuit-specific parameters
- Required for proof generation
- Size: ~5MB

### `withdrawal_vk.json` (Verification Key)
- Used on-chain for proof verification
- Much smaller than proving key
- Embedded in the Solana program
- Size: ~2KB

## Why WASM?

### 1. Performance
ZK proof generation is computationally intensive. WASM provides near-native speed in the browser:
- Witness computation: ~500ms
- Proof generation: ~2-3 seconds
- vs. Pure JavaScript: 10x slower

### 2. Portability
Works across all modern browsers without special plugins:
- Chrome ✓
- Firefox ✓
- Safari ✓
- Edge ✓

### 3. Privacy
Proof generation happens **client-side**:
- Relayer never sees private inputs (nullifier, secret, merkle path)
- User maintains full control over sensitive data
- No server-side trust required

### 4. Decentralization
Users don't rely on a server to generate proofs:
- No single point of failure
- No rate limiting
- No censorship risk

## Technical Details

### Circuit Language: Circom

The withdrawal circuit is written in Circom (in `circuits/` folder):

```circom
// circuits/withdrawal.circom
template Withdrawal(levels) {
    // Private inputs
    signal input nullifier;
    signal input secret;
    signal input pathElements[levels];
    signal input pathIndices[levels];
    
    // Public inputs
    signal input root;
    signal input recipient;
    signal input relayer;
    signal input fee;
    signal input amount;
    
    // Outputs
    signal output nullifierHash;
    signal output bindingHash;
    
    // Circuit logic...
}
```

### Proof System: Groth16

- **Small proofs**: ~256 bytes
- **Fast verification**: <200k compute units on Solana
- **Trusted setup required**: One-time ceremony per circuit

### Libraries Used

**Frontend:**
- `snarkjs` - JavaScript library for proof generation
- `circomlibjs` - Circom library components (Poseidon hashing, etc.)
- Browser's Web Crypto API - For cryptographic operations

**On-chain:**
- `groth16-solana` - Solana-optimized Groth16 verifier

## What Gets Proven

The withdrawal circuit proves:

1. **You know the secret** for a specific deposit (without revealing it)
2. **The deposit exists** in the Merkle tree (without revealing which one)
3. **You're withdrawing** to a specific recipient and amount
4. **The binding hash** ties the proof to specific parameters (prevents reuse)

All without linking this withdrawal to the original deposit.

## Compilation Process

When circuits change (rare), they must be recompiled:

```bash
cd circuits

# 1. Compile circuit to WASM (~5 minutes)
./scripts/compile.sh

# 2. Generate proving keys (~30 minutes)
./scripts/setup.sh

# 3. Export verifying keys
./scripts/export_vk.sh

# 4. Copy to frontend
cp build/withdrawal_js/withdrawal.wasm ../app/public/circuits/
cp build/keys/withdrawal_final.zkey ../app/public/circuits/
cp build/withdrawal_vk.json ../app/public/circuits/

# 5. Update on-chain verifying key
node scripts/generate_vk_rust.js
```

## Performance Characteristics

| Operation | Time | Location |
|-----------|------|----------|
| Load WASM | ~100ms | Browser (first time) |
| Compute witness | ~500ms | Browser (WASM) |
| Generate proof | ~2-3s | Browser (WASM) |
| Verify proof | ~50ms | On-chain (Solana) |

## Security Considerations

### Trusted Setup

Groth16 requires a trusted setup ceremony:
- Currently using **test keys** (not production-ready)
- Production requires multi-party computation (MPC) ceremony
- Participants must destroy their "toxic waste"
- Only one honest participant needed for security

### WASM Security

- WASM runs in browser sandbox (isolated from system)
- No access to filesystem or network
- Memory-safe by design
- Deterministic execution

### Circuit Auditing

The circuit logic must be audited to ensure:
- No backdoors or hidden constraints
- Correct implementation of cryptographic primitives
- Proper nullifier computation (prevents double-spending)
- Binding hash prevents proof reuse

## Future Optimizations

### 1. PLONK/STARK Migration
- No trusted setup required
- Larger proofs but more flexible
- Universal setup (one ceremony for all circuits)

### 2. GPU Acceleration
- Use WebGPU for faster proof generation
- Could reduce proof time to <1 second
- Browser support still limited

### 3. Recursive Proofs
- Batch multiple withdrawals into one proof
- Reduces on-chain verification cost
- More complex circuit design

### 4. WASM Streaming
- Stream WASM file instead of loading all at once
- Faster initial load time
- Better for mobile devices

## Debugging

### Check WASM Loading

```javascript
// In browser console
console.log(await fetch('/circuits/withdrawal.wasm').then(r => r.ok))
// Should print: true
```

### Test Proof Generation

```javascript
// In browser console (on Withdraw page)
// This will generate a test proof
const { proof, publicSignals } = await generateProof({
  nullifier: "0x1234...",
  secret: "0x5678...",
  // ... other inputs
})
console.log("Proof generated:", proof)
```

### Common Issues

**"WASM file not found"**
- Check `app/public/circuits/` contains all 3 files
- Verify Vite is serving the public directory

**"Proof generation failed"**
- Check browser console for detailed error
- Verify all inputs are correct format (hex strings, proper length)
- Ensure WASM file matches the circuit version

**"Proof verification failed on-chain"**
- Public inputs mismatch (fee, recipient, etc.)
- Wrong verification key in Solana program
- Circuit version mismatch

## Resources

- [Circom Documentation](https://docs.circom.io/)
- [snarkjs Documentation](https://github.com/iden3/snarkjs)
- [Groth16 Paper](https://eprint.iacr.org/2016/260.pdf)
- [Tornado Cash Circuits](https://github.com/tornadocash/tornado-core) (similar design)

---

**Summary**: WASM enables fast, private, client-side ZK proof generation in the browser, which is the core of TRACE_ZERO's privacy guarantees.
