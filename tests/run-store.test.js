const test = require('node:test');
const assert = require('node:assert/strict');

const { createRunStore } = require('../src/run-store.js');

function memoryStorage() {
  const data = {};
  return {
    data,
    async get(key) {
      if (typeof key === 'string') return { [key]: data[key] };
      return Object.assign({}, data);
    },
    async set(patch) {
      Object.assign(data, patch);
    }
  };
}

test('persists run start, checkpoints, and terminal state', async () => {
  const storage = memoryStorage();
  let now = 1000;
  const store = createRunStore(storage, () => ++now);

  const started = await store.start({
    id: 'run-1',
    kind: 'deliver',
    platformId: 'boss',
    total: 2
  });
  assert.equal(started.status, 'running');

  const patched = await store.patch({ cursor: 1, results: [{ id: 'a', ok: true }] });
  assert.equal(patched.cursor, 1);

  const finished = await store.finish('done', { cursor: 2 });
  assert.equal(finished.status, 'done');
  assert.equal(storage.data.sw_active_run.cursor, 2);
});

test('turns an interrupted running task into a blocked task without replaying it', async () => {
  const storage = memoryStorage();
  storage.data.sw_active_run = {
    id: 'run-2',
    kind: 'deliver',
    platformId: 'zhilian',
    status: 'running',
    cursor: 1
  };
  const store = createRunStore(storage, () => 2000);

  const recovered = await store.recoverInterrupted();

  assert.equal(recovered.status, 'blocked');
  assert.equal(recovered.reason, 'service_worker_interrupted');
  assert.equal(storage.data.sw_active_run.status, 'blocked');
});

test('does not rewrite an already terminal task during recovery', async () => {
  const storage = memoryStorage();
  storage.data.sw_active_run = { id: 'run-3', status: 'done' };
  const store = createRunStore(storage, () => 2000);

  assert.equal(await store.recoverInterrupted(), null);
  assert.equal(storage.data.sw_active_run.status, 'done');
});
