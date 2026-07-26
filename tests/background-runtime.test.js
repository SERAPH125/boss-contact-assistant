const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const runtimeSource = fs.readFileSync(
  path.join(root, 'src/conversation/trusteeship-runtime.js'),
  'utf8'
);
const backgroundSource = fs.readFileSync(
  path.join(root, 'src/background.js'),
  'utf8'
);
const actualNotificationModuleSources = [
  'src/conversation/trusteeship-policy.js',
  'src/conversation/conversation-store.js',
  'src/conversation/feishu-notifier.js',
  'src/conversation/monitor-engine.js'
].map((relativePath) => ({
  relativePath,
  source: fs.readFileSync(path.join(root, relativePath), 'utf8')
}));

function event() {
  const listeners = [];
  return {
    listeners,
    addListener(listener) {
      listeners.push(listener);
    }
  };
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function apiSaveMessage(apiKey = 'rotated-key') {
  return {
    type: 'SAVE_API_CONFIG',
    config: {
      provider: 'deepseek',
      apiKey,
      baseUrl: '',
      resumeText: '五年前端经验'
    }
  };
}

function harness(options = {}) {
  const calls = {
    controllerHandle: 0,
    controllerInvalidate: 0,
    apiSave: 0,
    scheduled: 0,
    engineRun: 0,
    engineResolve: 0,
    readerRead: 0,
    classifier: 0,
    notifier: 0,
    feishuSend: 0,
    tabsCreate: 0,
    tabsGet: 0,
    tabsSendMessage: 0,
    managedRead: 0,
    managedSend: 0,
    fetch: 0,
    runtimeMessages: [],
    alarmsClear: [],
    alarmsCreate: [],
    storeSettings: []
  };
  const data = {
    provider: 'deepseek',
    apiKey: 'api-key',
    dsKey: 'api-key',
    baseUrl: '',
    resumeText: '五年前端经验',
    riskAccepted: true,
    apiLastTestOk: true,
    apiLastTestAt: Date.now(),
    apiConfigVersion: 0,
    apiLastTestVersion: 0,
    feishuNotification: {
      enabled: true,
      webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/abc123',
      signingSecret: '',
      lastTestOk: true,
      lastTestAt: Date.now()
    }
  };
  Object.assign(data, structuredClone(options.initialData || {}));
  const snapshot = {
    conversationTrusteeship: {
      enabled: options.initialTrusteeshipEnabled === true,
      paused: false,
      intervalMinutes: 10,
      dailyAutoReplyLimit: 5,
      quietHours: { enabled: false, start: '22:00', end: '08:00' }
    },
    feishuNotification: data.feishuNotification,
    managedConversations: {
      'conv-1': {
        conversationId: 'conv-1',
        platform: 'boss',
        url: 'https://www.zhipin.com/web/geek/chat?conversationId=conv-1',
        jobId: 'job-1',
        company: '甲公司',
        position: '工程师',
        hrName: '李经理',
        enabled: false,
        state: 'DISABLED'
      }
    },
    pendingApprovals: {}
  };
  if (options.actualNotificationComposition) {
    Object.assign(data, structuredClone(snapshot));
  }
  const onMessage = event();
  const onAlarm = event();
  const onInstalled = event();
  const onStartup = event();
  const onStorageChanged = event();
  let protectedDependencies = null;
  let actualConversationStore = null;
  let actualMonitorEngine = null;
  let nextConfigLoad = null;
  let nextSnapshotRotation = null;
  let nextTabsGetRotation = null;

  const storage = {
    async get(keys) {
      if (keys === null || keys === undefined) return structuredClone(data);
      const result = {};
      (Array.isArray(keys) ? keys : [keys]).forEach((key) => {
        result[key] = structuredClone(data[key]);
      });
      return result;
    },
    async set(patch) {
      if (options.failApiProofWrite &&
        Object.prototype.hasOwnProperty.call(patch, 'apiLastTestOk')) {
        throw new Error('secret storage failure');
      }
      const changes = {};
      Object.keys(patch).forEach((key) => {
        changes[key] = {
          oldValue: structuredClone(data[key]),
          newValue: structuredClone(patch[key])
        };
      });
      Object.assign(data, structuredClone(patch));
      if (patch.feishuNotification) {
        snapshot.feishuNotification = structuredClone(patch.feishuNotification);
      }
      onStorageChanged.listeners.forEach((listener) => listener(changes, 'local'));
    }
  };
  async function rotateApiData(next) {
    const currentVersion = Number.isSafeInteger(data.apiConfigVersion)
      ? data.apiConfigVersion
      : 0;
    await storage.set({
      provider: next.provider,
      apiKey: next.apiKey,
      dsKey: next.apiKey,
      baseUrl: next.baseUrl,
      apiConfigVersion: currentVersion + 1,
      apiLastTestOk: false,
      apiLastTestAt: 0,
      apiLastTestVersion: currentVersion
    });
  }
  async function applyApiSave(api) {
    const currentKey = data.apiKey || data.dsKey || '';
    const identityChanged =
      (data.provider || 'deepseek') !== api.provider ||
      currentKey !== api.apiKey ||
      (data.baseUrl || '') !== api.baseUrl;
    const patch = {
      provider: api.provider,
      apiKey: api.apiKey,
      dsKey: api.apiKey,
      baseUrl: api.baseUrl,
      resumeText: api.resumeText
    };
    if (identityChanged) {
      const currentVersion = Number.isSafeInteger(data.apiConfigVersion)
        ? data.apiConfigVersion
        : 0;
      Object.assign(patch, {
        apiConfigVersion: currentVersion + 1,
        apiLastTestOk: false,
        apiLastTestAt: 0,
        apiLastTestVersion: currentVersion
      });
    }
    await storage.set(patch);
    return { identityChanged };
  }
  const store = {
    async getSnapshot() {
      if (nextSnapshotRotation) {
        const rotation = nextSnapshotRotation;
        nextSnapshotRotation = null;
        await rotateApiData(rotation);
      }
      return structuredClone(snapshot);
    },
    async saveSettings(patch) {
      if ((options.pausePersistFailure &&
          patch.paused === true &&
          patch.pauseCode === 'SERVICE_WORKER_INTERRUPTED') ||
        (options.apiPausePersistFailure &&
          patch.paused === true &&
          patch.pauseCode === 'API_CONFIG_CHANGED')) {
        throw new Error('pause storage failed');
      }
      calls.storeSettings.push(structuredClone(patch));
      Object.assign(snapshot.conversationTrusteeship, structuredClone(patch));
      return structuredClone(snapshot.conversationTrusteeship);
    },
    async setManaged(id, enabled) {
      snapshot.managedConversations[id].enabled = enabled;
      return structuredClone(snapshot.managedConversations[id]);
    },
    async registerConversation() {}
  };
  const engine = {
    async runCycle() {
      calls.engineRun += 1;
      if (typeof options.engineRunFn === 'function') {
        return options.engineRunFn();
      }
      return { checked: 0, errors: [] };
    },
    async resolveApproval() {
      calls.engineResolve += 1;
      return { ok: true, status: 'NO_REPLY' };
    }
  };
  const runStore = {
    async recoverInterrupted() {
      if (options.initFailure) throw new Error('secret init detail');
      return null;
    },
    async current() { return null; },
    async patch() {},
    async finish() {},
    async start() { return { runId: 'run-1' }; }
  };
  const chrome = {
    storage: { local: storage, onChanged: onStorageChanged },
    runtime: {
      id: 'extension-id',
      lastError: null,
      onMessage,
      onInstalled,
      onStartup,
      getURL(relative) {
        return 'chrome-extension://extension-id/' + String(relative).replace(/^\/+/, '');
      },
      sendMessage(message) {
        calls.runtimeMessages.push(structuredClone(message));
        return Promise.resolve();
      },
      getContexts() { return Promise.resolve([]); }
    },
    alarms: {
      onAlarm,
      clear(name, callback) {
        calls.alarmsClear.push(name);
        if (callback) callback(true);
        return Promise.resolve(true);
      },
      create(name, alarmOptions, callback) {
        calls.alarmsCreate.push([name, structuredClone(alarmOptions)]);
        if (callback) callback();
        return Promise.resolve();
      }
    },
    tabs: {
      create(tabOptions, callback) {
        calls.tabsCreate += 1;
        const tab = { id: 99, status: 'complete', ...tabOptions };
        if (callback) callback(tab);
        return Promise.resolve(tab);
      },
      get(id, callback) {
        calls.tabsGet += 1;
        if (nextTabsGetRotation) {
          const rotation = nextTabsGetRotation;
          nextTabsGetRotation = null;
          rotateApiData(rotation);
        }
        const tab = {
          id,
          active: false,
          status: 'complete',
          url: snapshot.managedConversations['conv-1'].url
        };
        if (callback) callback(tab);
        return Promise.resolve(tab);
      },
      sendMessage(id, message, callback) {
        calls.tabsSendMessage += 1;
        if (message.type === 'READ_ACTIVE_CONVERSATION') calls.managedRead += 1;
        if (message.type === 'SEND_MANAGED_REPLY') calls.managedSend += 1;
        const response = message.type === 'PING'
          ? { ok: true, page: 'chat' }
          : (message.type === 'READ_ACTIVE_CONVERSATION' &&
            options.actualNotificationComposition
              ? {
                  success: true,
                  conversationRef: structuredClone(message.conversationRef),
                  messages: [],
                  baselineIncomingFingerprint: message.lastFingerprint
                }
              : { success: false, errorCode: 'TARGET_UNCERTAIN' });
        if (callback) callback(response);
        return Promise.resolve(response);
      },
      remove(id, callback) {
        if (callback) callback();
        return Promise.resolve();
      },
      query() { return Promise.resolve([]); }
    },
    scripting: {
      executeScript(input, callback) {
        if (callback) callback([]);
        return Promise.resolve([]);
      }
    },
    sidePanel: {
      setPanelBehavior() { return Promise.resolve(); }
    },
    offscreen: {
      createDocument() { return Promise.resolve(); },
      closeDocument() { return Promise.resolve(); }
    }
  };
  const context = {
    console,
    chrome,
    importScripts() {},
    URL,
    Date,
    Promise,
    Object,
    Array,
    String,
    Number,
    Boolean,
    JSON,
    Math,
    RegExp,
    Error,
    Set,
    Map,
    AbortController,
    TextEncoder,
    btoa,
    crypto: {
      randomUUID() { return 'uuid'; },
      subtle: options.subtle || {}
    },
    setTimeout,
    clearTimeout,
    structuredClone,
    fetch: async function () {
      calls.fetch += 1;
      if (typeof options.fetchFn === 'function') return options.fetchFn();
      return {
        ok: true,
        status: 200,
        async json() {
          return {
            choices: [{
              message: {
                content: options.apiResponse === undefined ? 'ok' : options.apiResponse
              }
            }]
          };
        },
        async text() { return ''; }
      };
    },
    RunStore: {
      createRunStore() { return runStore; }
    },
    DeliveryGuard: {
      createIntentStore() {
        return {
          cancel: async () => true,
          prepare: async () => ({}),
          confirm: async () => ({})
        };
      },
      guidanceFor(code) {
        return { message: code, nextAction: '人工处理' };
      },
      runError(code) {
        const error = new Error(code);
        error.code = code;
        error.nextAction = '人工处理';
        return error;
      }
    },
    ConversationStore: {
      create() { return store; }
    },
    FeishuNotifier: {
      create() {
        return {
          async send() {
            calls.feishuSend += 1;
            return { ok: true, code: 'OK' };
          }
        };
      },
      validateConfig(config) {
        if (!config || !config.webhook) throw new Error('invalid');
        return true;
      },
      buildApprovalCard() { return {}; }
    },
    ReplyAI: {
      buildClassificationMessages() { return []; },
      parseClassification() {
        calls.classifier += 1;
        return {};
      },
      buildDraftMessages() { return []; },
      parseDraft() {
        calls.classifier += 1;
        return {};
      }
    },
    MonitorEngine: {
      create(dependencies) {
        protectedDependencies = dependencies;
        const originalRead = dependencies.reader.read;
        dependencies.reader.read = async function () {
          calls.readerRead += 1;
          return originalRead.apply(this, arguments);
        };
        return engine;
      }
    },
    TrusteeshipPolicy: {
      normalizeSettings(input) {
        return {
          enabled: input.enabled === true,
          paused: input.paused === true,
          intervalMinutes: Number(input.intervalMinutes) || 10,
          dailyAutoReplyLimit: Number(input.dailyAutoReplyLimit) || 5,
          quietHours: input.quietHours || {
            enabled: false,
            start: '22:00',
            end: '08:00'
          }
        };
      }
    },
    PlatformConfig: {
      ensureMigrated() { return Promise.resolve(data); },
      loadFlat() {
        if (nextConfigLoad) {
          const deferredLoad = nextConfigLoad;
          nextConfigLoad = null;
          deferredLoad.markStarted();
          return deferredLoad.promise;
        }
        return Promise.resolve({
          ...structuredClone(data),
          activePlatform: 'boss',
          processed: {}
        });
      },
      loadFlatFor() { return this.loadFlat(); },
      async saveApi(api) {
        calls.apiSave += 1;
        if (typeof options.saveApiFn === 'function') {
          return options.saveApiFn(api, applyApiSave);
        }
        return applyApiSave(api);
      },
      setProcessed() { return Promise.resolve(); }
    },
    RunSafety: {
      checkpoint() {},
      isRunStop() { return false; },
      waitCancellable() { return Promise.resolve(0); },
      snapshotRunConfig(value) { return value; },
      validateJobPlatform() { return true; }
    },
    PlatformRegistry: {
      get() { return {}; }
    },
    Humanize: {},
    BossConversationReader: {}
  };
  context.globalThis = context;
  context.self = context;
  if (options.actualNotificationComposition) {
    actualNotificationModuleSources.forEach(({ relativePath, source }) => {
      vm.runInNewContext(source, context, { filename: relativePath });
    });
    const createStore = context.ConversationStore.create;
    context.ConversationStore.create = function () {
      actualConversationStore = createStore.apply(this, arguments);
      return actualConversationStore;
    };
    const createEngine = context.MonitorEngine.create;
    context.MonitorEngine.create = function (dependencies) {
      protectedDependencies = dependencies;
      actualMonitorEngine = createEngine(dependencies);
      return actualMonitorEngine;
    };
  }
  vm.runInNewContext(runtimeSource, context, {
    filename: 'src/conversation/trusteeship-runtime.js'
  });
  const createController = context.TrusteeshipRuntime.createController;
  context.TrusteeshipRuntime.createController = function (controllerOptions) {
    const controller = createController(controllerOptions);
    return {
      reconcileAlarm: controller.reconcileAlarm,
      failClosed: controller.failClosed,
      handleMessage(message) {
        calls.controllerHandle += 1;
        return controller.handleMessage(message);
      },
      runScheduledCycle() {
        calls.scheduled += 1;
        return controller.runScheduledCycle();
      },
      invalidateApiProof() {
        calls.controllerInvalidate += 1;
        return controller.invalidateApiProof();
      },
      saveApiConfig(message) {
        return controller.saveApiConfig(message);
      },
      runApiTest() {
        return controller.runApiTest();
      }
    };
  };
  vm.runInNewContext(backgroundSource, context, { filename: 'src/background.js' });

  async function settle() {
    await new Promise((resolve) => setTimeout(resolve, 0));
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  async function send(message, sender) {
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('background response timeout')), 1000);
      const returned = onMessage.listeners[0](message, sender || {}, (response) => {
        clearTimeout(timeout);
        resolve(structuredClone(response));
      });
      if (returned !== true && returned !== undefined) {
        clearTimeout(timeout);
        resolve(returned);
      }
    });
  }

  return {
    calls,
    data,
    snapshot,
    get protectedDependencies() {
      return protectedDependencies;
    },
    get conversationStore() {
      return actualConversationStore;
    },
    get monitorEngine() {
      return actualMonitorEngine;
    },
    storage,
    chrome,
    events: { onMessage, onAlarm, onInstalled, onStartup, onStorageChanged },
    settle,
    send,
    deferNextConfigLoad() {
      let release;
      let markStarted;
      const started = new Promise((resolve) => { markStarted = resolve; });
      const promise = new Promise((resolve) => { release = resolve; });
      nextConfigLoad = { promise, markStarted };
      return {
        started,
        release(value) {
          release(value || {
            ...structuredClone(data),
            activePlatform: 'boss',
            processed: {}
          });
        }
      };
    },
    rotateOnNextSnapshot(next) {
      nextSnapshotRotation = structuredClone(next);
    },
    rotateOnNextTabsGet(next) {
      nextTabsGetRotation = structuredClone(next);
    },
    async rotateApi(next) {
      await rotateApiData(next);
    },
    trustedSender: {
      url: chrome.runtime.getURL('/src/sidepanel.html')
    }
  };
}

test('real background allows trusteeship messages only from the exact extension sidepanel', async () => {
  const h = harness();
  await h.settle();
  h.calls.controllerHandle = 0;
  const untrusted = [
    {},
    { url: 'https://www.zhipin.com/web/geek/chat', tab: { id: 1 }, frameId: 0 },
    { url: h.chrome.runtime.getURL('/src/sidepanel.html'), tab: { id: 1 } },
    { url: h.chrome.runtime.getURL('/src/options.html') },
    { url: 'chrome-extension://other/src/sidepanel.html' }
  ];
  for (const sender of untrusted) {
    assert.deepEqual(
      await h.send({ type: 'TRUSTEESHIP_RUN_NOW' }, sender),
      { ok: false, code: 'TRUSTEESHIP_UNAUTHORIZED' }
    );
  }
  assert.equal(h.calls.controllerHandle, 0);
  assert.equal(h.calls.engineRun, 0);

  assert.equal(
    (await h.send({ type: 'TRUSTEESHIP_GET_STATE' }, h.trustedSender)).ok,
    true
  );
  assert.equal(h.calls.controllerHandle, 1);
});

test('real background rejects malformed high-privilege messages before all side effects', async () => {
  const h = harness();
  await h.settle();
  const invalid = [
    { type: 'TRUSTEESHIP_SAVE_SETTINGS', settings: { enabled: false }, extra: true },
    { type: 'TRUSTEESHIP_TEST_FEISHU', webhook: 'https://evil.example' },
    {
      type: 'TRUSTEESHIP_RESOLVE_APPROVAL',
      approvalId: 'approval-1',
      action: 'DELETE'
    },
    { type: 'TRUSTEESHIP_OPEN_CONVERSATION', conversationId: 'x'.repeat(129) },
    { type: 'TRUSTEESHIP_RUN_NOW', force: true }
  ];
  for (const message of invalid) {
    assert.deepEqual(
      await h.send(message, h.trustedSender),
      { ok: false, code: 'TRUSTEESHIP_MESSAGE_INVALID' }
    );
  }
  assert.equal(h.calls.controllerHandle, 0);
  assert.equal(h.calls.engineRun, 0);
  assert.equal(h.calls.engineResolve, 0);
  assert.equal(h.calls.feishuSend, 0);
  assert.equal(h.calls.tabsCreate, 0);
});

test('SAVE_API_CONFIG is exact-schema sidepanel-only and runs through the controller owner', async () => {
  const h = harness({ initialTrusteeshipEnabled: true });
  await h.settle();
  h.calls.apiSave = 0;
  const untrusted = await h.send(apiSaveMessage(), {
    url: 'https://www.zhipin.com/web/geek/chat',
    tab: { id: 1 },
    frameId: 0
  });
  assert.deepEqual(untrusted, {
    ok: false,
    code: 'TRUSTEESHIP_UNAUTHORIZED'
  });
  const invalid = apiSaveMessage();
  invalid.extra = true;
  assert.deepEqual(
    await h.send(invalid, h.trustedSender),
    { ok: false, code: 'API_CONFIG_INPUT_INVALID' }
  );
  assert.equal(h.calls.apiSave, 0);

  assert.deepEqual(
    await h.send(apiSaveMessage(), h.trustedSender),
    { ok: true, code: 'OK', apiConfigChanged: true }
  );
  await h.settle();
  assert.equal(h.calls.apiSave, 1);
  assert.equal(h.data.apiKey, 'rotated-key');
  assert.equal(h.snapshot.conversationTrusteeship.enabled, false);
  assert.equal(h.snapshot.conversationTrusteeship.paused, true);
  assert.equal(h.snapshot.conversationTrusteeship.pauseCode, 'API_CONFIG_CHANGED');
});

test('scheduled cycle and SAVE_API_CONFIG obey both controller queue orders', async () => {
  {
    let markEntered;
    let releaseCycle;
    const entered = new Promise((resolve) => { markEntered = resolve; });
    const cycleGate = new Promise((resolve) => { releaseCycle = resolve; });
    const h = harness({
      initialTrusteeshipEnabled: true,
      async engineRunFn() {
        markEntered();
        await cycleGate;
        return { checked: 0, errors: [] };
      }
    });
    await h.settle();
    h.calls.apiSave = 0;
    h.events.onAlarm.listeners[0]({ name: 'boss-ai-chat-monitor' });
    await entered;
    const save = h.send(apiSaveMessage(), h.trustedSender);
    await Promise.resolve();
    assert.equal(h.calls.apiSave, 0);
    releaseCycle();
    assert.equal((await save).ok, true);
    await h.settle();
    assert.equal(h.calls.engineRun, 1);
    assert.equal(h.calls.apiSave, 1);
    assert.equal(h.snapshot.conversationTrusteeship.enabled, false);
  }

  {
    let markEntered;
    let releaseSave;
    const entered = new Promise((resolve) => { markEntered = resolve; });
    const saveGate = new Promise((resolve) => { releaseSave = resolve; });
    const h = harness({
      initialTrusteeshipEnabled: true,
      async saveApiFn(api, apply) {
        markEntered();
        await saveGate;
        return apply(api);
      }
    });
    await h.settle();
    h.calls.engineRun = 0;
    const save = h.send(apiSaveMessage(), h.trustedSender);
    await entered;
    h.events.onAlarm.listeners[0]({ name: 'boss-ai-chat-monitor' });
    await Promise.resolve();
    assert.equal(h.calls.engineRun, 0);
    releaseSave();
    assert.equal((await save).ok, true);
    await h.settle();
    assert.equal(h.calls.scheduled, 1);
    assert.equal(h.calls.engineRun, 0);
  }
});

test('alarm uses the internal scheduled entry and paused save clears the alarm', async () => {
  const h = harness({ initialTrusteeshipEnabled: true });
  await h.settle();
  h.calls.controllerHandle = 0;
  h.calls.scheduled = 0;
  h.calls.engineRun = 0;
  h.calls.alarmsClear.length = 0;

  h.events.onAlarm.listeners[0]({ name: 'other' });
  h.events.onAlarm.listeners[0]({
    name: 'boss-ai-chat-monitor',
    scheduledTime: Date.now() - (6 * 60 * 60 * 1000)
  });
  await h.settle();
  assert.equal(h.calls.scheduled, 1);
  assert.equal(h.calls.controllerHandle, 0);
  assert.equal(h.calls.engineRun, 1);

  await h.send({
    type: 'TRUSTEESHIP_SAVE_SETTINGS',
    settings: { enabled: false }
  }, h.trustedSender);
  assert.deepEqual(h.calls.alarmsClear, ['boss-ai-chat-monitor']);
});

test('TEST_API succeeds only for an explicit nonempty ok protocol response', async () => {
  const success = harness({ apiResponse: '  OK  ' });
  await success.settle();
  assert.deepEqual(
    await success.send({ type: 'TEST_API' }, success.trustedSender),
    { ok: true, code: 'OK' }
  );
  assert.equal(success.data.apiLastTestOk, true);

  const punctuated = harness({ apiResponse: 'ok。' });
  await punctuated.settle();
  assert.deepEqual(
    await punctuated.send({ type: 'TEST_API' }, punctuated.trustedSender),
    { ok: true, code: 'OK' }
  );

  const failure = harness({ apiResponse: '' });
  await failure.settle();
  assert.deepEqual(
    await failure.send({ type: 'TEST_API' }, failure.trustedSender),
    {
      ok: false,
      code: 'API_TEST_PROTOCOL_MISMATCH',
      error: '已连通，但模型未按约定回复 ok，请再试一次'
    }
  );
  assert.equal(failure.data.apiLastTestOk, false);

  const missingKey = harness({ initialData: { apiKey: '', dsKey: '' } });
  await missingKey.settle();
  assert.deepEqual(
    await missingKey.send({ type: 'TEST_API' }, missingKey.trustedSender),
    { ok: false, code: 'API_KEY_MISSING', error: '请先填写 API Key' }
  );
});

test('real background responses and LOG/BLOCKED/PHASE events never expose provider or credential canaries', async () => {
  const canaries = [
    'provider-raw-error-CANARY-f0d8',
    'provider-body-CANARY-94a7',
    'api-key-CANARY-380d',
    'webhook-token-CANARY-1d75',
    'signing-secret-CANARY-73b1'
  ];
  const h = harness({
    initialData: {
      apiKey: canaries[2],
      dsKey: canaries[2],
      feishuNotification: {
        enabled: true,
        webhook: `https://open.feishu.cn/open-apis/bot/v2/hook/${canaries[3]}`,
        signingSecret: canaries[4],
        lastTestOk: true,
        lastTestAt: Date.now()
      }
    },
    fetchFn: async () => {
      const error = new Error(`${canaries[0]}:${canaries[1]}`);
      error.responseBody = canaries[1];
      throw error;
    }
  });
  await h.settle();

  const response = await h.send({ type: 'TEST_API' }, h.trustedSender);
  const publicEvents = h.calls.runtimeMessages.filter((message) =>
    ['LOG', 'BLOCKED', 'PHASE'].includes(message && message.type)
  );
  const publicOutputs = JSON.stringify({
    response,
    runtimeMessages: h.calls.runtimeMessages,
    publicEvents
  });

  for (const canary of canaries) assert.equal(publicOutputs.includes(canary), false);
  assert.equal(response.ok, false);
});

test('TEST_API and SAVE_API_CONFIG obey both controller queue orders', async () => {
  {
    let markFetch;
    let releaseFetch;
    const fetchStarted = new Promise((resolve) => { markFetch = resolve; });
    const fetchGate = new Promise((resolve) => { releaseFetch = resolve; });
    const h = harness({
      async fetchFn() {
        markFetch();
        await fetchGate;
        return {
          ok: true,
          status: 200,
          async json() {
            return { choices: [{ message: { content: 'ok' } }] };
          }
        };
      }
    });
    await h.settle();
    h.calls.apiSave = 0;
    const tested = h.send({ type: 'TEST_API' }, h.trustedSender);
    await fetchStarted;
    const saved = h.send(apiSaveMessage(), h.trustedSender);
    await Promise.resolve();
    assert.equal(h.calls.apiSave, 0);
    releaseFetch();
    assert.deepEqual(await tested, { ok: true, code: 'OK' });
    assert.equal((await saved).ok, true);
    assert.equal(h.data.apiKey, 'rotated-key');
    assert.equal(h.data.apiLastTestOk, false);
  }

  {
    let markSave;
    let releaseSave;
    const saveStarted = new Promise((resolve) => { markSave = resolve; });
    const saveGate = new Promise((resolve) => { releaseSave = resolve; });
    const h = harness({
      async saveApiFn(api, apply) {
        markSave();
        await saveGate;
        return apply(api);
      }
    });
    await h.settle();
    h.calls.fetch = 0;
    const saved = h.send(apiSaveMessage(), h.trustedSender);
    await saveStarted;
    const tested = h.send({ type: 'TEST_API' }, h.trustedSender);
    await Promise.resolve();
    assert.equal(h.calls.fetch, 0);
    releaseSave();
    assert.equal((await saved).ok, true);
    assert.deepEqual(await tested, { ok: true, code: 'OK' });
    assert.equal(h.calls.fetch, 1);
    assert.equal(h.data.apiLastTestOk, true);
    assert.equal(h.data.apiLastTestVersion, h.data.apiConfigVersion);
  }
});

test('a late old TEST_API response cannot prove credentials rotated while the request was pending', async () => {
  let releaseFetch;
  let markStarted;
  const started = new Promise((resolve) => { markStarted = resolve; });
  const h = harness({
    fetchFn() {
      markStarted();
      return new Promise((resolve) => {
        releaseFetch = () => resolve({
          ok: true,
          status: 200,
          async json() {
            return { choices: [{ message: { content: 'ok' } }] };
          }
        });
      });
    }
  });
  await h.settle();

  const pending = h.send({ type: 'TEST_API' }, h.trustedSender);
  await started;
  await h.rotateApi({
    provider: 'openai_compatible',
    apiKey: 'new-key',
    baseUrl: 'https://api.example.com/v1/chat/completions'
  });
  releaseFetch();

  assert.deepEqual(await pending, { ok: false, code: 'API_TEST_STALE' });
  assert.equal(h.data.apiConfigVersion, 1);
  assert.equal(h.data.apiLastTestOk, false);
  assert.notEqual(h.data.apiLastTestVersion, h.data.apiConfigVersion);
});

test('API test version rejects ABA and a fresh test proves only the latest version', async () => {
  let releaseFirst;
  let fetchIndex = 0;
  const h = harness({
    fetchFn() {
      fetchIndex += 1;
      if (fetchIndex === 1) {
        return new Promise((resolve) => {
          releaseFirst = () => resolve({
            ok: true,
            status: 200,
            async json() {
              return { choices: [{ message: { content: 'ok' } }] };
            }
          });
        });
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        async json() {
          return { choices: [{ message: { content: 'ok' } }] };
        }
      });
    }
  });
  await h.settle();

  const old = h.send({ type: 'TEST_API' }, h.trustedSender);
  await h.settle();
  await h.rotateApi({ provider: 'deepseek', apiKey: 'key-b', baseUrl: '' });
  await h.rotateApi({ provider: 'deepseek', apiKey: 'api-key', baseUrl: '' });
  releaseFirst();
  assert.deepEqual(await old, { ok: false, code: 'API_TEST_STALE' });
  assert.equal(h.data.apiConfigVersion, 2);
  assert.equal(h.data.apiLastTestOk, false);

  assert.deepEqual(
    await h.send({ type: 'TEST_API' }, h.trustedSender),
    { ok: true, code: 'OK' }
  );
  assert.equal(h.data.apiLastTestOk, true);
  assert.equal(h.data.apiLastTestVersion, 2);
});

test('TEST_API is sidepanel-only, exact-key, init-fail-closed, and handles proof write failure', async () => {
  const untrusted = harness({
    initialData: { apiLastTestOk: false, apiLastTestAt: 0 }
  });
  await untrusted.settle();
  for (const sender of [
    { url: 'https://www.zhipin.com/web/geek/chat', tab: { id: 1 }, frameId: 0 },
    { url: untrusted.chrome.runtime.getURL('/src/options.html') },
    { url: untrusted.chrome.runtime.getURL('/src/sidepanel.html'), tab: { id: 1 } }
  ]) {
    assert.deepEqual(
      await untrusted.send({ type: 'TEST_API' }, sender),
      { ok: false, code: 'TRUSTEESHIP_UNAUTHORIZED' }
    );
  }
  assert.deepEqual(
    await untrusted.send({ type: 'TEST_API', extra: true }, untrusted.trustedSender),
    { ok: false, code: 'TRUSTEESHIP_MESSAGE_INVALID' }
  );
  assert.equal(untrusted.calls.fetch, 0);
  assert.equal(untrusted.data.apiLastTestOk, false);

  const failedWorker = harness({ initFailure: true });
  await failedWorker.settle();
  assert.deepEqual(
    await failedWorker.send({ type: 'TEST_API' }, failedWorker.trustedSender),
    { ok: false, code: 'SERVICE_WORKER_INTERRUPTED' }
  );
  assert.equal(failedWorker.calls.fetch, 0);

  const failedWrite = harness({ failApiProofWrite: true });
  await failedWrite.settle();
  assert.deepEqual(
    await failedWrite.send({ type: 'TEST_API' }, failedWrite.trustedSender),
    { ok: false, code: 'API_TEST_PERSIST_FAILED' }
  );
  assert.equal(failedWrite.calls.fetch, 1);
});

test('worker initialization failure persists fail-closed pause and blocks every runtime entry', async () => {
  const h = harness({ initFailure: true });
  await h.settle();
  h.calls.engineRun = 0;
  h.calls.engineResolve = 0;
  h.calls.readerRead = 0;
  h.calls.classifier = 0;
  h.calls.notifier = 0;
  h.calls.feishuSend = 0;

  assert.equal(
    h.calls.storeSettings.some((patch) =>
      patch.paused === true &&
      patch.pauseCode === 'SERVICE_WORKER_INTERRUPTED'
    ),
    true
  );
  assert.equal(h.calls.alarmsClear.includes('boss-ai-chat-monitor'), true);
  for (const message of [
    { type: 'TRUSTEESHIP_RUN_NOW' },
    { type: 'TRUSTEESHIP_TEST_FEISHU' },
    {
      type: 'TRUSTEESHIP_RESOLVE_APPROVAL',
      approvalId: 'approval-1',
      action: 'NO_REPLY'
    }
  ]) {
    assert.deepEqual(
      await h.send(message, h.trustedSender),
      { ok: false, code: 'SERVICE_WORKER_INTERRUPTED' }
    );
  }
  h.events.onAlarm.listeners[0]({ name: 'boss-ai-chat-monitor' });
  await h.settle();
  assert.equal(h.calls.engineRun, 0);
  assert.equal(h.calls.engineResolve, 0);
  assert.equal(h.calls.readerRead, 0);
  assert.equal(h.calls.classifier, 0);
  assert.equal(h.calls.notifier, 0);
  assert.equal(h.calls.feishuSend, 0);
});

test('onInstalled after init failure only clears alarm when pause persistence keeps failing', async () => {
  const h = harness({
    initFailure: true,
    pausePersistFailure: true,
    initialTrusteeshipEnabled: true
  });
  await h.settle();
  h.calls.alarmsCreate.length = 0;

  h.events.onInstalled.listeners[0]();
  await h.settle();

  assert.deepEqual(h.calls.alarmsCreate, []);
  assert.equal(h.calls.alarmsClear.includes('boss-ai-chat-monitor'), true);
});

test('onStartup after init failure only clears alarm when pause persistence keeps failing', async () => {
  const h = harness({
    initFailure: true,
    pausePersistFailure: true,
    initialTrusteeshipEnabled: true
  });
  await h.settle();
  h.calls.alarmsCreate.length = 0;

  h.events.onStartup.listeners[0]();
  await h.settle();

  assert.deepEqual(h.calls.alarmsCreate, []);
  assert.equal(h.calls.alarmsClear.includes('boss-ai-chat-monitor'), true);
});

test('API identity storage changes serialize controller invalidation and always clear the alarm', async () => {
  for (const apiPausePersistFailure of [false, true]) {
    const h = harness({
      initialTrusteeshipEnabled: true,
      apiPausePersistFailure
    });
    await h.settle();
    h.calls.controllerInvalidate = 0;
    h.calls.alarmsClear.length = 0;
    h.calls.alarmsCreate.length = 0;
    h.calls.storeSettings.length = 0;

    await h.rotateApi({
      provider: 'openai_compatible',
      apiKey: 'rotated-key',
      baseUrl: 'https://api.example.com/v1/chat/completions'
    });
    await h.settle();

    assert.equal(h.calls.controllerInvalidate, 1);
    assert.deepEqual(h.calls.alarmsCreate, []);
    assert.deepEqual(h.calls.alarmsClear, ['boss-ai-chat-monitor']);
    if (!apiPausePersistFailure) {
      assert.equal(h.snapshot.conversationTrusteeship.paused, true);
      assert.equal(h.snapshot.conversationTrusteeship.pauseCode, 'API_CONFIG_CHANGED');
    }
  }
});

test('API proof-only writes do not invalidate an otherwise stable trusteeship config', async () => {
  const h = harness({ apiResponse: 'ok' });
  await h.settle();
  h.calls.controllerInvalidate = 0;
  h.calls.alarmsClear.length = 0;

  assert.deepEqual(
    await h.send({ type: 'TEST_API' }, h.trustedSender),
    { ok: true, code: 'OK' }
  );
  await h.settle();

  assert.equal(h.calls.controllerInvalidate, 0);
  assert.deepEqual(h.calls.alarmsClear, []);
});

test('every protected external dependency blocks its next action after API rotation', async () => {
  const attempts = [
    {
      name: 'reader',
      run(h) {
        return h.protectedDependencies.reader.read(
          h.snapshot.managedConversations['conv-1']
        );
      },
      count(h) { return h.calls.tabsCreate; }
    },
    {
      name: 'classifier',
      run(h) {
        return h.protectedDependencies.classifier.classify({
          target: {},
          targetMessages: [],
          resumeFacts: []
        });
      },
      count(h) { return h.calls.fetch; }
    },
    {
      name: 'notifier',
      run(h) {
        return h.protectedDependencies.notifier.notifyApproval({
          approvalId: 'approval-1'
        });
      },
      count(h) { return h.calls.feishuSend; }
    },
    {
      name: 'sender',
      run(h) {
        return h.protectedDependencies.reader.send(
          h.snapshot.managedConversations['conv-1'],
          '好的',
          { intentId: 'intent-1' }
        );
      },
      count(h) { return h.calls.tabsCreate; }
    }
  ];

  for (const attempt of attempts) {
    const h = harness({ initialTrusteeshipEnabled: true });
    await h.settle();
    h.calls.tabsCreate = 0;
    h.calls.fetch = 0;
    h.calls.feishuSend = 0;
    await h.rotateApi({
      provider: 'deepseek',
      apiKey: 'rotated-key',
      baseUrl: ''
    });
    await h.settle();

    await assert.rejects(
      attempt.run(h),
      (error) => error && error.code === 'API_PROOF_STALE',
      attempt.name
    );
    assert.equal(attempt.count(h), 0, attempt.name);
  }
});

test('a real storage change event revokes a resolved classifier lease before fetch', async () => {
  const h = harness({ initialTrusteeshipEnabled: true });
  await h.settle();
  h.calls.fetch = 0;
  const load = h.deferNextConfigLoad();

  const classification = h.protectedDependencies.classifier.classify({
    target: {},
    targetMessages: [],
    resumeFacts: []
  });
  await load.started;
  load.release();
  await h.rotateApi({
    provider: 'deepseek',
    apiKey: 'rotated-key',
    baseUrl: ''
  });

  await assert.rejects(
    classification,
    (error) => error && error.code === 'API_PROOF_STALE'
  );
  assert.equal(h.calls.fetch, 0);
});

test('reader, notifier, and manual sender assert the same lease at their real side effects', async () => {
  const rotation = {
    provider: 'deepseek',
    apiKey: 'rotated-key',
    baseUrl: ''
  };

  {
    const h = harness({ initialTrusteeshipEnabled: true });
    await h.settle();
    h.calls.managedRead = 0;
    h.rotateOnNextTabsGet(rotation);
    await assert.rejects(
      h.protectedDependencies.reader.read(
        h.snapshot.managedConversations['conv-1']
      ),
      (error) => error && error.code === 'API_PROOF_STALE'
    );
    await h.settle();
    assert.equal(h.calls.managedRead, 0);
  }

  {
    const h = harness({ initialTrusteeshipEnabled: true });
    await h.settle();
    h.calls.feishuSend = 0;
    h.rotateOnNextSnapshot(rotation);
    await assert.rejects(
      h.protectedDependencies.notifier.notifyApproval({
        approvalId: 'approval-1'
      }),
      (error) => error && error.code === 'API_PROOF_STALE'
    );
    await h.settle();
    assert.equal(h.calls.feishuSend, 0);
  }

  {
    const h = harness({ initialTrusteeshipEnabled: true });
    await h.settle();
    Object.assign(h.snapshot.managedConversations['conv-1'], {
      enabled: true,
      state: 'SENDING',
      sendIntent: {
        intentId: 'intent-1',
        status: 'SENDING',
        draft: '好的'
      }
    });
    h.calls.managedSend = 0;
    h.rotateOnNextTabsGet(rotation);
    await assert.rejects(
      h.protectedDependencies.reader.send(
        h.snapshot.managedConversations['conv-1'],
        '好的',
        { intentId: 'intent-1' }
      ),
      (error) => error && error.code === 'API_PROOF_STALE'
    );
    await h.settle();
    assert.equal(h.calls.managedSend, 0);
  }
});

async function pendingApprovalCompositionHarness() {
  const signStarted = deferred();
  const releaseSign = deferred();
  const h = harness({
    actualNotificationComposition: true,
    initialTrusteeshipEnabled: true,
    initialData: {
      feishuNotification: {
        enabled: true,
        webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/test-token',
        signingSecret: 'test-signing-secret',
        lastTestOk: true,
        lastTestAt: Date.now()
      }
    },
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
      return {
        ok: true,
        async json() {
          return { code: 0 };
        }
      };
    }
  });
  await h.settle();
  await h.conversationStore.setManaged('conv-1', true);
  await h.conversationStore.beginMessage('conv-1', 'fp');
  const approval = await h.conversationStore.createOrMergeApproval({
    conversationId: 'conv-1',
    incomingFingerprint: 'fp',
    messages: ['A']
  });
  await h.conversationStore.saveSettings({ enabled: true });
  return { h, approval, signStarted, releaseSign };
}

async function rewriteActualSnapshot(h, update) {
  const stored = await h.storage.get([
    'conversationTrusteeship',
    'feishuNotification',
    'managedConversations',
    'pendingApprovals'
  ]);
  update(stored);
  await h.storage.set(stored);
}

for (const scenario of [
  {
    name: 'owner pause',
    async mutate(h, approval) {
      await h.conversationStore.pauseConversation(
        approval.conversationId,
        'TARGET_UNCERTAIN'
      );
    }
  },
  {
    name: 'approval unlink',
    async mutate(h, approval) {
      await h.conversationStore.resolveApprovalWithoutSend(approval.approvalId);
    }
  },
  {
    name: 'second pending approval',
    async mutate(h, approval) {
      await rewriteActualSnapshot(h, (snapshot) => {
        snapshot.pendingApprovals['approval-conflict'] = {
          ...structuredClone(snapshot.pendingApprovals[approval.approvalId]),
          approvalId: 'approval-conflict',
          createdAt: snapshot.pendingApprovals[approval.approvalId].createdAt + 1,
          updatedAt: snapshot.pendingApprovals[approval.approvalId].updatedAt + 1,
          feishuNotifyAttempts: []
        };
      });
    }
  },
  {
    name: 'global disable',
    async mutate(h) {
      await h.conversationStore.saveSettings({ enabled: false });
    }
  },
  {
    name: 'Feishu disable',
    async mutate(h) {
      await rewriteActualSnapshot(h, (snapshot) => {
        snapshot.feishuNotification.enabled = false;
      });
    }
  },
  {
    name: 'quiet hours begin',
    async mutate(h) {
      const now = new Date();
      const startHour = String(now.getHours()).padStart(2, '0');
      const endHour = String((now.getHours() + 1) % 24).padStart(2, '0');
      await h.conversationStore.saveSettings({
        quietHours: {
          enabled: true,
          start: `${startHour}:00`,
          end: `${endHour}:00`
        }
      });
    }
  }
]) {
  test(`real background composition blocks signed Feishu fetch when ${scenario.name} wins`, async () => {
    const { h, approval, signStarted, releaseSign } =
      await pendingApprovalCompositionHarness();
    h.calls.fetch = 0;

    const cycle = h.monitorEngine.runCycle();
    await signStarted.promise;
    await scenario.mutate(h, approval);
    releaseSign.resolve(new Uint8Array([1, 2, 3]).buffer);
    await cycle;

    assert.equal(h.calls.fetch, 0);
  });
}

test('real background composition dispatches one signed Feishu fetch while both leases remain current', async () => {
  const { h, signStarted, releaseSign } = await pendingApprovalCompositionHarness();
  h.calls.fetch = 0;

  const cycle = h.monitorEngine.runCycle();
  await signStarted.promise;
  releaseSign.resolve(new Uint8Array([1, 2, 3]).buffer);
  await cycle;

  assert.equal(h.calls.fetch, 1);
});

test('real background composition still blocks signed Feishu fetch after API proof rotation', async () => {
  const { h, signStarted, releaseSign } = await pendingApprovalCompositionHarness();
  h.calls.fetch = 0;

  const cycle = h.monitorEngine.runCycle();
  await signStarted.promise;
  await h.rotateApi({
    provider: 'deepseek',
    apiKey: 'rotated-key',
    baseUrl: ''
  });
  releaseSign.resolve(new Uint8Array([1, 2, 3]).buffer);
  await cycle;

  assert.equal(h.calls.fetch, 0);
});

test('real background protected resolved notifier preserves the caller final assertion', async () => {
  const { h, signStarted, releaseSign } = await pendingApprovalCompositionHarness();
  h.calls.fetch = 0;
  let assertionCalls = 0;

  const notification = h.protectedDependencies.notifier.notifyResolved({
    approvalId: 'approval-uuid',
    conversationId: 'conv-1',
    action: 'NO_REPLY'
  }, () => {
    assertionCalls += 1;
    if (assertionCalls === 1) return;
    const error = new Error('NOTIFICATION_NOT_ALLOWED');
    error.code = 'NOTIFICATION_NOT_ALLOWED';
    throw error;
  });
  await signStarted.promise;
  releaseSign.resolve(new Uint8Array([1, 2, 3]).buffer);
  await notification;

  assert.equal(assertionCalls, 2);
  assert.equal(h.calls.fetch, 0);
});

test('real background protected resolved notifier accepts a nonfunction caller assertion', async () => {
  const { h, signStarted, releaseSign } = await pendingApprovalCompositionHarness();
  h.calls.fetch = 0;

  const notification = h.protectedDependencies.notifier.notifyResolved({
    approvalId: 'approval-uuid',
    conversationId: 'conv-1',
    action: 'NO_REPLY'
  }, { ignored: true });
  await signStarted.promise;
  releaseSign.resolve(new Uint8Array([1, 2, 3]).buffer);
  await notification;

  assert.equal(h.calls.fetch, 1);
});

test('manual resolve is prerequisite-gated after rotation and never enters the engine', async () => {
  const h = harness({ initialTrusteeshipEnabled: true });
  await h.settle();
  h.calls.engineResolve = 0;
  await h.rotateApi({
    provider: 'deepseek',
    apiKey: 'rotated-key',
    baseUrl: ''
  });
  await h.settle();

  assert.deepEqual(
    await h.send({
      type: 'TRUSTEESHIP_RESOLVE_APPROVAL',
      approvalId: 'approval-1',
      action: 'NO_REPLY'
    }, h.trustedSender),
    {
      ok: false,
      code: 'TRUSTEESHIP_PREREQUISITE_FAILED',
      missing: ['api']
    }
  );
  assert.equal(h.calls.engineResolve, 0);
  assert.equal(h.calls.feishuSend, 0);
});

test('legacy START_DELIVER still fails closed with confirmation required', async () => {
  const h = harness();
  await h.settle();
  const result = await h.send({ type: 'START_DELIVER' }, {});
  assert.equal(result.ok, false);
  assert.equal(result.code, 'CONFIRMATION_REQUIRED');
});
