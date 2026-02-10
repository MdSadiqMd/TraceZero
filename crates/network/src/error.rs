use thiserror::Error;

pub type Result<T> = std::result::Result<T, TraceZeroError>;

#[derive(Error, Debug)]
pub enum TraceZeroError {
    #[error("Configuration error: {0}")]
    Config(String),
    #[error("Connection error: {0}")]
    Connection(String),
    #[error("HTTP error: {0}")]
    Http(String),
    #[error("IO error: {0}")]
    Io(String),
    #[error("Tor proxy not available at {0}")]
    TorUnavailable(String),
    #[error("Request timeout after {0} seconds")]
    Timeout(u64),
}
