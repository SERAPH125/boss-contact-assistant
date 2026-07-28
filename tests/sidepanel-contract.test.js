const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
const html = fs.readFileSync(path.join(root, 'src/sidepanel.html'), 'utf8');
const script = fs.readFileSync(path.join(root, 'src/sidepanel.js'), 'utf8');
const css = fs.readFileSync(path.join(root, 'src/sidepanel.css'), 'utf8');

test('renders one accessible batch confirmation dialog', () => {
  assert.match(html, /id="deliveryModal"/);
  assert.match(html, /role="dialog"/);
  assert.match(html, /aria-modal="true"/);
  assert.match(html, /aria-labelledby="deliveryTitle"/);
  assert.match(html, /aria-describedby="deliveryDescription"/);
  assert.match(html, /id="deliveryJobs"/);
  assert.match(html, /id="btnConfirmDelivery"/);
  assert.match(html, /id="btnCancelDelivery"/);
});

test('uses prepare, confirm, and cancel messages without the legacy start entry', () => {
  assert.match(script, /type:\s*'PREPARE_DELIVERY'/);
  assert.match(script, /type:\s*'CONFIRM_DELIVERY'/);
  assert.match(script, /type:\s*'CANCEL_DELIVERY'/);
  assert.doesNotMatch(script, /type:\s*'START_DELIVER'/);
});

test('provides keyboard and assistive-technology semantics', () => {
  assert.match(html, /id="log"[^>]*role="log"[^>]*aria-live="polite"/);
  assert.match(script, /event\.key === 'Escape'/);
  assert.match(script, /event\.key === 'Tab'/);
  assert.match(script, /deliveryConfirmationSubmitting/);
  assert.match(css, /:focus-visible/);

  const labels = Array.from(html.matchAll(/<label([^>]*)>([\s\S]*?)<\/label>/g));
  assert.ok(labels.length > 0);
  labels.forEach((match) => {
    assert.ok(
      /\sfor="[^"]+"/.test(match[1]) || /<(input|select|textarea)\b/.test(match[2]),
      'label must have a for attribute or wrap its control: ' + match[0]
    );
  });
});

test('loads delivery guard before the sidepanel controller', () => {
  const guardAt = html.indexOf('src="delivery-guard.js"');
  const controllerAt = html.indexOf('src="sidepanel.js"');
  assert.ok(guardAt >= 0);
  assert.ok(guardAt < controllerAt);
});

test('saves API configuration only through the trusted background owner', () => {
  assert.match(script, /type:\s*'SAVE_API_CONFIG'/);
  assert.doesNotMatch(script, /PlatformConfig\.saveApi\s*\(/);
});

test('does not render or configure an unfinished Liepin platform', () => {
  assert.doesNotMatch(html, /data-platform="liepin"|fields-liepin|猎聘/);
  assert.doesNotMatch(script, /activePlatform === 'liepin'|'liepin'/);
});

test('shows structured recovery guidance for a blocked run', () => {
  assert.match(html, /id="recoveryCard"[^>]*role="alert"/);
  assert.match(html, /id="recoveryCode"/);
  assert.match(html, /id="recoveryReason"/);
  assert.match(html, /id="recoveryNextAction"/);
  assert.match(script, /msg\.type === 'BLOCKED'/);
  assert.match(script, /snapshot\.blockCode/);
});
