const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const source = fs.readFileSync(path.join(root, 'src/background.js'), 'utf8');

test('service worker requires a prepared one-time delivery intent', () => {
  assert.match(source, /['"]\/src\/delivery-guard\.js['"]/);
  assert.match(source, /msg\.type === 'PREPARE_DELIVERY'/);
  assert.match(source, /msg\.type === 'CONFIRM_DELIVERY'/);
  assert.match(source, /msg\.type === 'CANCEL_DELIVERY'/);
  assert.match(
    source,
    /msg\.type === 'START_DELIVER'[\s\S]{0,500}CONFIRMATION_REQUIRED/
  );
});

test('confirmation consumes and revalidates the frozen intent job list', () => {
  assert.match(source, /deliveryIntentStore\.consume\(intentId\)/);
  assert.match(source, /DeliveryGuard\.assertIntentMatchesPlan\(intent, plan\)/);
  assert.match(source, /runDeliver\(intent\.jobIds,\s*\{\s*reserved:\s*true\s*\}\)/);
});

test('publishes structured blocking metadata and stops on uncertain sends', () => {
  assert.match(source, /function blockRun\(reason,\s*code\)/);
  assert.match(source, /type:\s*'BLOCKED'/);
  assert.match(source, /blockCode:\s*state\.blockCode/);
  assert.match(source, /SEND_RESULT_UNKNOWN/);
  assert.match(source, /chatR\.sendResultUnknown/);
  assert.match(source, /TARGET_UNCERTAIN/);
  assert.match(source, /SELECTOR_UNAVAILABLE/);
  assert.match(source, /SERVICE_WORKER_INTERRUPTED/);
});

test('keeps prepared delivery confirmation while adding trusteeship dispatch', () => {
  assert.match(source, /if\s*\(isTrusteeshipMessage\(msg\)\)/);
  assert.match(source, /msg\.type === 'PREPARE_DELIVERY'/);
  assert.match(source, /msg\.type === 'CONFIRM_DELIVERY'/);
  assert.match(source, /msg\.type === 'START_DELIVER'[\s\S]{0,500}CONFIRMATION_REQUIRED/);
});
