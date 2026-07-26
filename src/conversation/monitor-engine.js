// 单轮对话监控编排：外部读写均由依赖注入，任何不确定结果失败关闭。
(function (g, factory) {
  var api = factory();
  g.MonitorEngine = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  var MAX_CONVERSATIONS = 10;
  var MAX_MESSAGES = 20;
  var MAX_FACTS = 100;
  var MAX_FACT_TEXT = 600;
  var MAX_ID = 160;
  var MAX_DRAFT_CODE_POINTS = 300;
  var CATEGORIES = new Set([
    'still_looking',
    'resume_permission',
    'courtesy',
    'please_wait',
    'resume_fact',
    'important',
    'unknown'
  ]);
  var GLOBAL_READER_ERRORS = new Set([
    'LOGIN_REQUIRED',
    'BOSS_BLOCKED',
    'PREREQUISITE_CHANGED'
  ]);
  var RETRYABLE_READ_PAUSE_CODES = new Set([
    'CONVERSATION_UNAVAILABLE',
    'SELECTOR_UNAVAILABLE',
    'CONTENT_SCRIPT_UNAVAILABLE'
  ]);
  var CONVERSATION_READER_ERRORS = new Set([
    'TARGET_UNCERTAIN',
    'SELECTOR_UNAVAILABLE',
    'MESSAGE_ORDER_UNCERTAIN',
    'BASELINE_NOT_FOUND',
    'BASELINE_REQUIRED',
    'CONTENT_SCRIPT_UNAVAILABLE'
  ]);
  var NOTIFICATION_FAILURE_CODES = new Set([
    'NETWORK_ERROR',
    'HTTP_ERROR',
    'FEISHU_ERROR',
    'TIMEOUT'
  ]);
  var STABLE_ERROR_CODES = new Set([
    'LOGIN_REQUIRED',
    'BOSS_BLOCKED',
    'TARGET_UNCERTAIN',
    'SELECTOR_UNAVAILABLE',
    'MESSAGE_ORDER_UNCERTAIN',
    'BASELINE_NOT_FOUND',
    'BASELINE_REQUIRED',
    'CONTENT_SCRIPT_UNAVAILABLE',
    'CONVERSATION_UNAVAILABLE',
    'SEND_RESULT_UNKNOWN',
    'AI_CLASSIFY_FAILED',
    'AI_CLASSIFICATION_INVALID',
    'AI_DRAFT_FAILED',
    'AI_DRAFT_INVALID',
    'API_PROOF_STALE',
    'PREREQUISITE_CHANGED',
    'DUPLICATE_MESSAGE',
    'AUTO_REPLY_NOT_ALLOWED',
    'DAILY_AUTO_REPLY_LIMIT_REACHED',
    'NOTIFICATION_ATTEMPT_LIMIT',
    'NOTIFICATION_NOT_ALLOWED',
    'STORE_OPERATION_FAILED',
    'UNKNOWN_PROCESSING_FAILURE'
  ]);
  var PUBLIC_ENGINE_ERRORS = new Set([
    'INVALID_APPROVAL_INPUT',
    'APPROVAL_NOT_FOUND',
    'APPROVAL_NOT_PENDING',
    'CONVERSATION_NOT_MANAGED',
    'INVALID_CLOCK'
  ]);
  var STORE_METHODS = [
    'getSnapshot',
    'saveSettings',
    'setManaged',
    'beginMessage',
    'createOrMergeApproval',
    'createSendIntent',
    'createAutoSendIntent',
    'completeSend',
    'markSendUnknown',
    'markConversationChecked',
    'pauseConversation',
    'recordReadFailure',
    'resolveApprovalWithoutSend',
    'recordNotificationAttempt'
  ];

  function engineError(code) {
    var error = new Error(code);
    error.code = code;
    return error;
  }

  function hasMethods(value, methods) {
    return value && typeof value === 'object' && methods.every(function (name) {
      return typeof value[name] === 'function';
    });
  }

  function own(object, key) {
    return Object.prototype.hasOwnProperty.call(object, key);
  }

  function exactKeys(value, keys) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
    var actual = Object.keys(value);
    return actual.length === keys.length && actual.every(function (key) {
      return keys.indexOf(key) !== -1;
    });
  }

  function boundedString(value, max) {
    return typeof value === 'string' && value.trim() !== '' && value.length <= max;
  }

  function codePointSlice(value, max) {
    return Array.from(value).slice(0, max).join('');
  }

  function normalizeFacts(value) {
    if (!Array.isArray(value)) return [];
    var seen = new Set();
    var facts = [];
    value.slice(0, MAX_FACTS * 2).forEach(function (item) {
      if (facts.length >= MAX_FACTS || !item || typeof item !== 'object') return;
      var id = typeof item.id === 'string' ? item.id.trim().slice(0, MAX_ID) : '';
      var text = typeof item.text === 'string'
        ? codePointSlice(item.text.trim(), MAX_FACT_TEXT)
        : '';
      if (!id || !text || seen.has(id)) return;
      seen.add(id);
      facts.push({ id: id, text: text, number: facts.length + 1 });
    });
    return facts;
  }

  function idsAreSubset(ids, facts, requireOne) {
    if (!Array.isArray(ids) || (requireOne && ids.length === 0)) return false;
    var allowed = new Set(facts.map(function (fact) { return fact.id; }));
    var seen = new Set();
    return ids.every(function (id) {
      if (!boundedString(id, MAX_ID) || seen.has(id) || !allowed.has(id)) return false;
      seen.add(id);
      return true;
    });
  }

  function normalizeClassification(value, facts) {
    var keys = ['category', 'confidence', 'reasonCode', 'evidenceIds', 'fieldsNeeded'];
    if (!exactKeys(value, keys) ||
      !CATEGORIES.has(value.category) ||
      typeof value.confidence !== 'number' ||
      !Number.isFinite(value.confidence) ||
      value.confidence < 0 ||
      value.confidence > 1 ||
      !boundedString(value.reasonCode, 120) ||
      !Array.isArray(value.fieldsNeeded) ||
      !value.fieldsNeeded.every(function (field) { return boundedString(field, 120); }) ||
      !idsAreSubset(value.evidenceIds, facts, value.category === 'resume_fact')) {
      throw engineError('AI_CLASSIFICATION_INVALID');
    }
    return {
      category: value.category,
      confidence: value.confidence,
      reasonCode: value.reasonCode,
      evidenceIds: value.evidenceIds.slice(),
      fieldsNeeded: value.fieldsNeeded.slice(0, 20)
    };
  }

  function normalizeDraft(value, facts) {
    if (!exactKeys(value, ['draft', 'evidenceIds']) ||
      typeof value.draft !== 'string' ||
      value.draft.trim() === '' ||
      Array.from(value.draft).length > MAX_DRAFT_CODE_POINTS ||
      !idsAreSubset(value.evidenceIds, facts, true)) {
      throw engineError('AI_DRAFT_INVALID');
    }
    return { draft: value.draft.trim(), evidenceIds: value.evidenceIds.slice() };
  }

  function normalizeMessages(value) {
    if (!Array.isArray(value) || value.length > MAX_MESSAGES) throw engineError('READER_INVALID');
    return value.map(function (item) {
      if (!item || typeof item !== 'object' ||
        item.direction !== 'incoming' ||
        ['text', 'image', 'attachment', 'voice'].indexOf(item.kind) === -1 ||
        !boundedString(item.fingerprint, 1000) ||
        typeof item.text !== 'string' ||
        Array.from(item.text).length > 600 ||
        (item.kind === 'text' && item.text.trim() === '') ||
        (item.kind !== 'text' && item.text !== '')) {
        throw engineError('READER_INVALID');
      }
      return {
        direction: 'incoming',
        kind: item.kind,
        text: item.text,
        fingerprint: item.fingerprint
      };
    });
  }

  function normalizeReadResult(result, conversation) {
    if (!result || typeof result !== 'object' || result.success !== true) {
      throw engineError(mapReaderError(result && result.errorCode));
    }
    var ref = result.conversationRef;
    if (!ref || typeof ref !== 'object' || Array.isArray(ref) ||
      typeof ref.conversationId !== 'string' ||
      ref.conversationId !== conversation.conversationId ||
      typeof ref.url !== 'string' ||
      ref.url !== conversation.url ||
      !isSanitizedConversationUrl(ref.url, conversation.conversationId) ||
      typeof result.baseline !== 'string' ||
      result.baseline.length > 1000) {
      throw engineError('TARGET_UNCERTAIN');
    }
    var identityFields = [
      'conversationId',
      'url',
      'jobId',
      'company',
      'position',
      'hrName',
      'platform'
    ];
    for (var identityIndex = 0; identityIndex < identityFields.length; identityIndex += 1) {
      var identityField = identityFields[identityIndex];
      if (own(ref, identityField) && ref[identityField] !== conversation[identityField]) {
        throw engineError('TARGET_UNCERTAIN');
      }
      if (own(result, identityField) && result[identityField] !== conversation[identityField]) {
        throw engineError('TARGET_UNCERTAIN');
      }
    }
    var messages = normalizeMessages(result.messages);
    var expectedBaseline = messages.length
      ? messages[messages.length - 1].fingerprint
      : conversation.lastIncomingFingerprint;
    if (result.baseline !== expectedBaseline) throw engineError('CONVERSATION_UNAVAILABLE');
    return {
      baseline: result.baseline,
      messages: messages
    };
  }

  function isSanitizedConversationUrl(value, conversationId) {
    try {
      var parsed = new URL(value);
      if (!/^[A-Za-z0-9_~-]{1,128}$/.test(conversationId) ||
        parsed.href !== value ||
        parsed.protocol !== 'https:' ||
        parsed.username ||
        parsed.password ||
        parsed.port ||
        parsed.hash ||
        parsed.hostname === 'zhipin.com' ||
        !parsed.hostname.endsWith('.zhipin.com') ||
        parsed.pathname !== '/web/geek/chat') {
        return false;
      }
      var entries = Array.from(parsed.searchParams.entries());
      return entries.length === 1 &&
        (entries[0][0] === 'conversationId' || entries[0][0] === 'uid') &&
        entries[0][1] === conversationId;
    } catch (_) {
      return false;
    }
  }

  function mapReaderError(code) {
    if (code === 'API_PROOF_STALE') return 'PREREQUISITE_CHANGED';
    if (GLOBAL_READER_ERRORS.has(code) || CONVERSATION_READER_ERRORS.has(code)) return code;
    return 'CONVERSATION_UNAVAILABLE';
  }

  function mapStoreError(code) {
    return STABLE_ERROR_CODES.has(code) ? code : 'STORE_OPERATION_FAILED';
  }

  function normalizeNotificationResult(result) {
    if (result && result.ok === true) return { ok: true, code: 'OK' };
    var code = result && NOTIFICATION_FAILURE_CODES.has(result.code)
      ? result.code
      : 'UNKNOWN';
    return { ok: false, code: code };
  }

  function messageSummary(message) {
    if (message.kind === 'text') return message.text;
    return '[非文本:' + message.kind + ']';
  }

  function summary() {
    return {
      checked: 0,
      newMessages: 0,
      autoSent: 0,
      pending: 0,
      skipped: 0,
      errors: []
    };
  }

  function addError(output, code) {
    var safe = STABLE_ERROR_CODES.has(code) ? code : 'UNKNOWN_PROCESSING_FAILURE';
    if (output.errors.indexOf(safe) === -1) output.errors.push(safe);
  }

  function readClock(clock) {
    var value = clock();
    var date = value instanceof Date ? new Date(value.getTime()) : new Date(value);
    if (Number.isNaN(date.getTime())) throw engineError('INVALID_CLOCK');
    return date;
  }

  function notificationPayload(approval, conversation) {
    return {
      approvalId: approval.approvalId,
      conversationId: approval.conversationId,
      company: conversation ? conversation.company : '',
      position: conversation ? conversation.position : '',
      hrName: conversation ? conversation.hrName : '',
      stage: 'WAITING_CONFIRMATION',
      latestSummary: 'HR 有新消息，请在插件内查看完整上下文',
      bossChatUrl: conversation ? conversation.url : ''
    };
  }

  function notificationEgressAllowed(snapshot, approvalId, conversationId, policy, clock) {
    var settings = snapshot && snapshot.conversationTrusteeship;
    var approval = snapshot && snapshot.pendingApprovals &&
      snapshot.pendingApprovals[approvalId];
    var conversation = snapshot && snapshot.managedConversations &&
      snapshot.managedConversations[conversationId];
    if (!settings ||
      settings.enabled !== true ||
      settings.paused === true ||
      !snapshot.feishuNotification ||
      snapshot.feishuNotification.enabled !== true ||
      !approval ||
      approval.status !== 'PENDING' ||
      approval.conversationId !== conversationId ||
      !conversation ||
      conversation.enabled !== true ||
      conversation.state !== 'WAITING_CONFIRMATION' ||
      conversation.pendingApprovalId !== approvalId ||
      policy.isQuietHours(readClock(clock), settings.quietHours) === true) {
      return false;
    }
    var localPending = Object.keys(snapshot.pendingApprovals).filter(function (candidateId) {
      var candidate = snapshot.pendingApprovals[candidateId];
      return candidate.conversationId === conversationId &&
        candidate.status === 'PENDING';
    });
    return localPending.length === 1 && localPending[0] === approvalId;
  }

  function create(deps) {
    var source = deps && typeof deps === 'object' ? deps : {};
    if (!hasMethods(source.store, STORE_METHODS) ||
      !hasMethods(source.reader, ['read', 'send']) ||
      !hasMethods(source.classifier, ['classify', 'draft']) ||
      !hasMethods(source.notifier, ['notifyApproval', 'notifyResolved']) ||
      !hasMethods(source.policy, ['detectHardRisk', 'isQuietHours', 'decide']) ||
      typeof source.clock !== 'function' ||
      (source.guardExternalAction !== undefined &&
        typeof source.guardExternalAction !== 'function') ||
      (source.getResumeFacts !== undefined && typeof source.getResumeFacts !== 'function')) {
      throw engineError('INVALID_DEPENDENCIES');
    }

    var store = source.store;
    var reader = source.reader;
    var classifier = source.classifier;
    var notifier = source.notifier;
    var policy = source.policy;
    var clock = source.clock;
    var getResumeFacts = source.getResumeFacts;
    var guardExternalAction = source.guardExternalAction;
    var operationQueue = Promise.resolve();

    function serializedOperation(work) {
      async function guardedWork() {
        try {
          return await work();
        } catch (error) {
          var code = error && error.code;
          if (PUBLIC_ENGINE_ERRORS.has(code) || STABLE_ERROR_CODES.has(code)) {
            throw engineError(code);
          }
          throw engineError('STORE_OPERATION_FAILED');
        }
      }
      var next = operationQueue.then(guardedWork, guardedWork);
      operationQueue = next.then(function () {}, function () {});
      return next;
    }

    async function pauseForReadFailure(conversation, code, output) {
      var mappedCode = mapReaderError(code);
      addError(output, mappedCode);
      if (GLOBAL_READER_ERRORS.has(mappedCode)) {
        await store.saveSettings({ paused: true, pauseCode: mappedCode, pauseReason: '' });
        return true;
      }
      await store.recordReadFailure(
        conversation.conversationId,
        CONVERSATION_READER_ERRORS.has(mappedCode) ? mappedCode : 'CONVERSATION_UNAVAILABLE'
      );
      return false;
    }

    // 只有还没有累计过只读失败的暂停（旧版本或发送前读取写入的）才在周期开始无损恢复一次；
    // 退避次数已经用尽的暂停仍然要求人工核对。
    async function resumeStaleReadPause(conversation, output) {
      if (conversation.state !== 'PAUSED' ||
        !RETRYABLE_READ_PAUSE_CODES.has(conversation.pauseCode) ||
        conversation.pendingApprovalId ||
        (conversation.sendIntent && conversation.sendIntent.status === 'SENDING') ||
        conversation.readFailureCount !== 0) {
        return conversation;
      }
      try {
        return await store.setManaged(conversation.conversationId, true);
      } catch (error) {
        addError(output, mapStoreError(error && error.code));
        return conversation;
      }
    }

    async function notifyPendingApprovals(settings, quiet, notifiedThisCycle, output) {
      if (quiet || !settings.feishuEnabled) return;
      var snapshot = await store.getSnapshot();
      var candidates = Object.keys(snapshot.pendingApprovals).map(function (id) {
        return snapshot.pendingApprovals[id];
      }).filter(function (approval) {
        return approval.status === 'PENDING' && !notifiedThisCycle.has(approval.approvalId);
      }).sort(function (left, right) {
        if (left.createdAt !== right.createdAt) return left.createdAt - right.createdAt;
        return left.approvalId < right.approvalId ? -1 : 1;
      });
      for (var index = 0; index < candidates.length; index += 1) {
        var approval = candidates[index];
        notifiedThisCycle.add(approval.approvalId);
        var reservation;
        try {
          reservation = await store.recordNotificationAttempt(approval.approvalId, {
            phase: 'RESERVE'
          });
        } catch (reserveError) {
          if (!reserveError ||
            (reserveError.code !== 'NOTIFICATION_ATTEMPT_LIMIT' &&
              reserveError.code !== 'NOTIFICATION_NOT_ALLOWED')) {
            addError(output, mapStoreError(reserveError && reserveError.code));
          }
          continue;
        }
        var latest;
        try {
          latest = await store.getSnapshot();
        } catch (snapshotError) {
          addError(output, mapStoreError(snapshotError && snapshotError.code));
          continue;
        }
        var latestApproval = latest.pendingApprovals[approval.approvalId];
        var latestConversation = latest.managedConversations[approval.conversationId];
        var egressAllowed = notificationEgressAllowed(
          latest,
          approval.approvalId,
          approval.conversationId,
          policy,
          clock
        );
        if (!egressAllowed) {
          try {
            await store.recordNotificationAttempt(approval.approvalId, {
              phase: 'CANCEL',
              reservationId: reservation.reservationId
            });
          } catch (cancelError) {
            addError(output, mapStoreError(cancelError && cancelError.code));
          }
          continue;
        }
        var result;
        try {
          result = normalizeNotificationResult(await notifier.notifyApproval(notificationPayload(
            latestApproval,
            latestConversation
          ), function (notifierSnapshot) {
            if (!notificationEgressAllowed(
              notifierSnapshot,
              approval.approvalId,
              approval.conversationId,
              policy,
              clock
            )) {
              throw engineError('NOTIFICATION_NOT_ALLOWED');
            }
          }));
        } catch (_) {
          result = { ok: false, code: 'UNKNOWN' };
        }
        try {
          await store.recordNotificationAttempt(approval.approvalId, {
            phase: 'COMPLETE',
            reservationId: reservation.reservationId,
            result: result
          });
        } catch (error) {
          addError(output, mapStoreError(error && error.code));
        }
      }
    }

    async function createApproval(conversation, message, reasonCode, fieldsNeeded, draft) {
      return store.createOrMergeApproval({
        conversationId: conversation.conversationId,
        incomingFingerprint: message.fingerprint,
        messages: [messageSummary(message)],
        stage: 'WAITING_CONFIRMATION',
        reasonCode: reasonCode,
        fieldsNeeded: fieldsNeeded || [],
        draft: draft || ''
      });
    }

    function classifierInput(conversation, message, facts, classification) {
      var input = {
        target: {
          conversationId: conversation.conversationId,
          company: conversation.company,
          position: conversation.position,
          hrName: conversation.hrName,
          jobId: conversation.jobId
        },
        targetMessages: conversation.recentMessages.concat(messageSummary(message)).slice(-20)
          .map(function (text) { return { role: 'recruiter', text: text }; }),
        resumeFacts: facts
      };
      if (classification) input.classification = classification;
      return input;
    }

    async function executeSend(conversation, draft, intent) {
      var result;
      try {
        result = await reader.send(conversation, draft, intent);
      } catch (_) {
        result = null;
      }
      if (result && result.success === true) {
        try {
          await store.completeSend(intent.intentId, result);
          return { sent: true };
        } catch (_) {
          // 成功证据未能可靠落盘时，同样进入不可重放的未知终态。
        }
      }
      try {
        await store.markSendUnknown(intent.intentId, 'SEND_RESULT_UNKNOWN');
      } catch (_) {
        try {
          await store.getSnapshot();
        } catch (_recoveryFailure) {
          // 有界恢复失败后仍保持 SENDING 不可重放；后续任一读取会再次恢复。
        }
      }
      return { sent: false, errorCode: 'SEND_RESULT_UNKNOWN' };
    }

    async function processMessage(context, conversation, message, output) {
      var current = (await store.getSnapshot()).managedConversations[conversation.conversationId];
      if (!current || !current.enabled || current.state === 'PAUSED' || current.state === 'DISABLED') {
        output.skipped += 1;
        return false;
      }
      if (current.state === 'WAITING_CONFIRMATION' && current.pendingApprovalId) {
        try {
          await store.createOrMergeApproval({
            conversationId: current.conversationId,
            incomingFingerprint: message.fingerprint,
            messages: [messageSummary(message)]
          });
          output.pending += 1;
        } catch (error) {
          if (error && error.code !== 'DUPLICATE_MESSAGE') addError(output, error.code);
          else output.skipped += 1;
        }
        return true;
      }

      try {
        await store.beginMessage(current.conversationId, message.fingerprint);
      } catch (error) {
        if (error && error.code === 'DUPLICATE_MESSAGE') {
          output.skipped += 1;
          return true;
        }
        addError(output, error && error.code);
        return false;
      }

      var hardRisk = policy.detectHardRisk({ kind: message.kind, text: message.text });
      var classification = null;
      var draft = null;
      var reasonCode = hardRisk && hardRisk.blocked ? hardRisk.reasonCode : 'AI_UNAVAILABLE';
      var fieldsNeeded = hardRisk && Array.isArray(hardRisk.fieldsNeeded)
        ? hardRisk.fieldsNeeded
        : [];

      if (context.facts.length > 0) {
        var rawClassification;
        try {
          rawClassification = await classifier.classify(
            classifierInput(current, message, context.facts)
          );
        } catch (_) {
          reasonCode = 'AI_CLASSIFY_FAILED';
        }
        if (rawClassification !== undefined) {
          try {
            classification = normalizeClassification(rawClassification, context.facts);
          } catch (_) {
            reasonCode = 'AI_CLASSIFICATION_INVALID';
          }
        }
      } else {
        reasonCode = 'MISSING_RESUME_EVIDENCE';
      }

      var hasPending = !!current.pendingApprovalId;
      var decision = policy.decide({
        hardRisk: hardRisk,
        settings: context.settings,
        conversationEnabled: current.enabled,
        quiet: context.quiet,
        hasPendingApproval: hasPending,
        dailyCount: context.dailyCount,
        ai: classification
      });
      if (decision.action !== 'AUTO_REPLY' &&
        (hardRisk && hardRisk.blocked ||
          classification ||
          ['AI_CLASSIFY_FAILED', 'AI_CLASSIFICATION_INVALID', 'MISSING_RESUME_EVIDENCE']
            .indexOf(reasonCode) === -1)) {
        reasonCode = decision.reasonCode;
      }
      if (classification) fieldsNeeded = fieldsNeeded.concat(classification.fieldsNeeded || []).slice(0, 20);

      if (classification) {
        var rawDraft;
        try {
          rawDraft = await classifier.draft(
            classifierInput(current, message, context.facts, classification)
          );
        } catch (_) {
          if (decision.action === 'AUTO_REPLY') {
            decision = { action: 'REQUIRE_CONFIRMATION', reasonCode: 'AI_DRAFT_FAILED' };
            reasonCode = 'AI_DRAFT_FAILED';
          }
        }
        if (rawDraft !== undefined) {
          try {
            draft = normalizeDraft(rawDraft, context.facts);
          } catch (_) {
            if (decision.action === 'AUTO_REPLY') {
              decision = { action: 'REQUIRE_CONFIRMATION', reasonCode: 'AI_DRAFT_INVALID' };
              reasonCode = 'AI_DRAFT_INVALID';
            }
          }
        }
      }

      if (decision.action === 'AUTO_REPLY' && draft) {
        var fresh = await store.getSnapshot();
        var freshConversation = fresh.managedConversations[current.conversationId];
        var recheck = policy.decide({
          hardRisk: hardRisk,
          settings: fresh.conversationTrusteeship,
          conversationEnabled: freshConversation && freshConversation.enabled,
          quiet: policy.isQuietHours(readClock(clock), fresh.conversationTrusteeship.quietHours),
          hasPendingApproval: !!(freshConversation && freshConversation.pendingApprovalId),
          dailyCount: fresh.conversationTrusteeship.autoReplyCount,
          ai: classification
        });
        if (recheck.action === 'AUTO_REPLY') {
          var intent;
          try {
            if (guardExternalAction) await guardExternalAction();
            intent = await store.createAutoSendIntent(
              current.conversationId,
              message.fingerprint,
              draft.draft
            );
          } catch (intentError) {
            var intentCode = mapStoreError(intentError && intentError.code);
            if (intentCode === 'AUTO_REPLY_NOT_ALLOWED' ||
              intentCode === 'DAILY_AUTO_REPLY_LIMIT_REACHED') {
              reasonCode = intentCode;
            } else {
              throw engineError(intentCode);
            }
          }
          if (intent) {
            var sendOutcome = await executeSend(freshConversation, draft.draft, intent);
            if (sendOutcome.sent) {
              output.autoSent += 1;
              context.dailyCount += 1;
              return true;
            }
            addError(output, sendOutcome.errorCode);
            return false;
          }
        } else {
          reasonCode = recheck.reasonCode;
        }
      }

      await createApproval(current, message, reasonCode, fieldsNeeded, draft && draft.draft);
      output.pending += 1;
      return true;
    }

    async function runCycleInternal() {
      var output = summary();
      var snapshot = await store.getSnapshot();
      var settings = snapshot.conversationTrusteeship;
      if (settings.enabled !== true || settings.paused === true) return output;

      var all = Object.keys(snapshot.managedConversations).map(function (id) {
        return snapshot.managedConversations[id];
      }).filter(function (conversation) {
        return conversation.platform === 'boss' && conversation.enabled === true;
      }).sort(function (left, right) {
        return left.conversationId < right.conversationId ? -1
          : left.conversationId > right.conversationId ? 1 : 0;
      });
      if (all.length === 0) return output;

      var start = settings.monitorCursor % all.length;
      var selected = [];
      for (var index = 0; index < Math.min(MAX_CONVERSATIONS, all.length); index += 1) {
        selected.push(all[(start + index) % all.length]);
      }
      var quiet = policy.isQuietHours(readClock(clock), settings.quietHours);
      var factsLoaded = false;
      var facts = [];
      async function loadFactsOnce() {
        if (factsLoaded) return facts;
        factsLoaded = true;
        if (!getResumeFacts) return facts;
        try {
          facts = normalizeFacts(await getResumeFacts());
        } catch (_) {
          facts = [];
        }
        return facts;
      }
      var context = {
        settings: settings,
        quiet: quiet,
        dailyCount: settings.autoReplyCount,
        facts: facts
      };
      var stopGlobally = false;
      var attemptedSlots = 0;

      for (var selectedIndex = 0; selectedIndex < selected.length; selectedIndex += 1) {
        if (stopGlobally) break;
        var conversation = await resumeStaleReadPause(selected[selectedIndex], output);
        attemptedSlots += 1;
        if (conversation.state !== 'WAITING_HR' &&
          conversation.state !== 'WAITING_CONFIRMATION') {
          output.skipped += 1;
          continue;
        }
        var read;
        try {
          read = normalizeReadResult(await reader.read(conversation), conversation);
        } catch (error) {
          stopGlobally = await pauseForReadFailure(
            conversation,
            mapReaderError(error && error.code),
            output
          );
          continue;
        }
        output.checked += 1;
        if (read.messages.length > 0) {
          context.facts = await loadFactsOnce();
        }
        var fullyHandled = true;
        for (var messageIndex = 0; messageIndex < read.messages.length; messageIndex += 1) {
          output.newMessages += 1;
          try {
            if (!await processMessage(context, conversation, read.messages[messageIndex], output)) {
              fullyHandled = false;
              break;
            }
          } catch (error) {
            addError(output, STABLE_ERROR_CODES.has(error && error.code)
              ? error.code
              : 'UNKNOWN_PROCESSING_FAILURE');
            try {
              await store.createOrMergeApproval({
                conversationId: conversation.conversationId,
                incomingFingerprint: read.messages[messageIndex].fingerprint,
                messages: [messageSummary(read.messages[messageIndex])],
                stage: 'WAITING_CONFIRMATION',
                reasonCode: 'UNKNOWN_PROCESSING_FAILURE',
                fieldsNeeded: [],
                draft: ''
              });
              output.pending += 1;
            } catch (storeFailure) {
              addError(output, mapStoreError(storeFailure && storeFailure.code));
              fullyHandled = false;
              break;
            }
          }
        }
        if (fullyHandled) {
          try {
            await store.markConversationChecked(conversation.conversationId, { baseline: read.baseline });
          } catch (error) {
            addError(output, mapStoreError(error && error.code));
          }
        }
      }

      await store.saveSettings({
        monitorCursor: (start + attemptedSlots) % all.length
      });
      var latest = await store.getSnapshot();
      if (latest.conversationTrusteeship.enabled === true &&
        latest.conversationTrusteeship.paused !== true) {
        await notifyPendingApprovals({
          feishuEnabled: latest.feishuNotification.enabled === true
        }, quiet, new Set(), output);
      }
      return output;
    }

    async function notifyResolution(approval, action) {
      try {
        await notifier.notifyResolved({
          approvalId: approval.approvalId,
          conversationId: approval.conversationId,
          action: action
        });
      } catch (_) {
        return;
      }
    }

    async function resolveApprovalInternal(input) {
      var value = input && typeof input === 'object' ? input : {};
      var action = value.action;
      if (!boundedString(value.approvalId, 500) ||
        ['SEND_EDITED', 'NO_REPLY', 'DISABLE_CONVERSATION'].indexOf(action) === -1) {
        throw engineError('INVALID_APPROVAL_INPUT');
      }
      if (action === 'SEND_EDITED' &&
        (typeof value.draft !== 'string' ||
          value.draft.trim() === '' ||
          Array.from(value.draft.trim()).length > MAX_DRAFT_CODE_POINTS)) {
        throw engineError('INVALID_APPROVAL_INPUT');
      }
      var snapshot = await store.getSnapshot();
      var approval = snapshot.pendingApprovals[value.approvalId];
      if (!approval) throw engineError('APPROVAL_NOT_FOUND');
      if (approval.status !== 'PENDING') throw engineError('APPROVAL_NOT_PENDING');
      var conversation = snapshot.managedConversations[approval.conversationId];
      if (!conversation || !conversation.enabled) throw engineError('CONVERSATION_NOT_MANAGED');

      if (action === 'NO_REPLY') {
        var noReply = await store.resolveApprovalWithoutSend(approval.approvalId);
        await notifyResolution(noReply, action);
        return { ok: true, action: action, status: 'NO_REPLY' };
      }
      if (action === 'DISABLE_CONVERSATION') {
        await store.setManaged(conversation.conversationId, false);
        await notifyResolution(approval, action);
        return { ok: true, action: action, status: 'DISABLED' };
      }

      try {
        normalizeReadResult(await reader.read(conversation), conversation);
      } catch (error) {
        var code = mapReaderError(error && error.code);
        if (CONVERSATION_READER_ERRORS.has(code)) {
          await store.pauseConversation(conversation.conversationId, code);
        } else if (GLOBAL_READER_ERRORS.has(code)) {
          await store.saveSettings({ paused: true, pauseCode: code, pauseReason: '' });
        } else {
          await store.pauseConversation(conversation.conversationId, 'CONVERSATION_UNAVAILABLE');
        }
        return { ok: false, action: action, status: 'PAUSED', errorCode: code };
      }

      var draft = value.draft.trim();
      if (guardExternalAction) await guardExternalAction();
      var intent = await store.createSendIntent(approval.approvalId, draft);
      var sendOutcome = await executeSend(conversation, draft, intent);
      if (!sendOutcome.sent) {
        return {
          ok: false,
          action: action,
          status: 'SEND_RESULT_UNKNOWN',
          errorCode: 'SEND_RESULT_UNKNOWN'
        };
      }
      await notifyResolution(approval, action);
      return { ok: true, action: action, status: 'SENT' };
    }

    function runCycle() {
      return serializedOperation(runCycleInternal);
    }

    function resolveApproval(input) {
      return serializedOperation(function () {
        return resolveApprovalInternal(input);
      });
    }

    return {
      runCycle: runCycle,
      resolveApproval: resolveApproval
    };
  }

  return { create: create };
});
