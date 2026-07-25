// 对话托管的纯确定性策略：重要风险永远先于 AI 分类结果。
(function (g, factory) {
  var api = factory();
  g.TrusteeshipPolicy = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  var AUTO_CATEGORIES = new Set([
    'still_looking', 'resume_permission', 'courtesy', 'please_wait', 'resume_fact'
  ]);
  var DEFAULT_QUIET_HOURS = { enabled: false, start: '22:00', end: '08:00' };

  var HARD_RISKS = [
    { code: 'HARD_RISK_SALARY', fields: ['salaryExpectation'], pattern: /薪资|薪水|工资|薪酬|月薪|年薪|待遇|\b(?:salary|compensation)\s+package\b/i },
    { code: 'HARD_RISK_INTERVIEW', fields: ['interviewAvailability'], pattern: /面试|约面|面谈|复试|初试|改期/i },
    { code: 'HARD_RISK_ARRIVAL', fields: ['availabilityDate'], pattern: /到岗|入职|在职状态|何时入职/i },
    { code: 'HARD_RISK_RESIGNATION', fields: ['resignationReason'], pattern: /离职原因|为什么离职|为何离职/i },
    { code: 'HARD_RISK_CONTACT', fields: ['contactMethod'], pattern: /微信|电话|手机|邮箱|身份证|联系方式|加我/i },
    { code: 'HARD_RISK_EXPERIENCE', fields: ['experienceDetails'], pattern: /项目经历|项目经验|工作经历|工作经验|具体负责|详细介绍/i },
    { code: 'HARD_RISK_COMMITMENT', fields: ['commitmentConfirmation'], pattern: /测评|笔试|机试|测试题|作业|offer|录用|承诺|保证/i }
  ];

  function clamp(value, min, max) {
    return Math.min(max, Math.max(min, value));
  }

  function readInteger(value, fallback) {
    if (typeof value === 'string' && value.trim() === '') return fallback;
    var parsed = Number(value);
    if (!Number.isFinite(parsed)) return fallback;
    return Math.floor(parsed);
  }

  function normalizeTime(value, fallback) {
    if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
      return fallback;
    }
    return value;
  }

  function normalizeSettings(input) {
    // 缺少 settings 对象时失败关闭；空对象表示「未写过开关」→ 全局默认开
    if (input == null || typeof input !== 'object') {
      return {
        enabled: false,
        intervalMinutes: 10,
        dailyAutoReplyLimit: 10,
        quietHours: {
          enabled: DEFAULT_QUIET_HOURS.enabled,
          start: DEFAULT_QUIET_HOURS.start,
          end: DEFAULT_QUIET_HOURS.end
        }
      };
    }
    var source = input;
    var quietSource = source.quietHours && typeof source.quietHours === 'object'
      ? source.quietHours
      : {};
    var interval = readInteger(source.intervalMinutes, 10);
    var dailyLimit = readInteger(source.dailyAutoReplyLimit, 10);

    return {
      // 全局托管默认开启；显式 false 仍关闭。单岗位托管仍默认关。
      enabled: Object.prototype.hasOwnProperty.call(source, 'enabled')
        ? source.enabled === true
        : true,
      intervalMinutes: interval === 5 || interval === 10 || interval === 15 ? interval : 10,
      dailyAutoReplyLimit: clamp(dailyLimit, 1, 20),
      quietHours: {
        enabled: quietSource.enabled === true,
        start: normalizeTime(quietSource.start, DEFAULT_QUIET_HOURS.start),
        end: normalizeTime(quietSource.end, DEFAULT_QUIET_HOURS.end)
      }
    };
  }

  function risk(blocked, reasonCode, fieldsNeeded) {
    return {
      blocked: blocked,
      reasonCode: reasonCode,
      fieldsNeeded: fieldsNeeded.slice()
    };
  }

  function detectHardRisk(message) {
    var source = message && typeof message === 'object' ? message : {};
    if (source.kind !== 'text' || typeof source.text !== 'string') {
      return risk(true, 'NON_TEXT_MESSAGE', ['messageText']);
    }

    for (var index = 0; index < HARD_RISKS.length; index += 1) {
      var definition = HARD_RISKS[index];
      if (definition.pattern.test(source.text)) {
        return risk(true, definition.code, definition.fields);
      }
    }
    return risk(false, 'NO_HARD_RISK', []);
  }

  function timeToMinutes(value) {
    if (typeof value !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) return null;
    return (Number(value.slice(0, 2)) * 60) + Number(value.slice(3, 5));
  }

  function isQuietHours(now, quietHours) {
    if (!quietHours || quietHours.enabled !== true || !(now instanceof Date) || Number.isNaN(now.getTime())) {
      return false;
    }
    var start = timeToMinutes(quietHours.start);
    var end = timeToMinutes(quietHours.end);
    if (start === null || end === null || start === end) return false;

    var current = (now.getHours() * 60) + now.getMinutes();
    if (start < end) return current >= start && current < end;
    return current >= start || current < end;
  }

  function hasEvidence(evidenceIds) {
    return Array.isArray(evidenceIds) && evidenceIds.some(function (id) {
      return typeof id === 'string' && id.trim() !== '';
    });
  }

  function decision(action, reasonCode) {
    return { action: action, reasonCode: reasonCode };
  }

  function decide(input) {
    var source = input && typeof input === 'object' ? input : {};
    var hardRisk = source.hardRisk && typeof source.hardRisk === 'object' ? source.hardRisk : null;
    if (!hardRisk) return decision('REQUIRE_CONFIRMATION', 'HARD_RISK_UNAVAILABLE');
    if (hardRisk.blocked === true) {
      return decision('REQUIRE_CONFIRMATION',
        typeof hardRisk.reasonCode === 'string' && hardRisk.reasonCode ? hardRisk.reasonCode : 'HARD_RISK_BLOCKED');
    }
    var settings = normalizeSettings(source.settings);
    if (settings.enabled !== true) return decision('REQUIRE_CONFIRMATION', 'TRUSTEESHIP_DISABLED');
    if (source.conversationEnabled !== true) return decision('REQUIRE_CONFIRMATION', 'CONVERSATION_NOT_MANAGED');
    if (source.quiet === true) return decision('REQUIRE_CONFIRMATION', 'QUIET_HOURS');
    if (source.hasPendingApproval === true) return decision('REQUIRE_CONFIRMATION', 'PENDING_APPROVAL_EXISTS');

    var dailyCount = Math.max(0, readInteger(source.dailyCount, 0));
    if (dailyCount >= settings.dailyAutoReplyLimit) {
      return decision('REQUIRE_CONFIRMATION', 'DAILY_AUTO_REPLY_LIMIT_REACHED');
    }

    var ai = source.ai;
    if (!ai || typeof ai !== 'object' || ai.error || ai.failed || typeof ai.category !== 'string') {
      return decision('REQUIRE_CONFIRMATION', 'AI_UNAVAILABLE');
    }
    if (!AUTO_CATEGORIES.has(ai.category)) {
      return decision('REQUIRE_CONFIRMATION', 'CATEGORY_REQUIRES_CONFIRMATION');
    }
    if (typeof ai.confidence !== 'number' || !Number.isFinite(ai.confidence) || ai.confidence < 0.85) {
      return decision('REQUIRE_CONFIRMATION', 'AI_CONFIDENCE_TOO_LOW');
    }
    if (!hasEvidence(ai.evidenceIds)) {
      return decision('REQUIRE_CONFIRMATION', 'MISSING_RESUME_EVIDENCE');
    }
    return decision('AUTO_REPLY', 'AUTO_REPLY_ALLOWED');
  }

  return {
    normalizeSettings: normalizeSettings,
    detectHardRisk: detectHardRisk,
    isQuietHours: isQuietHours,
    decide: decide
  };
});
