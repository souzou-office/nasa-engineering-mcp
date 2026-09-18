import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createEngineeringServer } from './server.mjs';
void serveStdio(createEngineeringServer);
console.error('NASA Engineering MCP running over stdio');
