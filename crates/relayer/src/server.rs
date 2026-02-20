use aes_gcm::{
    aead::{Aead, KeyInit},
    Aes256Gcm, Nonce,
};
use axum::{
    extract::State,
    routing::{get, post},
    Json, Router,
};
use serde::{Deserialize, Serialize};
use solana_client::nonblocking::rpc_client::RpcClient;
use solana_sdk::signer::Signer;
// use solana_transaction_status::UiTransactionEncoding;
use rand::rngs::OsRng;
use std::sync::Arc;
use tower_governor::{governor::GovernorConfigBuilder, GovernorLayer};
use tower_http::{cors::CorsLayer, trace::TraceLayer};
use tracing::info;
use x25519_dalek::{PublicKey as X25519PublicKey, StaticSecret};

use crate::blind_signer::BlindSignerService;
use crate::config::{calculate_total_with_fee, get_bucket_id, RelayerConfig, BUCKET_AMOUNTS};
use crate::deposit::DepositService;
use crate::error::RelayerError;
use crate::merkle_service::MerkleService;
use crate::withdrawal::WithdrawalService;

use privacy_proxy_sdk::deposit::{DepositRequest, DepositResponse};
use privacy_proxy_sdk::withdrawal::{WithdrawalRequest, WithdrawalResponse};

/// Encrypted deposit payload (ECDH + AES-256-GCM)
#[derive(Deserialize, Debug)]
struct DepositPayload {
    #[allow(dead_code)]
    encrypted: bool,
    ciphertext: Vec<u8>,
    nonce: Vec<u8>,
    /// Client's ephemeral public key for ECDH (hex encoded)
    client_pubkey: String,
}

#[derive(Deserialize, Debug)]
struct PlainDepositRequest {
    credit: CreditData,
    commitment: Vec<u8>,
    encrypted_note: Option<Vec<u8>>,
}

#[derive(Deserialize, Debug)]
struct CreditData {
    token_id: Vec<u8>,
    signature: Vec<u8>,
    amount: u64,
}

pub struct RelayerState {
    pub config: RelayerConfig,
    pub rpc_client: Arc<RpcClient>,
    pub blind_signer: Arc<BlindSignerService>,
    pub merkle_service: Arc<MerkleService>,
    pub deposit_service: Arc<DepositService>,
    pub withdrawal_service: Arc<WithdrawalService>,
    /// X25519 keypair for ECDH key exchange (payload encryption)
    pub ecdh_secret: StaticSecret,
    pub ecdh_pubkey: X25519PublicKey,
}

impl RelayerState {
    pub async fn new(config: RelayerConfig) -> anyhow::Result<Self> {
        let rpc_client = Arc::new(RpcClient::new(config.rpc_url.clone()));
        let blind_signer = Arc::new(BlindSignerService::new(config.rsa_key_bits)?);
        let merkle_service = Arc::new(MerkleService::new());

        for bucket_id in 0..BUCKET_AMOUNTS.len() as u8 {
            merkle_service.init_tree(bucket_id).await?;
        }

        let deposit_service = Arc::new(DepositService::new(
            config.clone(),
            rpc_client.clone(),
            blind_signer.clone(),
            merkle_service.clone(),
        ));

        let withdrawal_service = Arc::new(WithdrawalService::new(
            config.clone(),
            rpc_client.clone(),
            merkle_service.clone(),
        ));

        // Generate X25519 keypair for ECDH
        let ecdh_secret = StaticSecret::random_from_rng(OsRng);
        let ecdh_pubkey = X25519PublicKey::from(&ecdh_secret);
        info!("Generated X25519 keypair for ECDH key exchange");

        Ok(Self {
            config,
            rpc_client,
            blind_signer,
            merkle_service,
            deposit_service,
            withdrawal_service,
            ecdh_secret,
            ecdh_pubkey,
        })
    }
}

pub async fn run(state: Arc<RelayerState>) -> anyhow::Result<()> {
    // 10 requests per second per IP
    // Use SmartIpKeyExtractor which handles both direct connections and proxied requests
    let governor_conf = GovernorConfigBuilder::default()
        .per_second(10)
        .burst_size(20)
        .key_extractor(tower_governor::key_extractor::SmartIpKeyExtractor)
        .finish()
        .unwrap();

    let app = Router::new()
        // Health check (no rate limit)
        .route("/health", get(health))
        // Relayer info (public key, fees, etc.)
        .route("/info", get(get_info))
        // Blind signature signing
        .route("/sign", post(sign_blinded))
        // Deposit (via Tor)
        .route("/deposit", post(handle_deposit))
        // Withdrawal request
        .route("/withdraw", post(handle_withdrawal))
        // Execute pending withdrawal
        .route("/withdraw/execute", post(execute_withdrawal))
        // List pending withdrawals
        .route("/withdraw/pending", get(get_pending_withdrawals))
        // Pool status
        .route("/pools", get(get_pools))
        .route("/pools/:bucket_id", get(get_pool))
        // Merkle proof
        .route("/proof/:bucket_id/:leaf_index", get(get_proof))
        // Debug: Get commitment at leaf index
        .route("/commitment/:bucket_id/:leaf_index", get(get_commitment))
        .layer(GovernorLayer {
            config: Arc::new(governor_conf),
        })
        .layer(TraceLayer::new_for_http())
        .layer(CorsLayer::permissive())
        .with_state(state.clone());

    let addr = format!("{}:{}", state.config.host, state.config.port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    info!(
        "Relayer listening on {} (rate limited: 10 req/s per IP)",
        addr
    );

    axum::serve(
        listener,
        app.into_make_service_with_connect_info::<std::net::SocketAddr>(), // for providing ConnectInfo for rate limiting
    )
    .await?;
    Ok(())
}

#[derive(Serialize)]
struct HealthResponse {
    status: &'static str,
    version: &'static str,
}

#[derive(Serialize)]
struct InfoResponse {
    /// RSA public key N component (hex)
    pub_key_n: String,
    /// RSA public key E component (hex)
    pub_key_e: String,
    /// X25519 public key for ECDH (hex)
    ecdh_pubkey: String,
    /// Relayer's Solana pubkey (base58)
    solana_pubkey: String,
    /// Fee in basis points
    fee_bps: u16,
    /// Available bucket amounts
    buckets: Vec<BucketInfo>,
}

#[derive(Serialize)]
struct BucketInfo {
    id: u8,
    amount_lamports: u64,
    amount_sol: f64,
    total_with_fee: u64,
}

#[derive(Deserialize)]
struct SignRequest {
    /// Blinded token (hex encoded)
    blinded_token: String,
    /// Amount in lamports
    amount: u64,
    /// Payment transaction signature (base58 encoded)
    payment_tx: String,
    /// Payer's public key (base58 encoded)
    payer: String,
}

#[derive(Serialize)]
struct SignResponse {
    success: bool,
    /// Blinded signature (hex encoded)
    signature: Option<String>,
    error: Option<String>,
}

#[derive(Deserialize)]
struct WithdrawalRequestWrapper {
    request: WithdrawalRequest,
    delay_hours: u8,
}

#[derive(Deserialize)]
struct ExecuteWithdrawalRequest {
    /// Nullifier hash (hex encoded)
    nullifier_hash: String,
}

#[derive(Serialize)]
struct PoolsResponse {
    pools: Vec<PoolStatus>,
}

#[derive(Serialize)]
struct PoolStatus {
    bucket_id: u8,
    amount_lamports: u64,
    amount_sol: f64,
    tree_size: usize,
    merkle_root: String,
}

#[derive(Serialize)]
struct ProofResponse {
    success: bool,
    siblings: Option<Vec<String>>,
    path_indices: Option<Vec<u8>>,
    leaf_index: Option<u64>,
    error: Option<String>,
}

async fn health() -> Json<HealthResponse> {
    Json(HealthResponse {
        status: "ok",
        version: env!("CARGO_PKG_VERSION"),
    })
}

async fn get_info(State(state): State<Arc<RelayerState>>) -> Json<InfoResponse> {
    tracing::debug!("get_info called");
    let pub_key_n = hex::encode(state.blind_signer.public_key_n_bytes().await);
    tracing::debug!("got pub_key_n: {} bytes", pub_key_n.len());
    let pub_key_e = hex::encode(state.blind_signer.public_key_e_bytes().await);
    tracing::debug!("got pub_key_e: {} bytes", pub_key_e.len());
    let ecdh_pubkey = hex::encode(state.ecdh_pubkey.as_bytes());
    tracing::debug!("got ecdh_pubkey: {} bytes", ecdh_pubkey.len());
    let solana_pubkey = state.config.keypair.pubkey().to_string();
    tracing::debug!("got solana_pubkey: {}", solana_pubkey);

    let buckets: Vec<BucketInfo> = BUCKET_AMOUNTS
        .iter()
        .enumerate()
        .map(|(id, &amount)| BucketInfo {
            id: id as u8,
            amount_lamports: amount,
            amount_sol: amount as f64 / 1_000_000_000.0,
            total_with_fee: calculate_total_with_fee(amount, state.config.fee_bps),
        })
        .collect();

    Json(InfoResponse {
        pub_key_n,
        pub_key_e,
        ecdh_pubkey,
        solana_pubkey,
        fee_bps: state.config.fee_bps,
        buckets,
    })
}

async fn sign_blinded(
    State(state): State<Arc<RelayerState>>,
    Json(req): Json<SignRequest>,
) -> std::result::Result<Json<SignResponse>, RelayerError> {
    use solana_sdk::signature::Signature;
    use std::str::FromStr;

    if get_bucket_id(req.amount).is_none() {
        return Err(RelayerError::InvalidBucket(req.amount));
    }

    // Calculate expected payment (amount + fee)
    let expected_payment = calculate_total_with_fee(req.amount, state.config.fee_bps);

    // Parse payment transaction signature
    let payment_sig = Signature::from_str(&req.payment_tx).map_err(|_| {
        RelayerError::InvalidRequest("Invalid payment transaction signature".into())
    })?;

    // Parse payer pubkey
    let payer_pubkey = solana_sdk::pubkey::Pubkey::from_str(&req.payer)
        .map_err(|_| RelayerError::InvalidRequest("Invalid payer public key".into()))?;

    // Verify payment on-chain
    let relayer_pubkey = state.config.keypair.pubkey();

    // Fetch transaction with retries (devnet can be slow)
    let mut tx_result = None;
    for attempt in 0..10 {
        match state
            .rpc_client
            .get_transaction(
                &payment_sig,
                solana_transaction_status::UiTransactionEncoding::Json,
            )
            .await
        {
            Ok(tx) => {
                tx_result = Some(tx);
                break;
            }
            Err(e) => {
                if attempt < 9 {
                    info!(
                        "Payment tx not found yet (attempt {}), retrying in 2s...",
                        attempt + 1
                    );
                    tokio::time::sleep(tokio::time::Duration::from_millis(2000)).await;
                } else {
                    return Err(RelayerError::InvalidRequest(format!(
                        "Payment transaction not found: {}. Make sure it's confirmed.",
                        e
                    )));
                }
            }
        }
    }

    let tx_info = tx_result.unwrap();
    if let Some(meta) = &tx_info.transaction.meta {
        if meta.err.is_some() {
            return Err(RelayerError::InvalidRequest(
                "Payment transaction failed".into(),
            ));
        }
    }

    // Extract and verify the transfer
    // We need to check that:
    // 1. The payer sent SOL to the relayer
    // 2. The amount is at least expected_payment
    let mut payment_verified = false;
    if let Some(meta) = &tx_info.transaction.meta {
        let pre_balances: &Vec<u64> = &meta.pre_balances;
        let post_balances: &Vec<u64> = &meta.post_balances;

        if let solana_transaction_status::EncodedTransaction::Json(ui_tx) =
            &tx_info.transaction.transaction
        {
            // Extract account keys based on message type
            let account_keys: Vec<solana_sdk::pubkey::Pubkey> = match &ui_tx.message {
                solana_transaction_status::UiMessage::Parsed(parsed) => parsed
                    .account_keys
                    .iter()
                    .filter_map(|k| solana_sdk::pubkey::Pubkey::from_str(&k.pubkey).ok())
                    .collect(),
                solana_transaction_status::UiMessage::Raw(raw) => raw
                    .account_keys
                    .iter()
                    .filter_map(|k| solana_sdk::pubkey::Pubkey::from_str(k).ok())
                    .collect(),
            };

            // Find relayer's account index
            if let Some(relayer_idx) = account_keys.iter().position(|k| *k == relayer_pubkey) {
                // Find payer's account index
                if let Some(_payer_idx) = account_keys.iter().position(|k| *k == payer_pubkey) {
                    // Check that relayer received funds and payer sent funds
                    let relayer_pre: u64 = pre_balances[relayer_idx];
                    let relayer_post: u64 = post_balances[relayer_idx];
                    let relayer_received = relayer_post.saturating_sub(relayer_pre);

                    // Payer sent includes tx fee, so we check relayer received
                    if relayer_received >= expected_payment {
                        payment_verified = true;
                        info!(
                            "Payment verified: {} lamports from {} (expected {})",
                            relayer_received, payer_pubkey, expected_payment
                        );
                    } else {
                        return Err(RelayerError::InvalidRequest(format!(
                            "Insufficient payment: received {} lamports, expected {}",
                            relayer_received, expected_payment
                        )));
                    }
                }
            }
        }
    }

    if !payment_verified {
        return Err(RelayerError::InvalidRequest(
            "Could not verify payment. Ensure you sent SOL to the relayer.".into(),
        ));
    }

    let blinded_token =
        hex::decode(&req.blinded_token).map_err(|_| RelayerError::InvalidBlindedToken)?;
    let signature = state.blind_signer.sign_blinded(&blinded_token).await?;
    info!(
        "Signed blinded token after verifying payment of {} lamports",
        expected_payment
    );

    Ok(Json(SignResponse {
        success: true,
        signature: Some(hex::encode(signature)),
        error: None,
    }))
}

async fn handle_deposit(
    State(state): State<Arc<RelayerState>>,
    Json(payload): Json<DepositPayload>,
) -> std::result::Result<Json<DepositResponse>, RelayerError> {
    let client_pk_bytes = hex::decode(&payload.client_pubkey)
        .map_err(|_| RelayerError::InvalidRequest("Invalid client public key".into()))?;
    if client_pk_bytes.len() != 32 {
        return Err(RelayerError::InvalidRequest(
            "Client public key must be 32 bytes".into(),
        ));
    }

    let mut pk_array = [0u8; 32];
    pk_array.copy_from_slice(&client_pk_bytes);
    let client_pubkey = X25519PublicKey::from(pk_array);

    // Derive shared secret
    let shared_secret = state.ecdh_secret.diffie_hellman(&client_pubkey);

    // Decrypt with AES-256-GCM
    if payload.nonce.len() != 12 {
        return Err(RelayerError::InvalidRequest(
            "Nonce must be 12 bytes".into(),
        ));
    }

    let cipher = Aes256Gcm::new_from_slice(shared_secret.as_bytes())
        .map_err(|_| RelayerError::Internal("Failed to create cipher".into()))?;
    let nonce_arr = Nonce::from_slice(&payload.nonce);

    let plaintext = cipher
        .decrypt(nonce_arr, payload.ciphertext.as_ref())
        .map_err(|_| {
            RelayerError::InvalidRequest(
                "Decryption failed - invalid ciphertext or key mismatch".into(),
            )
        })?;

    // Parse decrypted JSON
    let plain_req: PlainDepositRequest = serde_json::from_slice(&plaintext)
        .map_err(|e| RelayerError::InvalidRequest(format!("Invalid decrypted payload: {}", e)))?;

    let request = convert_plain_to_deposit_request(plain_req)?;
    let response = state.deposit_service.handle_deposit(request).await?;
    Ok(Json(response))
}

fn convert_plain_to_deposit_request(
    plain: PlainDepositRequest,
) -> std::result::Result<DepositRequest, RelayerError> {
    if plain.credit.token_id.len() != 32 {
        return Err(RelayerError::InvalidRequest(format!(
            "token_id must be 32 bytes, got {}",
            plain.credit.token_id.len()
        )));
    }
    let mut token_id = [0u8; 32];
    token_id.copy_from_slice(&plain.credit.token_id);

    // Validate and convert commitment
    if plain.commitment.len() != 32 {
        return Err(RelayerError::InvalidRequest(format!(
            "commitment must be 32 bytes, got {}",
            plain.commitment.len()
        )));
    }
    let mut commitment = [0u8; 32];
    commitment.copy_from_slice(&plain.commitment);

    Ok(DepositRequest {
        credit: privacy_proxy_sdk::credits::SignedCredit {
            token_id,
            signature: plain.credit.signature,
            amount: plain.credit.amount,
        },
        commitment,
        encrypted_note: plain.encrypted_note,
    })
}

async fn handle_withdrawal(
    State(state): State<Arc<RelayerState>>,
    Json(req): Json<WithdrawalRequestWrapper>,
) -> std::result::Result<Json<WithdrawalResponse>, RelayerError> {
    let response = state
        .withdrawal_service
        .handle_withdrawal(req.request, req.delay_hours)
        .await?;
    Ok(Json(response))
}

async fn execute_withdrawal(
    State(state): State<Arc<RelayerState>>,
    Json(req): Json<ExecuteWithdrawalRequest>,
) -> std::result::Result<Json<WithdrawalResponse>, RelayerError> {
    let nullifier_hash: [u8; 32] = hex::decode(&req.nullifier_hash)
        .map_err(|_| RelayerError::InvalidRequest("Invalid nullifier hash".into()))?
        .try_into()
        .map_err(|_| RelayerError::InvalidRequest("Nullifier hash must be 32 bytes".into()))?;

    let tx_signature = state
        .withdrawal_service
        .execute_withdrawal(nullifier_hash)
        .await?;

    Ok(Json(WithdrawalResponse {
        success: true,
        tx_signature: Some(tx_signature),
        error: None,
    }))
}

async fn get_pending_withdrawals(
    State(state): State<Arc<RelayerState>>,
) -> Json<PendingWithdrawalsResponse> {
    let records = state.withdrawal_service.get_pending_withdrawals().await;
    let pending = records
        .into_iter()
        .map(|r| PendingWithdrawalInfo {
            pda: r.pda.to_string(),
            pool_pda: r.pool_pda.to_string(),
            bucket_id: r.bucket_id,
            nullifier_hash: hex::encode(r.nullifier_hash),
            recipient: r.recipient.to_string(),
            execute_after: r.execute_after,
            amount: r.amount,
            fee: r.fee,
            executed: r.executed,
        })
        .collect();
    Json(PendingWithdrawalsResponse { pending })
}

async fn get_pools(
    State(state): State<Arc<RelayerState>>,
) -> std::result::Result<Json<PoolsResponse>, RelayerError> {
    let mut pools = Vec::new();
    for (bucket_id, &amount) in BUCKET_AMOUNTS.iter().enumerate() {
        let bucket_id = bucket_id as u8;
        let tree_size = state.merkle_service.size(bucket_id).await?;
        let merkle_root = state.merkle_service.root(bucket_id).await?;

        pools.push(PoolStatus {
            bucket_id,
            amount_lamports: amount,
            amount_sol: amount as f64 / 1_000_000_000.0,
            tree_size,
            merkle_root: hex::encode(merkle_root),
        });
    }

    Ok(Json(PoolsResponse { pools }))
}

async fn get_pool(
    State(state): State<Arc<RelayerState>>,
    axum::extract::Path(bucket_id): axum::extract::Path<u8>,
) -> std::result::Result<Json<PoolStatus>, RelayerError> {
    if bucket_id as usize >= BUCKET_AMOUNTS.len() {
        return Err(RelayerError::InvalidBucket(bucket_id as u64));
    }

    let amount = BUCKET_AMOUNTS[bucket_id as usize];
    let tree_size = state.merkle_service.size(bucket_id).await?;
    let merkle_root = state.merkle_service.root(bucket_id).await?;

    Ok(Json(PoolStatus {
        bucket_id,
        amount_lamports: amount,
        amount_sol: amount as f64 / 1_000_000_000.0,
        tree_size,
        merkle_root: hex::encode(merkle_root),
    }))
}

async fn get_proof(
    State(state): State<Arc<RelayerState>>,
    axum::extract::Path((bucket_id, leaf_index)): axum::extract::Path<(u8, u64)>,
) -> std::result::Result<Json<ProofResponse>, RelayerError> {
    if bucket_id as usize >= BUCKET_AMOUNTS.len() {
        return Err(RelayerError::InvalidBucket(bucket_id as u64));
    }

    let proof = state.merkle_service.proof(bucket_id, leaf_index).await?;

    Ok(Json(ProofResponse {
        success: true,
        siblings: Some(proof.siblings.iter().map(hex::encode).collect()),
        path_indices: Some(proof.path_indices.clone()),
        leaf_index: Some(proof.leaf_index),
        error: None,
    }))
}

#[derive(Serialize)]
struct CommitmentResponse {
    success: bool,
    commitment: Option<String>,
    error: Option<String>,
}

#[derive(Serialize)]
struct PendingWithdrawalInfo {
    pda: String,
    pool_pda: String,
    bucket_id: u8,
    nullifier_hash: String,
    recipient: String,
    execute_after: i64,
    amount: u64,
    fee: u64,
    executed: bool,
}

#[derive(Serialize)]
struct PendingWithdrawalsResponse {
    pending: Vec<PendingWithdrawalInfo>,
}

async fn get_commitment(
    State(state): State<Arc<RelayerState>>,
    axum::extract::Path((bucket_id, leaf_index)): axum::extract::Path<(u8, u64)>,
) -> std::result::Result<Json<CommitmentResponse>, RelayerError> {
    if bucket_id as usize >= BUCKET_AMOUNTS.len() {
        return Err(RelayerError::InvalidBucket(bucket_id as u64));
    }

    // Get the commitment from the merkle service's stored commitments
    let commitments = state.merkle_service.get_commitments(bucket_id).await?;
    if leaf_index as usize >= commitments.len() {
        return Ok(Json(CommitmentResponse {
            success: false,
            commitment: None,
            error: Some(format!(
                "Leaf index {} out of bounds (tree size: {})",
                leaf_index,
                commitments.len()
            )),
        }));
    }

    Ok(Json(CommitmentResponse {
        success: true,
        commitment: Some(hex::encode(commitments[leaf_index as usize])),
        error: None,
    }))
}
