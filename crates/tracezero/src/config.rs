use serde::{Deserialize, Serialize};

pub const DEFAULT_TOR_SOCKS_ADDR: &str = "127.0.0.1:9050";
pub const DEFAULT_HTTP_GATEWAY_ADDR: &str = "127.0.0.1:3080";

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Config {
    pub socks_addr: String,
    pub timeout_secs: u64,
    pub verify_tls: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            socks_addr: DEFAULT_TOR_SOCKS_ADDR.to_string(),
            timeout_secs: 30,
            verify_tls: true,
        }
    }
}

impl Config {
    pub fn with_socks_addr(mut self, addr: impl Into<String>) -> Self {
        self.socks_addr = addr.into();
        self
    }

    pub fn with_timeout(mut self, secs: u64) -> Self {
        self.timeout_secs = secs;
        self
    }

    pub fn without_tls_verify(mut self) -> Self {
        self.verify_tls = false;
        self
    }
}
