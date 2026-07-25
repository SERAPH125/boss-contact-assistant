// AI 输入/输出契约：仅构造白名单上下文并严格校验模型 JSON，绝不决定发送。
(function (g, factory) {
  var api = factory();
  g.ReplyAI = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  var CATEGORIES = [
    'still_looking', 'resume_permission', 'courtesy', 'please_wait', 'resume_fact', 'important', 'unknown'
  ];
  var CATEGORY_SET = new Set(CATEGORIES);
  var CLASSIFICATION_KEYS = ['category', 'confidence', 'reasonCode', 'evidenceIds', 'fieldsNeeded'];
  var DRAFT_KEYS = ['draft', 'evidenceIds'];
  var MAX_MESSAGES = 20;
  var MAX_MESSAGE_CHARS = 600;
  var MAX_FACTS = 40;
  var MAX_FACT_CHARS = 600;
  var MAX_ID_CHARS = 160;
  var MAX_DRAFT_CODE_POINTS = 300;

  function fail(code) {
    var error = new Error('AI output could not be accepted.');
    error.code = code;
    throw error;
  }

  function isPlainObject(value) {
    return value !== null && typeof value === 'object' && !Array.isArray(value);
  }

  function nonEmptyString(value, maxLength) {
    return typeof value === 'string' && value.trim() !== '' && value.length <= maxLength;
  }

  function copyText(value, maxLength) {
    return typeof value === 'string' ? value.slice(0, maxLength) : '';
  }

  function getTarget(source) {
    var candidate = source.target || source.targetIdentity || source.targetJob || {};
    candidate = isPlainObject(candidate) ? candidate : {};
    return {
      company: copyText(candidate.company, 160),
      position: copyText(candidate.position || candidate.jobTitle, 160),
      hrName: copyText(candidate.hrName || candidate.recruiterName, 120),
      jobId: copyText(candidate.jobId, 120)
    };
  }

  function getMessages(source) {
    var items = Array.isArray(source.targetMessages) ? source.targetMessages
      : Array.isArray(source.messages) ? source.messages : [];
    return items.slice(-MAX_MESSAGES).map(function (item) {
      var message = isPlainObject(item) ? item : {};
      return {
        role: message.role === 'candidate' || message.role === 'assistant' ? 'candidate' : 'recruiter',
        text: copyText(message.text, MAX_MESSAGE_CHARS)
      };
    }).filter(function (item) { return item.text.trim() !== ''; });
  }

  function getResumeFacts(source) {
    var items = Array.isArray(source.resumeFacts) ? source.resumeFacts : [];
    return items.slice(0, MAX_FACTS).map(function (item, index) {
      var fact = isPlainObject(item) ? item : {};
      var id = copyText(fact.id, MAX_ID_CHARS);
      var text = copyText(fact.text, MAX_FACT_CHARS);
      if (id.trim() === '' || text.trim() === '') return null;
      return { id: id, text: text, number: index + 1 };
    }).filter(Boolean);
  }

  function boundedContext(input) {
    var source = isPlainObject(input) ? input : {};
    return {
      target: getTarget(source),
      messages: getMessages(source),
      resumeFacts: getResumeFacts(source)
    };
  }

  function systemPrompt(kind) {
    var task = kind === 'draft'
      ? 'Draft a concise Chinese reply supported only by the supplied resume facts.'
      : 'Classify the newest recruiter message using the supplied target conversation and resume facts.';
    return [
      'You are an assistant in a job-conversation workflow.',
      task,
      'The deterministic policy is authoritative. It runs after you and can reject every result.',
      'Important topics including salary/薪资, interview/面试, arrival or start date/到岗, resignation, contact details, experience expansion, assessments, offers, or commitments cannot be auto-approved.',
      'Use only approved categories: ' + CATEGORIES.join(', ') + '.',
      'Return exactly one JSON object with no prose and no markdown fences.',
      kind === 'draft'
        ? 'Schema: {"draft":"nonempty string no longer than 300 Unicode code points","evidenceIds":["nonempty resume fact id"]}. Evidence IDs must be nonempty and unique.'
        : 'Schema: {"category":"approved category","confidence":0..1,"reasonCode":"nonempty string","evidenceIds":["resume fact id"],"fieldsNeeded":["nonempty field name"]}. resume_fact requires evidenceIds.'
    ].join('\n');
  }

  function buildMessages(input, kind) {
    return [
      { role: 'system', content: systemPrompt(kind) },
      { role: 'user', content: JSON.stringify(boundedContext(input)) }
    ];
  }

  // JSON.parse accepts duplicate keys; walk the source first so ambiguous model output fails closed.
  function assertNoDuplicateKeys(text) {
    var index = 0;
    function whitespace() {
      while (/\s/.test(text.charAt(index))) index += 1;
    }
    function string() {
      var start = index;
      if (text.charAt(index) !== '"') fail('AI_OUTPUT_INVALID');
      index += 1;
      while (index < text.length) {
        var ch = text.charAt(index);
        if (ch === '\\') { index += 2; continue; }
        index += 1;
        if (ch === '"') {
          try { return JSON.parse(text.slice(start, index)); } catch (_) { fail('AI_OUTPUT_INVALID'); }
        }
      }
      fail('AI_OUTPUT_INVALID');
    }
    function value() {
      whitespace();
      var ch = text.charAt(index);
      if (ch === '{') return object();
      if (ch === '[') return array();
      if (ch === '"') return string();
      var start = index;
      while (index < text.length && !/[\s,}\]]/.test(text.charAt(index))) index += 1;
      if (start === index) fail('AI_OUTPUT_INVALID');
    }
    function object() {
      var keys = new Set();
      index += 1;
      whitespace();
      if (text.charAt(index) === '}') { index += 1; return; }
      while (index < text.length) {
        whitespace();
        var key = string();
        if (keys.has(key)) fail('AI_OUTPUT_DUPLICATE_KEY');
        keys.add(key);
        whitespace();
        if (text.charAt(index) !== ':') fail('AI_OUTPUT_INVALID');
        index += 1;
        value();
        whitespace();
        if (text.charAt(index) === '}') { index += 1; return; }
        if (text.charAt(index) !== ',') fail('AI_OUTPUT_INVALID');
        index += 1;
      }
      fail('AI_OUTPUT_INVALID');
    }
    function array() {
      index += 1;
      whitespace();
      if (text.charAt(index) === ']') { index += 1; return; }
      while (index < text.length) {
        value();
        whitespace();
        if (text.charAt(index) === ']') { index += 1; return; }
        if (text.charAt(index) !== ',') fail('AI_OUTPUT_INVALID');
        index += 1;
      }
      fail('AI_OUTPUT_INVALID');
    }
    value();
    whitespace();
    if (index !== text.length) fail('AI_OUTPUT_INVALID');
  }

  function unwrapJson(text) {
    if (typeof text !== 'string') fail('AI_OUTPUT_INVALID');
    var fenced = /^\s*```json[ \t]*\r?\n([\s\S]*?)\r?\n```[ \t]*\s*$/i.exec(text);
    var candidate = fenced ? fenced[1] : text.trim();
    if (candidate === '') fail('AI_OUTPUT_INVALID');
    assertNoDuplicateKeys(candidate);
    var parsed;
    try { parsed = JSON.parse(candidate); } catch (_) { fail('AI_OUTPUT_INVALID'); }
    if (!isPlainObject(parsed)) fail('AI_OUTPUT_INVALID');
    return parsed;
  }

  function hasExactKeys(value, allowed) {
    var keys = Object.keys(value);
    return keys.length === allowed.length && keys.every(function (key) { return allowed.indexOf(key) !== -1; });
  }

  function validateIds(value, code) {
    if (!Array.isArray(value)) fail(code);
    var seen = new Set();
    value.forEach(function (id) {
      if (!nonEmptyString(id, MAX_ID_CHARS) || seen.has(id)) fail(code);
      seen.add(id);
    });
    return value.slice();
  }

  function validateFields(value) {
    if (!Array.isArray(value)) fail('AI_CLASSIFICATION_INVALID');
    var seen = new Set();
    value.forEach(function (field) {
      if (!nonEmptyString(field, 120) || seen.has(field)) fail('AI_CLASSIFICATION_INVALID');
      seen.add(field);
    });
    return value.slice();
  }

  function parseClassification(text) {
    var value = unwrapJson(text);
    if (!hasExactKeys(value, CLASSIFICATION_KEYS)) fail('AI_CLASSIFICATION_INVALID');
    if (!CATEGORY_SET.has(value.category) || typeof value.confidence !== 'number' ||
      !Number.isFinite(value.confidence) || value.confidence < 0 || value.confidence > 1 ||
      !nonEmptyString(value.reasonCode, 120)) fail('AI_CLASSIFICATION_INVALID');
    var evidenceIds = validateIds(value.evidenceIds, 'AI_CLASSIFICATION_INVALID');
    var fieldsNeeded = validateFields(value.fieldsNeeded);
    if (value.category === 'resume_fact' && evidenceIds.length === 0) fail('AI_EVIDENCE_MISSING');
    return {
      category: value.category,
      confidence: value.confidence,
      reasonCode: value.reasonCode,
      evidenceIds: evidenceIds,
      fieldsNeeded: fieldsNeeded
    };
  }

  function parseDraft(text) {
    var value = unwrapJson(text);
    if (!hasExactKeys(value, DRAFT_KEYS)) fail('AI_DRAFT_INVALID');
    if (typeof value.draft !== 'string' || value.draft.trim() === '' ||
      Array.from(value.draft).length > MAX_DRAFT_CODE_POINTS) fail('AI_DRAFT_INVALID');
    var evidenceIds = validateIds(value.evidenceIds, 'AI_EVIDENCE_MISSING');
    if (evidenceIds.length === 0) fail('AI_EVIDENCE_MISSING');
    return { draft: value.draft, evidenceIds: evidenceIds };
  }

  return {
    buildClassificationMessages: function (input) { return buildMessages(input, 'classification'); },
    parseClassification: parseClassification,
    buildDraftMessages: function (input) { return buildMessages(input, 'draft'); },
    parseDraft: parseDraft
  };
});
