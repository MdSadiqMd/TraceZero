use anyhow::{anyhow, Result};
use chrono::{DateTime, Utc};
use clap::Parser;
use solana_client::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;
use solana_transaction_status::{EncodedConfirmedTransactionWithStatusMeta, UiTransactionEncoding};
use std::collections::HashMap;
use std::str::FromStr;

#[derive(Debug, Clone)]
struct TransactionInfo {
    signature: String,
    timestamp: Option<DateTime<Utc>>,
    amount: i64,
    sender: String,
    tx_type: TransactionType,
}

#[derive(Debug, Clone, PartialEq)]
enum TransactionType {
    Transfer,
    Program,
}

#[derive(Debug)]
struct TraceNode {
    address: String,
    label: Option<String>,
    balance: Option<u64>,
    transactions: Vec<TransactionInfo>,
    senders: HashMap<String, Box<TraceNode>>,
    depth: usize,
}

impl TraceNode {
    fn new(address: String, depth: usize) -> Self {
        Self {
            address,
            label: None,
            balance: None,
            transactions: Vec::new(),
            senders: HashMap::new(),
            depth,
        }
    }
}

#[derive(Debug)]
struct PrivacyTraceResult {
    tree: TraceNode,
    deposit_wallets: Vec<String>,
    user_deposited_directly: bool,
    user_funded_deposit_wallet: bool,
    trace_path: Vec<String>,
}

struct TransactionTracer {
    client: RpcClient,
    max_depth: usize,
    program_id: Pubkey,
}

impl TransactionTracer {
    fn new(rpc_url: &str, max_depth: usize, program_id: Pubkey) -> Self {
        Self {
            client: RpcClient::new(rpc_url.to_string()),
            max_depth,
            program_id,
        }
    }

    async fn trace_privacy(&self, receiver: &str, user_wallet: &str) -> Result<PrivacyTraceResult> {
        let mut tree = TraceNode::new(receiver.to_string(), 0);
        tree.label = Some("withdrawal receiver".to_string());
        self.fill_balance(&mut tree)?;

        let mut deposit_wallets: Vec<String> = Vec::new();
        let mut user_deposited_directly = false;
        let mut user_funded_deposit_wallet = false;
        let mut trace_path: Vec<String> = Vec::new();

        println!(
            "Fetching transactions for {}... (depth 0, withdrawal receiver)",
            &receiver[..8]
        );

        let receiver_txs = self.get_incoming_transactions(receiver)?;
        println!("  Found {} incoming transaction(s)", receiver_txs.len());
        tree.transactions = receiver_txs.clone();

        for tx in &receiver_txs {
            if tx.sender == "unknown" || tx.sender == receiver {
                continue;
            }
            let pool_addr = &tx.sender;

            if tree.senders.contains_key(pool_addr) {
                continue;
            }

            let mut pool_node = TraceNode::new(pool_addr.clone(), 1);
            pool_node.label = Some("pool PDA".to_string());
            self.fill_balance(&mut pool_node)?;

            println!(
                "Fetching transactions for {}... (depth 1, pool PDA)",
                &pool_addr[..8]
            );

            let pool_txs = self.get_program_deposits(pool_addr)?;
            println!("  Found {} program deposit(s)", pool_txs.len());
            pool_node.transactions = pool_txs.clone();

            for ptx in &pool_txs {
                if ptx.sender == user_wallet {
                    user_deposited_directly = true;
                }
            }

            for ptx in &pool_txs {
                if ptx.sender == "unknown" || ptx.sender == pool_addr.as_str() {
                    continue;
                }
                let dep_addr = &ptx.sender;

                if pool_node.senders.contains_key(dep_addr) {
                    continue;
                }

                deposit_wallets.push(dep_addr.clone());

                let mut dep_node = TraceNode::new(dep_addr.clone(), 2);
                dep_node.label = Some("deposit wallet".to_string());
                self.fill_balance(&mut dep_node)?;

                if self.max_depth > 2 {
                    println!(
                        "Checking if user wallet funded {}... (depth 2, deposit wallet)",
                        &dep_addr[..8]
                    );

                    let funded = self.check_direct_funding(dep_addr, user_wallet)?;

                    if funded {
                        user_funded_deposit_wallet = true;
                        trace_path = vec![
                            receiver.to_string(),
                            pool_addr.clone(),
                            dep_addr.clone(),
                            user_wallet.to_string(),
                        ];

                        let mut user_node = TraceNode::new(user_wallet.to_string(), 3);
                        user_node.label = Some("YOUR WALLET".to_string());
                        self.fill_balance(&mut user_node)?;
                        dep_node
                            .senders
                            .insert(user_wallet.to_string(), Box::new(user_node));
                    }
                }

                pool_node
                    .senders
                    .insert(dep_addr.clone(), Box::new(dep_node));
            }

            tree.senders.insert(pool_addr.clone(), Box::new(pool_node));
        }

        Ok(PrivacyTraceResult {
            tree,
            deposit_wallets,
            user_deposited_directly,
            user_funded_deposit_wallet,
            trace_path,
        })
    }

    fn get_incoming_transactions(&self, address: &str) -> Result<Vec<TransactionInfo>> {
        let pubkey = Pubkey::from_str(address)?;
        let signatures = self
            .client
            .get_signatures_for_address(&pubkey)
            .map_err(|e| anyhow!("Failed to fetch signatures for {}: {}", &address[..8], e))?;

        let mut results = Vec::new();

        for sig_info in signatures.iter().take(20) {
            if sig_info.err.is_some() {
                continue;
            }
            let signature = sig_info.signature.parse()?;
            let tx = self
                .client
                .get_transaction(&signature, UiTransactionEncoding::JsonParsed)
                .ok();

            if let Some(tx) = tx {
                if let Some(info) =
                    self.extract_incoming_transfer(&tx, address, &sig_info.signature)
                {
                    results.push(info);
                }
            }
        }

        Ok(results)
    }

    fn get_program_deposits(&self, pool_address: &str) -> Result<Vec<TransactionInfo>> {
        let pubkey = Pubkey::from_str(pool_address)?;
        let signatures = self
            .client
            .get_signatures_for_address(&pubkey)
            .map_err(|e| {
                anyhow!(
                    "Failed to fetch signatures for {}: {}",
                    &pool_address[..8],
                    e
                )
            })?;

        let mut results = Vec::new();

        for sig_info in signatures.iter().take(50) {
            if sig_info.err.is_some() {
                continue;
            }
            let signature = sig_info.signature.parse()?;
            let tx = self
                .client
                .get_transaction(&signature, UiTransactionEncoding::JsonParsed)
                .ok();

            if let Some(tx) = tx {
                if !self.tx_involves_program(&tx) {
                    continue;
                }
                if let Some(info) =
                    self.extract_incoming_transfer(&tx, pool_address, &sig_info.signature)
                {
                    results.push(info);
                }
            }
        }

        Ok(results)
    }

    fn check_direct_funding(&self, target_address: &str, user_wallet: &str) -> Result<bool> {
        let pubkey = Pubkey::from_str(target_address)?;
        let signatures = self
            .client
            .get_signatures_for_address(&pubkey)
            .map_err(|e| {
                anyhow!(
                    "Failed to fetch signatures for {}: {}",
                    &target_address[..8],
                    e
                )
            })?;

        for sig_info in signatures.iter().take(50) {
            if sig_info.err.is_some() {
                continue;
            }
            let signature = sig_info.signature.parse()?;
            let tx = self
                .client
                .get_transaction(&signature, UiTransactionEncoding::JsonParsed)
                .ok();

            if let Some(tx) = tx {
                if let Some(info) =
                    self.extract_incoming_transfer(&tx, target_address, &sig_info.signature)
                {
                    if info.sender == user_wallet {
                        return Ok(true);
                    }
                }
            }
        }

        Ok(false)
    }

    fn tx_involves_program(&self, tx: &EncodedConfirmedTransactionWithStatusMeta) -> bool {
        let program_str = self.program_id.to_string();

        if let solana_transaction_status::EncodedTransaction::Json(ui_tx) =
            &tx.transaction.transaction
        {
            match &ui_tx.message {
                solana_transaction_status::UiMessage::Parsed(parsed_msg) => {
                    for key in &parsed_msg.account_keys {
                        if key.pubkey == program_str {
                            return true;
                        }
                    }
                }
                solana_transaction_status::UiMessage::Raw(raw_msg) => {
                    for key in &raw_msg.account_keys {
                        if *key == program_str {
                            return true;
                        }
                    }
                }
            }
        }

        false
    }

    fn extract_incoming_transfer(
        &self,
        tx: &EncodedConfirmedTransactionWithStatusMeta,
        receiver_address: &str,
        signature: &str,
    ) -> Option<TransactionInfo> {
        let receiver = Pubkey::from_str(receiver_address).ok()?;
        let meta = tx.transaction.meta.as_ref()?;

        let account_keys = match &tx.transaction.transaction {
            solana_transaction_status::EncodedTransaction::Json(ui_tx) => match &ui_tx.message {
                solana_transaction_status::UiMessage::Parsed(parsed_msg) => {
                    &parsed_msg.account_keys
                }
                _ => return None,
            },
            _ => return None,
        };

        let pre_balances = &meta.pre_balances;
        let post_balances = &meta.post_balances;

        let receiver_index = account_keys
            .iter()
            .position(|key| Pubkey::from_str(&key.pubkey).ok() == Some(receiver))?;

        let pre = *pre_balances.get(receiver_index)?;
        let post = *post_balances.get(receiver_index)?;
        let change = post as i64 - pre as i64;

        if change <= 0 {
            return None;
        }

        let mut sender_address = "unknown".to_string();
        let mut best_match = 0i64;

        for (i, key) in account_keys.iter().enumerate() {
            if i == receiver_index {
                continue;
            }
            if let (Some(&pre_b), Some(&post_b)) = (pre_balances.get(i), post_balances.get(i)) {
                let delta = post_b as i64 - pre_b as i64;
                if delta < best_match {
                    best_match = delta;
                    sender_address = key.pubkey.clone();
                }
            }
        }

        let tx_type = if self.tx_involves_program(tx) {
            TransactionType::Program
        } else {
            TransactionType::Transfer
        };

        let timestamp = tx
            .block_time
            .map(|ts| DateTime::from_timestamp(ts, 0).unwrap_or_else(|| Utc::now()));

        Some(TransactionInfo {
            signature: signature.to_string(),
            timestamp,
            amount: change,
            sender: sender_address,
            tx_type,
        })
    }

    fn fill_balance(&self, node: &mut TraceNode) -> Result<()> {
        if let Ok(pubkey) = Pubkey::from_str(&node.address) {
            if let Ok(balance) = self.client.get_balance(&pubkey) {
                node.balance = Some(balance);
            }
        }
        Ok(())
    }

    fn print_tree(&self, node: &TraceNode, prefix: &str, is_last: bool) {
        let connector = if node.depth == 0 {
            ""
        } else if is_last {
            "└── "
        } else {
            "├── "
        };
        let short = format!(
            "{}...{}",
            &node.address[..8],
            &node.address[node.address.len() - 6..]
        );
        let balance_str = node
            .balance
            .map(|b| format!(" ({:.4} SOL)", b as f64 / 1e9))
            .unwrap_or_default();
        let label_str = node
            .label
            .as_ref()
            .map(|l| format!(" [{}]", l))
            .unwrap_or_default();

        println!(
            "{}{}{}{}{}",
            prefix, connector, short, balance_str, label_str
        );

        if !node.transactions.is_empty() {
            let tx_prefix = if node.depth == 0 {
                "  ".to_string()
            } else {
                format!("{}{}", prefix, if is_last { "    " } else { "│   " })
            };
            for tx in node.transactions.iter().take(5) {
                let date = tx
                    .timestamp
                    .map(|ts| ts.format("%Y-%m-%d %H:%M").to_string())
                    .unwrap_or_else(|| "unknown".to_string());
                let amount = tx.amount as f64 / 1e9;
                let type_str = match tx.tx_type {
                    TransactionType::Transfer => "TRANSFER",
                    TransactionType::Program => "PROGRAM ",
                };
                println!(
                    "{}  {} | {:.4} SOL | {} | {}...",
                    tx_prefix,
                    type_str,
                    amount,
                    date,
                    &tx.signature[..12]
                );
            }
            if node.transactions.len() > 5 {
                println!(
                    "{}  ... and {} more",
                    tx_prefix,
                    node.transactions.len() - 5
                );
            }
        }

        let senders: Vec<_> = node.senders.values().collect();
        for (i, sender) in senders.iter().enumerate() {
            let is_last_sender = i == senders.len() - 1;
            let new_prefix = if node.depth == 0 {
                "  ".to_string()
            } else {
                format!("{}{}", prefix, if is_last { "    " } else { "│   " })
            };
            self.print_tree(sender, &new_prefix, is_last_sender);
        }
    }
}

#[derive(Parser, Debug)]
#[command(name = "test-privacy")]
#[command(about = "Test privacy of a withdrawal by tracing the transaction chain")]
struct Args {
    #[arg(value_name = "WITHDRAWAL_RECEIVER")]
    withdrawal_receiver: String,

    #[arg(value_name = "ORIGINAL_DEPOSITOR")]
    original_depositor: String,

    #[arg(short, long, default_value = "https://api.devnet.solana.com")]
    rpc: String,

    #[arg(short, long)]
    program: String,

    #[arg(short, long, default_value = "10")]
    depth: usize,
}

#[tokio::main]
async fn main() -> Result<()> {
    let args = Args::parse();
    println!();
    println!("  Withdrawal Receiver: {}", args.withdrawal_receiver);
    println!("  Original Depositor:  {}", args.original_depositor);
    println!("  Program ID:          {}", args.program);
    println!("  RPC:                 {}", args.rpc);
    println!("  Max Depth:           {}", args.depth);
    println!();

    let program_id =
        Pubkey::from_str(&args.program).map_err(|e| anyhow!("Invalid program ID: {}", e))?;
    let tracer = TransactionTracer::new(&args.rpc, args.depth, program_id);
    let result = tracer
        .trace_privacy(&args.withdrawal_receiver, &args.original_depositor)
        .await?;

    println!();
    tracer.print_tree(&result.tree, "", true);

    if !result.deposit_wallets.is_empty() {
        println!("\nDeposit wallet(s) identified:");
        for w in &result.deposit_wallets {
            println!("  {}", w);
        }
    }

    println!();
    if result.user_deposited_directly {
        println!("VERDICT: TRACEABLE (critical)");
        println!("Your wallet directly deposited to the pool PDA");
        println!("The relayer should be the only account depositing to the pool");
    } else if result.user_funded_deposit_wallet {
        println!("VERDICT: CORRELATABLE");
        println!("Your wallet did NOT deposit to the pool directly (good)");
        println!("But your wallet sent SOL directly to the deposit wallet");
        println!("(the relayer). An observer can link:");
        println!("  withdrawal -> pool -> deposit wallet <- your wallet");
        println!();
        println!("Fix: set TREASURY_KEYPAIR_PATH so credit payments go to");
        println!("a separate treasury wallet, not the deposit wallet");
        println!();
        if !result.trace_path.is_empty() {
            println!("Trace path:");
            for (i, addr) in result.trace_path.iter().enumerate() {
                let short = format!("{}...{}", &addr[..8], &addr[addr.len() - 6..]);
                let indent = "  ".repeat(i);
                if i == 0 {
                    println!("  {} (withdrawal receiver)", short);
                } else if *addr == args.original_depositor {
                    println!("  {}<- {} (YOUR WALLET)", indent, short);
                } else {
                    println!("  {}<- {}", indent, short);
                }
            }
        }
    } else {
        println!("VERDICT: NOT TRACEABLE");
        println!("Your wallet does not appear in the transaction chain");
        println!("from the withdrawal receiver through the pool to the");
        println!("deposit wallet");
    }

    Ok(())
}
