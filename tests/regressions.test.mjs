import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { RULES, selectRules, updateActiveRules, validateReview, inferFromFiles } from '../src/engine.mjs';
import { FileTaskStore } from '../src/tasks.mjs';

const fixture = t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'engineering-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return {dir, store: new FileTaskStore(dir)};
};
const evidence = ids => ids.map(rule_id => ({rule_id, status:'pass', evidence:'Synthetic fixture: verifies gate mechanics only.'}));

test('boolean safety flag activates all safety-only requirements independently', () => {
  const safety = RULES.filter(r => r.scope.includes('safety_critical') && !r.scope.includes('general')).map(r => r.id);
  for (const signals of [{taskType:'feature',safetyCritical:true}, {taskType:'safety_critical'}, {triggers:['safety_critical']}]) {
    const selected = selectRules(signals).active_rule_ids;
    assert.ok(safety.every(id => selected.includes(id)));
  }
});
test('unknown classifications and active IDs fail closed', () => {
  for (const signals of [{taskType:'authentcation'},{categories:['TYPO']},{triggers:['TYPO']}]) assert.throws(() => selectRules(signals), /Unknown/);
  assert.throws(() => updateActiveRules(['TYPO']), /Unknown/);
  assert.equal(validateReview(['TYPO'], []).complete, false);
  assert.equal(validateReview([], []).complete, false);
});
test('Windows paths yield identical signals to POSIX paths', () => {
  for (const file of ['src/auth/login.ts','src/migrations/001.ts','project/package.json','.github/workflows/ci.yml']) assert.deepEqual(inferFromFiles([file.replaceAll('/', '\\')]), inferFromFiles([file]));
});
test('duplicate, invalid-status and inactive review items cannot produce success', () => {
  const [a,b] = RULES;
  for (const statuses of [['fail','pass'],['pass','fail'],['pass','pass']]) {
    const result = validateReview([a.id], statuses.map(status => ({rule_id:a.id,status,evidence:'fixture'})));
    assert.equal(result.complete, false);
    assert.deepEqual(result.duplicate_review_items,[a.id]);
  }
  assert.equal(validateReview([a.id],[{rule_id:a.id,status:'banana'}]).complete,false);
  assert.equal(validateReview([a.id],[...evidence([a.id]), {rule_id:b.id,status:'fail',evidence:'failure'}]).complete,false);
});
test('task rules survive new store instances and reject partial reviews', t => {
  const {dir,store} = fixture(t);
  const first = store.create({taskType:'feature'});
  assert.throws(() => store.validate(first.task_id,1,[]), /preparation/);
  const next = new FileTaskStore(dir).update(first.task_id,{changedFiles:['package.json']});
  assert.ok(first.active_rule_ids.every(id => next.active_rule_ids.includes(id)));
  const review = new FileTaskStore(dir).prepare(first.task_id,['db/migrations/001.sql'],{});
  const resumed = new FileTaskStore(dir);
  assert.equal(resumed.validate(first.task_id,review.review_revision,[]).complete,false);
  assert.equal(resumed.validate(first.task_id,review.review_revision,evidence(review.active_rule_ids.slice(0,1))).complete,false);
  assert.equal(resumed.validate(first.task_id,review.review_revision,evidence(review.active_rule_ids)).complete,true);
  assert.ok(review.active_rule_ids.length > next.active_rule_ids.length);
});
test('scope updates and re-preparation invalidate old review revisions', t => {
  const {store} = fixture(t), first = store.create({taskType:'feature'});
  const old = store.prepare(first.task_id,[],{});
  store.update(first.task_id,{});
  assert.throws(() => store.validate(first.task_id,old.review_revision,evidence(old.active_rule_ids)), /stale/);
  const fresh = store.prepare(first.task_id,[],{});
  assert.equal(store.validate(first.task_id,fresh.review_revision,evidence(fresh.active_rule_ids)).complete,true);
  store.prepare(first.task_id,[],{});
  assert.throws(() => store.validate(first.task_id,fresh.review_revision,[]), /stale/);
});
test('unknown tasks, corrupt state, changed rules and concurrent locks fail closed', t => {
  const {store,dir} = fixture(t), first = store.create({taskType:'feature'});
  assert.throws(() => store.update('../escape',{}), /Invalid/);
  assert.throws(() => store.update('00000000-0000-4000-8000-000000000000',{}), /Unknown/);
  const file = path.join(dir,first.task_id+'.json');
  fs.mkdirSync(file+'.lock');
  assert.throws(() => store.update(first.task_id,{}), /busy/);
  fs.rmdirSync(file+'.lock');
  const original = JSON.parse(fs.readFileSync(file,'utf8'));
  fs.writeFileSync(file,JSON.stringify({...original,rulesVersion:'changed'}));
  assert.throws(() => store.update(first.task_id,{}), /outdated/);
  fs.writeFileSync(file,'broken json');
  assert.throws(() => store.update(first.task_id,{}), /unreadable/);
});
