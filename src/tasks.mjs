import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { RULES, selectRules, updateActiveRules, prepareReview, validateReview, assertKnownRuleIds } from './engine.mjs';

const rulesVersion = createHash('sha256').update(JSON.stringify(RULES)).digest('hex');
const taskPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

// Shared by all HTTP request handlers and survives Node process restarts.
// A per-task exclusive lock prevents lost updates across local processes.
export class FileTaskStore {
  constructor(directory = process.env.ENGINEERING_STATE_DIR ?? path.resolve('.engineering-state')) {
    this.directory = path.resolve(directory);
  }

  create(signals) {
    const selected = selectRules(signals);
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    const taskId = randomUUID();
    const task = { taskId, revision: 1, preparedRevision: null, rulesVersion, activeRuleIds: selected.active_rule_ids };
    fs.writeFileSync(path.join(this.directory, taskId + '.json'), JSON.stringify(task), { flag: 'wx', mode: 0o600 });
    return { ...selected, task_id: taskId, revision: task.revision };
  }

  transaction(taskId, operation) {
    if (!taskPattern.test(taskId)) throw new Error('Invalid taskId');
    const file = path.join(this.directory, taskId + '.json');
    const lock = file + '.lock';
    try { fs.mkdirSync(lock, { mode: 0o700 }); }
    catch (error) {
      if (error.code === 'EEXIST') throw new Error('Task is busy or has a stale lock; retry or inspect the state directory.');
      if (error.code === 'ENOENT') throw new Error('Unknown taskId; start a new task.');
      throw error;
    }
    const temp = file + '.' + randomUUID() + '.tmp';
    try {
      let task;
      try { task = JSON.parse(fs.readFileSync(file, 'utf8')); }
      catch (error) {
        if (error.code === 'ENOENT') throw new Error('Unknown taskId; start a new task.');
        throw new Error('Task state is unreadable; refusing to reset review obligations.');
      }
      if (task.taskId !== taskId || task.rulesVersion !== rulesVersion || !Number.isSafeInteger(task.revision) || task.revision < 1 || !Array.isArray(task.activeRuleIds) || !task.activeRuleIds.length) throw new Error('Invalid or outdated task state; restart the task with its full scope.');
      assertKnownRuleIds(task.activeRuleIds);
      const { result, changed = false } = operation(task);
      if (changed) {
        fs.writeFileSync(temp, JSON.stringify(task), { flag: 'wx', mode: 0o600 });
        fs.renameSync(temp, file);
      }
      return result;
    } finally {
      fs.rmSync(temp, { force: true });
      fs.rmdirSync(lock);
    }
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
      if (!Number.isSafeInteger(reviewRevision) || task.preparedRevision === null || reviewRevision !== task.preparedRevision || reviewRevision !== task.revision) throw new Error('Missing or stale review preparation; call engineering_prepare_review again.');
      return { result: { ...validateReview(task.activeRuleIds, items), task_id: taskId, review_revision: reviewRevision } };
    });
  }
}
