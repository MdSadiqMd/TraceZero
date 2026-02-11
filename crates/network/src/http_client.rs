use std::time::Duration;
use reqwest::{Client, Proxy, Response};
use serde::de::DeserializeOwned;
use serde::Serialize;

use crate::config::Config;
use crate::error::{Result, TraceZeroError};

pub struct TorHttpClient {
    client: Client,
    config: Config,
}

impl TorHttpClient {
    pub fn new(config: Config) -> Result<Self> {
        let proxy_url = format!("socks5h://{}", config.socks_addr);
        let proxy = Proxy::all(&proxy_url)
            .map_err(|e| TraceZeroError::Config(format!("Invalid proxy URL: {}", e)))?;

        let mut builder = Client::builder()
            .proxy(proxy)
            .timeout(Duration::from_secs(config.timeout_secs));

        if !config.verify_tls {
            builder = builder.danger_accept_invalid_certs(true);
        }

        let client = builder
            .build()
            .map_err(|e| TraceZeroError::Config(format!("Failed to build client: {}", e)))?;

        Ok(Self { client, config })
    }

    #[cfg(any(test, feature = "test-utils"))]
    pub fn new_direct() -> Result<Self> {
        let client = Client::builder()
            .build()
            .map_err(|e| TraceZeroError::Config(format!("Failed to build client: {}", e)))?;

        Ok(Self {
            client,
            config: Config::default(),
        })
    }

    pub async fn get(&self, url: &str) -> Result<Response> {
        self.client
            .get(url)
            .send()
            .await
            .map_err(|e| TraceZeroError::Http(format!("GET request failed: {}", e)))
    }

    pub async fn get_json<T: DeserializeOwned>(&self, url: &str) -> Result<T> {
        let response = self.get(url).await?;
        response
            .json()
            .await
            .map_err(|e| TraceZeroError::Http(format!("JSON parse failed: {}", e)))
    }

    pub async fn post<T: Serialize>(&self, url: &str, body: &T) -> Result<Response> {
        self.client
            .post(url)
            .json(body)
            .send()
            .await
            .map_err(|e| TraceZeroError::Http(format!("POST request failed: {}", e)))
    }

    pub async fn post_json<T: Serialize, R: DeserializeOwned>(&self, url: &str, body: &T) -> Result<R> {
        let response = self.post(url, body).await?;
        response
            .json()
            .await
            .map_err(|e| TraceZeroError::Http(format!("JSON parse failed: {}", e)))
    }

    pub async fn get_exit_ip(&self) -> Result<String> {
        let response = self.get("https://api.ipify.org").await?;
        response
            .text()
            .await
            .map_err(|e| TraceZeroError::Http(format!("Failed to get IP: {}", e)))
    }

    pub async fn verify_tor_connection(&self) -> Result<bool> {
        let response = self.get("https://check.torproject.org/api/ip").await?;
        let json: serde_json::Value = response
            .json()
            .await
            .map_err(|e| TraceZeroError::Http(format!("JSON parse failed: {}", e)))?;

        Ok(json.get("IsTor").and_then(|v| v.as_bool()).unwrap_or(false))
    }

    pub fn config(&self) -> &Config {
        &self.config
    }
}
