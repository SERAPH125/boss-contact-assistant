# AI Explicit Rejection Auto Close Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Let AI alone classify explicit HR rejection, generate one constrained polite closing reply, defer it through quiet hours without consuming the daily quota, send it exactly once, and terminate the conversation as unmatched.

**Architecture:** `ReplyAI` owns the expanded AI JSON/prompt contract; `TrusteeshipPolicy` authorizes `AUTO_CLOSE` or `DEFER_AUTO_CLOSE` from the AI result without keyword matching; `ConversationStore` persists deferred closure and a quota-free `AUTO_CLOSE` send intent; `MonitorEngine` reuses the existing protected sender and outgoing evidence protocol, then moves successful conversations to `ENDED_UNMATCHED`. Runtime DTOs, the sidepanel, and the live drill expose the new states without creating a bypass around the production sender.

**Tech Stack:** JavaScript UMD/CommonJS modules, Chrome Manifest V3 service worker and sidepanel, `chrome.storage.local`, Node.js built-in test runner, fake Chrome/fake DOM integration harnesses.

## Global Constraints

- Explicit rejection recognition must rely entirely on AI classification; do not add rejection keywords, regular expressions, or deterministic message-text overrides.
- `explicit_rejection` requires `confidence >= 0.90`, `reasonCode === "EXPLICIT_REJECTION"`, and an empty `fieldsNeeded`.
- AI closing drafts are at most 45 Unicode code points, contain no question, newline, list, renewed persuasion, experience promotion, or salary/interview/arrival commitment.
- Empty evidence is allowed only for `explicit_rejection`; existing fact-answer evidence requirements stay unchanged.
- Quiet hours persist a deferred close and perform zero Boss writes until a later cycle rereads the conversation and proves no newer incoming message exists.
- `AUTO_CLOSE` never increments and is never blocked by `autoReplyCount` or `dailyAutoReplyLimit`.
- A successful close persists `ENDED_UNMATCHED`, disables monitoring, retains the terminal `AUTO_CLOSE/SENT` intent, and performs no later read, AI, draft, or send.
- Once Enter/click may have happened without complete outgoing evidence, persist `SEND_RESULT_UNKNOWN` and never replay.
- The live drill may report `AUTO_CLOSE`, but the drill itself continues to stage an approval and never directly sends.
- No new runtime dependencies and no direct BOSS private send API.
- Update `README.md`, `docs/08-boss-ai-trusteeship.md`, and `docs/oss-notes.md` alongside production changes.

---

### Task 0: Preserve the Existing Verified Repair Baseline

**Files:**
- Verify only: all currently modified files shown by `git status --short`
- Commit: existing Boss direction, active-tab sender, control-pane, unknown-approval cleanup, runtime, sidepanel, tests, and documentation changes

**Interfaces:**
- Consumes: the already verified working tree with the control-pane fix and current 411-test baseline
- Produces: a clean baseline commit before auto-close work starts

- [ ] **Step 1: Confirm the dirty set contains only the previously reviewed repair**

Run:

```bash
git status --short
git diff --stat
git diff --check
```

Expected: the known repair files are modified, the new design/plan commits are already separate, and `git diff --check` exits 0.

- [ ] **Step 2: Re-run the existing baseline**

Run:

```bash
npm test
rg --files -g '*.js' | xargs -n1 node --check
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8'))"
```

Expected: all current tests pass (411 at plan creation), all JavaScript parses, and the manifest parses.

- [ ] **Step 3: Commit only the verified repair batch**

Run:

```bash
git add README.md docs/08-boss-ai-trusteeship.md docs/oss-notes.md \
  src/conversation/conversation-store.js \
  src/conversation/trusteeship-runtime.js \
  src/platform/boss/content-chat.js \
  src/platform/boss/peer-identity.js \
  src/sidepanel.js \
  tests/background-runtime.test.js \
  tests/boss-content-chat.test.js \
  tests/conversation-store.test.js \
  tests/sidepanel-runtime.test.js \
  tests/trusteeship-runtime.test.js \
  tests/trusteeship-sidepanel-contract.test.js
git diff --cached --check
git commit -m "fix: stabilize Boss trusteeship sending"
```

Expected: the feature work begins from a clean tree and no design/plan file is accidentally folded into this repair commit.

---

### Task 1: Expand the AI Classification and Closing-Draft Contract

**Files:**
- Modify: `src/conversation/reply-ai.js`
- Modify: `src/conversation/trusteeship-runtime.js`
- Test: `tests/reply-ai.test.js`
- Test: `tests/trusteeship-runtime.test.js`
- Document: `docs/08-boss-ai-trusteeship.md`
- Document: `docs/oss-notes.md`

**Interfaces:**
- Consumes: existing strict `ReplyAI.build*Messages`, `parseClassification`, and `parseDraft`
- Produces:
  - classification category `explicit_rejection`
  - `ReplyAI.parseDraft(raw, { category })`
  - empty `evidenceIds` accepted only when `category === "explicit_rejection"`
  - runtime classifier passes the current classification category into draft parsing

- [ ] **Step 1: Write failing `ReplyAI` contract tests**

Add tests equivalent to:

```js
test('accepts an AI-only explicit rejection classification without evidence', () => {
  const parsed = ReplyAI.parseClassification(JSON.stringify({
    category: 'explicit_rejection',
    confidence: 0.96,
    reasonCode: 'EXPLICIT_REJECTION',
    evidenceIds: [],
    fieldsNeeded: []
  }));
  assert.equal(parsed.category, 'explicit_rejection');
});

test('allows empty draft evidence only for explicit rejection', () => {
  const raw = JSON.stringify({
    draft: '收到，感谢您的回复，祝工作顺利。',
    evidenceIds: []
  });
  assert.deepEqual(
    ReplyAI.parseDraft(raw, { category: 'explicit_rejection' }),
    { draft: '收到，感谢您的回复，祝工作顺利。', evidenceIds: [] }
  );
  assert.throws(
    () => ReplyAI.parseDraft(raw, { category: 'courtesy' }),
    (error) => error.code === 'AI_EVIDENCE_MISSING'
  );
});

test('prompts delegate rejection recognition only to AI and constrain the closing draft', () => {
  const classification = ReplyAI.buildClassificationMessages(promptInput)[0].content;
  const draft = ReplyAI.buildDraftMessages({
    ...promptInput,
    classification: {
      category: 'explicit_rejection',
      confidence: 0.96,
      reasonCode: 'EXPLICIT_REJECTION',
      evidenceIds: [],
      fieldsNeeded: []
    }
  })[0].content;
  assert.match(classification, /explicit_rejection/);
  assert.match(classification, /完全由你判断/);
  assert.match(draft, /不得提出问题/);
  assert.match(draft, /45/);
});
```

- [ ] **Step 2: Run the tests and observe RED**

Run:

```bash
node --test tests/reply-ai.test.js
```

Expected: failures show that `explicit_rejection` is not an allowed category, empty draft evidence is rejected, and the new prompt language is absent.

- [ ] **Step 3: Implement the minimal AI contract**

Change the category list and draft parser along these lines:

```js
var CATEGORIES = [
  'still_looking',
  'resume_permission',
  'courtesy',
  'please_wait',
  'resume_fact',
  'explicit_rejection',
  'important',
  'unknown'
];

function parseDraft(text, context) {
  var value = unwrapJson(text);
  if (!hasExactKeys(value, DRAFT_KEYS)) fail('AI_DRAFT_INVALID');
  if (typeof value.draft !== 'string' || value.draft.trim() === '' ||
    Array.from(value.draft).length > MAX_DRAFT_CODE_POINTS) {
    fail('AI_DRAFT_INVALID');
  }
  var evidenceIds = validateIds(value.evidenceIds, 'AI_EVIDENCE_MISSING');
  var category = context && context.category;
  if (evidenceIds.length === 0 && category !== 'explicit_rejection') {
    fail('AI_EVIDENCE_MISSING');
  }
  return { draft: value.draft, evidenceIds: evidenceIds };
}
```

Replace the old “do not generate a reply” instruction with explicit AI-only classification and closing-copy rules. Do not add a local rejection detector.

- [ ] **Step 4: Make the runtime pass classification context to `parseDraft`**

Update the classifier adapter:

```js
draft: async function (input, frozenConfig, assertLease) {
  assertLeaseCurrent(assertLease);
  var raw = await callLLM(
    replyAI.buildDraftMessages(input),
    500,
    frozenConfig
  );
  return replyAI.parseDraft(raw, {
    category: input && input.classification && input.classification.category
  });
}
```

Add a runtime test that stubs `parseDraft(raw, context)` and asserts `context.category === "explicit_rejection"`.

- [ ] **Step 5: Run focused tests and update documentation**

Run:

```bash
node --test tests/reply-ai.test.js tests/trusteeship-runtime.test.js
```

Expected: both suites pass.

Update `docs/08-boss-ai-trusteeship.md` and `docs/oss-notes.md` to record the new category, AI-only recognition boundary, and empty-evidence exception.

- [ ] **Step 6: Commit**

```bash
git add src/conversation/reply-ai.js \
  src/conversation/trusteeship-runtime.js \
  tests/reply-ai.test.js \
  tests/trusteeship-runtime.test.js \
  docs/08-boss-ai-trusteeship.md \
  docs/oss-notes.md
git commit -m "feat: add AI explicit rejection contract"
```

---

### Task 2: Add Deterministic `AUTO_CLOSE` Authorization and Draft Safety

**Files:**
- Modify: `src/conversation/trusteeship-policy.js`
- Test: `tests/trusteeship-policy.test.js`
- Document: `docs/08-boss-ai-trusteeship.md`
- Document: `docs/oss-notes.md`

**Interfaces:**
- Consumes: normalized AI classification including `explicit_rejection`
- Produces:
  - `TrusteeshipPolicy.decide(input)` actions `AUTO_CLOSE` and `DEFER_AUTO_CLOSE`
  - `TrusteeshipPolicy.validateAutoCloseDraft(draft)` returning `{ ok, draft, reasonCode }`

- [ ] **Step 1: Write failing policy tests**

Add:

```js
test('AI-only explicit rejection bypasses facts and daily quota but not quiet hours', () => {
  const base = {
    hardRisk: { blocked: true, reasonCode: 'HARD_RISK_SALARY', fieldsNeeded: ['salaryExpectation'] },
    settings: {
      enabled: true,
      dailyAutoReplyLimit: 1,
      quietHours: { enabled: false, start: '22:00', end: '08:00' }
    },
    conversationEnabled: true,
    quiet: false,
    hasPendingApproval: false,
    dailyCount: 99,
    ai: {
      category: 'explicit_rejection',
      confidence: 0.96,
      reasonCode: 'EXPLICIT_REJECTION',
      evidenceIds: [],
      fieldsNeeded: []
    }
  };
  assert.deepEqual(Policy.decide(base), {
    action: 'AUTO_CLOSE',
    reasonCode: 'EXPLICIT_REJECTION_AUTO_CLOSE'
  });
  assert.deepEqual(Policy.decide({ ...base, quiet: true }), {
    action: 'DEFER_AUTO_CLOSE',
    reasonCode: 'QUIET_HOURS_AUTO_CLOSE'
  });
});

test('explicit rejection confidence and shape fail closed', () => {
  assert.equal(Policy.decide({
    ...baseInput,
    ai: {
      category: 'explicit_rejection',
      confidence: 0.89,
      reasonCode: 'EXPLICIT_REJECTION',
      evidenceIds: [],
      fieldsNeeded: []
    }
  }).action, 'REQUIRE_CONFIRMATION');
});

test('validates a polite closing draft without judging the HR message', () => {
  assert.deepEqual(
    Policy.validateAutoCloseDraft('收到，感谢您的回复，祝工作顺利。'),
    {
      ok: true,
      draft: '收到，感谢您的回复，祝工作顺利。',
      reasonCode: 'AUTO_CLOSE_DRAFT_VALID'
    }
  );
  for (const unsafe of [
    '请问为什么不合适？',
    '能再考虑一下吗',
    '我有三年经验\\n可以胜任',
    '薪资和到岗时间都可以商量'
  ]) {
    assert.equal(Policy.validateAutoCloseDraft(unsafe).ok, false, unsafe);
  }
});
```

- [ ] **Step 2: Run and observe RED**

Run:

```bash
node --test tests/trusteeship-policy.test.js
```

Expected: `AUTO_CLOSE`, `DEFER_AUTO_CLOSE`, and `validateAutoCloseDraft` are missing.

- [ ] **Step 3: Implement explicit-rejection authorization before ordinary hard-risk/quota gates**

Use an AI-shape check, not message text:

```js
function isExplicitRejection(ai) {
  return !!ai &&
    ai.category === 'explicit_rejection' &&
    ai.reasonCode === 'EXPLICIT_REJECTION' &&
    typeof ai.confidence === 'number' &&
    Number.isFinite(ai.confidence) &&
    ai.confidence >= 0.90 &&
    Array.isArray(ai.fieldsNeeded) &&
    ai.fieldsNeeded.length === 0;
}
```

In `decide`, keep global enablement, conversation enablement, and existing pending approval ahead of this branch. If `isExplicitRejection(ai)` is true, return `DEFER_AUTO_CLOSE` during quiet hours and `AUTO_CLOSE` otherwise before the ordinary hard-risk and daily-limit logic.

Implement `validateAutoCloseDraft` with exact code-point length and outbound-safety checks. These checks only validate the generated reply; they must not inspect the HR message or infer rejection.

- [ ] **Step 4: Run focused tests and update docs**

Run:

```bash
node --test tests/trusteeship-policy.test.js
```

Expected: all policy tests pass and ordinary `AUTO_REPLY` quota/evidence tests remain unchanged.

Update the policy tables in `docs/08-boss-ai-trusteeship.md` and the architecture decision in `docs/oss-notes.md`.

- [ ] **Step 5: Commit**

```bash
git add src/conversation/trusteeship-policy.js \
  tests/trusteeship-policy.test.js \
  docs/08-boss-ai-trusteeship.md \
  docs/oss-notes.md
git commit -m "feat: authorize AI polite auto close"
```

---

### Task 3: Persist Deferred Close, Quota-Free Intent, and Terminal State

**Files:**
- Modify: `src/conversation/conversation-store.js`
- Test: `tests/conversation-store.test.js`
- Test: `tests/trusteeship-integration-recovery.test.js`
- Document: `docs/08-boss-ai-trusteeship.md`
- Document: `docs/oss-notes.md`

**Interfaces:**
- Consumes: `AUTO_CLOSE` and `DEFER_AUTO_CLOSE` decisions
- Produces:
  - states `WAITING_AUTO_CLOSE`, `ENDED_UNMATCHED`
  - normalized `pendingAutoClose`
  - `deferAutoClose(conversationId, fingerprint, draft, confidence)`
  - `cancelDeferredAutoClose(conversationId, fingerprint)`
  - `createAutoCloseIntent(conversationId, fingerprint, draft)`
  - existing `completeSend` handles `mode: "AUTO_CLOSE"`

- [ ] **Step 1: Write failing state and normalization tests**

Add store tests that seed raw storage and assert:

```js
assert.deepEqual(ConversationStore.STATES.includes('WAITING_AUTO_CLOSE'), true);
assert.deepEqual(ConversationStore.STATES.includes('ENDED_UNMATCHED'), true);

const deferred = await harness.store.deferAutoClose(
  'conv-1',
  'id:reject',
  '收到，感谢您的回复，祝工作顺利。',
  0.96
);
assert.equal(deferred.state, 'WAITING_AUTO_CLOSE');
assert.deepEqual(deferred.pendingAutoClose, {
  fingerprint: 'id:reject',
  draft: '收到，感谢您的回复，祝工作顺利。',
  confidence: 0.96,
  createdAt: harness.now
});
```

Add damaged-input tests proving `pendingAutoClose` is discarded unless state, fingerprint, 45-code-point draft, confidence, and time are valid together.

- [ ] **Step 2: Run and observe RED**

Run:

```bash
node --test tests/conversation-store.test.js
```

Expected: new states and methods are absent.

- [ ] **Step 3: Implement normalized deferred state**

Add:

```js
var STATES = new Set([
  'DISABLED',
  'WAITING_HR',
  'CLASSIFYING',
  'DRAFTING_AUTO',
  'SENDING',
  'WAITING_CONFIRMATION',
  'WAITING_AUTO_CLOSE',
  'ENDED_UNMATCHED',
  'PAUSED'
]);
```

Normalize `pendingAutoClose` only when `state === "WAITING_AUTO_CLOSE"`. Enforce 45 code points and confidence from 0 through 1. `deferAutoClose` must accept only the current `CLASSIFYING` fingerprint, have no active approval/SENDING intent, clear classification recovery, and persist atomically.

- [ ] **Step 4: Write failing intent, quota, and terminal tests**

Add:

```js
test('AUTO_CLOSE sends from classifying or deferred state without consuming quota', async () => {
  const before = (await harness.store.getSnapshot()).conversationTrusteeship.autoReplyCount;
  const intent = await harness.store.createAutoCloseIntent(
    'conv-1',
    'id:reject',
    '收到，感谢您的回复，祝工作顺利。'
  );
  assert.equal(intent.mode, 'AUTO_CLOSE');
  await harness.store.completeSend(intent.intentId, sendEvidence('conv-1', 'id:sent-close'));
  const snapshot = await harness.store.getSnapshot();
  assert.equal(snapshot.conversationTrusteeship.autoReplyCount, before);
  assert.equal(snapshot.managedConversations['conv-1'].state, 'ENDED_UNMATCHED');
  assert.equal(snapshot.managedConversations['conv-1'].enabled, false);
  assert.equal(snapshot.managedConversations['conv-1'].sendIntent.status, 'SENT');
});
```

Add a second test with `dailyAutoReplyLimit=1` and `autoReplyCount=1`; `createAutoCloseIntent` must still succeed.

- [ ] **Step 5: Implement `AUTO_CLOSE` intent and completion**

Normalize `mode` as `MANUAL | AUTO | AUTO_CLOSE`. Require a fingerprint for both automatic modes.

`createAutoCloseIntent` must:

- accept `CLASSIFYING` with matching `activeFingerprint`, or `WAITING_AUTO_CLOSE` with matching `pendingAutoClose.fingerprint` and exact cached draft;
- ignore daily count/reservations;
- require global enabled/not paused and conversation enabled;
- persist `state: "SENDING"` and clear `pendingAutoClose`.

In `completeSend`:

```js
if (intent.mode === 'AUTO') {
  snapshot.conversationTrusteeship.autoReplyCount += 1;
}
if (intent.mode === 'AUTO_CLOSE') {
  conversation.enabled = false;
  conversation.state = 'ENDED_UNMATCHED';
} else {
  conversation.state = conversation.enabled ? 'WAITING_HR' : 'DISABLED';
}
```

Do not increment quota for `AUTO_CLOSE` in success, unknown-send, or fresh-worker recovery.

- [ ] **Step 6: Add recovery and cleanup tests**

Cover:

- fresh Worker with `AUTO_CLOSE/SENDING` → `PAUSED/SEND_RESULT_UNKNOWN`, no quota increment;
- `WAITING_AUTO_CLOSE` survives a Worker restart and remains deferred;
- disabling/resetting/removing clears `pendingAutoClose`;
- `setManaged(true)` is the only explicit path from `ENDED_UNMATCHED` back to `WAITING_HR`;
- `cancelDeferredAutoClose` requires an exact fingerprint and returns to `WAITING_HR`.

Run:

```bash
node --test tests/conversation-store.test.js tests/trusteeship-integration-recovery.test.js
```

Expected: all store and recovery tests pass.

- [ ] **Step 7: Update docs and commit**

Document state transitions, quota behavior, restart recovery, and explicit re-enable behavior.

```bash
git add src/conversation/conversation-store.js \
  tests/conversation-store.test.js \
  tests/trusteeship-integration-recovery.test.js \
  docs/08-boss-ai-trusteeship.md \
  docs/oss-notes.md
git commit -m "feat: persist deferred unmatched close"
```

---

### Task 4: Execute Immediate AI Auto Close Exactly Once

**Files:**
- Modify: `src/conversation/monitor-engine.js`
- Test: `tests/monitor-engine.test.js`
- Test: `tests/privacy-contract.test.js`
- Document: `docs/08-boss-ai-trusteeship.md`
- Document: `docs/oss-notes.md`

**Interfaces:**
- Consumes:
  - policy actions `AUTO_CLOSE`, `DEFER_AUTO_CLOSE`
  - store `createAutoCloseIntent`
  - policy `validateAutoCloseDraft`
- Produces: immediate non-quiet explicit-rejection auto close through the existing `reader.send` evidence protocol

- [ ] **Step 1: Replace the old rejection test with a failing immediate-send test**

Use the real engine harness:

```js
test('high-confidence AI explicit rejection sends one polite close and ends unmatched', async () => {
  const harness = await makeHarness({
    getResumeFacts: async () => [],
    reader: {
      async read(conversation) {
        return readOk(conversation, [incoming('reject', '不合适')], 'id:reject');
      },
      async send(conversation, draft) {
        assert.equal(draft, '收到，感谢您的回复，祝工作顺利。');
        return sendOk(conversation.conversationId, 'id:close-outgoing');
      }
    },
    classifier: {
      async classify() {
        return {
          category: 'explicit_rejection',
          confidence: 0.96,
          reasonCode: 'EXPLICIT_REJECTION',
          evidenceIds: [],
          fieldsNeeded: []
        };
      },
      async draft() {
        return {
          draft: '收到，感谢您的回复，祝工作顺利。',
          evidenceIds: []
        };
      }
    }
  });
  await harness.register(['conv-1']);
  await harness.enableGlobal();

  const first = await harness.engine.runCycle();
  const second = await harness.engine.runCycle();
  const snapshot = await harness.store.getSnapshot();

  assert.equal(first.autoSent, 1);
  assert.equal(second.checked, 0);
  assert.equal(harness.calls.send.length, 1);
  assert.equal(snapshot.managedConversations['conv-1'].state, 'ENDED_UNMATCHED');
  assert.equal(snapshot.conversationTrusteeship.autoReplyCount, 0);
});
```

- [ ] **Step 2: Run and observe RED**

Run:

```bash
node --test --test-name-pattern='explicit rejection' tests/monitor-engine.test.js
```

Expected: the engine still creates a pending approval or rejects empty facts/evidence.

- [ ] **Step 3: Allow classification without facts and normalize close drafts**

Always call the classifier for reliable text messages. Keep ordinary fact responses protected in `normalizeClassification` and `normalizeDraft`, but allow empty evidence only when the normalized classification category is `explicit_rejection`.

Change draft normalization signature:

```js
function normalizeDraft(value, facts, classification) {
  var explicit = classification &&
    classification.category === 'explicit_rejection';
  if (!exactKeys(value, ['draft', 'evidenceIds']) ||
    typeof value.draft !== 'string' ||
    value.draft.trim() === '' ||
    Array.from(value.draft).length > MAX_DRAFT_CODE_POINTS ||
    !idsAreSubset(value.evidenceIds, facts, !explicit)) {
    throw engineError('AI_DRAFT_INVALID');
  }
  return { draft: value.draft.trim(), evidenceIds: value.evidenceIds.slice() };
}
```

- [ ] **Step 4: Execute `AUTO_CLOSE` through the existing send protocol**

After draft generation:

```js
if (decision.action === 'AUTO_CLOSE' && draft) {
  var safety = policy.validateAutoCloseDraft(draft.draft);
  if (!safety.ok) {
    decision = {
      action: 'REQUIRE_CONFIRMATION',
      reasonCode: 'AI_AUTO_CLOSE_DRAFT_UNSAFE'
    };
  } else {
    var intent = await store.createAutoCloseIntent(
      current.conversationId,
      message.fingerprint,
      safety.draft
    );
    var outcome = await executeSend(current, safety.draft, intent);
    if (outcome.sent) {
      output.autoSent += 1;
      return true;
    }
    addError(output, outcome.errorCode);
    return false;
  }
}
```

Recheck policy and fresh store state immediately before creating the intent, as the ordinary `AUTO_REPLY` path already does.

- [ ] **Step 5: Add failure and privacy tests**

Cover:

- confidence 0.89 → one pending approval, zero sends;
- classifier/draft failure → one pending approval;
- unsafe question/persuasion draft → one pending approval;
- target/send unknown → `PAUSED/SEND_RESULT_UNKNOWN`, one attempted send, zero retry;
- arbitrary provider error and unsafe draft content do not leak into public errors or logs.

Run:

```bash
node --test tests/monitor-engine.test.js tests/privacy-contract.test.js
```

Expected: all tests pass.

- [ ] **Step 6: Update docs and commit**

```bash
git add src/conversation/monitor-engine.js \
  tests/monitor-engine.test.js \
  tests/privacy-contract.test.js \
  docs/08-boss-ai-trusteeship.md \
  docs/oss-notes.md
git commit -m "feat: send AI rejection close once"
```

---

### Task 5: Defer Through Quiet Hours and Revalidate New Messages

**Files:**
- Modify: `src/conversation/monitor-engine.js`
- Modify: `src/conversation/conversation-store.js` only if a focused store seam needs adjustment
- Test: `tests/monitor-engine.test.js`
- Test: `tests/conversation-store.test.js`
- Document: `docs/08-boss-ai-trusteeship.md`
- Document: `docs/oss-notes.md`

**Interfaces:**
- Consumes: `deferAutoClose`, `cancelDeferredAutoClose`, `createAutoCloseIntent`
- Produces: quiet-hours `WAITING_AUTO_CLOSE` flow that rereads before sending

- [ ] **Step 1: Write failing quiet deferral test**

```js
test('quiet explicit rejection defers with zero writes then sends after a clean reread', async () => {
  const harness = await explicitRejectionHarness({
    quietHours: { enabled: true, start: '22:00', end: '08:00' },
    now: '2026-07-26T23:00:00+08:00'
  });

  const quiet = await harness.engine.runCycle();
  let snapshot = await harness.store.getSnapshot();
  assert.equal(quiet.autoSent, 0);
  assert.equal(harness.calls.send.length, 0);
  assert.equal(snapshot.managedConversations['conv-1'].state, 'WAITING_AUTO_CLOSE');

  harness.setNow('2026-07-27T08:01:00+08:00');
  harness.reader.setMessages([]);
  const awake = await harness.engine.runCycle();
  snapshot = await harness.store.getSnapshot();
  assert.equal(awake.autoSent, 1);
  assert.equal(harness.calls.send.length, 1);
  assert.equal(snapshot.managedConversations['conv-1'].state, 'ENDED_UNMATCHED');
  assert.equal(snapshot.conversationTrusteeship.autoReplyCount, 0);
});
```

- [ ] **Step 2: Run and observe RED**

Run:

```bash
node --test --test-name-pattern='quiet explicit rejection' tests/monitor-engine.test.js
```

Expected: quiet mode creates an approval or `WAITING_AUTO_CLOSE` is skipped forever.

- [ ] **Step 3: Persist `DEFER_AUTO_CLOSE`**

When policy returns `DEFER_AUTO_CLOSE`, validate the draft and call:

```js
await store.deferAutoClose(
  current.conversationId,
  message.fingerprint,
  safety.draft,
  classification.confidence
);
```

Return without creating approval, intent, notifier call, or quota reservation.

- [ ] **Step 4: Select and reread `WAITING_AUTO_CLOSE` conversations**

Include `WAITING_AUTO_CLOSE` in the engine’s readable state set. After `reader.read`:

- if a newer incoming exists, call `cancelDeferredAutoClose` and process the new messages normally;
- if no newer incoming exists and quiet has ended, recheck global/conversation state, draft safety, API guard, and exact fingerprint, then create `AUTO_CLOSE` intent and send;
- if still quiet, checkpoint only and perform zero AI/draft/send calls;
- if read/target proof fails, use the existing retry/pause mapping.

- [ ] **Step 5: Add newer-message and restart tests**

Add:

```js
test('a newer HR message cancels the deferred close before any send', async () => {
  const harness = await explicitRejectionHarness({
    quietHours: { enabled: true, start: '22:00', end: '08:00' },
    now: '2026-07-26T23:00:00+08:00'
  });
  await harness.engine.runCycle();

  harness.setNow('2026-07-27T08:01:00+08:00');
  harness.reader.setMessages([
    incoming('reject', '不合适'),
    incoming('newer', '方便补充一下项目经历吗')
  ]);
  harness.classifier.setClassification({
    category: 'important',
    confidence: 0.98,
    reasonCode: 'RESUME_DETAIL_QUERY',
    evidenceIds: [],
    fieldsNeeded: ['projectExperience']
  });

  const result = await harness.engine.runCycle();
  const snapshot = await harness.store.getSnapshot();
  assert.equal(harness.calls.send.length, 0);
  assert.equal(result.pending, 1);
  assert.equal(
    snapshot.managedConversations['conv-1'].pendingAutoClose,
    undefined
  );
  assert.equal(
    snapshot.managedConversations['conv-1'].lastProcessedFingerprint,
    'id:newer'
  );
});

test('a restarted engine rereads WAITING_AUTO_CLOSE before sending', async () => {
  const harness = await explicitRejectionHarness({
    quietHours: { enabled: true, start: '22:00', end: '08:00' },
    now: '2026-07-26T23:00:00+08:00'
  });
  await harness.engine.runCycle();
  const persisted = harness.storage.snapshot();

  const restarted = await explicitRejectionHarness({
    storageSeed: persisted,
    now: '2026-07-27T08:01:00+08:00'
  });
  restarted.reader.setMessages([]);
  const result = await restarted.engine.runCycle();
  const snapshot = await restarted.store.getSnapshot();

  assert.equal(result.autoSent, 1);
  assert.equal(restarted.calls.send.length, 1);
  assert.equal(
    snapshot.managedConversations['conv-1'].state,
    'ENDED_UNMATCHED'
  );
  assert.equal(snapshot.conversationTrusteeship.autoReplyCount, 0);
});
```

Run:

```bash
node --test tests/monitor-engine.test.js tests/conversation-store.test.js
```

Expected: all quiet, replacement-message, and recovery cases pass.

- [ ] **Step 6: Update docs and commit**

```bash
git add src/conversation/monitor-engine.js \
  src/conversation/conversation-store.js \
  tests/monitor-engine.test.js \
  tests/conversation-store.test.js \
  docs/08-boss-ai-trusteeship.md \
  docs/oss-notes.md
git commit -m "feat: defer rejection close through quiet hours"
```

---

### Task 6: Expose Terminal/Deferred State and Keep Live Drill Non-Sending

**Files:**
- Modify: `src/conversation/trusteeship-live-drill.js`
- Modify: `src/conversation/trusteeship-runtime.js`
- Modify: `src/sidepanel.js`
- Test: `tests/trusteeship-live-drill.test.js`
- Test: `tests/trusteeship-runtime.test.js`
- Test: `tests/sidepanel-runtime.test.js`
- Test: `tests/trusteeship-sidepanel-contract.test.js`
- Test: `tests/background-runtime.test.js`
- Document: `README.md`
- Document: `docs/08-boss-ai-trusteeship.md`
- Document: `docs/oss-notes.md`

**Interfaces:**
- Consumes: states `WAITING_AUTO_CLOSE`, `ENDED_UNMATCHED` and decision `AUTO_CLOSE`
- Produces:
  - safe DTO projection for the new states
  - sidepanel labels
  - live drill report `AUTO_CLOSE` while still staging manual approval

- [ ] **Step 1: Write failing live-drill projection test**

Replace the old “explicit rejection never sends directly” expectation:

```js
test('live drill reports AUTO_CLOSE but still stages approval instead of sending', async () => {
  const harness = createExplicitRejectionHarness();
  const result = await harness.liveDrill.stage({
    conversationId: 'conv-1',
    message: '不合适'
  });
  assert.deepEqual(result.decision, {
    action: 'AUTO_CLOSE',
    reasonCode: 'EXPLICIT_REJECTION_AUTO_CLOSE'
  });
  assert.equal(result.wouldSend, true);
  assert.equal(result.sentToBoss, false);
  assert.equal(harness.calls.staged.length, 1);
});
```

- [ ] **Step 2: Write failing DTO and UI tests**

Assert:

```js
assert.equal(
  state.managedConversations['deferred'].state,
  'WAITING_AUTO_CLOSE'
);
assert.equal(
  state.managedConversations['ended'].state,
  'ENDED_UNMATCHED'
);
assert.match(renderedDeferredText, /等待静默结束后礼貌回复/);
assert.match(renderedEndedText, /已结束－未匹配/);
assert.equal(activeManagedCount, 0);
```

The ended card must expose “打开会话” and “从列表移除”, but no retry button and no checked running toggle.

- [ ] **Step 3: Run and observe RED**

Run:

```bash
node --test tests/trusteeship-live-drill.test.js \
  tests/trusteeship-runtime.test.js \
  tests/sidepanel-runtime.test.js \
  tests/trusteeship-sidepanel-contract.test.js \
  tests/background-runtime.test.js
```

Expected: the drill reports `AUTO_REPLY`/confirmation and the new states have no labels or DTO assertions.

- [ ] **Step 4: Implement safe projections and UI**

In live drill projection:

```js
var autoClose = observations.classification &&
  observations.classification.category === 'explicit_rejection' &&
  observations.decision &&
  observations.decision.action === 'AUTO_CLOSE';

decision: {
  action: autoClose ? 'AUTO_CLOSE' : (wouldSend ? 'AUTO_REPLY' : 'REQUIRE_CONFIRMATION'),
  reasonCode: autoClose
    ? 'EXPLICIT_REJECTION_AUTO_CLOSE'
    : existingReasonCode
}
```

Continue calling `createLiveDrillApproval`; do not create `AUTO_CLOSE` intent in the drill.

Add sidepanel mappings:

```js
WAITING_AUTO_CLOSE: '等待静默结束后礼貌回复',
ENDED_UNMATCHED: '已结束－未匹配'
```

Count only `enabled === true` conversations whose state is not `ENDED_UNMATCHED`.

- [ ] **Step 5: Run focused suites and update all reader-facing docs**

Run the five focused suites from Step 3.

Update:

- README behavior summary and validation boundary;
- state tables, prompt contract, policy, quiet flow, quota, recovery, UI, and acceptance sections in `docs/08-boss-ai-trusteeship.md`;
- open-source comparison, AI-only misclassification tradeoff, and test evidence in `docs/oss-notes.md`.

- [ ] **Step 6: Commit**

```bash
git add src/conversation/trusteeship-live-drill.js \
  src/conversation/trusteeship-runtime.js \
  src/sidepanel.js \
  tests/trusteeship-live-drill.test.js \
  tests/trusteeship-runtime.test.js \
  tests/sidepanel-runtime.test.js \
  tests/trusteeship-sidepanel-contract.test.js \
  tests/background-runtime.test.js \
  README.md \
  docs/08-boss-ai-trusteeship.md \
  docs/oss-notes.md
git commit -m "feat: expose unmatched conversation ending"
```

---

### Task 7: Full Verification and Safe Browser Acceptance

**Files:**
- Verify: all changed source, tests, and documentation
- Optional test-only fixture updates: existing files under `tests/fixtures/`

**Interfaces:**
- Consumes: completed AI contract, policy, store, engine, runtime, UI, and drill changes
- Produces: automated and read-only browser evidence suitable for handoff

- [ ] **Step 1: Run all automated checks**

```bash
npm test
rg --files -g '*.js' | xargs -n1 node --check
node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest ok')"
git diff --check
```

Expected: every test passes, syntax and manifest checks exit 0, and there is no whitespace error.

- [ ] **Step 2: Review the complete diff**

```bash
git status --short
git diff --stat HEAD~7..HEAD
git log --oneline -8
```

Confirm:

- no HR-message keyword detector was added;
- `AUTO_CLOSE` is excluded from all quota increments and reservation counts;
- `ENDED_UNMATCHED` is skipped by the engine;
- the live drill cannot call the production sender directly;
- every code task updated development documentation.

- [ ] **Step 3: Reload the unpacked extension and run non-sending acceptance**

In the existing ego-browser task space:

1. Reload “求职联系助手” on `chrome://extensions`.
2. Open the real sidepanel.
3. Run the live drill with a synthetic explicit rejection.
4. Verify the report says `AUTO_CLOSE`, the generated draft is at most 45 characters, and the drill creates a pending item without sending to Boss.
5. Do not approve the pending item and do not create a real `AUTO_CLOSE` production intent during this acceptance.

Expected: AI classification/draft and UI projection are verified without an external Boss write.

- [ ] **Step 4: Commit any final test/document corrections**

If Step 1–3 required corrections, use a focused commit:

```bash
git add README.md \
  docs/08-boss-ai-trusteeship.md \
  docs/oss-notes.md \
  src/conversation/reply-ai.js \
  src/conversation/trusteeship-policy.js \
  src/conversation/conversation-store.js \
  src/conversation/monitor-engine.js \
  src/conversation/trusteeship-live-drill.js \
  src/conversation/trusteeship-runtime.js \
  src/sidepanel.js \
  tests/reply-ai.test.js \
  tests/trusteeship-policy.test.js \
  tests/conversation-store.test.js \
  tests/trusteeship-integration-recovery.test.js \
  tests/monitor-engine.test.js \
  tests/privacy-contract.test.js \
  tests/trusteeship-live-drill.test.js \
  tests/trusteeship-runtime.test.js \
  tests/sidepanel-runtime.test.js \
  tests/trusteeship-sidepanel-contract.test.js \
  tests/background-runtime.test.js
git diff --cached --check
git commit -m "test: verify AI rejection auto close"
```

If no correction was needed, do not create an empty commit.

- [ ] **Step 5: Report the remaining real-platform evidence boundary**

State explicitly:

- automated and live-drill validation do not prove a real HR rejection was captured;
- production acceptance still requires a new post-baseline HR message, a non-quiet automatic close or a quiet deferred close, one matching outgoing bubble, `ENDED_UNMATCHED`, and a second cycle with zero read/send;
- no real HR message is sent without a new, exact user authorization for that live acceptance target and draft.
