// ZK utilities barrel export
export {
  generateWithdrawalProof,
  verifyProof,
  formatProofForSolana,
  formatPublicInputsForSolana,
  type WithdrawalProofInput,
  type Groth16Proof,
  type ProofResult,
} from "./prover";

export {
  generateWithdrawalWitness,
  generateOwnershipWitness,
  validateWithdrawalWitness,
  type WithdrawalWitness,
  type OwnershipWitness,
  type DepositNote,
  type MerkleProof,
} from "./witness";
