const test = require('node:test');
const assert = require('node:assert/strict');

const Policy = require('../src/conversation/trusteeship-policy.js');
const ReplyAI = require('../src/conversation/reply-ai.js');
const FeishuNotifier = require('../src/conversation/feishu-notifier.js');
const Runtime = require('../src/conversation/trusteeship-runtime.js');
const ConversationStore = require('../src/conversation/conversation-store.js');

const NOW = Date.parse('2026-07-25T10:00:00+08:00');
const URL = 'https://www.zhipin.com/web/geek/chat?conversationId=conv-1';

function deferred() {
  let resolve;
  const promise = new Promise((done) => { resolve = done; });
  return { promise, resolve };
}

function conversation(overrides) {
  return Object.assign({
    conversationId: 'conv-1',
    platform: 'boss',
    url: URL,
    jobId: 'job-1',
    company: '甲公司',
    position: '前端工程师',
    hrName: '李经理',
    enabled: true,
    state: 'WAITING_HR',
    lastIncomingFingerprint: ''
  }, overrides || {});
}

function memoryStorage(initial) {
  const data = structuredClone(initial || {});
  return {
    data,
    async get(keys) {
      if (!Array.isArray(keys)) return structuredClone(data);
      return keys.reduce((result, key) => {
        result[key] = structuredClone(data[key]);
        return result;
      }, {});
    },
    async set(patch) {
      Object.assign(data, structuredClone(patch));
    }
  };
}

function controllerHarness(overrides) {
  const source = overrides || {};
  const storage = source.storage || memoryStorage({
    apiKey: 'api-key',
    resumeText: '五年前端经验',
    riskAccepted: true,
    apiLastTestOk: true,
    apiLastTestAt: NOW,
    feishuNotification: {
      enabled: true,
      webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/abc123',
      signingSecret: '',
      lastTestOk: true,
      lastTestAt: NOW
    }
  });
  const snapshot = source.snapshot || {
    conversationTrusteeship: {
      enabled: false,
      paused: false,
      intervalMinutes: 10
    },
    feishuNotification: storage.data.feishuNotification || {},
    managedConversations: { 'conv-1': conversation() },
    pendingApprovals: {}
  };
  const calls = {
    clear: [],
    create: [],
    setManaged: [],
    removeConversation: [],
    run: 0,
    resolve: [],
    saveApi: [],
    apiTest: 0
  };
  const store = source.store || {
    async getSnapshot() {
      snapshot.feishuNotification = structuredClone(storage.data.feishuNotification || {});
      return structuredClone(snapshot);
    },
    async saveSettings(patch) {
      Object.assign(snapshot.conversationTrusteeship, structuredClone(patch));
      return structuredClone(snapshot.conversationTrusteeship);
    },
    async setManaged(id, enabled) {
      calls.setManaged.push([id, enabled]);
      if (!snapshot.managedConversations[id]) {
        const error = new Error('missing');
        error.code = 'CONVERSATION_NOT_FOUND';
        throw error;
      }
      snapshot.managedConversations[id].enabled = enabled;
      return structuredClone(snapshot.managedConversations[id]);
    },
    async removeConversation(id) {
      calls.removeConversation.push(id);
      if (!snapshot.managedConversations[id]) {
        const error = new Error('missing');
        error.code = 'CONVERSATION_NOT_FOUND';
        throw error;
      }
      delete snapshot.managedConversations[id];
      return { ok: true, conversationId: id };
    }
  };
  const chromeApi = source.chromeApi || {
    alarms: {
      async clear(name) { calls.clear.push(name); return true; },
      async create(name, options) { calls.create.push([name, options]); }
    },
    tabs: {
      async create(options) { calls.opened = options; return { id: 77, ...options }; }
    }
  };
  const engine = source.engine || {
    async runCycle() {
      calls.run += 1;
      return { checked: 0, newMessages: 0, autoSent: 0, pending: 0, skipped: 0, errors: [] };
    },
    async resolveApproval(input) {
      calls.resolve.push(input);
      return { ok: true, status: 'NO_REPLY' };
    }
  };
  const feishuClient = source.feishuClient || {
    async send() { return { ok: true, code: 'OK' }; }
  };
  const saveApi = source.saveApi || (async (config) => {
    calls.saveApi.push(structuredClone(config));
    return { identityChanged: false };
  });
  const runApiTest = source.runApiTest || (async () => {
    calls.apiTest += 1;
    return { ok: true, code: 'OK' };
  });
  const controller = Runtime.createController({
    chromeApi,
    storage,
    store,
    engine,
    policy: Policy,
    notifierModule: FeishuNotifier,
    feishuClient,
    saveApi,
    runApiTest,
    now: () => NOW
  });
  return { controller, storage, store, snapshot, calls };
}

test('high-privilege message schemas reject extra keys, oversized identifiers, and invalid enums', () => {
  const valid = [
    { type: 'TRUSTEESHIP_GET_STATE' },
    {
      type: 'TRUSTEESHIP_SAVE_SETTINGS',
      settings: {
        enabled: false,
        intervalMinutes: 10,
        dailyAutoReplyLimit: 5,
        quietHours: { enabled: true, start: '22:00', end: '08:00' }
      },
      feishuNotification: {
        enabled: true,
        webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/abc123',
        signingSecret: ''
      }
    },
    { type: 'TRUSTEESHIP_TEST_FEISHU' },
    { type: 'TRUSTEESHIP_SET_CONVERSATION', conversationId: 'conv-1', enabled: true },
    { type: 'TRUSTEESHIP_REMOVE_CONVERSATION', conversationId: 'conv-1' },
    { type: 'TRUSTEESHIP_LIST_APPROVALS' },
    {
      type: 'TRUSTEESHIP_RESOLVE_APPROVAL',
      approvalId: 'approval-1',
      action: 'SEND_EDITED',
      draft: '好的'
    },
    { type: 'TRUSTEESHIP_OPEN_CONVERSATION', conversationId: 'conv-1' },
    { type: 'TRUSTEESHIP_RUN_NOW' },
    { type: 'TRUSTEESHIP_REGISTER_ACTIVE', enable: true },
    { type: 'TRUSTEESHIP_REGISTER_ACTIVE', enable: false }
  ];
  valid.forEach((message) => assert.equal(Runtime.validateUserMessage(message), true));

  [
    { type: 'TRUSTEESHIP_RUN_NOW', extra: true },
    { type: 'TRUSTEESHIP_GET_STATE', settings: {} },
    { type: 'TRUSTEESHIP_TEST_FEISHU', enabled: true },
    {
      type: 'TRUSTEESHIP_SAVE_SETTINGS',
      settings: { enabled: false, unknown: true }
    },
    {
      type: 'TRUSTEESHIP_RESOLVE_APPROVAL',
      approvalId: 'approval-1',
      action: 'DELETE'
    },
    {
      type: 'TRUSTEESHIP_OPEN_CONVERSATION',
      conversationId: 'x'.repeat(129)
    },
    { type: 'TRUSTEESHIP_REGISTER_ACTIVE' },
    { type: 'TRUSTEESHIP_REGISTER_ACTIVE', enable: true, extra: true },
    { type: 'TRUSTEESHIP_REGISTER_ACTIVE', enable: 'yes' },
    { type: 'TRUSTEESHIP_REMOVE_CONVERSATION' },
    { type: 'TRUSTEESHIP_REMOVE_CONVERSATION', conversationId: 'x'.repeat(129) },
    { type: 'TRUSTEESHIP_REMOVE_CONVERSATION', conversationId: 'conv-1', extra: true }
  ].forEach((message) => assert.equal(Runtime.validateUserMessage(message), false));
});

test('API configuration messages use an exact bounded schema', () => {
  assert.equal(Runtime.validateApiConfigMessage({
    type: 'SAVE_API_CONFIG',
    config: {
      provider: 'deepseek',
      apiKey: 'api-key',
      baseUrl: '',
      resumeText: '五年前端经验'
    }
  }), true);
  for (const invalid of [
    {
      type: 'SAVE_API_CONFIG',
      config: {
        provider: 'unknown',
        apiKey: 'api-key',
        baseUrl: '',
        resumeText: ''
      }
    },
    {
      type: 'SAVE_API_CONFIG',
      config: {
        provider: 'deepseek',
        apiKey: 'x'.repeat(4097),
        baseUrl: '',
        resumeText: ''
      }
    },
    {
      type: 'SAVE_API_CONFIG',
      config: {
        provider: 'deepseek',
        apiKey: 'api-key',
        baseUrl: '',
        resumeText: '',
        extra: true
      }
    },
    {
      type: 'SAVE_API_CONFIG',
      config: {
        provider: 'deepseek',
        apiKey: 'api-key',
        baseUrl: '',
        resumeText: ''
      },
      extra: true
    }
  ]) {
    assert.equal(Runtime.validateApiConfigMessage(invalid), false);
  }
});

test('publishes unknown send outcomes as stable codes and durable approval entries', async () => {
  const unknown = {
    approvalId: 'approval-unknown',
    conversationId: 'conv-1',
    status: 'SEND_RESULT_UNKNOWN',
    stage: 'PAUSED',
    reasonCode: 'SEND_RESULT_UNKNOWN',
    messages: ['请确认是否已经收到回复'],
    draft: '好的'
  };
  const h = controllerHarness({
    snapshot: {
      conversationTrusteeship: { enabled: true, paused: false, intervalMinutes: 10 },
      feishuNotification: {},
      managedConversations: { 'conv-1': conversation() },
      pendingApprovals: { 'approval-unknown': unknown }
    },
    engine: {
      async runCycle() { return {}; },
      async resolveApproval() {
        return { ok: false, status: 'SEND_RESULT_UNKNOWN', errorCode: 'SEND_RESULT_UNKNOWN' };
      }
    }
  });
  const resolved = await h.controller.handleMessage({
    type: 'TRUSTEESHIP_RESOLVE_APPROVAL', approvalId: 'approval-unknown', action: 'SEND_EDITED', draft: '好的'
  });
  assert.equal(resolved.code, 'SEND_RESULT_UNKNOWN');
  const list = await h.controller.handleMessage({ type: 'TRUSTEESHIP_LIST_APPROVALS' });
  assert.deepEqual(list.approvals.map((item) => item.approvalId), ['approval-unknown']);
  const state = await h.controller.handleMessage({ type: 'TRUSTEESHIP_GET_STATE' });
  assert.equal(state.pendingApprovalCount, 1);
});

test('safe conversation DTO provides bounded last checked time for the sidepanel', async () => {
  const h = controllerHarness({
    snapshot: {
      conversationTrusteeship: { enabled: true, paused: false, intervalMinutes: 10 },
      feishuNotification: {},
      managedConversations: { 'conv-1': conversation({ lastCheckedAt: 1234, updatedAt: 5678 }) },
      pendingApprovals: {}
    }
  });
  const state = await h.controller.handleMessage({ type: 'TRUSTEESHIP_GET_STATE' });
  assert.equal(state.managedConversations['conv-1'].lastCheckedAt, 1234);
  assert.equal(state.managedConversations['conv-1'].updatedAt, 5678);
});

test('safe conversation DTO projects read backoff progress so the sidepanel can explain a retry', async () => {
  const h = controllerHarness({
    snapshot: {
      conversationTrusteeship: { enabled: true, paused: false, intervalMinutes: 10 },
      feishuNotification: {},
      managedConversations: {
        'conv-1': conversation({
          readFailureCount: 2,
          lastReadErrorCode: 'CONTENT_SCRIPT_UNAVAILABLE'
        }),
        'conv-2': conversation({
          conversationId: 'conv-2',
          readFailureCount: 0,
          lastReadErrorCode: 'not-a-real-code'
        })
      },
      pendingApprovals: {}
    }
  });

  const state = await h.controller.handleMessage({ type: 'TRUSTEESHIP_GET_STATE' });

  assert.deepEqual(
    {
      readFailureCount: state.managedConversations['conv-1'].readFailureCount,
      readRetryLimit: state.managedConversations['conv-1'].readRetryLimit,
      lastReadErrorCode: state.managedConversations['conv-1'].lastReadErrorCode
    },
    { readFailureCount: 2, readRetryLimit: 3, lastReadErrorCode: 'CONTENT_SCRIPT_UNAVAILABLE' }
  );
  assert.deepEqual(
    {
      readFailureCount: state.managedConversations['conv-2'].readFailureCount,
      lastReadErrorCode: state.managedConversations['conv-2'].lastReadErrorCode
    },
    { readFailureCount: 0, lastReadErrorCode: '' }
  );
});

test('raw persisted pause codes and reasons become stable fallbacks at store and public DTO boundaries', async () => {
  const canary = 'provider-raw-error-CANARY-public-dto';
  const reasonCanary = 'provider-raw-pause-reason-CANARY-public-dto';
  const storage = memoryStorage({
    apiKey: 'api-key',
    resumeText: '五年前端经验',
    riskAccepted: true,
    apiLastTestOk: true,
    apiLastTestAt: NOW,
    conversationTrusteeship: {
      enabled: true,
      paused: true,
      pauseCode: canary,
      pauseReason: reasonCanary,
      intervalMinutes: 10,
      dailyAutoReplyLimit: 10,
      quietHours: { enabled: false, start: '22:00', end: '08:00' }
    },
    feishuNotification: {
      enabled: true,
      webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/abc123',
      signingSecret: '',
      lastTestOk: true,
      lastTestAt: NOW
    },
    managedConversations: {
      'conv-1': conversation({
        state: 'PAUSED',
        pauseCode: canary,
        pauseReason: reasonCanary
      })
    },
    pendingApprovals: {}
  });
  const store = ConversationStore.create(storage, () => NOW, () => 'unused');
  const normalized = await store.getSnapshot();
  assert.equal(
    normalized.conversationTrusteeship.pauseCode,
    'UNKNOWN_PROCESSING_FAILURE'
  );
  assert.equal(normalized.conversationTrusteeship.pauseReason, '');
  assert.equal(
    normalized.managedConversations['conv-1'].pauseCode,
    'UNKNOWN_PROCESSING_FAILURE'
  );
  assert.equal(normalized.managedConversations['conv-1'].pauseReason, '');

  const h = controllerHarness({ storage, store });
  const response = await h.controller.handleMessage({ type: 'TRUSTEESHIP_GET_STATE' });
  assert.equal(response.settings.pauseCode, 'UNKNOWN_PROCESSING_FAILURE');
  assert.equal(response.settings.pauseReason, '');
  assert.equal(
    response.managedConversations['conv-1'].pauseCode,
    'UNKNOWN_PROCESSING_FAILURE'
  );
  assert.equal(JSON.stringify(response).includes(canary), false);
  assert.equal(JSON.stringify(response).includes(reasonCanary), false);
});

test('TRUSTEESHIP_GET_STATE rebuilds settings from a strict public field allowlist', async () => {
  const canary = 'private-settings-field-CANARY';
  const h = controllerHarness({
    snapshot: {
      conversationTrusteeship: {
        enabled: true,
        intervalMinutes: 15,
        dailyAutoReplyLimit: 7,
        autoReplyDay: '2026-07-25',
        autoReplyCount: 2,
        quietHours: {
          enabled: false,
          start: '22:00',
          end: '08:00',
          internal: canary
        },
        monitorCursor: 3,
        paused: true,
        pauseCode: 'SEND_RESULT_UNKNOWN',
        pauseReason: canary,
        internal: canary
      },
      feishuNotification: {},
      managedConversations: {},
      pendingApprovals: {}
    }
  });

  const response = await h.controller.handleMessage({ type: 'TRUSTEESHIP_GET_STATE' });
  assert.deepEqual(Object.keys(response.settings).sort(), [
    'autoReplyCount',
    'autoReplyDay',
    'dailyAutoReplyLimit',
    'enabled',
    'intervalMinutes',
    'monitorCursor',
    'pauseCode',
    'pauseReason',
    'paused',
    'quietHours'
  ]);
  assert.deepEqual(response.settings.quietHours, {
    enabled: false,
    start: '22:00',
    end: '08:00'
  });
  assert.equal(response.settings.pauseReason, 'SEND_RESULT_UNKNOWN');
  assert.equal(JSON.stringify(response).includes(canary), false);
});

test('alarm reconcile clears off or paused state and creates one approved period', async () => {
  const h = controllerHarness();
  await h.controller.reconcileAlarm();
  assert.deepEqual(h.calls.clear, [Runtime.TRUSTEESHIP_ALARM]);
  assert.deepEqual(h.calls.create, []);

  h.snapshot.conversationTrusteeship.enabled = true;
  h.snapshot.conversationTrusteeship.intervalMinutes = 15;
  await h.controller.reconcileAlarm();
  await h.controller.reconcileAlarm();
  assert.deepEqual(h.calls.create, [[Runtime.TRUSTEESHIP_ALARM, {
    delayInMinutes: 15,
    periodInMinutes: 15
  }], [Runtime.TRUSTEESHIP_ALARM, {
    delayInMinutes: 15,
    periodInMinutes: 15
  }]]);
  assert.equal(new Set(h.calls.create.map(([name]) => name)).size, 1);

  h.snapshot.conversationTrusteeship.paused = true;
  await h.controller.reconcileAlarm();
  assert.equal(h.calls.clear.length, 2);
});

test('alarm reconcile keeps global default on from creating monitors before prerequisites', async () => {
  const storage = memoryStorage({
    apiKey: '',
    resumeText: '',
    riskAccepted: false,
    apiLastTestOk: false,
    apiLastTestAt: 0,
    feishuNotification: {}
  });
  const h = controllerHarness({
    storage,
    snapshot: {
      conversationTrusteeship: {
        enabled: true,
        paused: false,
        intervalMinutes: 10
      },
      feishuNotification: {},
      managedConversations: {},
      pendingApprovals: {}
    }
  });
  const result = await h.controller.reconcileAlarm();
  assert.equal(result.enabled, false);
  assert.ok(Array.isArray(result.missing) && result.missing.length > 0);
  assert.deepEqual(h.calls.create, []);
  assert.deepEqual(h.calls.clear, [Runtime.TRUSTEESHIP_ALARM]);
});

test('saving enabled settings rejects invalid intervals and reports every missing prerequisite', async () => {
  const storage = memoryStorage({
    apiKey: '',
    resumeText: '  ',
    riskAccepted: false,
    apiLastTestOk: false,
    apiLastTestAt: 0,
    feishuNotification: {}
  });
  const h = controllerHarness({ storage });

  const invalid = await h.controller.handleMessage({
    type: 'TRUSTEESHIP_SAVE_SETTINGS',
    settings: { enabled: true, intervalMinutes: 7 }
  });
  assert.deepEqual(invalid, { ok: false, code: 'TRUSTEESHIP_INTERVAL_INVALID' });

  const missing = await h.controller.handleMessage({
    type: 'TRUSTEESHIP_SAVE_SETTINGS',
    settings: { enabled: true, intervalMinutes: 10 }
  });
  assert.deepEqual(missing, {
    ok: false,
    code: 'TRUSTEESHIP_PREREQUISITE_FAILED',
    missing: ['api', 'replyEvidence', 'feishuTest', 'riskAccepted']
  });
});

test('enabling trusteeship accepts HR FAQ as reply evidence without resume text', async () => {
  const storage = memoryStorage({
    apiKey: 'api-key',
    resumeText: '',
    hrFaq: [],
    riskAccepted: true,
    apiLastTestOk: true,
    apiLastTestAt: NOW,
    apiConfigVersion: 1,
    apiLastTestVersion: 1,
    feishuNotification: {
      enabled: true,
      webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/abc123',
      signingSecret: '',
      lastTestOk: true,
      lastTestAt: NOW
    }
  });
  const h = controllerHarness({ storage });
  const rejected = await h.controller.handleMessage({
    type: 'TRUSTEESHIP_SAVE_SETTINGS',
    settings: { enabled: true, intervalMinutes: 10 }
  });
  assert.deepEqual(rejected.missing, ['replyEvidence']);

  const saved = await h.controller.handleMessage({
    type: 'TRUSTEESHIP_SAVE_SETTINGS',
    settings: { enabled: true, intervalMinutes: 10 },
    hrFaq: [
      { question: '还在看机会吗', answer: '是的，我还在看合适机会' },
      { question: '只有问没有答', answer: '' }
    ]
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.settings.enabled, true);
  // 未完成问答会保留供编辑，但只有问+答齐全的条目计入前置条件与自动回复依据
  assert.deepEqual(saved.hrFaq, [
    { question: '还在看机会吗', answer: '是的，我还在看合适机会' },
    { question: '只有问没有答', answer: '' }
  ]);
  assert.deepEqual((await storage.get(['hrFaq'])).hrFaq, saved.hrFaq);
});

test('createResumeFacts merges resume lines and complete FAQ pairs', async () => {
  const getFacts = Runtime.createResumeFacts(async () => ({
    resumeText: '五年前端经验\n\n',
    hrFaq: [
      { question: '还在看机会吗', answer: '是的' },
      { question: '只有问题', answer: '' },
      { question: '', answer: '只有答案' }
    ]
  }));
  const facts = await getFacts();
  assert.deepEqual(facts, [
    { id: 'resume-line-1', text: '五年前端经验' },
    { id: 'faq-line-1', text: '问：还在看机会吗；答：是的' }
  ]);
});

test('API prerequisite requires the proof version to match the current config version', async () => {
  const storage = memoryStorage({
    apiKey: 'api-key',
    resumeText: '五年前端经验',
    riskAccepted: true,
    apiLastTestOk: true,
    apiLastTestAt: NOW,
    apiConfigVersion: 2,
    apiLastTestVersion: 1,
    feishuNotification: {
      enabled: true,
      webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/abc123',
      signingSecret: '',
      lastTestOk: true,
      lastTestAt: NOW
    }
  });
  const h = controllerHarness({ storage });
  const result = await h.controller.handleMessage({
    type: 'TRUSTEESHIP_SAVE_SETTINGS',
    settings: { enabled: true, intervalMinutes: 10 }
  });
  assert.deepEqual(result, {
    ok: false,
    code: 'TRUSTEESHIP_PREREQUISITE_FAILED',
    missing: ['api']
  });
});

test('enabling rereads the API proof after awaited writes and fails closed on rotation', async () => {
  const storage = memoryStorage({
    provider: 'deepseek',
    apiKey: 'api-key-a',
    dsKey: '',
    baseUrl: 'https://api.deepseek.com/v1',
    apiConfigVersion: 7,
    apiLastTestVersion: 7,
    resumeText: '五年前端经验',
    riskAccepted: true,
    apiLastTestOk: true,
    apiLastTestAt: NOW,
    feishuNotification: {
      enabled: true,
      webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/abc123',
      signingSecret: '',
      lastTestOk: true,
      lastTestAt: NOW
    }
  });
  const originalSet = storage.set.bind(storage);
  let rotated = false;
  storage.set = async (patch) => {
    await originalSet(patch);
    if (!rotated && Object.hasOwn(patch, 'feishuNotification')) {
      rotated = true;
      Object.assign(storage.data, {
        apiKey: 'api-key-b',
        apiConfigVersion: 8,
        apiLastTestOk: false,
        apiLastTestAt: 0,
        apiLastTestVersion: 7
      });
    }
  };
  const h = controllerHarness({ storage });

  const result = await h.controller.handleMessage({
    type: 'TRUSTEESHIP_SAVE_SETTINGS',
    settings: { enabled: true, intervalMinutes: 10 }
  });

  assert.deepEqual(result, {
    ok: false,
    code: 'TRUSTEESHIP_PREREQUISITE_FAILED',
    missing: ['api']
  });
  assert.equal(h.snapshot.conversationTrusteeship.enabled, false);
  assert.equal(h.snapshot.conversationTrusteeship.paused, true);
  assert.deepEqual(h.calls.create, []);
  assert.deepEqual(h.calls.clear, [Runtime.TRUSTEESHIP_ALARM]);
});

test('run, schedule, and manual resolve reject a stale API proof before entering the engine', async () => {
  const storage = memoryStorage({
    apiKey: 'api-key-b',
    apiConfigVersion: 8,
    apiLastTestVersion: 7,
    resumeText: '五年前端经验',
    riskAccepted: true,
    apiLastTestOk: true,
    apiLastTestAt: NOW,
    feishuNotification: {
      enabled: true,
      webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/abc123',
      lastTestOk: true,
      lastTestAt: NOW
    }
  });
  const h = controllerHarness({ storage });
  h.snapshot.conversationTrusteeship.enabled = true;

  const run = await h.controller.handleMessage({ type: 'TRUSTEESHIP_RUN_NOW' });
  const scheduled = await h.controller.runScheduledCycle();
  const resolved = await h.controller.handleMessage({
    type: 'TRUSTEESHIP_RESOLVE_APPROVAL',
    approvalId: 'approval-1',
    action: 'NO_REPLY'
  });

  assert.deepEqual(run, {
    ok: false,
    code: 'TRUSTEESHIP_PREREQUISITE_FAILED',
    missing: ['api']
  });
  assert.deepEqual(scheduled, {
    ok: false,
    code: 'TRUSTEESHIP_NOT_RUNNING'
  });
  assert.deepEqual(resolved, {
    ok: false,
    code: 'TRUSTEESHIP_PREREQUISITE_FAILED',
    missing: ['api']
  });
  assert.equal(h.calls.run, 0);
  assert.deepEqual(h.calls.resolve, []);
  assert.equal(h.snapshot.conversationTrusteeship.paused, true);
  assert.equal(h.snapshot.conversationTrusteeship.pauseCode, 'PREREQUISITE_CHANGED');
  assert.deepEqual(h.calls.create, []);
});

test('manual and scheduled checks reject a disabled or paused global trusteeship instead of reporting an empty successful cycle', async () => {
  for (const settings of [
    { enabled: false, paused: false, intervalMinutes: 10 },
    { enabled: true, paused: true, pauseCode: 'PREREQUISITE_CHANGED', intervalMinutes: 10 }
  ]) {
    const h = controllerHarness({
      snapshot: {
        conversationTrusteeship: settings,
        feishuNotification: {},
        managedConversations: { 'conv-1': conversation() },
        pendingApprovals: {}
      }
    });

    const manual = await h.controller.handleMessage({ type: 'TRUSTEESHIP_RUN_NOW' });
    const scheduled = await h.controller.runScheduledCycle();

    assert.deepEqual(manual, {
      ok: false,
      code: 'TRUSTEESHIP_NOT_RUNNING'
    });
    assert.deepEqual(scheduled, {
      ok: false,
      code: 'TRUSTEESHIP_NOT_RUNNING'
    });
    assert.equal(h.calls.run, 0);
  }
});

test('API proof invalidation is serialized, pauses globally, and clears alarms despite persistence failure', async () => {
  for (const rejectPause of [false, true]) {
    const h = controllerHarness({
      store: {
        async getSnapshot() {
          return structuredClone(h.snapshot);
        },
        async saveSettings(patch) {
          if (rejectPause) throw new Error('disk unavailable');
          Object.assign(h.snapshot.conversationTrusteeship, structuredClone(patch));
          return structuredClone(h.snapshot.conversationTrusteeship);
        },
        async setManaged() {
          throw new Error('unused');
        }
      }
    });
    h.snapshot.conversationTrusteeship.enabled = true;

    const result = await h.controller.invalidateApiProof();

    assert.equal(result.ok, false);
    assert.equal(result.code, 'API_CONFIG_CHANGED');
    assert.deepEqual(h.calls.clear, [Runtime.TRUSTEESHIP_ALARM]);
    assert.deepEqual(h.calls.create, []);
    if (!rejectPause) {
      assert.equal(h.snapshot.conversationTrusteeship.paused, true);
      assert.equal(h.snapshot.conversationTrusteeship.pauseCode, 'API_CONFIG_CHANGED');
    }
  }
});

test('scheduled cycles and API saves are linearized in both queue orders', async () => {
  const apiMessage = {
    type: 'SAVE_API_CONFIG',
    config: {
      provider: 'deepseek',
      apiKey: 'rotated-key',
      baseUrl: '',
      resumeText: '五年前端经验'
    }
  };

  {
    const entered = deferred();
    const release = deferred();
    let saves = 0;
    const h = controllerHarness({
      engine: {
        async runCycle() {
          h.calls.run += 1;
          entered.resolve();
          await release.promise;
          return { checked: 0, errors: [] };
        },
        async resolveApproval() {
          return { ok: true, status: 'NO_REPLY' };
        }
      },
      async saveApi(config) {
        saves += 1;
        Object.assign(h.storage.data, {
          provider: config.provider,
          apiKey: config.apiKey,
          dsKey: config.apiKey,
          baseUrl: config.baseUrl,
          resumeText: config.resumeText,
          apiConfigVersion: 1,
          apiLastTestVersion: 0,
          apiLastTestOk: false,
          apiLastTestAt: 0
        });
        return { identityChanged: true };
      }
    });
    h.snapshot.conversationTrusteeship.enabled = true;

    const cycle = h.controller.runScheduledCycle();
    await entered.promise;
    const save = h.controller.saveApiConfig(apiMessage);
    await Promise.resolve();
    assert.equal(saves, 0);
    release.resolve();
    assert.equal((await cycle).ok, true);
    assert.equal((await save).ok, true);
    assert.equal(saves, 1);
    assert.equal(h.snapshot.conversationTrusteeship.enabled, false);
    assert.equal(h.snapshot.conversationTrusteeship.paused, true);
  }

  {
    const entered = deferred();
    const release = deferred();
    const h = controllerHarness({
      async saveApi(config) {
        entered.resolve();
        await release.promise;
        Object.assign(h.storage.data, {
          provider: config.provider,
          apiKey: config.apiKey,
          dsKey: config.apiKey,
          baseUrl: config.baseUrl,
          resumeText: config.resumeText,
          apiConfigVersion: 1,
          apiLastTestVersion: 0,
          apiLastTestOk: false,
          apiLastTestAt: 0
        });
        return { identityChanged: true };
      }
    });
    h.snapshot.conversationTrusteeship.enabled = true;

    const save = h.controller.saveApiConfig(apiMessage);
    await entered.promise;
    const cycle = h.controller.runScheduledCycle();
    await Promise.resolve();
    assert.equal(h.calls.run, 0);
    release.resolve();
    assert.equal((await save).ok, true);
    assert.deepEqual(await cycle, {
      ok: false,
      code: 'TRUSTEESHIP_NOT_RUNNING'
    });
    assert.equal(h.calls.run, 0);
  }
});

test('API tests and API saves share the controller queue in both orders', async () => {
  const apiMessage = {
    type: 'SAVE_API_CONFIG',
    config: {
      provider: 'deepseek',
      apiKey: 'rotated-key',
      baseUrl: '',
      resumeText: '五年前端经验'
    }
  };

  {
    const entered = deferred();
    const release = deferred();
    const order = [];
    const h = controllerHarness({
      async runApiTest() {
        order.push('test-start');
        entered.resolve();
        await release.promise;
        order.push('test-end');
        return { ok: true, code: 'OK' };
      },
      async saveApi() {
        order.push('save');
        return { identityChanged: true };
      }
    });

    const testResult = h.controller.runApiTest();
    await entered.promise;
    const saveResult = h.controller.saveApiConfig(apiMessage);
    await Promise.resolve();
    assert.deepEqual(order, ['test-start']);
    release.resolve();
    assert.equal((await testResult).ok, true);
    assert.equal((await saveResult).ok, true);
    assert.deepEqual(order, ['test-start', 'test-end', 'save']);
  }

  {
    const entered = deferred();
    const release = deferred();
    const order = [];
    const h = controllerHarness({
      async saveApi() {
        order.push('save-start');
        entered.resolve();
        await release.promise;
        order.push('save-end');
        return { identityChanged: true };
      },
      async runApiTest() {
        order.push('test');
        return { ok: true, code: 'OK' };
      }
    });

    const saveResult = h.controller.saveApiConfig(apiMessage);
    await entered.promise;
    const testResult = h.controller.runApiTest();
    await Promise.resolve();
    assert.deepEqual(order, ['save-start']);
    release.resolve();
    assert.equal((await saveResult).ok, true);
    assert.equal((await testResult).ok, true);
    assert.deepEqual(order, ['save-start', 'save-end', 'test']);
  }
});

test('changed Feishu credentials invalidate the old proof until the new endpoint is tested', async () => {
  const h = controllerHarness();
  const refused = await h.controller.handleMessage({
    type: 'TRUSTEESHIP_SAVE_SETTINGS',
    settings: { enabled: true, intervalMinutes: 5 },
    feishuNotification: {
      enabled: true,
      webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/newtoken',
      signingSecret: 'sign-secret'
    }
  });
  assert.deepEqual(refused, {
    ok: false,
    code: 'TRUSTEESHIP_PREREQUISITE_FAILED',
    missing: ['feishuTest']
  });
  assert.equal(h.storage.data.feishuNotification.lastTestOk, false);
  assert.equal(h.storage.data.feishuNotification.lastTestAt, 0);

  const tested = await h.controller.handleMessage({ type: 'TRUSTEESHIP_TEST_FEISHU' });
  assert.equal(tested.ok, true);
  const saved = await h.controller.handleMessage({
    type: 'TRUSTEESHIP_SAVE_SETTINGS',
    settings: { enabled: true, intervalMinutes: 5 }
  });
  assert.equal(saved.ok, true);
  assert.equal(saved.feishuNotification.webhook, undefined);
  assert.equal(saved.feishuNotification.signingSecret, undefined);
  assert.equal(saved.feishuNotification.hasWebhook, true);
  assert.equal(saved.feishuNotification.hasSigningSecret, true);

  const result = await h.controller.handleMessage({ type: 'TRUSTEESHIP_RUN_NOW' });
  assert.equal(result.ok, true);
  assert.equal(h.calls.run, 1);
});

test('changing only a Feishu signing secret also invalidates the old proof', async () => {
  const h = controllerHarness();
  const result = await h.controller.handleMessage({
    type: 'TRUSTEESHIP_SAVE_SETTINGS',
    settings: { enabled: false },
    feishuNotification: { signingSecret: 'rotated-secret' }
  });
  assert.equal(result.ok, true);
  assert.equal(h.storage.data.feishuNotification.lastTestOk, false);
  assert.equal(h.storage.data.feishuNotification.lastTestAt, 0);
});

test('Feishu test is explicit, uses persisted config, and persists only safe test state', async () => {
  const h = controllerHarness();
  const result = await h.controller.handleMessage({ type: 'TRUSTEESHIP_TEST_FEISHU' });
  assert.deepEqual(result, { ok: true, code: 'OK', testedAt: NOW });
  assert.equal(h.storage.data.feishuNotification.lastTestOk, true);
  assert.equal(h.storage.data.feishuNotification.lastTestAt, NOW);
  assert.equal(JSON.stringify(result).includes('abc123'), false);
});

test('page adapter reuses an open Boss chat tab for passive reads and never navigates it', async () => {
  const calls = { query: 0, update: [], create: [], remove: [], messages: [], inject: [] };
  const chromeApi = {
    runtime: { lastError: null },
    tabs: {
      async query() {
        calls.query += 1;
        return [
          { id: 1, active: true, url: URL, status: 'complete' },
          { id: 2, active: false, url: 'https://www.zhipin.com/web/geek/job', status: 'complete' }
        ];
      },
      async update(id, patch) {
        calls.update.push([id, patch]);
        return { id, active: false, status: 'complete', ...patch };
      },
      async create(options) {
        calls.create.push(options);
        return { id: 9, status: 'complete', ...options };
      },
      async get(id) { return { id, active: false, status: 'complete', url: URL }; },
      async remove(id) { calls.remove.push(id); },
      async sendMessage(id, message) {
        calls.messages.push([id, message]);
        if (message.type === 'PING') return { ok: true, page: 'chat' };
        return {
          success: true,
          conversationRef: { conversationId: 'conv-1', url: URL },
          messages: [],
          baselineIncomingFingerprint: ''
        };
      }
    },
    scripting: {
      async executeScript(input) { calls.inject.push(input); }
    }
  };
  const adapter = Runtime.createPageAdapter({
    chromeApi,
    store: { async getSnapshot() { return { managedConversations: {} }; } },
    waitForTabComplete: async () => {}
  });

  const read = await adapter.read(conversation());

  assert.equal(read.success, true);
  assert.equal(calls.query, 1);
  assert.deepEqual(calls.create, []);
  assert.deepEqual(calls.remove, []);
  assert.deepEqual(calls.update, []);
  assert.deepEqual(
    calls.messages.map(([tabId, message]) => [tabId, message.type]),
    [[1, 'PING'], [1, 'READ_ACTIVE_CONVERSATION']]
  );
});

test('page adapter falls back to an owned temporary tab when the reused tab cannot answer', async () => {
  const calls = { create: [], remove: [], readTabs: [] };
  const chromeApi = {
    runtime: { lastError: null },
    tabs: {
      async query() {
        return [{ id: 1, active: true, url: URL, status: 'complete' }];
      },
      async create(options) {
        calls.create.push(options);
        return { id: 7, status: 'complete', ...options };
      },
      async get(id) { return { id, active: false, status: 'complete', url: URL }; },
      async remove(id) { calls.remove.push(id); },
      async sendMessage(tabId, message) {
        if (message.type === 'PING') {
          if (tabId === 1) throw new Error('channel closed');
          return { ok: true, page: 'chat' };
        }
        calls.readTabs.push(tabId);
        return {
          success: true,
          conversationRef: { conversationId: 'conv-1', url: URL },
          messages: [],
          baselineIncomingFingerprint: ''
        };
      }
    },
    scripting: {
      async executeScript() { throw new Error('cannot inject into user tab'); }
    }
  };
  const adapter = Runtime.createPageAdapter({
    chromeApi,
    store: { async getSnapshot() { return { managedConversations: {} }; } },
    waitForTabComplete: async () => {}
  });

  const read = await adapter.read(conversation());

  assert.equal(read.success, true);
  assert.deepEqual(calls.readTabs, [7]);
  assert.deepEqual(calls.create, [{ url: URL, active: false }]);
  assert.deepEqual(calls.remove, [7]);
});

test('page adapter keeps sends on an owned temporary tab and closes it every time', async () => {
  const calls = { query: 0, update: [], create: [], remove: [], messages: [], inject: [] };
  let nextTabId = 3;
  let failManagedSend = false;
  const chromeApi = {
    runtime: { lastError: null },
    tabs: {
      async query() {
        calls.query += 1;
        return [
          { id: 1, active: true, url: URL, status: 'complete' },
          { id: 2, active: false, url: `${URL}-other`, status: 'complete' }
        ];
      },
      async update(id, patch) {
        calls.update.push([id, patch]);
        return { id, active: false, status: 'complete', ...patch };
      },
      async create(options) {
        calls.create.push(options);
        return { id: nextTabId++, status: 'complete', ...options };
      },
      async get(id) { return { id, active: false, status: 'complete', url: URL }; },
      async remove(id) { calls.remove.push(id); },
      async sendMessage(id, message) {
        calls.messages.push([id, message]);
        if (message.type === 'PING') return { ok: true, page: 'chat' };
        if (failManagedSend) throw new Error('channel closed');
        return {
          success: true,
          targetConversationId: 'conv-1',
          sentFingerprint: 'id:sent-1',
          observedAt: 1770000000000
        };
      }
    },
    scripting: {
      async executeScript(input) { calls.inject.push(input); }
    }
  };
  const store = {
    async getSnapshot() {
      return {
        managedConversations: {
          'conv-1': conversation({
            state: 'SENDING',
            sendIntent: { intentId: 'intent-1', status: 'SENDING', draft: '好的' }
          })
        }
      };
    }
  };
  const adapter = Runtime.createPageAdapter({ chromeApi, store, waitForTabComplete: async () => {} });

  const sent = await adapter.send(conversation(), '好的', { intentId: 'intent-1' });
  assert.equal(sent.success, true);
  assert.equal(calls.query, 0);
  assert.deepEqual(calls.update, []);
  assert.deepEqual(calls.create, [{ url: URL, active: false }]);
  assert.deepEqual(calls.remove, [3]);

  failManagedSend = true;
  const failed = await adapter.send(conversation(), '好的', { intentId: 'intent-1' });
  assert.equal(failed.success, false);
  assert.deepEqual(calls.create.at(-1), { url: URL, active: false });
  assert.deepEqual(calls.remove, [3, 4]);
});

test('page adapter preserves a safe message-order failure from the content reader', async () => {
  const chromeApi = {
    runtime: { lastError: null },
    tabs: {
      async create(options) { return { id: 41, status: 'complete', ...options }; },
      async get(id) { return { id, active: false, status: 'complete', url: URL }; },
      async remove() {},
      async sendMessage(id, message) {
        if (message.type === 'PING') return { ok: true, page: 'chat' };
        return { success: false, errorCode: 'MESSAGE_ORDER_UNCERTAIN' };
      }
    },
    scripting: {
      async executeScript() {}
    }
  };
  const adapter = Runtime.createPageAdapter({
    chromeApi,
    store: { async getSnapshot() { return { managedConversations: {} }; } },
    waitForTabComplete: async () => {}
  });

  const result = await adapter.read(conversation());

  assert.deepEqual(result, {
    success: false,
    errorCode: 'MESSAGE_ORDER_UNCERTAIN'
  });
});

test('page adapter preserves baseline and content-script diagnostics instead of hiding them', async () => {
  for (const errorCode of ['BASELINE_NOT_FOUND', 'BASELINE_REQUIRED']) {
    const chromeApi = {
      runtime: { lastError: null },
      tabs: {
        async create(options) { return { id: 42, status: 'complete', ...options }; },
        async get(id) { return { id, active: false, status: 'complete', url: URL }; },
        async remove() {},
        async sendMessage(id, message) {
          if (message.type === 'PING') return { ok: true, page: 'chat' };
          return { success: false, errorCode };
        }
      },
      scripting: { async executeScript() {} }
    };
    const adapter = Runtime.createPageAdapter({
      chromeApi,
      store: { async getSnapshot() { return { managedConversations: {} }; } },
      waitForTabComplete: async () => {}
    });

    assert.deepEqual(await adapter.read(conversation()), {
      success: false,
      errorCode
    });
  }

  const unavailableChrome = {
    runtime: { lastError: null },
    tabs: {
      async create(options) { return { id: 43, status: 'complete', ...options }; },
      async get(id) { return { id, active: false, status: 'complete', url: URL }; },
      async remove() {},
      async sendMessage() { return null; }
    },
    scripting: { async executeScript() {} }
  };
  const unavailableAdapter = Runtime.createPageAdapter({
    chromeApi: unavailableChrome,
    store: { async getSnapshot() { return { managedConversations: {} }; } },
    waitForTabComplete: async () => {}
  });

  assert.deepEqual(await unavailableAdapter.read(conversation()), {
    success: false,
    errorCode: 'CONTENT_SCRIPT_UNAVAILABLE'
  });
});

test('page adapter refuses a temporary tab taken over after create, load, or before managed send', async () => {
  for (const takeoverStage of ['create', 'load', 'send']) {
    const calls = { messages: [], remove: [], inject: [] };
    let active = takeoverStage === 'create';
    const chromeApi = {
      runtime: { lastError: null },
      tabs: {
        async create(options) { return { id: 31, status: 'complete', ...options, active }; },
        async get(id) { return { id, status: 'complete', url: URL, active }; },
        async sendMessage(id, message) {
          calls.messages.push(message.type);
          if (message.type === 'PING') return { ok: true, page: 'chat' };
          return {
            success: true,
            targetConversationId: 'conv-1',
            sentFingerprint: 'sent-1',
            observedAt: NOW
          };
        },
        async remove(id) { calls.remove.push(id); }
      },
      scripting: {
        async executeScript(input) { calls.inject.push(input); }
      }
    };
    const store = {
      async getSnapshot() {
        if (takeoverStage === 'send') active = true;
        return {
          managedConversations: {
            'conv-1': conversation({
              state: 'SENDING',
              sendIntent: { intentId: 'intent-1', status: 'SENDING', draft: '好的' }
            })
          }
        };
      }
    };
    const adapter = Runtime.createPageAdapter({
      chromeApi,
      store,
      waitForTabComplete: async () => {
        if (takeoverStage === 'load') active = true;
      }
    });
    const result = takeoverStage === 'send'
      ? await adapter.send(conversation(), '好的', { intentId: 'intent-1' })
      : await adapter.read(conversation());

    assert.equal(result.success, false, takeoverStage);
    assert.equal(
      calls.messages.includes(
        takeoverStage === 'send' ? 'SEND_MANAGED_REPLY' : 'READ_ACTIVE_CONVERSATION'
      ),
      false,
      takeoverStage
    );
    assert.deepEqual(calls.remove, [31], takeoverStage);
  }
});

test('page sender rechecks the persisted unconsumed intent before managed protocol send', async () => {
  const sent = [];
  const chromeApi = {
    runtime: { lastError: null },
    tabs: {
      async create(options) { return { id: 9, status: 'complete', ...options }; },
      async get(id) { return { id, active: false, status: 'complete', url: URL }; },
      async sendMessage(id, message) {
        sent.push(message);
        if (message.type === 'PING') return { ok: true, page: 'chat' };
        return {
          success: true,
          targetConversationId: 'conv-1',
          sentFingerprint: 'sent-1',
          observedAt: NOW
        };
      },
      async remove() {}
    },
    scripting: { async executeScript() {} }
  };
  let intent = { intentId: 'intent-1', status: 'SENDING', draft: '好的' };
  const store = {
    async getSnapshot() {
      return {
        managedConversations: {
          'conv-1': conversation({ state: 'SENDING', sendIntent: intent })
        }
      };
    }
  };
  const adapter = Runtime.createPageAdapter({ chromeApi, store, waitForTabComplete: async () => {} });

  const ok = await adapter.send(conversation(), '好的', { intentId: 'intent-1' });
  assert.equal(ok.success, true);
  assert.equal(sent.some((message) => message.type === 'SEND_MANAGED_REPLY'), true);

  intent = { intentId: 'other', status: 'SENDING', draft: '好的' };
  const refused = await adapter.send(conversation(), '好的', { intentId: 'intent-1' });
  assert.equal(refused.success, false);
  assert.equal(refused.errorCode, 'SEND_RESULT_UNKNOWN');
});

test('sender maps login and block preflight failures to a global pause without exposing raw errors', async () => {
  const savedSettings = [];
  const chromeApi = {
    runtime: { lastError: null },
    tabs: {
      async create(options) { return { id: 9, status: 'complete', ...options }; },
      async get(id) { return { id, active: false, status: 'complete', url: URL }; },
      async sendMessage(id, message) {
        if (message.type === 'PING') return { ok: true, page: 'chat' };
        return {
          success: false,
          errorCode: 'LOGIN_REQUIRED',
          error: 'raw login page text must not escape'
        };
      },
      async remove() {}
    },
    scripting: { async executeScript() {} }
  };
  const store = {
    async getSnapshot() {
      return {
        managedConversations: {
          'conv-1': conversation({
            state: 'SENDING',
            sendIntent: { intentId: 'intent-1', status: 'SENDING', draft: '好的' }
          })
        }
      };
    },
    async saveSettings(patch) { savedSettings.push(patch); }
  };
  const adapter = Runtime.createPageAdapter({ chromeApi, store, waitForTabComplete: async () => {} });

  const result = await adapter.send(conversation(), '好的', { intentId: 'intent-1' });
  assert.deepEqual(result, { success: false, errorCode: 'LOGIN_REQUIRED' });
  assert.deepEqual(savedSettings, [{
    paused: true,
    pauseCode: 'LOGIN_REQUIRED',
    pauseReason: ''
  }]);
});

test('callback-only Chrome tabs, scripting and alarms have the same behavior as Promise APIs', async () => {
  const calls = {
    create: 0,
    get: 0,
    sendMessage: 0,
    remove: 0,
    clear: 0,
    createdAlarm: 0
  };
  let callbackReceived = false;
  function callbackFrom(args) {
    const callback = args.at(-1);
    callbackReceived = callbackReceived || typeof callback === 'function';
    return typeof callback === 'function' ? callback : null;
  }
  const chromeApi = {
    runtime: { lastError: null },
    tabs: {
      create(...args) {
        calls.create += 1;
        const callback = callbackFrom(args);
        if (callback) callback({ id: 51, status: 'complete', ...args[0] });
      },
      get(...args) {
        calls.get += 1;
        const callback = callbackFrom(args);
        if (callback) callback({ id: args[0], active: false, status: 'complete', url: URL });
      },
      sendMessage(...args) {
        calls.sendMessage += 1;
        const callback = callbackFrom(args);
        if (callback) callback(args[1].type === 'PING'
          ? { ok: true, page: 'chat' }
          : {
              success: true,
              conversationRef: { conversationId: 'conv-1', url: URL },
              messages: [],
              baselineIncomingFingerprint: ''
            });
      },
      remove(...args) {
        calls.remove += 1;
        const callback = callbackFrom(args);
        if (callback) callback();
      }
    },
    scripting: {
      executeScript(...args) {
        const callback = callbackFrom(args);
        if (callback) callback([]);
      }
    },
    alarms: {
      clear(...args) {
        calls.clear += 1;
        const callback = callbackFrom(args);
        if (callback) callback(true);
      },
      create(...args) {
        calls.createdAlarm += 1;
        const callback = callbackFrom(args);
        if (callback) callback();
      }
    }
  };
  const adapter = Runtime.createPageAdapter({
    chromeApi,
    store: { async getSnapshot() { return { managedConversations: {} }; } }
  });
  assert.equal((await adapter.read(conversation())).success, true);
  assert.equal(callbackReceived, true);
  assert.equal(calls.create, 1);
  assert.equal(calls.remove, 1);
  assert.equal(calls.sendMessage, 2);

  const h = controllerHarness({ chromeApi });
  await h.controller.reconcileAlarm();
  assert.equal(calls.clear, 1);
});

test('Promise-only and callback runtime.lastError Chrome APIs are each invoked exactly once', async () => {
  let promiseCreateCalls = 0;
  const promiseChrome = {
    runtime: { lastError: null },
    tabs: {
      async create(...args) {
        promiseCreateCalls += 1;
        return { id: 61, status: 'complete', ...args[0] };
      },
      async get(...args) {
        return { id: args[0], active: false, status: 'complete', url: URL };
      },
      async sendMessage(...args) {
        return args[1].type === 'PING'
          ? { ok: true, page: 'chat' }
          : {
              success: true,
              messages: [],
              baselineIncomingFingerprint: ''
            };
      },
      async remove() {}
    },
    scripting: { async executeScript() {} }
  };
  const promiseAdapter = Runtime.createPageAdapter({
    chromeApi: promiseChrome,
    store: { async getSnapshot() { return { managedConversations: {} }; } }
  });
  assert.equal((await promiseAdapter.read(conversation())).success, true);
  assert.equal(promiseCreateCalls, 1);

  let callbackCreateCalls = 0;
  let callbackReceived = false;
  const callbackChrome = {
    runtime: { lastError: null },
    tabs: {
      create(...args) {
        callbackCreateCalls += 1;
        const callback = args.at(-1);
        callbackReceived = typeof callback === 'function';
        if (callbackReceived) {
          callbackChrome.runtime.lastError = { message: 'tab create failed' };
          callback();
          callbackChrome.runtime.lastError = null;
        }
      }
    },
    scripting: {}
  };
  const callbackAdapter = Runtime.createPageAdapter({
    chromeApi: callbackChrome,
    store: { async getSnapshot() { return { managedConversations: {} }; } },
    waitForTabComplete: async () => {}
  });
  assert.deepEqual(await callbackAdapter.read(conversation()), {
    success: false,
    errorCode: 'CONVERSATION_UNAVAILABLE'
  });
  assert.equal(callbackReceived, true);
  assert.equal(callbackCreateCalls, 1);
});

test('run and resolve reconcile the latest paused state before another queued command starts', async () => {
  const h = controllerHarness({
    engine: {
      async runCycle() {
        h.snapshot.conversationTrusteeship.paused = true;
        return { checked: 0, errors: [] };
      },
      async resolveApproval() {
        h.snapshot.conversationTrusteeship.paused = true;
        return { ok: true, status: 'NO_REPLY' };
      }
    }
  });
  h.snapshot.conversationTrusteeship.enabled = true;
  await h.controller.handleMessage({ type: 'TRUSTEESHIP_RUN_NOW' });
  assert.deepEqual(h.calls.clear, [Runtime.TRUSTEESHIP_ALARM]);

  h.snapshot.conversationTrusteeship.paused = false;
  await h.controller.handleMessage({
    type: 'TRUSTEESHIP_RESOLVE_APPROVAL',
    approvalId: 'approval-1',
    action: 'NO_REPLY'
  });
  assert.deepEqual(h.calls.clear, [
    Runtime.TRUSTEESHIP_ALARM,
    Runtime.TRUSTEESHIP_ALARM
  ]);
});

test('a concurrent lifecycle reconcile cannot overwrite the alarm chosen by a settings save', async () => {
  const storage = memoryStorage({
    apiKey: 'api-key',
    resumeText: '五年前端经验',
    riskAccepted: true,
    apiLastTestOk: true,
    apiLastTestAt: NOW,
    feishuNotification: {
      enabled: true,
      webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/abc123',
      signingSecret: '',
      lastTestOk: true,
      lastTestAt: NOW
    }
  });
  const snapshot = {
    conversationTrusteeship: {
      enabled: true,
      paused: false,
      intervalMinutes: 5
    },
    feishuNotification: storage.data.feishuNotification,
    managedConversations: {},
    pendingApprovals: {}
  };
  const periods = [];
  const store = {
    async getSnapshot() {
      return structuredClone(snapshot);
    },
    async saveSettings(patch) {
      Object.assign(snapshot.conversationTrusteeship, structuredClone(patch));
      return structuredClone(snapshot.conversationTrusteeship);
    },
    async setManaged() {
      throw new Error('unused');
    }
  };
  const chromeApi = {
    runtime: { lastError: null },
    alarms: {
      async clear() {},
      async create(name, options) {
        periods.push(options.periodInMinutes);
      }
    },
    tabs: {
      async create(options) { return { id: 1, ...options }; }
    }
  };
  const controller = Runtime.createController({
    chromeApi,
    storage,
    store,
    engine: {
      async runCycle() { return {}; },
      async resolveApproval() { return { ok: true }; }
    },
    policy: Policy,
    notifierModule: FeishuNotifier,
    feishuClient: { async send() { return { ok: true, code: 'OK' }; } },
    saveApi: async () => ({ identityChanged: false }),
    runApiTest: async () => ({ ok: true, code: 'OK' }),
    now: () => NOW
  });

  const saved = controller.handleMessage({
    type: 'TRUSTEESHIP_SAVE_SETTINGS',
    settings: { enabled: true, intervalMinutes: 15 }
  });
  const lifecycle = controller.reconcileAlarm();
  await Promise.all([saved, lifecycle]);

  assert.deepEqual(periods, [15, 15]);
  assert.equal(periods.at(-1), 15);
});

test('REGISTER_ACTIVE captures the focused Boss chat tab and optionally enables hosting', async () => {
  const snapshot = {
    conversationTrusteeship: { enabled: false, paused: false, intervalMinutes: 10 },
    feishuNotification: {},
    managedConversations: {},
    pendingApprovals: {}
  };
  const calls = { query: [], injected: [], messages: [], registered: [], setManaged: [] };
  const store = {
    async getSnapshot() { return structuredClone(snapshot); },
    async registerConversation(ref) {
      calls.registered.push(structuredClone(ref));
      const saved = Object.assign({
        enabled: false,
        state: 'DISABLED',
        pauseCode: '',
        lastCheckedAt: 0,
        updatedAt: NOW
      }, ref);
      snapshot.managedConversations[ref.conversationId] = saved;
      return structuredClone(saved);
    },
    async setManaged(id, enabled) {
      calls.setManaged.push([id, enabled]);
      snapshot.managedConversations[id].enabled = enabled === true;
      snapshot.managedConversations[id].state = enabled === true ? 'WAITING_HR' : 'DISABLED';
      return structuredClone(snapshot.managedConversations[id]);
    },
    async saveSettings() { return structuredClone(snapshot.conversationTrusteeship); }
  };
  const chromeApi = {
    alarms: {
      async clear() { return true; },
      async create() {}
    },
    tabs: {
      async query(query) {
        calls.query.push(query);
        return [{
          id: 42,
          url: 'https://www.zhipin.com/web/geek/chat?uid=peer~~manual-1',
          active: true
        }];
      },
      async sendMessage(tabId, message) {
        calls.messages.push([tabId, message]);
        if (message.type === 'PING') return { ok: true, page: 'chat' };
        if (message.type === 'CAPTURE_ACTIVE_CONVERSATION') {
          return {
            success: true,
            conversationRef: {
              conversationId: 'peer~~manual-1',
              url: 'https://www.zhipin.com/web/geek/chat?uid=peer~~manual-1',
              aliases: ['manual-1']
            },
            peerSource: 'encryptUid',
            baselineIncomingFingerprint: 'id:fp-1',
            company: '乙公司',
            position: '后端工程师',
            hrName: '王经理'
          };
        }
        return { ok: false };
      }
    },
    scripting: {
      async executeScript(details) {
        calls.injected.push(details);
        return [];
      }
    }
  };
  const h = controllerHarness({ chromeApi, store, snapshot });
  const result = await h.controller.handleMessage({
    type: 'TRUSTEESHIP_REGISTER_ACTIVE',
    enable: true
  });
  assert.equal(result.ok, true);
  assert.equal(result.conversation.conversationId, 'peer~~manual-1');
  assert.equal(result.conversation.company, '乙公司');
  assert.equal(result.conversation.enabled, true);
  assert.equal(result.alreadyRegistered, false);
  assert.deepEqual(calls.query[0], { active: true, lastFocusedWindow: true });
  assert.equal(calls.registered[0].jobId, 'manual-peer~~manual-1');
  assert.deepEqual(calls.registered[0].aliases, ['manual-1']);
  assert.deepEqual(calls.setManaged, [['peer~~manual-1', true]]);
  assert.equal(calls.injected.length, 0);

  const missing = await h.controller.handleMessage({
    type: 'TRUSTEESHIP_REGISTER_ACTIVE',
    enable: false
  });
  // second call still succeeds; rewrite chrome query to empty for failure path
  chromeApi.tabs.query = async () => [];
  const failed = await h.controller.handleMessage({
    type: 'TRUSTEESHIP_REGISTER_ACTIVE',
    enable: true
  });
  assert.equal(failed.ok, false);
  assert.equal(failed.code, 'ACTIVE_CHAT_REQUIRED');
  assert.equal(missing.ok, true);
  assert.equal(missing.alreadyRegistered, true);
});

test('OPEN_CONVERSATION reuses a Boss chat tab and succeeds only after the stored target is activated', async () => {
  const calls = {
    created: [],
    queried: [],
    updated: [],
    messages: []
  };
  const chromeApi = {
    alarms: {
      async clear() { return true; },
      async create() {}
    },
    tabs: {
      async query(query) {
        calls.queried.push(query);
        if (query.active === true && query.lastFocusedWindow === true) {
          return [{
            id: 42,
            windowId: 7,
            active: true,
            url: 'https://www.zhipin.com/web/geek/chat'
          }];
        }
        return [{
          id: 99,
          windowId: 11,
          active: true,
          url: 'https://www.zhipin.com/web/geek/chat'
        }];
      },
      async update(tabId, patch) {
        calls.updated.push([tabId, patch]);
        return { id: tabId, windowId: 7, active: true };
      },
      async create(options) {
        calls.created.push(options);
        return { id: 77, windowId: 7, ...options };
      },
      async sendMessage(tabId, message) {
        calls.messages.push([tabId, structuredClone(message)]);
        if (message.type === 'PING') return { ok: true, page: 'chat' };
        if (message.type === 'OPEN_MANAGED_CONVERSATION') {
          return {
            success: true,
            conversationRef: {
              conversationId: 'conv-1',
              url: URL,
              aliases: ['conv-legacy']
            }
          };
        }
        return { success: false };
      }
    },
    scripting: {
      async executeScript() {
        throw new Error('content script should already be available');
      }
    }
  };
  const snapshot = {
    conversationTrusteeship: {
      enabled: true,
      paused: false,
      intervalMinutes: 10
    },
    feishuNotification: {},
    managedConversations: {
      'conv-1': conversation({ aliases: ['conv-legacy'] })
    },
    pendingApprovals: {}
  };
  const h = controllerHarness({ chromeApi, snapshot });

  const result = await h.controller.handleMessage({
    type: 'TRUSTEESHIP_OPEN_CONVERSATION',
    conversationId: 'conv-1'
  });

  assert.deepEqual(result, { ok: true, tabId: 42 });
  assert.equal(calls.created.length, 0);
  assert.deepEqual(calls.queried, [{
    active: true,
    lastFocusedWindow: true
  }]);
  assert.deepEqual(calls.updated, [[42, { active: true }]]);
  assert.deepEqual(calls.messages.map((entry) => entry[1].type), [
    'PING',
    'OPEN_MANAGED_CONVERSATION'
  ]);
  assert.deepEqual(calls.messages[1], [42, {
    type: 'OPEN_MANAGED_CONVERSATION',
    expected: {
      id: 'job-1',
      name: '前端工程师',
      company: '甲公司',
      hrName: '李经理'
    },
    conversationRef: {
      conversationId: 'conv-1',
      url: URL,
      aliases: ['conv-legacy']
    }
  }]);
});

test('OPEN_CONVERSATION reports target uncertainty instead of accepting an unconfirmed page', async () => {
  const chromeApi = {
    alarms: {
      async clear() { return true; },
      async create() {}
    },
    tabs: {
      async query() {
        return [{
          id: 42,
          active: true,
          url: 'https://www.zhipin.com/web/geek/chat'
        }];
      },
      async update(tabId) { return { id: tabId, active: true }; },
      async create(options) { return { id: 77, ...options }; },
      async sendMessage(tabId, message) {
        if (message.type === 'PING') return { ok: true, page: 'chat' };
        return {
          success: false,
          errorCode: 'TARGET_UNCERTAIN',
          targetUncertain: true
        };
      }
    },
    scripting: {
      async executeScript() { return []; }
    }
  };
  const h = controllerHarness({ chromeApi });

  const result = await h.controller.handleMessage({
    type: 'TRUSTEESHIP_OPEN_CONVERSATION',
    conversationId: 'conv-1'
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, 'TARGET_UNCERTAIN');
});

test('REMOVE_CONVERSATION deletes a registered conversation from the store', async () => {
  const h = controllerHarness();
  const removed = await h.controller.handleMessage({
    type: 'TRUSTEESHIP_REMOVE_CONVERSATION',
    conversationId: 'conv-1'
  });
  assert.deepEqual(removed, { ok: true, conversationId: 'conv-1' });
  assert.deepEqual(h.calls.removeConversation, ['conv-1']);
  const missing = await h.controller.handleMessage({
    type: 'TRUSTEESHIP_REMOVE_CONVERSATION',
    conversationId: 'conv-1'
  });
  assert.equal(missing.ok, false);
  assert.equal(missing.code, 'CONVERSATION_NOT_REGISTERED');
});

test('classifier uses ReplyAI builders/parsers and resume facts read one bounded config snapshot', async () => {
  const prompts = [];
  const classifier = Runtime.createClassifier({
    replyAI: ReplyAI,
    async callLLM(messages) {
      prompts.push(messages);
      if (prompts.length === 1) {
        return '{"category":"courtesy","confidence":0.9,"reasonCode":"SAFE","evidenceIds":["resume-line-1"],"fieldsNeeded":[]}';
      }
      return '{"draft":"好的，谢谢。","evidenceIds":["resume-line-1"]}';
    }
  });
  const input = {
    target: { company: '甲公司' },
    targetMessages: [{ role: 'recruiter', text: '您好' }],
    resumeFacts: [{ id: 'resume-line-1', text: '五年前端经验' }],
    apiKey: 'must-not-leak',
    webhook: 'must-not-leak'
  };
  assert.equal((await classifier.classify(input)).category, 'courtesy');
  assert.equal((await classifier.draft(input)).draft, '好的，谢谢。');
  assert.equal(JSON.stringify(prompts).includes('must-not-leak'), false);

  let loads = 0;
  const getFacts = Runtime.createResumeFacts(async () => {
    loads += 1;
    return { resumeText: `\n 五年前端经验 \n\n${'A'.repeat(800)}\n` };
  });
  const facts = await getFacts();
  assert.equal(loads, 1);
  assert.deepEqual(facts.map((item) => item.id), ['resume-line-1', 'resume-line-2']);
  assert.equal(Array.from(facts[1].text).length, 600);
});
