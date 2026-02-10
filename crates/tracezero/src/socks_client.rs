use std::net::SocketAddr;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;
use tokio_socks::tcp::Socks5Stream;

use crate::config::Config;
use crate::error::{Result, TraceZeroError};

pub struct SocksClient {
    config: Config,
}

impl SocksClient {
    pub fn new(config: Config) -> Self {
        Self { config }
    }

    pub async fn connect(&self, target_host: &str, target_port: u16) -> Result<Socks5Stream<TcpStream>> {
        let proxy_addr: SocketAddr = self
            .config
            .socks_addr
            .parse()
            .map_err(|e| TraceZeroError::Config(format!("Invalid SOCKS address: {}", e)))?;

        let stream = Socks5Stream::connect(proxy_addr, (target_host, target_port))
            .await
            .map_err(|e| TraceZeroError::Connection(format!("SOCKS5 connection failed: {}", e)))?;

        Ok(stream)
    }

    pub async fn send_receive(&self, target_host: &str, target_port: u16, data: &[u8]) -> Result<Vec<u8>> {
        let mut stream = self.connect(target_host, target_port).await?;

        stream
            .write_all(data)
            .await
            .map_err(|e| TraceZeroError::Io(e.to_string()))?;

        let mut response = Vec::new();
        stream
            .read_to_end(&mut response)
            .await
            .map_err(|e| TraceZeroError::Io(e.to_string()))?;

        Ok(response)
    }

    pub async fn check_connection(&self) -> Result<bool> {
        let proxy_addr: SocketAddr = self
            .config
            .socks_addr
            .parse()
            .map_err(|e| TraceZeroError::Config(format!("Invalid SOCKS address: {}", e)))?;

        match TcpStream::connect(proxy_addr).await {
            Ok(_) => Ok(true),
            Err(_) => Ok(false),
        }
    }
}
