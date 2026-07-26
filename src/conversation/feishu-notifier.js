// 飞书自定义机器人通知：最小白名单卡片、签名和安全错误边界；不读取 Chrome 或修改托管状态。
(function (g, factory) {
  var api = factory();
  g.FeishuNotifier = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  var WEBHOOK_RAW = /^https:\/\/open\.feishu\.cn\/open-apis\/bot\/v2\/hook\/[A-Za-z0-9_-]+$/;
  var SAFE_BOSS_QUERY_KEYS = ['conversationId', 'uid', 'jobId', 'encryptJobId'];
  var SAFE_QUERY_VALUE = /^[A-Za-z0-9_~-]{1,128}$/;
  var SAFE_STAGES = new Set(['WAITING_CONFIRMATION', 'RESOLVED']);
  var SAFE_ORIGINS = new Set(['LIVE_MONITOR', 'LIVE_DRILL']);
  var SAFE_SUMMARIES = new Set([
    'HR 有新消息，请在插件内查看完整上下文',
    '本地待确认任务已处理',
    '请人工确认。'
  ]);
  var CARD_BRAND = new WeakSet();
  var MAX = {
    company: 160,
    position: 160,
    hr: 120,
    stage: 80,
    summary: 600,
    reason: 300,
    field: 80,
    fields: 8,
    draft: 600,
    message: 600,
    wait: 120
  };
  var DEFAULT_TIMEOUT_MS = 8000;

  function fail(code) {
    var error = new Error(code);
    error.code = code;
    throw error;
  }

  function plainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function sanitizedText(value, maxLength) {
    if (typeof value !== 'string') return '';
    return value
      .replace(/[\u0000-\u001f\u007f]/g, ' ')
      .replace(/https?:\/\/[^\s"'<>]+/gi, '[REDACTED]')
      .replace(/\bBearer\s+["']?[^\s,;)}\]"']+["']?/gi, 'Bearer [REDACTED]')
      .replace(/\b(?:api[_-]?key|access[_-]?token|authorization|token|secret|password)\s*[:=]\s*["']?[^\s,;)}\]"']+["']?/gi, function (match) {
        return match.split(/[:=]/)[0] + '=[REDACTED]';
      })
      .replace(/\b(?:sk|pk|rk|api)[_-][A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
      .replace(/\bsigning[-_]?secret(?:[-_][A-Za-z0-9_-]+)?\b/gi, '[REDACTED]')
      .replace(/@/g, '＠')
      .replace(/[\[\]()]/g, '')
      .slice(0, maxLength);
  }

  function deepFreeze(value) {
    if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
    Object.keys(value).forEach(function (key) { deepFreeze(value[key]); });
    return Object.freeze(value);
  }

  function validateConfig(config) {
    var source = plainObject(config) ? config : {};
    if (typeof source.webhook !== 'string' || !WEBHOOK_RAW.test(source.webhook)) fail('FEISHU_WEBHOOK_INVALID');
    var parsed;
    try { parsed = new URL(source.webhook); } catch (_) { fail('FEISHU_WEBHOOK_INVALID'); }
    if (parsed.protocol !== 'https:' || parsed.hostname !== 'open.feishu.cn' || parsed.port !== '' ||
      parsed.username !== '' || parsed.password !== '' || parsed.search !== '' || parsed.hash !== '') fail('FEISHU_WEBHOOK_INVALID');
    if (source.signingSecret !== undefined && typeof source.signingSecret !== 'string') fail('FEISHU_SECRET_INVALID');
    return { webhook: source.webhook, signingSecret: source.signingSecret || '' };
  }

  function bytesToBase64(bytes) {
    var binary = '';
    for (var index = 0; index < bytes.length; index += 1) binary += String.fromCharCode(bytes[index]);
    if (typeof btoa === 'function') return btoa(binary);
    if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64');
    fail('FEISHU_SIGN_FAILED');
  }

  async function sign(timestampSeconds, secret, subtle) {
    if (!subtle || typeof subtle.importKey !== 'function' || typeof subtle.sign !== 'function') fail('FEISHU_SIGN_FAILED');
    var encoder = new TextEncoder();
    var key = await subtle.importKey(
      'raw',
      encoder.encode(String(timestampSeconds) + '\n' + secret),
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    var bytes = await subtle.sign('HMAC', key, new Uint8Array());
    return bytesToBase64(new Uint8Array(bytes));
  }

  function rawBossPath(value) {
    var match = /^https:\/\/[^/?#]+([^?#]*)/i.exec(value);
    return match ? match[1] : '';
  }

  function validDnsHostname(hostname) {
    if (typeof hostname !== 'string' || hostname.length === 0 || hostname.length > 253) return false;
    return hostname.split('.').every(function (label) {
      return label.length >= 1 && label.length <= 63 && /^[a-z0-9-]+$/i.test(label) &&
        label.charAt(0) !== '-' && label.charAt(label.length - 1) !== '-';
    });
  }

  function validBossChatUrl(value) {
    if (typeof value !== 'string' || /\\|%(?:2e|2f|5c)/i.test(value)) return '';
    var rawPath = rawBossPath(value);
    if (/(^|\/)\.{1,2}(?:\/|$)/.test(rawPath)) return '';
    try {
      var parsed = new URL(value);
      if (parsed.protocol !== 'https:' || parsed.port !== '' || parsed.username !== '' || parsed.password !== '' ||
        !validDnsHostname(parsed.hostname) || !/^[a-z0-9-]+(?:\.[a-z0-9-]+)*\.zhipin\.com$/i.test(parsed.hostname) ||
        (parsed.pathname !== '/web/geek/chat' && parsed.pathname !== '/web/geek/chat/')) return '';
      var base = 'https://' + parsed.hostname + parsed.pathname;
      if (base.length > 512) return '';
      var pairs = [];
      SAFE_BOSS_QUERY_KEYS.forEach(function (key) {
        var candidate = parsed.searchParams.get(key);
        if (!SAFE_QUERY_VALUE.test(candidate || '')) return;
        var pair = encodeURIComponent(key) + '=' + encodeURIComponent(candidate);
        if ((base + '?' + pairs.concat(pair).join('&')).length <= 512) pairs.push(pair);
      });
      if (parsed.search && pairs.length === 0) return '';
      return pairs.length > 0 ? base + '?' + pairs.join('&') : base;
    } catch (_) {
      return '';
    }
  }

  function plainText(content) {
    return { tag: 'plain_text', content: content };
  }

  function field(label, value) {
    return { is_short: false, text: plainText(label + '：' + value) };
  }

  function buildApprovalCard(input) {
    var source = plainObject(input) ? input : {};
    var stage = SAFE_STAGES.has(source.stage) ? source.stage : '';
    var origin = SAFE_ORIGINS.has(source.origin) ? source.origin : 'LIVE_MONITOR';
    var latestSummary = SAFE_SUMMARIES.has(source.latestSummary)
      ? source.latestSummary
      : '';
    var facts = [
      ['公司', sanitizedText(source.company, MAX.company)],
      ['岗位', sanitizedText(source.position, MAX.position)],
      ['HR', sanitizedText(source.hr || source.hrName, MAX.hr)],
      ['阶段', stage],
      ['最新摘要', latestSummary]
    ].filter(function (item) { return item[1].trim() !== ''; });
    var elements = [];
    if (facts.length > 0) elements.push({ tag: 'div', fields: facts.map(function (item) { return field(item[0], item[1]); }) });

    var latestMessage = sanitizedText(source.latestMessage, MAX.message);
    if (latestMessage.trim() !== '') {
      elements.push({
        tag: 'div',
        text: plainText((origin === 'LIVE_DRILL' ? '模拟 HR 正文：' : 'HR 正文：') + latestMessage)
      });
    }
    var draft = sanitizedText(source.draft, MAX.draft);
    if (draft.trim() !== '') {
      elements.push({ tag: 'div', text: plainText('拟回复：' + draft) });
    }

    var wait = source.wait === true ? '等待对方回复' : '';
    if (wait.trim() !== '') elements.push({ tag: 'div', text: plainText('状态：' + wait) });

    var chatUrl = validBossChatUrl(source.bossChatUrl || source.openBossChatUrl);
    if (chatUrl) elements.push({
      tag: 'action',
      actions: [{ tag: 'button', text: plainText('打开 Boss 对话'), type: 'default', url: chatUrl }]
    });

    var card = deepFreeze({
      config: { wide_screen_mode: true },
      header: { title: plainText('Boss 待确认'), template: 'blue' },
      elements: elements
    });
    CARD_BRAND.add(card);
    return card;
  }

  function secretValues(config) {
    var source = plainObject(config) ? config : {};
    var values = [];
    if (typeof source.webhook === 'string' && source.webhook) {
      values.push(source.webhook);
      var parts = source.webhook.split('/');
      if (parts[parts.length - 1]) values.push(parts[parts.length - 1]);
    }
    if (typeof source.signingSecret === 'string' && source.signingSecret) values.push(source.signingSecret);
    return values;
  }

  function credentialForms(config) {
    var forms = [];
    secretValues(config).forEach(function (value) {
      if (!value) return;
      var escaped = JSON.stringify(value).slice(1, -1);
      [value, escaped].forEach(function (form) {
        if (form && forms.indexOf(form) === -1) forms.push(form);
      });
    });
    return forms.sort(function (left, right) { return right.length - left.length; });
  }

  function cardContainsConfiguredCredential(card, safeConfig) {
    var serialized;
    try { serialized = JSON.stringify(card); } catch (_) { return true; }
    return credentialForms(safeConfig).some(function (form) {
      return serialized.indexOf(form) !== -1;
    });
  }

  function serialize(value) {
    if (value instanceof Error) return value.name + ': ' + value.message;
    if (typeof value === 'string') return value;
    var seen = [];
    try {
      return JSON.stringify(value, function (key, item) {
        if (/api[_-]?key|access[_-]?token|authorization|token|secret|password/i.test(key)) return '[REDACTED]';
        if (typeof item === 'object' && item !== null) {
          if (seen.indexOf(item) !== -1) return '[CIRCULAR]';
          seen.push(item);
        }
        return item;
      });
    } catch (_) {
      return '[UNSERIALIZABLE]';
    }
  }

  function escapeRegExp(value) {
    return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  }

  function redactError(value, config) {
    var result = serialize(value);
    if (typeof result !== 'string') result = String(result);
    result = result.replace(/(https?:\/\/[^\s"'<>?#]+)\?[^\s"'<>]*/gi, '$1?[REDACTED]');
    credentialForms(config).forEach(function (form) {
      result = result.replace(new RegExp(escapeRegExp(form), 'g'), '[REDACTED]');
    });
    return result
      .replace(/\b(?:sk|pk|rk|api)[_-][A-Za-z0-9_-]{8,}\b/g, '[REDACTED]')
      .replace(/\b(?:api[_-]?key|access[_-]?token|authorization|token|secret|password)\s*[:=]\s*["']?(?:Bearer\s+)?[^\s,;)}\]"']+["']?/gi, function (match) {
        return match.split(/[:=]/)[0] + '=[REDACTED]';
      });
  }

  function defaultSubtle() {
    return typeof globalThis !== 'undefined' && globalThis.crypto ? globalThis.crypto.subtle : null;
  }

  function create(options) {
    var settings = plainObject(options) ? options : {};
    var fetchFn = settings.fetchFn || (typeof globalThis !== 'undefined' ? globalThis.fetch : null);
    var subtle = settings.subtle || defaultSubtle();
    var clock = typeof settings.clock === 'function' ? settings.clock : Date.now;
    var timeoutMs = Number.isFinite(settings.timeoutMs) && settings.timeoutMs > 0 ? settings.timeoutMs : DEFAULT_TIMEOUT_MS;

    return {
      send: async function (config, card, dispatchPrepared) {
        var safeConfig;
        try { safeConfig = validateConfig(config); } catch (error) {
          return { ok: false, code: error && error.code === 'FEISHU_SECRET_INVALID' ? 'UNKNOWN' : 'FEISHU_WEBHOOK_INVALID' };
        }
        if (!CARD_BRAND.has(card)) return { ok: false, code: 'FEISHU_CARD_INVALID' };
        if (cardContainsConfiguredCredential(card, safeConfig)) return { ok: false, code: 'FEISHU_CARD_INVALID' };
        if (typeof fetchFn !== 'function') return { ok: false, code: 'NETWORK_ERROR' };

        var controller = typeof AbortController === 'function' ? new AbortController() : null;
        var timeoutMarker = {};
        var timer;
        var timeout = new Promise(function (resolve) {
          timer = setTimeout(function () {
            timedOut = true;
            if (controller) controller.abort();
            resolve(timeoutMarker);
          }, timeoutMs);
        });
        var timedOut = false;
        var operation = Promise.resolve().then(async function () {
          var payload = { msg_type: 'interactive', card: card };
          var stage = 'prepare';
          try {
            if (safeConfig.signingSecret !== '') {
              var clockValue = clock();
              if (typeof clockValue !== 'number' || !Number.isFinite(clockValue) || clockValue <= 0) throw new Error('CLOCK_INVALID');
              var seconds = Math.floor(clockValue / 1000);
              if (seconds <= 0) throw new Error('CLOCK_INVALID');
              var timestamp = String(seconds);
              payload.timestamp = timestamp;
              payload.sign = await sign(timestamp, safeConfig.signingSecret, subtle);
            }
            var requestOptions = {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(payload),
              signal: controller ? controller.signal : undefined
            };
            stage = 'dispatch';
            var dispatch = function () {
              if (timedOut) throw new Error('DISPATCH_EXPIRED');
              stage = 'fetch';
              return fetchFn(safeConfig.webhook, requestOptions);
            };
            var response = await (typeof dispatchPrepared === 'function'
              ? dispatchPrepared(dispatch)
              : dispatch());
            if (!response || !response.ok) return { ok: false, code: 'HTTP_ERROR' };
            stage = 'response';
            var body = await response.json();
            return !body || body.code !== 0 ? { ok: false, code: 'FEISHU_ERROR' } : { ok: true, code: 'OK' };
          } catch (_) {
            if (stage === 'fetch') return { ok: false, code: 'NETWORK_ERROR' };
            return { ok: false, code: 'UNKNOWN' };
          }
        });
        // A timed-out promise can settle later; observing it prevents unhandled rejections.
        operation.then(function () {}, function () {});
        try {
          var result = await Promise.race([operation, timeout]);
          return result === timeoutMarker ? { ok: false, code: 'TIMEOUT' } : result;
        } finally {
          clearTimeout(timer);
        }
      }
    };
  }

  return {
    validateConfig: validateConfig,
    sign: sign,
    buildApprovalCard: buildApprovalCard,
    create: create,
    redactError: redactError
  };
});
