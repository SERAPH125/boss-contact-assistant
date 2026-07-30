const test = require('node:test');
const assert = require('node:assert/strict');

const {
  matchesExpectedConversation,
  matchesExpectedConversationStrict,
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

test('strict initial-send identity requires two independent expected fields', () => {
  assert.equal(matchesExpectedConversationStrict(
    '罗榜伟 杭州双一科技有限公司 跨境电商运营',
    {
      name: '跨境电商运营',
      company: '杭州双一科技有限公司',
      hrName: '罗榜伟'
    }
  ), true);
  assert.equal(matchesExpectedConversationStrict(
    '另一家公司 另一岗位 罗榜伟',
    {
      name: '跨境电商运营',
      company: '杭州双一科技有限公司',
      hrName: '罗榜伟'
    }
  ), false);
  assert.equal(matchesExpectedConversationStrict(
    '杭州双一科技有限公司',
    {
      company: '杭州双一科技有限公司'
    }
  ), false);
});

test('strict initial-send identity rejects the same company and job when HR differs', () => {
  assert.equal(matchesExpectedConversationStrict(
    '李女士 杭州双一科技有限公司 跨境电商运营',
    {
      name: '跨境电商运营',
      company: '杭州双一科技有限公司',
      hrName: '张女士'
    }
  ), false);
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

test('does not issue a second external action when Enter has no delivery evidence', async () => {
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

  assert.equal(result.ok, false);
  assert.equal(result.unknown, true);
  assert.equal(result.attempted, true);
  assert.equal(buttonClicks, 0);
  assert.equal(sentCount, 0);
});

test('returns an unknown attempted result without clicking fallback controls', async () => {
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
  assert.match(result.error, /结果未知|未执行第二次发送/);
  assert.equal(result.unknown, true);
  assert.equal(result.attempted, true);
  assert.equal(buttonClicks, 0);
});
