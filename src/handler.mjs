import { createMcpHandler } from '@modelcontextprotocol/server';
import { createEngineeringServer } from './server.mjs';
import { FileTaskStore } from './tasks.mjs';
const handler = createMcpHandler(() => createEngineeringServer(new FileTaskStore()));
export default handler;
