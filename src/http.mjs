import { createServer } from 'node:http';
import { pathToFileURL } from 'node:url';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createEngineeringServer } from './server.mjs';
import { FileTaskStore } from './tasks.mjs';

const list = value => new Set(value.split(',').map(v => v.trim()).filter(Boolean));
export function createEngineeringHttpServer({ env = process.env, store } = {}) {
  const port = Number(env.PORT ?? 3000), host = env.HOST ?? '127.0.0.1';
  if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error('Invalid PORT');
  const allowedHosts = env.ALLOWED_HOSTS === undefined ? null : list(env.ALLOWED_HOSTS);
  if (allowedHosts?.size === 0) throw new Error('ALLOWED_HOSTS must not be empty');
  const allowedOrigins = list(env.ALLOWED_ORIGINS ?? '');
  const taskStore = store ?? new FileTaskStore(env.ENGINEERING_STATE_DIR);
  const nodeHandler = toNodeHandler(createMcpHandler(() => createEngineeringServer(taskStore)));
  const server = createServer((req, res) => {
    if (req.url !== '/mcp') { res.writeHead(404).end('Not found'); return; }
    const actualPort = server.address()?.port ?? port;
    const defaults = new Set([`127.0.0.1:${actualPort}`, `localhost:${actualPort}`, `[::1]:${actualPort}`]);
    if (!['0.0.0.0', '::'].includes(host)) defaults.add(`${host.includes(':') ? '[' + host + ']' : host}:${actualPort}`);
    if (!(allowedHosts ?? defaults).has(req.headers.host ?? '')) { res.writeHead(403).end('Forbidden host'); return; }
    const origin = req.headers.origin;
    if (origin !== undefined && !allowedOrigins.has(origin)) { res.writeHead(403).end('Forbidden origin'); return; }
    Promise.resolve().then(() => nodeHandler(req, res)).catch(() => {
      if (!res.headersSent) res.writeHead(500).end('Internal server error');
      else res.destroy();
    });
  });
  return { server, port, host };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const { server, port, host } = createEngineeringHttpServer();
  server.listen(port, host, () => console.error(`NASA Engineering MCP listening on http://${host}:${port}/mcp`));
}
