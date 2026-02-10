FROM alpine:3.19

RUN apk add --no-cache tor netcat-openbsd

# Create tor user and directories
RUN mkdir -p /var/lib/tor && \
    chown -R tor:tor /var/lib/tor

# Copy torrc config
COPY torrc /etc/tor/torrc

USER tor

EXPOSE 9050

CMD ["tor", "-f", "/etc/tor/torrc"]
