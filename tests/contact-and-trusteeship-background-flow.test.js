const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const root = path.resolve(__dirname, '..');
const backgroundSource = fs.readFileSync(
  path.join(root, 'src/background.js'),
  'utf8'
);
const DeliveryGuard = require('../src/delivery-guard.js');
const ConversationRegistration = require(
  '../src/conversation/conversation-registration.js'
);

function event() {
  return {
    listeners: [],
    addListener(listener) {
      this.listeners.push(listener);
    }
  };
}

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function createHarness(options = {}) {
  const calls = {
    recordContact: [],
    registerConversation: [],
    tabMessages: [],
    runtimeMessages: []
  };
  const initialUrl =
    'https://www.zhipin.com/web/geek/jobs?query=%E8%BF%90%E8%90%A5&city=101210100';
  const chatUrl =
    'https://www.zhipin.com/web/geek/chat?uid=canonical-peer-1';
  const job = {
    id: 'job-1',
    platform: 'boss',
    name: '跨境电商运营专员',
    company: '测试公司',
    hrName: '王女士',
    url: 'https://www.zhipin.com/job_detail/job-1.html'
  };
  const config = {
    activePlatform: 'boss',
    city: '杭州',
    processed: {},
    dailyLimit: '20',
    intervalMinSec: '5',
    intervalMaxSec: '6',
    batchSize: '5',
    batchRestMinSec: '0',
    batchRestMaxSec: '0',
    greetingTemplate: '您好，我对{jobName}很感兴趣，方便聊聊吗？',
    resumeImage: ''
  };
  const data = {
    sw_jobs: [job],
    sw_greetings: {},
    sw_platform: 'boss'
  };
  const onMessage = event();
  const onAlarm = event();
  const onInstalled = event();
  const onStartup = event();
  const onStorageChanged = event();
  let tab = { id: 7, url: initialUrl, status: 'complete' };
  let usageCount = 0;
  let clock = 2_000_000_000_000;

  class FastDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [clock]));
    }

    static now() {
      clock += 1000;
      return clock;
    }
  }

  const storage = {
    async get(keys) {
      if (keys === null || keys === undefined) return clone(data);
      if (typeof keys === 'object' && !Array.isArray(keys)) {
        const result = clone(keys);
        Object.keys(keys).forEach((key) => {
          if (Object.prototype.hasOwnProperty.call(data, key)) {
            result[key] = clone(data[key]);
          }
        });
        return result;
      }
      const result = {};
      (Array.isArray(keys) ? keys : [keys]).forEach((key) => {
        result[key] = clone(data[key]);
      });
      return result;
    },
    async set(patch) {
      const changes = {};
      Object.keys(patch).forEach((key) => {
        changes[key] = {
          oldValue: clone(data[key]),
          newValue: clone(patch[key])
        };
        data[key] = clone(patch[key]);
      });
      onStorageChanged.listeners.forEach((listener) => {
        listener(changes, 'local');
      });
    }
  };

  const conversationStore = {
    async registerConversation(record) {
      calls.registerConversation.push(clone(record));
      return {
        ...clone(record),
        enabled: record.enabled === true,
        state: record.enabled === true ? 'WAITING_HR' : 'DISABLED'
      };
    },
    async getSnapshot() {
      return {
        conversationTrusteeship: { enabled: true, paused: false },
        feishuNotification: {},
        managedConversations: {},
        pendingApprovals: {}
      };
    }
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
        return 'chrome-extension://extension-id/' +
          String(relative).replace(/^\/+/, '');
      },
      sendMessage(message) {
        calls.runtimeMessages.push(clone(message));
        return Promise.resolve();
      },
      getContexts() {
        return Promise.resolve([]);
      }
    },
    alarms: {
      onAlarm,
      clear() {
        return Promise.resolve(true);
      },
      create() {
        return Promise.resolve();
      }
    },
    tabs: {
      async query() {
        return [clone(tab)];
      },
      async update(id, update) {
        tab = { ...tab, ...clone(update), id, status: 'complete' };
        return clone(tab);
      },
      async create(createOptions) {
        tab = { id: 7, status: 'complete', ...clone(createOptions) };
        return clone(tab);
      },
      async get() {
        return clone(tab);
      },
      sendMessage(id, message, callback) {
        calls.tabMessages.push(clone(message));
        let response;
        if (message.type === 'PING') {
          response = {
            ok: true,
            page: tab.url.includes('/web/geek/chat') ? 'chat' : 'search'
          };
        } else if (message.type === 'OPEN_JD') {
          response = { success: true, jd: '负责跨境电商平台运营。' };
        } else if (message.type === 'GO_CHAT') {
          if (options.navigateToChat === true) {
            tab = { ...tab, url: chatUrl, status: 'complete' };
          }
          if (options.goChatRuntimeError) {
            chrome.runtime.lastError = {
              message: options.goChatRuntimeError
            };
            callback(undefined);
            chrome.runtime.lastError = null;
            return;
          }
          response = clone(options.goChatResponse);
        } else if (message.type === 'SEND_ACTIVE') {
          response = clone(options.sendActiveResponse);
        } else if (message.type === 'CAPTURE_CONTACTED_CONVERSATION') {
          response = clone(options.captureContactedResponse);
        } else {
          response = { success: false, error: 'unexpected message' };
        }
        callback(response);
      }
    },
    scripting: {
      async executeScript() {
        return [];
      }
    },
    sidePanel: {
      setPanelBehavior() {
        return Promise.resolve();
      }
    },
    offscreen: {
      createDocument() {
        return Promise.resolve();
      },
      closeDocument() {
        return Promise.resolve();
      }
    }
  };

  const runStore = {
    async recoverInterrupted() {
      return null;
    },
    async current() {
      return null;
    },
    async start(fields) {
      return { id: 'run-1', ...clone(fields) };
    },
    async patch() {
      return null;
    },
    async finish() {
      return null;
    }
  };
  const controller = {
    async checkPrerequisites() {
      return { ok: true };
    },
    async reconcileAlarm() {
      return { enabled: true };
    },
    async failClosed() {
      return { ok: true };
    },
    async invalidateApiProof() {
      return { ok: true };
    },
    async runScheduledCycle() {
      return { ok: true };
    },
    async handleMessage() {
      return { ok: true };
    }
  };

  const context = {
    console,
    chrome,
    importScripts() {},
    URL,
    Date: FastDate,
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
    structuredClone,
    setTimeout,
    clearTimeout,
    crypto: {
      randomUUID() {
        return 'uuid';
      },
      subtle: {}
    },
    fetch: async () => ({
      ok: true,
      status: 200,
      async json() {
        return { choices: [{ message: { content: 'ok' } }] };
      },
      async text() {
        return '';
      }
    }),
    SearchFilters: {
      createCityCatalogResolver() {
        return {
          async resolve() {
            return { found: true, name: '杭州', code: '101210100' };
          }
        };
      }
    },
    JobDescription: {
      promptText() {
        return '';
      },
      keywordScreen() {
        return { match: true, reason: 'ok', score: 80 };
      },
      requireDescriptionForAi(result) {
        return result;
      }
    },
    getPlatform() {
      return {
        id: 'boss',
        short: 'Boss',
        ready: true,
        tabQuery: '*://*.zhipin.com/*',
        searchScript: 'src/platform/boss/content-search.js',
        chatScript: 'src/platform/boss/content-chat.js',
        selectorsFile: 'src/platform/boss/selectors.js',
        chatPathHint: '/web/geek/chat',
        actionWord: '立即沟通',
        loginHint: '请登录 Boss',
        buildSearchUrl() {
          return initialUrl;
        }
      };
    },
    PlatformConfig: {
      ensureMigrated() {
        return Promise.resolve();
      },
      loadFlat() {
        return Promise.resolve({ ...clone(config), processed: clone(config.processed) });
      },
      loadFlatFor() {
        return this.loadFlat();
      },
      getUsage() {
        return { count: usageCount, limit: 20 };
      },
      async recordContact(platformId, jobId) {
        calls.recordContact.push({ platformId, jobId });
        usageCount += 1;
        config.processed[jobId] = true;
        return {
          added: true,
          count: usageCount,
          limit: 20,
          processed: clone(config.processed)
        };
      },
      setProcessed() {
        return Promise.resolve();
      },
      saveApi() {
        return Promise.resolve();
      }
    },
    Humanize: {},
    GreetingTemplate: {
      renderGreetingTemplate() {
        return '您好，我对这个岗位很感兴趣，方便聊聊吗？';
      }
    },
    RunSafety: {
      checkpoint() {},
      isRunStop() {
        return false;
      },
      waitCancellable() {
        return Promise.resolve(0);
      },
      snapshotRunConfig(value) {
        return clone(value);
      },
      validateJobPlatform() {
        return true;
      }
    },
    RunStore: {
      createRunStore() {
        return runStore;
      }
    },
    DeliveryGuard,
    TrusteeshipPolicy: {
      normalizeSettings(value) {
        return value || {};
      }
    },
    ConversationStore: {
      create() {
        return conversationStore;
      }
    },
    ConversationRegistration,
    ReplyAI: {},
    FeishuNotifier: {
      create() {
        return {};
      },
      validateConfig() {
        return true;
      },
      buildApprovalCard() {
        return {};
      }
    },
    BossConversationReader: {},
    MonitorEngine: {
      create() {
        return {
          async runCycle() {
            return { checked: 0, errors: [] };
          },
          async resolveApproval() {
            return { ok: true };
          }
        };
      }
    },
    TrusteeshipLiveDrill: {
      create() {
        return {
          async stage() {
            return { ok: true };
          }
        };
      }
    },
    TrusteeshipRuntime: {
      createPageAdapter() {
        return { read() {}, send() {} };
      },
      createClassifier() {
        return { classify() {}, draft() {} };
      },
      createNotifier() {
        return { notifyApproval() {}, notifyResolved() {} };
      },
      createResumeFacts() {
        return async () => ({});
      },
      createController() {
        return controller;
      },
      validateUserMessage() {
        return true;
      },
      validateApiConfigMessage() {
        return true;
      }
    }
  };
  context.globalThis = context;
  context.self = context;

  vm.runInNewContext(
    backgroundSource +
      '\n;globalThis.__deliveryFlowTestApi = {' +
      'runDeliver: runDeliver,' +
      'state: function () { return JSON.parse(JSON.stringify(state)); }' +
      '};',
    context,
    { filename: 'src/background.js' }
  );

  return {
    calls,
    async settle() {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
    async run(deliveryMode = 'CONTACT_AND_TRUSTEESHIP') {
      await context.__deliveryFlowTestApi.runDeliver(
        ['job-1'],
        { deliveryMode }
      );
      return context.__deliveryFlowTestApi.state();
    }
  };
}

test(
  'CONTACT_ONLY does not commit contact when GO_CHAT never navigates away from jobs',
  async () => {
    const h = createHarness({
      goChatResponse: { success: true, navigated: false },
      navigateToChat: false
    });
    await h.settle();

    const state = await h.run('CONTACT_ONLY');

    assert.equal(
      h.calls.recordContact.length,
      0,
      '仅联系模式也必须等聊天页导航得到确认后，才能占用日限或写入去重'
    );
    assert.equal(h.calls.registerConversation.length, 0);
    assert.equal(state.results[0].ok, false);
  }
);

test(
  'CONTACT_ONLY does not treat a missing receiving end as successful navigation',
  async () => {
    const h = createHarness({
      goChatRuntimeError:
        'Could not establish connection. Receiving end does not exist.',
      navigateToChat: false
    });
    await h.settle();

    const state = await h.run('CONTACT_ONLY');

    assert.equal(
      h.calls.recordContact.length,
      0,
      'GO_CHAT 未送达内容脚本时不能占用日限或写入去重'
    );
    assert.equal(h.calls.registerConversation.length, 0);
    assert.equal(state.results[0].ok, false);
  }
);

test(
  'CONTACT_ONLY succeeds after confirmed navigation without enabling trusteeship',
  async () => {
    const h = createHarness({
      goChatResponse: { success: true, navigated: true },
      navigateToChat: true,
      sendActiveResponse: {
        success: true,
        conversationRef: {
          conversationId: 'canonical-peer-1',
          url: 'https://www.zhipin.com/web/geek/chat?uid=canonical-peer-1',
          aliases: ['legacy-peer-1'],
          peerUid: 'canonical-peer-1'
        },
        baselineIncomingFingerprint: 'id:baseline-1',
        company: '测试公司',
        position: '跨境电商运营专员',
        hrName: '王女士'
      }
    });
    await h.settle();

    const state = await h.run('CONTACT_ONLY');

    assert.equal(h.calls.recordContact.length, 1);
    assert.equal(h.calls.registerConversation.length, 1);
    assert.equal(
      h.calls.registerConversation.some((record) => record.enabled === true),
      false,
      '仅联系模式可自动登记会话，但绝不能开启 AI 托管'
    );
    assert.equal(h.calls.registerConversation[0].enabled, false);
    assert.equal(state.results[0].ok, true);
    assert.equal(
      Object.prototype.hasOwnProperty.call(
        state.results[0],
        'trusteeshipOk'
      ),
      false
    );
  }
);

test(
  'CONTACT_ONLY captures an already-contacted Boss conversation without sending a duplicate greeting',
  async () => {
    const h = createHarness({
      goChatResponse: {
        success: true,
        navigated: true,
        contactConfirmed: true
      },
      navigateToChat: true,
      captureContactedResponse: {
        success: true,
        conversationRef: {
          conversationId: 'canonical-peer-1',
          url: 'https://www.zhipin.com/web/geek/chat?uid=canonical-peer-1',
          aliases: ['legacy-peer-1'],
          peerUid: '100'
        },
        baselineIncomingFingerprint: '',
        company: '测试公司',
        position: '跨境电商运营专员',
        hrName: '王女士'
      },
      sendActiveResponse: {
        success: false,
        error: 'SEND_ACTIVE must not be called after contact confirmation'
      }
    });
    await h.settle();

    const state = await h.run('CONTACT_ONLY');
    const types = h.calls.tabMessages.map((message) => message.type);

    assert.equal(
      types.filter((type) => type === 'CAPTURE_CONTACTED_CONVERSATION').length,
      1
    );
    assert.equal(
      types.filter((type) => type === 'SEND_ACTIVE').length,
      0,
      'BOSS 已发送首条招呼后，后台不得再次写入聊天输入框'
    );
    assert.equal(h.calls.registerConversation.length, 1);
    assert.equal(h.calls.registerConversation[0].enabled, false);
    assert.equal(state.results[0].ok, true);
  }
);

test(
  'CONTACT_AND_TRUSTEESHIP does not commit contact when GO_CHAT never navigates away from jobs',
  async () => {
    const h = createHarness({
      goChatResponse: { success: true, navigated: false },
      navigateToChat: false
    });
    await h.settle();

    const state = await h.run();

    assert.equal(
      h.calls.recordContact.length,
      0,
      '未确认弹窗且仍停留 jobs 页时，不能占用日限或写入已联系去重'
    );
    assert.equal(h.calls.registerConversation.length, 0);
    assert.equal(state.results[0].ok, false);
  }
);

test(
  'CONTACT_AND_TRUSTEESHIP captures an already-contacted Boss conversation and enables trusteeship without a duplicate greeting',
  async () => {
    const h = createHarness({
      goChatResponse: {
        success: true,
        navigated: true,
        contactConfirmed: true
      },
      navigateToChat: true,
      captureContactedResponse: {
        success: true,
        conversationRef: {
          conversationId: 'canonical-peer-1',
          url: 'https://www.zhipin.com/web/geek/chat?uid=canonical-peer-1',
          aliases: ['legacy-peer-1'],
          peerUid: '100'
        },
        baselineIncomingFingerprint: '',
        company: '测试公司',
        position: '跨境电商运营专员',
        hrName: '王女士'
      },
      sendActiveResponse: {
        success: false,
        error: 'SEND_ACTIVE must not be called after contact confirmation'
      }
    });
    await h.settle();

    const state = await h.run();
    const types = h.calls.tabMessages.map((message) => message.type);

    assert.equal(
      types.filter((type) => type === 'CAPTURE_CONTACTED_CONVERSATION').length,
      1
    );
    assert.equal(types.filter((type) => type === 'SEND_ACTIVE').length, 0);
    assert.equal(h.calls.recordContact.length, 1);
    assert.equal(h.calls.registerConversation.length, 1);
    assert.equal(h.calls.registerConversation[0].enabled, true);
    assert.equal(state.results[0].ok, true);
    assert.equal(state.results[0].trusteeshipOk, true);
  }
);

test(
  'Boss navigation channel close uses read-only capture and never replays the greeting',
  async () => {
    const h = createHarness({
      goChatRuntimeError:
        'The message port closed before a response was received.',
      navigateToChat: true,
      captureContactedResponse: {
        success: true,
        conversationRef: {
          conversationId: 'canonical-peer-1',
          url: 'https://www.zhipin.com/web/geek/chat?uid=canonical-peer-1',
          aliases: ['legacy-peer-1'],
          peerUid: '100'
        },
        baselineIncomingFingerprint: '',
        company: '测试公司',
        position: '跨境电商运营专员',
        hrName: '王女士'
      }
    });
    await h.settle();

    const state = await h.run();
    const types = h.calls.tabMessages.map((message) => message.type);

    assert.equal(types.filter((type) => type === 'SEND_ACTIVE').length, 0);
    assert.equal(
      types.filter((type) => type === 'CAPTURE_CONTACTED_CONVERSATION').length,
      1
    );
    assert.equal(h.calls.registerConversation.length, 1);
    assert.equal(h.calls.registerConversation[0].enabled, true);
    assert.equal(state.results[0].ok, true);
  }
);

test(
  'confirmed Boss contact remains successful when read-only trusteeship capture fails and never falls back to sending',
  async () => {
    const h = createHarness({
      goChatResponse: {
        success: true,
        navigated: true,
        contactConfirmed: true
      },
      navigateToChat: true,
      captureContactedResponse: {
        success: false,
        targetUncertain: true,
        errorCode: 'TARGET_UNCERTAIN',
        error: '无法确认登记身份'
      },
      sendActiveResponse: {
        success: false,
        error: 'SEND_ACTIVE fallback is forbidden'
      }
    });
    await h.settle();

    const state = await h.run();
    const types = h.calls.tabMessages.map((message) => message.type);

    assert.equal(types.filter((type) => type === 'SEND_ACTIVE').length, 0);
    assert.equal(h.calls.recordContact.length, 1);
    assert.equal(h.calls.registerConversation.length, 0);
    assert.equal(state.blocked, false);
    assert.equal(state.results[0].ok, true);
    assert.equal(state.results[0].trusteeshipOk, false);
  }
);

test(
  'CONTACT_AND_TRUSTEESHIP does not register when the extension context is invalidated before GO_CHAT',
  async () => {
    const h = createHarness({
      goChatRuntimeError: 'Extension context invalidated.',
      navigateToChat: false
    });
    await h.settle();

    const state = await h.run();

    assert.equal(h.calls.recordContact.length, 0);
    assert.equal(h.calls.registerConversation.length, 0);
    assert.equal(state.results[0].ok, false);
  }
);

test(
  'CONTACT_AND_TRUSTEESHIP registers enabled canonical conversation after confirmed navigation and send',
  async () => {
    const h = createHarness({
      goChatResponse: { success: true, navigated: true },
      navigateToChat: true,
      sendActiveResponse: {
        success: true,
        conversationRef: {
          conversationId: 'canonical-peer-1',
          url: 'https://www.zhipin.com/web/geek/chat?uid=canonical-peer-1',
          aliases: ['legacy-peer-1'],
          peerUid: 'canonical-peer-1'
        },
        baselineIncomingFingerprint: 'id:baseline-1',
        company: '测试公司',
        position: '跨境电商运营专员',
        hrName: '王女士'
      }
    });
    await h.settle();

    const state = await h.run();

    assert.equal(h.calls.recordContact.length, 1);
    assert.equal(h.calls.registerConversation.length, 1);
    assert.equal(h.calls.registerConversation[0].enabled, true);
    assert.equal(
      h.calls.registerConversation[0].conversationId,
      'canonical-peer-1'
    );
    assert.equal(
      h.calls.registerConversation[0].url,
      'https://www.zhipin.com/web/geek/chat?uid=canonical-peer-1'
    );
    assert.equal(
      h.calls.registerConversation[0].initialIncomingFingerprint,
      'id:baseline-1'
    );
    assert.equal(state.results[0].ok, true);
    assert.equal(state.results[0].trusteeshipOk, true);
  }
);
