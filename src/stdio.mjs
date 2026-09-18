import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { createEngineeringServer } from './server.mjs';
import { FileTaskStore } from './tasks.mjs';
void serveStdio(() => createEngineeringServer(new FileTaskStore()));
console.error('NASA Engineering MCP running over stdio');
