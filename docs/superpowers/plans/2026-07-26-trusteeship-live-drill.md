# AI Trusteeship Live Drill Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the isolated no-send simulator with a production pending-approval drill whose confirmed draft can be sent once to the selected real Boss HR, while separately proving the real monitor reader path.

**Architecture:** Keep the one-shot in-memory AI evaluation so synthetic HR text cannot pollute the production message baseline. After evaluation, create a dedicated `LIVE_DRILL` approval in the production store, send it through the existing leased Feishu notifier, and let the existing `SEND_EDITED` resolution path perform target reread and real Boss delivery.

**Tech Stack:** Chrome MV3, plain JavaScript, Node.js built-in test runner, existing ConversationStore/MonitorEngine/Feishu notifier.

## Global Constraints

- Running a drill never sends to Boss directly; only `SEND_EDITED` from the plugin pending workbench may send.
- The synthetic HR message must not modify production `lastIncomingFingerprint`, `processedFingerprints`, `recentMessages`, `monitorCursor`, or `autoReplyCount`.
- Feishu may receive the bounded HR message body and draft, but never credentials, arbitrary URLs, mentions, provider errors, or unbounded context.
- Existing global prerequisites, quiet hours, target identity gates, notification lease checks, idempotent send intent, and unknown-result terminal behavior remain active.
- Update developer documentation in the same change.

---

### Task 1: Persist a production live-drill approval without polluting monitoring state

**Files:**
- Modify: `tests/conversation-store.test.js`
- Modify: `src/conversation/conversation-store.js`

**Interfaces:**
- Produces: `store.createLiveDrillApproval(input) -> Promise<Approval>`.
- Approval adds `origin: "LIVE_MONITOR" | "LIVE_DRILL"`.

- [ ] **Step 1: Write failing store tests**

Add tests that call:

```js
await store.createLiveDrillApproval({
  conversationId: 'conv-1',
  drillFingerprint: 'live-drill:one',
  message: '你现在薪资多少，期望多少',
  reasonCode: 'HARD_RISK_SALARY',
  fieldsNeeded: [],
  draft: ''
});
```

Assert the approval is `PENDING` and `origin === "LIVE_DRILL"`, the conversation becomes `WAITING_CONFIRMATION`, and the pre-call `lastIncomingFingerprint`, `processedFingerprints`, `recentMessages`, `monitorCursor`, and `autoReplyCount` remain byte-for-byte equal. Add rejection tests for an unmanaged, paused, already-pending, or already-sending conversation.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
node --test tests/conversation-store.test.js
```

Expected: FAIL because `createLiveDrillApproval` does not exist.

- [ ] **Step 3: Implement the minimal store transition**

Add approval-origin normalization, implement `createLiveDrillApproval`, add it to the returned store API, and preserve `origin` across reload. Existing `createOrMergeApproval` must explicitly create `origin: "LIVE_MONITOR"`.

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```bash
node --test tests/conversation-store.test.js
```

Expected: PASS.

### Task 2: Expose leased notification delivery and include bounded HR body

**Files:**
- Modify: `tests/monitor-engine.test.js`
- Modify: `tests/feishu-notifier.test.js`
- Modify: `tests/privacy-contract.test.js`
- Modify: `src/conversation/monitor-engine.js`
- Modify: `src/conversation/feishu-notifier.js`

**Interfaces:**
- Produces: `engine.notifyPending() -> Promise<Summary>`.
- Feishu input accepts `origin`, `latestMessage`, and `draft`.

- [ ] **Step 1: Write failing engine and card tests**

Add a MonitorEngine test where a pre-existing live-drill approval is notified exactly once through `engine.notifyPending()` without invoking reader or sender. Assert payload fields:

```js
{
  origin: 'LIVE_DRILL',
  latestMessage: '你现在薪资多少，期望多少',
  draft: ''
}
```

Add Feishu tests asserting `LIVE_DRILL` renders “模拟 HR 正文”, `LIVE_MONITOR` renders “HR 正文”, content is limited and sanitized, and configured credentials still block egress. Update privacy assertions so explicitly authorized chat text may occur only in the final Feishu card body while credentials and provider-error canaries remain forbidden.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
node --test tests/monitor-engine.test.js tests/feishu-notifier.test.js tests/privacy-contract.test.js
```

Expected: FAIL because `notifyPending`, message-body payload, and card fields are absent.

- [ ] **Step 3: Implement notification behavior**

Project the final approval message and draft into `notificationPayload`, add the bounded plain-text fields to `buildApprovalCard`, and expose a serialized `notifyPending()` that reuses existing reservation, latest-state and lease checks.

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```bash
node --test tests/monitor-engine.test.js tests/feishu-notifier.test.js tests/privacy-contract.test.js
```

Expected: PASS.

### Task 3: Convert the simulator module and runtime endpoint into a live drill

**Files:**
- Move: `src/conversation/trusteeship-simulator.js` to `src/conversation/trusteeship-live-drill.js`
- Move: `tests/trusteeship-simulator.test.js` to `tests/trusteeship-live-drill.test.js`
- Modify: `tests/trusteeship-runtime.test.js`
- Modify: `tests/trusteeship-background-contract.test.js`
- Modify: `tests/background-contract.test.js`
- Modify: `src/conversation/trusteeship-runtime.js`
- Modify: `src/background.js`
- Modify: `package.json`

**Interfaces:**
- Produces: `TrusteeshipLiveDrill.create(deps).stage({ conversationId, message })`.
- Runtime accepts exactly `TRUSTEESHIP_STAGE_LIVE_DRILL`.

- [ ] **Step 1: Write failing live-drill tests**

Change the former simulator tests to assert:

- isolated AI evaluation still uses the real classifier/policy;
- production `createLiveDrillApproval` is called once with the synthetic message and generated draft;
- `productionEngine.notifyPending()` is called after persistence;
- response contains `approvalId`, `liveDrill: true`, `sentToBoss: false`, and notification status;
- explicit provider failures create no approval;
- duplicate active approval returns a stable error and creates no notification.

Change runtime tests so the new message is rejected unless global trusteeship is running and all current prerequisites pass.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
node --test tests/trusteeship-live-drill.test.js tests/trusteeship-runtime.test.js tests/trusteeship-background-contract.test.js tests/background-contract.test.js
```

Expected: FAIL because the live-drill module and runtime message do not exist.

- [ ] **Step 3: Implement live drill composition**

Rename the module/global, retain one-shot evaluation, stage the production approval, call `notifyPending`, and replace background/runtime `simulator` injection with `liveDrill`. Generate fingerprints with `crypto.randomUUID()` when available. Map arbitrary exceptions to `TRUSTEESHIP_LIVE_DRILL_FAILED`.

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```bash
node --test tests/trusteeship-live-drill.test.js tests/trusteeship-runtime.test.js tests/trusteeship-background-contract.test.js tests/background-contract.test.js
```

Expected: PASS.

### Task 4: Replace the safe-simulation UI with explicit live-delivery controls

**Files:**
- Modify: `tests/trusteeship-sidepanel-contract.test.js`
- Modify: `tests/sidepanel-runtime.test.js`
- Modify: `src/sidepanel.html`
- Modify: `src/sidepanel.js`
- Modify: `src/sidepanel.css`

**Interfaces:**
- Consumes: `TRUSTEESHIP_STAGE_LIVE_DRILL`.
- Produces: one per-run consent checkbox and a pending-approval result projection.

- [ ] **Step 1: Write failing UI tests**

Require:

- heading “真实外发演练”;
- warning that Feishu receives the simulated HR body and plugin confirmation sends to the real HR;
- unchecked consent blocks the runtime message;
- checked consent sends `TRUSTEESHIP_STAGE_LIVE_DRILL`;
- success text says “已创建真实发送待确认，当前尚未发送给 HR”;
- no “仅模拟，未发送”, “运行安全模拟”, or old message type remains.

- [ ] **Step 2: Run tests and verify RED**

Run:

```bash
node --test tests/trusteeship-sidepanel-contract.test.js tests/sidepanel-runtime.test.js
```

Expected: FAIL on the old safe-simulation controls.

- [ ] **Step 3: Implement the UI**

Update labels, add the explicit checkbox, render `approvalId` and Feishu notification state with DOM `textContent`, refresh trusteeship state and approvals after staging, and keep the result distinct from production-monitor evidence.

- [ ] **Step 4: Run tests and verify GREEN**

Run:

```bash
node --test tests/trusteeship-sidepanel-contract.test.js tests/sidepanel-runtime.test.js
```

Expected: PASS.

### Task 5: Prove monitor behavior separately and update developer documentation

**Files:**
- Modify: `tests/trusteeship-integration-recovery.test.js`
- Modify: `tests/conversation-reader.test.js`
- Modify: `docs/08-boss-ai-trusteeship.md`
- Modify: `docs/oss-notes.md`
- Modify: `README.md`

**Interfaces:**
- Produces: an explicit distinction between `liveDrill` proof and real inbound-monitor proof.

- [ ] **Step 1: Add monitor regression assertions**

Add an integration case whose reader returns a stable baseline, then one new incoming fixture, then the same baseline again. Assert `checked > 0`, `newMessages === 1`, one approval/action only, and no duplicate processing. Add reader fixture assertions for stable peer binding, incoming direction, baseline ordering, and fingerprint.

- [ ] **Step 2: Run monitor tests**

Run:

```bash
node --test tests/conversation-reader.test.js tests/trusteeship-integration-recovery.test.js
```

Expected: PASS after any minimal fixture correction required by the documented reader contract.

- [ ] **Step 3: Update documentation**

Document the real side effects, confirmation sequence, Feishu-body privacy consequence, stable errors, and the separate end-to-end monitor acceptance criterion. Record the OSS references and state that their architecture was studied without adding dependencies.

- [ ] **Step 4: Run complete verification**

Run:

```bash
npm test
node --check src/conversation/conversation-store.js
node --check src/conversation/monitor-engine.js
node --check src/conversation/feishu-notifier.js
node --check src/conversation/trusteeship-live-drill.js
node --check src/conversation/trusteeship-runtime.js
node --check src/background.js
node --check src/sidepanel.js
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest ok')"
git diff --check
```

Expected: all tests pass, syntax commands exit 0, `manifest ok`, and no whitespace errors.

- [ ] **Step 5: Inspect the final diff and commit**

Run:

```bash
git status --short
git diff --stat
git diff -- src/conversation src/sidepanel.html src/sidepanel.js src/sidepanel.css tests docs README.md package.json
git add README.md package.json src tests docs
git commit -m "feat: add real trusteeship outbound drill"
```

Expected: only live-drill, notification-body, monitor-proof and documentation changes are committed.
