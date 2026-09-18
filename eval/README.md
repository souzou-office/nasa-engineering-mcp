# Evaluation bundle

This folder is designed for an independent second-model review (for example Astra).

- `ASTRA_EVAL_PROMPT.md`: evaluator instructions and scoring rubric.
- `cases.json`: deterministic adversarial cases.
- `run-eval.mjs`: executable deterministic evaluator for the rule engine.
- `baseline_results.json`: baseline output from this build; do not treat it as proof of correctness.

Recommended independent procedure:

```bash
npm install
npm run check
npm test
npm run eval
```

Then inspect `src/engine.mjs` and `src/server.mjs` manually. In particular, challenge the additive update behavior, final MUST-rule completeness gate, safety-critical isolation, false-positive rule routing, and whether the MCP tool descriptions are strong enough to induce correct call order in a real coding agent.
