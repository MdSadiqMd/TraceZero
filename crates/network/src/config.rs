pub const DEFAULT_TOR_SOCKS_ADDR: &str = "127.0.0.1:9050";
pub const DEFAULT_HTTP_GATEWAY_ADDR: &str = "127.0.0.1:3080";

#[derive(Clone, Debug)]
pub struct Config {
    pub socks_addr: String,
    pub http_gateway_addr: String,
    pub timeout_secs: u64,
    pub verify_tls: bool,
}

impl Default for Config {
    fn default() -> Self {
        Self {
            socks_addr: DEFAULT_TOR_SOCKS_ADDR.to_string(),
            http_gateway_addr: DEFAULT_HTTP_GATEWAY_ADDR.to_string(),
            timeout_secs: 60,
            verify_tls: true,
        }
    }
}

impl Config {
    pub fn with_socks_addr(mut self, addr: &str) -> Self {
        self.socks_addr = addr.to_string();
        self
    }

    pub fn with_http_gateway_addr(mut self, addr: &str) -> Self {
        self.http_gateway_addr = addr.to_string();
        self
    }

    pub fn with_timeout(mut self, secs: u64) -> Self {
        self.timeout_secs = secs;
        self
    }

    pub fn without_tls_verification(mut self) -> Self {
        self.verify_tls = false;
        self
    }
}
