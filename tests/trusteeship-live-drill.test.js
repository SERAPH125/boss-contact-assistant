const test = require('node:test');
const assert = require('node:assert/strict');

const ConversationStore = require('../src/conversation/conversation-store.js');
const MonitorEngine = require('../src/conversation/monitor-engine.js');
const Policy = require('../src/conversation/trusteeship-policy.js');
const LiveDrill = require('../src/conversation/trusteeship-live-drill.js');

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
    staged: [],
    notifyPending: 0,
    classify: [],
    draft: [],
    facts: 0
  };
  const productionStore = {
    async getSnapshot() {
      return structuredClone(snapshot);
    },
    async createLiveDrillApproval(input) {
      calls.staged.push(structuredClone(input));
      if (source.stageError) {
        const error = new Error(source.stageError);
        error.code = source.stageError;
        throw error;
      }
      const approval = {
        approvalId: 'approval-live-drill',
        conversationId: input.conversationId,
        origin: 'LIVE_DRILL',
        incomingFingerprint: input.drillFingerprint,
        incomingFingerprints: [input.drillFingerprint],
        messages: [input.message],
        reasonCode: input.reasonCode,
        fieldsNeeded: input.fieldsNeeded,
        draft: input.draft,
        status: 'PENDING',
        feishuNotifyAttempts: []
      };
      snapshot.pendingApprovals[approval.approvalId] = approval;
      snapshot.managedConversations[input.conversationId].state = 'WAITING_CONFIRMATION';
      snapshot.managedConversations[input.conversationId].pendingApprovalId = approval.approvalId;
      return structuredClone(approval);
    }
  };
  const productionEngine = {
    async notifyPending() {
      calls.notifyPending += 1;
      const approval = snapshot.pendingApprovals['approval-live-drill'];
      if (approval) {
        approval.feishuNotifyAttempts.push({
          status: source.notificationStatus || 'SUCCESS',
          code: source.notificationStatus === 'FAILED' ? 'NETWORK_ERROR' : 'OK'
        });
      }
      return {
        checked: 0,
        newMessages: 0,
        autoSent: 0,
        pending: 0,
        skipped: 0,
        errors: []
      };
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
  const liveDrill = LiveDrill.create({
    storeModule: ConversationStore,
    engineModule: MonitorEngine,
    productionStore,
    productionEngine,
    classifier,
    policy: Policy,
    async getResumeFacts() {
      calls.facts += 1;
      return [{ id: 'faq-line-1', text: '问：还在看机会吗？；答：是的，我还在看合适机会。' }];
    },
    clock: () => NOW,
    idFactory: (kind) => `${kind}-live-drill-${++sequence}`
  });
  return { liveDrill, snapshot, before, calls };
}

test('evaluates with the real engine then stages one production approval without sending Boss', async () => {
  const harness = createHarness();

  const result = await harness.liveDrill.stage({
    conversationId: 'conv-1',
    message: '还在看机会吗？'
  });

  assert.deepEqual(result.decision, {
    action: 'AUTO_REPLY',
    reasonCode: 'AUTO_REPLY_ALLOWED'
  });
  assert.equal(result.sentToBoss, false);
  assert.equal(result.draft, '是的，我还在看合适机会。');
  assert.equal(result.liveDrill, true);
  assert.equal(result.approvalId, 'approval-live-drill');
  assert.equal(result.notificationStatus, 'SUCCESS');
  assert.equal(result.classification.category, 'still_looking');
  assert.deepEqual(harness.calls.staged, [{
    conversationId: 'conv-1',
    drillFingerprint: 'live-drill:message-live-drill-1',
    message: '还在看机会吗？',
    reasonCode: 'AUTO_REPLY_ALLOWED',
    fieldsNeeded: [],
    draft: '是的，我还在看合适机会。'
  }]);
  assert.equal(harness.calls.notifyPending, 1);
  assert.equal(
    harness.snapshot.managedConversations['conv-1'].lastIncomingFingerprint,
    harness.before.managedConversations['conv-1'].lastIncomingFingerprint
  );
  assert.equal(harness.calls.classify.length, 1);
  assert.equal(harness.calls.draft.length, 1);
  assert.equal(harness.calls.facts, 1);
});

test('stages a hard-risk message for manual confirmation with an empty editable draft', async () => {
  const harness = createHarness();

  const result = await harness.liveDrill.stage({
    conversationId: 'conv-1',
    message: '薪资是多少？'
  });

  assert.deepEqual(result.decision, {
    action: 'REQUIRE_CONFIRMATION',
    reasonCode: 'HARD_RISK_SALARY'
  });
  assert.equal(result.sentToBoss, false);
  assert.equal(result.approvalId, 'approval-live-drill');
  assert.equal(harness.calls.staged[0].reasonCode, 'HARD_RISK_SALARY');
});

test('live drill reports AUTO_CLOSE but still stages approval instead of sending Boss', async () => {
  const harness = createHarness({
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
      async draft() {
        return {
          draft: '好的，感谢您的回复，祝工作顺利。',
          evidenceIds: []
        };
      }
    }
  });

  const result = await harness.liveDrill.stage({
    conversationId: 'conv-1',
    message: '不合适'
  });

  assert.equal(result.classification.reasonCode, 'EXPLICIT_REJECTION');
  assert.deepEqual(result.decision, {
    action: 'AUTO_CLOSE',
    reasonCode: 'EXPLICIT_REJECTION_AUTO_CLOSE'
  });
  assert.equal(result.wouldSend, true);
  assert.equal(result.sentToBoss, false);
  assert.equal(harness.calls.staged.length, 1);
  assert.equal(harness.calls.staged[0].reasonCode, 'EXPLICIT_REJECTION_AUTO_CLOSE');
});

test('rejects missing, unsupported, empty, and oversized live drill inputs with stable codes', async () => {
  const missing = createHarness();
  await assert.rejects(
    () => missing.liveDrill.stage({ conversationId: 'missing', message: '您好' }),
    (error) => error && error.code === 'CONVERSATION_NOT_FOUND'
  );

  const unsupported = createHarness({
    mutateSnapshot(snapshot) {
      snapshot.managedConversations['conv-1'].platform = 'zhilian';
    }
  });
  await assert.rejects(
    () => unsupported.liveDrill.stage({ conversationId: 'conv-1', message: '您好' }),
    (error) => error && error.code === 'UNSUPPORTED_PLATFORM'
  );

  const invalid = createHarness();
  for (const message of ['', '   ', '问'.repeat(601)]) {
    await assert.rejects(
      () => invalid.liveDrill.stage({ conversationId: 'conv-1', message }),
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
    () => classifyFailure.liveDrill.stage({
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
    () => draftFailure.liveDrill.stage({
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

test('preserves a stale API proof code through the engine classification boundary', async () => {
  const harness = createHarness({
    classifier: {
      async classify() {
        const error = new Error('stale proof provider detail');
        error.code = 'API_PROOF_STALE';
        throw error;
      },
      async draft() {
        throw new Error('must not draft');
      }
    }
  });

  await assert.rejects(
    () => harness.liveDrill.stage({
      conversationId: 'conv-1',
      message: '还在看机会吗？'
    }),
    (error) => error && error.code === 'API_PROOF_STALE'
  );
});

test('does not notify or persist a second approval when production staging rejects the conversation state', async () => {
  const harness = createHarness({ stageError: 'LIVE_DRILL_NOT_ALLOWED' });

  await assert.rejects(
    () => harness.liveDrill.stage({
      conversationId: 'conv-1',
      message: '还在看机会吗？'
    }),
    (error) => error && error.code === 'LIVE_DRILL_NOT_ALLOWED'
  );

  assert.equal(harness.calls.staged.length, 1);
  assert.equal(harness.calls.notifyPending, 0);
  assert.deepEqual(harness.snapshot.pendingApprovals, {});
});
