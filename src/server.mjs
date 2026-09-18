import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { catalog, lookupRules, searchRules, TASK_PROFILES } from './engine.mjs';
const choices = catalog();

const signalShape = {
  taskType: z.enum(Object.keys(TASK_PROFILES)).optional(), categories: z.array(z.enum(choices.categories)).optional(), triggers: z.array(z.enum(choices.triggers)).optional(), changedFiles: z.array(z.string()).optional(), safetyCritical: z.boolean().optional()
};
const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });

export function createEngineeringServer(store) {
  if (!store) throw new Error('A persistent task store is required.');
  const server = new McpServer({ name: 'nasa-engineering-rules', version: '0.2.0' });
  server.registerTool('engineering_catalog', { description: 'Inspect available task types, categories, triggers, phases, and tags before selecting rules. Use when classification choices are unclear.', inputSchema: z.object({}) }, async () => result(catalog()));
  server.registerTool('engineering_rules_for_task', { description: 'FIRST CALL for code creation/modification/review. Classify the user request into taskType/categories/triggers and retrieve applicable NASA-derived engineering rules before implementation. Starts a task and returns task_id; retain it for all later calls.', inputSchema: z.strictObject(signalShape) }, async input => result(await store.create(input)));
  server.registerTool('engineering_update_active_rules', { description: 'Call DURING implementation whenever scope expands or new facts appear (dependency, auth, API, migration, generated code, CI, release, or new files). Adds newly applicable rules without dropping prior active rules. Supply taskId; stored rules cannot be replaced by caller arrays. Invalidates any prior review preparation.', inputSchema: z.strictObject({ taskId: z.string().uuid(), ...signalShape }) }, async ({ taskId, ...signals }) => result(await store.update(taskId, signals)));
  server.registerTool('engineering_lookup', { description: 'Get full rule details/checks for specific rule IDs.', inputSchema: z.object({ ruleIds: z.array(z.string()).min(1), detail: z.enum(['summary','full']).default('full') }) }, async ({ ruleIds, detail }) => result(lookupRules(ruleIds, detail)));
  server.registerTool('engineering_search', { description: 'Supplementary rule search. Do not replace the initial engineering_rules_for_task call with free-text search.', inputSchema: z.object({ query: z.string().default(''), categories: z.array(z.string()).default([]), tags: z.array(z.string()).default([]), severity: z.enum(['must','should']).optional() }) }, async input => result(searchRules(input.query, input.categories, input.tags, input.severity)));
  server.registerTool('engineering_prepare_review', { description: 'Call AFTER implementation with taskId and actual changed files. Adds missed rules and returns checklist and review_revision for validation.', inputSchema: z.strictObject({ ...signalShape, taskId: z.string().uuid(), changedFiles: z.array(z.string()).default([]) }) }, async ({ taskId, changedFiles, ...extra }) => result(await store.prepare(taskId, changedFiles, extra)));
  server.registerTool('engineering_validate_review', { description: 'FINAL GATE. Every active MUST rule needs pass/fail with evidence or justified not_applicable. Reports omissions, failures, and invalid evidence deterministically. Supply taskId and the latest reviewRevision from prepare; the server owns the complete rule set.', inputSchema: z.strictObject({ taskId: z.string().uuid(), reviewRevision: z.number().int().positive(), reviewItems: z.array(z.strictObject({ rule_id: z.string(), status: z.enum(['pass','fail','not_applicable']), evidence: z.string().optional(), justification: z.string().optional() })) }) }, async ({ taskId, reviewRevision, reviewItems }) => result(await store.validate(taskId, reviewRevision, reviewItems)));
  return server;
}
