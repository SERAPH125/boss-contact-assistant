const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');

const Feishu = require('../src/conversation/feishu-notifier.js');

const webhook = 'https://open.feishu.cn/open-apis/bot/v2/hook/example-token-123';

function config(overrides) {
  return Object.assign({ webhook: webhook, signingSecret: 'signing-secret-value' }, overrides);
}

function response(status, body) {
  return {
    status: status,
    ok: status >= 200 && status < 300,
    json: async function () { return body; }
  };
}

function expectedSignature(timestamp, secret) {
  return crypto.createHmac('sha256', String(timestamp) + '\n' + secret).update('').digest('base64');
}

function approvedCard() {
  return Feishu.buildApprovalCard({ company: '星河科技', latestSummary: '请人工确认。' });
}

test('accepts only the official custom-bot webhook path', function () {
  assert.doesNotThrow(function () { Feishu.validateConfig(config()); });
  for (const value of [
    'https://evil.example/open-apis/bot/v2/hook/example',
    'http://open.feishu.cn/open-apis/bot/v2/hook/example',
    'https://open.feishu.cn:8443/open-apis/bot/v2/hook/example',
    'https://name:password@open.feishu.cn/open-apis/bot/v2/hook/example',
    'https://open.feishu.cn/open-apis/bot/v2/hook/example?secret=nope',
    'https://open.feishu.cn/open-apis/bot/v2/hook/example#fragment',
    'https://open.feishu.cn/open-apis/bot/v2/hook/',
    'https://open.feishu.cn/open-apis/bot/v2/hook/example/extra',
    'https://open.feishu.cn/open-apis/bot/v2/hook/example%2Fextra',
    'https://open.feishu.cn/open-apis/bot/v2/hook/example%2e',
    'https://open.feishu.cn/open-apis/bot/v2/hook/../example',
    'https://open.feishu.cn/open-apis/bot/v2/hook/example\\extra'
  ]) {
    assert.throws(function () { Feishu.validateConfig(config({ webhook: value })); }, /FEISHU_WEBHOOK_INVALID/);
  }
});

test('signs timestamp with HMAC-SHA256 and an empty message', async function () {
  const timestamp = 1700000000;
  assert.equal(
    await Feishu.sign(timestamp, 'secret', crypto.webcrypto.subtle),
    expectedSignature(timestamp, 'secret')
  );
});

test('builds a bounded allowlisted approval card without context or credentials', function () {
  const card = Feishu.buildApprovalCard({
    company: '星河科技',
    position: '前端工程师',
    hr: '李老师',
    stage: 'WAITING_CONFIRMATION',
    latestSummary: 'HR 有新消息，请在插件内查看完整上下文',
    reason: '需要人工确认候选人意向。',
    fieldsNeeded: Array.from({ length: 12 }, function (_, index) { return '字段-' + index + '-' + 'x'.repeat(100); }),
    draft: '您好，感谢联系，我正在评估新的机会。' + 'x'.repeat(700),
    wait: true,
    bossChatUrl: 'https://www.zhipin.com/web/geek/chat?conversationId=1',
    recentMessages: Array.from({ length: 20 }, function () { return { text: '完整上下文不得泄露' }; }),
    webhook: webhook,
    signingSecret: 'signing-secret-value',
    apiKey: 'api-key-secret',
    unknown: 'unknown-input-must-not-be-copied'
  });
  const serialized = JSON.stringify(card);

  assert.match(serialized, /星河科技|前端工程师|李老师|WAITING_CONFIRMATION/);
  assert.match(serialized, /等待对方回复/);
  assert.match(serialized, /www\.zhipin\.com\/web\/geek\/chat/);
  assert.equal((serialized.match(/字段-/g) || []).length, 0);
  assert.doesNotMatch(serialized, /建议草稿|感谢联系|需要人工确认候选人意向/);
  assert.doesNotMatch(serialized, /完整上下文不得泄露|example-token-123|signing-secret-value|api-key-secret|unknown-input/);
  assert.doesNotMatch(serialized, /x{601}/);
});

test('card builder ignores HR-driven free text and accepts only fixed notification templates', function () {
  const marker = 'HR-DRIVEN-FREE-TEXT-CANARY';
  const card = Feishu.buildApprovalCard({
    company: '安全公司',
    position: '安全岗位',
    hrName: '安全 HR',
    stage: marker,
    latestSummary: marker,
    reason: marker,
    fieldsNeeded: [marker],
    draft: marker,
    wait: marker
  });
  const serialized = JSON.stringify(card);

  assert.match(serialized, /安全公司|安全岗位|安全 HR/);
  assert.doesNotMatch(serialized, new RegExp(marker));

  const fixed = JSON.stringify(Feishu.buildApprovalCard({
    stage: 'WAITING_CONFIRMATION',
    latestSummary: 'HR 有新消息，请在插件内查看完整上下文',
    wait: true
  }));
  assert.match(
    fixed,
    /WAITING_CONFIRMATION|HR 有新消息，请在插件内查看完整上下文|等待对方回复/
  );
});

test('omits the Boss button unless the URL is an HTTPS zhipin subdomain chat path', function () {
  for (const bossChatUrl of [
    'https://evil.example/web/geek/chat?access_token=secret',
    'https://zhipin.com/web/geek/chat',
    'https://www.zhipin.com/web/geek/chat/extra',
    'http://www.zhipin.com/web/geek/chat'
  ]) {
    const card = Feishu.buildApprovalCard({ bossChatUrl: bossChatUrl });
    assert.doesNotMatch(JSON.stringify(card), /evil\.example|zhipin\.com\/web\/geek\/chat|access_token/);
  }
});

test('rebuilds a bounded Boss URL from allowlisted query fields only', function () {
  const card = Feishu.buildApprovalCard({
    bossChatUrl: 'https://www.zhipin.com/web/geek/chat?access_token=secret&conversationId=conv_1&uid=U-2&jobId=job_3&encryptJobId=enc-4&unknown=value#fragment'
  });
  const action = card.elements.at(-1).actions[0];
  assert.equal(action.url, 'https://www.zhipin.com/web/geek/chat?conversationId=conv_1&uid=U-2&jobId=job_3&encryptJobId=enc-4');
  assert.ok(action.url.length <= 512);
  assert.doesNotMatch(action.url, /access_token|unknown|fragment|secret/);

  const maxValue = 'a'.repeat(128);
  const boundedCard = Feishu.buildApprovalCard({
    bossChatUrl: 'https://www.zhipin.com/web/geek/chat?conversationId=' + maxValue + '&uid=' + maxValue + '&jobId=' + maxValue + '&encryptJobId=' + maxValue
  });
  assert.ok(boundedCard.elements.at(-1).actions[0].url.length <= 512);

  for (const bossChatUrl of [
    'https://www.zhipin.com/web/geek/../geek/chat?conversationId=ok',
    'https://www.zhipin.com/web/geek\\chat?conversationId=ok',
    'https://www.zhipin.com/web/geek/chat?conversationId=' + 'a'.repeat(129),
    'https://' + Array.from({ length: 5 }, function () { return 'a'.repeat(63); }).join('.') + '.zhipin.com/web/geek/chat'
  ]) {
    assert.doesNotMatch(JSON.stringify(Feishu.buildApprovalCard({ bossChatUrl: bossChatUrl })), /zhipin\.com\/web\/geek\/chat/);
  }
});

test('uses frozen branded plain-text cards and blocks arbitrary card egress', async function () {
  const calls = [];
  const notifier = Feishu.create({ fetchFn: async function (url, options) { calls.push({ url: url, options: options }); return response(200, { code: 0 }); } });
  const card = approvedCard();
  const original = JSON.stringify(card);
  card.elements[0].fields[0].text.content = 'mutated';

  assert.equal(JSON.stringify(card), original);
  assert.equal(Object.isFrozen(card.elements[0].fields[0].text), true);
  assert.ok(JSON.stringify(card).includes('plain_text'));
  assert.deepEqual(await notifier.send(config(), { fullContext: 'must never leave', apiKey: 'sk-live-abcdef123456' }), {
    ok: false, code: 'FEISHU_CARD_INVALID'
  });
  assert.deepEqual(await notifier.send(config(), JSON.parse(JSON.stringify(card))), { ok: false, code: 'FEISHU_CARD_INVALID' });
  assert.equal(calls.length, 0);
  assert.deepEqual(await notifier.send(config(), card), { ok: true, code: 'OK' });
  assert.equal(calls.length, 1);
});

test('blocks branded cards containing exact configured opaque credentials before egress', async function () {
  const calls = [];
  const opaqueSecret = 'opaqueValue123456789';
  const notifier = Feishu.create({
    clock: function () { return 1700000000000; },
    subtle: crypto.webcrypto.subtle,
    fetchFn: async function (url, options) { calls.push({ url: url, options: options }); return response(200, { code: 0 }); }
  });
  const credentialConfig = config({ signingSecret: opaqueSecret });
  const cards = [
    Feishu.buildApprovalCard({ company: opaqueSecret }),
    Feishu.buildApprovalCard({ company: 'bare token example-token-123' }),
    Feishu.buildApprovalCard({ bossChatUrl: 'https://www.zhipin.com/web/geek/chat?conversationId=example-token-123' })
  ];

  for (const card of cards) {
    assert.deepEqual(await notifier.send(credentialConfig, card), { ok: false, code: 'FEISHU_CARD_INVALID' });
  }
  assert.equal(calls.length, 0);
});

test('blocks JSON-escaped configured credentials in a branded card before egress', async function () {
  const calls = [];
  const quotedSecret = 'opaque"quote\\slash';
  const notifier = Feishu.create({
    clock: function () { return 1700000000000; },
    subtle: crypto.webcrypto.subtle,
    fetchFn: async function (url, options) { calls.push({ url: url, options: options }); return response(200, { code: 0 }); }
  });
  const card = Feishu.buildApprovalCard({ company: quotedSecret });

  assert.deepEqual(await notifier.send(config({ signingSecret: quotedSecret }), card), { ok: false, code: 'FEISHU_CARD_INVALID' });
  assert.equal(calls.length, 0);
});

test('sanitizes hostile card strings and cannot render markup, mentions, URLs, or credentials', function () {
  const card = Feishu.buildApprovalCard({
    company: 'https://open.feishu.cn/open-apis/bot/v2/hook/example-token-123 @all [link](https://evil.example) Bearer api-key-secret-value\u0000',
    reason: 'signing-secret-value sk-live-abcdef123456',
    fieldsNeeded: ['token=api-key-secret-value', '@user', '[unsafe]'],
    draft: 'authorization: "Bearer api-key-secret-value"\nhttps://evil.example/path'
  });
  const serialized = JSON.stringify(card);

  assert.doesNotMatch(serialized, /open\.feishu|example-token-123|evil\.example|api-key-secret-value|signing-secret-value|sk-live-abcdef123456|@all|@user|\[unsafe\]|\\u0000/);
  assert.doesNotMatch(serialized, /lark_md/);
  assert.match(serialized, /REDACTED/);
});

test('sends one signed interactive payload and omits signature fields without a secret', async function () {
  const calls = [];
  const notifier = Feishu.create({
    fetchFn: async function (url, options) {
      calls.push({ url: url, options: options });
      return response(200, { code: 0 });
    },
    subtle: crypto.webcrypto.subtle,
    clock: function () { return 1700000000123; }
  });
  const result = await notifier.send(config(), Feishu.buildApprovalCard({ company: '星河科技' }));
  const payload = JSON.parse(calls[0].options.body);

  assert.deepEqual(result, { ok: true, code: 'OK' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].options.method, 'POST');
  assert.equal(calls[0].options.headers['Content-Type'], 'application/json');
  assert.equal(payload.msg_type, 'interactive');
  assert.equal(payload.timestamp, '1700000000');
  assert.equal(payload.sign, expectedSignature(1700000000, 'signing-secret-value'));

  const unsignedCalls = [];
  const unsigned = Feishu.create({
    fetchFn: async function (url, options) { unsignedCalls.push({ url: url, options: options }); return response(200, { code: 0 }); },
    subtle: crypto.webcrypto.subtle,
    clock: function () { return 1700000000123; }
  });
  assert.deepEqual(await unsigned.send(config({ signingSecret: '' }), approvedCard()), { ok: true, code: 'OK' });
  const unsignedPayload = JSON.parse(unsignedCalls[0].options.body);
  assert.equal(Object.hasOwn(unsignedPayload, 'timestamp'), false);
  assert.equal(Object.hasOwn(unsignedPayload, 'sign'), false);
});

test('prepares a signed request before delegating its one-time fetch dispatch', async function () {
  const calls = [];
  const notifier = Feishu.create({
    fetchFn: async function (url, options) {
      calls.push({ url: url, options: options });
      return response(200, { code: 0 });
    },
    subtle: crypto.webcrypto.subtle,
    clock: function () { return 1700000000123; }
  });
  let dispatchCalls = 0;

  const result = await notifier.send(config(), approvedCard(), async function (dispatchPrepared) {
    assert.equal(calls.length, 0);
    dispatchCalls += 1;
    return dispatchPrepared();
  });

  assert.deepEqual(result, { ok: true, code: 'OK' });
  assert.equal(dispatchCalls, 1);
  assert.equal(calls.length, 1);
  const payload = JSON.parse(calls[0].options.body);
  assert.equal(payload.timestamp, '1700000000');
  assert.equal(payload.sign, expectedSignature(1700000000, 'signing-secret-value'));
});

test('reports HTTP and Feishu failures with safe stable codes', async function () {
  const http = Feishu.create({ fetchFn: async function () { return response(503, { code: 0, msg: 'secret body' }); } });
  const feishu = Feishu.create({ fetchFn: async function () { return response(200, { code: 999, msg: 'secret body' }); } });

  assert.deepEqual(await http.send(config(), approvedCard()), { ok: false, code: 'HTTP_ERROR' });
  assert.deepEqual(await feishu.send(config(), approvedCard()), { ok: false, code: 'FEISHU_ERROR' });
});

test('returns timeout and network failures without mutating trusteeship settings', async function () {
  const settings = config({ enabled: true });
  const timeout = Feishu.create({
    timeoutMs: 5,
    fetchFn: function (url, options) {
      return new Promise(function (_, reject) {
        options.signal.addEventListener('abort', function () { reject(new Error('network ' + webhook)); });
      });
    }
  });
  const network = Feishu.create({ fetchFn: async function () { throw new Error('network ' + webhook); } });
  const ignoredAbort = Feishu.create({
    timeoutMs: 5,
    fetchFn: function () {
      return new Promise(function (resolve) { setTimeout(function () { resolve(response(200, { code: 0 })); }, 30); });
    }
  });
  const hangingSubtle = Feishu.create({
    timeoutMs: 5,
    clock: function () { return 1700000000000; },
    subtle: { importKey: function () { return new Promise(function () {}); }, sign: function () { return new Promise(function () {}); } },
    fetchFn: async function () { return response(200, { code: 0 }); }
  });
  const hangingJson = Feishu.create({
    timeoutMs: 5,
    fetchFn: async function () { return { ok: true, json: function () { return new Promise(function () {}); } }; }
  });
  const badClock = Feishu.create({
    clock: function () { throw new Error('clock ' + webhook); },
    fetchFn: async function () { return response(200, { code: 0 }); }
  });

  assert.deepEqual(await timeout.send(settings, approvedCard()), { ok: false, code: 'TIMEOUT' });
  assert.deepEqual(await ignoredAbort.send(settings, approvedCard()), { ok: false, code: 'TIMEOUT' });
  assert.deepEqual(await hangingSubtle.send(settings, approvedCard()), { ok: false, code: 'TIMEOUT' });
  assert.deepEqual(await hangingJson.send(settings, approvedCard()), { ok: false, code: 'TIMEOUT' });
  assert.deepEqual(await badClock.send(settings, approvedCard()), { ok: false, code: 'UNKNOWN' });
  assert.deepEqual(await network.send(settings, approvedCard()), { ok: false, code: 'NETWORK_ERROR' });
  assert.equal(settings.enabled, true);
});

test('rejects invalid injected clock results before signing or fetch', async function () {
  for (const value of [NaN, Infinity, '1700000000000', 0, -1, 0.5, new Number(1700000000000)]) {
    const calls = [];
    const notifier = Feishu.create({
      clock: function () { return value; },
      subtle: crypto.webcrypto.subtle,
      fetchFn: async function (url, options) { calls.push({ url: url, options: options }); return response(200, { code: 0 }); }
    });
    assert.deepEqual(await notifier.send(config(), approvedCard()), { ok: false, code: 'UNKNOWN' });
    assert.equal(calls.length, 0);
  }
});

test('redacts webhook credentials, API-key-like values, and query strings from arbitrary errors', function () {
  const value = {
    message: 'failed ' + webhook + '?debug=1 secret=signing-secret-value key=sk-live-abcdef123456',
    nested: { authorization: 'Bearer api-key-secret-value', url: 'https://example.test/path?token=abc' }
  };
  const result = Feishu.redactError(value, config());

  assert.doesNotMatch(result, /example-token-123|signing-secret-value|api-key-secret-value|sk-live-abcdef123456|debug=1|token=abc/);
  assert.match(result, /REDACTED/);
});

test('redacts quoted credential values and cyclic errors without throwing or leaking', function () {
  const value = { detail: 'authorization: "Bearer api-key-secret-value"; token=\'example-token-123\'' };
  value.self = value;
  const result = Feishu.redactError(value, config());

  assert.doesNotMatch(result, /api-key-secret-value|example-token-123/);
  assert.match(result, /REDACTED|CIRCULAR/);
});

test('redacts JSON-escaped configured credentials from structured errors', function () {
  const quotedSecret = 'opaque"quote\\slash';
  const escapedSecret = JSON.stringify(quotedSecret).slice(1, -1);
  const result = Feishu.redactError({ detail: quotedSecret }, config({ signingSecret: quotedSecret }));

  assert.equal(result.includes(quotedSecret), false);
  assert.equal(result.includes(escapedSecret), false);
  assert.match(result, /REDACTED/);
});
