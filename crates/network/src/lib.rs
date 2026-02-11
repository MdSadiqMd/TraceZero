//! This crate provides SOCKS5 and HTTP clients that route all traffic, through the Tor network for complete anonymity.
//!
//! ```rust,no_run
//! use tracezero::{Config, TorHttpClient};
//!
//! #[tokio::main]
//! async fn main() -> tracezero::Result<()> {
//!     let config = Config::default();
//!     let client = TorHttpClient::new(config)?;
//!     
//!     // All requests go through Tor
//!     let ip = client.get_exit_ip().await?;
//!     println!("Tor exit IP: {}", ip);
//!     
//!     Ok(())
//! }
//! ```

pub mod config;
pub mod error;
pub mod http_client;
pub mod socks_client;

pub use config::{Config, DEFAULT_HTTP_GATEWAY_ADDR, DEFAULT_TOR_SOCKS_ADDR};
pub use error::{Result, TraceZeroError};
pub use http_client::TorHttpClient;
pub use socks_client::SocksClient;

pub fn tor_client() -> Result<TorHttpClient> {
    TorHttpClient::new(Config::default())
}

// no tor func, just for testing
#[cfg(any(test, feature = "test-utils"))]
pub fn direct_client() -> Result<TorHttpClient> {
    TorHttpClient::new_direct()
}
