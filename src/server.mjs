import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { catalog, lookupRules, prepareReview, searchRules, selectRules, updateActiveRules, validateReview } from './engine.mjs';

const signalShape = {
  taskType: z.string().optional(), categories: z.array(z.string()).optional(), triggers: z.array(z.string()).optional(), changedFiles: z.array(z.string()).optional(), safetyCritical: z.boolean().optional()
};
const result = value => ({ content: [{ type: 'text', text: JSON.stringify(value, null, 2) }] });

export function createEngineeringServer() {
  const server = new McpServer({ name: 'nasa-engineering-rules', version: '0.1.0' });
  server.registerTool('engineering_catalog', { description: 'Inspect available task types, categories, triggers, phases, and tags before selecting rules. Use when classification choices are unclear.', inputSchema: z.object({}) }, async () => result(catalog()));
  server.registerTool('engineering_rules_for_task', { description: 'FIRST CALL for code creation/modification/review. Classify the user request into taskType/categories/triggers and retrieve applicable NASA-derived engineering rules before implementation.', inputSchema: z.object(signalShape) }, async input => result(selectRules(input)));
  server.registerTool('engineering_update_active_rules', { description: 'Call DURING implementation whenever scope expands or new facts appear (dependency, auth, API, migration, generated code, CI, release, or new files). Adds newly applicable rules without dropping prior active rules.', inputSchema: z.object({ currentRuleIds: z.array(z.string()).default([]), ...signalShape }) }, async ({ currentRuleIds, ...signals }) => result(updateActiveRules(currentRuleIds, signals)));
  server.registerTool('engineering_lookup', { description: 'Get full rule details/checks for specific rule IDs.', inputSchema: z.object({ ruleIds: z.array(z.string()).min(1), detail: z.enum(['summary','full']).default('full') }) }, async ({ ruleIds, detail }) => result(lookupRules(ruleIds, detail)));
  server.registerTool('engineering_search', { description: 'Supplementary rule search. Do not replace the initial engineering_rules_for_task call with free-text search.', inputSchema: z.object({ query: z.string().default(''), categories: z.array(z.string()).default([]), tags: z.array(z.string()).default([]), severity: z.enum(['must','should']).optional() }) }, async input => result(searchRules(input.query, input.categories, input.tags, input.severity)));
  server.registerTool('engineering_prepare_review', { description: 'Call AFTER implementation with actual changed files and active rules. Adds any rules revealed by final scope and returns an evidence-oriented compliance checklist.', inputSchema: z.object({ activeRuleIds: z.array(z.string()), changedFiles: z.array(z.string()).default([]), taskType: z.string().optional(), categories: z.array(z.string()).optional(), triggers: z.array(z.string()).optional(), safetyCritical: z.boolean().optional() }) }, async ({ activeRuleIds, changedFiles, ...extra }) => result(prepareReview(activeRuleIds, changedFiles, extra)));
  server.registerTool('engineering_validate_review', { description: 'FINAL GATE. Every active MUST rule needs pass/fail with evidence or justified not_applicable. Reports omissions, failures, and invalid evidence deterministically.', inputSchema: z.object({ activeRuleIds: z.array(z.string()), reviewItems: z.array(z.object({ rule_id: z.string(), status: z.enum(['pass','fail','not_applicable']), evidence: z.string().optional(), justification: z.string().optional() })) }) }, async ({ activeRuleIds, reviewItems }) => result(validateReview(activeRuleIds, reviewItems)));
  return server;
}
