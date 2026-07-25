// MV3 对话托管组合助手：只接受依赖注入，页面与网络副作用保持在后台单例边界。
(function (g, factory) {
  var api = factory();
  g.TrusteeshipRuntime = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  var TRUSTEESHIP_ALARM = 'boss-ai-chat-monitor';
  var ALLOWED_INTERVALS = [5, 10, 15];
  var RECENT_TEST_MS = 24 * 60 * 60 * 1000;
  var CONTENT_FILES = [
    'src/platform/boss/selectors.js',
    'src/humanize.js',
    'src/message-send.js',
    'src/platform/boss/peer-identity.js',
    'src/platform/boss/conversation-reader.js',
    'src/platform/boss/content-chat.js'
  ];
  var READER_CODES = [
    'LOGIN_REQUIRED',
    'BOSS_BLOCKED',
    'TARGET_UNCERTAIN',
    'SELECTOR_UNAVAILABLE',
    'PEER_ID_UNRESOLVED',
    'PEER_LIST_UNAVAILABLE'
  ];
  var RESOLVE_CODES = [
    'SEND_RESULT_UNKNOWN', 'CONVERSATION_NOT_REGISTERED', 'TARGET_UNCERTAIN',
    'CONVERSATION_UNAVAILABLE', 'LOGIN_REQUIRED', 'BOSS_BLOCKED',
    'TRUSTEESHIP_RESOLVE_FAILED', 'TRUSTEESHIP_PREREQUISITE_FAILED'
  ];
  var PUBLIC_PAUSE_CODES = new Set([
    'LOGIN_REQUIRED',
    'BOSS_BLOCKED',
    'SERVICE_WORKER_INTERRUPTED',
    'PREREQUISITE_CHANGED',
    'API_CONFIG_CHANGED',
    'TARGET_UNCERTAIN',
    'SELECTOR_UNAVAILABLE',
    'SEND_RESULT_UNKNOWN',
    'MESSAGE_ORDER_UNCERTAIN',
    'CONVERSATION_UNAVAILABLE',
    'RECOVERY_STATE_UNCERTAIN',
    'UNKNOWN_PROCESSING_FAILURE'
  ]);

  function clone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function codePointSlice(value, limit) {
    return Array.from(value).slice(0, limit).join('');
  }

  function safeError(code) {
    return { ok: false, code: code };
  }

  function safePauseCode(value) {
    if (typeof value !== 'string' || value === '') return '';
    return PUBLIC_PAUSE_CODES.has(value) ? value : 'UNKNOWN_PROCESSING_FAILURE';
  }

  function safePauseReason(pauseCode) {
    return safePauseCode(pauseCode) === 'SEND_RESULT_UNKNOWN'
      ? 'SEND_RESULT_UNKNOWN'
      : '';
  }

  function safeSettings(value) {
    var source = isPlainObject(value) ? value : {};
    var quiet = isPlainObject(source.quietHours) ? source.quietHours : {};
    var interval = ALLOWED_INTERVALS.indexOf(source.intervalMinutes) !== -1
      ? source.intervalMinutes
      : 10;
    var dailyLimit = Number.isSafeInteger(source.dailyAutoReplyLimit) &&
      source.dailyAutoReplyLimit >= 1 &&
      source.dailyAutoReplyLimit <= 20
      ? source.dailyAutoReplyLimit
      : 10;
    var pauseCode = safePauseCode(source.pauseCode);
    return {
      enabled: source.enabled === true,
      intervalMinutes: interval,
      dailyAutoReplyLimit: dailyLimit,
      autoReplyDay: typeof source.autoReplyDay === 'string' &&
        /^\d{4}-\d{2}-\d{2}$/.test(source.autoReplyDay)
        ? source.autoReplyDay
        : '',
      autoReplyCount: Number.isSafeInteger(source.autoReplyCount) &&
        source.autoReplyCount >= 0
        ? source.autoReplyCount
        : 0,
      quietHours: {
        enabled: quiet.enabled === true,
        start: typeof quiet.start === 'string' &&
          /^([01]\d|2[0-3]):[0-5]\d$/.test(quiet.start)
          ? quiet.start
          : '22:00',
        end: typeof quiet.end === 'string' &&
          /^([01]\d|2[0-3]):[0-5]\d$/.test(quiet.end)
          ? quiet.end
          : '08:00'
      },
      monitorCursor: Number.isSafeInteger(source.monitorCursor) &&
        source.monitorCursor >= 0
        ? source.monitorCursor
        : 0,
      paused: source.paused === true,
      pauseCode: pauseCode,
      pauseReason: safePauseReason(pauseCode)
    };
  }

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function callChrome(chromeApi, owner, methodName, args) {
    return new Promise(function (resolve, reject) {
      var method = owner && owner[methodName];
      if (typeof method !== 'function') {
        reject(new Error('CHROME_API_FAILED'));
        return;
      }
      var settled = false;
      function finish(error, value) {
        if (settled) return;
        settled = true;
        if (error) reject(error);
        else resolve(value);
      }
      function callback(value) {
        var lastError = null;
        try {
          lastError = chromeApi.runtime && chromeApi.runtime.lastError;
        } catch (_) {}
        if (lastError) {
          finish(new Error('CHROME_API_FAILED'));
          return;
        }
        finish(null, value);
      }
      var returned;
      try {
        returned = method.apply(owner, args.concat(callback));
      } catch (_) {
        finish(new Error('CHROME_API_FAILED'));
        return;
      }
      if (returned && typeof returned.then === 'function') {
        returned.then(function (value) {
          finish(null, value);
        }, function () {
          finish(new Error('CHROME_API_FAILED'));
        });
        return;
      }
      if (returned !== undefined) finish(null, returned);
    });
  }

  function exactKeys(value, allowed) {
    if (!isPlainObject(value)) return false;
    var keys = Object.keys(value);
    return keys.length <= allowed.length && keys.every(function (key) {
      return allowed.indexOf(key) !== -1;
    });
  }

  function boundedString(value, limit, allowEmpty) {
    return typeof value === 'string' &&
      (allowEmpty === true || value.length > 0) &&
      Array.from(value).length <= limit;
  }

  var HR_FAQ_MAX_ITEMS = 20;
  var HR_FAQ_QUESTION_LIMIT = 200;
  var HR_FAQ_ANSWER_LIMIT = 600;

  function normalizeHrFaq(value) {
    if (!Array.isArray(value)) return [];
    var out = [];
    value.slice(0, HR_FAQ_MAX_ITEMS).forEach(function (item) {
      if (!isPlainObject(item)) return;
      var question = typeof item.question === 'string'
        ? codePointSlice(item.question.trim(), HR_FAQ_QUESTION_LIMIT)
        : '';
      var answer = typeof item.answer === 'string'
        ? codePointSlice(item.answer.trim(), HR_FAQ_ANSWER_LIMIT)
        : '';
      if (!question && !answer) return;
      out.push({ question: question, answer: answer });
    });
    return out;
  }

  function hasUsableHrFaq(value) {
    return normalizeHrFaq(value).some(function (item) {
      return item.question !== '' && item.answer !== '';
    });
  }

  function validateHrFaq(value) {
    if (value === undefined) return true;
    if (!Array.isArray(value) || value.length > HR_FAQ_MAX_ITEMS) return false;
    return value.every(function (item) {
      return exactKeys(item, ['question', 'answer']) &&
        boundedString(item.question, HR_FAQ_QUESTION_LIMIT, true) &&
        boundedString(item.answer, HR_FAQ_ANSWER_LIMIT, true);
    });
  }

  function validateUserMessage(message) {
    if (!isPlainObject(message) || typeof message.type !== 'string') return false;
    if (message.type === 'TRUSTEESHIP_GET_STATE' ||
      message.type === 'TRUSTEESHIP_TEST_FEISHU' ||
      message.type === 'TRUSTEESHIP_LIST_APPROVALS' ||
      message.type === 'TRUSTEESHIP_RUN_NOW') {
      return exactKeys(message, ['type']);
    }
    if (message.type === 'TRUSTEESHIP_REGISTER_ACTIVE') {
      return exactKeys(message, ['type', 'enable']) &&
        typeof message.enable === 'boolean';
    }
    if (message.type === 'TRUSTEESHIP_SET_CONVERSATION') {
      return exactKeys(message, ['type', 'conversationId', 'enabled']) &&
        boundedString(message.conversationId, 128, false) &&
        typeof message.enabled === 'boolean';
    }
    if (message.type === 'TRUSTEESHIP_REMOVE_CONVERSATION') {
      return exactKeys(message, ['type', 'conversationId']) &&
        boundedString(message.conversationId, 128, false);
    }
    if (message.type === 'TRUSTEESHIP_OPEN_CONVERSATION') {
      return exactKeys(message, ['type', 'conversationId']) &&
        boundedString(message.conversationId, 128, false);
    }
    if (message.type === 'TRUSTEESHIP_RESOLVE_APPROVAL') {
      return exactKeys(message, ['type', 'approvalId', 'action', 'draft']) &&
        boundedString(message.approvalId, 128, false) &&
        ['SEND_EDITED', 'NO_REPLY', 'DISABLE_CONVERSATION'].indexOf(message.action) !== -1 &&
        (message.draft === undefined || boundedString(message.draft, 300, true));
    }
    if (message.type === 'TRUSTEESHIP_SAVE_SETTINGS') {
      if (!exactKeys(message, ['type', 'settings', 'feishuNotification', 'hrFaq'])) return false;
      if (message.settings !== undefined) {
        if (!exactKeys(message.settings, [
          'enabled',
          'intervalMinutes',
          'dailyAutoReplyLimit',
          'quietHours'
        ])) return false;
        if (message.settings.enabled !== undefined &&
          typeof message.settings.enabled !== 'boolean') return false;
        if (message.settings.intervalMinutes !== undefined &&
          !Number.isFinite(message.settings.intervalMinutes)) return false;
        if (message.settings.dailyAutoReplyLimit !== undefined &&
          !Number.isFinite(message.settings.dailyAutoReplyLimit)) return false;
        if (message.settings.quietHours !== undefined) {
          var quiet = message.settings.quietHours;
          if (!exactKeys(quiet, ['enabled', 'start', 'end']) ||
            (quiet.enabled !== undefined && typeof quiet.enabled !== 'boolean') ||
            (quiet.start !== undefined && !boundedString(quiet.start, 5, false)) ||
            (quiet.end !== undefined && !boundedString(quiet.end, 5, false))) {
            return false;
          }
        }
      }
      if (message.feishuNotification !== undefined) {
        var feishu = message.feishuNotification;
        if (!exactKeys(feishu, ['enabled', 'webhook', 'signingSecret']) ||
          (feishu.enabled !== undefined && typeof feishu.enabled !== 'boolean') ||
          (feishu.webhook !== undefined && !boundedString(feishu.webhook, 2048, true)) ||
          (feishu.signingSecret !== undefined &&
            !boundedString(feishu.signingSecret, 512, true))) {
          return false;
        }
      }
      if (!validateHrFaq(message.hrFaq)) return false;
      return message.settings !== undefined ||
        message.feishuNotification !== undefined ||
        message.hrFaq !== undefined;
    }
    return false;
  }

  function validateApiConfigMessage(message) {
    if (!isPlainObject(message) ||
      Object.keys(message).length !== 2 ||
      message.type !== 'SAVE_API_CONFIG' ||
      !isPlainObject(message.config) ||
      Object.keys(message.config).length !== 4) {
      return false;
    }
    var config = message.config;
    return exactKeys(config, ['provider', 'apiKey', 'baseUrl', 'resumeText']) &&
      ['deepseek', 'openai_compatible'].indexOf(config.provider) !== -1 &&
      boundedString(config.apiKey, 4096, true) &&
      boundedString(config.baseUrl, 2048, true) &&
      boundedString(config.resumeText, 100000, true);
  }

  function safeConversationUrl(value, conversationId) {
    if (typeof value !== 'string' || typeof conversationId !== 'string' ||
      !/^[A-Za-z0-9_~-]{1,128}$/.test(conversationId)) return '';
    try {
      var parsed = new URL(value);
      var entries = Array.from(parsed.searchParams.entries());
      if (parsed.href !== value ||
        parsed.protocol !== 'https:' ||
        parsed.username ||
        parsed.password ||
        parsed.port ||
        parsed.hash ||
        parsed.hostname === 'zhipin.com' ||
        !parsed.hostname.endsWith('.zhipin.com') ||
        parsed.pathname !== '/web/geek/chat' ||
        entries.length !== 1 ||
        (entries[0][0] !== 'conversationId' && entries[0][0] !== 'uid') ||
        entries[0][1] !== conversationId) {
        return '';
      }
      return parsed.href;
    } catch (_) {
      return '';
    }
  }

  function isBossChatTabUrl(value) {
    if (typeof value !== 'string') return false;
    try {
      var parsed = new URL(value);
      return parsed.protocol === 'https:' &&
        !parsed.username &&
        !parsed.password &&
        !parsed.port &&
        parsed.hostname !== 'zhipin.com' &&
        parsed.hostname.endsWith('.zhipin.com') &&
        (parsed.pathname === '/web/geek/chat' || parsed.pathname === '/web/geek/chat/');
    } catch (_) {
      return false;
    }
  }

  function expectedIdentity(conversation) {
    return {
      id: conversation.jobId || '',
      name: conversation.position || '',
      company: conversation.company || '',
      hrName: conversation.hrName || ''
    };
  }

  function mappedReaderFailure(result, fallback) {
    var code = result && READER_CODES.indexOf(result.errorCode) !== -1
      ? result.errorCode
      : fallback;
    return { success: false, errorCode: code };
  }

  function assertLeaseCurrent(assertLease, snapshot) {
    if (typeof assertLease === 'function') assertLease(snapshot);
  }

  function defaultWaitForTabComplete(chromeApi, tabId, timeoutMs, assertLease) {
    var started = Date.now();
    function poll() {
      assertLeaseCurrent(assertLease);
      return callChrome(chromeApi, chromeApi.tabs, 'get', [tabId]).then(function (tab) {
        if (tab && tab.status === 'complete') return;
        if (Date.now() - started >= timeoutMs) throw new Error('TAB_LOAD_TIMEOUT');
        return new Promise(function (resolve) {
          setTimeout(resolve, 200);
        }).then(poll);
      });
    }
    return poll();
  }

  function createPageAdapter(options) {
    var source = isPlainObject(options) ? options : {};
    var chromeApi = source.chromeApi;
    var store = source.store;
    var waitForTabComplete = typeof source.waitForTabComplete === 'function'
      ? source.waitForTabComplete
      : function (tabId, assertLease) {
        return defaultWaitForTabComplete(chromeApi, tabId, 30000, assertLease);
      };
    if (!chromeApi || !chromeApi.tabs || !chromeApi.scripting ||
      !store || typeof store.getSnapshot !== 'function') {
      throw new Error('INVALID_PAGE_ADAPTER_DEPENDENCIES');
    }

    async function sendMessage(tabId, message, assertLease) {
      assertLeaseCurrent(assertLease);
      return callChrome(chromeApi, chromeApi.tabs, 'sendMessage', [tabId, message]);
    }

    async function requireOwnedInactiveTab(tabId, assertLease) {
      assertLeaseCurrent(assertLease);
      var tab = await callChrome(chromeApi, chromeApi.tabs, 'get', [tabId]);
      if (!tab || tab.id !== tabId || tab.active === true) {
        var error = new Error('TAB_OWNERSHIP_LOST');
        error.code = 'TAB_OWNERSHIP_LOST';
        throw error;
      }
      return tab;
    }

    async function ensureContentReady(tabId, assertLease) {
      await requireOwnedInactiveTab(tabId, assertLease);
      var ping = null;
      try {
        ping = await sendMessage(tabId, { type: 'PING' }, assertLease);
      } catch (_) {}
      if (!ping || ping.ok !== true || ping.page !== 'chat') {
        await requireOwnedInactiveTab(tabId, assertLease);
        assertLeaseCurrent(assertLease);
        await callChrome(chromeApi, chromeApi.scripting, 'executeScript', [{
          target: { tabId: tabId },
          files: CONTENT_FILES.slice()
        }]);
        await requireOwnedInactiveTab(tabId, assertLease);
        ping = await sendMessage(tabId, { type: 'PING' }, assertLease);
      }
      if (!ping || ping.ok !== true || ping.page !== 'chat') {
        throw new Error('CONTENT_SCRIPT_UNAVAILABLE');
      }
    }

    async function withConversationTab(conversation, operation, assertLease) {
      var exactUrl = safeConversationUrl(conversation && conversation.url, conversation && conversation.conversationId);
      if (!exactUrl) return mappedReaderFailure(null, 'TARGET_UNCERTAIN');
      var createdTabId = null;
      try {
        assertLeaseCurrent(assertLease);
        var tab = await callChrome(chromeApi, chromeApi.tabs, 'create', [{
          url: exactUrl,
          active: false
        }]);
        if (!tab || !Number.isFinite(tab.id)) throw new Error('TAB_CREATE_FAILED');
        createdTabId = tab.id;
        await requireOwnedInactiveTab(tab.id, assertLease);
        await waitForTabComplete(tab.id, assertLease);
        await requireOwnedInactiveTab(tab.id, assertLease);
        await ensureContentReady(tab.id, assertLease);
        await requireOwnedInactiveTab(tab.id, assertLease);
        return await operation(tab.id, function (ownedTabId) {
          return requireOwnedInactiveTab(ownedTabId, assertLease);
        }, assertLease);
      } catch (error) {
        if (error && error.code === 'API_PROOF_STALE') throw error;
        return mappedReaderFailure(
          null,
          error && error.code === 'TAB_OWNERSHIP_LOST'
            ? 'TARGET_UNCERTAIN'
            : 'CONVERSATION_UNAVAILABLE'
        );
      } finally {
        if (createdTabId !== null) {
          try {
            await callChrome(chromeApi, chromeApi.tabs, 'remove', [createdTabId]);
          } catch (_) {}
        }
      }
    }

    async function read(conversation, assertLease) {
      return withConversationTab(conversation, async function (tabId, requireOwned) {
        var response;
        try {
          await requireOwned(tabId);
          response = await sendMessage(tabId, {
            type: 'READ_ACTIVE_CONVERSATION',
            expected: expectedIdentity(conversation),
            conversationRef: {
              conversationId: conversation.conversationId,
              url: conversation.url,
              aliases: Array.isArray(conversation.aliases) ? conversation.aliases.slice(0, 8) : []
            },
            lastFingerprint: typeof conversation.lastIncomingFingerprint === 'string'
              ? conversation.lastIncomingFingerprint
              : ''
          }, assertLease);
        } catch (error) {
          if (error && error.code === 'API_PROOF_STALE') throw error;
          return mappedReaderFailure(null, 'CONVERSATION_UNAVAILABLE');
        }
        if (!response || response.success !== true) {
          return mappedReaderFailure(response, 'CONVERSATION_UNAVAILABLE');
        }
        return {
          success: true,
          conversationRef: clone(response.conversationRef),
          messages: Array.isArray(response.messages) ? clone(response.messages) : [],
          baseline: typeof response.baselineIncomingFingerprint === 'string'
            ? response.baselineIncomingFingerprint
            : null
        };
      }, assertLease);
    }

    async function send(conversation, draft, intent, assertLease) {
      var result = await withConversationTab(conversation, async function (tabId, requireOwned) {
        var snapshot = await store.getSnapshot();
        var current = snapshot.managedConversations &&
          snapshot.managedConversations[conversation.conversationId];
        var persistedIntent = current && current.sendIntent;
        if (!persistedIntent ||
          persistedIntent.status !== 'SENDING' ||
          persistedIntent.intentId !== (intent && intent.intentId) ||
          persistedIntent.draft !== draft) {
          return mappedReaderFailure(null, 'SEND_RESULT_UNKNOWN');
        }
        try {
          await requireOwned(tabId);
        } catch (error) {
          if (error && error.code === 'API_PROOF_STALE') throw error;
          return mappedReaderFailure(null, 'TARGET_UNCERTAIN');
        }
        var response;
        try {
          response = await sendMessage(tabId, {
            type: 'SEND_MANAGED_REPLY',
            expected: expectedIdentity(current),
            conversationRef: {
              conversationId: current.conversationId,
              url: current.url,
              aliases: Array.isArray(current.aliases) ? current.aliases.slice(0, 8) : []
            },
            draft: draft,
            intentId: persistedIntent.intentId
          }, assertLease);
        } catch (error) {
          if (error && error.code === 'API_PROOF_STALE') throw error;
          return mappedReaderFailure(null, 'SEND_RESULT_UNKNOWN');
        }
        if (!response || response.success !== true) {
          var failure = mappedReaderFailure(response, 'SEND_RESULT_UNKNOWN');
          if ((failure.errorCode === 'LOGIN_REQUIRED' ||
              failure.errorCode === 'BOSS_BLOCKED') &&
              typeof store.saveSettings === 'function') {
            try {
              await store.saveSettings({
                paused: true,
                pauseCode: failure.errorCode,
                pauseReason: ''
              });
            } catch (_) {}
          }
          return failure;
        }
        return {
          success: true,
          targetConversationId: response.targetConversationId,
          sentFingerprint: response.sentFingerprint,
          observedAt: response.observedAt
        };
      }, assertLease);
      if (result && result.errorCode === 'CONVERSATION_UNAVAILABLE') {
        return mappedReaderFailure(null, 'SEND_RESULT_UNKNOWN');
      }
      return result;
    }

    return { read: read, send: send };
  }

  function createClassifier(options) {
    var source = isPlainObject(options) ? options : {};
    var replyAI = source.replyAI;
    var callLLM = source.callLLM;
    if (!replyAI || typeof callLLM !== 'function') throw new Error('INVALID_CLASSIFIER_DEPENDENCIES');
    return {
      classify: async function (input, frozenConfig, assertLease) {
        assertLeaseCurrent(assertLease);
        var raw = await callLLM(
          replyAI.buildClassificationMessages(input),
          400,
          frozenConfig
        );
        return replyAI.parseClassification(raw);
      },
      draft: async function (input, frozenConfig, assertLease) {
        assertLeaseCurrent(assertLease);
        var raw = await callLLM(
          replyAI.buildDraftMessages(input),
          500,
          frozenConfig
        );
        return replyAI.parseDraft(raw);
      }
    };
  }

  function createResumeFacts(loadConfig) {
    if (typeof loadConfig !== 'function') throw new Error('INVALID_RESUME_CONFIG_LOADER');
    return async function () {
      var config = await loadConfig();
      var resumeText = config && typeof config.resumeText === 'string'
        ? config.resumeText
        : '';
      var facts = [];
      var resumeCount = 0;
      resumeText.split(/\r?\n/).slice(0, 200).forEach(function (line) {
        if (facts.length >= 100) return;
        var text = codePointSlice(line.trim(), 600);
        if (!text) return;
        resumeCount += 1;
        facts.push({
          id: 'resume-line-' + resumeCount,
          text: text
        });
      });
      var faqCount = 0;
      normalizeHrFaq(config && config.hrFaq).forEach(function (item) {
        if (facts.length >= 100) return;
        if (!item.question || !item.answer) return;
        faqCount += 1;
        facts.push({
          id: 'faq-line-' + faqCount,
          text: codePointSlice('问：' + item.question + '；答：' + item.answer, 600)
        });
      });
      return facts;
    };
  }

  function createNotifier(options) {
    var source = isPlainObject(options) ? options : {};
    var store = source.store;
    var client = source.client;
    var notifierModule = source.notifierModule;
    if (!store || !client || !notifierModule) throw new Error('INVALID_NOTIFIER_DEPENDENCIES');
    async function sendCard(card, assertLease) {
      var snapshot = await store.getSnapshot();
      assertLeaseCurrent(assertLease, snapshot);
      return client.send(snapshot.feishuNotification, card, async function (dispatchPrepared) {
        var latest = await store.getSnapshot();
        assertLeaseCurrent(assertLease, latest);
        return dispatchPrepared();
      });
    }
    return {
      notifyApproval: function (input, assertLease) {
        return sendCard(notifierModule.buildApprovalCard(input), assertLease);
      },
      notifyResolved: function (input, assertLease) {
        return sendCard(notifierModule.buildApprovalCard({
          stage: 'RESOLVED',
          reason: input && input.action,
          latestSummary: '本地待确认任务已处理'
        }), assertLease);
      }
    };
  }

  function maskedFeishu(config) {
    var source = isPlainObject(config) ? config : {};
    return {
      enabled: source.enabled === true,
      hasWebhook: typeof source.webhook === 'string' && source.webhook !== '',
      hasSigningSecret: typeof source.signingSecret === 'string' && source.signingSecret !== '',
      lastTestAt: Number.isFinite(source.lastTestAt) ? source.lastTestAt : 0,
      lastTestOk: source.lastTestOk === true
    };
  }

  function safeConversation(value) {
    var source = isPlainObject(value) ? value : {};
    var aliases = Array.isArray(source.aliases)
      ? source.aliases.filter(function (item) {
        return typeof item === 'string' && /^[A-Za-z0-9_~-]{1,128}$/.test(item);
      }).slice(0, 8)
      : [];
    return {
      conversationId: typeof source.conversationId === 'string' ? source.conversationId : '',
      jobId: typeof source.jobId === 'string' ? source.jobId : '',
      platform: source.platform === 'boss' ? 'boss' : '',
      company: typeof source.company === 'string' ? source.company.slice(0, 1000) : '',
      position: typeof source.position === 'string' ? source.position.slice(0, 1000) : '',
      hrName: typeof source.hrName === 'string' ? source.hrName.slice(0, 1000) : '',
      aliases: aliases,
      peerSource: source.peerSource === 'encryptUid' || source.peerSource === 'legacy-dom'
        ? source.peerSource
        : 'legacy-dom',
      enabled: source.enabled === true,
      state: typeof source.state === 'string' ? source.state : '',
      pauseCode: safePauseCode(source.pauseCode),
      lastCheckedAt: Number.isSafeInteger(source.lastCheckedAt) && source.lastCheckedAt >= 0
        ? source.lastCheckedAt : 0,
      updatedAt: Number.isSafeInteger(source.updatedAt) && source.updatedAt >= 0
        ? source.updatedAt : 0
    };
  }

  function safeApproval(value, conversations) {
    var source = isPlainObject(value) ? value : {};
    var conversation = conversations[source.conversationId] || {};
    return {
      approvalId: typeof source.approvalId === 'string' ? source.approvalId : '',
      conversationId: typeof source.conversationId === 'string' ? source.conversationId : '',
      company: typeof conversation.company === 'string' ? conversation.company.slice(0, 1000) : '',
      position: typeof conversation.position === 'string' ? conversation.position.slice(0, 1000) : '',
      hrName: typeof conversation.hrName === 'string' ? conversation.hrName.slice(0, 1000) : '',
      messages: Array.isArray(source.messages)
        ? source.messages.slice(-20).map(function (text) {
          return typeof text === 'string' ? codePointSlice(text, 600) : '';
        }).filter(Boolean)
        : [],
      stage: typeof source.stage === 'string' ? source.stage.slice(0, 120) : '',
      reasonCode: typeof source.reasonCode === 'string' ? source.reasonCode.slice(0, 120) : '',
      fieldsNeeded: Array.isArray(source.fieldsNeeded)
        ? source.fieldsNeeded.slice(0, 20).map(function (field) {
          return typeof field === 'string' ? field.slice(0, 120) : '';
        }).filter(Boolean)
        : [],
      draft: typeof source.draft === 'string' ? codePointSlice(source.draft, 300) : '',
      status: typeof source.status === 'string' ? source.status : '',
      createdAt: Number.isFinite(source.createdAt) ? source.createdAt : 0
    };
  }

  function createController(options) {
    var source = isPlainObject(options) ? options : {};
    var chromeApi = source.chromeApi;
    var storage = source.storage;
    var store = source.store;
    var engine = source.engine;
    var policy = source.policy;
    var notifierModule = source.notifierModule;
    var feishuClient = source.feishuClient;
    var saveApi = source.saveApi;
    var runApiTest = source.runApiTest;
    var now = typeof source.now === 'function' ? source.now : Date.now;
    if (!chromeApi || !chromeApi.alarms || !chromeApi.tabs ||
      !storage || !store || !engine || !policy || !notifierModule || !feishuClient ||
      typeof saveApi !== 'function' || typeof runApiTest !== 'function') {
      throw new Error('INVALID_CONTROLLER_DEPENDENCIES');
    }
    var queue = Promise.resolve();

    function serialized(work) {
      var next = queue.then(work, work);
      queue = next.then(function () {}, function () {});
      return next;
    }

    async function reconcileAlarmUnsafe() {
      var snapshot = await store.getSnapshot();
      var settings = snapshot.conversationTrusteeship || {};
      if (settings.enabled !== true || settings.paused === true ||
        ALLOWED_INTERVALS.indexOf(settings.intervalMinutes) === -1) {
        await callChrome(chromeApi, chromeApi.alarms, 'clear', [TRUSTEESHIP_ALARM]);
        return { enabled: false };
      }
      // 全局可默认开启，但未满足前置条件时绝不创建监控 alarm
      var current = await readCurrentPrerequisites();
      if (current.missing.length > 0) {
        await callChrome(chromeApi, chromeApi.alarms, 'clear', [TRUSTEESHIP_ALARM]);
        return { enabled: false, missing: current.missing.slice() };
      }
      await callChrome(chromeApi, chromeApi.alarms, 'create', [TRUSTEESHIP_ALARM, {
        delayInMinutes: settings.intervalMinutes,
        periodInMinutes: settings.intervalMinutes
      }]);
      return { enabled: true, intervalMinutes: settings.intervalMinutes };
    }

    async function readLocalConfig() {
      return storage.get([
        'apiKey',
        'dsKey',
        'resumeText',
        'hrFaq',
        'riskAccepted',
        'apiLastTestOk',
        'apiLastTestAt',
        'apiConfigVersion',
        'apiLastTestVersion',
        'feishuNotification'
      ]);
    }

    function recentSuccess(ok, at, timestamp) {
      return ok === true && Number.isFinite(at) && at > 0 &&
        timestamp >= at && timestamp - at <= RECENT_TEST_MS;
    }

    function validFeishu(config) {
      if (!config || config.enabled !== true) return false;
      try {
        notifierModule.validateConfig(config);
        return true;
      } catch (_) {
        return false;
      }
    }

    function prerequisites(config, feishu, timestamp) {
      var missing = [];
      var key = typeof config.apiKey === 'string' && config.apiKey.trim()
        ? config.apiKey.trim()
        : (typeof config.dsKey === 'string' ? config.dsKey.trim() : '');
      var configVersion = Number.isSafeInteger(config.apiConfigVersion) &&
        config.apiConfigVersion >= 0 ? config.apiConfigVersion : 0;
      var proofVersion = Number.isSafeInteger(config.apiLastTestVersion) &&
        config.apiLastTestVersion >= 0 ? config.apiLastTestVersion : 0;
      if (!key ||
        proofVersion !== configVersion ||
        !recentSuccess(config.apiLastTestOk, config.apiLastTestAt, timestamp)) {
        missing.push('api');
      }
      var hasResume = typeof config.resumeText === 'string' && config.resumeText.trim() !== '';
      if (!hasResume && !hasUsableHrFaq(config.hrFaq)) {
        missing.push('replyEvidence');
      }
      if (!validFeishu(feishu) ||
        !recentSuccess(feishu.lastTestOk, feishu.lastTestAt, timestamp)) {
        missing.push('feishuTest');
      }
      if (config.riskAccepted !== true) missing.push('riskAccepted');
      return missing;
    }

    async function readCurrentPrerequisites() {
      var local = await readLocalConfig();
      var feishu = isPlainObject(local.feishuNotification)
        ? local.feishuNotification
        : {};
      return {
        local: local,
        feishu: feishu,
        missing: prerequisites(local, feishu, Number(now()))
      };
    }

    async function pauseAndClearUnsafe(code, disable) {
      var patch = {
        paused: true,
        pauseCode: code,
        pauseReason: ''
      };
      if (disable === true) patch.enabled = false;
      try {
        await store.saveSettings(patch);
      } catch (_) {}
      try {
        await callChrome(chromeApi, chromeApi.alarms, 'clear', [TRUSTEESHIP_ALARM]);
      } catch (_) {}
    }

    async function prerequisiteFailureUnsafe(missing, disable) {
      await pauseAndClearUnsafe('PREREQUISITE_CHANGED', disable);
      return {
        ok: false,
        code: 'TRUSTEESHIP_PREREQUISITE_FAILED',
        missing: missing
      };
    }

    async function checkCurrentPrerequisitesUnsafe() {
      var current = await readCurrentPrerequisites();
      if (current.missing.length === 0) return null;
      return prerequisiteFailureUnsafe(current.missing, false);
    }

    async function saveSettings(message) {
      var settingsInput = isPlainObject(message.settings) ? message.settings : {};
      if (Object.prototype.hasOwnProperty.call(settingsInput, 'intervalMinutes') &&
        ALLOWED_INTERVALS.indexOf(Number(settingsInput.intervalMinutes)) === -1) {
        policy.normalizeSettings(settingsInput);
        return safeError('TRUSTEESHIP_INTERVAL_INVALID');
      }
      var local = await readLocalConfig();
      var currentFeishu = isPlainObject(local.feishuNotification)
        ? local.feishuNotification
        : {};
      var feishuInput = isPlainObject(message.feishuNotification)
        ? message.feishuNotification
        : {};
      var nextFeishu = {
        enabled: Object.prototype.hasOwnProperty.call(feishuInput, 'enabled')
          ? feishuInput.enabled === true
          : currentFeishu.enabled === true,
        webhook: typeof feishuInput.webhook === 'string'
          ? feishuInput.webhook
          : (currentFeishu.webhook || ''),
        signingSecret: typeof feishuInput.signingSecret === 'string'
          ? feishuInput.signingSecret
          : (currentFeishu.signingSecret || ''),
        lastTestAt: Number.isFinite(currentFeishu.lastTestAt) ? currentFeishu.lastTestAt : 0,
        lastTestOk: currentFeishu.lastTestOk === true
      };
      if (nextFeishu.webhook !== (currentFeishu.webhook || '') ||
        nextFeishu.signingSecret !== (currentFeishu.signingSecret || '')) {
        nextFeishu.lastTestAt = 0;
        nextFeishu.lastTestOk = false;
      }
      if (nextFeishu.enabled && !validFeishu(nextFeishu)) {
        return safeError('FEISHU_CONFIG_INVALID');
      }
      var normalized = policy.normalizeSettings(settingsInput);
      var patch = {};
      ['enabled', 'intervalMinutes', 'dailyAutoReplyLimit', 'quietHours'].forEach(function (key) {
        if (Object.prototype.hasOwnProperty.call(settingsInput, key)) {
          patch[key] = normalized[key];
        }
      });
      var storagePatch = { feishuNotification: nextFeishu };
      var nextHrFaq;
      if (Object.prototype.hasOwnProperty.call(message, 'hrFaq')) {
        nextHrFaq = normalizeHrFaq(message.hrFaq);
        storagePatch.hrFaq = nextHrFaq;
      }
      await storage.set(storagePatch);
      if (patch.enabled === true) {
        var current = await readCurrentPrerequisites();
        if (current.missing.length > 0) {
          return prerequisiteFailureUnsafe(current.missing, true);
        }
        patch.paused = false;
        patch.pauseCode = '';
        patch.pauseReason = '';
      }
      var settings = await store.saveSettings(patch);
      await reconcileAlarmUnsafe();
      var localAfter = await readLocalConfig();
      return {
        ok: true,
        settings: settings,
        feishuNotification: maskedFeishu(nextFeishu),
        hrFaq: normalizeHrFaq(
          nextHrFaq !== undefined ? nextHrFaq : localAfter.hrFaq
        )
      };
    }

    async function saveApiConfigUnsafe(message) {
      if (!validateApiConfigMessage(message)) {
        return safeError('API_CONFIG_INPUT_INVALID');
      }
      var result;
      try {
        result = await saveApi(clone(message.config));
      } catch (_) {
        return safeError('API_CONFIG_SAVE_FAILED');
      }
      var identityChanged = !!(result && result.identityChanged === true);
      if (identityChanged) {
        await pauseAndClearUnsafe('API_CONFIG_CHANGED', true);
      }
      return {
        ok: true,
        code: 'OK',
        apiConfigChanged: identityChanged
      };
    }

    async function getState() {
      var snapshot = await store.getSnapshot();
      var local = await readLocalConfig();
      var conversations = {};
      Object.keys(snapshot.managedConversations || {}).slice(0, 500).forEach(function (id) {
        conversations[id] = safeConversation(snapshot.managedConversations[id]);
      });
      var settings = safeSettings(snapshot.conversationTrusteeship);
      return {
        ok: true,
        settings: settings,
        feishuNotification: maskedFeishu(snapshot.feishuNotification),
        hrFaq: normalizeHrFaq(local.hrFaq),
        managedConversations: conversations,
        pendingApprovalCount: Object.keys(snapshot.pendingApprovals || {}).filter(function (id) {
          var status = snapshot.pendingApprovals[id].status;
          return status === 'PENDING' || status === 'SEND_RESULT_UNKNOWN';
        }).length
      };
    }

    async function listApprovals() {
      var snapshot = await store.getSnapshot();
      var approvals = Object.keys(snapshot.pendingApprovals || {}).map(function (id) {
        return snapshot.pendingApprovals[id];
      }).filter(function (approval) {
        return approval.status === 'PENDING' || approval.status === 'SEND_RESULT_UNKNOWN';
      }).sort(function (left, right) {
        if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt;
        return left.approvalId < right.approvalId ? -1 : 1;
      }).slice(0, 100).map(function (approval) {
        return safeApproval(approval, snapshot.managedConversations || {});
      });
      return { ok: true, approvals: approvals };
    }

    async function setConversation(message) {
      if (typeof message.conversationId !== 'string' || typeof message.enabled !== 'boolean') {
        return safeError('TRUSTEESHIP_CONVERSATION_INPUT_INVALID');
      }
      try {
        var saved = await store.setManaged(message.conversationId, message.enabled);
        return { ok: true, conversation: safeConversation(saved) };
      } catch (_) {
        return safeError('CONVERSATION_NOT_REGISTERED');
      }
    }

    async function removeConversation(message) {
      if (typeof message.conversationId !== 'string') {
        return safeError('TRUSTEESHIP_CONVERSATION_INPUT_INVALID');
      }
      if (typeof store.removeConversation !== 'function') {
        return safeError('CONVERSATION_NOT_REGISTERED');
      }
      try {
        var removed = await store.removeConversation(message.conversationId);
        return {
          ok: true,
          conversationId: removed && removed.conversationId
            ? removed.conversationId
            : message.conversationId
        };
      } catch (_) {
        return safeError('CONVERSATION_NOT_REGISTERED');
      }
    }

    async function ensureActiveChatContent(tabId) {
      var ping = null;
      try {
        ping = await callChrome(chromeApi, chromeApi.tabs, 'sendMessage', [tabId, { type: 'PING' }]);
      } catch (_) {}
      if (!ping || ping.ok !== true || ping.page !== 'chat') {
        await callChrome(chromeApi, chromeApi.scripting, 'executeScript', [{
          target: { tabId: tabId },
          files: CONTENT_FILES.slice()
        }]);
        ping = await callChrome(chromeApi, chromeApi.tabs, 'sendMessage', [tabId, { type: 'PING' }]);
      }
      if (!ping || ping.ok !== true || ping.page !== 'chat') {
        throw new Error('CONTENT_SCRIPT_UNAVAILABLE');
      }
    }

    async function registerActiveConversation(message) {
      var enable = message.enable === true;
      var tabs;
      try {
        tabs = await callChrome(chromeApi, chromeApi.tabs, 'query', [{
          active: true,
          lastFocusedWindow: true
        }]);
      } catch (_) {
        return safeError('ACTIVE_CHAT_REQUIRED');
      }
      var tab = Array.isArray(tabs) ? tabs[0] : null;
      if (!tab || !Number.isFinite(tab.id) || !isBossChatTabUrl(tab.url)) {
        return safeError('ACTIVE_CHAT_REQUIRED');
      }
      try {
        await ensureActiveChatContent(tab.id);
      } catch (_) {
        return safeError('CONTENT_SCRIPT_UNAVAILABLE');
      }
      var capture;
      try {
        capture = await callChrome(chromeApi, chromeApi.tabs, 'sendMessage', [tab.id, {
          type: 'CAPTURE_ACTIVE_CONVERSATION'
        }]);
      } catch (_) {
        return safeError('CONTENT_SCRIPT_UNAVAILABLE');
      }
      if (!capture || capture.success !== true) {
        var captureCode = capture && READER_CODES.indexOf(capture.errorCode) !== -1
          ? capture.errorCode
          : 'TARGET_UNCERTAIN';
        var failed = safeError(captureCode);
        if (capture && typeof capture.error === 'string' && capture.error.trim()) {
          failed.detail = capture.error.trim().slice(0, 200);
        }
        return failed;
      }
      var conversationRef = capture.conversationRef;
      if (!conversationRef || typeof conversationRef.conversationId !== 'string') {
        return safeError('UNRELIABLE_CONVERSATION_REF');
      }
      var url = safeConversationUrl(conversationRef.url, conversationRef.conversationId);
      if (!url) return safeError('UNRELIABLE_CONVERSATION_REF');
      if (typeof store.registerConversation !== 'function') {
        return safeError('TRUSTEESHIP_REGISTER_FAILED');
      }
      var snapshot = await store.getSnapshot();
      var existing = snapshot.managedConversations &&
        snapshot.managedConversations[conversationRef.conversationId];
      var jobId = existing && typeof existing.jobId === 'string' && existing.jobId
        ? existing.jobId
        : ('manual-' + conversationRef.conversationId);
      try {
        var saved = await store.registerConversation({
          platform: 'boss',
          conversationId: conversationRef.conversationId,
          url: url,
          jobId: jobId,
          company: typeof capture.company === 'string' ? capture.company : '',
          position: typeof capture.position === 'string' ? capture.position : '',
          hrName: typeof capture.hrName === 'string' ? capture.hrName : '',
          aliases: Array.isArray(conversationRef.aliases) ? conversationRef.aliases : [],
          peerSource: 'encryptUid',
          initialIncomingFingerprint: typeof capture.baselineIncomingFingerprint === 'string'
            ? capture.baselineIncomingFingerprint
            : ''
        });
        if (enable === true) {
          saved = await store.setManaged(conversationRef.conversationId, true);
        }
        return {
          ok: true,
          conversation: safeConversation(saved),
          alreadyRegistered: !!existing
        };
      } catch (error) {
        var errCode = error && typeof error.code === 'string' ? error.code : '';
        if (errCode === 'CONVERSATION_REF_CONFLICT' || errCode === 'UNRELIABLE_CONVERSATION_REF') {
          return safeError(errCode);
        }
        return safeError('TRUSTEESHIP_REGISTER_FAILED');
      }
    }

    async function openConversation(message) {
      if (typeof message.conversationId !== 'string') {
        return safeError('TRUSTEESHIP_CONVERSATION_INPUT_INVALID');
      }
      var snapshot = await store.getSnapshot();
      var conversation = snapshot.managedConversations &&
        snapshot.managedConversations[message.conversationId];
      var url = conversation && safeConversationUrl(
        conversation.url,
        conversation.conversationId
      );
      if (!url) return safeError('CONVERSATION_NOT_REGISTERED');
      var tab = await callChrome(chromeApi, chromeApi.tabs, 'create', [{
        url: url,
        active: true
      }]);
      return { ok: true, tabId: tab && tab.id };
    }

    async function testFeishu() {
      var local = await readLocalConfig();
      var config = isPlainObject(local.feishuNotification)
        ? local.feishuNotification
        : {};
      if (!validFeishu(config)) return safeError('FEISHU_CONFIG_INVALID');
      var testedAt = Number(now());
      var result;
      try {
        result = await feishuClient.send(config, notifierModule.buildApprovalCard({
          stage: 'TEST',
          latestSummary: '飞书通知连接测试'
        }));
      } catch (_) {
        result = { ok: false, code: 'UNKNOWN' };
      }
      var allowedCodes = ['OK', 'NETWORK_ERROR', 'HTTP_ERROR', 'FEISHU_ERROR', 'TIMEOUT'];
      var code = result && result.ok === true
        ? 'OK'
        : (result && allowedCodes.indexOf(result.code) !== -1 ? result.code : 'UNKNOWN');
      var persisted = {
        enabled: config.enabled === true,
        webhook: config.webhook || '',
        signingSecret: config.signingSecret || '',
        lastTestOk: result && result.ok === true,
        lastTestAt: testedAt
      };
      await storage.set({ feishuNotification: persisted });
      return { ok: persisted.lastTestOk, code: code, testedAt: testedAt };
    }

    async function dispatch(message) {
      var input = isPlainObject(message) ? message : {};
      if (input.type === 'TRUSTEESHIP_GET_STATE') return getState();
      if (input.type === 'TRUSTEESHIP_SAVE_SETTINGS') return saveSettings(input);
      if (input.type === 'TRUSTEESHIP_TEST_FEISHU') return testFeishu();
      if (input.type === 'TRUSTEESHIP_SET_CONVERSATION') return setConversation(input);
      if (input.type === 'TRUSTEESHIP_REMOVE_CONVERSATION') return removeConversation(input);
      if (input.type === 'TRUSTEESHIP_REGISTER_ACTIVE') return registerActiveConversation(input);
      if (input.type === 'TRUSTEESHIP_LIST_APPROVALS') return listApprovals();
      if (input.type === 'TRUSTEESHIP_RESOLVE_APPROVAL') {
        var resolvePrerequisiteFailure = await checkCurrentPrerequisitesUnsafe();
        if (resolvePrerequisiteFailure) return resolvePrerequisiteFailure;
        try {
          var result = await engine.resolveApproval({
            approvalId: input.approvalId,
            action: input.action,
            draft: input.draft
          });
          if (result && result.ok === false) {
            var code = typeof result.code === 'string' ? result.code : result.errorCode;
            return RESOLVE_CODES.indexOf(code) !== -1
              ? safeError(code)
              : safeError('TRUSTEESHIP_RESOLVE_FAILED');
          }
          return result;
        } catch (error) {
          return safeError(error && typeof error.code === 'string'
            ? error.code
            : 'TRUSTEESHIP_RESOLVE_FAILED');
        } finally {
          await reconcileAlarmUnsafe();
        }
      }
      if (input.type === 'TRUSTEESHIP_OPEN_CONVERSATION') return openConversation(input);
      if (input.type === 'TRUSTEESHIP_RUN_NOW') {
        var runPrerequisiteFailure = await checkCurrentPrerequisitesUnsafe();
        if (runPrerequisiteFailure) return runPrerequisiteFailure;
        try {
          return { ok: true, summary: await engine.runCycle() };
        } finally {
          await reconcileAlarmUnsafe();
        }
      }
      return safeError('TRUSTEESHIP_MESSAGE_UNSUPPORTED');
    }

    return {
      reconcileAlarm: function () {
        return serialized(reconcileAlarmUnsafe);
      },
      runScheduledCycle: function () {
        return serialized(async function () {
          var prerequisiteFailure = await checkCurrentPrerequisitesUnsafe();
          if (prerequisiteFailure) return prerequisiteFailure;
          try {
            return { ok: true, summary: await engine.runCycle() };
          } finally {
            await reconcileAlarmUnsafe();
          }
        });
      },
      failClosed: function () {
        return serialized(async function () {
          try {
            await store.saveSettings({
              paused: true,
              pauseCode: 'SERVICE_WORKER_INTERRUPTED',
              pauseReason: ''
            });
          } catch (_) {}
          try {
            await callChrome(chromeApi, chromeApi.alarms, 'clear', [TRUSTEESHIP_ALARM]);
          } catch (_) {}
          return safeError('SERVICE_WORKER_INTERRUPTED');
        });
      },
      invalidateApiProof: function () {
        return serialized(async function () {
          await pauseAndClearUnsafe('API_CONFIG_CHANGED', false);
          return safeError('API_CONFIG_CHANGED');
        });
      },
      saveApiConfig: function (message) {
        if (!validateApiConfigMessage(message)) {
          return Promise.resolve(safeError('API_CONFIG_INPUT_INVALID'));
        }
        return serialized(function () { return saveApiConfigUnsafe(message); });
      },
      runApiTest: function () {
        return serialized(async function () {
          try {
            return await runApiTest();
          } catch (_) {
            return safeError('API_TEST_PERSIST_FAILED');
          }
        });
      },
      handleMessage: function (message) {
        if (!validateUserMessage(message)) {
          return Promise.resolve(safeError('TRUSTEESHIP_MESSAGE_INVALID'));
        }
        return serialized(function () { return dispatch(message); });
      }
    };
  }

  return {
    TRUSTEESHIP_ALARM: TRUSTEESHIP_ALARM,
    createPageAdapter: createPageAdapter,
    createClassifier: createClassifier,
    createResumeFacts: createResumeFacts,
    createNotifier: createNotifier,
    createController: createController,
    validateApiConfigMessage: validateApiConfigMessage,
    validateUserMessage: validateUserMessage
  };
});
