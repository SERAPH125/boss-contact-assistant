// 持久运行记录：Service Worker 意外终止后只阻塞，不自动重放外部动作
(function (g, factory) {
  var api = factory();
  g.RunStore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  var KEY = 'sw_active_run';

  function createRunStore(storage, clock) {
    var now = clock || function () { return Date.now(); };
    var tail = Promise.resolve();

    function serialized(operation) {
      var result = tail.then(operation, operation);
      tail = result.catch(function () {});
      return result;
    }

    async function current() {
      var data = await storage.get(KEY);
      return (data && data[KEY]) || null;
    }

    function start(input) {
      return serialized(async function () {
        var timestamp = now();
        var record = Object.assign({
          id: 'run-' + timestamp,
          kind: 'unknown',
          platformId: 'boss',
          phase: 'idle',
          status: 'running',
          cursor: 0,
          total: 0,
          results: [],
          startedAt: timestamp
        }, input || {}, {
          status: 'running',
          updatedAt: timestamp
        });
        await storage.set({ [KEY]: record });
        return record;
      });
    }

    function patch(fields) {
      return serialized(async function () {
        var record = await current();
        if (!record) return null;
        var next = Object.assign({}, record, fields || {}, { updatedAt: now() });
        await storage.set({ [KEY]: next });
        return next;
      });
    }

    function finish(status, fields) {
      return serialized(async function () {
        var record = await current();
        if (!record) return null;
        var timestamp = now();
        var next = Object.assign({}, record, fields || {}, {
          status: status,
          updatedAt: timestamp,
          finishedAt: timestamp
        });
        await storage.set({ [KEY]: next });
        return next;
      });
    }

    function recoverInterrupted() {
      return serialized(async function () {
        var record = await current();
        if (!record || record.status !== 'running') return null;
        var timestamp = now();
        var blocked = Object.assign({}, record, {
          status: 'blocked',
          phase: 'blocked',
          reason: 'service_worker_interrupted',
          updatedAt: timestamp,
          finishedAt: timestamp
        });
        await storage.set({ [KEY]: blocked });
        return blocked;
      });
    }

    return {
      current: current,
      finish: finish,
      patch: patch,
      recoverInterrupted: recoverInterrupted,
      start: start
    };
  }

  return {
    KEY: KEY,
    createRunStore: createRunStore
  };
});
