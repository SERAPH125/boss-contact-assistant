const test = require('node:test');
const assert = require('node:assert/strict');

const Policy = require('../src/conversation/trusteeship-policy.js');
const MonitorEngine = require('../src/conversation/monitor-engine.js');
const STORE_PATH = require.resolve('../src/conversation/conversation-store.js');

function memoryStorage(initial, shouldFailSet) {
  const data = structuredClone(initial || {});
  return {
    data,
    async get(keys) {
      return (Array.isArray(keys) ? keys : Object.keys(data)).reduce((result, key) => {
        result[key] = structuredClone(data[key]);
        return result;
      }, {});
    },
    async set(patch) {
      if (shouldFailSet && shouldFailSet(patch)) throw new Error('injected persistence failure');
      Object.assign(data, structuredClone(patch));
    }
  };
}

function loadFreshStoreModule() {
  delete require.cache[STORE_PATH];
  return require(STORE_PATH);
}

function reliableRef() {
  return {
    platform: 'boss',
    conversationId: 'conv-recovery',
    url: 'https://www.zhipin.com/web/geek/chat?conversationId=conv-recovery',
    jobId: 'job-recovery',
    company: '恢复测试公司',
    position: '前端工程师',
    hrName: '测试 HR',
    initialIncomingFingerprint: ''
  };
}

test('a fresh worker reclassifies an interrupted CLASSIFYING message and sends it at most once', async () => {
  const storage = memoryStorage();
  let ids = 0;
  const firstModule = loadFreshStoreModule();
  const firstStore = firstModule.create(storage, () => 1_000, (kind) => `${kind}-${++ids}`);
  await firstStore.registerConversation(reliableRef());
  await firstStore.setManaged('conv-recovery', true);
  await firstStore.saveSettings({ enabled: true });
  await firstStore.beginMessage('conv-recovery', 'id:incoming-1');

  assert.equal(
    storage.data.managedConversations['conv-recovery'].state,
    'CLASSIFYING'
  );
  assert.equal(
    storage.data.managedConversations['conv-recovery'].classificationOriginState,
    'WAITING_HR'
  );

  const recoveredModule = loadFreshStoreModule();
  const recoveredStore = recoveredModule.create(storage, () => 2_000, (kind) => `${kind}-${++ids}`);
  const calls = { read: 0, classify: 0, draft: 0, send: 0, notify: 0 };
  const engine = MonitorEngine.create({
    store: recoveredStore,
    policy: Policy,
    clock: () => new Date('2026-07-25T09:00:00+08:00'),
    async getResumeFacts() {
      return [{ id: 'resume-1', text: '五年前端经验' }];
    },
    reader: {
      async read(conversation) {
        calls.read += 1;
        if (calls.read > 1) {
          return {
            success: true,
            conversationRef: {
              conversationId: conversation.conversationId,
              url: conversation.url
            },
            baseline: 'id:incoming-1',
            messages: []
          };
        }
        assert.equal(conversation.lastIncomingFingerprint, '');
        return {
          success: true,
          conversationRef: {
            conversationId: conversation.conversationId,
            url: conversation.url
          },
          baseline: 'id:incoming-1',
          messages: [{
            direction: 'incoming',
            kind: 'text',
            text: '还在看机会吗？',
            fingerprint: 'id:incoming-1'
          }]
        };
      },
      async send(conversation, draft, intent) {
        calls.send += 1;
        return {
          success: true,
          targetConversationId: conversation.conversationId,
          sentFingerprint: `sent:${intent.intentId}`,
          observedAt: 2_000
        };
      }
    },
    classifier: {
      async classify() {
        calls.classify += 1;
        return {
          category: 'still_looking',
          confidence: 0.95,
          reasonCode: 'LOW_RISK',
          evidenceIds: ['resume-1'],
          fieldsNeeded: []
        };
      },
      async draft() {
        calls.draft += 1;
        return {
          draft: '您好，我还在看机会。',
          evidenceIds: ['resume-1']
        };
      }
    },
    notifier: {
      async notifyApproval() {
        calls.notify += 1;
        return { ok: true, code: 'OK' };
      },
      async notifyResolved() {
        return { ok: true, code: 'OK' };
      }
    }
  });

  const firstCycle = await engine.runCycle();
  const secondCycle = await engine.runCycle();
  const snapshot = await recoveredStore.getSnapshot();

  assert.equal(firstCycle.autoSent, 1);
  assert.equal(secondCycle.autoSent, 0);
  assert.equal(calls.classify, 1);
  assert.equal(calls.draft, 1);
  assert.equal(calls.send, 1);
  assert.equal(calls.notify, 0);
  assert.equal(snapshot.managedConversations['conv-recovery'].sendIntent.status, 'SENT');
  assert.equal(snapshot.conversationTrusteeship.autoReplyCount, 1);
});

function rawClassifyingConversation(overrides) {
  const conversation = {
    conversationId: 'conv-recovery',
    jobId: 'job-recovery',
    platform: 'boss',
    url: 'https://www.zhipin.com/web/geek/chat?conversationId=conv-recovery',
    company: '恢复测试公司',
    position: '前端工程师',
    hrName: '测试 HR',
    enabled: true,
    state: 'CLASSIFYING',
    lastIncomingFingerprint: 'fp-active',
    processedFingerprints: ['fp-old', 'fp-active'],
    recentMessages: [],
    activeFingerprint: 'fp-active',
    classificationBaseline: 'fp-old',
    classificationOriginState: 'WAITING_HR',
    pauseCode: '',
    pauseReason: '',
    createdAt: 1,
    updatedAt: 1
  };
  Object.assign(conversation, overrides || {});
  return conversation;
}

function rawSnapshot(conversation, approvals) {
  return {
    conversationTrusteeship: {
      enabled: true,
      paused: false,
      intervalMinutes: 10,
      dailyAutoReplyLimit: 10,
      autoReplyDay: '2026-07-25',
      autoReplyCount: 0,
      quietHours: { enabled: false, start: '22:00', end: '08:00' },
      monitorCursor: 0
    },
    feishuNotification: { enabled: true, webhook: '', signingSecret: '' },
    managedConversations: { 'conv-recovery': conversation },
    pendingApprovals: approvals || {}
  };
}

test('a fresh worker fails closed for missing, damaged, or contradictory CLASSIFYING recovery evidence', async () => {
  const longHistory = Array.from({ length: 24 }, (_, index) => `fp-history-${index}`)
    .concat('fp-active');
  const cases = [
    {
      name: 'legacy missing baseline',
      mutate(conversation) { delete conversation.classificationBaseline; }
    },
    {
      name: 'damaged baseline type',
      mutate(conversation) { conversation.classificationBaseline = { corrupt: true }; }
    },
    {
      name: 'missing origin state',
      mutate(conversation) { delete conversation.classificationOriginState; }
    },
    {
      name: 'invalid origin state',
      mutate(conversation) { conversation.classificationOriginState = 'PAUSED'; }
    },
    {
      name: 'active fingerprint differs from checkpoint',
      mutate(conversation) { conversation.activeFingerprint = 'fp-other'; }
    },
    {
      name: 'processed evidence does not contain active fingerprint',
      mutate(conversation) { conversation.processedFingerprints = ['fp-old']; }
    },
    {
      name: 'history already exceeded the bounded window',
      mutate(conversation) {
        delete conversation.classificationBaseline;
        conversation.processedFingerprints = longHistory;
      }
    }
  ];

  for (const sample of cases) {
    const raw = rawClassifyingConversation();
    sample.mutate(raw);
    const storage = memoryStorage(rawSnapshot(raw));
    const FreshConversationStore = loadFreshStoreModule();
    const store = FreshConversationStore.create(storage, () => 3_000, () => 'unused');
    const calls = { reader: 0, classify: 0, draft: 0, notify: 0, send: 0 };
    const engine = MonitorEngine.create({
      store,
      policy: Policy,
      clock: () => new Date('2026-07-25T09:00:00+08:00'),
      async getResumeFacts() { return []; },
      reader: {
        async read() { calls.reader += 1; throw new Error('must not read'); },
        async send() { calls.send += 1; throw new Error('must not send'); }
      },
      classifier: {
        async classify() { calls.classify += 1; throw new Error('must not classify'); },
        async draft() { calls.draft += 1; throw new Error('must not draft'); }
      },
      notifier: {
        async notifyApproval() { calls.notify += 1; throw new Error('must not notify'); },
        async notifyResolved() { calls.notify += 1; throw new Error('must not notify'); }
      }
    });

    const beforeLast = raw.lastIncomingFingerprint;
    const beforeProcessed = raw.processedFingerprints.slice(-20);
    const recovered = await store.getSnapshot();
    const conversation = recovered.managedConversations['conv-recovery'];
    assert.equal(conversation.state, 'PAUSED', sample.name);
    assert.equal(conversation.pauseCode, 'RECOVERY_STATE_UNCERTAIN', sample.name);
    assert.equal(conversation.lastIncomingFingerprint, beforeLast, sample.name);
    assert.deepEqual(conversation.processedFingerprints, beforeProcessed, sample.name);
    assert.equal(Object.hasOwn(conversation, 'classificationBaseline'), false, sample.name);
    assert.equal(Object.hasOwn(conversation, 'classificationOriginState'), false, sample.name);

    await engine.runCycle();
    assert.deepEqual(calls, { reader: 0, classify: 0, draft: 0, notify: 0, send: 0 }, sample.name);
  }
});

test('empty classification baseline is valid and recovers the exact WAITING_HR origin', async () => {
  const storage = memoryStorage(rawSnapshot(rawClassifyingConversation({
    classificationBaseline: '',
    classificationOriginState: 'WAITING_HR'
  })));
  const FreshConversationStore = loadFreshStoreModule();
  const store = FreshConversationStore.create(storage, () => 3_000, () => 'unused');

  const snapshot = await store.getSnapshot();
  const conversation = snapshot.managedConversations['conv-recovery'];
  assert.equal(conversation.state, 'WAITING_HR');
  assert.equal(conversation.lastIncomingFingerprint, '');
  assert.deepEqual(conversation.processedFingerprints, ['fp-old']);
  assert.equal(Object.hasOwn(conversation, 'classificationBaseline'), false);
  assert.equal(Object.hasOwn(conversation, 'classificationOriginState'), false);
});

test('a reliable registration baseline need not already be in the processed fingerprint window', async () => {
  const storage = memoryStorage(rawSnapshot(rawClassifyingConversation({
    classificationBaseline: 'fp-reliable-registration',
    classificationOriginState: 'WAITING_HR',
    processedFingerprints: ['fp-active']
  })));
  const FreshConversationStore = loadFreshStoreModule();
  const store = FreshConversationStore.create(storage, () => 3_000, () => 'unused');

  const snapshot = await store.getSnapshot();
  const conversation = snapshot.managedConversations['conv-recovery'];
  assert.equal(conversation.state, 'WAITING_HR');
  assert.equal(conversation.lastIncomingFingerprint, 'fp-reliable-registration');
  assert.deepEqual(conversation.processedFingerprints, []);
});

test('uncertain CLASSIFYING recovery retries after its first persistence failure', async () => {
  const raw = rawClassifyingConversation();
  delete raw.classificationBaseline;
  let failures = 1;
  const storage = memoryStorage(rawSnapshot(raw), (patch) => {
    const candidate = patch.managedConversations &&
      patch.managedConversations['conv-recovery'];
    if (failures > 0 && candidate && candidate.pauseCode === 'RECOVERY_STATE_UNCERTAIN') {
      failures -= 1;
      return true;
    }
    return false;
  });
  const FreshConversationStore = loadFreshStoreModule();
  const store = FreshConversationStore.create(storage, () => 3_000, () => 'unused');

  await assert.rejects(() => store.getSnapshot(), /injected persistence failure/);
  assert.equal(storage.data.managedConversations['conv-recovery'].state, 'CLASSIFYING');

  const recovered = await store.getSnapshot();
  assert.equal(recovered.managedConversations['conv-recovery'].state, 'PAUSED');
  assert.equal(
    recovered.managedConversations['conv-recovery'].pauseCode,
    'RECOVERY_STATE_UNCERTAIN'
  );
});

function rawSendingClassifyingSnapshot() {
  const conversation = rawClassifyingConversation({
    classificationBaseline: undefined,
    sendIntent: {
      intentId: 'intent-unknown-recovery',
      mode: 'AUTO',
      approvalId: 'approval-unknown-recovery',
      fingerprint: 'fp-active',
      draft: '不得重放的草稿',
      status: 'SENDING',
      createdAt: 2,
      updatedAt: 2
    }
  });
  delete conversation.classificationBaseline;
  const snapshot = rawSnapshot(conversation, {
    'approval-unknown-recovery': {
      approvalId: 'approval-unknown-recovery',
      conversationId: 'conv-recovery',
      incomingFingerprint: 'fp-active',
      incomingFingerprints: ['fp-active'],
      messages: ['待确认消息'],
      stage: 'WAITING_CONFIRMATION',
      reasonCode: 'LOW_CONFIDENCE',
      fieldsNeeded: [],
      draft: '不得重放的草稿',
      status: 'PENDING',
      createdAt: 2,
      updatedAt: 2,
      feishuNotifyAttempts: []
    }
  });
  snapshot.conversationTrusteeship.autoReplyCount = 2;
  return snapshot;
}

test('SENDING recovery takes precedence over invalid CLASSIFYING evidence and never replays the external action', async () => {
  const storage = memoryStorage(rawSendingClassifyingSnapshot());
  const FreshConversationStore = loadFreshStoreModule();
  const recoveryNow = Date.parse('2026-07-25T09:00:00+08:00');
  const store = FreshConversationStore.create(storage, () => recoveryNow, () => 'unused');
  const calls = { read: 0, classify: 0, draft: 0, notify: 0, send: 0 };
  const engine = MonitorEngine.create({
    store,
    policy: Policy,
    clock: () => new Date('2026-07-25T09:00:00+08:00'),
    async getResumeFacts() { return []; },
    reader: {
      async read() { calls.read += 1; throw new Error('must not read'); },
      async send() { calls.send += 1; throw new Error('must not send'); }
    },
    classifier: {
      async classify() { calls.classify += 1; throw new Error('must not classify'); },
      async draft() { calls.draft += 1; throw new Error('must not draft'); }
    },
    notifier: {
      async notifyApproval() { calls.notify += 1; throw new Error('must not notify'); },
      async notifyResolved() { calls.notify += 1; throw new Error('must not notify'); }
    }
  });

  let recovered = await store.getSnapshot();
  const conversation = recovered.managedConversations['conv-recovery'];
  assert.equal(conversation.state, 'PAUSED');
  assert.equal(conversation.pauseCode, 'SEND_RESULT_UNKNOWN');
  assert.equal(conversation.sendIntent.status, 'SEND_RESULT_UNKNOWN');
  assert.equal(
    recovered.pendingApprovals['approval-unknown-recovery'].status,
    'SEND_RESULT_UNKNOWN'
  );
  assert.equal(recovered.conversationTrusteeship.autoReplyCount, 3);
  assert.equal(Object.hasOwn(conversation, 'activeFingerprint'), false);
  assert.equal(Object.hasOwn(conversation, 'classificationBaseline'), false);
  assert.equal(Object.hasOwn(conversation, 'classificationOriginState'), false);

  await engine.runCycle();
  recovered = await store.getSnapshot();
  assert.equal(recovered.conversationTrusteeship.autoReplyCount, 3);
  assert.deepEqual(calls, { read: 0, classify: 0, draft: 0, notify: 0, send: 0 });
});

test('precedence recovery retries its SEND_RESULT_UNKNOWN terminal write after the first persistence failure', async () => {
  let failures = 1;
  const storage = memoryStorage(rawSendingClassifyingSnapshot(), (patch) => {
    const candidate = patch.managedConversations &&
      patch.managedConversations['conv-recovery'];
    if (failures > 0 && candidate &&
      candidate.pauseCode === 'SEND_RESULT_UNKNOWN' &&
      candidate.sendIntent &&
      candidate.sendIntent.status === 'SEND_RESULT_UNKNOWN') {
      failures -= 1;
      return true;
    }
    return false;
  });
  const FreshConversationStore = loadFreshStoreModule();
  const recoveryNow = Date.parse('2026-07-25T09:00:00+08:00');
  const store = FreshConversationStore.create(storage, () => recoveryNow, () => 'unused');

  await assert.rejects(() => store.getSnapshot(), /injected persistence failure/);
  assert.equal(
    storage.data.managedConversations['conv-recovery'].sendIntent.status,
    'SENDING'
  );
  assert.equal(storage.data.conversationTrusteeship.autoReplyCount, 2);

  const recovered = await store.getSnapshot();
  assert.equal(
    recovered.managedConversations['conv-recovery'].sendIntent.status,
    'SEND_RESULT_UNKNOWN'
  );
  assert.equal(recovered.managedConversations['conv-recovery'].pauseCode, 'SEND_RESULT_UNKNOWN');
  assert.equal(recovered.conversationTrusteeship.autoReplyCount, 3);
  assert.equal(
    recovered.pendingApprovals['approval-unknown-recovery'].status,
    'SEND_RESULT_UNKNOWN'
  );

  const stable = await store.getSnapshot();
  assert.equal(stable.conversationTrusteeship.autoReplyCount, 3);
});

test('a fresh worker restores WAITING_CONFIRMATION and merges the interrupted message once without AI or send', async () => {
  const storage = memoryStorage();
  let ids = 0;
  let now = Date.parse('2026-07-25T23:00:00+08:00');
  const firstModule = loadFreshStoreModule();
  const firstStore = firstModule.create(storage, () => now, (kind) => `${kind}-${++ids}`);
  await firstStore.registerConversation(reliableRef());
  await firstStore.setManaged('conv-recovery', true);
  await firstStore.saveSettings({
    enabled: true,
    quietHours: { enabled: true, start: '22:00', end: '08:00' }
  });
  await storage.set({
    feishuNotification: {
      enabled: true,
      webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/test',
      signingSecret: ''
    }
  });
  await firstStore.beginMessage('conv-recovery', 'fp-first');
  const approval = await firstStore.createOrMergeApproval({
    conversationId: 'conv-recovery',
    incomingFingerprint: 'fp-first',
    messages: ['第一条消息'],
    reasonCode: 'HARD_RISK_SALARY'
  });
  await firstStore.beginMessage('conv-recovery', 'fp-second');
  assert.equal(
    storage.data.managedConversations['conv-recovery'].classificationOriginState,
    'WAITING_CONFIRMATION'
  );

  const recoveredModule = loadFreshStoreModule();
  const recoveredStore = recoveredModule.create(storage, () => now, (kind) => `${kind}-${++ids}`);
  const calls = { read: 0, classify: 0, draft: 0, notify: 0, send: 0 };
  const engine = MonitorEngine.create({
    store: recoveredStore,
    policy: Policy,
    clock: () => new Date(now),
    async getResumeFacts() { return [{ id: 'resume-1', text: '五年前端经验' }]; },
    reader: {
      async read(conversation) {
        calls.read += 1;
        if (calls.read === 1) {
          assert.equal(conversation.state, 'WAITING_CONFIRMATION');
          assert.equal(conversation.pendingApprovalId, approval.approvalId);
          return {
            success: true,
            conversationRef: { conversationId: conversation.conversationId, url: conversation.url },
            baseline: 'fp-second',
            messages: [{
              direction: 'incoming',
              kind: 'text',
              text: '第二条消息',
              fingerprint: 'fp-second'
            }]
          };
        }
        return {
          success: true,
          conversationRef: { conversationId: conversation.conversationId, url: conversation.url },
          baseline: 'fp-second',
          messages: []
        };
      },
      async send() { calls.send += 1; throw new Error('must not send'); }
    },
    classifier: {
      async classify() { calls.classify += 1; throw new Error('must not classify'); },
      async draft() { calls.draft += 1; throw new Error('must not draft'); }
    },
    notifier: {
      async notifyApproval() { calls.notify += 1; return { ok: true, code: 'OK' }; },
      async notifyResolved() { return { ok: true, code: 'OK' }; }
    }
  });

  await engine.runCycle();
  let snapshot = await recoveredStore.getSnapshot();
  assert.deepEqual(snapshot.pendingApprovals[approval.approvalId].messages, ['第一条消息', '第二条消息']);
  assert.equal(snapshot.pendingApprovals[approval.approvalId].status, 'PENDING');
  assert.equal(calls.notify, 0);

  now = Date.parse('2026-07-26T09:00:00+08:00');
  await engine.runCycle();
  await engine.runCycle();
  snapshot = await recoveredStore.getSnapshot();
  assert.equal(Object.keys(snapshot.pendingApprovals).length, 1);
  assert.deepEqual(snapshot.pendingApprovals[approval.approvalId].incomingFingerprints, ['fp-first', 'fp-second']);
  assert.equal(calls.classify, 0);
  assert.equal(calls.draft, 0);
  assert.equal(calls.send, 0);
  assert.equal(calls.notify, 1);
});

test('WAITING_CONFIRMATION recovery requires exactly one linked local PENDING and contradictory snapshots never notify', async () => {
  const approval = (id, conversationId) => ({
    approvalId: id,
    conversationId,
    incomingFingerprint: 'fp-old',
    incomingFingerprints: ['fp-old'],
    messages: ['历史待确认消息'],
    stage: 'WAITING_CONFIRMATION',
    reasonCode: 'LOW_CONFIDENCE',
    fieldsNeeded: [],
    draft: '本地草稿',
    status: 'PENDING',
    createdAt: 1,
    updatedAt: 1,
    feishuNotifyAttempts: []
  });
  const cases = [
    {
      name: 'missing linked approval with an orphan local pending',
      pendingApprovalId: 'approval-missing',
      approvals: { 'approval-orphan': approval('approval-orphan', 'conv-recovery') }
    },
    {
      name: 'linked approval belongs to another conversation',
      pendingApprovalId: 'approval-foreign',
      approvals: { 'approval-foreign': approval('approval-foreign', 'conv-other') }
    },
    {
      name: 'duplicate local pending approvals',
      pendingApprovalId: 'approval-primary',
      approvals: {
        'approval-primary': approval('approval-primary', 'conv-recovery'),
        'approval-duplicate': approval('approval-duplicate', 'conv-recovery')
      }
    }
  ];

  for (const sample of cases) {
    const conversation = rawClassifyingConversation({
      classificationOriginState: 'WAITING_CONFIRMATION',
      pendingApprovalId: sample.pendingApprovalId
    });
    const storage = memoryStorage(rawSnapshot(conversation, sample.approvals));
    const FreshConversationStore = loadFreshStoreModule();
    const store = FreshConversationStore.create(storage, () => 5_000, () => 'unused');
    let notifications = 0;
    const engine = MonitorEngine.create({
      store,
      policy: Policy,
      clock: () => new Date('2026-07-25T09:00:00+08:00'),
      async getResumeFacts() { return []; },
      reader: {
        async read() { throw new Error('must not read'); },
        async send() { throw new Error('must not send'); }
      },
      classifier: {
        async classify() { throw new Error('must not classify'); },
        async draft() { throw new Error('must not draft'); }
      },
      notifier: {
        async notifyApproval() {
          notifications += 1;
          return { ok: true, code: 'OK' };
        },
        async notifyResolved() { return { ok: true, code: 'OK' }; }
      }
    });

    const recovered = await store.getSnapshot();
    assert.equal(recovered.managedConversations['conv-recovery'].state, 'PAUSED', sample.name);
    assert.equal(
      recovered.managedConversations['conv-recovery'].pauseCode,
      'RECOVERY_STATE_UNCERTAIN',
      sample.name
    );
    await engine.runCycle();
    assert.equal(notifications, 0, sample.name);
  }
});
