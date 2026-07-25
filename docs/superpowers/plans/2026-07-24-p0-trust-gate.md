# P0 Trust Gate Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Require one explicit, one-time batch confirmation before contacting multiple selected jobs, while preserving per-job safety checks and fail-closed recovery.

**Architecture:** Add a browser/Node-compatible `DeliveryGuard` module that owns deterministic batch planning and a serialized one-time intent store. The service worker becomes the authority that prepares and consumes delivery intents; the side panel only renders the returned plan and confirms or cancels it. Existing delivery execution remains responsible for per-job page, platform, identity, quota, dedupe, and exactly-once message checks.

**Tech Stack:** Chrome Extension Manifest V3, native JavaScript, `chrome.storage.local`, Node.js built-in test runner, HTML/CSS.

## Global Constraints

- A user confirms a multi-job batch once; the system validates every job separately during execution.
- No recruitment-site write action may happen before the one-time intent is consumed.
- Intent lifetime is exactly 120 seconds.
- Direct legacy `START_DELIVER` messages must return `CONFIRMATION_REQUIRED`.
- A selected batch larger than the remaining daily allowance is rejected rather than silently truncated.
- Unknown send results and interrupted service workers must never replay an external action.
- No new runtime dependencies and no frontend framework migration.
- Real-site send verification requires an explicitly authorized test account and test job.

---

## File Map

- Create `src/delivery-guard.js`: pure batch planning, wait estimation, error guidance, and serialized intent storage.
- Create `tests/delivery-guard.test.js`: behavioral tests for plans and one-time intents.
- Create `tests/background-contract.test.js`: service-worker confirmation contract checks.
- Create `tests/sidepanel-contract.test.js`: modal, status semantics, labels, and script-order checks.
- Modify `src/background.js`: prepare, confirm, cancel, legacy rejection, block metadata, and persistent-state handoff.
- Modify `src/sidepanel.html`: confirmation dialog, recovery alert, explicit labels, and ARIA semantics.
- Modify `src/sidepanel.js`: render/focus/cancel/confirm flow and recovery guidance.
- Modify `src/sidepanel.css`: dialog summary, recovery card, job list, and visible focus styles.
- Modify `README.md`: user-visible confirmation and evidence boundaries.
- Modify `docs/07-multi-platform-design.md`: P0 architecture, acceptance results, and manual test status.
- Modify `docs/superpowers/specs/2026-07-24-p0-trust-gate-design.md`: mark implementation status after verification.

---

### Task 1: Deterministic Batch Plans

**Files:**
- Create: `tests/delivery-guard.test.js`
- Create: `src/delivery-guard.js`

**Interfaces:**
- Produces: `DeliveryGuard.prepare(input) -> plan`
- Produces: `DeliveryGuard.estimateWaitSeconds(count, config) -> { minSec, maxSec }`
- Produces: `DeliveryGuard.guidanceFor(code) -> { message, nextAction }`

- [x] **Step 1: Write failing plan tests**

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const DeliveryGuard = require('../src/delivery-guard.js');

const jobs = [
  { id: 'a', platform: 'boss', name: '前端', company: '甲公司' },
  { id: 'b', platform: 'boss', name: '后端', company: '乙公司' },
  { id: 'z', platform: 'zhilian', name: '测试', company: '丙公司' }
];

test('prepares one batch while excluding previously contacted jobs', () => {
  const plan = DeliveryGuard.prepare({
    platformId: 'boss',
    selectedIds: ['a', 'a', 'b'],
    jobs,
    processed: { a: 1 },
    usageCount: 3,
    dailyLimit: 20,
    intervalMinSec: 10,
    intervalMaxSec: 25,
    batchSize: 5,
    batchRestMinSec: 45,
    batchRestMaxSec: 90,
    sendsResumeImage: true
  });
  assert.deepEqual(plan.selectedIds, ['a', 'b']);
  assert.deepEqual(plan.executableIds, ['b']);
  assert.equal(plan.skippedProcessedCount, 1);
  assert.equal(plan.remainingAfter, 16);
});

test('rejects a batch that exceeds the remaining daily allowance', () => {
  assert.throws(() => DeliveryGuard.prepare({
    platformId: 'boss',
    selectedIds: ['a', 'b'],
    jobs,
    processed: {},
    usageCount: 19,
    dailyLimit: 20
  }), (error) => error.code === 'DAILY_LIMIT_EXCEEDED');
});

test('rejects stale or cross-platform selections', () => {
  assert.throws(() => DeliveryGuard.prepare({
    platformId: 'boss',
    selectedIds: ['missing'],
    jobs,
    processed: {},
    usageCount: 0,
    dailyLimit: 20
  }), (error) => error.code === 'STALE_REVIEW');
  assert.throws(() => DeliveryGuard.prepare({
    platformId: 'boss',
    selectedIds: ['z'],
    jobs,
    processed: {},
    usageCount: 0,
    dailyLimit: 20
  }), (error) => error.code === 'PLATFORM_MISMATCH');
});

test('estimates ordinary intervals and cross-batch rests', () => {
  assert.deepEqual(DeliveryGuard.estimateWaitSeconds(1, {
    intervalMinSec: 10, intervalMaxSec: 25, batchSize: 2,
    batchRestMinSec: 45, batchRestMaxSec: 90
  }), { minSec: 0, maxSec: 0 });
  assert.deepEqual(DeliveryGuard.estimateWaitSeconds(4, {
    intervalMinSec: 10, intervalMaxSec: 25, batchSize: 2,
    batchRestMinSec: 45, batchRestMaxSec: 90
  }), { minSec: 65, maxSec: 140 });
});
```

- [x] **Step 2: Run tests and verify RED**

Run:

```bash
node --test tests/delivery-guard.test.js
```

Expected: FAIL because `src/delivery-guard.js` does not exist.

- [x] **Step 3: Implement the minimal planning module**

Implement a UMD module with:

```js
(function (g, factory) {
  var api = factory();
  g.DeliveryGuard = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  function runError(code, message, nextAction) {
    var error = new Error(message);
    error.code = code;
    error.nextAction = nextAction;
    return error;
  }

  function normalizeIds(ids) {
    return Array.from(new Set((ids || []).filter(function (id) {
      return typeof id === 'string' && id.trim();
    }).map(function (id) { return id.trim(); })));
  }

  function estimateWaitSeconds(count, cfg) {
    var min = 0;
    var max = 0;
    var size = Math.max(1, parseInt(cfg.batchSize, 10) || 5);
    for (var completed = 1; completed < count; completed++) {
      if (completed % size === 0) {
        min += Math.max(0, parseInt(cfg.batchRestMinSec, 10) || 45);
        max += Math.max(0, parseInt(cfg.batchRestMaxSec, 10) || 90);
      } else {
        min += Math.max(5, parseInt(cfg.intervalMinSec, 10) || 10);
        max += Math.max(6, parseInt(cfg.intervalMaxSec, 10) || 25);
      }
    }
    return { minSec: min, maxSec: max };
  }
}
```

Complete `prepare` with stable errors, ordered job summaries, processed exclusions, remaining allowance, and estimated wait fields. Complete `guidanceFor` for every error code declared in the approved design.

- [x] **Step 4: Run focused and full tests**

Run:

```bash
node --test tests/delivery-guard.test.js
npm test
```

Expected: focused tests PASS; existing 20 tests remain PASS.

---

### Task 2: One-Time Persistent Intent Store

**Files:**
- Modify: `tests/delivery-guard.test.js`
- Modify: `src/delivery-guard.js`

**Interfaces:**
- Produces: `DeliveryGuard.createIntentStore(storage, clock, idFactory)`
- Produces store methods: `current()`, `create(plan)`, `cancel(id)`, `consume(id)`
- Produces: `DeliveryGuard.assertIntentMatchesPlan(intent, plan)`

- [x] **Step 1: Add failing intent tests**

```js
test('consumes one intent exactly once even when two consumers race', async () => {
  const storage = memoryStorage();
  let now = 1000;
  const store = DeliveryGuard.createIntentStore(storage, () => now, () => 'intent-1');
  await store.create({ platformId: 'boss', executableIds: ['a'], selectedCount: 1 });
  const settled = await Promise.allSettled([
    store.consume('intent-1'),
    store.consume('intent-1')
  ]);
  assert.equal(settled.filter((item) => item.status === 'fulfilled').length, 1);
  assert.equal(settled.filter((item) =>
    item.status === 'rejected' && item.reason.code === 'INTENT_ALREADY_USED'
  ).length, 1);
});

test('rejects expired and cancelled intents', async () => {
  const storage = memoryStorage();
  let now = 1000;
  const store = DeliveryGuard.createIntentStore(storage, () => now, () => 'intent-2');
  await store.create({ platformId: 'boss', executableIds: ['a'], selectedCount: 1 });
  now = 121001;
  await assert.rejects(store.consume('intent-2'), (error) => error.code === 'INTENT_EXPIRED');

  now = 200000;
  await store.create({ platformId: 'boss', executableIds: ['a'], selectedCount: 1 });
  await store.cancel('intent-2');
  await assert.rejects(store.consume('intent-2'), (error) => error.code === 'INTENT_NOT_FOUND');
});
```

- [x] **Step 2: Run tests and verify RED**

Run:

```bash
node --test tests/delivery-guard.test.js
```

Expected: FAIL because `createIntentStore` and `assertIntentMatchesPlan` are missing.

- [x] **Step 3: Implement serialized storage**

Use storage key `sw_pending_delivery`, a promise tail for serialization, 120000 ms expiry, and a consumed-state write before returning the intent. `create` copies only serializable plan fields. `assertIntentMatchesPlan` compares platform and ordered normalized executable IDs.

- [x] **Step 4: Run focused and full tests**

Run:

```bash
node --test tests/delivery-guard.test.js
npm test
```

Expected: all intent and existing tests PASS.

---

### Task 3: Service Worker Confirmation Authority

**Files:**
- Create: `tests/background-contract.test.js`
- Modify: `src/background.js`

**Interfaces:**
- Consumes: `DeliveryGuard.prepare`, `createIntentStore`, `assertIntentMatchesPlan`
- Produces messages: `PREPARE_DELIVERY`, `CONFIRM_DELIVERY`, `CANCEL_DELIVERY`
- Rejects message: `START_DELIVER`

- [x] **Step 1: Write a failing service-worker contract test**

```js
test('service worker requires a prepared one-time delivery intent', () => {
  const source = fs.readFileSync(path.join(root, 'src/background.js'), 'utf8');
  assert.match(source, /['"]\/src\/delivery-guard\.js['"]/);
  assert.match(source, /msg\.type === 'PREPARE_DELIVERY'/);
  assert.match(source, /msg\.type === 'CONFIRM_DELIVERY'/);
  assert.match(source, /msg\.type === 'CANCEL_DELIVERY'/);
  assert.match(source, /msg\.type === 'START_DELIVER'[\s\S]{0,300}CONFIRMATION_REQUIRED/);
});
```

- [x] **Step 2: Run test and verify RED**

Run:

```bash
node --test tests/background-contract.test.js
```

Expected: FAIL because the service worker still starts on `START_DELIVER`.

- [x] **Step 3: Add prepare, confirm, cancel, and rejection handlers**

Implement:

```js
const deliveryIntentStore = DeliveryGuard.createIntentStore(
  chrome.storage.local,
  () => Date.now(),
  () => 'intent-' + crypto.randomUUID()
);
```

`prepareDelivery(jobIds)` loads the current fixed platform config and review cache, calls `DeliveryGuard.prepare`, stores the intent, and returns `{ ok: true, intentId, plan }`.

`confirmDelivery(intentId)` checks no run is active, consumes the intent, rebuilds the plan from current data, calls `assertIntentMatchesPlan`, then invokes `runDeliver(intent.jobIds)`.

Return errors as:

```js
{
  ok: false,
  error: error.message,
  code: error.code || 'RUN_BLOCKED',
  nextAction: error.nextAction || '请重新扫描后再试'
}
```

Keep the existing per-job delivery state machine unchanged except for accepting only confirmed frozen IDs.

- [x] **Step 4: Run contract and full tests**

Run:

```bash
node --test tests/background-contract.test.js
npm test
```

Expected: contract and all regression tests PASS.

---

### Task 4: Batch Confirmation Dialog and Accessibility

**Files:**
- Create: `tests/sidepanel-contract.test.js`
- Modify: `src/sidepanel.html`
- Modify: `src/sidepanel.js`
- Modify: `src/sidepanel.css`

**Interfaces:**
- Consumes: `PREPARE_DELIVERY`, `CONFIRM_DELIVERY`, `CANCEL_DELIVERY`
- Produces: one dialog per batch and no direct delivery start

- [x] **Step 1: Write failing static UI contract tests**

```js
test('side panel exposes an accessible one-time batch confirmation', () => {
  assert.match(html, /id="deliveryModal"[^>]*role="dialog"[^>]*aria-modal="true"/);
  assert.match(html, /id="deliveryTitle"/);
  assert.match(html, /id="deliveryJobList"/);
  assert.match(html, /id="btnConfirmDelivery"/);
  assert.match(html, /id="btnCancelDelivery"/);
  assert.match(html, /id="log"[^>]*role="log"[^>]*aria-live="polite"/);
  assert.match(html, /id="recoveryCard"[^>]*role="alert"/);
});

test('side panel prepares then confirms instead of directly starting delivery', () => {
  assert.match(js, /type:\s*'PREPARE_DELIVERY'/);
  assert.match(js, /type:\s*'CONFIRM_DELIVERY'/);
  assert.match(js, /type:\s*'CANCEL_DELIVERY'/);
  assert.doesNotMatch(js, /type:\s*'START_DELIVER'/);
});
```

- [x] **Step 2: Run test and verify RED**

Run:

```bash
node --test tests/sidepanel-contract.test.js
```

Expected: FAIL because the confirmation dialog and ARIA contracts are missing.

- [x] **Step 3: Add dialog markup and explicit form labels**

Add a hidden `deliveryModal` with title, summary rows, scrollable job list, warning copy, cancel button, and confirmation button. Add `for` attributes to every standalone label. Add `role="log" aria-live="polite"` to the log and a hidden `role="alert"` recovery card.

- [x] **Step 4: Implement prepare, render, cancel, confirm, and focus behavior**

Replace the direct contact handler with:

```js
chrome.runtime.sendMessage({ type: 'PREPARE_DELIVERY', jobIds: ids }, (response) => {
  if (!response || !response.ok) return showDeliveryError(response);
  pendingDeliveryIntentId = response.intentId;
  renderDeliveryPlan(response.plan);
  openDeliveryModal();
});
```

Confirm once with `CONFIRM_DELIVERY`. Disable the confirmation button while awaiting the response. Cancel on the button, Escape, or backdrop with `CANCEL_DELIVERY`. Trap Tab focus inside the dialog and restore focus to `btnContact` on close.

- [x] **Step 5: Add visible focus, dialog, and recovery styles**

Use `:focus-visible` with a 2 px high-contrast outline and offset. Keep the dialog usable at a 320 px side-panel width. Make the job list scroll instead of growing past the viewport.

- [x] **Step 6: Run UI and full tests**

Run:

```bash
node --test tests/sidepanel-contract.test.js
npm test
```

Expected: UI contracts and all regression tests PASS.

---

### Task 5: Actionable Blocked State

**Files:**
- Modify: `src/background.js`
- Modify: `src/sidepanel.js`
- Modify: `tests/background-contract.test.js`
- Modify: `tests/sidepanel-contract.test.js`

**Interfaces:**
- Produces message: `BLOCKED { code, reason, nextAction }`
- Extends `GET_STATE` with `blockCode`, `blockReason`, `blockNextAction`

- [x] **Step 1: Add failing blocked-state tests**

Assert that `background.js` emits a `BLOCKED` message and returns block metadata from `GET_STATE`. Assert that `sidepanel.js` handles `BLOCKED` and renders `recoveryCard`.

- [x] **Step 2: Run focused tests and verify RED**

Run:

```bash
node --test tests/background-contract.test.js tests/sidepanel-contract.test.js
```

Expected: FAIL because structured blocked state is missing.

- [x] **Step 3: Implement structured blocking**

Change `blockRun` to accept `(reason, code)` and store `state.blockCode`, `state.blockReason`, and `state.blockNextAction = DeliveryGuard.guidanceFor(code).nextAction`. Emit both the existing phase/log events and the new `BLOCKED` message.

Map interrupted worker recovery to `SERVICE_WORKER_INTERRUPTED`; map unknown send results to `SEND_RESULT_UNKNOWN`; map target mismatch responses to `TARGET_UNCERTAIN`; leave unspecified platform failures as `RUN_BLOCKED`.

- [x] **Step 4: Render recovery guidance**

On live `BLOCKED` and restored `GET_STATE`, show the reason and next action, switch to the execution page, and keep automatic retry disabled.

- [x] **Step 5: Run focused and full tests**

Run:

```bash
node --test tests/background-contract.test.js tests/sidepanel-contract.test.js
npm test
```

Expected: blocked-state contracts and all regression tests PASS.

---

### Task 6: Documentation and Full Verification

**Files:**
- Modify: `README.md`
- Modify: `docs/07-multi-platform-design.md`
- Modify: `docs/superpowers/specs/2026-07-24-p0-trust-gate-design.md`

**Interfaces:**
- Documents the shipped behavior and separates automated from real-site evidence.

- [x] **Step 1: Update development and user documentation**

Document:

- “勾选多人 → 一次批次确认 → 系统逐岗校验” flow.
- Two-minute, one-time confirmation intent.
- Direct delivery cannot bypass confirmation.
- Blocked-state recovery guidance.
- Automated verification results.
- Boss and Zhilian test-account status as either passed with recorded evidence or “待真机验收”.

- [x] **Step 2: Run the complete verification suite**

Run:

```bash
npm test
for f in $(rg --files -g '*.js'); do node --check "$f"; done
python3 -m json.tool manifest.json >/dev/null
git diff --check
```

Expected: all tests PASS, every JavaScript file parses, manifest JSON parses, and no whitespace errors exist.

- [x] **Step 3: Re-read the approved P0 acceptance matrix**

Check P0-01 through P0-07 against fresh test or static evidence. Record P0-08 honestly as passed only with explicitly authorized test-account evidence.
