// AI 托管安全干跑：复用真实编排，但所有状态与发送证据只存在于一次性内存中。
(function (g, factory) {
  var api = factory();
  g.TrusteeshipSimulator = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  var AI_FAILURE_CODES = new Set([
    'AI_CLASSIFY_FAILED',
    'AI_CLASSIFICATION_INVALID',
    'AI_DRAFT_FAILED',
    'AI_DRAFT_INVALID'
  ]);

  function clone(value) {
    if (value === undefined) return undefined;
    return JSON.parse(JSON.stringify(value));
  }

  function simulatorError(code) {
    var error = new Error(code);
    error.code = code;
    return error;
  }

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function validateInput(input) {
    if (!isPlainObject(input) ||
      Object.keys(input).length !== 2 ||
      !Object.prototype.hasOwnProperty.call(input, 'conversationId') ||
      !Object.prototype.hasOwnProperty.call(input, 'message') ||
      typeof input.conversationId !== 'string' ||
      input.conversationId.trim() === '' ||
      input.conversationId.length > 128 ||
      typeof input.message !== 'string' ||
      input.message.trim() === '' ||
      Array.from(input.message.trim()).length > 600) {
      throw simulatorError('TRUSTEESHIP_MESSAGE_INVALID');
    }
    return {
      conversationId: input.conversationId.trim(),
      message: input.message.trim()
    };
  }

  function createMemoryStorage(initial) {
    var data = clone(initial || {});
    return {
      get: async function (keys) {
        if (!Array.isArray(keys)) return clone(data);
        return keys.reduce(function (result, key) {
          result[key] = clone(data[key]);
          return result;
        }, {});
      },
      set: async function (patch) {
        Object.keys(patch || {}).forEach(function (key) {
          data[key] = clone(patch[key]);
        });
      }
    };
  }

  function isolatedConversation(source) {
    var conversation = clone(source);
    conversation.enabled = true;
    conversation.state = 'WAITING_HR';
    conversation.lastIncomingFingerprint =
      typeof conversation.lastIncomingFingerprint === 'string'
        ? conversation.lastIncomingFingerprint
        : '';
    conversation.processedFingerprints = Array.isArray(conversation.processedFingerprints)
      ? conversation.processedFingerprints.slice()
      : [];
    conversation.recentMessages = Array.isArray(conversation.recentMessages)
      ? conversation.recentMessages.slice()
      : [];
    conversation.pauseCode = '';
    conversation.pauseReason = '';
    conversation.readFailureCount = 0;
    conversation.lastReadErrorCode = '';
    delete conversation.pendingApprovalId;
    delete conversation.sendIntent;
    delete conversation.activeFingerprint;
    delete conversation.classificationBaseline;
    delete conversation.classificationOriginState;
    return conversation;
  }

  function seedSnapshot(snapshot, conversation) {
    var settings = clone(snapshot.conversationTrusteeship || {});
    settings.enabled = true;
    settings.paused = false;
    settings.pauseCode = '';
    settings.pauseReason = '';
    settings.monitorCursor = 0;
    return {
      conversationTrusteeship: settings,
      feishuNotification: {
        enabled: false,
        webhook: '',
        signingSecret: '',
        lastTestOk: false,
        lastTestAt: 0
      },
      managedConversations: (function () {
        var out = {};
        out[conversation.conversationId] = isolatedConversation(conversation);
        return out;
      })(),
      pendingApprovals: {}
    };
  }

  function safeClassification(value) {
    if (!isPlainObject(value)) return null;
    return {
      category: typeof value.category === 'string' ? value.category.slice(0, 80) : '',
      confidence: typeof value.confidence === 'number' && Number.isFinite(value.confidence)
        ? value.confidence
        : 0,
      reasonCode: typeof value.reasonCode === 'string'
        ? value.reasonCode.slice(0, 120)
        : '',
      evidenceIds: Array.isArray(value.evidenceIds)
        ? value.evidenceIds.filter(function (id) {
          return typeof id === 'string' && id.trim() !== '';
        }).map(function (id) { return id.slice(0, 160); }).slice(0, 40)
        : [],
      fieldsNeeded: Array.isArray(value.fieldsNeeded)
        ? value.fieldsNeeded.filter(function (field) {
          return typeof field === 'string' && field.trim() !== '';
        }).map(function (field) { return field.slice(0, 120); }).slice(0, 20)
        : []
    };
  }

  function projectResult(input, observations, snapshot, summary) {
    var approvalIds = Object.keys(snapshot.pendingApprovals || {}).sort();
    var approval = approvalIds.length > 0
      ? snapshot.pendingApprovals[approvalIds[0]]
      : null;
    var failureCode = approval && AI_FAILURE_CODES.has(approval.reasonCode)
      ? approval.reasonCode
      : null;
    if (!failureCode && summary && Array.isArray(summary.errors)) {
      failureCode = summary.errors.find(function (code) {
        return AI_FAILURE_CODES.has(code);
      });
    }
    if (failureCode) throw simulatorError(failureCode);

    var wouldSend = observations.sentDraft !== '';
    if (!wouldSend && !approval) throw simulatorError('TRUSTEESHIP_SIMULATION_FAILED');
    var draft = wouldSend
      ? observations.sentDraft
      : (approval && typeof approval.draft === 'string' ? approval.draft : '');
    var draftEvidenceIds = observations.draft &&
      Array.isArray(observations.draft.evidenceIds)
      ? observations.draft.evidenceIds.filter(function (id) {
        return typeof id === 'string' && id.trim() !== '';
      }).map(function (id) { return id.slice(0, 160); }).slice(0, 40)
      : [];

    return {
      conversationId: input.conversationId,
      message: input.message,
      classification: safeClassification(observations.classification),
      decision: {
        action: wouldSend ? 'AUTO_REPLY' : 'REQUIRE_CONFIRMATION',
        reasonCode: wouldSend
          ? 'AUTO_REPLY_ALLOWED'
          : approval.reasonCode
      },
      draft: draft.slice(0, 300),
      draftEvidenceIds: draftEvidenceIds,
      wouldSend: wouldSend,
      simulated: true
    };
  }

  function create(deps) {
    var source = deps && typeof deps === 'object' ? deps : {};
    return {
      simulate: async function (input) {
        input = validateInput(input);
        var production = await source.productionStore.getSnapshot();
        var conversation = production.managedConversations[input.conversationId];
        if (!conversation) throw simulatorError('CONVERSATION_NOT_FOUND');
        if (conversation.platform !== 'boss') throw simulatorError('UNSUPPORTED_PLATFORM');
        var memory = createMemoryStorage(seedSnapshot(production, conversation));
        var isolatedStore = source.storeModule.create(
          memory,
          source.clock,
          source.idFactory
        );
        var observations = {
          classification: null,
          draft: null,
          sentDraft: ''
        };
        var fingerprint = 'simulation:' + source.idFactory('message');
        var engine = source.engineModule.create({
          store: isolatedStore,
          reader: {
            read: async function (current) {
              return {
                success: true,
                conversationId: current.conversationId,
                conversationRef: {
                  conversationId: current.conversationId,
                  url: current.url
                },
                baseline: fingerprint,
                messages: [{
                  id: fingerprint,
                  direction: 'incoming',
                  kind: 'text',
                  text: input.message,
                  at: source.clock(),
                  fingerprint: fingerprint
                }]
              };
            },
            send: async function (current, draft, intent) {
              observations.sentDraft = draft;
              return {
                success: true,
                targetConversationId: current.conversationId,
                sentFingerprint: 'simulation-sent:' + intent.intentId,
                observedAt: source.clock()
              };
            }
          },
          classifier: {
            classify: async function (classifierInput) {
              observations.classification = await source.classifier.classify(classifierInput);
              return observations.classification;
            },
            draft: async function (classifierInput) {
              observations.draft = await source.classifier.draft(classifierInput);
              return observations.draft;
            }
          },
          notifier: {
            notifyApproval: async function () { return { ok: true, code: 'OK' }; },
            notifyResolved: async function () { return { ok: true, code: 'OK' }; }
          },
          policy: source.policy,
          clock: function () { return new Date(source.clock()); },
          getResumeFacts: source.getResumeFacts
        });

        var summary;
        try {
          summary = await engine.runCycle();
        } catch (_) {
          throw simulatorError('TRUSTEESHIP_SIMULATION_FAILED');
        }
        return projectResult(
          input,
          observations,
          await isolatedStore.getSnapshot(),
          summary
        );
      }
    };
  }

  return { create: create };
});
