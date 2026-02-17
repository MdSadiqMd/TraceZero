use thiserror::Error;

pub type Result<T> = std::result::Result<T, SdkError>;

#[derive(Error, Debug)]
pub enum SdkError {
    #[error("Cryptographic error: {0}")]
    Crypto(String),

    #[error("Serialization error: {0}")]
    Serialization(String),

    #[error("Network error: {0}")]
    Network(#[from] tracezero::TraceZeroError),

    #[error("Relayer error: {0}")]
    Relayer(String),

    #[error("Merkle tree error: {0}")]
    MerkleTree(String),

    #[error("Invalid proof: {0}")]
    InvalidProof(String),

    #[error("Tor connection required: {0}")]
    TorRequired(String),

    #[error("Invalid input: {0}")]
    InvalidInput(String),
}
