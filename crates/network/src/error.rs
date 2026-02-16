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

    #[error("I/O error: {0}")]
    Io(String),

    #[error("Tor not available")]
    TorNotAvailable,
}
