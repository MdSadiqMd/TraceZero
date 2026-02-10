import express, { Request, Response, NextFunction } from 'express';
import { SocksProxyAgent } from 'socks-proxy-agent';

const app = express();

const TOR_SOCKS_HOST = process.env.TOR_SOCKS_HOST || '127.0.0.1';
const TOR_SOCKS_PORT = process.env.TOR_SOCKS_PORT || '9050';
const GATEWAY_PORT = parseInt(process.env.GATEWAY_PORT || '3080', 10);

const torProxyUrl = `socks5h://${TOR_SOCKS_HOST}:${TOR_SOCKS_PORT}`;
const agent = new SocksProxyAgent(torProxyUrl);

app.use(express.json());
app.use(express.text());

app.get('/health', (_req: Request, res: Response) => {
  res.json({ status: 'ok', tor: torProxyUrl });
});

app.all('/proxy', async (req: Request, res: Response, next: NextFunction) => {
  const targetUrl = req.query.url as string;
  if (!targetUrl) {
    res.status(400).json({ error: 'Missing url query parameter' });
    return;
  }

  try {
    const fetchModule = await import('node-fetch');
    const fetch = fetchModule.default;

    const response = await fetch(targetUrl, {
      method: req.method,
      headers: {
        'Content-Type': req.get('Content-Type') || 'application/json',
        'User-Agent': 'TraceZero/1.0',
      },
      body: req.method !== 'GET' && req.method !== 'HEAD' ? JSON.stringify(req.body) : undefined,
      agent,
    });

    const contentType = response.headers.get('content-type');
    const data = contentType?.includes('application/json')
      ? await response.json()
      : await response.text();

    res.status(response.status).send(data);
  } catch (error) {
    next(error);
  }
});

app.get('/ip', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const fetchModule = await import('node-fetch');
    const fetch = fetchModule.default;

    const response = await fetch('https://api.ipify.org?format=json', { agent });
    const data = await response.json() as { ip: string };

    res.json({ exitIp: data.ip, viaTor: true });
  } catch (error) {
    next(error);
  }
});

app.get('/verify-tor', async (_req: Request, res: Response, next: NextFunction) => {
  try {
    const fetchModule = await import('node-fetch');
    const fetch = fetchModule.default;

    const response = await fetch('https://check.torproject.org/api/ip', { agent });
    const data = await response.json() as { IsTor: boolean; IP: string };

    res.json({
      isTor: data.IsTor,
      exitIp: data.IP,
      proxyUrl: torProxyUrl
    });
  } catch (error) {
    next(error);
  }
});

app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error('Gateway error:', err.message);
  res.status(500).json({ error: err.message });
});

if (require.main === module) {
  app.listen(GATEWAY_PORT, () => {
    console.log(`Tor Gateway running on port ${GATEWAY_PORT}`);
    console.log(`Tor SOCKS5 proxy: ${torProxyUrl}`);
  });
}

export { app, agent, torProxyUrl };
