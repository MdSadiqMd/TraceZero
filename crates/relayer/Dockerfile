# ============================================================
# TraceZero Relayer — Multi-Stage Production Dockerfile
# Stage 1: Build the relayer binary (never runs on EC2)
# Stage 2: Minimal runtime image (~80MB final)
# ============================================================

FROM rust:1.78-bookworm AS builder

WORKDIR /build

# Install only what the linker needs
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \
    pkg-config \
    libssl-dev \
    && rm -rf /var/lib/apt/lists/*

# Cache dependencies before copying source
# Copy workspace manifest files first
COPY Cargo.toml Cargo.lock ./
COPY crates/network/Cargo.toml         crates/network/Cargo.toml
COPY crates/privacy-proxy-sdk/Cargo.toml crates/privacy-proxy-sdk/Cargo.toml
COPY crates/relayer/Cargo.toml         crates/relayer/Cargo.toml
COPY crates/tracer/Cargo.toml          crates/tracer/Cargo.toml

# Create stub lib/main files so cargo can resolve the workspace graph and
# download+compile all dependencies before we copy real source (layer cache).
RUN mkdir -p crates/network/src crates/privacy-proxy-sdk/src crates/relayer/src crates/tracer/src \
    && echo "fn main(){}" > crates/relayer/src/main.rs \
    && echo "" > crates/network/src/lib.rs \
    && echo "" > crates/privacy-proxy-sdk/src/lib.rs \
    && echo "" > crates/tracer/src/main.rs

RUN cargo build --release -p relayer 2>&1 || true
# Remove stub artifacts so the real build picks up correctly
RUN rm -f target/release/relayer target/release/deps/relayer*

# Now copy real source
COPY crates/ crates/

RUN cargo build --release -p relayer

# Verify the binary exists and is executable
RUN test -f target/release/relayer && \
    file target/release/relayer | grep -q "ELF" && \
    echo "Binary OK: $(du -sh target/release/relayer)"

FROM debian:bookworm-slim AS runtime

# Install only runtime libs (no build tools, no compilers)
RUN apt-get update -qq && apt-get install -y -qq --no-install-recommends \
    ca-certificates \
    libssl3 \
    && rm -rf /var/lib/apt/lists/* \
    && apt-get clean

# Create dedicated non-root user with no shell
RUN groupadd -r -g 10001 relayer && \
    useradd -r -u 10001 -g relayer -s /sbin/nologin -d /app relayer

# Directories with correct ownership
# /app/state — merkle_state, used_tokens.dat (read-write)
# /app/keys  — wallet keypairs (read-only at runtime, 600 on host)
RUN mkdir -p /app/state/merkle_state /app/keys /app/logs && \
    chown -R relayer:relayer /app && \
    chmod 750 /app/state && \
    chmod 700 /app/keys && \
    chmod 750 /app/logs

# Copy only the compiled binary
COPY --from=builder --chown=relayer:relayer \
    /build/target/release/relayer /app/relayer

RUN chmod 755 /app/relayer

USER relayer
WORKDIR /app/state

# The relayer listens on 8080 (internal only — Tor exposes it as .onion)
EXPOSE 8080

# Tini-less entrypoint — Docker handles PID 1 reaping for single-process containers
ENTRYPOINT ["/app/relayer"]
