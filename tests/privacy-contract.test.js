const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const ConversationStore = require('../src/conversation/conversation-store.js');
const FeishuNotifier = require('../src/conversation/feishu-notifier.js');
const MonitorEngine = require('../src/conversation/monitor-engine.js');
const Policy = require('../src/conversation/trusteeship-policy.js');
const ReplyAI = require('../src/conversation/reply-ai.js');
const Runtime = require('../src/conversation/trusteeship-runtime.js');

const CANARIES = Object.freeze({
  apiKey: 'api-key-CANARY-PRIVACY-7f91',
  webhookToken: 'webhook-CANARY-PRIVACY-82aa',
  signingSecret: 'signing-secret-CANARY-PRIVACY-4c21',
  providerBody: 'provider-body-CANARY-PRIVACY-99de',
  classifyError: 'classify-error-CANARY-PRIVACY-a018',
  draftError: 'draft-error-CANARY-PRIVACY-b127',
  sendError: 'send-error-CANARY-PRIVACY-c236',
  chatStart: 'HR-CHAT-START-CANARY-d345',
  chatBoundary: 'HR-CHAT-BOUNDARY-CANARY-e454',
  chatTail: 'HR-CHAT-TAIL-CANARY-f563',
  faqAnswer: 'FAQ-ANSWER-CANARY-PRIVACY-g672'
});

function memoryStorage() {
  const data = {};
  return {
    async get(keys) {
      return (Array.isArray(keys) ? keys : Object.keys(data)).reduce((result, key) => {
        result[key] = structuredClone(data[key]);
        return result;
      }, {});
    },
    async set(patch) {
      Object.assign(data, structuredClone(patch));
    }
  };
}

function response(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    async json() { return body; }
  };
}

function serialized(value) {
  return JSON.stringify(value);
}

function assertPublicSafe(value, label) {
  const text = serialized(value);
  for (const [name, canary] of Object.entries(CANARIES)) {
    assert.equal(text.includes(canary), false, `${label} leaked ${name}`);
  }
}

function assertFeishuBodyContainsAuthorizedChat(value, label) {
  const text = serialized(value);
  for (const name of [
    'apiKey',
    'webhookToken',
    'signingSecret',
    'providerBody',
    'classifyError',
    'draftError',
    'sendError',
    'faqAnswer'
  ]) {
    assert.equal(text.includes(CANARIES[name]), false, `${label} leaked ${name}`);
  }
  for (const name of ['chatStart', 'chatBoundary', 'chatTail']) {
    assert.equal(text.includes(CANARIES[name]), true, `${label} omitted authorized ${name}`);
  }
}

function chatFixture() {
  const message = `${CANARIES.chatStart}:${'甲'.repeat(115)}:${CANARIES.chatBoundary}:${'乙'.repeat(320)}:${CANARIES.chatTail}`;
  assert.ok(message.indexOf(CANARIES.chatBoundary) >= 120);
  assert.ok(Array.from(message).length <= 600);
  return message;
}

async function privacyHarness(mode) {
  const fullChat = chatFixture();
  const storage = memoryStorage();
  let ids = 0;
  const calls = {
    classify: 0,
    draft: 0,
    send: 0,
    llm: 0,
    fetch: 0,
    fetchRequests: []
  };
  const store = ConversationStore.create(storage, () => 10_000, (kind) => `${kind}-${++ids}`);
  await store.registerConversation({
    platform: 'boss',
    conversationId: `conv-privacy-${mode}`,
    url: `https://www.zhipin.com/web/geek/chat?conversationId=conv-privacy-${mode}`,
    jobId: `job-privacy-${mode}`,
    company: '隐私测试公司',
    position: '工程师',
    hrName: '测试 HR'
  });
  await store.setManaged(`conv-privacy-${mode}`, true);
  await store.saveSettings({ enabled: true });
  await storage.set({
    apiKey: CANARIES.apiKey,
    dsKey: CANARIES.apiKey,
    resumeText: '五年前端经验',
    hrFaq: [{ question: '还在看机会吗', answer: CANARIES.faqAnswer }],
    riskAccepted: true,
    apiLastTestOk: true,
    apiLastTestAt: 10_000,
    apiConfigVersion: 0,
    apiLastTestVersion: 0,
    feishuNotification: {
      enabled: true,
      webhook: `https://open.feishu.cn/open-apis/bot/v2/hook/${CANARIES.webhookToken}`,
      signingSecret: CANARIES.signingSecret,
      lastTestAt: 10_000,
      lastTestOk: true
    }
  });

  const client = FeishuNotifier.create({
    clock: () => 1_700_000_000_000,
    subtle: crypto.webcrypto.subtle,
    async fetchFn(url, options) {
      calls.fetch += 1;
      calls.fetchRequests.push({ url, body: options.body });
      return response(200, { code: 0 });
    }
  });
  const runtimeNotifier = Runtime.createNotifier({
    store,
    notifierModule: FeishuNotifier,
    client
  });
  const runtimeClassifier = Runtime.createClassifier({
    replyAI: ReplyAI,
    async callLLM(_messages, maxTokens, frozenConfig) {
      calls.llm += 1;
      assert.equal(frozenConfig.apiKey, CANARIES.apiKey);
      if (maxTokens === 400) {
        if (mode === 'classify-error') {
          const error = new Error(`${CANARIES.providerBody}:${CANARIES.classifyError}`);
          error.responseBody = CANARIES.providerBody;
          throw error;
        }
        return JSON.stringify({
          category: 'still_looking',
          confidence: mode === 'success-confirmation' ? 0.5 : 0.95,
          reasonCode: 'LOW_RISK',
          evidenceIds: ['resume-1'],
          fieldsNeeded: mode === 'success-confirmation'
            ? [CANARIES.chatStart, CANARIES.chatBoundary, CANARIES.chatTail]
            : []
        });
      }
      if (mode === 'draft-error') {
        throw new Error(`${CANARIES.providerBody}:${CANARIES.draftError}`);
      }
      return JSON.stringify({
        draft: mode === 'success-confirmation'
          ? `${CANARIES.chatStart}|${CANARIES.chatBoundary}|${CANARIES.chatTail}`
          : '您好，我还在看机会。',
        evidenceIds: ['resume-1']
      });
    }
  });
  let reads = 0;
  const engine = MonitorEngine.create({
    store,
    policy: Policy,
    clock: () => new Date('2026-07-25T09:00:00+08:00'),
    async getResumeFacts() {
      return [{ id: 'resume-1', text: '五年前端经验' }];
    },
    reader: {
      async read(conversation) {
        reads += 1;
        return {
          success: true,
          conversationRef: {
            conversationId: conversation.conversationId,
            url: conversation.url
          },
          baseline: 'id:privacy-message',
          messages: reads === 1 ? [{
            direction: 'incoming',
            kind: 'text',
            text: fullChat,
            fingerprint: 'id:privacy-message'
          }] : []
        };
      },
      async send() {
        calls.send += 1;
        throw new Error(`${CANARIES.providerBody}:${CANARIES.sendError}`);
      }
    },
    classifier: {
      async classify(input) {
        calls.classify += 1;
        return runtimeClassifier.classify(input, {
          provider: 'deepseek',
          apiKey: CANARIES.apiKey,
          baseUrl: ''
        });
      },
      async draft(input) {
        calls.draft += 1;
        return runtimeClassifier.draft(input, {
          provider: 'deepseek',
          apiKey: CANARIES.apiKey,
          baseUrl: ''
        });
      }
    },
    notifier: runtimeNotifier
  });
  const chromeApi = {
    alarms: {
      clear(_name, callback) { if (callback) callback(true); return Promise.resolve(true); },
      create(_name, _options, callback) { if (callback) callback(); return Promise.resolve(); }
    },
    tabs: {
      create(_options, callback) {
        const tab = { id: 1 };
        if (callback) callback(tab);
        return Promise.resolve(tab);
      }
    }
  };
  const controller = Runtime.createController({
    chromeApi,
    storage,
    store,
    engine,
    liveDrill: {
      async stage() {
        return {
          decision: {
            action: 'REQUIRE_CONFIRMATION',
            reasonCode: 'CATEGORY_REQUIRES_CONFIRMATION'
          },
          draft: '',
          approvalId: 'approval-live-drill',
          sentToBoss: false,
          notificationStatus: 'SUCCESS',
          liveDrill: true
        };
      }
    },
    policy: Policy,
    notifierModule: FeishuNotifier,
    feishuClient: client,
    async saveApi() { return { identityChanged: false }; },
    async runApiTest() { return { ok: true, code: 'OK' }; },
    now: () => 10_000
  });
  const controllerResponse = await controller.handleMessage({ type: 'TRUSTEESHIP_RUN_NOW' });
  const cycleSummary = controllerResponse.summary;
  const snapshot = await store.getSnapshot();
  return { calls, controllerResponse, cycleSummary, snapshot, fullChat };
}

test('classification errors send authorized HR body to Feishu without credentials or provider errors', async () => {
  const result = await privacyHarness('classify-error');
  const approval = Object.values(result.snapshot.pendingApprovals)[0];

  assert.deepEqual({
    classify: result.calls.classify,
    draft: result.calls.draft,
    send: result.calls.send,
    llm: result.calls.llm,
    fetch: result.calls.fetch
  }, { classify: 1, draft: 0, send: 0, llm: 1, fetch: 1 });
  assert.ok(approval.messages.includes(result.fullChat), 'bounded local pending DTO may keep the full message');
  assert.equal(
    result.calls.fetchRequests[0].url,
    `https://open.feishu.cn/open-apis/bot/v2/hook/${CANARIES.webhookToken}`
  );
  assertPublicSafe(result.cycleSummary, 'cycle summary');
  assertPublicSafe(result.controllerResponse, 'runtime controller response');
  assertFeishuBodyContainsAuthorizedChat(
    JSON.parse(result.calls.fetchRequests[0].body),
    'final Feishu HTTP body'
  );
});

test('draft errors execute the real draft branch but never expose provider or raw error canaries', async () => {
  const result = await privacyHarness('draft-error');
  const approval = Object.values(result.snapshot.pendingApprovals)[0];

  assert.deepEqual({
    classify: result.calls.classify,
    draft: result.calls.draft,
    send: result.calls.send,
    llm: result.calls.llm,
    fetch: result.calls.fetch
  }, { classify: 1, draft: 1, send: 0, llm: 2, fetch: 1 });
  assert.ok(approval.messages.includes(result.fullChat));
  assertPublicSafe(result.cycleSummary, 'draft-error cycle summary');
  assertPublicSafe(result.controllerResponse, 'draft-error runtime controller response');
  assertFeishuBodyContainsAuthorizedChat(
    JSON.parse(result.calls.fetchRequests[0].body),
    'draft-error Feishu HTTP body'
  );
});

test('send errors execute the sender once and expose only a stable unknown code', async () => {
  const result = await privacyHarness('send-error');
  const conversation = result.snapshot.managedConversations['conv-privacy-send-error'];

  assert.deepEqual({
    classify: result.calls.classify,
    draft: result.calls.draft,
    send: result.calls.send,
    llm: result.calls.llm,
    fetch: result.calls.fetch
  }, { classify: 1, draft: 1, send: 1, llm: 2, fetch: 0 });
  assert.equal(conversation.state, 'PAUSED');
  assert.equal(conversation.pauseCode, 'SEND_RESULT_UNKNOWN');
  assert.equal(conversation.sendIntent.status, 'SEND_RESULT_UNKNOWN');
  assert.deepEqual(result.cycleSummary.errors, ['SEND_RESULT_UNKNOWN']);
  assertPublicSafe(result.cycleSummary, 'send-error cycle summary');
  assertPublicSafe(result.controllerResponse, 'send-error runtime controller response');
});

test('successful confirmation includes authorized HR body and draft but excludes credentials from Feishu', async () => {
  const result = await privacyHarness('success-confirmation');
  const approval = Object.values(result.snapshot.pendingApprovals)[0];

  assert.deepEqual({
    classify: result.calls.classify,
    draft: result.calls.draft,
    send: result.calls.send,
    llm: result.calls.llm,
    fetch: result.calls.fetch
  }, { classify: 1, draft: 1, send: 0, llm: 2, fetch: 1 });
  assert.ok(approval.messages.includes(result.fullChat));
  assert.ok(approval.fieldsNeeded.includes(CANARIES.chatStart));
  assert.ok(approval.fieldsNeeded.includes(CANARIES.chatBoundary));
  assert.ok(approval.fieldsNeeded.includes(CANARIES.chatTail));
  assert.ok(approval.draft.includes(CANARIES.chatStart));
  assert.ok(approval.draft.includes(CANARIES.chatBoundary));
  assert.ok(approval.draft.includes(CANARIES.chatTail));
  assertPublicSafe(result.cycleSummary, 'successful confirmation cycle summary');
  assertPublicSafe(result.controllerResponse, 'successful confirmation runtime controller response');
  assertFeishuBodyContainsAuthorizedChat(
    JSON.parse(result.calls.fetchRequests[0].body),
    'successful confirmation Feishu HTTP body'
  );
});
