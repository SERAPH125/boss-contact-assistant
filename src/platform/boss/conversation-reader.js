// Boss 目标会话纯读取契约：不读取 DOM，不访问网络。
(function (g, factory) {
  var api = factory();
  g.BossConversationReader = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  // 与 BossPeerIdentity 对齐：encryptUid/bossId 可含 '~'
  var ID_RE = /^[A-Za-z0-9_~-]{1,128}$/;
  var MESSAGE_KINDS = {
    text: true,
    image: true,
    attachment: true,
    voice: true
  };
  var MAX_RAW_ITEMS = 10000;
  var MAX_MESSAGES = 200;
  var MAX_TEXT_CODE_POINTS = 600;
  var MAX_NEW_INCOMING = 20;

  function own(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function parseChatUrl(value) {
    if (typeof value !== 'string' || !value || value.length > 2048) return null;
    if (value.indexOf('\\') >= 0) return null;
    var authorityStart = value.indexOf('://');
    var pathStart = authorityStart >= 0 ? value.indexOf('/', authorityStart + 3) : -1;
    var queryStart = value.indexOf('?', pathStart);
    var fragmentStart = value.indexOf('#', pathStart);
    var pathEnd = value.length;
    if (queryStart >= 0) pathEnd = Math.min(pathEnd, queryStart);
    if (fragmentStart >= 0) pathEnd = Math.min(pathEnd, fragmentStart);
    if (pathStart < 0 || value.slice(pathStart, pathEnd) !== '/web/geek/chat') return null;
    var url;
    try {
      url = new URL(value);
    } catch (error) {
      return null;
    }
    if (url.protocol !== 'https:' || url.username || url.password || url.port) return null;
    var hostname = url.hostname.toLowerCase();
    if (hostname === 'zhipin.com' || !hostname.endsWith('.zhipin.com')) return null;
    if (url.pathname !== '/web/geek/chat') return null;
    return url;
  }

  function collectUrlCandidates(url, candidates) {
    ['conversationId', 'uid'].forEach(function (key) {
      var values = url.searchParams.getAll(key);
      values.forEach(function (value) {
        candidates.push({ key: key, value: value });
      });
    });
  }

  function collectDatasetCandidates(dataset, candidates) {
    if (!dataset || typeof dataset !== 'object') return true;
    var valid = true;
    ['conversationId', 'uid'].forEach(function (key) {
      if (!own(dataset, key)) return;
      var value;
      try {
        value = dataset[key];
      } catch (error) {
        valid = false;
        return;
      }
      if (typeof value !== 'string') {
        valid = false;
        return;
      }
      candidates.push({ key: key, value: value });
    });
    return valid;
  }

  function extractConversationRef(input) {
    if (!input || typeof input !== 'object') return null;
    var pageUrl = parseChatUrl(input.pageUrl);
    if (!pageUrl) return null;

    var candidates = [];
    collectUrlCandidates(pageUrl, candidates);

    if (own(input, 'activeHref')) {
      var activeUrl = parseChatUrl(input.activeHref);
      if (!activeUrl || activeUrl.origin !== pageUrl.origin) return null;
      collectUrlCandidates(activeUrl, candidates);
    }
    if (!collectDatasetCandidates(input.activeDataset, candidates)) return null;
    if (!candidates.length) return null;
    if (candidates.some(function (candidate) { return !ID_RE.test(candidate.value); })) return null;

    var values = Array.from(new Set(candidates.map(function (candidate) {
      return candidate.value;
    })));
    if (values.length !== 1) return null;

    var selectedKey = candidates.some(function (candidate) {
      return candidate.key === 'conversationId';
    }) ? 'conversationId' : 'uid';
    var selectedValue = values[0];
    return {
      conversationId: selectedValue,
      url: pageUrl.origin + '/web/geek/chat?' + selectedKey + '=' + selectedValue
    };
  }

  function sliceCodePoints(value, limit) {
    return Array.from(value).slice(0, limit).join('');
  }

  function safeMessageId(value) {
    if (typeof value !== 'string' || !ID_RE.test(value)) return '';
    return value;
  }

  function stableTime(value) {
    if (typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0) return null;
    return value;
  }

  function hashText(value) {
    var hashA = 0x811c9dc5;
    var hashB = 0x9e3779b9;
    for (var i = 0; i < value.length; i++) {
      var code = value.charCodeAt(i);
      hashA ^= code;
      hashA = Math.imul(hashA, 0x01000193);
      hashB ^= code + i;
      hashB = Math.imul(hashB, 0x85ebca6b);
    }
    return (hashA >>> 0).toString(16).padStart(8, '0') +
      (hashB >>> 0).toString(16).padStart(8, '0');
  }

  function fingerprint(message) {
    var item = message && typeof message === 'object' ? message : {};
    var id = safeMessageId(item.id);
    if (id) return 'id:' + id;
    var direction = item.direction === 'incoming' || item.direction === 'outgoing'
      ? item.direction
      : '';
    var kind = MESSAGE_KINDS[item.kind] ? item.kind : '';
    var text = typeof item.text === 'string'
      ? sliceCodePoints(item.text, MAX_TEXT_CODE_POINTS)
      : '';
    var at = stableTime(item.at);
    if (at === null) return '';
    return 'hash:' + hashText(JSON.stringify([direction, kind, text, at]));
  }

  function isArrayLike(value) {
    if (!value || (typeof value !== 'object' && typeof value !== 'function')) return false;
    var length;
    try {
      length = value.length;
    } catch (error) {
      return false;
    }
    return Number.isInteger(length) && length >= 0 && length <= MAX_RAW_ITEMS;
  }

  function normalizeMessages(rawItems) {
    if (!isArrayLike(rawItems)) return [];
    var length = rawItems.length;
    var start = Math.max(0, length - MAX_MESSAGES);
    var result = [];
    for (var index = start; index < length; index++) {
      var raw;
      try {
        raw = rawItems[index];
      } catch (error) {
        continue;
      }
      if (!raw || typeof raw !== 'object') continue;
      if (raw.direction !== 'incoming' && raw.direction !== 'outgoing') continue;
      if (!MESSAGE_KINDS[raw.kind]) continue;

      var text = typeof raw.text === 'string'
        ? sliceCodePoints(raw.text.trim(), MAX_TEXT_CODE_POINTS)
        : '';
      if (raw.kind === 'text' && !text) continue;
      if (raw.kind !== 'text') text = '';

      var message = {
        id: safeMessageId(raw.id),
        direction: raw.direction,
        kind: raw.kind,
        text: text,
        at: stableTime(raw.at),
        fingerprint: ''
      };
      message.fingerprint = fingerprint(message);
      if (message.fingerprint) result.push(message);
    }
    var counts = Object.create(null);
    result.forEach(function (message) {
      counts[message.fingerprint] = (counts[message.fingerprint] || 0) + 1;
    });
    return result.filter(function (message) {
      return counts[message.fingerprint] === 1;
    });
  }

  function copyMessage(message) {
    return {
      id: safeMessageId(message.id),
      direction: message.direction,
      kind: message.kind,
      text: typeof message.text === 'string'
        ? sliceCodePoints(message.text, MAX_TEXT_CODE_POINTS)
        : '',
      at: stableTime(message.at),
      fingerprint: typeof message.fingerprint === 'string' && message.fingerprint
        ? message.fingerprint
        : fingerprint(message)
    };
  }

  function selectNewIncoming(messages, lastFingerprint) {
    if (!Array.isArray(messages)) return [];
    var explicitBaseline = arguments.length >= 2;
    if (explicitBaseline && typeof lastFingerprint !== 'string') return [];
    var hasBaseline = explicitBaseline && lastFingerprint.length > 0;
    var fingerprints = Object.create(null);
    messages.forEach(function (message) {
      if (!message || typeof message !== 'object') return;
      var value = message.fingerprint || fingerprint(message);
      if (!value) return;
      fingerprints[value] = (fingerprints[value] || 0) + 1;
    });
    var usable = messages.filter(function (message) {
      if (!message || typeof message !== 'object') return false;
      var value = message.fingerprint || fingerprint(message);
      return value && fingerprints[value] === 1;
    });
    var start = 0;
    if (hasBaseline) {
      start = -1;
      for (var i = usable.length - 1; i >= 0; i--) {
        var candidateFingerprint = usable[i] && (
          usable[i].fingerprint || fingerprint(usable[i])
        );
        if (candidateFingerprint === lastFingerprint) {
          start = i + 1;
          break;
        }
      }
      if (start < 0) return [];
    }

    var incoming = [];
    for (var index = start; index < usable.length; index++) {
      var message = usable[index];
      if (!message || message.direction !== 'incoming') continue;
      incoming.push(copyMessage(message));
      if (explicitBaseline && incoming.length === MAX_NEW_INCOMING) break;
    }
    if (!explicitBaseline && incoming.length > MAX_NEW_INCOMING) {
      incoming = incoming.slice(-MAX_NEW_INCOMING);
    }
    return incoming;
  }

  function toCanonicalRef(peerId, origin, aliases) {
    if (typeof BossPeerIdentity !== 'undefined' &&
      typeof BossPeerIdentity.toCanonicalRef === 'function') {
      return BossPeerIdentity.toCanonicalRef(peerId, origin, aliases);
    }
    if (typeof peerId !== 'string' || !ID_RE.test(peerId)) return null;
    try {
      var baseOrigin = typeof origin === 'string' && origin
        ? new URL(origin).origin
        : 'https://www.zhipin.com';
      return {
        conversationId: peerId,
        url: baseOrigin + '/web/geek/chat?uid=' + peerId,
        aliases: Array.isArray(aliases)
          ? aliases.filter(function (item) {
            return typeof item === 'string' && ID_RE.test(item) && item !== peerId;
          }).slice(0, 8)
          : []
      };
    } catch (_) {
      return null;
    }
  }

  return {
    extractConversationRef: extractConversationRef,
    toCanonicalRef: toCanonicalRef,
    normalizeMessages: normalizeMessages,
    fingerprint: fingerprint,
    selectNewIncoming: selectNewIncoming,
    ID_RE: ID_RE
  };
});
