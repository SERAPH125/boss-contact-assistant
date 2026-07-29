const test = require('node:test');
const assert = require('node:assert/strict');

const DeliveryGuard = require('../src/delivery-guard.js');

const jobs = [
  { id: 'a', platform: 'boss', name: '前端', company: '甲公司' },
  { id: 'b', platform: 'boss', name: '后端', company: '乙公司' },
  { id: 'c', platform: 'boss', name: '测试', company: '丙公司' },
  { id: 'd', platform: 'boss', name: '产品', company: '丁公司' },
  { id: 'z', platform: 'zhilian', name: '测试', company: '智联公司' }
];

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

test('prepares one batch while excluding previously contacted jobs', () => {
  const plan = DeliveryGuard.prepare({
    platformId: 'boss',
    selectedIds: ['a', 'a', 'b'],
    jobs,
    processed: { a: 1 },
    usageCount: 3,
    dailyLimit: 20,
    intervalMinSec: 10,
    intervalMaxSec: 25,
    batchSize: 5,
    batchRestMinSec: 45,
    batchRestMaxSec: 90,
    sendsResumeImage: true
  });

  assert.deepEqual(plan.selectedIds, ['a', 'b']);
  assert.deepEqual(plan.executableIds, ['b']);
  assert.deepEqual(plan.jobs, [{ id: 'b', name: '后端', company: '乙公司' }]);
  assert.equal(plan.skippedProcessedCount, 1);
  assert.equal(plan.remainingAfter, 16);
  assert.equal(plan.sendsResumeImage, true);
  assert.equal(plan.deliveryMode, 'CONTACT_ONLY');
});

test('accepts only the two explicit mutually exclusive delivery modes', () => {
  const trusteeshipPlan = DeliveryGuard.prepare({
    platformId: 'boss',
    deliveryMode: 'CONTACT_AND_TRUSTEESHIP',
    selectedIds: ['a'],
    jobs,
    processed: {},
    usageCount: 0,
    dailyLimit: 20
  });

  assert.equal(trusteeshipPlan.deliveryMode, 'CONTACT_AND_TRUSTEESHIP');
  assert.throws(() => DeliveryGuard.prepare({
    platformId: 'boss',
    deliveryMode: 'CONTACT_AND_SOMETHING_ELSE',
    selectedIds: ['a'],
    jobs,
    processed: {},
    usageCount: 0,
    dailyLimit: 20
  }), (error) => error.code === 'DELIVERY_MODE_INVALID');

  assert.throws(() => DeliveryGuard.prepare({
    platformId: 'zhilian',
    deliveryMode: 'CONTACT_AND_TRUSTEESHIP',
    selectedIds: ['z'],
    jobs,
    processed: {},
    usageCount: 0,
    dailyLimit: 20
  }), (error) => error.code === 'TRUSTEESHIP_PLATFORM_UNSUPPORTED');
});

test('rejects empty, stale, and cross-platform selections', () => {
  assert.throws(() => DeliveryGuard.prepare({
    platformId: 'boss',
    selectedIds: [],
    jobs,
    processed: {},
    usageCount: 0,
    dailyLimit: 20
  }), (error) => error.code === 'NO_SELECTION');

  assert.throws(() => DeliveryGuard.prepare({
    platformId: 'boss',
    selectedIds: ['missing'],
    jobs,
    processed: {},
    usageCount: 0,
    dailyLimit: 20
  }), (error) => error.code === 'STALE_REVIEW');

  assert.throws(() => DeliveryGuard.prepare({
    platformId: 'boss',
    selectedIds: ['z'],
    jobs,
    processed: {},
    usageCount: 0,
    dailyLimit: 20
  }), (error) => error.code === 'PLATFORM_MISMATCH');
});

test('rejects batches with no available jobs or insufficient daily allowance', () => {
  assert.throws(() => DeliveryGuard.prepare({
    platformId: 'boss',
    selectedIds: ['a'],
    jobs,
    processed: { a: 1 },
    usageCount: 1,
    dailyLimit: 20
  }), (error) => error.code === 'NO_AVAILABLE_JOBS');

  assert.throws(() => DeliveryGuard.prepare({
    platformId: 'boss',
    selectedIds: ['a'],
    jobs,
    processed: {},
    usageCount: 20,
    dailyLimit: 20
  }), (error) => error.code === 'DAILY_LIMIT_REACHED');

  assert.throws(() => DeliveryGuard.prepare({
    platformId: 'boss',
    selectedIds: ['a', 'b'],
    jobs,
    processed: {},
    usageCount: 19,
    dailyLimit: 20
  }), (error) => error.code === 'DAILY_LIMIT_EXCEEDED');
});

test('estimates ordinary intervals and cross-batch rests', () => {
  const config = {
    intervalMinSec: 10,
    intervalMaxSec: 25,
    batchSize: 2,
    batchRestMinSec: 45,
    batchRestMaxSec: 90
  };

  assert.deepEqual(
    DeliveryGuard.estimateWaitSeconds(1, config),
    { minSec: 0, maxSec: 0 }
  );
  assert.deepEqual(
    DeliveryGuard.estimateWaitSeconds(4, config),
    { minSec: 65, maxSec: 140 }
  );
});

test('provides a human next action for each trust-gate error', () => {
  const expired = DeliveryGuard.guidanceFor('INTENT_EXPIRED');
  assert.match(expired.message, /失效|超过/);
  assert.match(expired.nextAction, /重新确认/);

  const unknown = DeliveryGuard.guidanceFor('UNKNOWN_CODE');
  assert.ok(unknown.message);
  assert.ok(unknown.nextAction);
});

test('creates a two-minute intent that freezes the executable job list', async () => {
  const storage = memoryStorage();
  const store = DeliveryGuard.createIntentStore(storage, () => 1000, () => 'intent-1');

  const created = await store.create({
    platformId: 'boss',
    deliveryMode: 'CONTACT_AND_TRUSTEESHIP',
    executableIds: ['a', 'b'],
    selectedCount: 2,
    executableCount: 2,
    jobs: jobs.slice(0, 2)
  });

  assert.equal(created.id, 'intent-1');
  assert.equal(created.expiresAt, 121000);
  assert.deepEqual(created.jobIds, ['a', 'b']);
  assert.equal(created.deliveryMode, 'CONTACT_AND_TRUSTEESHIP');
  assert.equal(created.status, 'pending');
  assert.deepEqual(storage.data.sw_pending_delivery.jobIds, ['a', 'b']);
  assert.equal(storage.data.sw_pending_delivery.deliveryMode, 'CONTACT_AND_TRUSTEESHIP');
});

test('consumes one intent exactly once even when two consumers race', async () => {
  const storage = memoryStorage();
  const store = DeliveryGuard.createIntentStore(storage, () => 1000, () => 'intent-2');
  await store.create({
    platformId: 'boss',
    executableIds: ['a'],
    selectedCount: 1,
    executableCount: 1
  });

  const settled = await Promise.allSettled([
    store.consume('intent-2'),
    store.consume('intent-2')
  ]);

  assert.equal(settled.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(settled.filter((item) =>
    item.status === 'rejected' && item.reason.code === 'INTENT_ALREADY_USED'
  ).length, 1);
});

test('rejects expired, cancelled, missing, and wrong-id intents', async () => {
  const storage = memoryStorage();
  let now = 1000;
  let idCounter = 0;
  const store = DeliveryGuard.createIntentStore(
    storage,
    () => now,
    () => 'intent-' + (++idCounter)
  );

  await store.create({ platformId: 'boss', executableIds: ['a'] });
  now = 121000;
  await assert.rejects(
    store.consume('intent-1'),
    (error) => error.code === 'INTENT_EXPIRED'
  );

  now = 200000;
  await store.create({ platformId: 'boss', executableIds: ['a'] });
  await assert.rejects(
    store.consume('wrong-id'),
    (error) => error.code === 'INTENT_NOT_FOUND'
  );
  await store.cancel('intent-2');
  await assert.rejects(
    store.consume('intent-2'),
    (error) => error.code === 'INTENT_NOT_FOUND'
  );

  const empty = DeliveryGuard.createIntentStore(memoryStorage(), () => now, () => 'unused');
  await assert.rejects(
    empty.consume('missing'),
    (error) => error.code === 'INTENT_NOT_FOUND'
  );
});

test('a new intent invalidates the previously pending confirmation', async () => {
  const storage = memoryStorage();
  let idCounter = 0;
  const store = DeliveryGuard.createIntentStore(
    storage,
    () => 1000,
    () => 'intent-' + (++idCounter)
  );

  await store.create({ platformId: 'boss', executableIds: ['a'] });
  const latest = await store.create({ platformId: 'boss', executableIds: ['b'] });

  assert.equal(latest.id, 'intent-2');
  assert.deepEqual(latest.jobIds, ['b']);
  await assert.rejects(
    store.consume('intent-1'),
    (error) => error.code === 'INTENT_NOT_FOUND'
  );
});

test('requires the consumed intent and its mutually exclusive mode to match the rebuilt plan', () => {
  const intent = {
    platformId: 'boss',
    deliveryMode: 'CONTACT_AND_TRUSTEESHIP',
    jobIds: ['a', 'b']
  };
  DeliveryGuard.assertIntentMatchesPlan(intent, {
    platformId: 'boss',
    deliveryMode: 'CONTACT_AND_TRUSTEESHIP',
    executableIds: ['a', 'b']
  });

  assert.throws(() => DeliveryGuard.assertIntentMatchesPlan(intent, {
    platformId: 'boss',
    deliveryMode: 'CONTACT_AND_TRUSTEESHIP',
    executableIds: ['a']
  }), (error) => error.code === 'STALE_REVIEW');

  assert.throws(() => DeliveryGuard.assertIntentMatchesPlan(intent, {
    platformId: 'zhilian',
    deliveryMode: 'CONTACT_AND_TRUSTEESHIP',
    executableIds: ['a', 'b']
  }), (error) => error.code === 'PLATFORM_MISMATCH');

  assert.throws(() => DeliveryGuard.assertIntentMatchesPlan(intent, {
    platformId: 'boss',
    deliveryMode: 'CONTACT_ONLY',
    executableIds: ['a', 'b']
  }), (error) => error.code === 'STALE_REVIEW');
});
