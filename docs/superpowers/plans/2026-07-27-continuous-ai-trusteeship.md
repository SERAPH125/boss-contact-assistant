# Continuous AI Trusteeship Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 让已登记 Boss 会话在普通回复后持续监控多轮消息，以持久化 30～300 秒延迟回复；发送结果暂不可证实时只锁定该条发送而不暂停整段会话；同时提供不会重启已明确拒绝会话的一键全托管，以及联系成功后的托管列表自动刷新。

**Architecture:** 继续以 `conversation-store` 作为单一持久状态源，以 `monitor-engine` 负责读、分类、策略和动作编排，以 `trusteeship-runtime` 统一串行调度周期 alarm 与最近到期 one-shot alarm。副作用使用持久发送意图和精确 outgoing 证据收束；UI 只通过 runtime 快照渲染，`chrome.storage.onChanged` 仅触发防抖刷新。

**Tech Stack:** Chrome Extension Manifest V3、原生 JavaScript、`chrome.storage.local`、`chrome.alarms`、Node `node:test`。

**Open-source patterns:** [AWS transactional-outbox-pattern](https://github.com/aws-samples/transactional-outbox-pattern)、[Temporal Python SDK](https://github.com/temporalio/sdk-python)、[LangGraph](https://github.com/langchain-ai/langgraph)、[Plasmo](https://github.com/PlasmoHQ/plasmo)、[WXT](https://github.com/wxt-dev/wxt)。

---

## Task 0: Freeze and verify the existing registration fixes

**Files:**
- Verify: `src/conversation/conversation-registration.js`
- Verify: `src/background.js`
- Verify: `src/conversation/conversation-store.js`
- Verify: `src/conversation/trusteeship-runtime.js`
- Verify: `src/platform/boss/content-chat.js`
- Test: `tests/conversation-registration.test.js`
- Test: `tests/conversation-store.test.js`
- Test: `tests/trusteeship-runtime.test.js`
- Test: `tests/boss-content-chat.test.js`
- Docs: `README.md`
- Docs: `docs/08-boss-ai-trusteeship.md`
- Docs: `docs/oss-notes.md`

### Step 1: Review the dirty diff

Run:

```bash
git diff --check
git diff --stat
git diff -- src/conversation/conversation-registration.js src/background.js src/conversation/conversation-store.js src/conversation/trusteeship-runtime.js src/platform/boss/content-chat.js
```

Expected: only the previously requested registration, canonical conversation binding and safe-send fixes are present; no unrelated user work is overwritten.

### Step 2: Run the focused baseline tests

Run:

```bash
node --test tests/conversation-registration.test.js tests/conversation-store.test.js tests/trusteeship-runtime.test.js tests/boss-content-chat.test.js
```

Expected: PASS. If a test fails, diagnose and repair it before adding the new state model.

### Step 3: Commit the verified baseline

```bash
git add README.md docs/08-boss-ai-trusteeship.md docs/oss-notes.md src/background.js src/conversation/conversation-registration.js src/conversation/conversation-store.js src/conversation/trusteeship-runtime.js src/platform/boss/content-chat.js tests/boss-content-chat.test.js tests/conversation-registration.test.js tests/conversation-store.test.js tests/trusteeship-runtime.test.js
git commit -m "fix: stabilize auto-registered conversations"
```

Expected: the worktree is clean before the continuous-monitoring implementation begins.

## Task 1: Persist delayed replies and recoverable send verification

**Files:**
- Modify: `src/conversation/conversation-store.js`
- Test: `tests/conversation-store.test.js`

### Step 1: Write failing state-transition tests

Add tests proving:

- `WAITING_REPLY_DUE` persists a frozen `pendingReply` with `fingerprint`, `draft`, `evidenceIds`, `classification`, `createdAt`, and `dueAt`.
- a newer incoming fingerprint cancels the stale delayed reply.
- `markSendUnknown()` moves a conversation to `VERIFYING_SEND`, keeps it enabled, retains the immutable intent, and does not consume an additional quota.
- reconciliation of a normal unknown send returns to `WAITING_HR`.
- reconciliation of an explicit-rejection close enters `ENDED_UNMATCHED`.
- normalization safely migrates old `PAUSED + SEND_RESULT_UNKNOWN` records to `VERIFYING_SEND` only when the matching immutable intent is present.

Run:

```bash
node --test tests/conversation-store.test.js
```

Expected: FAIL because the new states and store methods do not exist.

### Step 2: Implement minimal store primitives

Add:

```js
STATES.WAITING_REPLY_DUE
STATES.VERIFYING_SEND

store.deferAutoReply(conversationId, pendingReply)
store.cancelDeferredAutoReply(conversationId, fingerprint)
store.createDeferredAutoSendIntent(conversationId, fingerprint)
store.reconcileUnknownSend(conversationId, evidence)
```

Rules:

- only the current incoming fingerprint can own `pendingReply`;
- `dueAt >= createdAt`;
- delayed reply creation and cancellation occur inside the existing serialized read-modify-write queue;
- no method may re-create or replay an existing `SEND_RESULT_UNKNOWN` intent;
- `setManaged(false)` clears unsent delayed work but never erases immutable send evidence.

### Step 3: Re-run the focused tests

Run:

```bash
node --test tests/conversation-store.test.js
```

Expected: PASS.

### Step 4: Commit

```bash
git add src/conversation/conversation-store.js tests/conversation-store.test.js
git commit -m "feat: persist delayed trusteeship replies"
```

## Task 2: Schedule safe randomized replies and continue multi-turn monitoring

**Files:**
- Modify: `src/conversation/trusteeship-policy.js`
- Modify: `src/conversation/monitor-engine.js`
- Test: `tests/trusteeship-policy.test.js`
- Test: `tests/monitor-engine.test.js`

### Step 1: Write failing deterministic-delay tests

Inject a deterministic random source and test:

- ordinary authorized reply samples one delay in `[30_000, 300_000]`, persists it, and does not call `send`;
- the same pending reply keeps the original `dueAt` after another cycle;
- at or after `dueAt`, the engine re-reads the target before creating one send intent;
- a newer HR message cancels the old draft and creates a new delayed reply;
- during quiet hours, `dueAt` is the next quiet-end timestamp plus a sampled 30～300 seconds;
- explicit rejection retains the separate auto-close path and does not consume ordinary quota;
- successful ordinary send returns to `WAITING_HR` and later HR messages can start another round;
- unknown send enters verification and never calls `send` again for that intent.

Run:

```bash
node --test tests/trusteeship-policy.test.js tests/monitor-engine.test.js
```

Expected: FAIL because ordinary replies still send immediately.

### Step 2: Implement delay calculation and engine transitions

Add a pure helper:

```js
replyDelayMs(random)
```

It clamps the random source and returns an inclusive value between 30 and 300 seconds. Extend `MonitorEngine.create()` with an injected `random` dependency for tests.

Change `AUTO_REPLY` to:

1. persist `pendingReply`;
2. return without external write;
3. on due cycles, re-read and validate the latest incoming;
4. create exactly one immutable intent;
5. send once;
6. continue in `WAITING_HR` or `VERIFYING_SEND`.

### Step 3: Re-run focused tests

Run:

```bash
node --test tests/trusteeship-policy.test.js tests/monitor-engine.test.js
```

Expected: PASS.

### Step 4: Commit

```bash
git add src/conversation/trusteeship-policy.js src/conversation/monitor-engine.js tests/trusteeship-policy.test.js tests/monitor-engine.test.js
git commit -m "feat: continue multi-turn AI trusteeship"
```

## Task 3: Verify Boss sends without repeating the action

**Files:**
- Modify: `src/platform/boss/content-chat.js`
- Modify: `src/conversation/trusteeship-runtime.js`
- Test: `tests/boss-content-chat.test.js`
- Test: `tests/trusteeship-runtime.test.js`

### Step 1: Write failing read-only verification tests

Add tests proving:

- after the one allowed Enter/click, the content handler polls history for up to about 10 seconds;
- each poll revalidates the exact active conversation and owned message scope;
- polling never presses Enter or clicks the send button again;
- a uniquely matching new outgoing message confirms success;
- a timeout returns unknown, not failure with permission to retry;
- runtime can request verification of an existing immutable intent without calling the send action.

Run:

```bash
node --test tests/boss-content-chat.test.js tests/trusteeship-runtime.test.js
```

Expected: FAIL because the content handler currently performs only an immediate read.

### Step 2: Add bounded read-only polling

Implement a content-side helper that:

- accepts the frozen target and draft;
- repeatedly calls the existing history reader;
- compares against the pre-send outgoing fingerprint set;
- waits between reads;
- returns one exact new outgoing evidence or a terminal unknown result.

Add a read-only runtime message for cross-cycle verification. Do not add a resend message or fallback click.

### Step 3: Re-run focused tests

Run:

```bash
node --test tests/boss-content-chat.test.js tests/trusteeship-runtime.test.js
```

Expected: PASS.

### Step 4: Commit

```bash
git add src/platform/boss/content-chat.js src/conversation/trusteeship-runtime.js tests/boss-content-chat.test.js tests/trusteeship-runtime.test.js
git commit -m "fix: reconcile Boss send evidence safely"
```

## Task 4: Add a one-shot due alarm

**Files:**
- Modify: `src/conversation/trusteeship-runtime.js`
- Modify: `src/background.js`
- Test: `tests/trusteeship-runtime.test.js`

### Step 1: Write failing alarm tests

Test:

- `boss-ai-chat-monitor` remains periodic at 5/10/15 minutes;
- `boss-ai-chat-due` is one-shot and points to the earliest valid `dueAt`;
- changing or clearing pending work replaces or clears the one-shot alarm;
- both alarms enter the same serialized cycle;
- global disable and runtime pause clear both alarms;
- overdue work schedules no earlier than now and is processed immediately on the next serialized turn.

Run:

```bash
node --test tests/trusteeship-runtime.test.js
```

Expected: FAIL because only the periodic alarm exists.

### Step 2: Implement alarm reconciliation

Add:

```js
TRUSTEESHIP_DUE_ALARM = "boss-ai-chat-due"
```

After every cycle and every state mutation:

1. load the canonical store snapshot;
2. find the earliest valid `pendingReply.dueAt`, `pendingAutoClose.dueAt`, or send-verification due timestamp;
3. create/replace one `when` alarm;
4. clear it when there is no pending work.

Route both alarm names through the existing runtime FIFO.

### Step 3: Re-run focused tests

Run:

```bash
node --test tests/trusteeship-runtime.test.js
```

Expected: PASS.

### Step 4: Commit

```bash
git add src/conversation/trusteeship-runtime.js src/background.js tests/trusteeship-runtime.test.js
git commit -m "feat: wake trusteeship at reply due times"
```

## Task 5: Add safe bulk trusteeship controls

**Files:**
- Modify: `src/conversation/conversation-store.js`
- Modify: `src/conversation/trusteeship-runtime.js`
- Modify: `src/sidepanel.html`
- Modify: `src/sidepanel.js`
- Modify: `src/sidepanel.css`
- Test: `tests/conversation-store.test.js`
- Test: `tests/trusteeship-runtime.test.js`
- Test: `tests/sidepanel-runtime.test.js`
- Test: `tests/trusteeship-sidepanel-contract.test.js`

### Step 1: Write failing bulk-operation tests

Test an atomic store operation returning:

```js
{ enabled, unchanged, skipped, failed }
```

Required cases:

- safe `DISABLED` records become `WAITING_HR`;
- already active records are unchanged;
- `ENDED_UNMATCHED` is always skipped and never reopened;
- `PAUSED`, confirmation, delayed, sending, and verification states are skipped;
- bulk disable clears only unsent work and preserves immutable send evidence;
- runtime accepts one exact-key batch protocol and rejects malformed payloads;
- sidepanel renders bulk buttons and one result summary.

Run:

```bash
node --test tests/conversation-store.test.js tests/trusteeship-runtime.test.js tests/sidepanel-runtime.test.js tests/trusteeship-sidepanel-contract.test.js
```

Expected: FAIL because the bulk protocol and controls do not exist.

### Step 2: Implement one atomic store/runtime operation

Add:

```js
store.setAllManaged(enabled)
{ type: "TRUSTEESHIP_SET_ALL_CONVERSATIONS", enabled: true | false }
```

The enable path must explicitly skip `ENDED_UNMATCHED`. The UI must not loop over single-card messages.

Add:

- “一键托管全部可用岗位”;
- “一键结束全部托管” with confirmation;
- bounded result text.

### Step 3: Re-run focused tests

Run:

```bash
node --test tests/conversation-store.test.js tests/trusteeship-runtime.test.js tests/sidepanel-runtime.test.js tests/trusteeship-sidepanel-contract.test.js
```

Expected: PASS.

### Step 4: Commit

```bash
git add src/conversation/conversation-store.js src/conversation/trusteeship-runtime.js src/sidepanel.html src/sidepanel.js src/sidepanel.css tests/conversation-store.test.js tests/trusteeship-runtime.test.js tests/sidepanel-runtime.test.js tests/trusteeship-sidepanel-contract.test.js
git commit -m "feat: add safe bulk trusteeship controls"
```

## Task 6: Refresh the registered list reactively without destroying form edits

**Files:**
- Modify: `src/sidepanel.js`
- Modify: `src/background.js`
- Test: `tests/sidepanel-runtime.test.js`
- Test: `tests/background.test.js`

### Step 1: Write failing reactive-refresh tests

Test:

- `managedConversations`, `pendingApprovals`, `conversationTrusteeship`, and `feishuNotification` changes schedule one debounced refresh;
- the refresh calls `TRUSTEESHIP_GET_STATE` rather than constructing cards from raw storage changes;
- repeated storage changes within 150 ms collapse into one refresh;
- reactive refresh updates cards, badges and status without overwriting focused/dirty API, FAQ, quiet-time or Feishu fields;
- successful contact registration becomes visible without tab switching;
- failed registration produces a bounded diagnostic and no fake card.

Run:

```bash
node --test tests/sidepanel-runtime.test.js tests/background.test.js
```

Expected: FAIL because the current listener only watches `byPlatform`.

### Step 2: Split settings hydration from dynamic snapshot rendering

Implement:

```js
applyTrusteeshipState(state, { preserveForms = false } = {})
scheduleTrusteeshipRefresh()
```

Use full hydration only on initial load or explicit settings reload. Storage-driven refresh must use `preserveForms: true`.

Improve the background registration log so successful contact and failed trusteeship registration are distinguishable.

### Step 3: Re-run focused tests

Run:

```bash
node --test tests/sidepanel-runtime.test.js tests/background.test.js
```

Expected: PASS.

### Step 4: Commit

```bash
git add src/sidepanel.js src/background.js tests/sidepanel-runtime.test.js tests/background.test.js
git commit -m "fix: refresh trusteeship after contact registration"
```

## Task 7: Update documentation and run complete verification

**Files:**
- Modify: `README.md`
- Modify: `docs/08-boss-ai-trusteeship.md`
- Modify: `docs/oss-notes.md`

### Step 1: Update the reader-facing behavior

Document:

- continuous multi-turn monitoring;
- 30～300-second persistent pacing;
- quiet-hour behavior;
- `VERIFYING_SEND` versus a true hard pause;
- no blind resend;
- one-click trusteeship and the permanent `ENDED_UNMATCHED` exclusion;
- automatic registered-list refresh;
- remaining requirements: browser open, login valid, target identity provable.

### Step 2: Run static and focused checks

```bash
git diff --check
node --check src/conversation/conversation-store.js
node --check src/conversation/monitor-engine.js
node --check src/conversation/trusteeship-runtime.js
node --check src/platform/boss/content-chat.js
node --check src/sidepanel.js
```

Expected: PASS.

### Step 3: Run the full suite

```bash
npm test
```

Expected: all tests PASS with no skipped critical trusteeship tests.

### Step 4: Inspect the final diff

```bash
git status --short
git diff --stat HEAD
git diff --check HEAD
```

Expected: only the approved implementation, tests and updated documentation remain.

### Step 5: Commit final documentation

```bash
git add README.md docs/08-boss-ai-trusteeship.md docs/oss-notes.md
git commit -m "docs: explain continuous AI trusteeship"
```

Do not merge or push until the complete regression suite passes and the user has explicitly requested publication.
