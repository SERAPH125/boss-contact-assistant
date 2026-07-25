const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const chatFiles = [
  'src/platform/boss/content-chat.js',
  'src/platform/zhilian/content-chat.js'
];

test('chat adapters distinguish target uncertainty from selector failure', () => {
  chatFiles.forEach((relativePath) => {
    const source = fs.readFileSync(path.join(root, relativePath), 'utf8');
    assert.match(source, /targetUncertain:\s*true/, relativePath);
    assert.match(source, /selectorUnavailable:\s*true/, relativePath);
  });
});

test('search adapters classify unsafe or unknown contact outcomes', () => {
  const boss = fs.readFileSync(
    path.join(root, 'src/platform/boss/content-search.js'),
    'utf8'
  );
  const zhilian = fs.readFileSync(
    path.join(root, 'src/platform/zhilian/content-search.js'),
    'utf8'
  );
  assert.match(boss, /selectorUnavailable:\s*true/);
  assert.match(zhilian, /sendResultUnknown:\s*true/);
  assert.match(zhilian, /targetUncertain:\s*true/);
});

test('Boss chat adapter exposes guarded managed-conversation operations', () => {
  const boss = fs.readFileSync(
    path.join(root, 'src/platform/boss/content-chat.js'),
    'utf8'
  );

  assert.match(boss, /msg\.type === 'GET_ACTIVE_CONVERSATION_REF'/);
  assert.match(boss, /msg\.type === 'CAPTURE_ACTIVE_CONVERSATION'/);
  assert.match(boss, /msg\.type === 'PROBE_PEER_IDENTITY'/);
  assert.match(boss, /msg\.type === 'READ_ACTIVE_CONVERSATION'/);
  assert.match(boss, /msg\.type === 'SEND_MANAGED_REPLY'/);
  assert.match(boss, /getGeekFriendList\.json/);
  assert.match(boss, /encryptUid/);
  assert.match(boss, /MessageSend\.matchesExpectedConversation/);
  assert.match(boss, /MessageSend\.sendExactlyOnce/);
  assert.match(boss, /sendResultUnknown:\s*true/);
  assert.doesNotMatch(boss, /document\.querySelectorAll\(['"]\.item['"]\)/);
});
