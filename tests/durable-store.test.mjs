import test from 'node:test';
import assert from 'node:assert/strict';
import { DurableTaskStore, EngineeringTask } from '../src/durable-task-store.mjs';

class MemoryStorage {
  constructor() { this.values = new Map(); }
  async get(key) { return structuredClone(this.values.get(key)); }
  async put(key, value) { this.values.set(key, structuredClone(value)); }
}

class MemoryNamespace {
  constructor() { this.objects = new Map(); }
  idFromName(name) { return name; }
  get(id) {
    if (!this.objects.has(id)) {
      const storage = new MemoryStorage();
      const ctx = { storage, blockConcurrencyWhile: operation => operation() };
      const object = new EngineeringTask(ctx);
      this.objects.set(id, {
        fetch: (input, init) => object.fetch(new Request(input, init))
      });
    }
    return this.objects.get(id);
  }
}

const evidence = ids => ids.map(rule_id => ({
  rule_id,
  status: 'pass',
  evidence: 'Synthetic Durable Object fixture.'
}));

test('Durable Object store retains additive rules and review revisions', async () => {
  const store = new DurableTaskStore(new MemoryNamespace());
  const first = await store.create({ taskType: 'feature' });
  const updated = await store.update(first.task_id, { changedFiles: ['package.json'] });
  assert.ok(updated.active_rule_ids.length > first.active_rule_ids.length);
  const prepared = await store.prepare(first.task_id, ['db/migrations/001.sql'], {});
  assert.ok(prepared.active_rule_ids.length > updated.active_rule_ids.length);
  const incomplete = await store.validate(first.task_id, prepared.review_revision, []);
  assert.equal(incomplete.complete, false);
  const complete = await store.validate(
    first.task_id,
    prepared.review_revision,
    evidence(prepared.active_rule_ids)
  );
  assert.equal(complete.complete, true);
  await store.update(first.task_id, {});
  await assert.rejects(
    store.validate(first.task_id, prepared.review_revision, evidence(prepared.active_rule_ids)),
    /stale/
  );
});
