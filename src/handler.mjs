import { createMcpHandler } from '@modelcontextprotocol/server';
import { createEngineeringServer } from './server.mjs';
const handler = createMcpHandler(() => createEngineeringServer());
export default handler;
