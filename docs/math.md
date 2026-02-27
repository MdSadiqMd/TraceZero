# Privacy-Proxy: Complete Mathematical Foundation

This document explains all the mathematics used in Privacy-Proxy, from credit purchase to fund withdrawal. Written in simple terms with complete formulas.

---

## Table of Contents

1. [Finite Fields and Curves](#1-finite-fields-and-curves)
2. [RSA Blind Signatures](#2-rsa-blind-signatures)
3. [Poseidon Hash Function](#3-poseidon-hash-function)
4. [Merkle Trees](#4-merkle-trees)
5. [Zero-Knowledge Proofs (Groth16)](#5-zero-knowledge-proofs-groth16)
6. [Stealth Addresses (ECDH)](#6-stealth-addresses-ecdh)
7. [Complete Transaction Flow](#7-complete-transaction-flow)

---

## 1. Finite Fields and Curves

### What is a Finite Field?

A finite field is a set of numbers where arithmetic "wraps around" at a certain value called the modulus.

**Example**: In a field with modulus 7:
```
5 + 4 = 9 mod 7 = 2
3 × 5 = 15 mod 7 = 1
```

### BN254 Curve (used in ZK proofs)

Privacy-Proxy uses the BN254 elliptic curve for zero-knowledge proofs.

**Field modulus (p)**:
```
p = 21888242871839275222246405745257275088548364400416034343698204186575808495617
```

This is approximately 2^254, which is why it's called BN254.

**Why this matters**: All values in our ZK circuits must be less than p. Solana public keys (32 bytes = 256 bits) can exceed this, so we reduce them:
```
reduced_value = value & 0x1FFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFFF
```
This clears the top 3 bits, ensuring the value fits in the BN254 field.

---

## 2. RSA Blind Signatures

Blind signatures allow the relayer to sign a token without seeing its value. This breaks the link between credit purchase and deposit.

### Key Generation

The relayer generates an RSA keypair:
```
1. Choose two large primes: p, q (each ~1024 bits)
2. Compute: n = p × q
3. Compute: φ(n) = (p-1) × (q-1)
4. Choose public exponent: e = 65537 (standard)
5. Compute private exponent: d = e^(-1) mod φ(n)

Public key: (n, e)
Private key: (n, d)
```

### Blinding (User Side)

User wants to get signature on token `m` without relayer seeing `m`:

```
1. Hash the token: h = SHA256(token_id)
2. Convert to number: m = bytes_to_bigint(h)
3. Generate random blinding factor: r (coprime to n)
4. Compute blinded message: m' = m × r^e mod n
5. Send m' to relayer
```

**Why it works**: The relayer sees `m'` which looks like random data. Without knowing `r`, they cannot recover `m`.

### Signing (Relayer Side)

Relayer signs the blinded message:
```
s' = (m')^d mod n
```

The relayer returns `s'` to the user.

### Unblinding (User Side)

User removes the blinding to get valid signature on original message:
```
s = s' × r^(-1) mod n
```

**Mathematical proof that this works**:
```
s = s' × r^(-1) mod n
  = (m')^d × r^(-1) mod n
  = (m × r^e)^d × r^(-1) mod n
  = m^d × r^(e×d) × r^(-1) mod n
  = m^d × r × r^(-1) mod n      (since r^(e×d) = r mod n)
  = m^d mod n
```

This is exactly the signature on the original message `m`!

### Verification

Anyone can verify the signature:
```
m' = s^e mod n
h' = SHA256(token_id)
Valid if: m' == bytes_to_bigint(h')
```

---

## 3. Poseidon Hash Function

Poseidon is a hash function designed for efficiency inside ZK circuits. It operates over the BN254 field.

### Why Not SHA256?

SHA256 uses bitwise operations (XOR, rotations) which are expensive in ZK circuits. Poseidon uses only field arithmetic (addition, multiplication) which is much cheaper.

**Constraint comparison**:
- SHA256: ~25,000 constraints per hash
- Poseidon: ~300 constraints per hash

### How Poseidon Works

Poseidon uses a sponge construction with:
1. **State**: Array of field elements
2. **Round function**: Applied multiple times
3. **S-box**: Non-linear operation (x^5 in BN254)

```
For inputs [x₁, x₂, ..., xₙ]:

1. Initialize state: [x₁, x₂, ..., xₙ, 0, 0, ...]
2. Apply full rounds (8 rounds):
   - Add round constants
   - Apply S-box to ALL elements: xᵢ → xᵢ^5
   - Mix with MDS matrix
3. Apply partial rounds (57 rounds):
   - Add round constants
   - Apply S-box to FIRST element only
   - Mix with MDS matrix
4. Apply full rounds (8 rounds)
5. Output: first element of final state
```

### Domain Separation

To prevent cross-protocol attacks, we prepend a domain tag to each hash:

```
DOMAIN_NULLIFIER = 1853189228  ("null" as u32)
DOMAIN_COMMIT    = 1668246637  ("comm" as u32)
DOMAIN_BIND      = 1651076196  ("bind" as u32)
```

**Usage**:
```
nullifierHash = Poseidon(DOMAIN_NULLIFIER, nullifier)
commitment = Poseidon(DOMAIN_COMMIT, nullifier, secret, amount)
bindingHash = Poseidon(DOMAIN_BIND, nullifierHash, recipient, relayer, fee)
```

---

## 4. Merkle Trees

A Merkle tree is a binary tree where each node is the hash of its children. It allows proving membership with O(log n) data.

### Tree Structure

```
                    Root
                   /    \
                 H₁      H₂
                /  \    /  \
              H₃   H₄  H₅   H₆
             / \  / \  / \  / \
            L₀ L₁ L₂ L₃ L₄ L₅ L₆ L₇
```

**Leaf computation**:
```
Lᵢ = commitment (if deposit exists at index i)
Lᵢ = ZERO_VALUE (if no deposit at index i)
```

**Node computation**:
```
Parent = Poseidon(left_child, right_child)
```

### Zero Values (Empty Nodes)

For efficiency, we precompute hashes of empty subtrees:

```
ZEROS[0] = 0  (empty leaf)
ZEROS[1] = Poseidon(ZEROS[0], ZEROS[0])
ZEROS[2] = Poseidon(ZEROS[1], ZEROS[1])
...
ZEROS[20] = Poseidon(ZEROS[19], ZEROS[19])
```

### Merkle Proof

To prove leaf `L` is at index `i` in a tree with root `R`:

**Proof data**:
- `pathElements[20]`: Sibling hashes at each level
- `pathIndices[20]`: Position at each level (0=left, 1=right)

**Verification algorithm**:
```
current = L
for level in 0..20:
    sibling = pathElements[level]
    if pathIndices[level] == 0:
        current = Poseidon(current, sibling)  // current is left child
    else:
        current = Poseidon(sibling, current)  // current is right child
        
Valid if: current == R
```

**Example** (depth 3, index 5 = binary 101):
```
Index 5 = 101 in binary
pathIndices = [1, 0, 1]  (read right to left)

Level 0: current is RIGHT child → Poseidon(sibling, current)
Level 1: current is LEFT child  → Poseidon(current, sibling)
Level 2: current is RIGHT child → Poseidon(sibling, current)
```

### Tree Size

With depth 20:
- Maximum leaves: 2^20 = 1,048,576 deposits per pool
- Proof size: 20 × 32 bytes = 640 bytes

---

## 5. Zero-Knowledge Proofs (Groth16)

Groth16 is a zkSNARK (Zero-Knowledge Succinct Non-Interactive Argument of Knowledge) that allows proving statements without revealing the witness.

### What We Prove

The withdrawal circuit proves:

> "I know a nullifier and secret such that:
> 1. commitment = Poseidon(DOMAIN_COMMIT, nullifier, secret, amount)
> 2. commitment is in the Merkle tree with the given root
> 3. nullifierHash = Poseidon(DOMAIN_NULLIFIER, nullifier)
> 4. fee < amount
> 5. bindingHash = Poseidon(DOMAIN_BIND, nullifierHash, recipient, relayer, fee)"

**Without revealing**: nullifier, secret, or which commitment in the tree.

### Circuit Constraints

The circuit is expressed as a system of equations (R1CS - Rank-1 Constraint System):

```
For each constraint: A × B = C

Where A, B, C are linear combinations of:
- Public inputs (known to verifier)
- Private inputs (known only to prover)
- Intermediate signals
```

**Example constraint** (checking pathIndices is binary):
```
pathIndices[i] × (1 - pathIndices[i]) = 0
```
This is satisfied only when pathIndices[i] ∈ {0, 1}.

### Groth16 Setup (Trusted Setup)

Before proofs can be generated, a one-time setup creates:

1. **Proving key (pk)**: Used by prover to generate proofs
2. **Verifying key (vk)**: Used by verifier to check proofs

The setup involves:
```
1. Generate random "toxic waste": τ, α, β, γ, δ
2. Compute elliptic curve points:
   - α·G₁, β·G₁, β·G₂, γ·G₂, δ·G₂
   - Powers of τ: τⁱ·G₁ for i = 0..n
   - Encoded constraints
3. Destroy toxic waste (if leaked, fake proofs possible)
```

### Proof Generation

Given witness (private inputs) and public inputs:

```
1. Compute all intermediate signals
2. Compute polynomials A(x), B(x), C(x) from constraints
3. Compute quotient: H(x) = (A(x)·B(x) - C(x)) / Z(x)
4. Generate random r, s for zero-knowledge
5. Compute proof elements:
   π_A = α + A(τ) + r·δ  (in G₁)
   π_B = β + B(τ) + s·δ  (in G₂)
   π_C = (A(τ)·B(τ) - C(τ))/δ + H(τ)·Z(τ)/δ + s·π_A + r·π_B - r·s·δ  (in G₁)
```

**Proof size**: 
- π_A: 64 bytes (G₁ point)
- π_B: 128 bytes (G₂ point)
- π_C: 64 bytes (G₁ point)
- Total: 256 bytes (constant, regardless of circuit size!)

### Proof Verification

The verifier checks a pairing equation:

```
e(π_A, π_B) = e(α, β) · e(vk_x, γ) · e(π_C, δ)
```

Where:
- `e(·,·)` is a bilinear pairing on BN254
- `vk_x = Σᵢ (public_inputᵢ · ICᵢ)` (linear combination of IC points)

**Pairing properties**:
```
e(a·G₁, b·G₂) = e(G₁, G₂)^(a·b)
e(A + B, C) = e(A, C) · e(B, C)
```

**Why it works**: The pairing equation is satisfied if and only if the prover knows a valid witness. The math ensures:
- Soundness: Can't create valid proof without valid witness
- Zero-knowledge: Proof reveals nothing about witness

### On-Chain Verification

Solana's groth16-solana library verifies proofs in ~200k compute units:

```rust
// Verification equation (with negated A for efficiency):
// e(-π_A, π_B) · e(π_C, δ) · e(vk_x, γ) · e(α, β) = 1

let vk = Groth16Verifyingkey {
    nr_pubinputs: 7,
    vk_alpha_g1: [...],  // α·G₁
    vk_beta_g2: [...],   // β·G₂
    vk_gamme_g2: [...],  // γ·G₂
    vk_delta_g2: [...],  // δ·G₂
    vk_ic: [...],        // IC points for public inputs
};

verifier.verify()?;  // Returns Ok(()) if valid
```

---

## 6. Stealth Addresses (ECDH)

Stealth addresses allow receiving funds at a one-time address that only the recipient can spend from.

### Key Generation

Recipient generates two keypairs:

```
Spend keypair (Ed25519):
  spend_private = random 32 bytes
  spend_public = spend_private × G  (Ed25519 base point)

View keypair (X25519):
  view_private = random 32 bytes
  view_public = view_private × G  (Curve25519 base point)
```

### Stealth Address Generation (Sender)

When sending funds:

```
1. Generate ephemeral X25519 keypair:
   eph_private = random 32 bytes
   eph_public = eph_private × G

2. Compute shared secret via ECDH:
   shared_secret = ECDH(eph_private, view_public)
                 = eph_private × view_public
                 = eph_private × view_private × G

3. Derive stealth address seed:
   seed = SHA256(shared_secret || spend_public)

4. Generate stealth keypair from seed:
   stealth_keypair = Ed25519_from_seed(seed)
   stealth_address = stealth_keypair.public_key

5. If stealth_address exceeds BN254 field:
   seed = SHA256(seed || attempt_counter)
   Repeat step 4 until valid
```

### Stealth Address Recovery (Recipient)

Recipient can compute the same stealth address:

```
1. Receive ephemeral public key (eph_public)

2. Compute shared secret:
   shared_secret = ECDH(view_private, eph_public)
                 = view_private × eph_public
                 = view_private × eph_private × G
                 = eph_private × view_private × G  (same as sender!)

3. Derive stealth address seed:
   seed = SHA256(shared_secret || spend_public)

4. Recover stealth keypair:
   stealth_keypair = Ed25519_from_seed(seed)
```

**Why it works**: ECDH produces the same shared secret for both parties:
```
Sender:   eph_private × view_public = eph_private × (view_private × G)
Recipient: view_private × eph_public = view_private × (eph_private × G)
Both equal: eph_private × view_private × G
```

### BN254 Compatibility

Solana public keys are 32 bytes (256 bits), but BN254 field is ~254 bits. We ensure compatibility:

```
Check: (public_key[0] & 0xE0) == 0

If top 3 bits are set, regenerate with modified seed.
This ensures the stealth address can be used in ZK circuits.
```

---

## 7. Complete Transaction Flow

### Phase 1: Credit Purchase

```
User:
  1. token_id = random(32 bytes)
  2. h = SHA256(token_id)
  3. m = bytes_to_bigint(h)
  4. r = random_coprime_to(n)
  5. m' = m × r^e mod n
  6. Send SOL payment + m' to relayer

Relayer:
  7. Verify payment on-chain
  8. s' = (m')^d mod n
  9. Return s' to user

User:
  10. s = s' × r^(-1) mod n
  11. Store (token_id, s)
```

### Phase 2: Deposit (via Tor)

```
User:
  1. nullifier = random(32 bytes, non-zero)
  2. secret = random(32 bytes, non-zero)
  3. commitment = Poseidon(DOMAIN_COMMIT, nullifier, secret, amount)
  4. Send (token_id, s, commitment) to relayer via Tor

Relayer:
  5. Verify: s^e mod n == SHA256(token_id)
  6. Check: token_id not already used
  7. Mark token_id as used
  8. Insert commitment into Merkle tree at index i
  9. Update root: new_root = recompute_root(commitment, i)
  10. Submit deposit transaction (relayer's funds)
  11. Return (tx_signature, leaf_index) to user

User:
  12. Store (nullifier, secret, leaf_index, amount)
```

### Phase 3: Withdrawal Request

```
User:
  1. Generate stealth address (see Section 6)
  2. Fetch Merkle proof from relayer:
     - pathElements[20]
     - pathIndices[20]
     - current_root
  
  3. Compute public inputs:
     nullifierHash = Poseidon(DOMAIN_NULLIFIER, nullifier)
     
  4. Generate ZK proof (in browser):
     Private inputs: nullifier, secret, pathElements, pathIndices
     Public inputs: root, nullifierHash, recipient, amount, relayer, fee
     
     Circuit verifies:
     a) commitment = Poseidon(DOMAIN_COMMIT, nullifier, secret, amount)
     b) Merkle proof is valid for commitment
     c) nullifierHash = Poseidon(DOMAIN_NULLIFIER, nullifier)
     d) fee < amount
     e) bindingHash = Poseidon(DOMAIN_BIND, nullifierHash, recipient, relayer, fee)
     
     Output: (π_A, π_B, π_C, bindingHash)
  
  5. Send proof to relayer via Tor

Relayer:
  6. Submit request_withdrawal transaction:
     - Verify ZK proof on-chain
     - Check nullifierHash not already used
     - Create PendingWithdrawal with timelock
```

### Phase 4: Withdrawal Execution

```
After timelock expires (1-24 hours):

Relayer (or anyone):
  1. Submit execute_withdrawal transaction:
     - Check timelock expired
     - Mark nullifier as spent
     - Transfer (amount - fee) from pool to stealth_address
     - Transfer fee to relayer_treasury
```

### Phase 5: Claim (Sweep)

```
User:
  1. Load stealth_keypair from storage
  2. Check balance at stealth_address
  3. Create transfer transaction:
     from: stealth_address
     to: destination_wallet
     amount: balance - tx_fee
  4. Sign with stealth_keypair.secret_key
  5. Submit transaction (plain SOL transfer, no ZK)
```

---

## Summary of Mathematical Components

| Component | Algorithm | Purpose |
|-----------|-----------|---------|
| Blind Signatures | RSA-2048 | Break link between payment and deposit |
| Commitment | Poseidon(4) | Hide deposit details |
| Nullifier Hash | Poseidon(2) | Prevent double-spend |
| Binding Hash | Poseidon(5) | Bind proof to specific values |
| Merkle Tree | Poseidon(2), depth 20 | Prove deposit membership |
| ZK Proof | Groth16 on BN254 | Prove knowledge without revealing |
| Stealth Address | X25519 ECDH + Ed25519 | One-time recipient address |

---

## Security Properties

1. **Unlinkability**: Blind signatures ensure credit purchase cannot be linked to deposit
2. **Anonymity**: ZK proof reveals nothing about which deposit is being withdrawn
3. **Double-spend prevention**: Nullifier hash is stored on-chain after withdrawal
4. **Front-running prevention**: Binding hash ties proof to specific recipient/relayer/fee
5. **Timing protection**: Random 1-24 hour delay prevents timing correlation
6. **Rent-exemption guarantee**: Relayer pre-funds accounts to ensure withdrawals never fail (v7)
7. **Performance optimization**: Smart transaction scanning prevents timeouts on devnet (v7.1)

---

## Performance Considerations

### Deposit Sync Optimization (v7.1)

When the relayer starts fresh, it must sync its local Merkle tree with on-chain state. The naive approach of scanning all transactions is too slow:

**Problem**:
```
For each transaction signature:
  1. Fetch full transaction data (RPC call)
  2. Parse logs for "Program log: Deposit: commitment=<hex>"
  3. Extract commitment if found

With 60+ transactions and pruned logs:
  - 60 RPC calls × ~300ms each = 18+ seconds
  - Logs often pruned on devnet = wasted time
  - Frontend times out after 120 seconds
```

**Solution**:
```
if transaction_count > 50:
  skip_scan()  // Logs likely pruned anyway
  continue_with_empty_tree()
else:
  scan_last_20_transactions()  // Recent logs more likely available
  
if no_commitments_found:
  continue_with_empty_tree()  // Don't block new deposits
```

**Result**:
- Deposit time: 2-3 seconds (down from 20+ seconds)
- New deposits always work immediately
- Old deposits may not be recoverable (acceptable for devnet testing)

### Withdrawal Rent-Exemption (v7)

Solana enforces rent-exemption post-transaction. Direct lamport manipulation requires accounts to end with ≥ rent-exempt minimum.

**Problem**:
```
Pool transfers 99,500,000 lamports to stealth address
Fee transfers 500,000 lamports to treasury

If stealth address doesn't exist:
  - Runtime creates it with 99,500,000 lamports
  - Rent-exempt minimum: 890,880 lamports
  - 99,500,000 > 890,880 ✓ (would work)

If treasury doesn't exist:
  - Runtime creates it with 500,000 lamports
  - Rent-exempt minimum: 890,880 lamports
  - 500,000 < 890,880 ✗ (FAILS with error 0x0)
```

**Solution**:
```
Before execute_withdrawal:
  1. Check if recipient exists
  2. If not, pre-fund with 890,880 lamports
  3. If exists but balance < 890,880, top up difference
  4. Same for treasury
  5. Wait 500ms for settlement
  6. Execute withdrawal (now guaranteed to succeed)

Final balances:
  - Recipient: 890,880 + 99,500,000 = 100,390,880 lamports ✓
  - Treasury: 890,880 + 500,000 = 1,390,880 lamports ✓
```

**Cost**:
- Relayer pays ~0.000005 SOL per pre-fund transaction
- Negligible compared to fee revenue (0.0005 SOL per withdrawal)

---

*Last updated: v7.1 (February 2026)*
