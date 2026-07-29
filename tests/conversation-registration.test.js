const test = require('node:test');
const assert = require('node:assert/strict');

const Registration = require('../src/conversation/conversation-registration.js');

test('auto registration prefers canonical chat metadata over stale review-card fields', () => {
  const ref = Registration.fromSuccessfulContact({
    id: 'job-card-1',
    name: '跨境电商运营（审核卡片）',
    company: '',
    hrName: '杭州双一'
  }, {
    conversationRef: {
      conversationId: 'peer~~stable-1',
      url: 'https://www.zhipin.com/web/geek/chat?uid=peer~~stable-1',
      aliases: ['dom-legacy-1'],
      peerUid: '10001'
    },
    peerSource: 'encryptUid',
    baselineIncomingFingerprint: 'id:baseline-1',
    company: '杭州双一科技有限公司',
    position: '跨境电商运营',
    hrName: '罗榜伟'
  });

  assert.deepEqual(ref, {
    platform: 'boss',
    conversationId: 'peer~~stable-1',
    url: 'https://www.zhipin.com/web/geek/chat?uid=peer~~stable-1',
    jobId: 'job-card-1',
    company: '杭州双一科技有限公司',
    position: '跨境电商运营',
    hrName: '罗榜伟',
    aliases: ['dom-legacy-1'],
    peerUid: '10001',
    peerSource: 'encryptUid',
    enabled: false,
    initialIncomingFingerprint: 'id:baseline-1'
  });
});

test('auto registration falls back to review-card fields only when chat metadata is absent', () => {
  const ref = Registration.fromSuccessfulContact({
    id: 'job-card-2',
    name: '跨境电商助理',
    company: '乙公司',
    hrName: '王经理'
  }, {
    conversationRef: {
      conversationId: 'peer~~stable-2',
      url: 'https://www.zhipin.com/web/geek/chat?uid=peer~~stable-2',
      aliases: []
    },
    baselineIncomingFingerprint: ''
  });

  assert.equal(ref.company, '乙公司');
  assert.equal(ref.position, '跨境电商助理');
  assert.equal(ref.hrName, '王经理');
});

test('auto registration carries only the explicitly requested trusteeship state', () => {
  const contactOnly = Registration.fromSuccessfulContact({
    id: 'job-card-3'
  }, {
    conversationRef: {
      conversationId: 'peer~~stable-3',
      url: 'https://www.zhipin.com/web/geek/chat?uid=peer~~stable-3'
    },
    baselineIncomingFingerprint: 'id:baseline-3'
  });
  const contactAndTrusteeship = Registration.fromSuccessfulContact({
    id: 'job-card-4'
  }, {
    conversationRef: {
      conversationId: 'peer~~stable-4',
      url: 'https://www.zhipin.com/web/geek/chat?uid=peer~~stable-4'
    },
    baselineIncomingFingerprint: 'id:baseline-4'
  }, {
    enableTrusteeship: true
  });

  assert.equal(contactOnly.enabled, false);
  assert.equal(contactAndTrusteeship.enabled, true);
});
