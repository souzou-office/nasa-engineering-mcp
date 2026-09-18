import { createServer } from 'node:http';
import { createMcpHandler } from '@modelcontextprotocol/server';
import { toNodeHandler } from '@modelcontextprotocol/node';
import { createEngineeringServer } from './server.mjs';
const port = Number(process.env.PORT ?? 3000), host = process.env.HOST ?? '127.0.0.1';
const allowedHosts = new Set((process.env.ALLOWED_HOSTS ?? '127.0.0.1:3000,localhost:3000').split(',').map(v=>v.trim()).filter(Boolean));
const allowedOrigins = new Set((process.env.ALLOWED_ORIGINS ?? '').split(',').map(v=>v.trim()).filter(Boolean));
const handler = createMcpHandler(() => createEngineeringServer()), nodeHandler = toNodeHandler(handler);
createServer((req,res)=>{
  if (req.url !== '/mcp') { res.statusCode=404; res.end('Not found'); return; }
  const reqHost=req.headers.host ?? '';
  if (allowedHosts.size && !allowedHosts.has(reqHost)) { res.statusCode=403; res.end('Forbidden host'); return; }
  const origin=req.headers.origin;
  if (origin && allowedOrigins.size && !allowedOrigins.has(origin)) { res.statusCode=403; res.end('Forbidden origin'); return; }
  void nodeHandler(req,res);
}).listen(port,host,()=>console.error(`NASA Engineering MCP listening on http://${host}:${port}/mcp`));
