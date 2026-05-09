FROM alpine:3.19

RUN apk add --no-cache tor netcat-openbsd su-exec

# Create tor directories (including hidden service dir before volume mount)
RUN mkdir -p /var/lib/tor/hidden_service && \
    chown -R tor:tor /var/lib/tor && \
    chmod 700 /var/lib/tor/hidden_service

# Copy default torrc (overridden via volume mount in production)
COPY torrc /etc/tor/torrc

EXPOSE 9050

# Entrypoint: fix volume ownership then exec Tor as 'tor' user
# This handles the Docker volume mount (created as root) ownership issue
CMD chown -R tor:tor /var/lib/tor && \
    chmod 700 /var/lib/tor/hidden_service && \
    su-exec tor tor -f /etc/tor/torrc
