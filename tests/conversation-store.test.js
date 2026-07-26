const test = require('node:test');
const assert = require('node:assert/strict');

const ConversationStore = require('../src/conversation/conversation-store.js');
const CONVERSATION_STORE_PATH = require.resolve('../src/conversation/conversation-store.js');

const STORAGE_KEYS = [
  'conversationTrusteeship',
  'feishuNotification',
  'managedConversations',
  'pendingApprovals'
];

function memoryStorage(initial) {
  const data = Object.assign({}, initial || {});
  let setCalls = 0;
  let pendingSetFailures = 0;
  return {
    data,
    failNextSet() {
      pendingSetFailures += 1;
    },
    getSetCallCount() {
      return setCalls;
    },
    async get(keys) {
      if (typeof keys === 'string') return { [keys]: data[keys] };
      if (Array.isArray(keys)) {
        return keys.reduce((result, key) => {
          result[key] = data[key];
          return result;
        }, {});
      }
      return Object.assign({}, data);
    },
    async set(patch) {
      setCalls += 1;
      if (pendingSetFailures > 0) {
        pendingSetFailures -= 1;
        throw new Error('TRANSIENT_STORAGE_SET_FAILURE');
      }
      Object.assign(data, patch);
    }
  };
}

function makeHarness(initial) {
  let timestamp = Date.parse('2026-07-24T08:00:00+08:00');
  let sequence = 0;
  const storage = memoryStorage(initial);
  const store = ConversationStore.create(
    storage,
    () => timestamp,
    (kind) => `${kind}-${++sequence}`
  );
  return {
    storage,
    store,
    setTime(value) {
      timestamp = Date.parse(value);
    }
  };
}

function reliableRef(overrides) {
  return Object.assign({
    platform: 'boss',
    conversationId: 'conv-1',
    url: 'https://www.zhipin.com/web/geek/chat?conversation=conv-1',
    jobId: 'job-1',
    company: '甲公司',
    position: '前端',
    hrName: '李经理'
  }, overrides || {});
}

function loadFreshConversationStore() {
  delete require.cache[CONVERSATION_STORE_PATH];
  return require(CONVERSATION_STORE_PATH);
}

async function registerAndEnable(harness, overrides) {
  const saved = await harness.store.registerConversation(reliableRef(overrides));
  await harness.store.setManaged(saved.conversationId, true);
  return saved.conversationId;
}

async function createPendingApproval(harness, fingerprint, messages) {
  await harness.store.beginMessage('conv-1', fingerprint);
  return harness.store.createOrMergeApproval({
    conversationId: 'conv-1',
    incomingFingerprint: fingerprint,
    messages
  });
}

test('registers a contact disabled and refuses unreliable references', async () => {
  const harness = makeHarness();
  const badRefs = [
    reliableRef({ platform: 'zhilian' }),
    reliableRef({ conversationId: '' }),
    reliableRef({ conversationId: 'changes with spaces' }),
    reliableRef({ url: 'http://www.zhipin.com/web/geek/chat' }),
    reliableRef({ url: 'https://zhipin.com/web/geek/chat' }),
    reliableRef({ url: 'https://www.zhipin.com.evil.test/web/geek/chat' }),
    reliableRef({ url: 'https://www.zhipin.com/web/geek/recommend' }),
    reliableRef({ url: 'https://www.zhipin.com/web/geek/chat/conv-1' }),
    reliableRef({ jobId: '' })
  ];

  for (const ref of badRefs) {
    await assert.rejects(
      () => harness.store.registerConversation(ref),
      (error) => error.code === 'UNRELIABLE_CONVERSATION_REF'
    );
  }

  const saved = await harness.store.registerConversation(reliableRef());
  assert.equal(saved.enabled, false);
  assert.equal(saved.state, 'DISABLED');
  assert.deepEqual(Object.keys(harness.storage.data).sort(), STORAGE_KEYS.slice().sort());

  saved.company = '被外部修改';
  const snapshot = await harness.store.getSnapshot();
  assert.equal(snapshot.managedConversations['conv-1'].company, '甲公司');
});

test('migrates a legacy DOM conversation key onto encryptUid peer id with aliases', async () => {
  const harness = makeHarness();
  await harness.store.registerConversation(reliableRef({
    conversationId: 'dom-legacy-1',
    url: 'https://www.zhipin.com/web/geek/chat?conversationId=dom-legacy-1'
  }));
  await harness.store.setManaged('dom-legacy-1', true);
  await harness.store.beginMessage('dom-legacy-1', 'fp-1');
  await harness.store.createOrMergeApproval({
    conversationId: 'dom-legacy-1',
    incomingFingerprint: 'fp-1',
    messages: ['你好']
  });

  const migrated = await harness.store.registerConversation(reliableRef({
    conversationId: 'peer~~stable',
    url: 'https://www.zhipin.com/web/geek/chat?uid=peer~~stable',
    aliases: ['dom-legacy-1'],
    peerSource: 'encryptUid'
  }));
  assert.equal(migrated.conversationId, 'peer~~stable');
  assert.equal(migrated.peerSource, 'encryptUid');
  assert.ok(migrated.aliases.indexOf('dom-legacy-1') !== -1);
  assert.equal(migrated.enabled, true);

  const snapshot = await harness.store.getSnapshot();
  assert.equal(snapshot.managedConversations['dom-legacy-1'], undefined);
  assert.ok(snapshot.managedConversations['peer~~stable']);
  const approval = Object.values(snapshot.pendingApprovals)[0];
  assert.equal(approval.conversationId, 'peer~~stable');
});

test('preserves a reliable initial incoming fingerprint only when first registered', async () => {
  const harness = makeHarness();
  const saved = await harness.store.registerConversation(reliableRef({
    initialIncomingFingerprint: 'id:baseline-1'
  }));
  assert.equal(saved.lastIncomingFingerprint, 'id:baseline-1');

  const updated = await harness.store.registerConversation(reliableRef({
    company: '甲公司更新',
    initialIncomingFingerprint: 'id:must-not-overwrite'
  }));
  assert.equal(updated.lastIncomingFingerprint, 'id:baseline-1');

  const emptyHarness = makeHarness();
  const empty = await emptyHarness.store.registerConversation(reliableRef({
    initialIncomingFingerprint: ''
  }));
  assert.equal(empty.lastIncomingFingerprint, '');
});

test('normalizes settings and resets the daily counter when the local day changes', async () => {
  const harness = makeHarness({
    conversationTrusteeship: {
      enabled: true,
      intervalMinutes: 10,
      dailyAutoReplyLimit: 8,
      autoReplyDay: '2026-07-24',
      autoReplyCount: 7
    }
  });

  const settings = await harness.store.saveSettings({
    intervalMinutes: 15,
    dailyAutoReplyLimit: 99,
    quietHours: { enabled: true, start: '23:00', end: '07:30' },
    signingSecret: 'must-not-enter-settings'
  });
  assert.equal(settings.intervalMinutes, 15);
  assert.equal(settings.dailyAutoReplyLimit, 20);
  assert.equal(settings.autoReplyCount, 7);
  assert.equal(settings.signingSecret, undefined);

  harness.setTime('2026-07-25T08:00:00+08:00');
  const nextDay = await harness.store.getSnapshot();
  assert.equal(nextDay.conversationTrusteeship.autoReplyDay, '2026-07-25');
  assert.equal(nextDay.conversationTrusteeship.autoReplyCount, 0);
});

test('rejects illegal state transitions and keeps one message in flight', async () => {
  const harness = makeHarness();
  await harness.store.registerConversation(reliableRef());

  await assert.rejects(
    () => harness.store.beginMessage('conv-1', 'fp-1'),
    (error) => error.code === 'INVALID_STATE_TRANSITION'
  );

  const enabled = await harness.store.setManaged('conv-1', true);
  assert.equal(enabled.state, 'WAITING_HR');

  const classifying = await harness.store.beginMessage('conv-1', 'fp-1');
  assert.equal(classifying.state, 'CLASSIFYING');
  await assert.rejects(
    () => harness.store.beginMessage('conv-1', 'fp-2'),
    (error) => error.code === 'INVALID_STATE_TRANSITION'
  );
});

test('serializes duplicate races so only one caller begins the message', async () => {
  const harness = makeHarness();
  await registerAndEnable(harness);

  const [a, b] = await Promise.allSettled([
    harness.store.beginMessage('conv-1', 'fp-1'),
    harness.store.beginMessage('conv-1', 'fp-1')
  ]);

  assert.equal([a, b].filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal([a, b].filter((result) => result.status === 'rejected').length, 1);
});

test('serializes duplicate races across store instances sharing one storage object', async () => {
  const harness = makeHarness();
  await registerAndEnable(harness);
  const secondStore = ConversationStore.create(
    harness.storage,
    () => Date.parse('2026-07-24T08:00:00+08:00'),
    (kind) => `second-${kind}`
  );

  const [a, b] = await Promise.allSettled([
    harness.store.beginMessage('conv-1', 'shared-fp'),
    secondStore.beginMessage('conv-1', 'shared-fp')
  ]);

  assert.equal([a, b].filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal([a, b].filter((result) => result.status === 'rejected').length, 1);
});

test('processes a fingerprint only once even after a conversation reset', async () => {
  const harness = makeHarness();
  await registerAndEnable(harness);
  await createPendingApproval(harness, 'fp-1', ['A']);
  await harness.store.resetConversation('conv-1');

  await assert.rejects(
    () => harness.store.beginMessage('conv-1', 'fp-1'),
    (error) => error.code === 'DUPLICATE_MESSAGE'
  );
});

test('merges later messages into one bounded active approval in order', async () => {
  const harness = makeHarness();
  await registerAndEnable(harness);
  const firstMessages = Array.from({ length: 15 }, (_, index) => `A${index + 1}`);
  const laterMessages = Array.from({ length: 10 }, (_, index) => `B${index + 1}`);

  const first = await createPendingApproval(harness, 'fp-1', firstMessages);
  const second = await harness.store.createOrMergeApproval({
    conversationId: 'conv-1',
    incomingFingerprint: 'fp-2',
    messages: laterMessages
  });

  assert.equal(first.approvalId, second.approvalId);
  assert.deepEqual(second.messages, firstMessages.slice(5).concat(laterMessages));

  second.messages.push('外部篡改');
  const snapshot = await harness.store.getSnapshot();
  assert.deepEqual(
    snapshot.pendingApprovals[first.approvalId].messages,
    firstMessages.slice(5).concat(laterMessages)
  );
  assert.equal(snapshot.managedConversations['conv-1'].recentMessages.length, 20);
});

test('creates one live drill approval without changing the real monitoring baseline or context', async () => {
  const harness = makeHarness({
    conversationTrusteeship: {
      enabled: true,
      intervalMinutes: 10,
      dailyAutoReplyLimit: 10,
      autoReplyDay: '2026-07-24',
      autoReplyCount: 3,
      monitorCursor: 7
    }
  });
  await registerAndEnable(harness);
  await harness.store.markConversationChecked('conv-1', {
    baseline: 'id:real-baseline'
  });
  const before = await harness.store.getSnapshot();

  const approval = await harness.store.createLiveDrillApproval({
    conversationId: 'conv-1',
    drillFingerprint: 'live-drill:one',
    message: '你现在薪资多少，期望多少',
    reasonCode: 'HARD_RISK_SALARY',
    fieldsNeeded: ['current_salary', 'expected_salary'],
    draft: ''
  });

  assert.equal(approval.status, 'PENDING');
  assert.equal(approval.origin, 'LIVE_DRILL');
  assert.equal(approval.incomingFingerprint, 'live-drill:one');
  assert.deepEqual(approval.messages, ['你现在薪资多少，期望多少']);
  assert.deepEqual(approval.fieldsNeeded, ['current_salary', 'expected_salary']);

  const after = await harness.store.getSnapshot();
  const beforeConversation = before.managedConversations['conv-1'];
  const afterConversation = after.managedConversations['conv-1'];
  assert.equal(afterConversation.state, 'WAITING_CONFIRMATION');
  assert.equal(afterConversation.pendingApprovalId, approval.approvalId);
  assert.deepEqual({
    lastIncomingFingerprint: afterConversation.lastIncomingFingerprint,
    processedFingerprints: afterConversation.processedFingerprints,
    recentMessages: afterConversation.recentMessages,
    monitorCursor: after.conversationTrusteeship.monitorCursor,
    autoReplyCount: after.conversationTrusteeship.autoReplyCount
  }, {
    lastIncomingFingerprint: beforeConversation.lastIncomingFingerprint,
    processedFingerprints: beforeConversation.processedFingerprints,
    recentMessages: beforeConversation.recentMessages,
    monitorCursor: before.conversationTrusteeship.monitorCursor,
    autoReplyCount: before.conversationTrusteeship.autoReplyCount
  });
});

test('live drill approval rejects disabled, paused, pending, and sending conversations', async () => {
  async function expectRejected(prepare) {
    const harness = makeHarness();
    await harness.store.registerConversation(reliableRef());
    await prepare(harness);
    await assert.rejects(
      () => harness.store.createLiveDrillApproval({
        conversationId: 'conv-1',
        drillFingerprint: 'live-drill:blocked',
        message: '测试消息',
        reasonCode: 'LIVE_DRILL_CONFIRMATION',
        fieldsNeeded: [],
        draft: '测试回复'
      }),
      (error) => error && error.code === 'LIVE_DRILL_NOT_ALLOWED'
    );
  }

  await expectRejected(async () => {});
  await expectRejected(async (harness) => {
    await harness.store.setManaged('conv-1', true);
    await harness.store.pauseConversation('conv-1', 'CONVERSATION_UNAVAILABLE');
  });
  await expectRejected(async (harness) => {
    await harness.store.setManaged('conv-1', true);
    await createPendingApproval(harness, 'fp-pending', ['真实消息']);
  });
  await expectRejected(async (harness) => {
    await harness.store.setManaged('conv-1', true);
    const approval = await createPendingApproval(harness, 'fp-sending', ['真实消息']);
    await harness.store.createSendIntent(approval.approvalId, '发送中');
  });
});

test('normalizes legacy approvals as live monitor and preserves explicit live drill origin', async () => {
  const harness = makeHarness({
    pendingApprovals: {
      legacy: {
        approvalId: 'legacy',
        conversationId: 'conv-legacy',
        incomingFingerprint: 'fp-legacy',
        incomingFingerprints: ['fp-legacy'],
        messages: ['旧消息'],
        status: 'PENDING'
      },
      drill: {
        approvalId: 'drill',
        conversationId: 'conv-drill',
        origin: 'LIVE_DRILL',
        incomingFingerprint: 'live-drill:stored',
        incomingFingerprints: ['live-drill:stored'],
        messages: ['模拟消息'],
        status: 'PENDING'
      }
    }
  });

  const snapshot = await harness.store.getSnapshot();
  assert.equal(snapshot.pendingApprovals.legacy.origin, 'LIVE_MONITOR');
  assert.equal(snapshot.pendingApprovals.drill.origin, 'LIVE_DRILL');
});

test('disabling and resetting delete recent context and the active approval link', async () => {
  const harness = makeHarness();
  await registerAndEnable(harness);
  const first = await createPendingApproval(harness, 'fp-1', ['A']);

  const disabled = await harness.store.setManaged('conv-1', false);
  assert.equal(disabled.state, 'DISABLED');
  assert.deepEqual(disabled.recentMessages, []);
  assert.equal(disabled.pendingApprovalId, undefined);
  assert.equal(
    (await harness.store.getSnapshot()).pendingApprovals[first.approvalId].status,
    'CANCELLED'
  );

  await harness.store.setManaged('conv-1', true);
  const second = await createPendingApproval(harness, 'fp-2', ['B']);
  const reset = await harness.store.resetConversation('conv-1');
  assert.equal(reset.state, 'WAITING_HR');
  assert.deepEqual(reset.recentMessages, []);
  assert.equal(reset.pendingApprovalId, undefined);
  assert.equal(
    (await harness.store.getSnapshot()).pendingApprovals[second.approvalId].status,
    'CANCELLED'
  );
});

test('removeConversation deletes the registration and linked approvals', async () => {
  const harness = makeHarness();
  await registerAndEnable(harness);
  const approval = await createPendingApproval(harness, 'fp-remove', ['A']);
  const removed = await harness.store.removeConversation('conv-1');
  assert.deepEqual(removed, { ok: true, conversationId: 'conv-1' });
  const snapshot = await harness.store.getSnapshot();
  assert.equal(snapshot.managedConversations['conv-1'], undefined);
  assert.equal(snapshot.pendingApprovals[approval.approvalId], undefined);
  await assert.rejects(
    () => harness.store.removeConversation('conv-1'),
    (error) => error && error.code === 'CONVERSATION_NOT_FOUND'
  );
});

test('persists one send intent before terminal evidence and consumes it once', async () => {
  const harness = makeHarness();
  await registerAndEnable(harness);
  const approval = await createPendingApproval(harness, 'fp-1', ['A']);

  const intent = await harness.store.createSendIntent(approval.approvalId, '好的，仍在看机会。');
  assert.equal(intent.intentId, 'intent-2');
  let snapshot = await harness.store.getSnapshot();
  assert.equal(snapshot.managedConversations['conv-1'].state, 'SENDING');
  assert.equal(snapshot.managedConversations['conv-1'].sendIntent.status, 'SENDING');
  assert.equal(snapshot.managedConversations['conv-1'].sendIntent.approvalId, approval.approvalId);

  await assert.rejects(
    () => harness.store.createSendIntent(approval.approvalId, '重复发送'),
    (error) => error.code === 'SEND_INTENT_ALREADY_EXISTS'
  );

  const completed = await harness.store.completeSend(intent.intentId, {
    success: true,
    targetConversationId: 'conv-1',
    sentFingerprint: 'sent-fp-1',
    observedAt: 123,
    webhook: 'must-not-be-stored'
  });
  assert.equal(completed.status, 'SENT');

  snapshot = await harness.store.getSnapshot();
  assert.equal(snapshot.managedConversations['conv-1'].state, 'WAITING_HR');
  assert.equal(snapshot.managedConversations['conv-1'].pendingApprovalId, undefined);
  assert.deepEqual(snapshot.managedConversations['conv-1'].sendIntent.evidence, {
    success: true,
    targetConversationId: 'conv-1',
    sentFingerprint: 'sent-fp-1',
    observedAt: 123
  });
  assert.equal(snapshot.pendingApprovals[approval.approvalId].status, 'RESOLVED');
  assert.equal(snapshot.conversationTrusteeship.autoReplyCount, 0);

  await assert.rejects(
    () => harness.store.completeSend(intent.intentId, {
      success: true,
      targetConversationId: 'conv-1',
      sentFingerprint: 'sent-fp-1',
      observedAt: 123
    }),
    (error) => error.code === 'SEND_INTENT_ALREADY_TERMINAL'
  );
});

test('rejects non-affirmative or mismatched send evidence without resolving state', async () => {
  const harness = makeHarness();
  await registerAndEnable(harness);
  const approval = await createPendingApproval(harness, 'fp-1', ['A']);
  const intent = await harness.store.createSendIntent(approval.approvalId, '草稿');
  const invalidEvidence = [
    null,
    {},
    { ok: false },
    {
      success: true,
      targetConversationId: 'conv-other',
      sentFingerprint: 'sent-fp-1',
      observedAt: 123
    },
    {
      success: true,
      targetConversationId: 'conv-1',
      sentFingerprint: '',
      observedAt: 123
    },
    {
      success: true,
      targetConversationId: 'conv-1',
      sentFingerprint: 'sent-fp-1',
      observedAt: 0
    }
  ];

  for (const evidence of invalidEvidence) {
    await assert.rejects(
      () => harness.store.completeSend(intent.intentId, evidence),
      (error) => error.code === 'INVALID_SEND_EVIDENCE'
    );
  }

  const snapshot = await harness.store.getSnapshot();
  assert.equal(snapshot.managedConversations['conv-1'].state, 'SENDING');
  assert.equal(snapshot.managedConversations['conv-1'].sendIntent.status, 'SENDING');
  assert.equal(snapshot.pendingApprovals[approval.approvalId].status, 'SENDING');
});

test('marks an uncertain send paused and never makes its intent replayable', async () => {
  const harness = makeHarness();
  await registerAndEnable(harness);
  const approval = await createPendingApproval(harness, 'fp-1', ['A']);
  const intent = await harness.store.createSendIntent(approval.approvalId, '草稿');

  const unknown = await harness.store.markSendUnknown(
    intent.intentId,
    'token=reason-secret&webhook=https://open.feishu.cn/reason-secret'
  );
  assert.equal(unknown.status, 'SEND_RESULT_UNKNOWN');
  assert.equal(unknown.reason, 'SEND_RESULT_UNKNOWN');

  const snapshot = await harness.store.getSnapshot();
  assert.equal(snapshot.managedConversations['conv-1'].state, 'PAUSED');
  assert.equal(snapshot.managedConversations['conv-1'].pauseCode, 'SEND_RESULT_UNKNOWN');
  assert.equal(snapshot.managedConversations['conv-1'].sendIntent.status, 'SEND_RESULT_UNKNOWN');
  assert.equal(snapshot.pendingApprovals[approval.approvalId].status, 'SEND_RESULT_UNKNOWN');
  assert.equal(JSON.stringify(snapshot).includes('reason-secret'), false);

  await assert.rejects(
    () => harness.store.createSendIntent(approval.approvalId, '不要重放'),
    (error) => error.code === 'SEND_INTENT_ALREADY_EXISTS'
  );
});

test('does not recover a live SENDING operation in another store from the same worker', async () => {
  const harness = makeHarness();
  await registerAndEnable(harness);
  const approval = await createPendingApproval(harness, 'fp-1', ['A']);
  const intent = await harness.store.createSendIntent(approval.approvalId, '草稿');

  const sameWorkerStore = ConversationStore.create(
    harness.storage,
    () => Date.parse('2026-07-24T08:05:00+08:00'),
    () => 'must-not-create-an-id'
  );
  const live = await sameWorkerStore.getSnapshot();
  assert.equal(live.managedConversations['conv-1'].state, 'SENDING');
  assert.equal(live.managedConversations['conv-1'].sendIntent.intentId, intent.intentId);
  assert.equal(live.managedConversations['conv-1'].sendIntent.status, 'SENDING');
});

test('recovers persisted SENDING only after a fresh module load simulates a new worker', async () => {
  const harness = makeHarness();
  await registerAndEnable(harness);
  const approval = await createPendingApproval(harness, 'fp-1', ['A']);
  const intent = await harness.store.createSendIntent(approval.approvalId, '草稿');
  const FreshConversationStore = loadFreshConversationStore();
  const recoveredStore = FreshConversationStore.create(
    harness.storage,
    () => Date.parse('2026-07-24T08:05:00+08:00'),
    () => 'must-not-create-an-id'
  );

  const recovered = await recoveredStore.getSnapshot();
  assert.equal(recovered.managedConversations['conv-1'].state, 'PAUSED');
  assert.equal(recovered.managedConversations['conv-1'].pauseCode, 'SEND_RESULT_UNKNOWN');
  assert.equal(recovered.managedConversations['conv-1'].sendIntent.intentId, intent.intentId);
  assert.equal(recovered.managedConversations['conv-1'].sendIntent.status, 'SEND_RESULT_UNKNOWN');

  await assert.rejects(
    () => recoveredStore.createSendIntent(approval.approvalId, '不要重放'),
    (error) => error.code === 'SEND_INTENT_ALREADY_EXISTS'
  );
});

test('retries interrupted-send recovery after a transient persistence failure', async () => {
  const harness = makeHarness();
  await registerAndEnable(harness);
  const approval = await createPendingApproval(harness, 'fp-1', ['A']);
  await harness.store.createSendIntent(approval.approvalId, '草稿');
  const FreshConversationStore = loadFreshConversationStore();
  const recoveredStore = FreshConversationStore.create(
    harness.storage,
    () => Date.parse('2026-07-24T08:05:00+08:00'),
    () => 'must-not-create-an-id'
  );

  harness.storage.failNextSet();
  await assert.rejects(
    () => recoveredStore.getSnapshot(),
    /TRANSIENT_STORAGE_SET_FAILURE/
  );

  const recovered = await recoveredStore.getSnapshot();
  assert.equal(recovered.managedConversations['conv-1'].state, 'PAUSED');
  assert.equal(recovered.managedConversations['conv-1'].pauseCode, 'SEND_RESULT_UNKNOWN');
  assert.equal(
    recovered.managedConversations['conv-1'].sendIntent.status,
    'SEND_RESULT_UNKNOWN'
  );
});

test('does not write on ordinary reads and writes only a real cross-day normalization', async () => {
  const storage = memoryStorage({
    conversationTrusteeship: {
      enabled: false,
      intervalMinutes: 10,
      dailyAutoReplyLimit: 10,
      autoReplyDay: '2026-07-24',
      autoReplyCount: 3
    },
    feishuNotification: {},
    managedConversations: {},
    pendingApprovals: {}
  });
  let now = Date.parse('2026-07-24T08:00:00+08:00');
  const store = ConversationStore.create(storage, () => now, () => 'unused');

  await store.getSnapshot();
  assert.equal(storage.getSetCallCount(), 0);

  now = Date.parse('2026-07-25T08:00:00+08:00');
  const nextDay = await store.getSnapshot();
  assert.equal(storage.getSetCallCount(), 1);
  assert.equal(nextDay.conversationTrusteeship.autoReplyDay, '2026-07-25');
  assert.equal(nextDay.conversationTrusteeship.autoReplyCount, 0);
});

function corruptApprovalLinkStorage() {
  return memoryStorage({
    conversationTrusteeship: {
      autoReplyDay: '2026-07-24',
      autoReplyCount: 0
    },
    feishuNotification: {},
    managedConversations: {
      'conv-1': {
        conversationId: 'conv-1',
        jobId: 'job-1',
        platform: 'boss',
        url: 'https://www.zhipin.com/web/geek/chat?conversation=conv-1',
        enabled: true,
        state: 'WAITING_CONFIRMATION',
        processedFingerprints: [],
        recentMessages: ['own context'],
        pendingApprovalId: 'approval-foreign'
      },
      'conv-2': {
        conversationId: 'conv-2',
        jobId: 'job-2',
        platform: 'boss',
        url: 'https://www.zhipin.com/web/geek/chat?conversation=conv-2',
        enabled: true,
        state: 'WAITING_CONFIRMATION',
        processedFingerprints: [],
        recentMessages: ['foreign context'],
        pendingApprovalId: 'approval-foreign'
      }
    },
    pendingApprovals: {
      'approval-foreign': {
        approvalId: 'approval-foreign',
        conversationId: 'conv-2',
        incomingFingerprint: 'fp-foreign',
        messages: ['foreign'],
        status: 'PENDING',
        createdAt: 1,
        updatedAt: 1
      },
      'approval-own': {
        approvalId: 'approval-own',
        conversationId: 'conv-1',
        incomingFingerprint: 'fp-own',
        messages: ['own'],
        status: 'PENDING',
        createdAt: 2,
        updatedAt: 2
      }
    }
  });
}

test('disable clears a foreign pending link and closes only approvals owned by the conversation', async () => {
  const storage = corruptApprovalLinkStorage();
  const store = ConversationStore.create(
    storage,
    () => Date.parse('2026-07-24T08:00:00+08:00'),
    () => 'unused'
  );

  const disabled = await store.setManaged('conv-1', false);
  const snapshot = await store.getSnapshot();

  assert.equal(disabled.pendingApprovalId, undefined);
  assert.equal(snapshot.pendingApprovals['approval-own'].status, 'CANCELLED');
  assert.equal(snapshot.pendingApprovals['approval-foreign'].status, 'PENDING');
});

test('reset clears a foreign pending link and closes only approvals owned by the conversation', async () => {
  const storage = corruptApprovalLinkStorage();
  const store = ConversationStore.create(
    storage,
    () => Date.parse('2026-07-24T08:00:00+08:00'),
    () => 'unused'
  );

  const reset = await store.resetConversation('conv-1');
  const snapshot = await store.getSnapshot();

  assert.equal(reset.pendingApprovalId, undefined);
  assert.equal(snapshot.pendingApprovals['approval-own'].status, 'CANCELLED');
  assert.equal(snapshot.pendingApprovals['approval-foreign'].status, 'PENDING');
});

test('disable and reset during SENDING persist only fixed unknown-send reasons', async () => {
  for (const operation of ['disable', 'reset']) {
    const harness = makeHarness();
    await registerAndEnable(harness);
    const approval = await createPendingApproval(harness, 'fp-1', ['A']);
    await harness.store.createSendIntent(approval.approvalId, '草稿');

    if (operation === 'disable') {
      await harness.store.setManaged('conv-1', false);
    } else {
      await harness.store.resetConversation('conv-1');
    }
    const snapshot = await harness.store.getSnapshot();
    const conversation = snapshot.managedConversations['conv-1'];
    const persistedConversation =
      harness.storage.data.managedConversations['conv-1'];

    assert.equal(conversation.sendIntent.status, 'SEND_RESULT_UNKNOWN');
    assert.equal(conversation.sendIntent.reason, 'SEND_RESULT_UNKNOWN');
    assert.equal(persistedConversation.sendIntent.reason, 'SEND_RESULT_UNKNOWN');
    assert.equal(JSON.stringify(snapshot).includes('management_disabled_during_send'), false);
    assert.equal(
      JSON.stringify(harness.storage.data).includes('management_disabled_during_send'),
      false
    );
  }
});

test('recordNotificationAttempt allows one retry only after a finalized known failure', async () => {
  const harness = makeHarness();
  await registerAndEnable(harness);
  await harness.store.saveSettings({ enabled: true });
  const approval = await createPendingApproval(harness, 'fp-1', ['A']);

  const first = await harness.store.recordNotificationAttempt(approval.approvalId, {
    phase: 'RESERVE'
  });
  assert.equal(first.status, 'SENDING');
  const completed = await harness.store.recordNotificationAttempt(approval.approvalId, {
    phase: 'COMPLETE',
    reservationId: first.reservationId,
    result: {
      ok: false,
      code: 'HTTP_ERROR',
      error: 'secret raw response',
      webhook: 'https://open.feishu.cn/secret'
    }
  });
  assert.deepEqual(completed, {
    reservationId: first.reservationId,
    attempt: 1,
    status: 'FAILED',
    ok: false,
    code: 'HTTP_ERROR',
    attemptedAt: Date.parse('2026-07-24T08:00:00+08:00'),
    completedAt: Date.parse('2026-07-24T08:00:00+08:00')
  });

  const retry = await harness.store.recordNotificationAttempt(approval.approvalId, {
    phase: 'RESERVE'
  });
  assert.equal(retry.attempt, 2);
  await harness.store.recordNotificationAttempt(approval.approvalId, {
    phase: 'COMPLETE',
    reservationId: retry.reservationId,
    result: { ok: true, code: 'OK' }
  });
  await assert.rejects(
    () => harness.store.recordNotificationAttempt(approval.approvalId, { phase: 'RESERVE' }),
    (error) => error.code === 'NOTIFICATION_ATTEMPT_LIMIT'
  );
});

test('recordNotificationAttempt does not retry a successful first notification', async () => {
  const harness = makeHarness();
  await registerAndEnable(harness);
  await harness.store.saveSettings({ enabled: true });
  const approval = await createPendingApproval(harness, 'fp-1', ['A']);

  const reservation = await harness.store.recordNotificationAttempt(approval.approvalId, {
    phase: 'RESERVE'
  });
  await harness.store.recordNotificationAttempt(approval.approvalId, {
    phase: 'COMPLETE',
    reservationId: reservation.reservationId,
    result: { ok: true, code: 'OK' }
  });
  await assert.rejects(
    () => harness.store.recordNotificationAttempt(approval.approvalId, { phase: 'RESERVE' }),
    (error) => error.code === 'NOTIFICATION_ATTEMPT_LIMIT'
  );
});

test('never copies credential-shaped fields into conversations or approvals', async () => {
  const harness = makeHarness();
  await registerAndEnable(harness, {
    cookie: 'boss-cookie-secret',
    password: 'boss-password-secret',
    signingSecret: 'ref-signing-secret'
  });
  await harness.store.beginMessage('conv-1', 'fp-1');
  const approval = await harness.store.createOrMergeApproval({
    conversationId: 'conv-1',
    incomingFingerprint: 'fp-1',
    messages: ['A'],
    webhook: 'approval-webhook-secret',
    token: 'approval-token-secret',
    signingSecret: 'approval-signing-secret'
  });
  await harness.store.saveSettings({ enabled: true });
  const reservation = await harness.store.recordNotificationAttempt(approval.approvalId, {
    phase: 'RESERVE'
  });
  await harness.store.recordNotificationAttempt(approval.approvalId, {
    phase: 'COMPLETE',
    reservationId: reservation.reservationId,
    result: {
      ok: false,
      code: 'token=notification-secret&webhook=https://open.feishu.cn/notification-secret',
      error: 'raw-error-secret',
      token: 'result-token-secret'
    }
  });

  const snapshot = await harness.store.getSnapshot();
  assert.equal(
    snapshot.pendingApprovals[approval.approvalId].feishuNotifyAttempts[0].code,
    'UNKNOWN'
  );
  const conversationData = JSON.stringify(snapshot.managedConversations);
  const approvalData = JSON.stringify(snapshot.pendingApprovals);
  for (const secret of [
    'boss-cookie-secret',
    'boss-password-secret',
    'ref-signing-secret',
    'approval-webhook-secret',
    'approval-token-secret',
    'approval-signing-secret',
    'raw-error-secret',
    'result-token-secret',
    'notification-secret'
  ]) {
    assert.equal(conversationData.includes(secret), false);
    assert.equal(approvalData.includes(secret), false);
  }
});

test('repairs corrupt pending links and duplicate approvals without cross-conversation merge', async () => {
  const storage = memoryStorage({
    conversationTrusteeship: {
      autoReplyDay: '2026-07-24',
      autoReplyCount: 0
    },
    feishuNotification: {},
    managedConversations: {
      'conv-1': {
        conversationId: 'conv-1',
        jobId: 'job-1',
        platform: 'boss',
        url: 'https://www.zhipin.com/web/geek/chat?conversation=conv-1',
        enabled: true,
        state: 'WAITING_CONFIRMATION',
        processedFingerprints: [],
        recentMessages: ['existing'],
        pendingApprovalId: 'approval-wrong'
      },
      'conv-2': {
        conversationId: 'conv-2',
        jobId: 'job-2',
        platform: 'boss',
        url: 'https://www.zhipin.com/web/geek/chat?conversation=conv-2',
        enabled: true,
        state: 'WAITING_CONFIRMATION',
        processedFingerprints: [],
        recentMessages: [],
        pendingApprovalId: 'approval-wrong'
      }
    },
    pendingApprovals: {
      'approval-wrong': {
        approvalId: 'approval-wrong',
        conversationId: 'conv-2',
        incomingFingerprint: 'fp-wrong',
        messages: ['wrong conversation'],
        status: 'PENDING',
        createdAt: 1,
        updatedAt: 1
      },
      'approval-newer': {
        approvalId: 'approval-newer',
        conversationId: 'conv-1',
        incomingFingerprint: 'fp-newer',
        messages: ['newer'],
        status: 'PENDING',
        createdAt: 20,
        updatedAt: 20
      },
      'approval-oldest': {
        approvalId: 'approval-oldest',
        conversationId: 'conv-1',
        incomingFingerprint: 'fp-oldest',
        messages: ['oldest'],
        status: 'PENDING',
        createdAt: 10,
        updatedAt: 10
      }
    }
  });
  const store = ConversationStore.create(
    storage,
    () => Date.parse('2026-07-24T08:00:00+08:00'),
    () => 'must-not-create-an-approval'
  );

  const merged = await store.createOrMergeApproval({
    conversationId: 'conv-1',
    incomingFingerprint: 'fp-later',
    messages: ['later']
  });
  const snapshot = await store.getSnapshot();

  assert.equal(merged.approvalId, 'approval-oldest');
  assert.deepEqual(merged.messages, ['oldest', 'later']);
  assert.equal(
    snapshot.managedConversations['conv-1'].pendingApprovalId,
    'approval-oldest'
  );
  assert.equal(snapshot.pendingApprovals['approval-newer'].status, 'CANCELLED_DUPLICATE');
  assert.equal(snapshot.pendingApprovals['approval-wrong'].status, 'PENDING');
  assert.deepEqual(
    snapshot.pendingApprovals['approval-wrong'].messages,
    ['wrong conversation']
  );
});

test('persists a handled read checkpoint without storing caller extras', async () => {
  const harness = makeHarness();
  await registerAndEnable(harness);

  const checked = await harness.store.markConversationChecked('conv-1', {
    baseline: 'incoming-fp-1',
    rawMessage: 'must-not-be-stored'
  });

  assert.equal(checked.lastCheckedAt, Date.parse('2026-07-24T08:00:00+08:00'));
  assert.equal(checked.lastIncomingFingerprint, 'incoming-fp-1');
  assert.equal(JSON.stringify(await harness.store.getSnapshot()).includes('must-not-be-stored'), false);
  await assert.rejects(
    () => harness.store.markConversationChecked('conv-1', { baseline: null }),
    (error) => error.code === 'INVALID_CHECKPOINT'
  );
});

test('creates an AUTO intent only for the active classified fingerprint and counts it once', async () => {
  const harness = makeHarness();
  await registerAndEnable(harness);
  await harness.store.saveSettings({ enabled: true });
  await harness.store.beginMessage('conv-1', 'fp-auto');

  const intent = await harness.store.createAutoSendIntent('conv-1', 'fp-auto', '仍在看机会，谢谢。');
  assert.equal(intent.mode, 'AUTO');
  assert.equal(intent.fingerprint, 'fp-auto');

  await harness.store.completeSend(intent.intentId, {
    success: true,
    targetConversationId: 'conv-1',
    sentFingerprint: 'sent-auto-1',
    observedAt: 123
  });
  let snapshot = await harness.store.getSnapshot();
  assert.equal(snapshot.conversationTrusteeship.autoReplyCount, 1);
  assert.equal(snapshot.managedConversations['conv-1'].state, 'WAITING_HR');

  await assert.rejects(
    () => harness.store.completeSend(intent.intentId, {
      success: true,
      targetConversationId: 'conv-1',
      sentFingerprint: 'sent-auto-1',
      observedAt: 123
    }),
    (error) => error.code === 'SEND_INTENT_ALREADY_TERMINAL'
  );
  snapshot = await harness.store.getSnapshot();
  assert.equal(snapshot.conversationTrusteeship.autoReplyCount, 1);
});

test('allows a later classified fingerprint to replace a terminal AUTO intent', async () => {
  const harness = makeHarness();
  await registerAndEnable(harness);
  await harness.store.saveSettings({ enabled: true });
  await harness.store.beginMessage('conv-1', 'fp-auto-1');
  const first = await harness.store.createAutoSendIntent('conv-1', 'fp-auto-1', '第一次回复');
  await harness.store.completeSend(first.intentId, {
    success: true,
    targetConversationId: 'conv-1',
    sentFingerprint: 'sent-auto-1',
    observedAt: 123
  });

  await harness.store.beginMessage('conv-1', 'fp-auto-2');
  const second = await harness.store.createAutoSendIntent('conv-1', 'fp-auto-2', '第二次回复');
  assert.notEqual(second.intentId, first.intentId);
  assert.equal(second.fingerprint, 'fp-auto-2');
});

test('manual approval send intents remain MANUAL and never increment the automatic daily count', async () => {
  const harness = makeHarness();
  await registerAndEnable(harness);
  const approval = await createPendingApproval(harness, 'fp-manual', ['A']);

  const intent = await harness.store.createSendIntent(approval.approvalId, '人工确认草稿');
  assert.equal(intent.mode, 'MANUAL');
  await harness.store.completeSend(intent.intentId, {
    success: true,
    targetConversationId: 'conv-1',
    sentFingerprint: 'sent-manual-1',
    observedAt: 123
  });

  assert.equal((await harness.store.getSnapshot()).conversationTrusteeship.autoReplyCount, 0);
});

test('pauses one conversation with an allowlisted code and rejects raw reasons', async () => {
  const harness = makeHarness();
  await registerAndEnable(harness);

  const paused = await harness.store.pauseConversation('conv-1', 'TARGET_UNCERTAIN');
  assert.equal(paused.state, 'PAUSED');
  assert.equal(paused.pauseCode, 'TARGET_UNCERTAIN');
  assert.equal(paused.pauseReason, '');

  await assert.rejects(
    () => harness.store.pauseConversation('conv-1', 'token=secret raw reason'),
    (error) => error.code === 'INVALID_PAUSE_CODE'
  );
  assert.equal(JSON.stringify(await harness.store.getSnapshot()).includes('secret raw reason'), false);
});

test('setManaged retries a transiently unavailable enabled conversation without deleting its cursor', async () => {
  const harness = makeHarness();
  await registerAndEnable(harness);
  await harness.store.markConversationChecked('conv-1', {
    baseline: 'incoming-fp-before-pause'
  });
  await harness.store.pauseConversation('conv-1', 'CONVERSATION_UNAVAILABLE');

  const resumed = await harness.store.setManaged('conv-1', true);

  assert.equal(resumed.enabled, true);
  assert.equal(resumed.state, 'WAITING_HR');
  assert.equal(resumed.pauseCode, '');
  assert.equal(resumed.lastIncomingFingerprint, 'incoming-fp-before-pause');
  assert.ok(resumed.lastCheckedAt > 0);
});

test('resolves an approval as NO_REPLY, clears its link, and cannot consume it again', async () => {
  const harness = makeHarness();
  await registerAndEnable(harness);
  const approval = await createPendingApproval(harness, 'fp-no-reply', ['A']);

  const resolved = await harness.store.resolveApprovalWithoutSend(approval.approvalId);
  assert.equal(resolved.status, 'NO_REPLY');
  let snapshot = await harness.store.getSnapshot();
  assert.equal(snapshot.managedConversations['conv-1'].state, 'WAITING_HR');
  assert.equal(snapshot.managedConversations['conv-1'].pendingApprovalId, undefined);

  await assert.rejects(
    () => harness.store.resolveApprovalWithoutSend(approval.approvalId),
    (error) => error.code === 'APPROVAL_ALREADY_TERMINAL'
  );
});

test('every terminal, pause, checkpoint, disable, reset, and enable path clears classification recovery metadata', async (t) => {
  function injectStaleMetadata(harness) {
    const conversation = harness.storage.data.managedConversations['conv-1'];
    conversation.activeFingerprint = 'fp-stale-active';
    conversation.classificationBaseline = 'fp-stale-baseline';
    conversation.classificationOriginState = 'WAITING_CONFIRMATION';
  }

  async function assertCleared(name, prepare, act) {
    await t.test(name, async () => {
      const harness = makeHarness();
      const context = await prepare(harness);
      injectStaleMetadata(harness);
      await act(harness, context);
      const conversation = (await harness.store.getSnapshot())
        .managedConversations['conv-1'];
      for (const key of [
        'activeFingerprint',
        'classificationBaseline',
        'classificationOriginState'
      ]) {
        assert.equal(Object.hasOwn(conversation, key), false, `${name}: ${key}`);
        assert.equal(
          Object.hasOwn(harness.storage.data.managedConversations['conv-1'], key),
          false,
          `${name}: persisted ${key}`
        );
      }
    });
  }

  const registerEnabled = async (harness) => {
    await registerAndEnable(harness);
    return {};
  };
  const createManualIntent = async (harness) => {
    await registerAndEnable(harness);
    const approval = await createPendingApproval(harness, 'fp-terminal', ['A']);
    const intent = await harness.store.createSendIntent(approval.approvalId, '人工草稿');
    return { intent };
  };
  const createApproval = async (harness) => {
    await registerAndEnable(harness);
    return {
      approval: await createPendingApproval(harness, 'fp-no-reply-cleanup', ['A'])
    };
  };

  await assertCleared('complete', createManualIntent, (harness, context) => (
    harness.store.completeSend(context.intent.intentId, {
      success: true,
      targetConversationId: 'conv-1',
      sentFingerprint: 'sent-cleanup',
      observedAt: 123
    })
  ));
  await assertCleared('unknown', createManualIntent, (harness, context) => (
    harness.store.markSendUnknown(context.intent.intentId, 'SEND_RESULT_UNKNOWN')
  ));
  await assertCleared('pause', registerEnabled, (harness) => (
    harness.store.pauseConversation('conv-1', 'TARGET_UNCERTAIN')
  ));
  await assertCleared('checkpoint', registerEnabled, (harness) => (
    harness.store.markConversationChecked('conv-1', { baseline: 'fp-checked' })
  ));
  await assertCleared('NO_REPLY', createApproval, (harness, context) => (
    harness.store.resolveApprovalWithoutSend(context.approval.approvalId)
  ));
  await assertCleared('disable', registerEnabled, (harness) => (
    harness.store.setManaged('conv-1', false)
  ));
  await assertCleared('reset', registerEnabled, (harness) => (
    harness.store.resetConversation('conv-1')
  ));
  await assertCleared('enable from damaged DISABLED', async (harness) => {
    await harness.store.registerConversation(reliableRef());
    return {};
  }, (harness) => harness.store.setManaged('conv-1', true));
});

test('atomically enforces global AUTO gates and one daily reservation across store instances', async () => {
  const harness = makeHarness();
  await registerAndEnable(harness);
  await harness.store.registerConversation(reliableRef({
    conversationId: 'conv-2',
    jobId: 'job-2',
    url: 'https://www.zhipin.com/web/geek/chat?conversationId=conv-2'
  }));
  await harness.store.setManaged('conv-2', true);
  await harness.store.saveSettings({ enabled: true, dailyAutoReplyLimit: 1 });
  await harness.store.beginMessage('conv-1', 'fp-auto-1');
  await harness.store.beginMessage('conv-2', 'fp-auto-2');

  const secondStore = ConversationStore.create(
    harness.storage,
    () => Date.parse('2026-07-24T08:00:00+08:00'),
    (kind) => `second-${kind}`
  );
  const results = await Promise.allSettled([
    harness.store.createAutoSendIntent('conv-1', 'fp-auto-1', '回复一'),
    secondStore.createAutoSendIntent('conv-2', 'fp-auto-2', '回复二')
  ]);
  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  assert.equal(
    results.filter((result) =>
      result.status === 'rejected' &&
      result.reason.code === 'DAILY_AUTO_REPLY_LIMIT_REACHED'
    ).length,
    1
  );

  const pausedHarness = makeHarness();
  await registerAndEnable(pausedHarness);
  await pausedHarness.store.saveSettings({ enabled: true, paused: true });
  await pausedHarness.store.beginMessage('conv-1', 'fp-paused');
  await assert.rejects(
    () => pausedHarness.store.createAutoSendIntent('conv-1', 'fp-paused', '不得发送'),
    (error) => error.code === 'AUTO_REPLY_NOT_ALLOWED'
  );
});

test('an unknown AUTO outcome consumes the daily quota exactly once', async () => {
  const harness = makeHarness();
  await registerAndEnable(harness);
  await harness.store.saveSettings({ enabled: true, dailyAutoReplyLimit: 1 });
  await harness.store.beginMessage('conv-1', 'fp-auto');
  const intent = await harness.store.createAutoSendIntent('conv-1', 'fp-auto', '自动回复');

  await harness.store.markSendUnknown(intent.intentId, 'raw-secret-reason');
  let snapshot = await harness.store.getSnapshot();
  assert.equal(snapshot.conversationTrusteeship.autoReplyCount, 1);

  await assert.rejects(
    () => harness.store.markSendUnknown(intent.intentId, 'again'),
    (error) => error.code === 'SEND_INTENT_ALREADY_TERMINAL'
  );
  snapshot = await harness.store.getSnapshot();
  assert.equal(snapshot.conversationTrusteeship.autoReplyCount, 1);
});

test('disabling an in-flight AUTO intent consumes its unknown-outcome quota once', async () => {
  const harness = makeHarness();
  await registerAndEnable(harness);
  await harness.store.saveSettings({ enabled: true, dailyAutoReplyLimit: 2 });
  await harness.store.beginMessage('conv-1', 'fp-auto-disable');
  await harness.store.createAutoSendIntent('conv-1', 'fp-auto-disable', '自动回复');

  await harness.store.setManaged('conv-1', false);
  let snapshot = await harness.store.getSnapshot();
  assert.equal(snapshot.conversationTrusteeship.autoReplyCount, 1);
  assert.equal(
    snapshot.managedConversations['conv-1'].sendIntent.status,
    'SEND_RESULT_UNKNOWN'
  );

  await harness.store.setManaged('conv-1', false);
  snapshot = await harness.store.getSnapshot();
  assert.equal(snapshot.conversationTrusteeship.autoReplyCount, 1);
});

test('notification reservation is atomic and final failure alone permits one later attempt', async () => {
  const harness = makeHarness();
  await registerAndEnable(harness);
  await harness.store.saveSettings({ enabled: true });
  const approval = await createPendingApproval(harness, 'fp-notify', ['A']);
  const secondStore = ConversationStore.create(
    harness.storage,
    () => Date.parse('2026-07-24T08:00:00+08:00'),
    (kind) => `second-${kind}`
  );

  const firstRace = await Promise.allSettled([
    harness.store.recordNotificationAttempt(approval.approvalId, { phase: 'RESERVE' }),
    secondStore.recordNotificationAttempt(approval.approvalId, { phase: 'RESERVE' })
  ]);
  assert.equal(firstRace.filter((result) => result.status === 'fulfilled').length, 1);
  const first = firstRace.find((result) => result.status === 'fulfilled').value;
  assert.equal(first.status, 'SENDING');
  await harness.store.recordNotificationAttempt(approval.approvalId, {
    phase: 'COMPLETE',
    reservationId: first.reservationId,
    result: { ok: false, code: 'HTTP_ERROR' }
  });

  const second = await secondStore.recordNotificationAttempt(approval.approvalId, {
    phase: 'RESERVE'
  });
  assert.equal(second.attempt, 2);
  await secondStore.recordNotificationAttempt(approval.approvalId, {
    phase: 'COMPLETE',
    reservationId: second.reservationId,
    result: { ok: true, code: 'OK' }
  });
  await assert.rejects(
    () => harness.store.recordNotificationAttempt(approval.approvalId, { phase: 'RESERVE' }),
    (error) => error.code === 'NOTIFICATION_ATTEMPT_LIMIT'
  );
});

test('unknown or unpersisted notification completion permanently blocks automatic retry', async () => {
  for (const mode of ['unknown', 'persist-failure']) {
    const harness = makeHarness();
    await registerAndEnable(harness);
    await harness.store.saveSettings({ enabled: true });
    const approval = await createPendingApproval(harness, `fp-${mode}`, ['A']);
    const reservation = await harness.store.recordNotificationAttempt(approval.approvalId, {
      phase: 'RESERVE'
    });

    if (mode === 'unknown') {
      await harness.store.recordNotificationAttempt(approval.approvalId, {
        phase: 'COMPLETE',
        reservationId: reservation.reservationId,
        result: { ok: false, code: 'secret-shaped-error-code' }
      });
    } else {
      harness.storage.failNextSet();
      await assert.rejects(
        () => harness.store.recordNotificationAttempt(approval.approvalId, {
          phase: 'COMPLETE',
          reservationId: reservation.reservationId,
          result: { ok: false, code: 'HTTP_ERROR' }
        }),
        /TRANSIENT_STORAGE_SET_FAILURE/
      );
    }

    await assert.rejects(
      () => harness.store.recordNotificationAttempt(approval.approvalId, { phase: 'RESERVE' }),
      (error) => error.code === 'NOTIFICATION_ATTEMPT_LIMIT'
    );
    const snapshot = await harness.store.getSnapshot();
    assert.equal(JSON.stringify(snapshot).includes('secret-shaped-error-code'), false);
  }
});

test('notification RESERVE atomically enforces global and quiet-hour gates', async () => {
  const harness = makeHarness();
  await harness.store.saveSettings({ enabled: false });
  await registerAndEnable(harness);
  const approval = await createPendingApproval(harness, 'fp-gated-notify', ['A']);

  await assert.rejects(
    () => harness.store.recordNotificationAttempt(approval.approvalId, { phase: 'RESERVE' }),
    (error) => error.code === 'NOTIFICATION_NOT_ALLOWED'
  );
  await harness.store.saveSettings({ enabled: true, paused: true });
  await assert.rejects(
    () => harness.store.recordNotificationAttempt(approval.approvalId, { phase: 'RESERVE' }),
    (error) => error.code === 'NOTIFICATION_NOT_ALLOWED'
  );
  await harness.store.saveSettings({
    paused: false,
    quietHours: { enabled: true, start: '07:00', end: '09:00' }
  });
  await assert.rejects(
    () => harness.store.recordNotificationAttempt(approval.approvalId, { phase: 'RESERVE' }),
    (error) => error.code === 'NOTIFICATION_NOT_ALLOWED'
  );

  harness.setTime('2026-07-24T09:01:00+08:00');
  const reservation = await harness.store.recordNotificationAttempt(approval.approvalId, {
    phase: 'RESERVE'
  });
  assert.equal(reservation.status, 'SENDING');
});

test('notification RESERVE atomically requires one enabled WAITING_CONFIRMATION owner with an exact unique link', async (t) => {
  const cases = [
    {
      name: 'owner disabled',
      mutate(snapshot) {
        snapshot.managedConversations['conv-1'].enabled = false;
        snapshot.managedConversations['conv-1'].state = 'DISABLED';
      }
    },
    {
      name: 'owner paused',
      mutate(snapshot) {
        snapshot.managedConversations['conv-1'].state = 'PAUSED';
        snapshot.managedConversations['conv-1'].pauseCode = 'TARGET_UNCERTAIN';
      }
    },
    {
      name: 'owner left confirmation state',
      mutate(snapshot) {
        snapshot.managedConversations['conv-1'].state = 'WAITING_HR';
      }
    },
    {
      name: 'owner link differs',
      mutate(snapshot) {
        snapshot.managedConversations['conv-1'].pendingApprovalId = 'approval-other';
      }
    },
    {
      name: 'second local pending exists',
      mutate(snapshot, approval) {
        snapshot.pendingApprovals['approval-duplicate'] = Object.assign({}, approval, {
          approvalId: 'approval-duplicate'
        });
      }
    }
  ];

  for (const sample of cases) {
    await t.test(sample.name, async () => {
      const harness = makeHarness();
      await registerAndEnable(harness);
      await harness.store.saveSettings({ enabled: true });
      const approval = await createPendingApproval(harness, `fp-${sample.name}`, ['A']);
      sample.mutate(harness.storage.data, approval);

      await assert.rejects(
        () => harness.store.recordNotificationAttempt(approval.approvalId, { phase: 'RESERVE' }),
        (error) => error.code === 'NOTIFICATION_NOT_ALLOWED'
      );
      assert.deepEqual(
        (await harness.store.getSnapshot()).pendingApprovals[approval.approvalId]
          .feishuNotifyAttempts,
        []
      );
    });
  }
});

test('notification CANCEL removes only a persisted SENDING reservation and fails safe', async () => {
  for (const persistFailure of [false, true]) {
    const harness = makeHarness();
    await registerAndEnable(harness);
    await harness.store.saveSettings({ enabled: true });
    const approval = await createPendingApproval(harness, `fp-cancel-${persistFailure}`, ['A']);
    const reservation = await harness.store.recordNotificationAttempt(approval.approvalId, {
      phase: 'RESERVE'
    });
    if (persistFailure) harness.storage.failNextSet();

    const cancel = () => harness.store.recordNotificationAttempt(approval.approvalId, {
      phase: 'CANCEL',
      reservationId: reservation.reservationId
    });
    if (persistFailure) {
      await assert.rejects(cancel, /TRANSIENT_STORAGE_SET_FAILURE/);
      await assert.rejects(
        () => harness.store.recordNotificationAttempt(approval.approvalId, { phase: 'RESERVE' }),
        (error) => error.code === 'NOTIFICATION_ATTEMPT_LIMIT'
      );
      const attempt = (await harness.store.getSnapshot())
        .pendingApprovals[approval.approvalId].feishuNotifyAttempts[0];
      assert.equal(attempt.status, 'SENDING');
    } else {
      await cancel();
      const retry = await harness.store.recordNotificationAttempt(approval.approvalId, {
        phase: 'RESERVE'
      });
      assert.equal(retry.attempt, 1);
    }
  }
});

test('store exposes one notification transition API within the exact public method budget', () => {
  const harness = makeHarness();
  assert.deepEqual(Object.keys(harness.store).sort(), [
    'acknowledgeUnknownSend',
    'beginMessage',
    'completeSend',
    'createAutoSendIntent',
    'createLiveDrillApproval',
    'createOrMergeApproval',
    'createSendIntent',
    'getSnapshot',
    'markConversationChecked',
    'markSendUnknown',
    'pauseConversation',
    'recordNotificationAttempt',
    'recordReadFailure',
    'registerConversation',
    'removeConversation',
    'resetConversation',
    'resolveApprovalWithoutSend',
    'saveSettings',
    'setManaged'
  ]);
});

test('acknowledges a manually checked unknown send and removes only its local pending item', async () => {
  const harness = makeHarness();
  await registerAndEnable(harness);
  const approval = await createPendingApproval(harness, 'fp-unknown-ack', ['还在看机会吗']);
  const intent = await harness.store.createSendIntent(approval.approvalId, '是的，仍在看机会。');
  await harness.store.markSendUnknown(intent.intentId, 'SEND_RESULT_UNKNOWN');

  const result = await harness.store.acknowledgeUnknownSend(approval.approvalId);
  const snapshot = await harness.store.getSnapshot();
  const conversation = snapshot.managedConversations['conv-1'];

  assert.deepEqual(result, { ok: true, approvalId: approval.approvalId, conversationId: 'conv-1' });
  assert.equal(snapshot.pendingApprovals[approval.approvalId], undefined);
  assert.equal(conversation.state, 'WAITING_HR');
  assert.equal(conversation.pauseCode, '');
  assert.equal(conversation.pendingApprovalId, undefined);
  assert.equal(conversation.sendIntent.status, 'SEND_RESULT_UNKNOWN');
});
