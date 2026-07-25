const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');

const Reader = require('../src/platform/boss/conversation-reader');
const incomingSequence = require('./fixtures/boss-chat/incoming-sequence.json');
const mixedContent = require('./fixtures/boss-chat/mixed-content.json');

test('extractConversationRef accepts an explicit stable id and sanitizes the chat URL', () => {
  assert.deepEqual(
    Reader.extractConversationRef({
      pageUrl: 'https://www.zhipin.com/web/geek/chat?conversationId=conv_123&jobId=ignored#private'
    }),
    {
      conversationId: 'conv_123',
      url: 'https://www.zhipin.com/web/geek/chat?conversationId=conv_123'
    }
  );

  assert.deepEqual(
    Reader.extractConversationRef({
      pageUrl: 'https://www.zhipin.com/web/geek/chat?source=ignored',
      activeHref: 'https://www.zhipin.com/web/geek/chat?uid=uid-456&token=ignored'
    }),
    {
      conversationId: 'uid-456',
      url: 'https://www.zhipin.com/web/geek/chat?uid=uid-456'
    }
  );

  assert.deepEqual(
    Reader.extractConversationRef({
      pageUrl: 'https://www.zhipin.com/web/geek/chat',
      activeDataset: { conversationId: 'data_789', company: '示例公司', hrName: '某招聘方' }
    }),
    {
      conversationId: 'data_789',
      url: 'https://www.zhipin.com/web/geek/chat?conversationId=data_789'
    }
  );
});

test('extractConversationRef fails closed for non-chat URLs, unsafe ids, or conflicts', () => {
  const rejected = [
    {
      pageUrl: 'https://www.zhipin.com/web/geek/chat',
      company: '示例公司',
      hrName: '某招聘方',
      position: '示例岗位'
    },
    { pageUrl: 'http://www.zhipin.com/web/geek/chat?conversationId=conv_1' },
    { pageUrl: 'https://zhipin.com/web/geek/chat?conversationId=conv_1' },
    { pageUrl: 'https://www.zhipin.com/web/geek/chat/extra?conversationId=conv_1' },
    { pageUrl: 'https://www.zhipin.com/web/geek/other/../chat?conversationId=conv_1' },
    { pageUrl: 'https://www.zhipin.com/web/geek/job?conversationId=conv_1' },
    { pageUrl: 'https://www.zhipin.com/web/geek/chat?conversationId=bad%20id' },
    { pageUrl: 'https://www.zhipin.com/web/geek/chat?conversationId=a&uid=b' },
    {
      pageUrl: 'https://www.zhipin.com/web/geek/chat?conversationId=a',
      activeDataset: { conversationId: 'b' }
    },
    {
      pageUrl: 'https://www.zhipin.com/web/geek/chat',
      activeHref: 'https://evil.invalid/web/geek/chat?conversationId=a'
    }
  ];

  rejected.forEach((input) => assert.equal(Reader.extractConversationRef(input), null));
});

test('extractConversationRef returns null instead of trusting throwing dataset accessors', () => {
  const activeDataset = {};
  Object.defineProperty(activeDataset, 'conversationId', {
    enumerable: true,
    get() {
      throw new Error('untrusted getter');
    }
  });

  assert.doesNotThrow(() => Reader.extractConversationRef({
    pageUrl: 'https://www.zhipin.com/web/geek/chat',
    activeDataset
  }));
  assert.equal(Reader.extractConversationRef({
    pageUrl: 'https://www.zhipin.com/web/geek/chat',
    activeDataset
  }), null);
});

test('normalizeMessages returns only bounded allowlisted message fields', () => {
  const arrayLike = {
    0: mixedContent[0],
    1: mixedContent[1],
    2: mixedContent[2],
    3: mixedContent[3],
    4: mixedContent[4],
    5: mixedContent[5],
    6: mixedContent[6],
    length: 7
  };
  const normalized = Reader.normalizeMessages(arrayLike);

  assert.deepEqual(normalized.map((item) => item.kind), [
    'text',
    'image',
    'attachment',
    'voice'
  ]);
  normalized.forEach((item) => {
    assert.deepEqual(Object.keys(item), [
      'id',
      'direction',
      'kind',
      'text',
      'at',
      'fingerprint'
    ]);
  });
  assert.equal(normalized[0].text, '这是脱敏的测试消息');
  assert.equal(normalized[1].text, '');
  assert.equal(normalized[2].text, '');
  assert.equal(normalized[3].text, '');
  assert.doesNotMatch(JSON.stringify(normalized), /private\.invalid|profileUrl|attachmentUrl|mediaUrl/);
  assert.deepEqual(Reader.normalizeMessages('not an item list'), []);
});

test('normalizeMessages bounds item and string counts without guessing direction', () => {
  const raw = Array.from({ length: 230 }, (_, index) => ({
    id: 'm' + index,
    direction: index === 0 ? 'unknown' : 'incoming',
    kind: 'text',
    text: '字'.repeat(700),
    at: 1700000000000 + index
  }));
  const normalized = Reader.normalizeMessages(raw);

  assert.equal(normalized.length, 200);
  assert.equal(normalized[0].id, 'm30');
  assert.equal(Array.from(normalized[0].text).length, 600);
});

test('normalizeMessages drops ambiguous ID-less fingerprints and unsafe fallback times', () => {
  const normalized = Reader.normalizeMessages([
    {
      direction: 'incoming',
      kind: 'text',
      text: '缺少稳定时间',
      at: null
    },
    {
      direction: 'incoming',
      kind: 'text',
      text: '不安全时间',
      at: Number.MAX_SAFE_INTEGER + 1
    },
    {
      direction: 'incoming',
      kind: 'text',
      text: '碰撞消息',
      at: 1700000000000
    },
    {
      direction: 'incoming',
      kind: 'text',
      text: '碰撞消息',
      at: 1700000000000
    },
    {
      id: 'safe-id',
      direction: 'outgoing',
      kind: 'text',
      text: '显式 ID 仍可归一化',
      at: Number.POSITIVE_INFINITY
    },
    {
      direction: 'incoming',
      kind: 'text',
      text: '唯一消息',
      at: 1700000000001
    }
  ]);

  assert.deepEqual(normalized.map((item) => item.text), [
    '显式 ID 仍可归一化',
    '唯一消息'
  ]);
  assert.equal(normalized[0].at, null);
  assert.equal(normalized[1].at, 1700000000001);
  assert.equal(
    Reader.fingerprint({
      direction: 'incoming',
      kind: 'text',
      text: '无时间',
      at: null
    }),
    ''
  );
});

test('fingerprint prefers an explicit id and otherwise hashes stable message fields', () => {
  assert.equal(
    Reader.fingerprint({
      id: 'm-explicit',
      direction: 'incoming',
      kind: 'text',
      text: '文本',
      at: 1700000000000
    }),
    'id:m-explicit'
  );

  const withoutId = {
    id: '',
    direction: 'incoming',
    kind: 'text',
    text: '相同消息',
    at: 1700000000000
  };
  assert.equal(Reader.fingerprint(withoutId), Reader.fingerprint({ ...withoutId }));
  assert.notEqual(
    Reader.fingerprint(withoutId),
    Reader.fingerprint({ ...withoutId, direction: 'outgoing' })
  );
  assert.notEqual(
    Reader.fingerprint(withoutId),
    Reader.fingerprint({ ...withoutId, at: 1700000000001 })
  );
  assert.doesNotMatch(Reader.fingerprint(withoutId), /相同消息/);
});

test('selectNewIncoming returns only later incoming messages in source order', () => {
  const messages = Reader.normalizeMessages(incomingSequence);
  const baseline = messages.find((item) => item.id === 'm2').fingerprint;
  const selected = Reader.selectNewIncoming(messages, baseline);

  assert.deepEqual(selected.map((item) => item.id), ['m4', 'm5']);
  assert.notEqual(
    messages.find((item) => item.id === 'm2').fingerprint,
    messages.find((item) => item.id === 'm3').fingerprint
  );
});

test('selectNewIncoming never replays all history when a baseline is missing', () => {
  const messages = Reader.normalizeMessages(incomingSequence);
  assert.deepEqual(Reader.selectNewIncoming(messages, 'id:not-on-page'), []);
});

test('selectNewIncoming treats an explicit empty baseline as the first cursor page', () => {
  const messages = Reader.normalizeMessages(
    Array.from({ length: 25 }, (_, index) => ({
      id: 'cursor-' + index,
      direction: 'incoming',
      kind: 'text',
      text: '消息 ' + index,
      at: 1700000000000 + index
    }))
  );
  const selected = Reader.selectNewIncoming(messages, '');

  assert.equal(selected.length, 20);
  assert.equal(selected[0].id, 'cursor-0');
  assert.equal(selected[19].id, 'cursor-19');
});

test('selectNewIncoming is bounded to 20 and preserves order without a baseline', () => {
  const messages = Reader.normalizeMessages(
    Array.from({ length: 25 }, (_, index) => ({
      id: 'incoming-' + index,
      direction: 'incoming',
      kind: 'text',
      text: '消息 ' + index,
      at: 1700000000000 + index
    }))
  );
  const selected = Reader.selectNewIncoming(messages);

  assert.equal(selected.length, 20);
  assert.equal(selected[0].id, 'incoming-5');
  assert.equal(selected[19].id, 'incoming-24');
});
