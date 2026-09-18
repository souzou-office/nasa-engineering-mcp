# Engineering rules integration (v0.2)

For any task that creates, modifies, refactors, debugs, or reviews code:

1. Before editing, call `engineering_rules_for_task` after classifying the request using the catalog. Retain the returned `task_id`; do not start a new task to discard existing obligations.
2. Use returned `active_rule_ids` for inspection and `engineering_lookup`. The server owns the cumulative set.
3. Whenever scope expands or new implementation facts appear, call `engineering_update_active_rules` with `taskId` and the new signals/files. This invalidates any previous prepared review.
4. After implementation, call `engineering_prepare_review` with `taskId` and the actual changed files. Retain its `review_revision`.
5. Review the actual diff/code against every active MUST rule and produce specific evidence, or justify why a rule is not applicable. Each rule appears once.
6. Call `engineering_validate_review` with `taskId`, `reviewRevision`, and `reviewItems`. Do not send `activeRuleIds` or `currentRuleIds`. Do not declare completion while validation errors or blocking results remain.
7. After further edits, update scope and prepare again before validating. A revision is not a code-diff hash. If task state is missing, restart with the full prior and current scope; never treat state loss as a clean review.

The MCP validates rule coverage and evidence presence, not evidence truth or semantic code compliance. Unknown classifications must be corrected using `engineering_catalog`, not silently omitted.
