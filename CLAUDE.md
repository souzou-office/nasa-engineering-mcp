# Engineering rules integration

For any task that creates, modifies, refactors, debugs, or reviews code:

1. Before editing, call `engineering_rules_for_task` after classifying the request into the closest task type/categories/triggers.
2. Keep the returned `active_rule_ids` for the task.
3. Whenever scope expands or new implementation facts appear, call `engineering_update_active_rules` with the current IDs and the new signals/files. Never silently discard prior active rules.
4. After implementation, call `engineering_prepare_review` with the actual changed files.
5. Review the actual diff/code against every active MUST rule and produce evidence for each outcome.
6. Call `engineering_validate_review`. Do not declare completion while it reports blocking failures, missing MUST rules, or invalid evidence.

The MCP provides engineering rules and completeness checks; it does not itself prove semantic compliance with the code.
