const test = require('node:test');
const assert = require('node:assert/strict');
const Peer = require('../src/platform/boss/peer-identity.js');

test('accepts encryptUid values that include tildes', () => {
  assert.equal(Peer.isPeerId('9c833990a839f1251Hx92du5GA~~'), true);
  assert.equal(Peer.isPeerId('bad id'), false);
  assert.equal(Peer.canonicalChatUrl('https://www.zhipin.com', 'peer~~1'),
    'https://www.zhipin.com/web/geek/chat?uid=peer~~1');
});

test('resolves a unique friend match to encryptUid and keeps DOM id as alias', () => {
  const resolved = Peer.resolvePeerIdentity({
    domIds: ['dom-conv-1'],
    origin: 'https://www.zhipin.com',
    friends: [
      {
        encryptUid: 'peer~~abc',
        uid: 'dom-conv-1',
        name: '李经理',
        brandName: '甲公司',
        jobName: '前端工程师'
      },
      { encryptUid: 'other', uid: 'other-dom', name: '别人' }
    ]
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.peerId, 'peer~~abc');
  assert.equal(resolved.openParam, 'uid');
  assert.equal(resolved.url, 'https://www.zhipin.com/web/geek/chat?uid=peer~~abc');
  assert.deepEqual(resolved.aliases, ['dom-conv-1']);
  assert.equal(resolved.peerSource, 'encryptUid');
  assert.equal(resolved.matchedPosition, '前端工程师');
  assert.equal(resolved.matchedCompany, '甲公司');
});

test('does not treat friend title HR as a job position', () => {
  const resolved = Peer.resolvePeerIdentity({
    domIds: ['dom-1'],
    origin: 'https://www.zhipin.com',
    friends: [{ encryptUid: 'peer~~1', uid: 'dom-1', title: 'HR', jobName: '' }]
  });
  assert.equal(resolved.ok, true);
  assert.equal(resolved.matchedPosition, '');
});

test('does not treat recruiter role titles as job positions', () => {
  [
    '招聘专员',
    '人事培训',
    '人力资源专员',
    '人事经理HRBP',
    '前台人事'
  ].forEach((title, index) => {
    const resolved = Peer.resolvePeerIdentity({
      domIds: ['dom-' + index],
      origin: 'https://www.zhipin.com',
      friends: [{
        encryptUid: 'peer~~' + index,
        uid: 'dom-' + index,
        title
      }]
    });
    assert.equal(resolved.ok, true);
    assert.equal(
      resolved.matchedPosition,
      '',
      title + ' 是招聘者职务，不是候选人正在沟通的岗位'
    );
  });
});

test('fails closed on missing unique friend alignment', () => {
  assert.equal(Peer.resolvePeerIdentity({
    domIds: ['dom-1'],
    origin: 'https://www.zhipin.com',
    friends: [{ encryptUid: 'x', uid: 'y' }]
  }).errorCode, 'PEER_ID_UNRESOLVED');

  assert.equal(Peer.resolvePeerIdentity({
    domIds: ['shared'],
    origin: 'https://www.zhipin.com',
    friends: [
      { encryptUid: 'a', uid: 'shared' },
      { encryptUid: 'b', conversationId: 'shared' }
    ]
  }).errorCode, 'PEER_ID_UNRESOLVED');
});

test('matches managed identity via aliases', () => {
  const conversation = {
    conversationId: 'peer~~abc',
    aliases: ['dom-conv-1', 'legacy-uid']
  };
  assert.equal(Peer.matchesManagedIdentity('dom-conv-1', conversation), true);
  assert.equal(Peer.matchesManagedIdentity('peer~~abc', conversation), true);
  assert.equal(Peer.matchesManagedIdentity('nope', conversation), false);
});
