const test = require('node:test');
const assert = require('node:assert/strict');

const ConversationStore = require('../src/conversation/conversation-store.js');
const MonitorEngine = require('../src/conversation/monitor-engine.js');
const Policy = require('../src/conversation/trusteeship-policy.js');
const Simulator = require('../src/conversation/trusteeship-simulator.js');

const NOW = Date.parse('2026-07-26T10:00:00+08:00');

function productionSnapshot() {
  return {
    conversationTrusteeship: {
      enabled: true,
      intervalMinutes: 10,
      dailyAutoReplyLimit: 10,
      autoReplyDay: '2026-07-26',
      autoReplyCount: 2,
      quietHours: { enabled: false, start: '22:00', end: '08:00' },
      monitorCursor: 0,
      paused: false,
      pauseCode: '',
      pauseReason: ''
    },
    feishuNotification: {
      enabled: true,
      webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/secret',
      signingSecret: 'secret'
    },
    managedConversations: {
      'conv-1': {
        conversationId: 'conv-1',
        platform: 'boss',
        url: 'https://www.zhipin.com/web/geek/chat?uid=conv-1',
        jobId: 'job-1',
        company: '甲公司',
        position: '前端工程师',
        hrName: '李经理',
        enabled: true,
        state: 'WAITING_HR',
        lastIncomingFingerprint: 'id:real-baseline',
        lastCheckedAt: NOW - 1000,
        processedFingerprints: ['id:real-baseline'],
        recentMessages: ['之前的真实消息'],
        aliases: ['legacy-conv-1'],
        peerSource: 'encryptUid',
        createdAt: NOW - 2000,
        updatedAt: NOW - 1000
      }
    },
    pendingApprovals: {}
  };
}

function createHarness(overrides) {
  const source = overrides || {};
  const snapshot = productionSnapshot();
  if (typeof source.mutateSnapshot === 'function') source.mutateSnapshot(snapshot);
  const before = structuredClone(snapshot);
  const calls = {
    productionWrites: [],
    classify: [],
    draft: [],
    facts: 0
  };
  const productionStore = {
    async getSnapshot() {
      return structuredClone(snapshot);
    },
    async saveSettings() {
      calls.productionWrites.push('saveSettings');
      throw new Error('production store must stay read-only');
    }
  };
  const classifier = source.classifier || {
    async classify(input) {
      calls.classify.push(input);
      return {
        category: 'still_looking',
        confidence: 0.91,
        reasonCode: 'SAFE',
        evidenceIds: ['faq-line-1'],
        fieldsNeeded: []
      };
    },
    async draft(input) {
      calls.draft.push(input);
      return {
        draft: '是的，我还在看合适机会。',
        evidenceIds: ['faq-line-1']
      };
    }
  };
  let sequence = 0;
  const simulator = Simulator.create({
    storeModule: ConversationStore,
    engineModule: MonitorEngine,
    productionStore,
    classifier,
    policy: Policy,
    async getResumeFacts() {
      calls.facts += 1;
      return [{ id: 'faq-line-1', text: '问：还在看机会吗？；答：是的，我还在看合适机会。' }];
    },
    clock: () => NOW,
    idFactory: (kind) => `${kind}-simulation-${++sequence}`
  });
  return { simulator, snapshot, before, calls };
}

test('runs the real engine in isolated memory and reports wouldSend without production writes', async () => {
  const harness = createHarness();

  const result = await harness.simulator.simulate({
    conversationId: 'conv-1',
    message: '还在看机会吗？'
  });

  assert.deepEqual(result.decision, {
    action: 'AUTO_REPLY',
    reasonCode: 'AUTO_REPLY_ALLOWED'
  });
  assert.equal(result.wouldSend, true);
  assert.equal(result.draft, '是的，我还在看合适机会。');
  assert.equal(result.simulated, true);
  assert.equal(result.classification.category, 'still_looking');
  assert.deepEqual(harness.snapshot, harness.before);
  assert.deepEqual(harness.calls.productionWrites, []);
  assert.equal(harness.calls.classify.length, 1);
  assert.equal(harness.calls.draft.length, 1);
  assert.equal(harness.calls.facts, 1);
});

test('projects the isolated pending approval reason for a hard-risk message', async () => {
  const harness = createHarness();

  const result = await harness.simulator.simulate({
    conversationId: 'conv-1',
    message: '薪资是多少？'
  });

  assert.deepEqual(result.decision, {
    action: 'REQUIRE_CONFIRMATION',
    reasonCode: 'HARD_RISK_SALARY'
  });
  assert.equal(result.wouldSend, false);
  assert.deepEqual(harness.snapshot, harness.before);
});

test('explicit rejection classification never records a simulated send', async () => {
  const harness = createHarness({
    classifier: {
      async classify() {
        return {
          category: 'important',
          confidence: 0.99,
          reasonCode: 'EXPLICIT_REJECTION',
          evidenceIds: [],
          fieldsNeeded: []
        };
      },
      async draft() {
        return {
          draft: '好的，感谢您的回复，祝工作顺利。',
          evidenceIds: ['faq-line-1']
        };
      }
    }
  });

  const result = await harness.simulator.simulate({
    conversationId: 'conv-1',
    message: '不合适'
  });

  assert.equal(result.classification.reasonCode, 'EXPLICIT_REJECTION');
  assert.deepEqual(result.decision, {
    action: 'REQUIRE_CONFIRMATION',
    reasonCode: 'CATEGORY_REQUIRES_CONFIRMATION'
  });
  assert.equal(result.wouldSend, false);
});

test('rejects missing, unsupported, empty, and oversized simulation inputs with stable codes', async () => {
  const missing = createHarness();
  await assert.rejects(
    () => missing.simulator.simulate({ conversationId: 'missing', message: '您好' }),
    (error) => error && error.code === 'CONVERSATION_NOT_FOUND'
  );

  const unsupported = createHarness({
    mutateSnapshot(snapshot) {
      snapshot.managedConversations['conv-1'].platform = 'zhilian';
    }
  });
  await assert.rejects(
    () => unsupported.simulator.simulate({ conversationId: 'conv-1', message: '您好' }),
    (error) => error && error.code === 'UNSUPPORTED_PLATFORM'
  );

  const invalid = createHarness();
  for (const message of ['', '   ', '问'.repeat(601)]) {
    await assert.rejects(
      () => invalid.simulator.simulate({ conversationId: 'conv-1', message }),
      (error) => error && error.code === 'TRUSTEESHIP_MESSAGE_INVALID'
    );
  }
});

test('turns classifier and draft failures into stable errors without provider details', async () => {
  const classifyFailure = createHarness({
    classifier: {
      async classify() {
        throw new Error('provider-secret-classify-canary');
      },
      async draft() {
        throw new Error('must not draft');
      }
    }
  });
  await assert.rejects(
    () => classifyFailure.simulator.simulate({
      conversationId: 'conv-1',
      message: '还在看机会吗？'
    }),
    (error) => {
      assert.equal(error.code, 'AI_CLASSIFY_FAILED');
      assert.equal(String(error).includes('provider-secret-classify-canary'), false);
      return true;
    }
  );

  const draftFailure = createHarness({
    classifier: {
      async classify() {
        return {
          category: 'still_looking',
          confidence: 0.91,
          reasonCode: 'SAFE',
          evidenceIds: ['faq-line-1'],
          fieldsNeeded: []
        };
      },
      async draft() {
        throw new Error('provider-secret-draft-canary');
      }
    }
  });
  await assert.rejects(
    () => draftFailure.simulator.simulate({
      conversationId: 'conv-1',
      message: '还在看机会吗？'
    }),
    (error) => {
      assert.equal(error.code, 'AI_DRAFT_FAILED');
      assert.equal(String(error).includes('provider-secret-draft-canary'), false);
      return true;
    }
  );
});
