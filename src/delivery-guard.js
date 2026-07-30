// 批次确认安全闸门：纯计划计算 + 一次性确认意图
(function (g, factory) {
  var api = factory();
  g.DeliveryGuard = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  var INTENT_KEY = 'sw_pending_delivery';
  var INTENT_TTL_MS = 120000;
  var DELIVERY_MODES = {
    CONTACT_ONLY: 'CONTACT_ONLY',
    CONTACT_AND_TRUSTEESHIP: 'CONTACT_AND_TRUSTEESHIP'
  };

  var GUIDANCE = {
    NO_SELECTION: {
      message: '尚未选择岗位',
      nextAction: '返回岗位筛选并勾选岗位'
    },
    STALE_REVIEW: {
      message: '岗位列表已变化，无法确认当前批次',
      nextAction: '重新扫描当前平台'
    },
    PLATFORM_MISMATCH: {
      message: '岗位与当前平台不一致',
      nextAction: '重新扫描当前平台'
    },
    DELIVERY_MODE_INVALID: {
      message: '批次联系模式无效',
      nextAction: '返回岗位筛选并重新选择联系方式'
    },
    TRUSTEESHIP_PLATFORM_UNSUPPORTED: {
      message: '当前平台暂不支持 AI 托管',
      nextAction: '使用“联系已选”，或切换到 Boss'
    },
    TRUSTEESHIP_PREREQUISITE_FAILED: {
      message: 'AI 托管配置尚未完成',
      nextAction: '完成 API、回复依据、飞书测试和风险确认后重试'
    },
    TRUSTEESHIP_NOT_RUNNING: {
      message: 'AI 托管尚未开启',
      nextAction: '先在 AI 托管页开启并保存设置'
    },
    NO_AVAILABLE_JOBS: {
      message: '所选岗位都已联系过',
      nextAction: '返回岗位筛选或重新扫描'
    },
    DAILY_LIMIT_REACHED: {
      message: '今日联系额度已用完',
      nextAction: '明日再试'
    },
    DAILY_LIMIT_EXCEEDED: {
      message: '所选岗位超过今日剩余额度',
      nextAction: '减少选择后重新确认'
    },
    CONFIRMATION_REQUIRED: {
      message: '联系前必须先确认批次',
      nextAction: '重新打开批次确认单'
    },
    INTENT_NOT_FOUND: {
      message: '确认单已失效',
      nextAction: '重新确认当前批次'
    },
    INTENT_EXPIRED: {
      message: '确认已超过两分钟并失效',
      nextAction: '重新确认当前批次'
    },
    INTENT_ALREADY_USED: {
      message: '该批次已经启动过',
      nextAction: '查看当前执行状态'
    },
    LOGIN_REQUIRED: {
      message: '当前平台登录已失效',
      nextAction: '登录后重新扫描'
    },
    SELECTOR_UNAVAILABLE: {
      message: '招聘网站页面已变化，无法安全定位操作',
      nextAction: '停止使用该平台并更新适配器'
    },
    TARGET_UNCERTAIN: {
      message: '无法确认当前会话对应的岗位或公司',
      nextAction: '在招聘平台人工核对，不自动发送'
    },
    SEND_RESULT_UNKNOWN: {
      message: '无法确认消息是否已发送',
      nextAction: '在招聘平台人工核对，不自动重试'
    },
    SERVICE_WORKER_INTERRUPTED: {
      message: '浏览器后台意外中断',
      nextAction: '核对招聘平台记录后重新扫描'
    },
    RUN_ACTIVE: {
      message: '已有任务正在执行',
      nextAction: '先停止或等待当前任务完成'
    },
    RUN_BLOCKED: {
      message: '任务已安全停机',
      nextAction: '核对招聘平台状态后重新扫描'
    }
  };

  function guidanceFor(code) {
    return GUIDANCE[code] || GUIDANCE.RUN_BLOCKED;
  }

  function runError(code, message, nextAction) {
    var guidance = guidanceFor(code);
    var error = new Error(message || guidance.message);
    error.code = code;
    error.nextAction = nextAction || guidance.nextAction;
    return error;
  }

  function normalizeIds(ids) {
    var seen = {};
    var result = [];
    (ids || []).forEach(function (id) {
      if (typeof id !== 'string') return;
      var clean = id.trim();
      if (!clean || seen[clean]) return;
      seen[clean] = true;
      result.push(clean);
    });
    return result;
  }

  function normalizeDeliveryMode(value) {
    if (value === undefined || value === null || value === '') {
      return DELIVERY_MODES.CONTACT_ONLY;
    }
    if (value === DELIVERY_MODES.CONTACT_ONLY ||
      value === DELIVERY_MODES.CONTACT_AND_TRUSTEESHIP) {
      return value;
    }
    throw runError('DELIVERY_MODE_INVALID');
  }

  function boundedInt(value, fallback, min) {
    var parsed = parseInt(value, 10);
    if (!Number.isFinite(parsed)) parsed = fallback;
    return Math.max(min, parsed);
  }

  function estimateWaitSeconds(count, config) {
    var cfg = config || {};
    var min = 0;
    var max = 0;
    var batchSize = boundedInt(cfg.batchSize, 5, 1);
    var intervalMin = boundedInt(cfg.intervalMinSec, 10, 5);
    var intervalMax = boundedInt(cfg.intervalMaxSec, 25, 6);
    var restMin = boundedInt(cfg.batchRestMinSec, 45, 0);
    var restMax = boundedInt(cfg.batchRestMaxSec, 90, 0);
    if (intervalMax < intervalMin) {
      var intervalSwap = intervalMin;
      intervalMin = intervalMax;
      intervalMax = intervalSwap;
    }
    if (restMax < restMin) {
      var restSwap = restMin;
      restMin = restMax;
      restMax = restSwap;
    }

    for (var completed = 1; completed < Math.max(0, Number(count) || 0); completed++) {
      if (completed % batchSize === 0) {
        min += restMin;
        max += restMax;
      } else {
        min += intervalMin;
        max += intervalMax;
      }
    }
    return { minSec: min, maxSec: max };
  }

  function prepare(input) {
    var data = input || {};
    var platformId = data.platformId || '';
    var deliveryMode = normalizeDeliveryMode(data.deliveryMode);
    if (deliveryMode === DELIVERY_MODES.CONTACT_AND_TRUSTEESHIP &&
      platformId !== 'boss') {
      throw runError('TRUSTEESHIP_PLATFORM_UNSUPPORTED');
    }
    var selectedIds = normalizeIds(data.selectedIds);
    if (!selectedIds.length) throw runError('NO_SELECTION');

    var jobs = Array.isArray(data.jobs) ? data.jobs : [];
    var jobById = {};
    jobs.forEach(function (job) {
      if (job && job.id) jobById[job.id] = job;
    });

    selectedIds.forEach(function (id) {
      var job = jobById[id];
      if (!job) throw runError('STALE_REVIEW');
      if (!job.platform || job.platform !== platformId) {
        throw runError('PLATFORM_MISMATCH');
      }
    });

    var processed = data.processed || {};
    var executableIds = selectedIds.filter(function (id) { return !processed[id]; });
    var skippedProcessedCount = selectedIds.length - executableIds.length;
    if (!executableIds.length) throw runError('NO_AVAILABLE_JOBS');

    var usageCount = Math.max(0, parseInt(data.usageCount, 10) || 0);
    var dailyLimit = Math.max(1, parseInt(data.dailyLimit, 10) || 20);
    var remainingBefore = Math.max(0, dailyLimit - usageCount);
    if (remainingBefore === 0) throw runError('DAILY_LIMIT_REACHED');
    if (executableIds.length > remainingBefore) {
      throw runError(
        'DAILY_LIMIT_EXCEEDED',
        '所选可联系岗位有 ' + executableIds.length + ' 个，今日仅剩 ' + remainingBefore + ' 个额度'
      );
    }

    var wait = estimateWaitSeconds(executableIds.length, data);
    return {
      platformId: platformId,
      deliveryMode: deliveryMode,
      selectedIds: selectedIds,
      executableIds: executableIds,
      selectedCount: selectedIds.length,
      executableCount: executableIds.length,
      skippedProcessedCount: skippedProcessedCount,
      usageCount: usageCount,
      dailyLimit: dailyLimit,
      remainingBefore: remainingBefore,
      remainingAfter: remainingBefore - executableIds.length,
      estimatedMinSec: wait.minSec,
      estimatedMaxSec: wait.maxSec,
      sendsResumeImage: !!data.sendsResumeImage,
      jobs: executableIds.map(function (id) {
        var job = jobById[id];
        return {
          id: id,
          name: job.name || '未命名岗位',
          company: job.company || '未知公司'
        };
      })
    };
  }

  function assertIntentMatchesPlan(intent, plan) {
    if (!intent || intent.platformId !== (plan && plan.platformId)) {
      throw runError('PLATFORM_MISMATCH');
    }
    if (normalizeDeliveryMode(intent.deliveryMode) !==
      normalizeDeliveryMode(plan && plan.deliveryMode)) {
      throw runError('STALE_REVIEW');
    }
    var frozenIds = normalizeIds(intent.jobIds);
    var currentIds = normalizeIds(plan && plan.executableIds);
    if (frozenIds.length !== currentIds.length) throw runError('STALE_REVIEW');
    for (var i = 0; i < frozenIds.length; i++) {
      if (frozenIds[i] !== currentIds[i]) throw runError('STALE_REVIEW');
    }
    return true;
  }

  function createIntentStore(storage, clock, idFactory) {
    var now = clock || function () { return Date.now(); };
    var makeId = idFactory || function () {
      return 'intent-' + Date.now() + '-' + Math.random().toString(16).slice(2);
    };
    var tail = Promise.resolve();

    function serialized(operation) {
      var result = tail.then(operation, operation);
      tail = result.catch(function () {});
      return result;
    }

    async function current() {
      var data = await storage.get(INTENT_KEY);
      return (data && data[INTENT_KEY]) || null;
    }

    function create(plan) {
      return serialized(async function () {
        var timestamp = now();
        var safePlan = JSON.parse(JSON.stringify(plan || {}));
        var intent = {
          id: makeId(),
          platformId: safePlan.platformId || '',
          deliveryMode: normalizeDeliveryMode(safePlan.deliveryMode),
          jobIds: normalizeIds(safePlan.executableIds),
          createdAt: timestamp,
          expiresAt: timestamp + INTENT_TTL_MS,
          status: 'pending',
          summary: {
            selectedCount: Number(safePlan.selectedCount) || 0,
            executableCount: Number(safePlan.executableCount) || normalizeIds(safePlan.executableIds).length,
            skippedProcessedCount: Number(safePlan.skippedProcessedCount) || 0,
            usageCount: Number(safePlan.usageCount) || 0,
            dailyLimit: Number(safePlan.dailyLimit) || 20,
            remainingAfter: Number(safePlan.remainingAfter) || 0,
            estimatedMinSec: Number(safePlan.estimatedMinSec) || 0,
            estimatedMaxSec: Number(safePlan.estimatedMaxSec) || 0,
            sendsResumeImage: !!safePlan.sendsResumeImage
          },
          jobs: Array.isArray(safePlan.jobs) ? safePlan.jobs : []
        };
        await storage.set({ [INTENT_KEY]: intent });
        return intent;
      });
    }

    function cancel(intentId) {
      return serialized(async function () {
        var intent = await current();
        if (!intent || intent.id !== intentId || intent.status !== 'pending') return false;
        var cancelled = Object.assign({}, intent, {
          status: 'cancelled',
          cancelledAt: now()
        });
        await storage.set({ [INTENT_KEY]: cancelled });
        return true;
      });
    }

    function consume(intentId) {
      return serialized(async function () {
        var intent = await current();
        if (!intent || intent.id !== intentId) throw runError('INTENT_NOT_FOUND');
        if (intent.status === 'consumed') throw runError('INTENT_ALREADY_USED');
        if (intent.status !== 'pending') throw runError('INTENT_NOT_FOUND');
        var timestamp = now();
        if (timestamp >= intent.expiresAt) {
          await storage.set({
            [INTENT_KEY]: Object.assign({}, intent, {
              status: 'expired',
              expiredAt: timestamp
            })
          });
          throw runError('INTENT_EXPIRED');
        }
        var consumed = Object.assign({}, intent, {
          status: 'consumed',
          consumedAt: timestamp
        });
        await storage.set({ [INTENT_KEY]: consumed });
        return consumed;
      });
    }

    return {
      cancel: cancel,
      consume: consume,
      create: create,
      current: current
    };
  }

  return {
    INTENT_KEY: INTENT_KEY,
    INTENT_TTL_MS: INTENT_TTL_MS,
    DELIVERY_MODES: DELIVERY_MODES,
    assertIntentMatchesPlan: assertIntentMatchesPlan,
    createIntentStore: createIntentStore,
    estimateWaitSeconds: estimateWaitSeconds,
    guidanceFor: guidanceFor,
    normalizeDeliveryMode: normalizeDeliveryMode,
    normalizeIds: normalizeIds,
    prepare: prepare,
    runError: runError
  };
});
