# v0.2 repair verification

Base reviewed: be437f95895389e6db677851ab7731036ea6e922.

## Addressed findings

1. The MCP now retains cumulative rule IDs in persistent task files. Callers use taskId and cannot supply replacement rule arrays. Validation requires the current prepared revision; updates and re-preparation invalidate older revisions.
2. safetyCritical:true adds the safety trigger independently of taskType.
3. Duplicate review IDs are blocking; a later pass cannot erase a fail.
4. Unknown active IDs are rejected or blocking instead of disappearing.
5. Task types, categories, and triggers are validated against the catalog.
6. HTTP denies unlisted Origin values even when the allowlist is omitted.
7. The default Host allowlist follows the listening port.
8. Windows path separators are normalized before inference.

The SDK stdio factory is wrapped explicitly so its lifecycle arguments cannot replace the task store. State writes are atomic within a per-task filesystem lock. Missing, corrupt, or outdated state fails closed. Dependencies are unchanged; package-lock.json records the tested versions.

## Executed verification

- Node.js v24.19.0, Linux; MCP server/node SDK 2.0.0, Zod 4.6.5.
- npm test: 17/17 passed, including child-process stdio and real HTTP transport tests.
- npm run eval: 10/10 passed (engine baselines; these alone do not test task persistence).
- npm run check: all application modules passed syntax checking.
- npm run test:coverage: 17/17 passed; reported aggregate 92.76% lines / 93.84% branches. Child-process coverage is not included in these percentages.
- git diff --check: passed.

Transport tests explicitly reject old array-only calls and array injection into new calls. They retain 42 rules across a stdio process restart, reject a one-item review, reject fail/pass duplicates, accept a complete synthetic fixture, and reject it after a scope update. HTTP tests retain 35 obligations across independently handled requests and verify Host/Origin controls.

## Operational limits

This is a breaking tool-contract update (0.2.0). Update project CLAUDE.md instructions with the server. ENGINEERING_STATE_DIR must remain writable and persistent. The filesystem store is intended for local Node deployments; Workers require a different durable state adapter. Public serving still needs authentication and per-user/project isolation.

Rule selection still depends on agent-supplied scope. Review revisions do not identify the actual code diff, and nonempty evidence is not proof that its claims are true. These limits are documented, not presented as solved by persistence. No Claude Code quality A/B experiment or full NASA rule translation audit was performed in this repair.
