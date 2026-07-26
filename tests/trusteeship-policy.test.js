const test = require('node:test');
const assert = require('node:assert/strict');

const Policy = require('../src/conversation/trusteeship-policy.js');

function safeDecision(overrides) {
  return Object.assign({
    hardRisk: { blocked: false, reasonCode: 'NO_HARD_RISK' },
    ai: { category: 'courtesy', confidence: 0.85, evidenceIds: ['resume-1'] },
    settings: { enabled: true, dailyAutoReplyLimit: 10 },
    dailyCount: 0,
    conversationEnabled: true,
    hasPendingApproval: false,
    quiet: false
  }, overrides);
}

function explicitRejectionDecision(overrides) {
  return safeDecision(Object.assign({
    hardRisk: {
      blocked: true,
      reasonCode: 'HARD_RISK_SALARY',
      fieldsNeeded: ['salaryExpectation']
    },
    settings: { enabled: true, dailyAutoReplyLimit: 1 },
    dailyCount: 99,
    ai: {
      category: 'explicit_rejection',
      confidence: 0.96,
      reasonCode: 'EXPLICIT_REJECTION',
      evidenceIds: [],
      fieldsNeeded: []
    }
  }, overrides));
}

test('defaults global trusteeship on while keeping quiet hours off', () => {
  const source = {};
  const cfg = Policy.normalizeSettings(source);

  assert.notEqual(cfg, source);
  assert.equal(cfg.enabled, true);
  assert.equal(Policy.normalizeSettings({ enabled: false }).enabled, false);
  assert.equal(cfg.intervalMinutes, 10);
  assert.equal(cfg.dailyAutoReplyLimit, 10);
  assert.equal(cfg.quietHours.enabled, false);
});

test('normalizes supported intervals and clamps the daily auto-reply limit to one through twenty', () => {
  assert.equal(Policy.normalizeSettings({ intervalMinutes: 5 }).intervalMinutes, 5);
  assert.equal(Policy.normalizeSettings({ intervalMinutes: 15 }).intervalMinutes, 15);
  assert.equal(Policy.normalizeSettings({ intervalMinutes: 6 }).intervalMinutes, 10);
  assert.equal(Policy.normalizeSettings({ dailyAutoReplyLimit: 0 }).dailyAutoReplyLimit, 1);
  assert.equal(Policy.normalizeSettings({ dailyAutoReplyLimit: 99 }).dailyAutoReplyLimit, 20);
});

test('hard-blocks every important question category with a stable reason code', () => {
  const cases = [
    ['你的期望薪资是多少？', 'HARD_RISK_SALARY'],
    ['明天下午两点可以来面试吗？', 'HARD_RISK_INTERVIEW'],
    ['最快什么时候到岗？', 'HARD_RISK_ARRIVAL'],
    ['方便说一下离职原因吗？', 'HARD_RISK_RESIGNATION'],
    ['加一下微信吧', 'HARD_RISK_CONTACT'],
    ['请完成测评并确认参加', 'HARD_RISK_COMMITMENT']
  ];

  for (const [text, reasonCode] of cases) {
    const risk = Policy.detectHardRisk({ text, kind: 'text' });
    assert.equal(risk.blocked, true, text);
    assert.equal(risk.reasonCode, reasonCode, text);
    assert.ok(Array.isArray(risk.fieldsNeeded), text);
  }
});

test('hard-blocks conservative compensation, assessment, and experience variants', () => {
  const cases = [
    ['月薪 20k 可以吗？', 'HARD_RISK_SALARY'],
    ['年薪期望是多少？', 'HARD_RISK_SALARY'],
    ['需要做笔试吗？', 'HARD_RISK_COMMITMENT'],
    ['后续有机试吗？', 'HARD_RISK_COMMITMENT'],
    ['会提供测试题吗？', 'HARD_RISK_COMMITMENT'],
    ['能展开说说你的工作经验吗？', 'HARD_RISK_EXPERIENCE'],
    ['方便介绍一下项目经验吗？', 'HARD_RISK_EXPERIENCE']
  ];

  for (const [text, reasonCode] of cases) {
    assert.equal(Policy.detectHardRisk({ text, kind: 'text' }).reasonCode, reasonCode, text);
  }
});

test('blocks explicit English salary packages but not ordinary package manager discussion', () => {
  assert.deepEqual(Policy.detectHardRisk({
    text: 'I use a package manager for dependencies.', kind: 'text'
  }), {
    blocked: false,
    reasonCode: 'NO_HARD_RISK',
    fieldsNeeded: []
  });
  for (const text of ['What salary package do you offer?', 'Please describe the compensation package.']) {
    assert.equal(Policy.detectHardRisk({ text, kind: 'text' }).reasonCode, 'HARD_RISK_SALARY', text);
  }
});

test('hard-blocks mixed ordinary and important questions before AI can allow them', () => {
  const risk = Policy.detectHardRisk({
    text: '还在看机会吗，薪资期望多少？',
    kind: 'text'
  });

  assert.deepEqual(risk, {
    blocked: true,
    reasonCode: 'HARD_RISK_SALARY',
    fieldsNeeded: ['salaryExpectation']
  });
  assert.deepEqual(Policy.decide(safeDecision({
    hardRisk: risk,
    ai: { category: 'courtesy', confidence: 1, evidenceIds: ['resume-1'] }
  })), {
    action: 'REQUIRE_CONFIRMATION',
    reasonCode: 'HARD_RISK_SALARY'
  });
});

test('treats attachments, voice, and unknown kinds as manual confirmation', () => {
  for (const kind of ['image', 'attachment', 'voice', 'video', 'unknown']) {
    assert.deepEqual(Policy.detectHardRisk({ text: '请查收', kind }), {
      blocked: true,
      reasonCode: 'NON_TEXT_MESSAGE',
      fieldsNeeded: ['messageText']
    });
  }
});

test('recognizes text-only messages as not hard-risk when no important topic is present', () => {
  assert.deepEqual(Policy.detectHardRisk({ text: '您好，还在看机会吗？', kind: 'text' }), {
    blocked: false,
    reasonCode: 'NO_HARD_RISK',
    fieldsNeeded: []
  });
});

test('isQuietHours supports ordinary and cross-midnight configured windows', () => {
  assert.equal(Policy.isQuietHours(new Date('2026-07-24T12:00:00'), {
    enabled: true, start: '09:00', end: '18:00'
  }), true);
  assert.equal(Policy.isQuietHours(new Date('2026-07-24T18:00:00'), {
    enabled: true, start: '09:00', end: '18:00'
  }), false);
  assert.equal(Policy.isQuietHours(new Date('2026-07-24T23:30:00'), {
    enabled: true, start: '22:00', end: '08:00'
  }), true);
  assert.equal(Policy.isQuietHours(new Date('2026-07-24T07:30:00'), {
    enabled: true, start: '22:00', end: '08:00'
  }), true);
  assert.equal(Policy.isQuietHours(new Date('2026-07-24T12:00:00'), {
    enabled: false, start: '22:00', end: '08:00'
  }), false);
});

test('allows each approved low-risk category only with sufficient confidence and evidence', () => {
  for (const category of [
    'still_looking', 'resume_permission', 'courtesy', 'please_wait', 'resume_fact'
  ]) {
    assert.deepEqual(Policy.decide(safeDecision({
      ai: { category, confidence: 0.85, evidenceIds: ['resume-1'] }
    })), {
      action: 'AUTO_REPLY',
      reasonCode: 'AUTO_REPLY_ALLOWED'
    });
  }
});

test('requires confirmation below confidence or without resume evidence', () => {
  assert.deepEqual(Policy.decide(safeDecision({
    ai: { category: 'resume_fact', confidence: 0.84, evidenceIds: ['r1'] }
  })), {
    action: 'REQUIRE_CONFIRMATION',
    reasonCode: 'AI_CONFIDENCE_TOO_LOW'
  });
  assert.deepEqual(Policy.decide(safeDecision({
    ai: { category: 'resume_fact', confidence: 0.99, evidenceIds: [] }
  })), {
    action: 'REQUIRE_CONFIRMATION',
    reasonCode: 'MISSING_RESUME_EVIDENCE'
  });
});

test('AI-only explicit rejection bypasses hard risk and daily quota but defers in quiet hours', () => {
  assert.deepEqual(Policy.decide(explicitRejectionDecision()), {
    action: 'AUTO_CLOSE',
    reasonCode: 'EXPLICIT_REJECTION_AUTO_CLOSE'
  });
  assert.deepEqual(Policy.decide(explicitRejectionDecision({ quiet: true })), {
    action: 'DEFER_AUTO_CLOSE',
    reasonCode: 'QUIET_HOURS_AUTO_CLOSE'
  });
});

test('explicit rejection still requires global, conversation, and pending-approval authorization', () => {
  assert.deepEqual(Policy.decide(explicitRejectionDecision({
    settings: { enabled: false, dailyAutoReplyLimit: 1 }
  })), {
    action: 'REQUIRE_CONFIRMATION',
    reasonCode: 'TRUSTEESHIP_DISABLED'
  });
  assert.deepEqual(Policy.decide(explicitRejectionDecision({
    conversationEnabled: false
  })), {
    action: 'REQUIRE_CONFIRMATION',
    reasonCode: 'CONVERSATION_NOT_MANAGED'
  });
  assert.deepEqual(Policy.decide(explicitRejectionDecision({
    hasPendingApproval: true
  })), {
    action: 'REQUIRE_CONFIRMATION',
    reasonCode: 'PENDING_APPROVAL_EXISTS'
  });
});

test('explicit rejection confidence and structured fields fail closed', () => {
  const invalid = [
    { confidence: 0.89 },
    { reasonCode: 'OTHER_REASON' },
    { evidenceIds: ['resume-1'] },
    { fieldsNeeded: ['rejectionReason'] }
  ];
  for (const patch of invalid) {
    const ai = Object.assign({}, explicitRejectionDecision().ai, patch);
    assert.deepEqual(Policy.decide(explicitRejectionDecision({ ai })), {
      action: 'REQUIRE_CONFIRMATION',
      reasonCode: patch.confidence === 0.89
        ? 'AI_CONFIDENCE_TOO_LOW'
        : 'CATEGORY_REQUIRES_CONFIRMATION'
    });
  }
});

test('validates a short polite close without inspecting the HR message', () => {
  assert.deepEqual(
    Policy.validateAutoCloseDraft('收到，感谢您的回复，祝工作顺利。'),
    {
      ok: true,
      draft: '收到，感谢您的回复，祝工作顺利。',
      reasonCode: 'AUTO_CLOSE_DRAFT_VALID'
    }
  );

  for (const unsafe of [
    '',
    '请问为什么不合适？',
    '能再考虑一下吗',
    '我有三年经验\n可以胜任',
    '薪资和到岗时间都可以商量',
    '感谢您的回复，'.repeat(7)
  ]) {
    const result = Policy.validateAutoCloseDraft(unsafe);
    assert.equal(result.ok, false, unsafe);
    assert.equal(typeof result.reasonCode, 'string', unsafe);
  }
});

test('requires explicit global and conversation enablement before any auto-reply', () => {
  assert.deepEqual(Policy.decide(safeDecision({
    settings: { enabled: false, dailyAutoReplyLimit: 10 }
  })), {
    action: 'REQUIRE_CONFIRMATION',
    reasonCode: 'TRUSTEESHIP_DISABLED'
  });
  assert.deepEqual(Policy.decide(safeDecision({ conversationEnabled: false })), {
    action: 'REQUIRE_CONFIRMATION',
    reasonCode: 'CONVERSATION_NOT_MANAGED'
  });
});

test('fails closed when settings or conversation enablement is omitted', () => {
  assert.deepEqual(Policy.decide(safeDecision({ settings: undefined })), {
    action: 'REQUIRE_CONFIRMATION',
    reasonCode: 'TRUSTEESHIP_DISABLED'
  });
  assert.deepEqual(Policy.decide(safeDecision({ settings: null })), {
    action: 'REQUIRE_CONFIRMATION',
    reasonCode: 'TRUSTEESHIP_DISABLED'
  });
  // 空对象表示未显式关闭 → 全局默认开，但仍要求单岗位显式托管
  assert.notEqual(
    Policy.decide(safeDecision({ settings: {} })).reasonCode,
    'TRUSTEESHIP_DISABLED'
  );
  const withoutConversationGate = safeDecision();
  delete withoutConversationGate.conversationEnabled;
  assert.deepEqual(Policy.decide(withoutConversationGate), {
    action: 'REQUIRE_CONFIRMATION',
    reasonCode: 'CONVERSATION_NOT_MANAGED'
  });
});

test('requires confirmation for quiet hours, pending approval, AI failure, category misses, and daily limit', () => {
  const cases = [
    [{ quiet: true }, 'QUIET_HOURS'],
    [{ hasPendingApproval: true }, 'PENDING_APPROVAL_EXISTS'],
    [{ ai: null }, 'AI_UNAVAILABLE'],
    [{ ai: { category: 'work_history', confidence: 1, evidenceIds: ['r1'] } }, 'CATEGORY_REQUIRES_CONFIRMATION'],
    [{ dailyCount: 10 }, 'DAILY_AUTO_REPLY_LIMIT_REACHED']
  ];

  for (const [overrides, reasonCode] of cases) {
    const result = Policy.decide(safeDecision(overrides));
    assert.deepEqual(result, { action: 'REQUIRE_CONFIRMATION', reasonCode });
  }
});

test('decide does not mutate caller-owned objects and always supplies a stable reason code', () => {
  const input = safeDecision({
    settings: { enabled: true, dailyAutoReplyLimit: 99 },
    ai: { category: 'courtesy', confidence: 0.99, evidenceIds: ['r1'] }
  });
  const before = structuredClone(input);
  const result = Policy.decide(input);

  assert.deepEqual(input, before);
  assert.deepEqual(result, {
    action: 'AUTO_REPLY',
    reasonCode: 'AUTO_REPLY_ALLOWED'
  });
  assert.equal(typeof result.reasonCode, 'string');
});
