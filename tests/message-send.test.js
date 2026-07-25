const test = require('node:test');
const assert = require('node:assert/strict');

const {
  matchesExpectedConversation,
  sendExactlyOnce
} = require('../src/message-send.js');

test('accepts an active conversation only when it contains an expected identity', () => {
  assert.equal(matchesExpectedConversation('李经理 · 星河科技 · 前端工程师', {
    name: '前端工程师',
    company: '星河科技',
    hrName: '李经理'
  }), true);
  assert.equal(matchesExpectedConversation('王经理 · 远山数据 · 数据分析师', {
    name: '前端工程师',
    company: '星河科技',
    hrName: '李经理'
  }), false);
  assert.equal(matchesExpectedConversation('', { company: '星河科技' }), false);
});

test('matches Boss chat titles that omit parenthetical job suffixes', () => {
  assert.equal(matchesExpectedConversation('跨境电商运营 · 杭州某出海公司 · 王女士', {
    name: '跨境电商运营 (TikTok 境外 + 国内店铺)',
    company: '杭州某出海公司',
    hrName: '王女士'
  }), true);
  assert.equal(matchesExpectedConversation('王女士 杭州某出海公司 跨境电商运营', {
    name: '跨境电商运营 (TikTok 境外 + 国内店铺)',
    company: '杭州某出海网络科技有限公司',
    hrName: ''
  }), true);
  assert.equal(matchesExpectedConversation('完全无关的会话', {
    name: '跨境电商运营 (TikTok 境外 + 国内店铺)',
    company: '杭州某出海网络科技有限公司',
    hrName: '王女士'
  }), false);
});

test('does not treat short fragments like 运营 as identity matches', () => {
  assert.equal(matchesExpectedConversation('招聘运营实习生', {
    name: '跨境电商运营 (TikTok 境外 + 国内店铺)',
    company: '',
    hrName: ''
  }), false);
});

test('does not click the send button when Enter already sent the message', async () => {
  let input = '您好';
  let sentCount = 0;
  let buttonClicks = 0;

  const result = await sendExactlyOnce({
    readInput: () => input,
    readSentCount: () => sentCount,
    pressEnter: () => {
      input = '';
      sentCount += 1;
    },
    clickSend: () => {
      buttonClicks += 1;
      sentCount += 1;
    },
    wait: async () => {},
    attempts: 2
  });

  assert.equal(result.ok, true);
  assert.equal(result.via, 'enter');
  assert.equal(buttonClicks, 0);
  assert.equal(sentCount, 1);
});

test('clicks the send button once only after Enter has no delivery evidence', async () => {
  let input = '您好';
  let sentCount = 0;
  let buttonClicks = 0;

  const result = await sendExactlyOnce({
    readInput: () => input,
    readSentCount: () => sentCount,
    pressEnter: () => {},
    clickSend: () => {
      buttonClicks += 1;
      input = '';
      sentCount += 1;
    },
    wait: async () => {},
    attempts: 2
  });

  assert.equal(result.ok, true);
  assert.equal(result.via, 'button');
  assert.equal(buttonClicks, 1);
  assert.equal(sentCount, 1);
});

test('returns failure when neither Enter nor the button produces delivery evidence', async () => {
  let buttonClicks = 0;
  const result = await sendExactlyOnce({
    readInput: () => '仍在输入框',
    readSentCount: () => 4,
    pressEnter: () => {},
    clickSend: () => { buttonClicks += 1; },
    wait: async () => {},
    attempts: 2
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /未确认/);
  assert.equal(buttonClicks, 1);
});
