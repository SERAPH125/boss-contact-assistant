const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const background = fs.readFileSync(path.join(root, 'src/background.js'), 'utf8');

test('imports trusteeship modules in dependency order before background use', () => {
  const ordered = [
    '/src/conversation/trusteeship-policy.js',
    '/src/conversation/conversation-store.js',
    '/src/conversation/reply-ai.js',
    '/src/conversation/feishu-notifier.js',
    '/src/platform/boss/peer-identity.js',
    '/src/platform/boss/conversation-reader.js',
    '/src/conversation/monitor-engine.js',
    '/src/conversation/trusteeship-runtime.js'
  ];
  let previous = -1;
  for (const file of ordered) {
    const index = background.indexOf(`'${file}'`);
    assert.ok(index > previous, `${file} must be imported once and in order`);
    assert.equal(background.indexOf(`'${file}'`, index + 1), -1);
    previous = index;
  }
});

