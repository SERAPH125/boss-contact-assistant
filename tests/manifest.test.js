const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const manifest = JSON.parse(fs.readFileSync(path.join(root, 'manifest.json'), 'utf8'));

test('declares offscreen support and bounded optional API host permissions', () => {
  assert.ok(manifest.permissions.includes('offscreen'));
  assert.ok(manifest.optional_host_permissions.includes('https://*/*'));
  assert.ok(manifest.optional_host_permissions.includes('http://localhost/*'));
  assert.ok(manifest.optional_host_permissions.includes('http://127.0.0.1/*'));
});

test('declares bounded permissions for trusteeship scheduling and Feishu', () => {
  assert.ok(manifest.permissions.includes('alarms'));
  assert.ok(manifest.host_permissions.includes('https://open.feishu.cn/*'));
  assert.equal(
    manifest.host_permissions.some((pattern) => pattern === 'https://*/*'),
    false
  );
});

test('loads the single-send guard before every chat content script', () => {
  const chatEntries = manifest.content_scripts.filter((entry) =>
    entry.js.some((file) => /content-chat\.js$/.test(file))
  );
  assert.ok(chatEntries.length >= 2);
  for (const entry of chatEntries) {
    const guardIndex = entry.js.indexOf('src/message-send.js');
    const chatIndex = entry.js.findIndex((file) => /content-chat\.js$/.test(file));
    assert.ok(guardIndex >= 0 && guardIndex < chatIndex);
  }
});

test('loads the Boss conversation reader before the Boss chat content script', () => {
  const entry = manifest.content_scripts.find((candidate) =>
    candidate.matches.some((pattern) => pattern.includes('zhipin.com/web/geek/chat'))
  );
  assert.ok(entry);
  const peerIndex = entry.js.indexOf('src/platform/boss/peer-identity.js');
  const readerIndex = entry.js.indexOf('src/platform/boss/conversation-reader.js');
  const chatIndex = entry.js.indexOf('src/platform/boss/content-chat.js');
  assert.ok(peerIndex >= 0 && peerIndex < readerIndex);
  assert.ok(readerIndex >= 0 && readerIndex < chatIndex);
});

test('includes the offscreen document assets', () => {
  assert.equal(fs.existsSync(path.join(root, 'src/offscreen.html')), true);
  assert.equal(fs.existsSync(path.join(root, 'src/offscreen.js')), true);
});
