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
    '/src/conversation/trusteeship-simulator.js',
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

test('composes the simulator from protected AI dependencies and passes it to runtime', () => {
  const creation = background.indexOf('TrusteeshipSimulator.create({');
  const controller = background.indexOf('TrusteeshipRuntime.createController({');
  assert.ok(creation > 0 && controller > creation);
  const block = background.slice(creation, controller);
  for (const dependency of [
    'storeModule: ConversationStore',
    'engineModule: MonitorEngine',
    'productionStore: conversationStore',
    'classifier: protectedTrusteeshipClassifier',
    'policy: TrusteeshipPolicy',
    'getResumeFacts: getTrusteeshipResumeFacts'
  ]) {
    assert.match(block, new RegExp(dependency));
  }
  assert.match(background.slice(controller, controller + 800), /simulator:\s*trusteeshipSimulator/);
});
