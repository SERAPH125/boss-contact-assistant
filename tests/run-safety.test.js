const test = require('node:test');
const assert = require('node:assert/strict');

const {
  applyContactRecord,
  canResetRun,
  canSwitchPlatform,
  checkpoint,
  snapshotRunConfig,
  validateJobPlatform,
  waitCancellable
} = require('../src/run-safety.js');

test('snapshots platform configuration without retaining mutable references', () => {
  const source = {
    activePlatform: 'boss',
    processed: { a: 1 },
    nested: { value: 3 }
  };
  const snapshot = snapshotRunConfig(source);
  source.activePlatform = 'zhilian';
  source.processed.b = 1;
  source.nested.value = 9;

  assert.equal(snapshot.activePlatform, 'boss');
  assert.deepEqual(snapshot.processed, { a: 1 });
  assert.equal(snapshot.nested.value, 3);
});

test('checkpoint fails closed after cancellation', () => {
  assert.throws(
    () => checkpoint({ aborted: true, blocked: false }),
    (error) => error && error.code === 'RUN_CANCELLED'
  );
});

test('rejects jobs from a different platform', () => {
  assert.throws(
    () => validateJobPlatform({ id: 'job-1', platform: 'zhilian' }, 'boss'),
    (error) => error && error.code === 'PLATFORM_MISMATCH'
  );
});

test('prevents platform switching while a run is active', () => {
  assert.equal(canSwitchPlatform(true, 'boss', 'zhilian'), false);
  assert.equal(canSwitchPlatform(true, 'boss', 'boss'), true);
  assert.equal(canSwitchPlatform(false, 'boss', 'zhilian'), true);
});

test('prevents session reset while a run is active', () => {
  assert.equal(canResetRun(true), false);
  assert.equal(canResetRun(false), true);
});

test('cancellable waits stop at the first cancelled checkpoint', async () => {
  let sleeps = 0;
  let cancelled = false;
  await assert.rejects(
    waitCancellable(1000, {
      stepMs: 100,
      isCancelled: () => cancelled,
      sleep: async () => {
        sleeps += 1;
        cancelled = true;
      }
    }),
    (error) => error && error.code === 'RUN_CANCELLED'
  );
  assert.equal(sleeps, 1);
});

test('records a contact and daily usage atomically without double counting', () => {
  const first = applyContactRecord({
    contactDay: '2026-07-24',
    contactCount: 3,
    dailyLimit: '20',
    processed: {}
  }, 'job-1', '2026-07-24');
  assert.equal(first.config.contactCount, 4);
  assert.equal(first.config.processed['job-1'], 1);
  assert.equal(first.added, true);

  const duplicate = applyContactRecord(first.config, 'job-1', '2026-07-24');
  assert.equal(duplicate.config.contactCount, 4);
  assert.equal(duplicate.added, false);
});
