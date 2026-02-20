use std::sync::Arc;
use tracing::info;
use tracing::warn;
use tracing_subscriber::{layer::SubscriberExt, util::SubscriberInitExt};

mod blind_signer;
mod config;
mod deposit;
mod encryption;
mod error;
mod merkle_service;
mod server;
mod withdrawal;

use config::RelayerConfig;
use server::RelayerState;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    tracing_subscriber::registry()
        .with(
            tracing_subscriber::EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| "relayer=info,tower_http=debug".into()),
        )
        .with(tracing_subscriber::fmt::layer())
        .init();

    info!("Starting Privacy-Proxy Relayer");

    dotenvy::dotenv().ok();
    let config = RelayerConfig::from_env()?;

    info!("RPC endpoint: {}", config.rpc_url);
    info!("Listening on: {}:{}", config.host, config.port);

    let state = Arc::new(RelayerState::new(config).await?);
    let poll_state = state.clone();
    tokio::spawn(async move {
        let mut interval = tokio::time::interval(tokio::time::Duration::from_secs(30));
        loop {
            interval.tick().await;
            let results = poll_state.withdrawal_service.poll_and_execute().await;
            for (recipient, result) in &results {
                match result {
                    Ok(tx) => info!("✓ Auto-executed withdrawal to {}: {}", recipient, tx),
                    Err(e) => warn!("✗ Failed auto-execute to {}: {}", recipient, e),
                }
            }
        }
    });

    server::run(state).await?;
    Ok(())
}
