import express, { Request, Response, NextFunction } from "express";
import { SocksProxyAgent } from "socks-proxy-agent";

const app = express();

const TOR_SOCKS_HOST = process.env.TOR_SOCKS_HOST || "127.0.0.1";
const TOR_SOCKS_PORT = process.env.TOR_SOCKS_PORT || "9050";
const GATEWAY_PORT = parseInt(process.env.GATEWAY_PORT || "3080", 10);

const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS
  ? process.env.ALLOWED_ORIGINS.split(",")
  : [
      "http://localhost:3000",
      "http://localhost:4173",
      "http://127.0.0.1:3000",
      "http://127.0.0.1:5173",
    ];

const torProxyUrl = `socks5h://${TOR_SOCKS_HOST}:${TOR_SOCKS_PORT}`;
const agent = new SocksProxyAgent(torProxyUrl);

app.use((req: Request, res: Response, next: NextFunction) => {
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.includes(origin)) {
    res.header("Access-Control-Allow-Origin", origin);
    res.header("Access-Control-Allow-Credentials", "true");
  } else if (!origin) {
    console.warn(`[CORS] Request without origin header from ${req.ip}`);
  } else {
    console.warn(`[CORS] Blocked request from unauthorized origin: ${origin}`);
  }

  res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
  res.header(
    "Access-Control-Allow-Headers",
    "Origin, X-Requested-With, Content-Type, Accept",
  );
  if (req.method === "OPTIONS") {
    res.sendStatus(200);
    return;
  }
  next();
});

app.use(express.json());
app.use(express.text());

app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", tor: torProxyUrl });
});

const ALLOWED_RELAYER_HOSTS = process.env.ALLOWED_RELAYER_HOSTS
  ? process.env.ALLOWED_RELAYER_HOSTS.split(",")
  : ["localhost", "127.0.0.1", "host.docker.internal"];

function validateProxyUrl(urlString: string): { valid: boolean; error?: string; url?: URL } {
  try {
    const url = new URL(urlString);

    // 1. Only allow HTTP and HTTPS schemes
    if (url.protocol !== "http:" && url.protocol !== "https:") {
      return { valid: false, error: `Unsupported protocol: ${url.protocol}. Only http:// and https:// are allowed.` };
    }

    // 2. Block private IP ranges (RFC 1918, link-local, loopback except allowed hosts)
    const hostname = url.hostname.toLowerCase();
    
    // Check if it's an IP address
    const ipv4Regex = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/;
    const ipMatch = hostname.match(ipv4Regex);
    
    if (ipMatch) {
      const octets = ipMatch.slice(1).map(Number);
      
      // Block cloud metadata endpoints (169.254.169.254)
      if (octets[0] === 169 && octets[1] === 254 && octets[2] === 169 && octets[3] === 254) {
        return { valid: false, error: "Access to cloud metadata endpoints is blocked" };
      }
      
      // Block link-local addresses (169.254.0.0/16)
      if (octets[0] === 169 && octets[1] === 254) {
        return { valid: false, error: "Access to link-local addresses is blocked" };
      }
      
      // Block private networks (RFC 1918)
      // 10.0.0.0/8
      if (octets[0] === 10) {
        return { valid: false, error: "Access to private network 10.0.0.0/8 is blocked" };
      }
      // 172.16.0.0/12
      if (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31) {
        return { valid: false, error: "Access to private network 172.16.0.0/12 is blocked" };
      }
      // 192.168.0.0/16
      if (octets[0] === 192 && octets[1] === 168) {
        return { valid: false, error: "Access to private network 192.168.0.0/16 is blocked" };
      }
      
      // Allow localhost/loopback (127.0.0.0/8) only if in allowed list
      if (octets[0] === 127) {
        if (!ALLOWED_RELAYER_HOSTS.includes(hostname) && !ALLOWED_RELAYER_HOSTS.includes("127.0.0.1")) {
          return { valid: false, error: "Access to loopback addresses is restricted" };
        }
      }
    }
    
    // 3. Whitelist allowed hostnames (localhost, relayer host)
    const isAllowedHost = ALLOWED_RELAYER_HOSTS.some(allowed => 
      hostname === allowed.toLowerCase() || hostname.endsWith(`.${allowed.toLowerCase()}`)
    );
    
    if (!isAllowedHost) {
      // For non-whitelisted hosts, they must be external (not private IPs)
      // This allows Tor to access external services but blocks internal network
      if (ipMatch) {
        return { valid: false, error: "Access to this IP address is not allowed" };
      }
      // Allow external domain names (they'll go through Tor)
    }

    // 4. Block common internal hostnames
    const blockedHostnames = [
      "metadata.google.internal",
      "metadata",
      "kubernetes",
      "consul",
      "etcd",
    ];
    
    if (blockedHostnames.some(blocked => hostname.includes(blocked))) {
      return { valid: false, error: "Access to internal service hostnames is blocked" };
    }

    return { valid: true, url };
  } catch (error) {
    return { valid: false, error: `Invalid URL: ${error instanceof Error ? error.message : String(error)}` };
  }
}

// Internal relayer host (Docker network DNS name)
const INTERNAL_RELAYER_HOST = process.env.INTERNAL_RELAYER_HOST || "relayer";
const INTERNAL_RELAYER_PORT = process.env.INTERNAL_RELAYER_PORT || "8080";

app.all("/proxy", async (req: Request, res: Response, next: NextFunction) => {
  const targetUrl = req.query.url as string;
  if (!targetUrl) {
    res.status(400).json({ error: "Missing url query parameter" });
    return;
  }

  const validation = validateProxyUrl(targetUrl);
  if (!validation.valid) {
    console.warn(`[proxy] Blocked SSRF attempt: ${targetUrl} - ${validation.error}`);
    res.status(403).json({ error: validation.error });
    return;
  }

  try {
    const fetchModule = await import("node-fetch");
    const fetch = fetchModule.default;

    const url = validation.url!;
    const isLocalRelayer =
      url.hostname === "localhost" || 
      url.hostname === "127.0.0.1" ||
      url.hostname === "host.docker.internal" ||
      url.hostname === "relayer";

    let finalUrl = targetUrl;
    let useAgent: typeof agent | undefined = agent; // Default: use Tor

    if (isLocalRelayer) {
      // Route to internal relayer via Docker network (no Tor needed)
      // This handles deposits/withdrawals to local relayer during development
      finalUrl = `http://${INTERNAL_RELAYER_HOST}:${INTERNAL_RELAYER_PORT}${url.pathname}${url.search}`;
      useAgent = undefined; // Direct connection, no Tor
      console.log(`[proxy] Local relayer, direct connection to: ${finalUrl}`);
    } else {
      console.log(`[proxy] External URL, routing via Tor: ${targetUrl}`);
    }

    const response = await fetch(finalUrl, {
      method: req.method,
      headers: {
        "Content-Type": req.get("Content-Type") || "application/json",
        "User-Agent": "TraceZero/1.0",
      },
      body:
        req.method !== "GET" && req.method !== "HEAD"
          ? JSON.stringify(req.body)
          : undefined,
      agent: useAgent,
    });

    const contentType = response.headers.get("content-type");
    const data = contentType?.includes("application/json")
      ? await response.json()
      : await response.text();

    res.status(response.status).send(data);
  } catch (error) {
    next(error);
  }
});

app.get("/ip", async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const fetchModule = await import("node-fetch");
    const fetch = fetchModule.default;

    const response = await fetch("https://api.ipify.org?format=json", {
      agent,
    });
    const data = (await response.json()) as { ip: string };

    res.json({ exitIp: data.ip, viaTor: true });
  } catch (error) {
    next(error);
  }
});

app.get(
  "/verify-tor",
  async (_req: Request, res: Response, next: NextFunction) => {
    try {
      const fetchModule = await import("node-fetch");
      const fetch = fetchModule.default;

      const response = await fetch("https://check.torproject.org/api/ip", {
        agent,
      });
      const data = (await response.json()) as { IsTor: boolean; IP: string };

      res.json({
        isTor: data.IsTor,
        exitIp: data.IP,
        proxyUrl: torProxyUrl,
      });
    } catch (error) {
      next(error);
    }
  },
);

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error("Gateway error:", err.message);
  res.status(500).json({ error: err.message });
});

if (require.main === module) {
  app.listen(GATEWAY_PORT, () => {
    console.log(`Tor Gateway running on port ${GATEWAY_PORT}`);
    console.log(`Tor SOCKS5 proxy: ${torProxyUrl}`);
  });
}

export { app, agent, torProxyUrl };
