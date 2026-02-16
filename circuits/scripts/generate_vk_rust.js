#!/usr/bin/env node
/**
 * Generate Rust verifying key constants from snarkjs verification key JSON
 *
 * Usage: node generate_vk_rust.js
 *
 * Reads:
 *   - build/keys/withdrawal_verification_key.json
 *   - build/keys/ownership_verification_key.json
 *
 * Outputs:
 *   - Rust code to stdout (redirect to verifying_key.rs)
 */

const fs = require("fs");
const path = require("path");

const BUILD_DIR = path.join(__dirname, "..", "build", "keys");

/**
 * Convert a decimal string to a 32-byte big-endian hex array
 */
function decimalTo32Bytes(decimalStr) {
  let hex = BigInt(decimalStr).toString(16);
  // Pad to 64 hex chars (32 bytes)
  hex = hex.padStart(64, "0");
  const bytes = [];
  for (let i = 0; i < 64; i += 2) {
    bytes.push(parseInt(hex.substr(i, 2), 16));
  }
  return bytes;
}

/**
 * Convert G1 point [x, y, z] to 64 bytes (x || y in big-endian)
 * Note: z is always 1 for affine coordinates
 */
function g1ToBytes(point) {
  const x = decimalTo32Bytes(point[0]);
  const y = decimalTo32Bytes(point[1]);
  return [...x, ...y];
}

/**
 * Convert G2 point [[x0, x1], [y0, y1], [z0, z1]] to 128 bytes
 * Format: x1 || x0 || y1 || y0 (note the reversed order for Fq2 elements)
 * This matches the groth16-solana expected format
 */
function g2ToBytes(point) {
  const x0 = decimalTo32Bytes(point[0][0]);
  const x1 = decimalTo32Bytes(point[0][1]);
  const y0 = decimalTo32Bytes(point[1][0]);
  const y1 = decimalTo32Bytes(point[1][1]);
  // groth16-solana expects: x1, x0, y1, y0 (reversed within Fq2)
  return [...x1, ...x0, ...y1, ...y0];
}

/**
 * Format byte array as Rust constant
 */
function formatRustBytes(bytes, name, size) {
  const lines = [];
  lines.push(`pub const ${name}: [u8; ${size}] = [`);
  for (let i = 0; i < bytes.length; i += 16) {
    const chunk = bytes.slice(i, Math.min(i + 16, bytes.length));
    const hexStr = chunk
      .map((b) => "0x" + b.toString(16).padStart(2, "0"))
      .join(", ");
    lines.push(`    ${hexStr},`);
  }
  lines.push("];");
  return lines.join("\n");
}

/**
 * Generate Rust code for a single circuit's verifying key
 */
function generateCircuitVK(vk, prefix, description) {
  let output = "";

  output += `// ============================================================\n`;
  output += `// ${description}\n`;
  output += `// ============================================================\n\n`;

  // Alpha G1 (64 bytes)
  const alphaG1 = g1ToBytes(vk.vk_alpha_1);
  output += formatRustBytes(alphaG1, `${prefix}_ALPHA_G1`, 64) + "\n\n";

  // Beta G2 (128 bytes)
  const betaG2 = g2ToBytes(vk.vk_beta_2);
  output += formatRustBytes(betaG2, `${prefix}_BETA_G2`, 128) + "\n\n";

  // Gamma G2 (128 bytes)
  const gammaG2 = g2ToBytes(vk.vk_gamma_2);
  output += formatRustBytes(gammaG2, `${prefix}_GAMMA_G2`, 128) + "\n\n";

  // Delta G2 (128 bytes)
  const deltaG2 = g2ToBytes(vk.vk_delta_2);
  output += formatRustBytes(deltaG2, `${prefix}_DELTA_G2`, 128) + "\n\n";

  // IC points
  output += `/// ${prefix} IC points (${vk.IC.length} points for ${vk.nPublic} public inputs)\n`;
  for (let i = 0; i < vk.IC.length; i++) {
    const ic = g1ToBytes(vk.IC[i]);
    output += formatRustBytes(ic, `${prefix}_IC_${i}`, 64) + "\n\n";
  }

  // Helper function
  output += `pub fn get_${prefix.toLowerCase()}_ic_points() -> &'static [[u8; 64]] {\n`;
  output += `    &[${vk.IC.map((_, i) => `${prefix}_IC_${i}`).join(", ")}]\n`;
  output += `}\n\n`;

  return output;
}

// Main
function main() {
  let output = `//! Auto-generated verifying keys for privacy-proxy circuits
//! Generated from circuits/build/keys/*_verification_key.json
//!
//! SECURITY: These are REAL verifying keys from the trusted setup.
//! DO NOT EDIT MANUALLY - regenerate using: node circuits/scripts/generate_vk_rust.js
//!
//! Withdrawal circuit: 6 public inputs + 1 output (bindingHash) = 7 IC points
//! Ownership circuit: 2 public inputs + 1 output (bindingHash) = 3 IC points
//!
//! To regenerate:
//!   cd circuits
//!   ./scripts/compile.sh
//!   ./scripts/setup.sh withdrawal 14
//!   ./scripts/setup.sh ownership 12
//!   node scripts/generate_vk_rust.js > ../programs/privacy_proxy/programs/zk_verifier/src/verifying_key.rs

`;

  // Load withdrawal VK
  const withdrawalVkPath = path.join(
    BUILD_DIR,
    "withdrawal_verification_key.json",
  );
  if (fs.existsSync(withdrawalVkPath)) {
    const withdrawalVk = JSON.parse(fs.readFileSync(withdrawalVkPath, "utf8"));
    output += generateCircuitVK(
      withdrawalVk,
      "WITHDRAWAL",
      `WITHDRAWAL CIRCUIT VERIFYING KEY\n// ${withdrawalVk.nPublic} public inputs, ${withdrawalVk.IC.length} IC points`,
    );
  } else {
    console.error(`Warning: ${withdrawalVkPath} not found`);
  }

  // Load ownership VK
  const ownershipVkPath = path.join(
    BUILD_DIR,
    "ownership_verification_key.json",
  );
  if (fs.existsSync(ownershipVkPath)) {
    const ownershipVk = JSON.parse(fs.readFileSync(ownershipVkPath, "utf8"));
    output += generateCircuitVK(
      ownershipVk,
      "OWNERSHIP",
      `OWNERSHIP CIRCUIT VERIFYING KEY\n// ${ownershipVk.nPublic} public inputs, ${ownershipVk.IC.length} IC points`,
    );
  } else {
    console.error(`Warning: ${ownershipVkPath} not found`);
  }

  console.log(output);
}

main();
