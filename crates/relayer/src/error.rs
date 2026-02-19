use axum::{
    http::StatusCode,
    response::{IntoResponse, Response},
    Json,
};
use serde_json::json;
use thiserror::Error;

pub type Result<T> = std::result::Result<T, RelayerError>;

#[derive(Error, Debug)]
pub enum RelayerError {
    #[error("Invalid blinded token")]
    InvalidBlindedToken,

    #[error("Invalid signature")]
    InvalidSignature,

    #[error("Token already redeemed")]
    TokenAlreadyRedeemed,

    #[error("Invalid bucket amount: {0}")]
    InvalidBucket(u64),

    #[error("Invalid request: {0}")]
    InvalidRequest(String),

    #[error("Merkle tree error: {0}")]
    MerkleTree(String),

    #[error("Transaction failed: {0}")]
    TransactionFailed(String),

    #[error("Cryptographic error: {0}")]
    Crypto(String),

    #[error("Internal error: {0}")]
    Internal(String),

    #[error("Solana client error: {0}")]
    SolanaClient(#[from] solana_client::client_error::ClientError),
}

impl IntoResponse for RelayerError {
    fn into_response(self) -> Response {
        let (status, message) = match &self {
            RelayerError::InvalidBlindedToken => (StatusCode::BAD_REQUEST, self.to_string()),
            RelayerError::InvalidSignature => (StatusCode::UNAUTHORIZED, self.to_string()),
            RelayerError::TokenAlreadyRedeemed => (StatusCode::CONFLICT, self.to_string()),
            RelayerError::InvalidBucket(_) => (StatusCode::BAD_REQUEST, self.to_string()),
            RelayerError::InvalidRequest(_) => (StatusCode::BAD_REQUEST, self.to_string()),
            RelayerError::MerkleTree(_) => (StatusCode::INTERNAL_SERVER_ERROR, self.to_string()),
            RelayerError::TransactionFailed(_) => {
                (StatusCode::INTERNAL_SERVER_ERROR, self.to_string())
            }
            RelayerError::Crypto(_) => (StatusCode::INTERNAL_SERVER_ERROR, self.to_string()),
            RelayerError::Internal(_) => (StatusCode::INTERNAL_SERVER_ERROR, self.to_string()),
            RelayerError::SolanaClient(_) => (StatusCode::INTERNAL_SERVER_ERROR, self.to_string()),
        };

        let body = Json(json!({
            "success": false,
            "error": message,
        }));

        (status, body).into_response()
    }
}
