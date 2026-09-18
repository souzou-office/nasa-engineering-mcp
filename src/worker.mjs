import { createMcpHandler } from 'agents/mcp/server';
import { createEngineeringServer } from './server.mjs';
import { DurableTaskStore, EngineeringTask } from './durable-task-store.mjs';

export { EngineeringTask };

export default {
  fetch(request, env, ctx) {
    const store = new DurableTaskStore(env.ENGINEERING_TASKS);
    const handler = createMcpHandler(() => createEngineeringServer(store), {
      route: '/mcp'
    });
    return handler(request, env, ctx);
  }
};
