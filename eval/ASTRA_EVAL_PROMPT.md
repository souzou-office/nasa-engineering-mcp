# Astra independent evaluation prompt

You are independently evaluating an MCP server that applies NASA-derived software-engineering rules to AI coding agents.
Do not assume the implementation is correct because its own tests pass. Inspect the source and run the deterministic tests/eval where possible.

## Intended behavior

1. **Pre-flight**: before code changes, the agent classifies the task and calls `engineering_rules_for_task`.
2. **Dynamic expansion**: if the implementation scope changes (dependency/auth/API/migration/generated code/CI/release/etc.), the agent calls `engineering_update_active_rules`. Task state is retained server-side using taskId. Updates are additive; prior active rules are not silently dropped.
3. **Final scope reconciliation**: `engineering_prepare_review` receives actual changed files and may add rules that were missed earlier.
4. **Evidence gate**: `engineering_validate_review` requires every active `must` rule to have an explicit `pass`, `fail`, or justified `not_applicable`. A `pass`/`fail` without evidence is invalid.
5. **No semantic overclaim**: the MCP itself does not claim to understand whether code complies. The reviewing model must inspect actual code/diff; the server only supplies rules and validates review completeness/evidence shape.
6. **Safety separation**: safety-critical-only rules are excluded from ordinary software work unless explicitly activated.
7. **Determinism**: rule selection/update/review validation should be deterministic for identical inputs.

## Run

```bash
npm install
npm test
npm run eval
```

## Adversarial checks

Try at least these manually (MCP v0.2 uses taskId, then reviewRevision from prepare; caller rule arrays must be rejected):

- Restart the server between initial selection and final review using the same ENGINEERING_STATE_DIR. Prior obligations must remain.
- Try an old array-only validate call and try injecting activeRuleIds into a valid call; both must fail.
- Review only one of a task's many MUST rules; it must remain incomplete.
- Update scope after prepare, then validate the old revision; it must fail.
- Submit duplicate IDs, including fail followed by pass; it must fail.
- Set safetyCritical:true with taskType:feature; all safety-only rules must be available.
- Misspell taskType; it must be an error, not a weaker profile.
- Send Windows paths and compare with POSIX equivalents.
- Change PORT alone and connect to that port; it must work.
- Send an unknown Origin without ALLOWED_ORIGINS; it must be rejected.

- Start `feature`, then reveal `package.json` changed. Confirm dependency rules are added and old rules remain.
- Start `feature`, then reveal an SQL migration. Confirm new security/testing/configuration rules appear.
- Submit an empty final review. It must fail if any `must` rule is active.
- Mark a must rule `pass` without evidence. It must fail.
- Mark a must rule `not_applicable` without justification. It must fail.
- Normal `feature` work must not contain safety-critical-only rules.
- Explicit `safety_critical` must include safety-critical rules.
- Unknown rule IDs in review items must be reported, not silently accepted.

## Evaluation rubric (100)

- 20: MCP tool contracts are clear enough that an agent knows when to call initial/update/review tools.
- 25: Dynamic rule expansion is additive and detects scope revealed by changed files/events.
- 25: Final compliance gate is complete, evidence-based, and cannot pass by omitting must rules.
- 15: Rule selection does not overclaim semantic code verification and safety-critical rules are properly isolated.
- 15: Code is portable, deterministic, reasonably simple, and uses current MCP v2 APIs correctly.

Return:
- score /100
- PASS only if score >= 85 and no critical flaw
- critical flaws
- false-positive/false-negative risks
- concrete code changes recommended
- whether this is ready for a real Claude Code A/B test
