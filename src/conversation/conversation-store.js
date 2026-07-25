// 对话托管持久状态机：所有读改写在同一 worker 内串行，外部发送保持两阶段提交。
(function (g, factory) {
  var api = factory();
  g.ConversationStore = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  var STORAGE_KEYS = [
    'conversationTrusteeship',
    'feishuNotification',
    'managedConversations',
    'pendingApprovals'
  ];
  var RECENT_MESSAGE_LIMIT = 20;
  var storageStates = new WeakMap();
  var STATES = new Set([
    'DISABLED',
    'WAITING_HR',
    'CLASSIFYING',
    'DRAFTING_AUTO',
    'SENDING',
    'WAITING_CONFIRMATION',
    'PAUSED'
  ]);
  var NOTIFICATION_CODES = new Set([
    'OK',
    'NETWORK_ERROR',
    'HTTP_ERROR',
    'FEISHU_ERROR',
    'TIMEOUT',
    'UNKNOWN'
  ]);
  var CONVERSATION_PAUSE_CODES = new Set([
    'TARGET_UNCERTAIN',
    'SELECTOR_UNAVAILABLE',
    'SEND_RESULT_UNKNOWN',
    'MESSAGE_ORDER_UNCERTAIN',
    'CONVERSATION_UNAVAILABLE',
    'RECOVERY_STATE_UNCERTAIN',
    'UNKNOWN_PROCESSING_FAILURE'
  ]);
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
  var CLASSIFICATION_ORIGIN_STATES = new Set([
    'WAITING_HR',
    'WAITING_CONFIRMATION'
  ]);

  function clone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function storeError(code) {
    var error = new Error(code);
    error.code = code;
    return error;
  }

  function finiteInteger(value, fallback, min, max) {
    var parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    parsed = Math.floor(parsed);
    return Math.min(max, Math.max(min, parsed));
  }

  function safeString(value, maxLength) {
    if (typeof value !== 'string') return '';
    return value.trim().slice(0, maxLength || 1000);
  }

  function normalizePauseCode(value) {
    var code = safeString(value, 120);
    if (!code) return '';
    return PUBLIC_PAUSE_CODES.has(code) ? code : 'UNKNOWN_PROCESSING_FAILURE';
  }

  function normalizePauseReason(pauseCode) {
    return pauseCode === 'SEND_RESULT_UNKNOWN' ? 'SEND_RESULT_UNKNOWN' : '';
  }

  function safeStringList(value, limit) {
    if (!Array.isArray(value)) return [];
    return value.filter(function (item) {
      return typeof item === 'string' && item.trim() !== '';
    }).map(function (item) {
      return item.slice(0, 4000);
    }).slice(-(limit || RECENT_MESSAGE_LIMIT));
  }

  function localDay(timestamp) {
    var date = new Date(timestamp);
    var year = String(date.getFullYear());
    var month = String(date.getMonth() + 1).padStart(2, '0');
    var day = String(date.getDate()).padStart(2, '0');
    return year + '-' + month + '-' + day;
  }

  function isQuietAt(timestamp, quietHours) {
    if (!quietHours || quietHours.enabled !== true) return false;
    var start = quietHours.start;
    var end = quietHours.end;
    if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(start || '') ||
      !/^([01]\d|2[0-3]):[0-5]\d$/.test(end || '') ||
      start === end) {
      return false;
    }
    var startMinutes = (Number(start.slice(0, 2)) * 60) + Number(start.slice(3, 5));
    var endMinutes = (Number(end.slice(0, 2)) * 60) + Number(end.slice(3, 5));
    var date = new Date(timestamp);
    var current = (date.getHours() * 60) + date.getMinutes();
    return startMinutes < endMinutes
      ? current >= startMinutes && current < endMinutes
      : current >= startMinutes || current < endMinutes;
  }

  function normalizeTime(value, fallback) {
    return typeof value === 'string' && /^([01]\d|2[0-3]):[0-5]\d$/.test(value)
      ? value
      : fallback;
  }

  function normalizeSettings(input, timestamp) {
    var source = input && typeof input === 'object' ? input : {};
    var quiet = source.quietHours && typeof source.quietHours === 'object'
      ? source.quietHours
      : {};
    var interval = finiteInteger(source.intervalMinutes, 10, 5, 15);
    if (interval !== 5 && interval !== 10 && interval !== 15) interval = 10;
    var today = localDay(timestamp);
    var storedDay = /^\d{4}-\d{2}-\d{2}$/.test(source.autoReplyDay || '')
      ? source.autoReplyDay
      : today;

    var pauseCode = normalizePauseCode(source.pauseCode);
    return {
      // 全局托管默认开启；仅当存储里显式写过 enabled=false 时保持关闭
      enabled: Object.prototype.hasOwnProperty.call(source, 'enabled')
        ? source.enabled === true
        : true,
      intervalMinutes: interval,
      dailyAutoReplyLimit: finiteInteger(source.dailyAutoReplyLimit, 10, 1, 20),
      autoReplyDay: today,
      autoReplyCount: storedDay === today
        ? finiteInteger(source.autoReplyCount, 0, 0, Number.MAX_SAFE_INTEGER)
        : 0,
      quietHours: {
        enabled: quiet.enabled === true,
        start: normalizeTime(quiet.start, '22:00'),
        end: normalizeTime(quiet.end, '08:00')
      },
      monitorCursor: finiteInteger(source.monitorCursor, 0, 0, Number.MAX_SAFE_INTEGER),
      paused: source.paused === true,
      pauseCode: pauseCode,
      pauseReason: normalizePauseReason(pauseCode)
    };
  }

  function normalizeFeishu(input) {
    var source = input && typeof input === 'object' ? input : {};
    return {
      enabled: source.enabled === true,
      webhook: typeof source.webhook === 'string' ? source.webhook : '',
      signingSecret: typeof source.signingSecret === 'string' ? source.signingSecret : '',
      lastTestAt: finiteInteger(source.lastTestAt, 0, 0, Number.MAX_SAFE_INTEGER),
      lastTestOk: source.lastTestOk === true
    };
  }

  function normalizeEvidence(input, expectedConversationId) {
    var source = input && typeof input === 'object' ? input : {};
    var targetConversationId = safeString(source.targetConversationId, 500);
    var sentFingerprint = safeString(source.sentFingerprint, 1000);
    if (source.success !== true ||
      !targetConversationId ||
      (expectedConversationId && targetConversationId !== expectedConversationId) ||
      !sentFingerprint ||
      !Number.isFinite(source.observedAt) ||
      source.observedAt <= 0) {
      return null;
    }
    return {
      success: true,
      targetConversationId: targetConversationId,
      sentFingerprint: sentFingerprint,
      observedAt: source.observedAt
    };
  }

  function normalizeSendIntent(input) {
    if (!input || typeof input !== 'object') return undefined;
    var intentId = safeString(input.intentId, 500);
    var mode = input.mode === 'AUTO' ? 'AUTO' : 'MANUAL';
    var approvalId = safeString(input.approvalId, 500);
    var fingerprint = safeString(input.fingerprint, 1000);
    if (!intentId || (mode === 'MANUAL' && !approvalId) || (mode === 'AUTO' && !fingerprint)) {
      return undefined;
    }
    var status = ['SENDING', 'SENT', 'SEND_RESULT_UNKNOWN'].includes(input.status)
      ? input.status
      : 'SEND_RESULT_UNKNOWN';
    var output = {
      intentId: intentId,
      mode: mode,
      draft: typeof input.draft === 'string' ? input.draft.slice(0, 10000) : '',
      status: status,
      createdAt: finiteInteger(input.createdAt, 0, 0, Number.MAX_SAFE_INTEGER),
      updatedAt: finiteInteger(input.updatedAt, 0, 0, Number.MAX_SAFE_INTEGER)
    };
    if (approvalId) output.approvalId = approvalId;
    if (fingerprint) output.fingerprint = fingerprint;
    var evidence = normalizeEvidence(input.evidence);
    if (evidence) output.evidence = evidence;
    if (status === 'SEND_RESULT_UNKNOWN') output.reason = 'SEND_RESULT_UNKNOWN';
    if (Number.isFinite(Number(input.completedAt))) output.completedAt = Number(input.completedAt);
    if (Number.isFinite(Number(input.unknownAt))) output.unknownAt = Number(input.unknownAt);
    return output;
  }

  function normalizeConversation(id, input) {
    var source = input && typeof input === 'object' ? input : {};
    var state = STATES.has(source.state) ? source.state : 'DISABLED';
    var pauseCode = normalizePauseCode(source.pauseCode);
    var conversation = {
      conversationId: id,
      jobId: safeString(source.jobId, 500),
      platform: source.platform === 'boss' ? 'boss' : 'boss',
      url: typeof source.url === 'string' ? source.url.slice(0, 4000) : '',
      company: typeof source.company === 'string' ? source.company.slice(0, 1000) : '',
      position: typeof source.position === 'string' ? source.position.slice(0, 1000) : '',
      hrName: typeof source.hrName === 'string' ? source.hrName.slice(0, 1000) : '',
      aliases: normalizeAliases(source.aliases, id),
      peerSource: normalizePeerSource(source.peerSource),
      enabled: source.enabled === true,
      state: state,
      lastCheckedAt: finiteInteger(source.lastCheckedAt, 0, 0, Number.MAX_SAFE_INTEGER),
      lastIncomingFingerprint: safeString(source.lastIncomingFingerprint, 1000),
      processedFingerprints: safeStringList(source.processedFingerprints, RECENT_MESSAGE_LIMIT),
      recentMessages: safeStringList(source.recentMessages, RECENT_MESSAGE_LIMIT),
      pauseCode: pauseCode,
      pauseReason: normalizePauseReason(pauseCode),
      createdAt: finiteInteger(source.createdAt, 0, 0, Number.MAX_SAFE_INTEGER),
      updatedAt: finiteInteger(source.updatedAt, 0, 0, Number.MAX_SAFE_INTEGER)
    };
    var pendingApprovalId = safeString(source.pendingApprovalId, 500);
    var activeFingerprint = safeString(source.activeFingerprint, 1000);
    var classificationBaseline = typeof source.classificationBaseline === 'string' &&
      source.classificationBaseline.length <= 1000
      ? source.classificationBaseline
      : undefined;
    var classificationOriginState = CLASSIFICATION_ORIGIN_STATES.has(
      source.classificationOriginState
    ) ? source.classificationOriginState : undefined;
    var sendIntent = normalizeSendIntent(source.sendIntent);
    if (pendingApprovalId) conversation.pendingApprovalId = pendingApprovalId;
    if (activeFingerprint) conversation.activeFingerprint = activeFingerprint;
    if (classificationBaseline !== undefined) {
      conversation.classificationBaseline = classificationBaseline;
    }
    if (classificationOriginState !== undefined) {
      conversation.classificationOriginState = classificationOriginState;
    }
    if (sendIntent) conversation.sendIntent = sendIntent;
    if (!conversation.enabled && conversation.state !== 'DISABLED') conversation.state = 'DISABLED';
    return conversation;
  }

  function normalizeNotificationAttempt(input) {
    var source = input && typeof input === 'object' ? input : {};
    var reservationId = safeString(source.reservationId, 500);
    var status = ['SENDING', 'SUCCESS', 'FAILED', 'UNKNOWN'].includes(source.status)
      ? source.status
      : '';
    if (reservationId && status) {
      if (status === 'FAILED' &&
        (!NOTIFICATION_CODES.has(source.code) ||
          source.code === 'OK' ||
          source.code === 'UNKNOWN')) {
        status = 'UNKNOWN';
      }
      var terminalOk = status === 'SUCCESS';
      var normalized = {
        reservationId: reservationId,
        attempt: finiteInteger(source.attempt, 1, 1, 2),
        status: status,
        ok: terminalOk,
        code: status === 'SENDING' || status === 'UNKNOWN'
          ? 'UNKNOWN'
          : normalizeNotificationCode(source.code, terminalOk),
        attemptedAt: finiteInteger(source.attemptedAt, 0, 0, Number.MAX_SAFE_INTEGER)
      };
      if (Number.isFinite(Number(source.completedAt))) {
        normalized.completedAt = finiteInteger(
          source.completedAt,
          0,
          0,
          Number.MAX_SAFE_INTEGER
        );
      }
      return normalized;
    }
    var ok = source.ok === true;
    return {
      attempt: finiteInteger(source.attempt, 1, 1, 2),
      ok: ok,
      code: normalizeNotificationCode(source.code, ok),
      attemptedAt: finiteInteger(source.attemptedAt, 0, 0, Number.MAX_SAFE_INTEGER)
    };
  }

  function normalizeNotificationCode(value, ok) {
    if (ok) return 'OK';
    return NOTIFICATION_CODES.has(value) && value !== 'OK' ? value : 'UNKNOWN';
  }

  function notificationAttemptStatus(attempt) {
    if (attempt && ['SENDING', 'SUCCESS', 'FAILED', 'UNKNOWN'].includes(attempt.status)) {
      return attempt.status;
    }
    if (attempt && attempt.ok === true) return 'SUCCESS';
    return attempt && attempt.code !== 'UNKNOWN' ? 'FAILED' : 'UNKNOWN';
  }

  function normalizeApproval(id, input) {
    var source = input && typeof input === 'object' ? input : {};
    var allowedStatuses = [
      'PENDING',
      'SENDING',
      'RESOLVED',
      'CANCELLED',
      'CANCELLED_DUPLICATE',
      'NO_REPLY',
      'SEND_RESULT_UNKNOWN'
    ];
    return {
      approvalId: id,
      conversationId: safeString(source.conversationId, 500),
      incomingFingerprint: safeString(source.incomingFingerprint, 1000),
      incomingFingerprints: safeStringList(source.incomingFingerprints, RECENT_MESSAGE_LIMIT),
      messages: safeStringList(source.messages, RECENT_MESSAGE_LIMIT),
      stage: safeString(source.stage, 120) || 'WAITING_CONFIRMATION',
      reasonCode: safeString(source.reasonCode, 120),
      fieldsNeeded: safeStringList(source.fieldsNeeded, RECENT_MESSAGE_LIMIT),
      draft: typeof source.draft === 'string' ? source.draft.slice(0, 10000) : '',
      status: allowedStatuses.includes(source.status) ? source.status : 'PENDING',
      createdAt: finiteInteger(source.createdAt, 0, 0, Number.MAX_SAFE_INTEGER),
      updatedAt: finiteInteger(source.updatedAt, 0, 0, Number.MAX_SAFE_INTEGER),
      feishuNotifyAttempts: Array.isArray(source.feishuNotifyAttempts)
        ? source.feishuNotifyAttempts.slice(0, 2).map(normalizeNotificationAttempt)
        : []
    };
  }

  function normalizeSnapshot(raw, timestamp) {
    var source = raw && typeof raw === 'object' ? raw : {};
    var managedSource = source.managedConversations && typeof source.managedConversations === 'object'
      ? source.managedConversations
      : {};
    var approvalSource = source.pendingApprovals && typeof source.pendingApprovals === 'object'
      ? source.pendingApprovals
      : {};
    var managed = {};
    var approvals = {};

    Object.keys(managedSource).forEach(function (id) {
      var normalizedId = safeString(id, 500);
      if (normalizedId) managed[normalizedId] = normalizeConversation(normalizedId, managedSource[id]);
    });
    Object.keys(approvalSource).forEach(function (id) {
      var normalizedId = safeString(id, 500);
      if (normalizedId) approvals[normalizedId] = normalizeApproval(normalizedId, approvalSource[id]);
    });

    return {
      conversationTrusteeship: normalizeSettings(source.conversationTrusteeship, timestamp),
      feishuNotification: normalizeFeishu(source.feishuNotification),
      managedConversations: managed,
      pendingApprovals: approvals
    };
  }

  var PEER_ID_RE = /^[A-Za-z0-9_~-]{1,128}$/;
  var MAX_ALIASES = 8;

  function normalizeAliases(value, peerId) {
    if (!Array.isArray(value)) return [];
    var out = [];
    value.forEach(function (item) {
      if (typeof item !== 'string' || !PEER_ID_RE.test(item) || item === peerId) return;
      if (out.indexOf(item) === -1) out.push(item);
    });
    return out.slice(0, MAX_ALIASES);
  }

  function normalizePeerSource(value) {
    if (value === 'encryptUid' || value === 'legacy-dom') return value;
    return 'legacy-dom';
  }

  function isReliableRef(ref) {
    if (!ref || ref.platform !== 'boss') return false;
    var conversationId = safeString(ref.conversationId, 500);
    var jobId = safeString(ref.jobId, 500);
    if (!conversationId || !jobId || /\s/.test(ref.conversationId)) return false;
    if (!PEER_ID_RE.test(conversationId)) return false;
    if (!ref.url || typeof ref.url !== 'string') return false;
    try {
      var parsed = new URL(ref.url);
      return parsed.protocol === 'https:' &&
        !parsed.username &&
        !parsed.password &&
        parsed.hostname !== 'zhipin.com' &&
        parsed.hostname.endsWith('.zhipin.com') &&
        (parsed.pathname === '/web/geek/chat' || parsed.pathname === '/web/geek/chat/');
    } catch (_error) {
      return false;
    }
  }

  function findConversationKeyByIdentity(snapshot, peerId, aliases) {
    var wanted = [peerId].concat(Array.isArray(aliases) ? aliases : []);
    wanted = wanted.filter(function (id) {
      return typeof id === 'string' && PEER_ID_RE.test(id);
    });
    if (!wanted.length) return '';
    var keys = Object.keys(snapshot.managedConversations || {});
    for (var i = 0; i < keys.length; i++) {
      var key = keys[i];
      var conversation = snapshot.managedConversations[key];
      var known = [key].concat(Array.isArray(conversation.aliases) ? conversation.aliases : []);
      for (var w = 0; w < wanted.length; w++) {
        if (known.indexOf(wanted[w]) !== -1) return key;
      }
    }
    return '';
  }

  function rewriteApprovalConversationIds(snapshot, fromId, toId) {
    if (!fromId || !toId || fromId === toId) return;
    Object.keys(snapshot.pendingApprovals || {}).forEach(function (approvalId) {
      var approval = snapshot.pendingApprovals[approvalId];
      if (approval && approval.conversationId === fromId) {
        approval.conversationId = toId;
      }
    });
  }

  function getStorageState(storage) {
    var state = storageStates.get(storage);
    if (!state) {
      state = {
        queue: Promise.resolve(),
        recoveryInitialized: false
      };
      storageStates.set(storage, state);
    }
    return state;
  }

  function compareApprovalIds(snapshot, leftId, rightId) {
    var left = snapshot.pendingApprovals[leftId];
    var right = snapshot.pendingApprovals[rightId];
    if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt;
    return leftId < rightId ? -1 : leftId > rightId ? 1 : 0;
  }

  function create(storage, clock, idFactory) {
    if (!storage || typeof storage.get !== 'function' || typeof storage.set !== 'function') {
      throw storeError('INVALID_STORAGE');
    }
    var readClock = typeof clock === 'function' ? clock : function () { return Date.now(); };
    var makeId = typeof idFactory === 'function' ? idFactory : function (kind) {
      return kind + '-' + Date.now() + '-' + Math.random().toString(16).slice(2);
    };
    var storageState = getStorageState(storage);

    function timestamp() {
      var value = readClock();
      var parsed = value instanceof Date ? value.getTime() : Number(value);
      if (!Number.isFinite(parsed)) throw storeError('INVALID_CLOCK');
      return Math.floor(parsed);
    }

    function serialized(work) {
      var next = storageState.queue.then(work, work);
      storageState.queue = next.then(function () {}, function () {});
      return next;
    }

    async function readSnapshot(now) {
      var raw = clone(await storage.get(STORAGE_KEYS));
      return {
        raw: raw,
        snapshot: normalizeSnapshot(raw, now)
      };
    }

    async function persist(snapshot) {
      await storage.set(clone({
        conversationTrusteeship: snapshot.conversationTrusteeship,
        feishuNotification: snapshot.feishuNotification,
        managedConversations: snapshot.managedConversations,
        pendingApprovals: snapshot.pendingApprovals
      }));
    }

    function clearClassificationRecovery(conversation) {
      delete conversation.activeFingerprint;
      delete conversation.classificationBaseline;
      delete conversation.classificationOriginState;
    }

    function hasUniquePendingLink(snapshot, conversation, approvalId) {
      var linked = approvalId && snapshot.pendingApprovals[approvalId];
      if (!linked ||
        linked.conversationId !== conversation.conversationId ||
        linked.status !== 'PENDING') {
        return false;
      }
      var localPendingIds = Object.keys(snapshot.pendingApprovals).filter(function (candidateId) {
        var candidate = snapshot.pendingApprovals[candidateId];
        return candidate.conversationId === conversation.conversationId &&
          candidate.status === 'PENDING';
      });
      return localPendingIds.length === 1 && localPendingIds[0] === approvalId;
    }

    function hasNotificationOwner(snapshot, approval) {
      var conversation = approval &&
        snapshot.managedConversations[approval.conversationId];
      return !!(conversation &&
        conversation.enabled === true &&
        conversation.state === 'WAITING_CONFIRMATION' &&
        conversation.pendingApprovalId === approval.approvalId &&
        hasUniquePendingLink(snapshot, conversation, approval.approvalId));
    }

    function hasValidClassifyingRecovery(snapshot, rawConversation, conversation) {
      if (!rawConversation || typeof rawConversation !== 'object') return false;
      var baseline = rawConversation.classificationBaseline;
      var origin = rawConversation.classificationOriginState;
      var active = rawConversation.activeFingerprint;
      var lastIncoming = rawConversation.lastIncomingFingerprint;
      if (typeof baseline !== 'string' || baseline.length > 1000 ||
        !CLASSIFICATION_ORIGIN_STATES.has(origin) ||
        typeof active !== 'string' || !active || active.length > 1000 ||
        typeof lastIncoming !== 'string' || lastIncoming.length > 1000 ||
        active !== conversation.activeFingerprint ||
        active !== conversation.lastIncomingFingerprint ||
        active !== lastIncoming ||
        baseline === active ||
        !conversation.processedFingerprints.includes(active)) {
        return false;
      }
      var pendingId = conversation.pendingApprovalId;
      if (origin === 'WAITING_CONFIRMATION') {
        return hasUniquePendingLink(snapshot, conversation, pendingId);
      }
      return !pendingId && !Object.keys(snapshot.pendingApprovals).some(function (approvalId) {
        var approval = snapshot.pendingApprovals[approvalId];
        return approval.conversationId === conversation.conversationId &&
          approval.status === 'PENDING';
      });
    }

    function recoverInterruptedSends(snapshot, raw, now) {
      var changed = false;
      Object.keys(snapshot.managedConversations).forEach(function (conversationId) {
        var conversation = snapshot.managedConversations[conversationId];
        var intent = conversation.sendIntent;
        if (conversation.state === 'SENDING' || (intent && intent.status === 'SENDING')) {
          if (intent && intent.status === 'SENDING') {
            if (intent.mode === 'AUTO') {
              snapshot.conversationTrusteeship.autoReplyCount += 1;
            }
            intent.status = 'SEND_RESULT_UNKNOWN';
            intent.reason = 'SEND_RESULT_UNKNOWN';
            intent.unknownAt = now;
            intent.updatedAt = now;
            var approval = snapshot.pendingApprovals[intent.approvalId];
            if (approval) {
              approval.status = 'SEND_RESULT_UNKNOWN';
              approval.updatedAt = now;
            }
          }
          conversation.state = 'PAUSED';
          conversation.pauseCode = 'SEND_RESULT_UNKNOWN';
          conversation.pauseReason = 'SEND_RESULT_UNKNOWN';
          clearClassificationRecovery(conversation);
          conversation.updatedAt = now;
          changed = true;
          return;
        }
        if (conversation.state === 'CLASSIFYING') {
          var rawConversation = raw && raw.managedConversations &&
            raw.managedConversations[conversationId];
          if (!hasValidClassifyingRecovery(snapshot, rawConversation, conversation)) {
            conversation.state = 'PAUSED';
            conversation.pauseCode = 'RECOVERY_STATE_UNCERTAIN';
            conversation.pauseReason = '';
            clearClassificationRecovery(conversation);
            conversation.updatedAt = now;
            changed = true;
            return;
          }
          var interruptedFingerprint = conversation.activeFingerprint;
          conversation.processedFingerprints = conversation.processedFingerprints.filter(
            function (fingerprint) { return fingerprint !== interruptedFingerprint; }
          );
          conversation.lastIncomingFingerprint = conversation.classificationBaseline;
          conversation.state = conversation.classificationOriginState;
          clearClassificationRecovery(conversation);
          conversation.updatedAt = now;
          changed = true;
        }
      });
      return changed;
    }

    async function load() {
      var now = timestamp();
      var read = await readSnapshot(now);
      var snapshot = read.snapshot;
      var storedSettings = read.raw && read.raw.conversationTrusteeship;
      var crossDayChanged = !!(storedSettings &&
        typeof storedSettings === 'object' &&
        /^\d{4}-\d{2}-\d{2}$/.test(storedSettings.autoReplyDay || '') &&
        storedSettings.autoReplyDay !== snapshot.conversationTrusteeship.autoReplyDay);
      var recoveryChanged = false;
      if (!storageState.recoveryInitialized) {
        recoveryChanged = recoverInterruptedSends(snapshot, read.raw, now);
      }
      if (recoveryChanged || crossDayChanged) await persist(snapshot);
      if (!storageState.recoveryInitialized) storageState.recoveryInitialized = true;
      return { snapshot: snapshot, now: now };
    }

    function requireConversation(snapshot, conversationId) {
      var id = safeString(conversationId, 500);
      var conversation = id && snapshot.managedConversations[id];
      if (!conversation) throw storeError('CONVERSATION_NOT_FOUND');
      return conversation;
    }

    function requireApproval(snapshot, approvalId) {
      var id = safeString(approvalId, 500);
      var approval = id && snapshot.pendingApprovals[id];
      if (!approval) throw storeError('APPROVAL_NOT_FOUND');
      return approval;
    }

    function findConversationByIntent(snapshot, intentId) {
      var id = safeString(intentId, 500);
      var conversationIds = Object.keys(snapshot.managedConversations);
      for (var index = 0; index < conversationIds.length; index += 1) {
        var conversation = snapshot.managedConversations[conversationIds[index]];
        if (conversation.sendIntent && conversation.sendIntent.intentId === id) return conversation;
      }
      return null;
    }

    function closeActiveApproval(snapshot, conversation, now) {
      var activeIds = Object.keys(snapshot.pendingApprovals).filter(function (approvalId) {
        var approval = snapshot.pendingApprovals[approvalId];
        return approval.conversationId === conversation.conversationId &&
          (approval.status === 'PENDING' || approval.status === 'SENDING');
      }).sort(function (leftId, rightId) {
        return compareApprovalIds(snapshot, leftId, rightId);
      });
      activeIds.forEach(function (approvalId) {
        var approval = snapshot.pendingApprovals[approvalId];
        if (approval.status === 'SENDING') {
          approval.status = 'SEND_RESULT_UNKNOWN';
        } else {
          approval.status = 'CANCELLED';
        }
        approval.updatedAt = now;
      });
      if (conversation.sendIntent && conversation.sendIntent.status === 'SENDING') {
        if (conversation.sendIntent.mode === 'AUTO') {
          snapshot.conversationTrusteeship.autoReplyCount += 1;
        }
        conversation.sendIntent.status = 'SEND_RESULT_UNKNOWN';
        conversation.sendIntent.reason = 'SEND_RESULT_UNKNOWN';
        conversation.sendIntent.unknownAt = now;
        conversation.sendIntent.updatedAt = now;
      }
      delete conversation.pendingApprovalId;
    }

    function getSnapshot() {
      return serialized(async function () {
        var loaded = await load();
        return clone(loaded.snapshot);
      });
    }

    function saveSettings(patch) {
      return serialized(async function () {
        var loaded = await load();
        var snapshot = loaded.snapshot;
        var source = patch && typeof patch === 'object' ? patch : {};
        var current = snapshot.conversationTrusteeship;
        var merged = {
          enabled: source.enabled === undefined ? current.enabled : source.enabled,
          intervalMinutes: source.intervalMinutes === undefined
            ? current.intervalMinutes
            : source.intervalMinutes,
          dailyAutoReplyLimit: source.dailyAutoReplyLimit === undefined
            ? current.dailyAutoReplyLimit
            : source.dailyAutoReplyLimit,
          autoReplyDay: current.autoReplyDay,
          autoReplyCount: current.autoReplyCount,
          quietHours: Object.assign({}, current.quietHours, source.quietHours || {}),
          monitorCursor: source.monitorCursor === undefined ? current.monitorCursor : source.monitorCursor,
          paused: source.paused === undefined ? current.paused : source.paused,
          pauseCode: source.pauseCode === undefined ? current.pauseCode : source.pauseCode,
          pauseReason: source.pauseReason === undefined ? current.pauseReason : source.pauseReason
        };
        snapshot.conversationTrusteeship = normalizeSettings(merged, loaded.now);
        await persist(snapshot);
        return clone(snapshot.conversationTrusteeship);
      });
    }

    function registerConversation(ref) {
      return serialized(async function () {
        if (!isReliableRef(ref)) throw storeError('UNRELIABLE_CONVERSATION_REF');
        var loaded = await load();
        var snapshot = loaded.snapshot;
        var id = safeString(ref.conversationId, 500);
        var jobId = safeString(ref.jobId, 500);
        var incomingAliases = normalizeAliases(ref.aliases, id);
        var existingKey = snapshot.managedConversations[id]
          ? id
          : findConversationKeyByIdentity(snapshot, id, incomingAliases);
        var existing = existingKey ? snapshot.managedConversations[existingKey] : null;
        if (existing && existing.jobId && existing.jobId !== jobId) {
          throw storeError('CONVERSATION_REF_CONFLICT');
        }
        var initialIncomingFingerprint = typeof ref.initialIncomingFingerprint === 'string' &&
          ref.initialIncomingFingerprint.length <= 1000
          ? ref.initialIncomingFingerprint
          : '';
        var conversation = existing || {
          conversationId: id,
          enabled: false,
          state: 'DISABLED',
          processedFingerprints: [],
          recentMessages: [],
          lastCheckedAt: 0,
          lastIncomingFingerprint: initialIncomingFingerprint,
          pauseCode: '',
          pauseReason: '',
          aliases: [],
          peerSource: 'legacy-dom',
          createdAt: loaded.now
        };
        if (existing && existingKey && existingKey !== id) {
          // 惰性迁移：旧 DOM key → canonical peerId
          rewriteApprovalConversationIds(snapshot, existingKey, id);
          delete snapshot.managedConversations[existingKey];
          incomingAliases = normalizeAliases(
            incomingAliases.concat([existingKey]).concat(existing.aliases || []),
            id
          );
          conversation.conversationId = id;
        }
        conversation.jobId = jobId;
        conversation.platform = 'boss';
        conversation.url = ref.url;
        conversation.company = typeof ref.company === 'string' ? ref.company.slice(0, 1000) : '';
        conversation.position = typeof ref.position === 'string' ? ref.position.slice(0, 1000) : '';
        conversation.hrName = typeof ref.hrName === 'string' ? ref.hrName.slice(0, 1000) : '';
        conversation.aliases = normalizeAliases(
          (conversation.aliases || []).concat(incomingAliases),
          id
        );
        conversation.peerSource = ref.peerSource === 'encryptUid'
          ? 'encryptUid'
          : normalizePeerSource(conversation.peerSource || ref.peerSource);
        conversation.updatedAt = loaded.now;
        snapshot.managedConversations[id] = conversation;
        await persist(snapshot);
        return clone(conversation);
      });
    }

    function setManaged(conversationId, enabled) {
      return serialized(async function () {
        var loaded = await load();
        var snapshot = loaded.snapshot;
        var conversation = requireConversation(snapshot, conversationId);
        if (enabled === true) {
          if (!conversation.enabled) {
            conversation.enabled = true;
            conversation.state = 'WAITING_HR';
            clearClassificationRecovery(conversation);
            conversation.pauseCode = '';
            conversation.pauseReason = '';
          }
        } else {
          closeActiveApproval(snapshot, conversation, loaded.now);
          conversation.enabled = false;
          conversation.state = 'DISABLED';
          conversation.recentMessages = [];
          clearClassificationRecovery(conversation);
          conversation.pauseCode = '';
          conversation.pauseReason = '';
        }
        conversation.updatedAt = loaded.now;
        await persist(snapshot);
        return clone(conversation);
      });
    }

    function beginMessage(conversationId, fingerprint) {
      return serialized(async function () {
        var loaded = await load();
        var snapshot = loaded.snapshot;
        var conversation = requireConversation(snapshot, conversationId);
        var normalizedFingerprint = safeString(fingerprint, 1000);
        if (!conversation.enabled ||
          (conversation.state !== 'WAITING_HR' && conversation.state !== 'WAITING_CONFIRMATION')) {
          throw storeError('INVALID_STATE_TRANSITION');
        }
        if (!normalizedFingerprint) throw storeError('INVALID_MESSAGE_FINGERPRINT');
        if (conversation.processedFingerprints.includes(normalizedFingerprint)) {
          throw storeError('DUPLICATE_MESSAGE');
        }
        conversation.processedFingerprints = conversation.processedFingerprints
          .concat(normalizedFingerprint)
          .slice(-RECENT_MESSAGE_LIMIT);
        conversation.classificationBaseline = conversation.lastIncomingFingerprint;
        conversation.classificationOriginState = conversation.state;
        conversation.lastIncomingFingerprint = normalizedFingerprint;
        conversation.activeFingerprint = normalizedFingerprint;
        conversation.state = 'CLASSIFYING';
        conversation.updatedAt = loaded.now;
        await persist(snapshot);
        return clone(conversation);
      });
    }

    function createOrMergeApproval(input) {
      return serialized(async function () {
        var loaded = await load();
        var snapshot = loaded.snapshot;
        var source = input && typeof input === 'object' ? input : {};
        var conversation = requireConversation(snapshot, source.conversationId);
        var fingerprint = safeString(source.incomingFingerprint, 1000);
        var messages = safeStringList(source.messages, RECENT_MESSAGE_LIMIT);
        var fromInFlight = conversation.state === 'CLASSIFYING' &&
          conversation.activeFingerprint === fingerprint;
        var laterMessage = conversation.state === 'WAITING_CONFIRMATION' &&
          !conversation.processedFingerprints.includes(fingerprint);
        if (!fingerprint || !messages.length || (!fromInFlight && !laterMessage)) {
          if (fingerprint && conversation.processedFingerprints.includes(fingerprint)) {
            throw storeError('DUPLICATE_MESSAGE');
          }
          throw storeError('INVALID_STATE_TRANSITION');
        }
        if (laterMessage) {
          conversation.processedFingerprints = conversation.processedFingerprints
            .concat(fingerprint)
            .slice(-RECENT_MESSAGE_LIMIT);
          conversation.lastIncomingFingerprint = fingerprint;
        }

        var activeIds = Object.keys(snapshot.pendingApprovals).filter(function (approvalId) {
          var candidate = snapshot.pendingApprovals[approvalId];
          return candidate.conversationId === conversation.conversationId &&
            candidate.status === 'PENDING';
        }).sort(function (leftId, rightId) {
          return compareApprovalIds(snapshot, leftId, rightId);
        });
        var approval = activeIds.length ? snapshot.pendingApprovals[activeIds[0]] : null;
        activeIds.slice(1).forEach(function (duplicateId) {
          var duplicate = snapshot.pendingApprovals[duplicateId];
          duplicate.status = 'CANCELLED_DUPLICATE';
          duplicate.updatedAt = loaded.now;
        });
        if (!approval) {
          var approvalId = safeString(makeId('approval'), 500);
          if (!approvalId || snapshot.pendingApprovals[approvalId]) throw storeError('INVALID_GENERATED_ID');
          approval = {
            approvalId: approvalId,
            conversationId: conversation.conversationId,
            incomingFingerprint: fingerprint,
            incomingFingerprints: [fingerprint],
            messages: [],
            stage: safeString(source.stage, 120) || 'WAITING_CONFIRMATION',
            reasonCode: safeString(source.reasonCode, 120),
            fieldsNeeded: safeStringList(source.fieldsNeeded, RECENT_MESSAGE_LIMIT),
            draft: typeof source.draft === 'string' ? source.draft.slice(0, 10000) : '',
            status: 'PENDING',
            createdAt: loaded.now,
            updatedAt: loaded.now,
            feishuNotifyAttempts: []
          };
          snapshot.pendingApprovals[approvalId] = approval;
        } else {
          approval.incomingFingerprint = fingerprint;
          approval.incomingFingerprints = approval.incomingFingerprints
            .concat(fingerprint)
            .slice(-RECENT_MESSAGE_LIMIT);
          approval.updatedAt = loaded.now;
        }
        approval.messages = approval.messages.concat(messages).slice(-RECENT_MESSAGE_LIMIT);
        conversation.recentMessages = conversation.recentMessages
          .concat(messages)
          .slice(-RECENT_MESSAGE_LIMIT);
        conversation.pendingApprovalId = approval.approvalId;
        conversation.state = 'WAITING_CONFIRMATION';
        conversation.updatedAt = loaded.now;
        clearClassificationRecovery(conversation);
        await persist(snapshot);
        return clone(approval);
      });
    }

    function createSendIntent(approvalId, draft) {
      return serialized(async function () {
        var loaded = await load();
        var snapshot = loaded.snapshot;
        var approval = requireApproval(snapshot, approvalId);
        var conversation = requireConversation(snapshot, approval.conversationId);
        if (conversation.sendIntent && conversation.sendIntent.approvalId === approval.approvalId) {
          throw storeError('SEND_INTENT_ALREADY_EXISTS');
        }
        if (approval.status !== 'PENDING' ||
          conversation.pendingApprovalId !== approval.approvalId ||
          conversation.state !== 'WAITING_CONFIRMATION') {
          throw storeError('INVALID_STATE_TRANSITION');
        }
        if (typeof draft !== 'string' || !draft.trim()) throw storeError('INVALID_DRAFT');
        var intentId = safeString(makeId('intent'), 500);
        if (!intentId || findConversationByIntent(snapshot, intentId)) {
          throw storeError('INVALID_GENERATED_ID');
        }
        var intent = {
          intentId: intentId,
          mode: 'MANUAL',
          approvalId: approval.approvalId,
          draft: draft.slice(0, 10000),
          status: 'SENDING',
          createdAt: loaded.now,
          updatedAt: loaded.now
        };
        conversation.sendIntent = intent;
        conversation.state = 'SENDING';
        clearClassificationRecovery(conversation);
        conversation.updatedAt = loaded.now;
        approval.status = 'SENDING';
        approval.draft = intent.draft;
        approval.updatedAt = loaded.now;
        await persist(snapshot);
        return clone(intent);
      });
    }

    function createAutoSendIntent(conversationId, fingerprint, draft) {
      return serialized(async function () {
        var loaded = await load();
        var snapshot = loaded.snapshot;
        var settings = snapshot.conversationTrusteeship;
        var autoReservations = Object.keys(snapshot.managedConversations).reduce(
          function (count, managedId) {
            var candidate = snapshot.managedConversations[managedId];
            return count + (
              candidate.sendIntent &&
              candidate.sendIntent.mode === 'AUTO' &&
              candidate.sendIntent.status === 'SENDING'
                ? 1
                : 0
            );
          },
          0
        );
        if (!settings.enabled || settings.paused) {
          throw storeError('AUTO_REPLY_NOT_ALLOWED');
        }
        if (settings.autoReplyCount + autoReservations >= settings.dailyAutoReplyLimit) {
          throw storeError('DAILY_AUTO_REPLY_LIMIT_REACHED');
        }
        var conversation = requireConversation(snapshot, conversationId);
        var normalizedFingerprint = safeString(fingerprint, 1000);
        if (!conversation.enabled ||
          conversation.state !== 'CLASSIFYING' ||
          conversation.activeFingerprint !== normalizedFingerprint) {
          throw storeError('INVALID_STATE_TRANSITION');
        }
        if (conversation.sendIntent && conversation.sendIntent.status === 'SENDING') {
          throw storeError('SEND_INTENT_ALREADY_EXISTS');
        }
        if (typeof draft !== 'string' || !draft.trim()) throw storeError('INVALID_DRAFT');
        var intentId = safeString(makeId('intent'), 500);
        if (!intentId || findConversationByIntent(snapshot, intentId)) {
          throw storeError('INVALID_GENERATED_ID');
        }
        var intent = {
          intentId: intentId,
          mode: 'AUTO',
          fingerprint: normalizedFingerprint,
          draft: draft.slice(0, 10000),
          status: 'SENDING',
          createdAt: loaded.now,
          updatedAt: loaded.now
        };
        conversation.sendIntent = intent;
        conversation.state = 'SENDING';
        clearClassificationRecovery(conversation);
        conversation.updatedAt = loaded.now;
        await persist(snapshot);
        return clone(intent);
      });
    }

    function completeSend(intentId, evidence) {
      return serialized(async function () {
        var loaded = await load();
        var snapshot = loaded.snapshot;
        var conversation = findConversationByIntent(snapshot, intentId);
        if (!conversation) throw storeError('SEND_INTENT_NOT_FOUND');
        if (conversation.sendIntent.status !== 'SENDING') {
          throw storeError('SEND_INTENT_ALREADY_TERMINAL');
        }
        var safeEvidence = normalizeEvidence(evidence, conversation.conversationId);
        if (!safeEvidence) throw storeError('INVALID_SEND_EVIDENCE');
        var intent = conversation.sendIntent;
        intent.status = 'SENT';
        intent.evidence = safeEvidence;
        intent.completedAt = loaded.now;
        intent.updatedAt = loaded.now;
        var approval = intent.approvalId && snapshot.pendingApprovals[intent.approvalId];
        if (approval) {
          approval.status = 'RESOLVED';
          approval.updatedAt = loaded.now;
        }
        if (conversation.pendingApprovalId === intent.approvalId) {
          delete conversation.pendingApprovalId;
        }
        if (intent.mode === 'AUTO') {
          snapshot.conversationTrusteeship.autoReplyCount += 1;
        }
        conversation.state = conversation.enabled ? 'WAITING_HR' : 'DISABLED';
        conversation.pauseCode = '';
        conversation.pauseReason = '';
        clearClassificationRecovery(conversation);
        conversation.updatedAt = loaded.now;
        await persist(snapshot);
        return clone(intent);
      });
    }

    function markSendUnknown(intentId, reason) {
      return serialized(async function () {
        var loaded = await load();
        var snapshot = loaded.snapshot;
        var conversation = findConversationByIntent(snapshot, intentId);
        if (!conversation) throw storeError('SEND_INTENT_NOT_FOUND');
        if (conversation.sendIntent.status !== 'SENDING') {
          throw storeError('SEND_INTENT_ALREADY_TERMINAL');
        }
        var intent = conversation.sendIntent;
        if (intent.mode === 'AUTO') {
          snapshot.conversationTrusteeship.autoReplyCount += 1;
        }
        intent.status = 'SEND_RESULT_UNKNOWN';
        intent.reason = 'SEND_RESULT_UNKNOWN';
        intent.unknownAt = loaded.now;
        intent.updatedAt = loaded.now;
        var approval = intent.approvalId && snapshot.pendingApprovals[intent.approvalId];
        if (approval) {
          approval.status = 'SEND_RESULT_UNKNOWN';
          approval.updatedAt = loaded.now;
        }
        conversation.state = 'PAUSED';
        conversation.pauseCode = 'SEND_RESULT_UNKNOWN';
        conversation.pauseReason = 'SEND_RESULT_UNKNOWN';
        clearClassificationRecovery(conversation);
        conversation.updatedAt = loaded.now;
        try {
          await persist(snapshot);
        } catch (error) {
          storageState.recoveryInitialized = false;
          throw error;
        }
        return clone(intent);
      });
    }

    function markConversationChecked(conversationId, checkpoint) {
      return serialized(async function () {
        var loaded = await load();
        var snapshot = loaded.snapshot;
        var conversation = requireConversation(snapshot, conversationId);
        var source = checkpoint && typeof checkpoint === 'object' ? checkpoint : {};
        if (typeof source.baseline !== 'string' ||
          source.baseline.length > 1000 ||
          !conversation.enabled ||
          (conversation.state !== 'WAITING_HR' && conversation.state !== 'WAITING_CONFIRMATION')) {
          throw storeError('INVALID_CHECKPOINT');
        }
        conversation.lastIncomingFingerprint = source.baseline;
        clearClassificationRecovery(conversation);
        conversation.lastCheckedAt = loaded.now;
        conversation.updatedAt = loaded.now;
        await persist(snapshot);
        return clone(conversation);
      });
    }

    function pauseConversation(conversationId, code) {
      return serialized(async function () {
        if (!CONVERSATION_PAUSE_CODES.has(code)) throw storeError('INVALID_PAUSE_CODE');
        var loaded = await load();
        var snapshot = loaded.snapshot;
        var conversation = requireConversation(snapshot, conversationId);
        if (conversation.sendIntent && conversation.sendIntent.status === 'SENDING') {
          throw storeError('INVALID_STATE_TRANSITION');
        }
        conversation.state = 'PAUSED';
        conversation.pauseCode = code;
        conversation.pauseReason = '';
        clearClassificationRecovery(conversation);
        conversation.updatedAt = loaded.now;
        await persist(snapshot);
        return clone(conversation);
      });
    }

    function resolveApprovalWithoutSend(approvalId) {
      return serialized(async function () {
        var loaded = await load();
        var snapshot = loaded.snapshot;
        var approval = requireApproval(snapshot, approvalId);
        var conversation = requireConversation(snapshot, approval.conversationId);
        if (approval.status !== 'PENDING' ||
          conversation.pendingApprovalId !== approval.approvalId ||
          conversation.state !== 'WAITING_CONFIRMATION') {
          throw storeError('APPROVAL_ALREADY_TERMINAL');
        }
        approval.status = 'NO_REPLY';
        approval.updatedAt = loaded.now;
        delete conversation.pendingApprovalId;
        conversation.state = conversation.enabled ? 'WAITING_HR' : 'DISABLED';
        clearClassificationRecovery(conversation);
        conversation.updatedAt = loaded.now;
        await persist(snapshot);
        return clone(approval);
      });
    }

    function recordNotificationAttempt(approvalId, operation) {
      return serialized(async function () {
        var loaded = await load();
        var snapshot = loaded.snapshot;
        var approval = requireApproval(snapshot, approvalId);
        var source = operation && typeof operation === 'object' ? operation : {};
        var phase = source.phase;
        if (['RESERVE', 'COMPLETE', 'CANCEL'].indexOf(phase) === -1) {
          throw storeError('INVALID_NOTIFICATION_OPERATION');
        }
        var attempts = approval.feishuNotifyAttempts;
        if (phase === 'RESERVE') {
          var settings = snapshot.conversationTrusteeship;
          if (!settings.enabled ||
            settings.paused ||
            isQuietAt(loaded.now, settings.quietHours) ||
            !hasNotificationOwner(snapshot, approval)) {
            throw storeError('NOTIFICATION_NOT_ALLOWED');
          }
          var firstStatus = attempts.length ? notificationAttemptStatus(attempts[0]) : '';
          if (approval.status !== 'PENDING' ||
            attempts.length >= 2 ||
            (attempts.length === 1 && firstStatus !== 'FAILED')) {
            throw storeError('NOTIFICATION_ATTEMPT_LIMIT');
          }
          var reservationId = safeString(makeId('notification'), 500);
          var duplicateReservation = Object.keys(snapshot.pendingApprovals).some(function (candidateId) {
            return snapshot.pendingApprovals[candidateId].feishuNotifyAttempts.some(function (attempt) {
              return attempt.reservationId === reservationId;
            });
          });
          if (!reservationId || duplicateReservation) throw storeError('INVALID_GENERATED_ID');
          var reservation = {
            reservationId: reservationId,
            attempt: attempts.length + 1,
            status: 'SENDING',
            ok: false,
            code: 'UNKNOWN',
            attemptedAt: loaded.now
          };
          approval.feishuNotifyAttempts = attempts.concat(reservation);
          approval.updatedAt = loaded.now;
          await persist(snapshot);
          return clone(reservation);
        }

        var normalizedReservationId = safeString(source.reservationId, 500);
        var attempt = approval.feishuNotifyAttempts.find(function (candidate) {
          return candidate.reservationId === normalizedReservationId;
        });
        if (!attempt) throw storeError('NOTIFICATION_RESERVATION_NOT_FOUND');
        if (notificationAttemptStatus(attempt) !== 'SENDING') {
          throw storeError('NOTIFICATION_ATTEMPT_ALREADY_TERMINAL');
        }
        if (phase === 'CANCEL') {
          approval.feishuNotifyAttempts = attempts.filter(function (candidate) {
            return candidate.reservationId !== normalizedReservationId;
          });
          approval.updatedAt = loaded.now;
          await persist(snapshot);
          return {
            reservationId: normalizedReservationId,
            status: 'CANCELLED'
          };
        }
        var safeResult = source.result && typeof source.result === 'object' ? source.result : {};
        var ok = safeResult.ok === true;
        var code = normalizeNotificationCode(safeResult.code, ok);
        attempt.status = ok ? 'SUCCESS' : (code === 'UNKNOWN' ? 'UNKNOWN' : 'FAILED');
        attempt.ok = ok;
        attempt.code = code;
        attempt.completedAt = loaded.now;
        approval.updatedAt = loaded.now;
        await persist(snapshot);
        return clone(attempt);
      });
    }

    function resetConversation(conversationId) {
      return serialized(async function () {
        var loaded = await load();
        var snapshot = loaded.snapshot;
        var conversation = requireConversation(snapshot, conversationId);
        closeActiveApproval(snapshot, conversation, loaded.now);
        conversation.state = conversation.enabled ? 'WAITING_HR' : 'DISABLED';
        conversation.recentMessages = [];
        conversation.pauseCode = '';
        conversation.pauseReason = '';
        clearClassificationRecovery(conversation);
        conversation.updatedAt = loaded.now;
        await persist(snapshot);
        return clone(conversation);
      });
    }

    return {
      getSnapshot: getSnapshot,
      saveSettings: saveSettings,
      registerConversation: registerConversation,
      setManaged: setManaged,
      beginMessage: beginMessage,
      createOrMergeApproval: createOrMergeApproval,
      createSendIntent: createSendIntent,
      createAutoSendIntent: createAutoSendIntent,
      completeSend: completeSend,
      markSendUnknown: markSendUnknown,
      markConversationChecked: markConversationChecked,
      pauseConversation: pauseConversation,
      resolveApprovalWithoutSend: resolveApprovalWithoutSend,
      recordNotificationAttempt: recordNotificationAttempt,
      resetConversation: resetConversation
    };
  }

  return {
    STORAGE_KEYS: STORAGE_KEYS.slice(),
    STATES: Array.from(STATES),
    create: create
  };
});
