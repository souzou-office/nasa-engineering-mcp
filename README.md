# NASA Engineering MCP

A proof-of-concept MCP server (v0.2) that gives coding agents NASA-derived software-engineering rules **before** implementation, expands the active rules **during** work when scope changes, and enforces an evidence-oriented **final review gate**.

This is an independent, unofficial project. It is not affiliated with or endorsed by NASA.

## Why this differs from a static rules file

A static `CLAUDE.md`/Markdown file either loads everything or depends on the agent remembering to reopen it. This server keeps the data addressable and adds two behaviors:

- **Additive dynamic loading** — new implementation facts add rules without removing earlier ones.
- **Review completeness gate** — every active `must` rule must be explicitly accounted for with evidence or a justified `not_applicable`. The server retains the cumulative rule set by task ID; clients cannot submit a smaller replacement set.

The MCP does **not** pretend to semantically prove that code complies. Claude/Codex/etc. must inspect the code/diff. The server makes the applicable rules and review obligations deterministic.

## Tools

- `engineering_catalog` — available task types/categories/triggers.
- `engineering_rules_for_task` — pre-flight rule selection; call before editing.
- `engineering_update_active_rules` — additive mid-task rule expansion.
- `engineering_lookup` — full rule details/checks.
- `engineering_search` — supplementary search.
- `engineering_prepare_review` — reconcile final changed files and produce checklist.
- `engineering_validate_review` — deterministic final evidence/completeness gate.

## Install and test

Requires Node.js 22+. The Node transports also need a writable, persistent local state directory.

```bash
npm ci
npm test
npm run eval
```

## Claude Code: local stdio

```bash
npm run start:stdio
```

A project MCP config can point to the local checkout, for example:

```json
{
  "mcpServers": {
    "nasa-engineering": {
      "type": "stdio",
      "command": "npm",
      "args": ["run", "start:stdio"],
      "cwd": "/absolute/path/to/nasa-engineering-mcp"
    }
  }
}
```

Also place the included `CLAUDE.md` instructions (or equivalent short instructions) in the project so the agent reliably calls the MCP at pre-flight, scope-change, and final-review stages.

## Local Streamable HTTP

```bash
npm run start:http
# http://127.0.0.1:3000/mcp
```

For a remote Claude Connector, use a persistent Node host for `src/handler.mjs` or `src/http.mjs`, and put authentication plus strict Host/Origin validation in front of the public endpoint. The current MCP TypeScript SDK v2 uses Streamable HTTP for remote serving.

## Cloudflare Workers remote MCP

The repository can be deployed directly as a stateless Streamable HTTP MCP endpoint. Task state is retained in the configured `EngineeringTask` Durable Object, so cumulative rules and review revisions survive across requests and Worker restarts.

```bash
npm ci
npm run dev:worker
npm run deploy
```

After deployment, the endpoint is:

```text
https://nasa-engineering-mcp.<your-subdomain>.workers.dev/mcp
```

For example, add it to Claude Code with:

```bash
claude mcp add --transport http nasa-engineering \
  https://nasa-engineering-mcp.<your-subdomain>.workers.dev/mcp
```

`wrangler.jsonc` declares the Worker entry point, Durable Object binding, and initial SQLite-backed migration. The first `npm run deploy` creates the Durable Object class as part of the deployment.

## Task identity and v0.1 migration

This release intentionally changes three MCP tool contracts. Update the project instructions as well as the server.

1. Call `engineering_rules_for_task` with signals; retain its `task_id`.
2. Call `engineering_update_active_rules` with `taskId` and new signals/files. Do not send `currentRuleIds`.
3. Call `engineering_prepare_review` with `taskId` and the actual `changedFiles`; retain `review_revision`.
4. Call `engineering_validate_review` with `taskId`, `reviewRevision`, and `reviewItems`. Do not send `activeRuleIds`.

`active_rule_ids` is still returned for inspection and lookup; it is no longer trusted as client-supplied task state. Old array-based requests are rejected explicitly. Every scope update invalidates the prepared review, even if no rules were added. Preparing again also invalidates older review revisions. Unknown classifications, unknown rule IDs, duplicate review items, and inactive review items are errors or blocking results.

Example validation arguments (replace these with values from the current task):

```json
{
  "taskId": "<task_id from initial selection>",
  "reviewRevision": 3,
  "reviewItems": [
    {"rule_id": "AI-NASA-SWE-146-01", "status": "pass", "evidence": "Actual review evidence"}
  ]
}
```

All active MUST rules must be covered; this one-item example is not a complete review.

## Persistent state and HTTP configuration

- `ENGINEERING_STATE_DIR` (Node transports only): absolute directory recommended; default `.engineering-state` relative to the server working directory. Keep it across restarts. Task files use private permissions and contain rule IDs/revisions, not code or evidence.
- Node HTTP request handlers and local processes sharing this directory see the same cumulative obligations. Per-task locks reject concurrent access rather than losing updates; retry a busy task. After a crash, inspect and remove a stale `.lock` directory only after confirming no process is using the task.
- The Cloudflare Worker uses the `ENGINEERING_TASKS` Durable Object binding instead of local files. Each task ID maps to one isolated object, which serializes updates and persists rule IDs and revisions.
- Missing/corrupt state and a changed rule-data fingerprint fail closed. Start a replacement task with the full known scope instead of silently restoring an empty set.
- `PORT`/`HOST`: default `3000`/`127.0.0.1`. The default Host allowlist follows the actual listening port. Wildcard bind addresses are not themselves accepted Host values.
- `ALLOWED_HOSTS`: optional comma-separated exact Host values for a reverse proxy or custom hostname. An explicitly empty list is rejected.
- `ALLOWED_ORIGINS`: optional comma-separated exact origins. When omitted, requests with an Origin header are rejected; non-browser clients without Origin remain supported.

Task IDs are opaque capabilities, not user authentication. The Worker is intentionally usable without credentials after deployment, but it is still a public endpoint: anyone who knows the URL can call its tools and consume quota. The server stores task IDs, rule IDs, and revisions—not source code or review evidence. Add Cloudflare Access, OAuth, rate limiting, or per-user isolation before using it for private or multi-tenant workloads.

## Dynamic flow

```text
User request
   ↓
Claude classifies task
   ↓
engineering_rules_for_task
   ↓
Active rules
   ↓
Implementation
   ↓ scope expands? ── yes ─→ engineering_update_active_rules ─┐
   │                                                          │
   └──────────────────────────────────────────────────────────┘
   ↓
Actual changed files
   ↓
engineering_prepare_review
   ↓
Model reviews actual diff and supplies evidence
   ↓
engineering_validate_review
   ↓
complete / blocking gaps
```

## Rule data

`data/nasa_rules.json` contains 168 atomic rules derived from NASA NPR 7150.2D Chapters 3–5. Normal tasks exclude rules scoped only to `safety_critical`; they are activated only explicitly.

## Astra evaluation

Use `eval/ASTRA_EVAL_PROMPT.md` as the independent evaluator prompt. `eval/cases.json` and `npm run eval` provide deterministic baseline cases. Astra should inspect the source as well as the test results and run adversarial cases rather than trusting self-tests.

## Current limitations

- Task/domain classification is intentionally left to the calling model; the server deterministically maps provided signals to rules.
- File-path inference is heuristic and deliberately conservative; Windows separators are normalized.
- Scope and changed files are still supplied by the calling agent. A new task, unreported code changes, or invented evidence cannot be detected solely by task-state persistence.
- Review revisions identify the declared scope, not a cryptographic binding to the actual code diff. The host must call update/prepare after further edits.
- There is no vector database in v0.2; 168 structured rules do not justify one yet.
- The evidence gate validates completeness and evidence presence, not whether the evidence is truthful. That semantic judgment belongs to the reviewer model/test tooling.
