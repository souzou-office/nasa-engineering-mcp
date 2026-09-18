import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.resolve(here, '../data/nasa_rules.json');
const doc = JSON.parse(fs.readFileSync(DATA_PATH, 'utf8'));

export const RULES = doc.rules;
export const RULE_BY_ID = new Map(RULES.map(r => [r.id, r]));

export const TASK_PROFILES = {
  feature: { categories: ['requirements','implementation'], triggers: ['new_feature','code_change'] },
  bugfix: { categories: ['defect'], triggers: ['bug_fix','defect_found','code_change','regression'] },
  refactor: { categories: ['quality','design'], triggers: ['complex_change','architecture_change','code_change'] },
  security: { categories: ['security','risk'], triggers: ['security_review','security_sensitive','security_risk'] },
  authentication: { categories: ['security'], triggers: ['authentication','security_sensitive','code_change'] },
  database: { categories: ['security'], triggers: ['external_interface','code_change'] },
  dependency: { categories: ['dependency'], triggers: ['dependency_added','dependency_update','external_component'] },
  ai_generated_code: { categories: ['ai_generated_code','tooling'], triggers: ['generated_code','code_generated','ai_agent'] },
  release: { categories: ['release'], triggers: ['release','release_candidate','test_completed','configuration_audit'] },
  architecture: { categories: ['architecture','design'], triggers: ['architecture_change','major_feature'] },
  maintenance: { categories: ['maintenance','defect'], triggers: ['maintenance_change','code_change'] },
  safety_critical: { categories: ['safety','assurance'], triggers: ['safety_critical','critical_feature','high_risk'] }
};

const FILE_SIGNAL_RULES = [
  { test: /(^|\/)(auth|oauth|session|permission|permissions|rbac|acl)(\/|\.|$)/i, categories: ['security'], triggers: ['authentication','security_sensitive'] },
  { test: /(^|\/)(migrations?|schema)(\/|\.|$)|\.sql$/i, categories: ['security'], triggers: ['external_interface','code_change','change_made'] },
  { test: /(^|\/)(package(-lock)?\.json|pnpm-lock\.yaml|yarn\.lock|requirements\.txt|pyproject\.toml|poetry\.lock|go\.mod|Cargo\.toml)$/i, categories: ['dependency'], triggers: ['dependency_update','external_component'] },
  { test: /(^|\/)(Dockerfile|docker-compose\.ya?ml|compose\.ya?ml)$/i, categories: ['configuration'], triggers: ['config_change','build'] },
  { test: /(^|\/)\.github\/workflows\//i, categories: ['configuration','release'], triggers: ['build','release_candidate'] },
  { test: /(^|\/)(test|tests|__tests__|spec)(\/|\.|$)|\.(test|spec)\.[^.]+$/i, categories: ['testing'], triggers: ['test_run'] },
  { test: /(^|\/)(generated|codegen)(\/|\.|$)/i, categories: ['ai_generated_code','tooling'], triggers: ['generated_code'] },
  { test: /(^|\/)(api|routes?|controllers?)(\/|\.|$)/i, categories: ['security'], triggers: ['external_interface','code_change'] }
];

const BASE_CODE_TRIGGERS = ['ai_agent'];
const uniq = values => [...new Set(values.filter(Boolean))].sort();

export function catalog() {
  return {
    rule_count: RULES.length,
    task_types: Object.keys(TASK_PROFILES).sort(),
    categories: uniq(RULES.map(r => r.category)),
    triggers: uniq(RULES.flatMap(r => r.trigger)),
    phases: uniq(RULES.flatMap(r => r.phase)),
    tags: uniq(RULES.flatMap(r => r.tags))
  };
}

export function inferFromFiles(files = []) {
  const categories = [], triggers = [];
  for (const file of files) for (const entry of FILE_SIGNAL_RULES) if (entry.test.test(file)) {
    categories.push(...entry.categories); triggers.push(...entry.triggers);
  }
  return { categories: uniq(categories), triggers: uniq(triggers) };
}

const summary = rule => ({ id: rule.id, severity: rule.severity, category: rule.category, rule: rule.rule, source_id: rule.source_id });

export function selectRules(signals = {}) {
  const profile = signals.taskType ? TASK_PROFILES[signals.taskType] : undefined;
  const fileSignals = inferFromFiles(signals.changedFiles ?? []);
  const categories = uniq([...(profile?.categories ?? []), ...(signals.categories ?? []), ...fileSignals.categories]);
  const triggers = uniq([...(profile?.triggers ?? []), ...(signals.triggers ?? []), ...fileSignals.triggers, ...BASE_CODE_TRIGGERS]);
  const safety = signals.safetyCritical === true || signals.taskType === 'safety_critical' || triggers.includes('safety_critical');
  let excludedSafety = 0;
  const selected = RULES.filter(rule => {
    const isSafetyOnly = rule.scope.includes('safety_critical') && !rule.scope.includes('general');
    if (isSafetyOnly && !safety) { excludedSafety++; return false; }
    return categories.includes(rule.category) || rule.trigger.some(t => triggers.includes(t));
  });
  selected.sort((a,b) => ((a.severity === 'must' ? 0 : 1) - (b.severity === 'must' ? 0 : 1)) || a.category.localeCompare(b.category) || a.id.localeCompare(b.id));
  return { active_rule_ids: selected.map(r => r.id), rules: selected.map(summary), matched_categories: categories, matched_triggers: triggers, inferred_from_files: fileSignals, excluded_safety_critical: excludedSafety };
}

export function updateActiveRules(currentRuleIds = [], signals = {}) {
  const next = selectRules(signals);
  const current = new Set(currentRuleIds.filter(id => RULE_BY_ID.has(id)));
  const added = next.active_rule_ids.filter(id => !current.has(id));
  const active = uniq([...current, ...next.active_rule_ids]);
  return { added_rule_ids: added, added_rules: added.map(id => summary(RULE_BY_ID.get(id))), active_rule_ids: active, active_count: active.length, newly_matched_categories: next.matched_categories, newly_matched_triggers: next.matched_triggers, inferred_from_files: next.inferred_from_files, note: 'Dynamic updates are additive by default: previously active rules remain active for the task.' };
}

export function lookupRules(ids, detail = 'full') {
  return ids.map(id => {
    const rule = RULE_BY_ID.get(id);
    if (!rule) return { id, found: false };
    return detail === 'summary' ? { found: true, ...summary(rule) } : { found: true, ...rule };
  });
}

export function searchRules(query = '', categories = [], tags = [], severity) {
  const q = query.trim().toLowerCase();
  return RULES.filter(rule => {
    if (categories.length && !categories.includes(rule.category)) return false;
    if (tags.length && !tags.some(t => rule.tags.includes(t))) return false;
    if (severity && rule.severity !== severity) return false;
    if (!q) return true;
    const hay = [rule.id,rule.source_id,rule.category,rule.rule,...rule.checks,...rule.tags,...rule.trigger].join(' ').toLowerCase();
    return hay.includes(q);
  }).map(summary);
}

export function prepareReview(activeRuleIds = [], changedFiles = [], extraSignals = {}) {
  const updated = updateActiveRules(activeRuleIds, { ...extraSignals, changedFiles: [...(extraSignals.changedFiles ?? []), ...changedFiles] });
  const rules = updated.active_rule_ids.map(id => RULE_BY_ID.get(id)).filter(Boolean);
  return {
    active_rule_ids: updated.active_rule_ids,
    dynamically_added_rule_ids: updated.added_rule_ids,
    checklist: rules.map(rule => ({ rule_id: rule.id, severity: rule.severity, category: rule.category, requirement: rule.rule, checks: rule.checks, required_response: rule.severity === 'must' ? 'pass with evidence, fail with evidence, or not_applicable with justification' : 'pass/fail/not_applicable recommended' })),
    instruction: 'Review the actual diff/code against every active must rule. Do not infer pass from rule selection alone.'
  };
}

export function validateReview(activeRuleIds = [], items = []) {
  const activeRules = activeRuleIds.map(id => RULE_BY_ID.get(id)).filter(Boolean);
  const itemMap = new Map(items.map(i => [i.rule_id, i]));
  const missingMust = [], failures = [], invalidEvidence = [];
  const unknownItems = items.filter(i => !RULE_BY_ID.has(i.rule_id)).map(i => i.rule_id);
  for (const rule of activeRules) {
    const item = itemMap.get(rule.id);
    if (!item) { if (rule.severity === 'must') missingMust.push(rule.id); continue; }
    if (item.status === 'fail') failures.push({ rule_id: rule.id, evidence: item.evidence });
    if ((item.status === 'pass' || item.status === 'fail') && !item.evidence?.trim()) invalidEvidence.push({ rule_id: rule.id, reason: 'pass/fail requires concrete evidence' });
    if (item.status === 'not_applicable' && !item.justification?.trim()) invalidEvidence.push({ rule_id: rule.id, reason: 'not_applicable requires justification' });
  }
  const shouldUnreviewed = activeRules.filter(r => r.severity === 'should' && !itemMap.has(r.id)).map(r => r.id);
  const complete = missingMust.length === 0 && failures.length === 0 && invalidEvidence.length === 0 && unknownItems.length === 0;
  return { complete, blocking_failures: failures, missing_must_rules: missingMust, invalid_evidence: invalidEvidence, unreviewed_should_rules: shouldUnreviewed, unknown_review_items: unknownItems, reviewed_count: items.length, active_count: activeRules.length };
}
