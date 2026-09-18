import { RULES, selectRules, updateActiveRules, prepareReview, validateReview, assertKnownRuleIds } from './engine.mjs';

const taskPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const rulesVersionPromise = crypto.subtle.digest(
  'SHA-256',
  new TextEncoder().encode(JSON.stringify(RULES))
).then(bytes => [...new Uint8Array(bytes)].map(value => value.toString(16).padStart(2, '0')).join(''));

function validateTask(task, taskId, rulesVersion) {
  if (
    task?.taskId !== taskId ||
    task?.rulesVersion !== rulesVersion ||
    !Number.isSafeInteger(task?.revision) ||
    task.revision < 1 ||
    !Array.isArray(task?.activeRuleIds) ||
    !task.activeRuleIds.length
  ) throw new Error('Invalid or outdated task state; restart the task with its full scope.');
  assertKnownRuleIds(task.activeRuleIds);
}

export class EngineeringTask {
  constructor(ctx) {
    this.ctx = ctx;
  }

  async fetch(request) {
    if (request.method !== 'POST') return new Response('Method Not Allowed', { status: 405 });
    try {
      const { operation, args = [] } = await request.json();
      if (!['create', 'update', 'prepare', 'validate'].includes(operation)) {
        throw new Error('Unknown task operation.');
      }
      return Response.json({ result: await this[operation](...args) });
    } catch (error) {
      return Response.json(
        { error: error instanceof Error ? error.message : 'Task operation failed.' },
        { status: 400 }
      );
    }
  }

  async create(taskId, signals) {
    return this.ctx.blockConcurrencyWhile(async () => {
      if (!taskPattern.test(taskId)) throw new Error('Invalid taskId');
      if (await this.ctx.storage.get('task')) throw new Error('Task already exists.');
      const selected = selectRules(signals);
      const task = {
        taskId,
        revision: 1,
        preparedRevision: null,
        rulesVersion: await rulesVersionPromise,
        activeRuleIds: selected.active_rule_ids
      };
      await this.ctx.storage.put('task', task);
      return { ...selected, task_id: taskId, revision: task.revision };
    });
  }

  async transaction(taskId, operation) {
    return this.ctx.blockConcurrencyWhile(async () => {
      if (!taskPattern.test(taskId)) throw new Error('Invalid taskId');
      const task = await this.ctx.storage.get('task');
      if (!task) throw new Error('Unknown taskId; start a new task.');
      validateTask(task, taskId, await rulesVersionPromise);
      const { result, changed = false } = operation(task);
      if (changed) await this.ctx.storage.put('task', task);
      return result;
    });
  }

  update(taskId, signals) {
    return this.transaction(taskId, task => {
      const updated = updateActiveRules(task.activeRuleIds, signals);
      task.activeRuleIds = updated.active_rule_ids;
      task.revision++;
      task.preparedRevision = null;
      return { changed: true, result: { ...updated, task_id: taskId, revision: task.revision } };
    });
  }

  prepare(taskId, files, signals) {
    return this.transaction(taskId, task => {
      const review = prepareReview(task.activeRuleIds, files, signals);
      task.activeRuleIds = review.active_rule_ids;
      task.revision++;
      task.preparedRevision = task.revision;
      return { changed: true, result: { ...review, task_id: taskId, review_revision: task.revision } };
    });
  }

  validate(taskId, reviewRevision, items) {
    return this.transaction(taskId, task => {
      if (
        !Number.isSafeInteger(reviewRevision) ||
        task.preparedRevision === null ||
        reviewRevision !== task.preparedRevision ||
        reviewRevision !== task.revision
      ) throw new Error('Missing or stale review preparation; call engineering_prepare_review again.');
      return {
        result: {
          ...validateReview(task.activeRuleIds, items),
          task_id: taskId,
          review_revision: reviewRevision
        }
      };
    });
  }
}

export class DurableTaskStore {
  constructor(namespace) {
    if (!namespace) throw new Error('ENGINEERING_TASKS Durable Object binding is required.');
    this.namespace = namespace;
  }

  stub(taskId) {
    if (!taskPattern.test(taskId)) throw new Error('Invalid taskId');
    return this.namespace.get(this.namespace.idFromName(taskId));
  }

  async call(taskId, operation, args) {
    const response = await this.stub(taskId).fetch('https://engineering-task.internal/', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ operation, args })
    });
    const payload = await response.json();
    if (!response.ok) throw new Error(payload.error ?? 'Task operation failed.');
    return payload.result;
  }

  async create(signals) {
    const taskId = crypto.randomUUID();
    return this.call(taskId, 'create', [taskId, signals]);
  }

  update(taskId, signals) {
    return this.call(taskId, 'update', [taskId, signals]);
  }

  prepare(taskId, files, signals) {
    return this.call(taskId, 'prepare', [taskId, files, signals]);
  }

  validate(taskId, reviewRevision, items) {
    return this.call(taskId, 'validate', [taskId, reviewRevision, items]);
  }
}
