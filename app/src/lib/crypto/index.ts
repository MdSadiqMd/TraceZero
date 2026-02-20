// Crypto utilities barrel export
export {
  poseidonHash,
  poseidonHashWithDomain,
  generateCommitment,
  generateNullifierHash,
  generateWithdrawalBindingHash,
  generateOwnershipBindingHash,
  bytesToBigInt,
  bigIntToBytes,
  randomSecret,
  randomBytes,
  DOMAIN_NULLIFIER,
  DOMAIN_COMMIT,
  DOMAIN_BIND,
  DOMAIN_OWNER_BIND,
} from "./poseidon";

export {
  encryptPayload,
  decryptPayload,
  deriveSharedSecret,
  generateX25519KeyPair,
  exportPublicKey,
  importPublicKey,
  type EncryptedPayload,
} from "./encryption";
