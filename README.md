# NASA Engineering MCP

A proof-of-concept MCP server that gives coding agents NASA-derived software-engineering rules **before** implementation, expands the active rules **during** work when scope changes, and enforces an evidence-oriented **final review gate**.

## Why this differs from a static rules file

A static `CLAUDE.md`/Markdown file either loads everything or depends on the agent remembering to reopen it. This server keeps the data addressable and adds two behaviors:

- **Additive dynamic loading** — new implementation facts add rules without removing earlier ones.
- **Review completeness gate** — every active `must` rule must be explicitly accounted for with evidence or a justified `not_applicable`.

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

Requires Node.js 20+.

```bash
npm install
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

For a remote Claude Connector, deploy the web-standard handler in `src/handler.mjs` or adapt `src/http.mjs`, and put authentication plus strict Host/Origin validation in front of the public endpoint. The current MCP TypeScript SDK v2 uses Streamable HTTP for remote serving.

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
- File-path inference is heuristic and deliberately conservative.
- There is no vector database in v0.1; 168 structured rules do not justify one yet.
- The evidence gate validates completeness and evidence presence, not whether the evidence is truthful. That semantic judgment belongs to the reviewer model/test tooling.
