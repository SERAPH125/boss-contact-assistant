const test = require('node:test');
const assert = require('node:assert/strict');

const ConversationStore = require('../src/conversation/conversation-store.js');
const Policy = require('../src/conversation/trusteeship-policy.js');
const MonitorEngine = require('../src/conversation/monitor-engine.js');
const Runtime = require('../src/conversation/trusteeship-runtime.js');
const FeishuNotifier = require('../src/conversation/feishu-notifier.js');

function deferred() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function memoryStorage(initial) {
  const data = Object.assign({}, initial || {});
  let pendingSetFailures = 0;
  return {
    data,
    failNextSet() {
      pendingSetFailures += 1;
    },
    async get(keys) {
      if (Array.isArray(keys)) {
        return keys.reduce((result, key) => {
          result[key] = data[key];
          return result;
        }, {});
      }
      return Object.assign({}, data);
    },
    async set(patch) {
      if (pendingSetFailures > 0) {
        pendingSetFailures -= 1;
        throw new Error('TRANSIENT_STORAGE_SET_FAILURE');
      }
      Object.assign(data, structuredClone(patch));
    }
  };
}

function reliableRef(id) {
  return {
    platform: 'boss',
    conversationId: id,
    url: `https://www.zhipin.com/web/geek/chat?conversationId=${id}`,
    jobId: `job-${id}`,
    company: `公司-${id}`,
    position: '前端工程师',
    hrName: 'HR'
  };
}

function incoming(id, text, kind) {
  return {
    id,
    direction: 'incoming',
    kind: kind || 'text',
    text: kind && kind !== 'text' ? '' : text,
    at: 1,
    fingerprint: `id:${id}`
  };
}

function readOk(conversation, messages, baseline) {
  return {
    success: true,
    conversationId: conversation.conversationId,
    conversationRef: {
      conversationId: conversation.conversationId,
      url: conversation.url
    },
    baseline: baseline === undefined
      ? (messages.at(-1)?.fingerprint || conversation.lastIncomingFingerprint || '')
      : baseline,
    messages
  };
}

async function makeHarness(options) {
  const source = options || {};
  let now = source.now || Date.parse('2026-07-24T09:00:00+08:00');
  let sequence = 0;
  const storage = memoryStorage(source.initial);
  const store = ConversationStore.create(storage, () => now, (kind) => `${kind}-${++sequence}`);
  const calls = {
    read: [],
    send: [],
    verifySend: [],
    classify: [],
    draft: [],
    notifyApproval: [],
    notifyResolved: [],
    getResumeFacts: 0
  };
  const reader = source.reader || {
    async read(conversation) {
      calls.read.push(conversation.conversationId);
      return readOk(conversation, []);
    },
    async send(conversation, draft, intent) {
      calls.send.push({ conversationId: conversation.conversationId, draft, intent });
      return {
        success: true,
        targetConversationId: conversation.conversationId,
        sentFingerprint: `sent:${intent.intentId}`,
        observedAt: now
      };
    }
  };
  const originalRead = reader.read.bind(reader);
  const originalSend = reader.send.bind(reader);
  const originalVerifySend = typeof reader.verifySend === 'function'
    ? reader.verifySend.bind(reader)
    : null;
  reader.read = async function (conversation) {
    if (source.reader) calls.read.push(conversation.conversationId);
    return originalRead(conversation);
  };
  reader.send = async function (conversation, draft, intent) {
    if (source.reader) calls.send.push({ conversationId: conversation.conversationId, draft, intent });
    return originalSend(conversation, draft, intent);
  };
  if (originalVerifySend) {
    reader.verifySend = async function (conversation, intent) {
      calls.verifySend.push({ conversationId: conversation.conversationId, intent });
      return originalVerifySend(conversation, intent);
    };
  }
  const classifier = source.classifier || {
    async classify(input) {
      calls.classify.push(input);
      return {
        category: 'courtesy',
        confidence: 0.9,
        reasonCode: 'LOW_RISK',
        evidenceIds: ['resume-1'],
        fieldsNeeded: []
      };
    },
    async draft(input) {
      calls.draft.push(input);
      return { draft: '您好，仍在看机会，谢谢。', evidenceIds: ['resume-1'] };
    }
  };
  const notifier = source.notifier || {
    async notifyApproval(approval) {
      calls.notifyApproval.push(approval);
      return { ok: true, code: 'OK' };
    },
    async notifyResolved(approval) {
      calls.notifyResolved.push(approval);
      return { ok: true, code: 'OK' };
    }
  };
  const deps = {
    store,
    reader,
    classifier,
    notifier,
    policy: source.policy || Object.assign({}, Policy, {
      replyDelayMs() {
        return 0;
      }
    }),
    clock: () => now,
    random: source.random || (() => 0),
    async getResumeFacts() {
      calls.getResumeFacts += 1;
      if (source.getResumeFacts) return source.getResumeFacts();
      return [{ id: 'resume-1', text: '五年前端经验' }];
    }
  };
  if (source.guardExternalAction) {
    deps.guardExternalAction = source.guardExternalAction;
  }
  const engine = MonitorEngine.create(deps);
  return {
    storage,
    store,
    engine,
    deps,
    calls,
    setTime(value) {
      now = Date.parse(value);
    },
    async register(ids, enabled) {
      for (const id of ids) {
        await store.registerConversation(reliableRef(id));
        if (enabled !== false) await store.setManaged(id, true);
      }
    },
    async enableGlobal(patch) {
      await store.saveSettings(Object.assign({ enabled: true }, patch || {}));
    }
  };
}

test('create validates every injected method and global disabled or paused makes no external calls', async () => {
  assert.throws(
    () => MonitorEngine.create({}),
    (error) => error.code === 'INVALID_DEPENDENCIES'
  );
  const harness = await makeHarness();
  await harness.store.saveSettings({ enabled: false });
  await harness.register(['conv-1']);

  assert.deepEqual(await harness.engine.runCycle(), {
    checked: 0,
    newMessages: 0,
    autoSent: 0,
    pending: 0,
    skipped: 0,
    errors: []
  });
  await harness.store.saveSettings({ enabled: true, paused: true, pauseCode: 'LOGIN_REQUIRED' });
  await harness.engine.runCycle();
  assert.equal(harness.calls.read.length, 0);
  assert.equal(harness.calls.classify.length, 0);
  assert.equal(harness.calls.notifyApproval.length, 0);
  assert.equal(harness.calls.getResumeFacts, 0);
});

test('reads only enabled conversations and rotates a persisted ten-conversation budget', async () => {
  const harness = await makeHarness();
  const enabled = Array.from({ length: 12 }, (_, index) => `conv-${String(index + 1).padStart(2, '0')}`);
  await harness.register(enabled);
  await harness.register(['disabled'], false);
  await harness.enableGlobal();

  await harness.engine.runCycle();
  assert.deepEqual(harness.calls.read, enabled.slice(0, 10));
  assert.equal((await harness.store.getSnapshot()).conversationTrusteeship.monitorCursor, 10);

  harness.calls.read.length = 0;
  await harness.engine.runCycle();
  assert.deepEqual(harness.calls.read, enabled.slice(10).concat(enabled.slice(0, 8)));
  assert.equal(harness.calls.read.includes('disabled'), false);
});

test('a per-conversation PAUSED state is selected for bookkeeping but never read', async () => {
  const harness = await makeHarness();
  await harness.register(['conv-1']);
  await harness.store.pauseConversation('conv-1', 'TARGET_UNCERTAIN');
  await harness.enableGlobal();

  const result = await harness.engine.runCycle();
  assert.equal(harness.calls.read.length, 0);
  assert.equal(result.skipped, 1);
});

test('no new messages keeps WAITING_HR and stores the handled baseline', async () => {
  const harness = await makeHarness({
    reader: {
      async read(conversation) {
        return readOk(conversation, [], conversation.lastIncomingFingerprint);
      },
      async send() {
        throw new Error('must not send');
      }
    }
  });
  await harness.register(['conv-1']);
  await harness.enableGlobal();

  const summary = await harness.engine.runCycle();
  const conversation = (await harness.store.getSnapshot()).managedConversations['conv-1'];
  assert.equal(summary.checked, 1);
  assert.equal(conversation.state, 'WAITING_HR');
  assert.equal(conversation.lastIncomingFingerprint, '');
  assert.ok(conversation.lastCheckedAt > 0);
});

test('a stable monitor cursor handles one new incoming message exactly once across repeated cycles', async () => {
  let readCount = 0;
  const harness = await makeHarness({
    initial: { feishuNotification: { enabled: true } },
    reader: {
      async read(conversation) {
        readCount += 1;
        if (readCount === 1) return readOk(conversation, [], 'id:baseline');
        if (readCount === 2) {
          return readOk(
            conversation,
            [incoming('salary-once', '你现在薪资多少，期望多少')],
            'id:salary-once'
          );
        }
        return readOk(conversation, [], 'id:salary-once');
      },
      async send() {
        throw new Error('must not send before confirmation');
      }
    }
  });
  await harness.register(['conv-1']);
  await harness.store.markConversationChecked('conv-1', { baseline: 'id:baseline' });
  await harness.enableGlobal();

  const first = await harness.engine.runCycle();
  const second = await harness.engine.runCycle();
  const third = await harness.engine.runCycle();
  const snapshot = await harness.store.getSnapshot();
  const approvals = Object.values(snapshot.pendingApprovals);

  assert.deepEqual(
    [first.newMessages, second.newMessages, third.newMessages],
    [0, 1, 0]
  );
  assert.equal(first.checked, 1);
  assert.equal(second.checked, 1);
  assert.equal(third.checked, 1);
  assert.equal(approvals.length, 1);
  assert.equal(approvals[0].origin, 'LIVE_MONITOR');
  assert.equal(approvals[0].reasonCode, 'HARD_RISK_SALARY');
  assert.deepEqual(approvals[0].incomingFingerprints, ['id:salary-once']);
  assert.equal(harness.calls.classify.length, 1);
  assert.equal(harness.calls.send.length, 0);
  assert.equal(harness.calls.notifyApproval.length, 1);
  assert.equal(
    snapshot.managedConversations['conv-1'].lastIncomingFingerprint,
    'id:salary-once'
  );
});

test('confidence 0.85 persists a delayed reply and sends once when due', async () => {
  let reads = 0;
  let messages = [incoming('m1', '您好，还在看机会吗？')];
  const harness = await makeHarness({
    policy: Policy,
    reader: {
      async read(conversation) {
        reads += 1;
        return readOk(conversation, messages, 'id:m1');
      },
      async send(conversation, draft, intent) {
        return {
          success: true,
          targetConversationId: conversation.conversationId,
          sentFingerprint: `sent:${intent.intentId}`,
          observedAt: Date.now()
        };
      }
    },
    classifier: {
      async classify() {
        return {
          category: 'still_looking',
          confidence: 0.85,
          reasonCode: 'SAFE',
          evidenceIds: ['resume-1'],
          fieldsNeeded: []
        };
      },
      async draft() {
        return { draft: '您好，我仍在看机会。', evidenceIds: ['resume-1'] };
      }
    }
  });
  await harness.register(['conv-1']);
  await harness.enableGlobal();

  const first = await harness.engine.runCycle();
  let snapshot = await harness.store.getSnapshot();
  assert.equal(first.autoSent, 0);
  assert.equal(harness.calls.send.length, 0);
  assert.equal(snapshot.managedConversations['conv-1'].state, 'WAITING_REPLY_DUE');
  assert.equal(
    snapshot.managedConversations['conv-1'].pendingReply.dueAt,
    Date.parse('2026-07-24T09:00:30+08:00')
  );

  messages = [];
  harness.setTime('2026-07-24T09:00:29+08:00');
  const second = await harness.engine.runCycle();
  assert.equal(second.autoSent, 0);
  assert.equal(harness.calls.send.length, 0);

  harness.setTime('2026-07-24T09:00:30+08:00');
  const third = await harness.engine.runCycle();
  snapshot = await harness.store.getSnapshot();

  assert.equal(reads, 3);
  assert.equal(second.autoSent, 0);
  assert.equal(third.autoSent, 1);
  assert.equal(harness.calls.send.length, 1);
  assert.equal(snapshot.conversationTrusteeship.autoReplyCount, 1);
  assert.equal(snapshot.managedConversations['conv-1'].sendIntent.mode, 'AUTO');
});

test('an AI explicit rejection needs no resume evidence, closes once, and ends unmatched without quota', async () => {
  let reads = 0;
  let classifications = 0;
  let drafts = 0;
  const harness = await makeHarness({
    initial: {
      conversationTrusteeship: {
        enabled: true,
        dailyAutoReplyLimit: 1,
        autoReplyCount: 1,
        autoReplyDay: '2026-07-24'
      }
    },
    getResumeFacts() {
      return [];
    },
    reader: {
      async read(conversation) {
        reads += 1;
        return readOk(conversation, [incoming('reject', '不合适')], 'id:reject');
      },
      async send(conversation, draft, intent) {
        return {
          success: true,
          targetConversationId: conversation.conversationId,
          sentFingerprint: `sent:${intent.intentId}`,
          observedAt: Date.now()
        };
      }
    },
    classifier: {
      async classify() {
        classifications += 1;
        return {
          category: 'explicit_rejection',
          confidence: 0.99,
          reasonCode: 'EXPLICIT_REJECTION',
          evidenceIds: [],
          fieldsNeeded: []
        };
      },
      async draft() {
        drafts += 1;
        return {
          draft: '收到，感谢您的回复，祝工作顺利。',
          evidenceIds: []
        };
      }
    }
  });
  await harness.register(['conv-1']);
  await harness.enableGlobal({ dailyAutoReplyLimit: 1 });

  const first = await harness.engine.runCycle();
  const second = await harness.engine.runCycle();
  const snapshot = await harness.store.getSnapshot();
  const conversation = snapshot.managedConversations['conv-1'];

  assert.equal(reads, 1);
  assert.equal(first.checked, 1);
  assert.equal(first.autoSent, 1);
  assert.equal(first.pending, 0);
  assert.equal(second.checked, 0);
  assert.equal(second.autoSent, 0);
  assert.equal(classifications, 1);
  assert.equal(drafts, 1);
  assert.equal(harness.calls.send.length, 1);
  assert.equal(harness.calls.send[0].intent.mode, 'AUTO_CLOSE');
  assert.equal(snapshot.conversationTrusteeship.autoReplyCount, 1);
  assert.equal(conversation.state, 'ENDED_UNMATCHED');
  assert.equal(conversation.enabled, false);
});

test('unsafe or failed AI rejection drafts become clean approvals and never reach Boss', async () => {
  const unsafeDraft = '请再考虑一下，我的经验很匹配。';
  const providerSecret = 'provider-secret-must-not-leak';
  const harness = await makeHarness({
    getResumeFacts() {
      return [];
    },
    reader: {
      async read(conversation) {
        const message = incoming(`reject-${conversation.conversationId}`, '不合适');
        return readOk(conversation, [message], message.fingerprint);
      },
      async send() {
        throw new Error('must not send');
      }
    },
    classifier: {
      async classify() {
        return {
          category: 'explicit_rejection',
          confidence: 0.99,
          reasonCode: 'EXPLICIT_REJECTION',
          evidenceIds: [],
          fieldsNeeded: []
        };
      },
      async draft(input) {
        if (input.target.conversationId === 'failed') {
          throw new Error(providerSecret);
        }
        return { draft: unsafeDraft, evidenceIds: [] };
      }
    }
  });
  await harness.register(['failed', 'unsafe']);
  await harness.enableGlobal();

  const result = await harness.engine.runCycle();
  const snapshot = await harness.store.getSnapshot();
  const approvals = Object.values(snapshot.pendingApprovals);
  const serialized = JSON.stringify({ result, snapshot });

  assert.equal(result.autoSent, 0);
  assert.equal(result.pending, 2);
  assert.equal(harness.calls.send.length, 0);
  assert.equal(approvals.length, 2);
  assert.ok(approvals.every((approval) => approval.draft === ''));
  assert.ok(approvals.some((approval) => approval.reasonCode === 'AI_DRAFT_FAILED'));
  assert.ok(approvals.some((approval) => approval.reasonCode === 'AUTO_CLOSE_DRAFT_UNSAFE'));
  assert.equal(serialized.includes(providerSecret), false);
  assert.equal(serialized.includes(unsafeDraft), false);
});

test('quiet explicit rejection defers with zero writes then sends after a clean reread', async () => {
  let messages = [incoming('quiet-reject', '不合适')];
  let classifications = 0;
  let drafts = 0;
  const harness = await makeHarness({
    now: Date.parse('2026-07-26T23:00:00+08:00'),
    getResumeFacts() {
      return [];
    },
    reader: {
      async read(conversation) {
        return readOk(conversation, messages);
      },
      async send(conversation, draft, intent) {
        return {
          success: true,
          targetConversationId: conversation.conversationId,
          sentFingerprint: `sent:${intent.intentId}`,
          observedAt: Date.now()
        };
      }
    },
    classifier: {
      async classify() {
        classifications += 1;
        return {
          category: 'explicit_rejection',
          confidence: 0.97,
          reasonCode: 'EXPLICIT_REJECTION',
          evidenceIds: [],
          fieldsNeeded: []
        };
      },
      async draft() {
        drafts += 1;
        return {
          draft: '收到，感谢您的回复，祝工作顺利。',
          evidenceIds: []
        };
      }
    }
  });
  await harness.register(['conv-1']);
  await harness.enableGlobal({
    quietHours: { enabled: true, start: '22:00', end: '08:00' }
  });

  const quiet = await harness.engine.runCycle();
  let snapshot = await harness.store.getSnapshot();
  assert.equal(quiet.autoSent, 0);
  assert.equal(quiet.pending, 0);
  assert.deepEqual(quiet.errors, []);
  assert.equal(harness.calls.send.length, 0);
  assert.equal(snapshot.managedConversations['conv-1'].state, 'WAITING_AUTO_CLOSE');

  messages = [];
  harness.setTime('2026-07-26T23:05:00+08:00');
  const stillQuiet = await harness.engine.runCycle();
  snapshot = await harness.store.getSnapshot();
  assert.equal(stillQuiet.checked, 1);
  assert.equal(stillQuiet.autoSent, 0);
  assert.equal(classifications, 1);
  assert.equal(drafts, 1);
  assert.equal(harness.calls.send.length, 0);
  assert.equal(snapshot.managedConversations['conv-1'].state, 'WAITING_AUTO_CLOSE');

  harness.setTime('2026-07-27T08:01:00+08:00');
  const awake = await harness.engine.runCycle();
  snapshot = await harness.store.getSnapshot();

  assert.equal(awake.checked, 1);
  assert.equal(awake.newMessages, 0);
  assert.equal(awake.autoSent, 1);
  assert.deepEqual(awake.errors, []);
  assert.equal(harness.calls.send.length, 1);
  assert.equal(harness.calls.send[0].intent.mode, 'AUTO_CLOSE');
  assert.equal(snapshot.managedConversations['conv-1'].state, 'ENDED_UNMATCHED');
  assert.equal(snapshot.conversationTrusteeship.autoReplyCount, 0);
});

test('a newer HR message cancels the deferred close before any send', async () => {
  let messages = [incoming('reject', '不合适')];
  const harness = await makeHarness({
    now: Date.parse('2026-07-26T23:00:00+08:00'),
    reader: {
      async read(conversation) {
        return readOk(conversation, messages);
      },
      async send() {
        throw new Error('must not send');
      }
    },
    classifier: {
      async classify(input) {
        const latest = input.targetMessages.at(-1)?.text;
        if (latest === '不合适') {
          return {
            category: 'explicit_rejection',
            confidence: 0.97,
            reasonCode: 'EXPLICIT_REJECTION',
            evidenceIds: [],
            fieldsNeeded: []
          };
        }
        return {
          category: 'important',
          confidence: 0.98,
          reasonCode: 'RESUME_DETAIL_QUERY',
          evidenceIds: ['resume-1'],
          fieldsNeeded: ['projectExperience']
        };
      },
      async draft(input) {
        const latest = input.targetMessages.at(-1)?.text;
        return {
          draft: '我先整理一下相关经历，稍后回复您。',
          evidenceIds: latest === '不合适' ? [] : ['resume-1']
        };
      }
    }
  });
  await harness.register(['conv-1']);
  await harness.enableGlobal({
    quietHours: { enabled: true, start: '22:00', end: '08:00' }
  });
  await harness.engine.runCycle();

  messages = [incoming('newer', '方便补充一下项目经历吗')];
  harness.setTime('2026-07-27T08:01:00+08:00');
  const result = await harness.engine.runCycle();
  const snapshot = await harness.store.getSnapshot();
  const conversation = snapshot.managedConversations['conv-1'];

  assert.equal(harness.calls.send.length, 0);
  assert.equal(result.pending, 1);
  assert.equal(conversation.pendingAutoClose, undefined);
  assert.equal(conversation.lastIncomingFingerprint, 'id:newer');
  assert.equal(conversation.state, 'WAITING_CONFIRMATION');
});

test('a restarted engine rereads WAITING_AUTO_CLOSE before sending', async () => {
  let messages = [incoming('restart-reject', '不合适')];
  const harness = await makeHarness({
    now: Date.parse('2026-07-26T23:00:00+08:00'),
    getResumeFacts() {
      return [];
    },
    reader: {
      async read(conversation) {
        return readOk(conversation, messages);
      },
      async send(conversation, draft, intent) {
        return {
          success: true,
          targetConversationId: conversation.conversationId,
          sentFingerprint: `sent:${intent.intentId}`,
          observedAt: Date.now()
        };
      }
    },
    classifier: {
      async classify() {
        return {
          category: 'explicit_rejection',
          confidence: 0.96,
          reasonCode: 'EXPLICIT_REJECTION',
          evidenceIds: [],
          fieldsNeeded: []
        };
      },
      async draft() {
        return { draft: '好的，感谢您的回复，祝工作顺利。', evidenceIds: [] };
      }
    }
  });
  await harness.register(['conv-1']);
  await harness.enableGlobal({
    quietHours: { enabled: true, start: '22:00', end: '08:00' }
  });
  await harness.engine.runCycle();

  messages = [];
  harness.setTime('2026-07-27T08:01:00+08:00');
  const restartedEngine = MonitorEngine.create(harness.deps);
  const result = await restartedEngine.runCycle();
  const snapshot = await harness.store.getSnapshot();

  assert.equal(result.autoSent, 1);
  assert.equal(harness.calls.send.length, 1);
  assert.equal(snapshot.managedConversations['conv-1'].state, 'ENDED_UNMATCHED');
  assert.equal(snapshot.conversationTrusteeship.autoReplyCount, 0);
});

test('low confidence, hard risk, AI failure, non-text, and evidence mismatch become local approvals', async () => {
  const messages = {
    low: incoming('low', '您好'),
    risk: incoming('risk', '薪资是多少？'),
    ai: incoming('ai', '还在看机会吗？'),
    media: incoming('media', '', 'image'),
    evidence: incoming('evidence', '您好')
  };
  const harness = await makeHarness({
    reader: {
      async read(conversation) {
        return readOk(conversation, [messages[conversation.conversationId]], messages[conversation.conversationId].fingerprint);
      },
      async send() {
        throw new Error('must not send');
      }
    },
    classifier: {
      async classify(input) {
        const id = input.target.conversationId;
        if (id === 'ai') throw new Error('api-key-secret');
        return {
          category: 'courtesy',
          confidence: id === 'low' ? 0.849 : 0.99,
          reasonCode: 'CLASSIFIED',
          evidenceIds: id === 'evidence' ? ['invented'] : ['resume-1'],
          fieldsNeeded: []
        };
      },
      async draft(input) {
        return { draft: `建议-${input.target.conversationId}`, evidenceIds: ['resume-1'] };
      }
    }
  });
  await harness.register(Object.keys(messages));
  await harness.enableGlobal();

  const summary = await harness.engine.runCycle();
  const snapshot = await harness.store.getSnapshot();
  assert.equal(summary.autoSent, 0);
  assert.equal(harness.calls.send.length, 0);
  assert.equal(Object.values(snapshot.pendingApprovals).filter((item) => item.status === 'PENDING').length, 5);
  assert.equal(JSON.stringify(summary).includes('api-key-secret'), false);
});

test('an unexpected policy failure becomes confirmation and does not block a safe peer', async () => {
  const throwingPolicy = Object.assign({}, Policy, {
    replyDelayMs() {
      return 0;
    },
    detectHardRisk(message) {
      if (message.text === '触发未知失败') throw new Error('raw policy failure');
      return Policy.detectHardRisk(message);
    }
  });
  const harness = await makeHarness({
    policy: throwingPolicy,
    reader: {
      async read(conversation) {
        const message = conversation.conversationId === 'a-fail'
          ? incoming('fail', '触发未知失败')
          : incoming('safe', '您好');
        return readOk(conversation, [message], message.fingerprint);
      },
      async send(conversation, draft, intent) {
        return {
          success: true,
          targetConversationId: conversation.conversationId,
          sentFingerprint: `sent:${intent.intentId}`,
          observedAt: Date.now()
        };
      }
    }
  });
  await harness.register(['a-fail', 'b-safe']);
  await harness.enableGlobal();

  const result = await harness.engine.runCycle();
  const snapshot = await harness.store.getSnapshot();
  assert.equal(snapshot.managedConversations['a-fail'].state, 'WAITING_CONFIRMATION');
  assert.equal(result.autoSent, 1);
  assert.deepEqual(harness.calls.send.map((item) => item.conversationId), ['b-safe']);
  assert.equal(JSON.stringify(result).includes('raw policy failure'), false);
});

test('an existing approval merges later messages without AI or auto-send, and quiet hours suppress notification', async () => {
  let run = 0;
  const harness = await makeHarness({
    now: Date.parse('2026-07-24T23:00:00+08:00'),
    reader: {
      async read(conversation) {
        run += 1;
        const message = run === 1
          ? incoming('m1', '面试时间？')
          : incoming('m2', '补充一条');
        return readOk(conversation, [message], message.fingerprint);
      },
      async send() {
        throw new Error('must not send');
      }
    }
  });
  await harness.register(['conv-1']);
  await harness.enableGlobal({ quietHours: { enabled: true, start: '22:00', end: '08:00' } });

  await harness.engine.runCycle();
  const classifyAfterFirst = harness.calls.classify.length;
  await harness.engine.runCycle();
  const snapshot = await harness.store.getSnapshot();
  const approval = Object.values(snapshot.pendingApprovals)[0];
  assert.deepEqual(approval.incomingFingerprints, ['id:m1', 'id:m2']);
  assert.equal(harness.calls.classify.length, classifyAfterFirst);
  assert.equal(harness.calls.send.length, 0);
  assert.equal(harness.calls.notifyApproval.length, 0);
});

test('quiet-hour safe messages replace stale delayed drafts and send the latest once after quiet hours', async () => {
  let run = 0;
  const harness = await makeHarness({
    now: Date.parse('2026-07-24T23:00:00+08:00'),
    initial: { feishuNotification: { enabled: true } },
    reader: {
      async read(conversation) {
        run += 1;
        if (run === 1) return readOk(
          conversation,
          [incoming('quiet-1', '第一条静默消息')],
          'id:quiet-1'
        );
        if (run === 2) return readOk(
          conversation,
          [incoming('quiet-2', '第二条静默消息')],
          'id:quiet-2'
        );
        return readOk(conversation, [], 'id:quiet-2');
      },
      async send(conversation, draft, intent) {
        return {
          success: true,
          targetConversationId: conversation.conversationId,
          sentFingerprint: `sent:${intent.intentId}`,
          observedAt: Date.now()
        };
      }
    }
  });
  await harness.register(['conv-1']);
  await harness.enableGlobal({
    quietHours: { enabled: true, start: '22:00', end: '08:00' }
  });

  await harness.engine.runCycle();
  await harness.engine.runCycle();
  assert.equal(harness.calls.notifyApproval.length, 0);
  let snapshot = await harness.store.getSnapshot();
  assert.equal(snapshot.managedConversations['conv-1'].state, 'WAITING_REPLY_DUE');
  assert.equal(
    snapshot.managedConversations['conv-1'].pendingReply.fingerprint,
    'id:quiet-2'
  );

  harness.setTime('2026-07-25T09:00:00+08:00');
  await harness.engine.runCycle();
  snapshot = await harness.store.getSnapshot();
  assert.equal(Object.values(snapshot.pendingApprovals).length, 0);
  assert.equal(harness.calls.send.length, 1);
  assert.equal(harness.calls.notifyApproval.length, 0);
  assert.equal(snapshot.managedConversations['conv-1'].state, 'WAITING_HR');
});

test('notifyPending sends a live drill approval once without reading or sending Boss', async () => {
  const harness = await makeHarness({
    initial: {
      feishuNotification: {
        enabled: true,
        webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/example',
        signingSecret: '',
        lastTestOk: true,
        lastTestAt: Date.parse('2026-07-24T08:00:00+08:00')
      }
    }
  });
  await harness.register(['conv-1']);
  await harness.enableGlobal();
  const approval = await harness.store.createLiveDrillApproval({
    conversationId: 'conv-1',
    drillFingerprint: 'live-drill:salary',
    message: '你现在薪资多少，期望多少',
    reasonCode: 'HARD_RISK_SALARY',
    fieldsNeeded: [],
    draft: ''
  });

  const first = await harness.engine.notifyPending();
  const second = await harness.engine.notifyPending();

  assert.deepEqual(first, {
    checked: 0,
    newMessages: 0,
    autoSent: 0,
    pending: 0,
    skipped: 0,
    errors: []
  });
  assert.deepEqual(second, first);
  assert.equal(harness.calls.read.length, 0);
  assert.equal(harness.calls.send.length, 0);
  assert.equal(harness.calls.notifyApproval.length, 1);
  assert.deepEqual(harness.calls.notifyApproval[0], {
    approvalId: approval.approvalId,
    conversationId: 'conv-1',
    company: '公司-conv-1',
    position: '前端工程师',
    hrName: 'HR',
    stage: 'WAITING_CONFIRMATION',
    origin: 'LIVE_DRILL',
    latestSummary: 'HR 有新消息，请在插件内查看完整上下文',
    latestMessage: '你现在薪资多少，期望多少',
    draft: '',
    bossChatUrl: 'https://www.zhipin.com/web/geek/chat?conversationId=conv-1'
  });
});

test('daily limit and missing resume facts force confirmation and getResumeFacts runs at most once', async () => {
  const harness = await makeHarness({
    initial: {
      conversationTrusteeship: {
        enabled: true,
        dailyAutoReplyLimit: 1,
        autoReplyDay: '2026-07-24',
        autoReplyCount: 1
      }
    },
    reader: {
      async read(conversation) {
        const message = incoming(`m-${conversation.conversationId}`, '您好');
        return readOk(conversation, [message], message.fingerprint);
      },
      async send() {
        throw new Error('must not send');
      }
    },
    getResumeFacts() {
      return [];
    }
  });
  await harness.register(['a', 'b']);

  await harness.engine.runCycle();
  assert.equal(harness.calls.getResumeFacts, 1);
  assert.equal(harness.calls.send.length, 0);
  assert.equal(Object.values((await harness.store.getSnapshot()).pendingApprovals).length, 2);
});

test('a failed notification is retried once on the next run and never twice in one cycle', async () => {
  let readCount = 0;
  let notifyCount = 0;
  const harness = await makeHarness({
    initial: {
      feishuNotification: { enabled: true }
    },
    reader: {
      async read(conversation) {
        readCount += 1;
        return readCount === 1
          ? readOk(conversation, [incoming('m1', '薪资？')], 'id:m1')
          : readOk(conversation, [], 'id:m1');
      },
      async send() {
        throw new Error('must not send');
      }
    },
    notifier: {
      async notifyApproval() {
        notifyCount += 1;
        return notifyCount === 1
          ? { ok: false, code: 'HTTP_ERROR' }
          : { ok: true, code: 'OK' };
      },
      async notifyResolved() {
        return { ok: true, code: 'OK' };
      }
    }
  });
  await harness.register(['conv-1']);
  await harness.enableGlobal();

  await harness.engine.runCycle();
  assert.equal(notifyCount, 1);
  await harness.engine.runCycle();
  assert.equal(notifyCount, 2);
  await harness.engine.runCycle();
  assert.equal(notifyCount, 2);
});

test('target failure pauses its conversation, selector failure only defers it, and a safe peer still sends', async () => {
  const harness = await makeHarness({
    reader: {
      async read(conversation) {
        if (conversation.conversationId === 'a-target') {
          return { success: false, errorCode: 'TARGET_UNCERTAIN' };
        }
        if (conversation.conversationId === 'b-selector') {
          return { success: false, errorCode: 'SELECTOR_UNAVAILABLE' };
        }
        return readOk(conversation, [incoming('safe', '您好')], 'id:safe');
      },
      async send(conversation, draft, intent) {
        return {
          success: true,
          targetConversationId: conversation.conversationId,
          sentFingerprint: `sent:${intent.intentId}`,
          observedAt: Date.now()
        };
      }
    }
  });
  await harness.register(['a-target', 'b-selector', 'c-safe']);
  await harness.enableGlobal();

  const summary = await harness.engine.runCycle();
  const snapshot = await harness.store.getSnapshot();
  assert.equal(snapshot.managedConversations['a-target'].state, 'PAUSED');
  assert.equal(snapshot.managedConversations['a-target'].pauseCode, 'TARGET_UNCERTAIN');
  const deferred = snapshot.managedConversations['b-selector'];
  assert.deepEqual(
    {
      state: deferred.state,
      pauseCode: deferred.pauseCode,
      readFailureCount: deferred.readFailureCount,
      lastReadErrorCode: deferred.lastReadErrorCode
    },
    {
      state: 'WAITING_HR',
      pauseCode: '',
      readFailureCount: 1,
      lastReadErrorCode: 'SELECTOR_UNAVAILABLE'
    }
  );
  assert.ok(summary.errors.includes('SELECTOR_UNAVAILABLE'));
  assert.equal(summary.autoSent, 1);
  assert.deepEqual(harness.calls.send.map((item) => item.conversationId), ['c-safe']);
});

test('message-order uncertainty is preserved as a per-conversation pause', async () => {
  const harness = await makeHarness({
    reader: {
      async read() {
        return { success: false, errorCode: 'MESSAGE_ORDER_UNCERTAIN' };
      },
      async send() {
        throw new Error('must not send');
      }
    }
  });
  await harness.register(['conv-1']);
  await harness.enableGlobal();

  const summary = await harness.engine.runCycle();
  const conversation = (await harness.store.getSnapshot())
    .managedConversations['conv-1'];

  assert.equal(conversation.pauseCode, 'MESSAGE_ORDER_UNCERTAIN');
  assert.deepEqual(summary.errors, ['MESSAGE_ORDER_UNCERTAIN']);
});

test('baseline diagnostics remain visible as per-conversation pauses', async () => {
  for (const errorCode of ['BASELINE_NOT_FOUND', 'BASELINE_REQUIRED']) {
    const harness = await makeHarness({
      reader: {
        async read() {
          return { success: false, errorCode };
        },
        async send() {
          throw new Error('must not send');
        }
      }
    });
    await harness.register(['conv-' + errorCode]);
    await harness.enableGlobal();

    const summary = await harness.engine.runCycle();
    const conversation = (await harness.store.getSnapshot())
      .managedConversations['conv-' + errorCode];

    assert.equal(conversation.pauseCode, errorCode);
    assert.deepEqual(summary.errors, [errorCode]);
  }
});

test('an API proof that becomes stale during reading pauses globally without charging the conversation retry budget', async () => {
  const harness = await makeHarness({
    reader: {
      async read() {
        const error = new Error('API_PROOF_STALE');
        error.code = 'API_PROOF_STALE';
        throw error;
      },
      async send() {
        throw new Error('must not send');
      }
    }
  });
  await harness.register(['conv-1']);
  await harness.enableGlobal();

  const result = await harness.engine.runCycle();
  const snapshot = await harness.store.getSnapshot();

  assert.deepEqual(result.errors, ['PREREQUISITE_CHANGED']);
  assert.equal(snapshot.conversationTrusteeship.paused, true);
  assert.equal(snapshot.conversationTrusteeship.pauseCode, 'PREREQUISITE_CHANGED');
  assert.equal(snapshot.managedConversations['conv-1'].state, 'WAITING_HR');
  assert.equal(snapshot.managedConversations['conv-1'].readFailureCount, 0);
});

test('a transient read failure is retried with a bounded backoff before the conversation pauses', async () => {
  const harness = await makeHarness({
    reader: {
      async read() {
        return { success: false, errorCode: 'CONTENT_SCRIPT_UNAVAILABLE' };
      },
      async send() {
        throw new Error('must not send');
      }
    }
  });
  await harness.register(['conv-flaky']);
  await harness.enableGlobal();

  const observed = [];
  for (let cycle = 0; cycle < 3; cycle += 1) {
    await harness.engine.runCycle();
    const conversation = (await harness.store.getSnapshot()).managedConversations['conv-flaky'];
    observed.push({ state: conversation.state, readFailureCount: conversation.readFailureCount });
  }

  assert.deepEqual(observed, [
    { state: 'WAITING_HR', readFailureCount: 1 },
    { state: 'WAITING_HR', readFailureCount: 2 },
    { state: 'PAUSED', readFailureCount: 3 }
  ]);
  assert.equal(harness.calls.read.length, 3);
  assert.equal(
    (await harness.store.getSnapshot()).managedConversations['conv-flaky'].pauseCode,
    'CONTENT_SCRIPT_UNAVAILABLE'
  );
});

test('a successful check clears the read backoff counter', async () => {
  let failNext = true;
  const harness = await makeHarness({
    reader: {
      async read(conversation) {
        if (failNext) {
          failNext = false;
          return { success: false, errorCode: 'CONVERSATION_UNAVAILABLE' };
        }
        return readOk(conversation, []);
      },
      async send() {
        throw new Error('must not send');
      }
    }
  });
  await harness.register(['conv-recovers']);
  await harness.enableGlobal();

  await harness.engine.runCycle();
  const afterFailure = (await harness.store.getSnapshot()).managedConversations['conv-recovers'];
  await harness.engine.runCycle();
  const afterSuccess = (await harness.store.getSnapshot()).managedConversations['conv-recovers'];

  assert.equal(afterFailure.readFailureCount, 1);
  assert.deepEqual(
    { count: afterSuccess.readFailureCount, code: afterSuccess.lastReadErrorCode },
    { count: 0, code: '' }
  );
});

test('a retryable pause left by an earlier version resumes once at the start of the next cycle', async () => {
  const harness = await makeHarness();
  await harness.register(['conv-stale']);
  await harness.enableGlobal();
  await harness.store.pauseConversation('conv-stale', 'CONVERSATION_UNAVAILABLE');

  await harness.engine.runCycle();
  const conversation = (await harness.store.getSnapshot()).managedConversations['conv-stale'];

  assert.deepEqual(harness.calls.read, ['conv-stale']);
  assert.deepEqual(
    { state: conversation.state, pauseCode: conversation.pauseCode },
    { state: 'WAITING_HR', pauseCode: '' }
  );
});

test('a pause that already exhausted the read backoff still requires manual review', async () => {
  const harness = await makeHarness({
    reader: {
      async read() {
        return { success: false, errorCode: 'CONVERSATION_UNAVAILABLE' };
      },
      async send() {
        throw new Error('must not send');
      }
    }
  });
  await harness.register(['conv-exhausted']);
  await harness.enableGlobal();
  for (let cycle = 0; cycle < 3; cycle += 1) await harness.engine.runCycle();
  const readsBeforeExtraCycle = harness.calls.read.length;

  const summary = await harness.engine.runCycle();
  const conversation = (await harness.store.getSnapshot()).managedConversations['conv-exhausted'];

  assert.equal(harness.calls.read.length, readsBeforeExtraCycle);
  assert.equal(summary.skipped, 1);
  assert.equal(conversation.state, 'PAUSED');
});

test('login or block failure globally pauses and prevents later conversations from being read', async () => {
  const harness = await makeHarness({
    reader: {
      async read() {
        return { success: false, errorCode: 'LOGIN_REQUIRED' };
      },
      async send() {
        throw new Error('must not send');
      }
    }
  });
  await harness.register(['a', 'b']);
  await harness.enableGlobal();

  const summary = await harness.engine.runCycle();
  const snapshot = await harness.store.getSnapshot();
  assert.deepEqual(harness.calls.read, ['a']);
  assert.equal(snapshot.conversationTrusteeship.paused, true);
  assert.equal(snapshot.conversationTrusteeship.pauseCode, 'LOGIN_REQUIRED');
  assert.deepEqual(summary.errors, ['LOGIN_REQUIRED']);
});

test('a global pause discovered while reading suppresses pending notifications in that cycle', async () => {
  const harness = await makeHarness({
    initial: { feishuNotification: { enabled: true } },
    reader: {
      async read() {
        return { success: false, errorCode: 'BOSS_BLOCKED' };
      },
      async send() {
        throw new Error('must not send');
      }
    }
  });
  await harness.register(['a', 'pending']);
  await harness.store.beginMessage('pending', 'fp-pending');
  await harness.store.createOrMergeApproval({
    conversationId: 'pending',
    incomingFingerprint: 'fp-pending',
    messages: ['待处理']
  });
  await harness.enableGlobal();

  await harness.engine.runCycle();
  assert.equal(harness.calls.notifyApproval.length, 0);
});

test('unknown auto-send result keeps read-only verification and is never resent', async () => {
  const harness = await makeHarness({
    reader: {
      async read(conversation) {
        return readOk(conversation, [incoming('m1', '您好')], 'id:m1');
      },
      async send() {
        return { success: false, errorCode: 'SEND_RESULT_UNKNOWN', secret: 'must-not-leak' };
      }
    }
  });
  await harness.register(['conv-1']);
  await harness.enableGlobal();

  const first = await harness.engine.runCycle();
  const second = await harness.engine.runCycle();
  const conversation = (await harness.store.getSnapshot()).managedConversations['conv-1'];
  assert.equal(conversation.state, 'VERIFYING_SEND');
  assert.equal(conversation.sendIntent.status, 'SEND_RESULT_UNKNOWN');
  assert.equal(harness.calls.send.length, 1);
  assert.equal(JSON.stringify(first).includes('must-not-leak'), false);
  assert.equal(second.autoSent, 0);
});

test('a later read-only receipt reconciles an unknown send and resumes multi-turn monitoring', async () => {
  let reads = 0;
  const harness = await makeHarness({
    reader: {
      async read(conversation) {
        reads += 1;
        return readOk(
          conversation,
          reads === 1 ? [incoming('m1', '您好')] : [],
          reads === 1 ? 'id:m1' : conversation.lastIncomingFingerprint
        );
      },
      async send() {
        return { success: false, errorCode: 'SEND_RESULT_UNKNOWN' };
      },
      async verifySend(conversation, intent) {
        return {
          success: true,
          targetConversationId: conversation.conversationId,
          sentFingerprint: 'id:receipt-' + intent.intentId,
          observedAt: Date.now()
        };
      }
    }
  });
  await harness.register(['conv-1']);
  await harness.enableGlobal();

  await harness.engine.runCycle();
  await harness.engine.runCycle();

  const conversation = (await harness.store.getSnapshot()).managedConversations['conv-1'];
  assert.equal(conversation.state, 'WAITING_HR');
  assert.equal(conversation.enabled, true);
  assert.equal(conversation.sendIntent.status, 'SENT');
  assert.equal(harness.calls.send.length, 1);
  assert.equal(harness.calls.verifySend.length, 1);
});

test('a proof rotation after AI work blocks auto and manual intent creation before send', async () => {
  let stale = false;
  function guardExternalAction() {
    if (!stale) return;
    const error = new Error('API_PROOF_STALE');
    error.code = 'API_PROOF_STALE';
    throw error;
  }
  const auto = await makeHarness({
    guardExternalAction,
    reader: {
      async read(conversation) {
        return readOk(conversation, [incoming('m1', '您好')], 'id:m1');
      },
      async send() {
        throw new Error('must not send');
      }
    },
    classifier: {
      async classify() {
        return {
          category: 'courtesy',
          confidence: 0.99,
          reasonCode: 'SAFE',
          evidenceIds: ['resume-1'],
          fieldsNeeded: []
        };
      },
      async draft() {
        stale = true;
        return { draft: '您好，谢谢。', evidenceIds: ['resume-1'] };
      }
    }
  });
  await auto.register(['conv-1']);
  await auto.enableGlobal();

  const autoResult = await auto.engine.runCycle();
  const autoConversation = (await auto.store.getSnapshot()).managedConversations['conv-1'];
  assert.equal(autoResult.autoSent, 0);
  assert.equal(auto.calls.send.length, 0);
  assert.equal(autoConversation.sendIntent, undefined);

  stale = false;
  const manual = await makeHarness({
    guardExternalAction,
    reader: {
      async read(conversation) {
        stale = true;
        return readOk(conversation, [], conversation.lastIncomingFingerprint);
      },
      async send() {
        throw new Error('must not send');
      }
    }
  });
  await manual.register(['conv-1']);
  await manual.store.beginMessage('conv-1', 'fp');
  const approval = await manual.store.createOrMergeApproval({
    conversationId: 'conv-1',
    incomingFingerprint: 'fp',
    messages: ['A']
  });

  await assert.rejects(
    () => manual.engine.resolveApproval({
      approvalId: approval.approvalId,
      action: 'SEND_EDITED',
      draft: '人工确认回复'
    }),
    (error) => error.code === 'API_PROOF_STALE'
  );
  const manualConversation = (await manual.store.getSnapshot()).managedConversations['conv-1'];
  assert.equal(manual.calls.send.length, 0);
  assert.equal(manualConversation.sendIntent, undefined);
});

test('resolveApproval supports NO_REPLY and DISABLE_CONVERSATION after persistence', async () => {
  const harness = await makeHarness();
  await harness.register(['no-reply', 'disable']);
  await harness.store.beginMessage('no-reply', 'fp-no');
  const noReply = await harness.store.createOrMergeApproval({
    conversationId: 'no-reply',
    incomingFingerprint: 'fp-no',
    messages: ['A']
  });
  await harness.store.beginMessage('disable', 'fp-disable');
  const disable = await harness.store.createOrMergeApproval({
    conversationId: 'disable',
    incomingFingerprint: 'fp-disable',
    messages: ['B']
  });

  assert.deepEqual(await harness.engine.resolveApproval({
    approvalId: noReply.approvalId,
    action: 'NO_REPLY'
  }), { ok: true, action: 'NO_REPLY', status: 'NO_REPLY' });
  assert.deepEqual(await harness.engine.resolveApproval({
    approvalId: disable.approvalId,
    action: 'DISABLE_CONVERSATION'
  }), { ok: true, action: 'DISABLE_CONVERSATION', status: 'DISABLED' });
  const snapshot = await harness.store.getSnapshot();
  assert.equal(snapshot.managedConversations.disable.enabled, false);
  assert.equal(harness.calls.notifyResolved.length, 2);
});

test('SEND_EDITED trims and bounds the draft, rereads target, and consumes one manual intent', async () => {
  let readAt = 0;
  const harness = await makeHarness({
    reader: {
      async read(conversation) {
        readAt += 1;
        return readOk(conversation, [], conversation.lastIncomingFingerprint);
      },
      async send(conversation, draft, intent) {
        assert.equal(readAt, 1);
        assert.equal(draft, '人工确认回复');
        assert.equal(intent.mode, 'MANUAL');
        return {
          success: true,
          targetConversationId: conversation.conversationId,
          sentFingerprint: 'sent-manual',
          observedAt: Date.now()
        };
      }
    }
  });
  await harness.register(['conv-1']);
  await harness.store.beginMessage('conv-1', 'fp');
  const approval = await harness.store.createOrMergeApproval({
    conversationId: 'conv-1',
    incomingFingerprint: 'fp',
    messages: ['A']
  });

  const result = await harness.engine.resolveApproval({
    approvalId: approval.approvalId,
    action: 'SEND_EDITED',
    draft: '  人工确认回复  '
  });
  assert.deepEqual(result, { ok: true, action: 'SEND_EDITED', status: 'SENT' });
  assert.equal((await harness.store.getSnapshot()).conversationTrusteeship.autoReplyCount, 0);
  await assert.rejects(
    () => harness.engine.resolveApproval({
      approvalId: approval.approvalId,
      action: 'SEND_EDITED',
      draft: '再次发送'
    }),
    (error) => error.code === 'APPROVAL_NOT_PENDING'
  );
  await assert.rejects(
    () => harness.engine.resolveApproval({
      approvalId: 'missing',
      action: 'SEND_EDITED',
      draft: 'x'.repeat(301)
    }),
    (error) => error.code === 'INVALID_APPROVAL_INPUT'
  );
});

test('SEND_EDITED marks an unknown result terminal and cannot resend it', async () => {
  const harness = await makeHarness({
    reader: {
      async read(conversation) {
        return readOk(conversation, [], conversation.lastIncomingFingerprint);
      },
      async send() {
        throw new Error('network outcome unknown');
      }
    }
  });
  await harness.register(['conv-1']);
  await harness.store.beginMessage('conv-1', 'fp');
  const approval = await harness.store.createOrMergeApproval({
    conversationId: 'conv-1',
    incomingFingerprint: 'fp',
    messages: ['A']
  });

  const result = await harness.engine.resolveApproval({
    approvalId: approval.approvalId,
    action: 'SEND_EDITED',
    draft: '人工回复'
  });
  assert.deepEqual(result, {
    ok: false,
    action: 'SEND_EDITED',
    status: 'SEND_RESULT_UNKNOWN',
    errorCode: 'SEND_RESULT_UNKNOWN'
  });
  const conversation = (await harness.store.getSnapshot()).managedConversations['conv-1'];
  assert.equal(conversation.sendIntent.status, 'SEND_RESULT_UNKNOWN');
  assert.equal(harness.calls.send.length, 1);
});

test('serializes runCycle and resolveApproval external actions on one engine instance', async () => {
  const readEntered = deferred();
  const releaseRead = deferred();
  const harness = await makeHarness({
    reader: {
      async read(conversation) {
        readEntered.resolve();
        await releaseRead.promise;
        return readOk(conversation, [], conversation.lastIncomingFingerprint);
      },
      async send() {
        throw new Error('must not send');
      }
    }
  });
  await harness.register(['conv-1']);
  await harness.store.beginMessage('conv-1', 'fp');
  const approval = await harness.store.createOrMergeApproval({
    conversationId: 'conv-1',
    incomingFingerprint: 'fp',
    messages: ['A']
  });
  await harness.enableGlobal();

  const cycle = harness.engine.runCycle();
  await readEntered.promise;
  const resolution = harness.engine.resolveApproval({
    approvalId: approval.approvalId,
    action: 'NO_REPLY'
  });
  let resolutionSettled = false;
  resolution.then(() => {
    resolutionSettled = true;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(resolutionSettled, false);
  assert.equal(
    (await harness.store.getSnapshot()).pendingApprovals[approval.approvalId].status,
    'PENDING'
  );

  releaseRead.resolve();
  await Promise.all([cycle, resolution]);
  assert.equal(
    (await harness.store.getSnapshot()).pendingApprovals[approval.approvalId].status,
    'NO_REPLY'
  );
});

test('two engines and stores cannot exceed a limit-one AUTO reservation', async () => {
  const harness = await makeHarness();
  await harness.register(['conv-a', 'conv-b']);
  await harness.enableGlobal({ dailyAutoReplyLimit: 1 });
  const sendEntered = deferred();
  const releaseSend = deferred();
  let sendCount = 0;

  function engineReader(target) {
    return {
      async read(conversation) {
        const messages = conversation.conversationId === target
          ? [incoming(`message-${target}`, '您好')]
          : [];
        return readOk(conversation, messages);
      },
      async send(conversation, draft, intent) {
        sendCount += 1;
        sendEntered.resolve();
        await releaseSend.promise;
        return {
          success: true,
          targetConversationId: conversation.conversationId,
          sentFingerprint: `sent:${intent.intentId}`,
          observedAt: Date.now()
        };
      }
    };
  }

  const secondStore = ConversationStore.create(
    harness.storage,
    () => Date.parse('2026-07-24T09:00:00+08:00'),
    (kind) => `second-${kind}`
  );
  const shared = {
    classifier: harness.deps.classifier,
    notifier: harness.deps.notifier,
    policy: Object.assign({}, Policy, {
      replyDelayMs() {
        return 0;
      }
    }),
    clock: harness.deps.clock,
    getResumeFacts: harness.deps.getResumeFacts
  };
  const engineA = MonitorEngine.create(Object.assign({
    store: harness.store,
    reader: engineReader('conv-a')
  }, shared));
  const engineB = MonitorEngine.create(Object.assign({
    store: secondStore,
    reader: engineReader('conv-b')
  }, shared));

  const cycles = Promise.all([engineA.runCycle(), engineB.runCycle()]);
  await sendEntered.promise;
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(sendCount, 1);
  releaseSend.resolve();
  await cycles;
  assert.equal(sendCount, 1);
  assert.equal((await harness.store.getSnapshot()).conversationTrusteeship.autoReplyCount, 1);
});

test('an atomic store gate blocks AUTO send when global pause races after policy', async () => {
  let storeRef;
  const harness = await makeHarness({
    classifier: {
      async classify() {
        return {
          category: 'courtesy',
          confidence: 0.99,
          reasonCode: 'SAFE',
          evidenceIds: ['resume-1'],
          fieldsNeeded: []
        };
      },
      async draft() {
        await storeRef.saveSettings({ paused: true, pauseCode: 'BOSS_BLOCKED' });
        return { draft: '自动回复', evidenceIds: ['resume-1'] };
      }
    },
    reader: {
      async read(conversation) {
        return readOk(conversation, [incoming('m1', '您好')]);
      },
      async send() {
        throw new Error('must not send after pause');
      }
    }
  });
  storeRef = harness.store;
  await harness.register(['conv-1']);
  await harness.enableGlobal();

  await harness.engine.runCycle();
  const snapshot = await harness.store.getSnapshot();
  assert.equal(harness.calls.send.length, 0);
  assert.equal(snapshot.conversationTrusteeship.autoReplyCount, 0);
  assert.equal(snapshot.managedConversations['conv-1'].state, 'WAITING_CONFIRMATION');
});

test('rejects missing, poisoned, or conflicting reader conversation identity before AI', async () => {
  const harness = await makeHarness({
    reader: {
      async read(conversation) {
        if (conversation.conversationId === 'missing-ref') {
          return {
            success: true,
            conversationId: conversation.conversationId,
            baseline: '',
            messages: []
          };
        }
        if (conversation.conversationId === 'poison-url') {
          const result = readOk(conversation, [], '');
          result.conversationRef.url =
            'https://www.zhipin.com.evil.test/web/geek/chat?conversationId=poison-url';
          return result;
        }
        const result = readOk(conversation, [], '');
        result.conversationRef.company = '冲突公司';
        return result;
      },
      async send() {
        throw new Error('must not send');
      }
    }
  });
  await harness.register(['missing-ref', 'poison-url', 'identity-conflict']);
  await harness.enableGlobal();

  const result = await harness.engine.runCycle();
  const snapshot = await harness.store.getSnapshot();
  assert.equal(harness.calls.classify.length, 0);
  assert.equal(harness.calls.send.length, 0);
  for (const id of ['missing-ref', 'poison-url', 'identity-conflict']) {
    assert.equal(snapshot.managedConversations[id].state, 'PAUSED');
  }
  assert.deepEqual(result.errors, ['TARGET_UNCERTAIN']);
});

test('maps injected secret-shaped error codes before summary, persistence, or notification', async () => {
  const secretCodes = [
    'API_KEY_SECRET_CLASSIFY',
    'API_KEY_SECRET_DRAFT',
    'TOKEN_SECRET_READER',
    'WEBHOOK_SECRET_NOTIFY'
  ];
  const payloads = [];
  const harness = await makeHarness({
    initial: { feishuNotification: { enabled: true } },
    reader: {
      async read(conversation) {
        if (conversation.conversationId === 'reader') {
          return { success: false, errorCode: secretCodes[2] };
        }
        return readOk(conversation, [incoming(`m-${conversation.conversationId}`, '您好')]);
      },
      async send() {
        throw new Error('must not send');
      }
    },
    classifier: {
      async classify(input) {
        if (input.target.conversationId === 'classify') {
          const error = new Error('secret');
          error.code = secretCodes[0];
          throw error;
        }
        return {
          category: 'courtesy',
          confidence: 0.99,
          reasonCode: 'SAFE',
          evidenceIds: ['resume-1'],
          fieldsNeeded: []
        };
      },
      async draft() {
        const error = new Error('secret');
        error.code = secretCodes[1];
        throw error;
      }
    },
    notifier: {
      async notifyApproval(payload) {
        payloads.push(payload);
        const error = new Error('secret');
        error.code = secretCodes[3];
        throw error;
      },
      async notifyResolved() {
        return { ok: true, code: 'OK' };
      }
    }
  });
  await harness.register(['classify', 'draft', 'reader']);
  await harness.enableGlobal();

  const result = await harness.engine.runCycle();
  const serialized = JSON.stringify({
    result,
    snapshot: await harness.store.getSnapshot(),
    payloads
  });
  for (const secret of secretCodes) assert.equal(serialized.includes(secret), false);
  const approvals = Object.values((await harness.store.getSnapshot()).pendingApprovals);
  assert.ok(approvals.some((approval) => approval.reasonCode === 'AI_CLASSIFY_FAILED'));
  assert.ok(approvals.some((approval) => approval.reasonCode === 'AI_DRAFT_FAILED'));
  assert.ok(result.errors.includes('CONVERSATION_UNAVAILABLE'));
});

test('rejects a non-final message baseline without sending and safely repeats it later', async () => {
  let valid = false;
  const harness = await makeHarness({
    reader: {
      async read(conversation) {
        const message = incoming('repeat', '您好');
        return readOk(conversation, [message], valid ? message.fingerprint : 'id:not-final');
      },
      async send(conversation, draft, intent) {
        return {
          success: true,
          targetConversationId: conversation.conversationId,
          sentFingerprint: `sent:${intent.intentId}`,
          observedAt: Date.now()
        };
      }
    }
  });
  await harness.register(['conv-1']);
  await harness.enableGlobal();

  await harness.engine.runCycle();
  let snapshot = await harness.store.getSnapshot();
  assert.equal(harness.calls.send.length, 0);
  assert.deepEqual(snapshot.managedConversations['conv-1'].processedFingerprints, []);
  assert.equal(snapshot.managedConversations['conv-1'].lastIncomingFingerprint, '');

  await harness.store.resetConversation('conv-1');
  valid = true;
  await harness.store.saveSettings({ paused: false, pauseCode: '' });
  await harness.engine.runCycle();
  snapshot = await harness.store.getSnapshot();
  assert.equal(harness.calls.send.length, 1);
  assert.equal(snapshot.managedConversations['conv-1'].lastIncomingFingerprint, 'id:repeat');
});

test('rejects an empty batch whose baseline differs from the requested checkpoint', async () => {
  const harness = await makeHarness({
    reader: {
      async read(conversation) {
        return readOk(conversation, [], 'unexpected-skip');
      },
      async send() {
        throw new Error('must not send');
      }
    }
  });
  await harness.register(['conv-1']);
  await harness.store.markConversationChecked('conv-1', { baseline: 'requested-base' });
  await harness.enableGlobal();

  await harness.engine.runCycle();
  const deferred = (await harness.store.getSnapshot()).managedConversations['conv-1'];
  assert.deepEqual(
    {
      baseline: deferred.lastIncomingFingerprint,
      state: deferred.state,
      readFailureCount: deferred.readFailureCount
    },
    { baseline: 'requested-base', state: 'WAITING_HR', readFailureCount: 1 }
  );

  await harness.engine.runCycle();
  await harness.engine.runCycle();
  const exhausted = (await harness.store.getSnapshot()).managedConversations['conv-1'];
  assert.deepEqual(
    { baseline: exhausted.lastIncomingFingerprint, state: exhausted.state },
    { baseline: 'requested-base', state: 'PAUSED' }
  );
});

test('global login pause advances the cursor only past slots actually attempted', async () => {
  let blocked = true;
  const harness = await makeHarness({
    reader: {
      async read(conversation) {
        if (blocked) return { success: false, errorCode: 'LOGIN_REQUIRED' };
        return readOk(conversation, [], conversation.lastIncomingFingerprint);
      },
      async send() {
        throw new Error('must not send');
      }
    }
  });
  const ids = Array.from({ length: 10 }, (_, index) => `conv-${String(index + 1).padStart(2, '0')}`);
  await harness.register(ids);
  await harness.enableGlobal();

  await harness.engine.runCycle();
  assert.equal((await harness.store.getSnapshot()).conversationTrusteeship.monitorCursor, 1);

  blocked = false;
  harness.calls.read.length = 0;
  await harness.store.saveSettings({ paused: false, pauseCode: '' });
  await harness.engine.runCycle();
  assert.equal(harness.calls.read[0], 'conv-02');
});

test('two engines reserve a pending notification before egress so only one can notify', async () => {
  let notifyCount = 0;
  const harness = await makeHarness({
    initial: { feishuNotification: { enabled: true } },
    notifier: {
      async notifyApproval() {
        notifyCount += 1;
        return { ok: true, code: 'OK' };
      },
      async notifyResolved() {
        return { ok: true, code: 'OK' };
      }
    }
  });
  await harness.register(['conv-1']);
  await harness.store.beginMessage('conv-1', 'fp');
  await harness.store.createOrMergeApproval({
    conversationId: 'conv-1',
    incomingFingerprint: 'fp',
    messages: ['A']
  });
  await harness.enableGlobal();

  const secondStore = ConversationStore.create(
    harness.storage,
    harness.deps.clock,
    (kind) => `second-${kind}`
  );
  const secondEngine = MonitorEngine.create(Object.assign({}, harness.deps, {
    store: secondStore
  }));
  await Promise.all([harness.engine.runCycle(), secondEngine.runCycle()]);
  assert.equal(notifyCount, 1);
});

test('a notification completion persistence failure leaves its reservation non-retryable', async () => {
  let notifyCount = 0;
  let storage;
  const harness = await makeHarness({
    initial: { feishuNotification: { enabled: true } },
    notifier: {
      async notifyApproval() {
        notifyCount += 1;
        storage.failNextSet();
        return { ok: false, code: 'HTTP_ERROR' };
      },
      async notifyResolved() {
        return { ok: true, code: 'OK' };
      }
    }
  });
  storage = harness.storage;
  await harness.register(['conv-1']);
  await harness.store.beginMessage('conv-1', 'fp');
  await harness.store.createOrMergeApproval({
    conversationId: 'conv-1',
    incomingFingerprint: 'fp',
    messages: ['A']
  });
  await harness.enableGlobal();

  await harness.engine.runCycle();
  await harness.engine.runCycle();
  assert.equal(notifyCount, 1);
  const attempt = (await harness.store.getSnapshot())
    .pendingApprovals['approval-1'].feishuNotifyAttempts[0];
  assert.equal(attempt.status, 'SENDING');
});

test('cancels a notification reservation when quiet hours begin before egress', async () => {
  let notifyCount = 0;
  const harness = await makeHarness({
    initial: { feishuNotification: { enabled: true } },
    notifier: {
      async notifyApproval() {
        notifyCount += 1;
        return { ok: true, code: 'OK' };
      },
      async notifyResolved() {
        return { ok: true, code: 'OK' };
      }
    }
  });
  await harness.register(['conv-1']);
  await harness.store.beginMessage('conv-1', 'fp');
  const approval = await harness.store.createOrMergeApproval({
    conversationId: 'conv-1',
    incomingFingerprint: 'fp',
    messages: ['A']
  });
  await harness.enableGlobal({
    quietHours: { enabled: true, start: '10:00', end: '11:00' }
  });

  const wrappedStore = {};
  for (const [name, method] of Object.entries(harness.store)) {
    wrappedStore[name] = method.bind(harness.store);
  }
  wrappedStore.recordNotificationAttempt = async function (approvalId, operation) {
    const result = await harness.store.recordNotificationAttempt(approvalId, operation);
    if (operation.phase === 'RESERVE') harness.setTime('2026-07-24T10:30:00+08:00');
    return result;
  };
  const engine = MonitorEngine.create(Object.assign({}, harness.deps, {
    store: wrappedStore
  }));

  await engine.runCycle();
  assert.equal(notifyCount, 0);
  assert.deepEqual(
    (await harness.store.getSnapshot()).pendingApprovals[approval.approvalId]
      .feishuNotifyAttempts,
    []
  );
});

test('cancels a notification reservation when global pause wins before egress', async () => {
  let notifyCount = 0;
  const harness = await makeHarness({
    initial: { feishuNotification: { enabled: true } },
    notifier: {
      async notifyApproval() {
        notifyCount += 1;
        return { ok: true, code: 'OK' };
      },
      async notifyResolved() {
        return { ok: true, code: 'OK' };
      }
    }
  });
  await harness.register(['conv-1']);
  await harness.store.beginMessage('conv-1', 'fp');
  const approval = await harness.store.createOrMergeApproval({
    conversationId: 'conv-1',
    incomingFingerprint: 'fp',
    messages: ['A']
  });
  await harness.enableGlobal();

  const wrappedStore = {};
  for (const [name, method] of Object.entries(harness.store)) {
    wrappedStore[name] = method.bind(harness.store);
  }
  wrappedStore.recordNotificationAttempt = async function (approvalId, operation) {
    const result = await harness.store.recordNotificationAttempt(approvalId, operation);
    if (operation.phase === 'RESERVE') {
      await harness.store.saveSettings({
        paused: true,
        pauseCode: 'BOSS_BLOCKED',
        pauseReason: ''
      });
    }
    return result;
  };
  const engine = MonitorEngine.create(Object.assign({}, harness.deps, {
    store: wrappedStore
  }));

  await engine.runCycle();
  assert.equal(notifyCount, 0);
  assert.deepEqual(
    (await harness.store.getSnapshot()).pendingApprovals[approval.approvalId]
      .feishuNotifyAttempts,
    []
  );
});

test('revalidates the exact pending owner synchronously after the notifier await and before external egress', async () => {
  let egressCount = 0;
  const harness = await makeHarness({
    initial: { feishuNotification: { enabled: true } }
  });
  await harness.register(['conv-1']);
  await harness.store.beginMessage('conv-1', 'fp');
  await harness.store.createOrMergeApproval({
    conversationId: 'conv-1',
    incomingFingerprint: 'fp',
    messages: ['A']
  });
  await harness.enableGlobal();

  const notifier = Runtime.createNotifier({
    store: {
      async getSnapshot() {
        await harness.store.pauseConversation('conv-1', 'TARGET_UNCERTAIN');
        return harness.store.getSnapshot();
      }
    },
    notifierModule: {
      buildApprovalCard(input) { return input; }
    },
    client: {
      async send() {
        egressCount += 1;
        return { ok: true, code: 'OK' };
      }
    }
  });
  const engine = MonitorEngine.create(Object.assign({}, harness.deps, { notifier }));

  await engine.runCycle();
  assert.equal(egressCount, 0);
  assert.equal(
    (await harness.store.getSnapshot()).managedConversations['conv-1'].state,
    'PAUSED'
  );
});

for (const scenario of [
  {
    name: 'owner pause',
    async mutate(harness) {
      await harness.store.pauseConversation('conv-1', 'TARGET_UNCERTAIN');
    }
  },
  {
    name: 'approval unlink',
    async mutate(harness, approval) {
      await harness.store.resolveApprovalWithoutSend(approval.approvalId);
    }
  },
  {
    name: 'second local pending approval',
    async mutate(harness) {
      harness.storage.data.pendingApprovals['approval-conflict'] = {
        approvalId: 'approval-conflict',
        conversationId: 'conv-1',
        status: 'PENDING',
        createdAt: 2,
        updatedAt: 2,
        incomingFingerprints: ['fp-conflict'],
        messages: ['conflict'],
        fieldsNeeded: [],
        draft: '',
        feishuNotifyAttempts: []
      };
    }
  },
  {
    name: 'global disable',
    async mutate(harness) {
      await harness.store.saveSettings({ enabled: false });
    }
  },
  {
    name: 'Feishu disable',
    async mutate(harness) {
      harness.storage.data.feishuNotification.enabled = false;
    }
  },
  {
    name: 'quiet hours begin',
    async mutate(harness) {
      await harness.store.saveSettings({
        quietHours: { enabled: true, start: '08:00', end: '10:00' }
      });
    }
  }
]) {
  test(`signed Feishu dispatch stays blocked when ${scenario.name} wins during subtle.sign`, async () => {
    const signStarted = deferred();
    const releaseSign = deferred();
    let fetchCount = 0;
    const harness = await makeHarness({
      initial: {
        feishuNotification: {
          enabled: true,
          webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/test-token',
          signingSecret: 'test-signing-secret'
        }
      }
    });
    await harness.register(['conv-1']);
    await harness.store.beginMessage('conv-1', 'fp');
    const approval = await harness.store.createOrMergeApproval({
      conversationId: 'conv-1',
      incomingFingerprint: 'fp',
      messages: ['A']
    });
    await harness.enableGlobal();

    const client = FeishuNotifier.create({
      clock: harness.deps.clock,
      subtle: {
        async importKey() {
          return {};
        },
        async sign() {
          signStarted.resolve();
          return releaseSign.promise;
        }
      },
      async fetchFn() {
        fetchCount += 1;
        return { ok: true, async json() { return { code: 0 }; } };
      }
    });
    const notifier = Runtime.createNotifier({
      store: harness.store,
      client,
      notifierModule: FeishuNotifier
    });
    const engine = MonitorEngine.create(Object.assign({}, harness.deps, { notifier }));

    const cycle = engine.runCycle();
    await signStarted.promise;
    await scenario.mutate(harness, approval);
    releaseSign.resolve(new Uint8Array([1, 2, 3]).buffer);
    await cycle;

    assert.equal(fetchCount, 0);
    const attempts = (await harness.store.getSnapshot())
      .pendingApprovals[approval.approvalId].feishuNotifyAttempts;
    assert.ok(
      attempts.length === 0 ||
      (attempts.length === 1 && attempts[0].status === 'UNKNOWN')
    );
    await engine.runCycle();
    assert.equal(fetchCount, 0);
  });
}

test('runtime dispatches one prepared signed Feishu request when the final owner gate remains current', async () => {
  let fetchCount = 0;
  const harness = await makeHarness({
    initial: {
      feishuNotification: {
        enabled: true,
        webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/test-token',
        signingSecret: 'test-signing-secret'
      }
    }
  });
  await harness.register(['conv-1']);
  await harness.store.beginMessage('conv-1', 'fp');
  await harness.store.createOrMergeApproval({
    conversationId: 'conv-1',
    incomingFingerprint: 'fp',
    messages: ['A']
  });
  await harness.enableGlobal();

  const client = FeishuNotifier.create({
    clock: harness.deps.clock,
    subtle: {
      async importKey() {
        return {};
      },
      async sign() {
        return new Uint8Array([1, 2, 3]).buffer;
      }
    },
    async fetchFn() {
      fetchCount += 1;
      return { ok: true, async json() { return { code: 0 }; } };
    }
  });
  const notifier = Runtime.createNotifier({
    store: harness.store,
    client,
    notifierModule: FeishuNotifier
  });
  const engine = MonitorEngine.create(Object.assign({}, harness.deps, { notifier }));

  await engine.runCycle();
  assert.equal(fetchCount, 1);
});

test('double terminal persistence failure recovers on the next read without resending', async () => {
  let storage;
  const harness = await makeHarness({
    reader: {
      async read(conversation) {
        return readOk(conversation, [incoming('m1', '您好')]);
      },
      async send(conversation, draft, intent) {
        storage.failNextSet();
        storage.failNextSet();
        return {
          success: true,
          targetConversationId: conversation.conversationId,
          sentFingerprint: `sent:${intent.intentId}`,
          observedAt: Date.now()
        };
      }
    }
  });
  storage = harness.storage;
  await harness.register(['conv-1']);
  await harness.enableGlobal({ dailyAutoReplyLimit: 2 });

  const result = await harness.engine.runCycle();
  assert.ok(result.errors.includes('SEND_RESULT_UNKNOWN'));
  assert.equal(harness.calls.send.length, 1);

  let snapshot = await harness.store.getSnapshot();
  assert.equal(snapshot.managedConversations['conv-1'].state, 'VERIFYING_SEND');
  assert.equal(
    snapshot.managedConversations['conv-1'].sendIntent.status,
    'SEND_RESULT_UNKNOWN'
  );
  assert.equal(snapshot.conversationTrusteeship.autoReplyCount, 1);

  await harness.engine.runCycle();
  snapshot = await harness.store.getSnapshot();
  assert.equal(harness.calls.send.length, 1);
  assert.equal(snapshot.conversationTrusteeship.autoReplyCount, 1);
});

test('resolveApproval maps arbitrary reader errors to a stable unavailable code', async () => {
  const secretCode = 'TOKEN_SECRET_RESOLVE';
  const harness = await makeHarness({
    reader: {
      async read() {
        return { success: false, errorCode: secretCode };
      },
      async send() {
        throw new Error('must not send');
      }
    }
  });
  await harness.register(['conv-1']);
  await harness.store.beginMessage('conv-1', 'fp');
  const approval = await harness.store.createOrMergeApproval({
    conversationId: 'conv-1',
    incomingFingerprint: 'fp',
    messages: ['A']
  });

  const result = await harness.engine.resolveApproval({
    approvalId: approval.approvalId,
    action: 'SEND_EDITED',
    draft: '人工回复'
  });
  assert.deepEqual(result, {
    ok: false,
    action: 'SEND_EDITED',
    status: 'PAUSED',
    errorCode: 'CONVERSATION_UNAVAILABLE'
  });
  assert.equal(JSON.stringify(await harness.store.getSnapshot()).includes(secretCode), false);
});

test('maps an arbitrary injected store error at the public engine boundary', async () => {
  const harness = await makeHarness();
  const secretCode = 'DATABASE_PASSWORD_SECRET';
  const poisonedStore = {};
  for (const [name, method] of Object.entries(harness.store)) {
    poisonedStore[name] = method.bind(harness.store);
  }
  poisonedStore.getSnapshot = async function () {
    const error = new Error('secret');
    error.code = secretCode;
    throw error;
  };
  const engine = MonitorEngine.create(Object.assign({}, harness.deps, {
    store: poisonedStore
  }));

  await assert.rejects(
    () => engine.runCycle(),
    (error) => error.code === 'STORE_OPERATION_FAILED' &&
      error.message.includes(secretCode) === false
  );
});
