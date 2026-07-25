const test = require('node:test');
const assert = require('node:assert/strict');

const ReplyAI = require('../src/conversation/reply-ai.js');

function classification(overrides) {
  return JSON.stringify(Object.assign({
    category: 'courtesy',
    confidence: 0.95,
    reasonCode: 'CLASSIFIED_AS_LOW_RISK',
    evidenceIds: ['resume-line-1'],
    fieldsNeeded: []
  }, overrides));
}

function errorCode(fn) {
  assert.throws(fn, function (error) {
    assert.equal(typeof error.code, 'string');
    assert.equal(error.message.includes('api-key-secret'), false);
    return true;
  });
  try { fn(); } catch (error) { return error.code; }
}

const promptInput = {
  target: {
    company: '星河科技',
    position: '前端工程师',
    hrName: '李老师',
    feishuWebhook: 'https://open.feishu.cn/api/secret',
    apiKey: 'api-key-secret'
  },
  targetMessages: Array.from({ length: 24 }, function (_, index) {
    return { role: index % 2 ? 'candidate' : 'recruiter', text: '消息 ' + index, secret: 'api-key-secret' };
  }),
  resumeFacts: [
    { id: 'resume-line-1', text: '五年 Web 前端开发经验', privateNote: 'api-key-secret' }
  ],
  config: { feishuWebhook: 'https://open.feishu.cn/api/secret', apiKey: 'api-key-secret' }
};

test('parses one JSON object inside a markdown json fence', function () {
  const result = ReplyAI.parseClassification('```json\n' + classification() + '\n```');
  assert.deepEqual(result, JSON.parse(classification()));
});

test('fails closed on non-JSON, missing fields, unknown category, and invalid confidence', function () {
  for (const text of [
    'I think this is safe.',
    JSON.stringify({ category: 'courtesy' }),
    classification({ category: 'invented_category' }),
    classification({ confidence: 1.01 })
  ]) {
    assert.ok(errorCode(function () { ReplyAI.parseClassification(text); }).startsWith('AI_'));
  }
});

test('rejects classification prose, arrays, duplicate keys, unknown fields, and duplicate evidence IDs', function () {
  const duplicateKey = '{"category":"courtesy","category":"important","confidence":0.9,"reasonCode":"x","evidenceIds":["r1"],"fieldsNeeded":[]}';
  for (const text of [
    'Answer: ' + classification(),
    '[' + classification() + ']',
    duplicateKey,
    classification({ extra: true }),
    classification({ evidenceIds: ['r1', 'r1'] })
  ]) {
    assert.ok(errorCode(function () { ReplyAI.parseClassification(text); }).startsWith('AI_'));
  }
});

test('requires resume evidence for resume facts with a stable error code', function () {
  assert.equal(errorCode(function () {
    ReplyAI.parseClassification(classification({ category: 'resume_fact', evidenceIds: [] }));
  }), 'AI_EVIDENCE_MISSING');
});

test('parses only a bounded, evidence-backed draft schema', function () {
  assert.deepEqual(ReplyAI.parseDraft('```json\n{"draft":"您好，感谢您的联系。","evidenceIds":["resume-line-1"]}\n```'), {
    draft: '您好，感谢您的联系。',
    evidenceIds: ['resume-line-1']
  });

  for (const text of [
    '{"draft":"","evidenceIds":["resume-line-1"]}',
    '{"draft":"' + 'a'.repeat(301) + '","evidenceIds":["resume-line-1"]}',
    '{"draft":"谢谢","evidenceIds":[]}',
    '{"draft":"谢谢","evidenceIds":["resume-line-1"],"extra":true}',
    'Draft: {"draft":"谢谢","evidenceIds":["resume-line-1"]}'
  ]) {
    assert.ok(errorCode(function () { ReplyAI.parseDraft(text); }).startsWith('AI_'));
  }
});

test('classification prompt makes deterministic policy authoritative and excludes secrets', function () {
  const messages = ReplyAI.buildClassificationMessages(promptInput);
  const serialized = JSON.stringify(messages);
  assert.equal(messages.length, 2);
  assert.match(messages[0].content, /deterministic policy is authoritative/i);
  assert.match(messages[0].content, /salary|薪资/i);
  assert.match(messages[0].content, /interview|面试/i);
  assert.match(messages[0].content, /arrival|到岗/i);
  assert.match(messages[0].content, /cannot.*auto-approv/i);
  assert.match(serialized, /星河科技/);
  assert.match(serialized, /消息 4/);
  assert.doesNotMatch(serialized, /消息 0/);
  assert.doesNotMatch(serialized, /api-key-secret|open\.feishu\.cn/);
});

test('draft prompt has the same bounded allowlisted context and approved categories', function () {
  const messages = ReplyAI.buildDraftMessages(promptInput);
  const serialized = JSON.stringify(messages);
  assert.equal(messages.length, 2);
  assert.match(messages[0].content, /still_looking/);
  assert.match(messages[0].content, /deterministic policy is authoritative/i);
  assert.match(messages[0].content, /争取岗位|win a chance|试一试|try/i);
  assert.match(messages[0].content, /80 Chinese characters|简短|short/i);
  assert.match(messages[0].content, /never invent|不得编造|only the supplied resume facts/i);
  assert.match(serialized, /resume-line-1/);
  assert.doesNotMatch(serialized, /api-key-secret|open\.feishu\.cn|消息 0/);
});

test('prompts keep the latest twenty target messages in chronological order', function () {
  const input = {
    targetMessages: Array.from({ length: 22 }, function (_, index) {
      return { role: 'recruiter', text: 'message-' + (index + 1) };
    })
  };

  for (const build of [ReplyAI.buildClassificationMessages, ReplyAI.buildDraftMessages]) {
    const context = JSON.parse(build(input)[1].content);
    assert.equal(context.messages.length, 20);
    assert.equal(context.messages[0].text, 'message-3');
    assert.equal(context.messages.at(-1).text, 'message-22');
    assert.doesNotMatch(JSON.stringify(context), /message-1"/);
    assert.match(JSON.stringify(context), /message-21/);
  }
});

test('keeps strict parser boundaries for escaped keys, fences, Unicode length, and prototype keys', function () {
  const escapedDuplicate = '{"category":"courtesy","confidence":0.9,"confi\\u0064ence":0.9,"reasonCode":"x","evidenceIds":["r1"],"fieldsNeeded":[]}';
  assert.equal(errorCode(function () { ReplyAI.parseClassification(escapedDuplicate); }), 'AI_OUTPUT_DUPLICATE_KEY');

  const crlfFence = ' \r\n```JSON\r\n' + classification() + '\r\n``` \r\n';
  assert.deepEqual(ReplyAI.parseClassification(crlfFence), JSON.parse(classification()));

  assert.equal(ReplyAI.parseDraft('{"draft":"' + '😀'.repeat(300) + '","evidenceIds":["r1"]}').draft.length, 600);
  assert.equal(errorCode(function () {
    ReplyAI.parseDraft('{"draft":"' + '😀'.repeat(301) + '","evidenceIds":["r1"]}');
  }), 'AI_DRAFT_INVALID');

  assert.equal(errorCode(function () {
    ReplyAI.parseDraft('{"draft":"ok","evidenceIds":["r1"],"__proto__":{}}');
  }), 'AI_DRAFT_INVALID');
});
