# AI Trusteeship Dry-Run Simulator Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a sidepanel dry-run that injects one synthetic HR text message through the real trusteeship AI and policy without reading or writing BOSS, Feishu, alarms, or production conversation state.

**Architecture:** A focused UMD/CommonJS `TrusteeshipSimulator` builds a one-shot `ConversationStore` over private memory storage and runs the existing `MonitorEngine` with the production classifier/policy/fact loader plus local reader/sender/notifier adapters. Runtime exposes one exact-schema sidepanel-only message, while the sidepanel renders a bounded whitelist result and a persistent “仅模拟，未发送” warning.

**Tech Stack:** Chrome Manifest V3 service worker, plain JavaScript UMD/CommonJS modules, Node `node:test`, existing `ConversationStore`, `MonitorEngine`, `TrusteeshipRuntime`, `ReplyAI`, and `TrusteeshipPolicy`.

## Global Constraints

- One simulation accepts exactly one registered Boss conversation and one non-empty text message of at most 600 Unicode code points.
- Simulation uses the currently proven API configuration, current prompt, current resume/FAQ facts, current trusteeship settings, and deterministic policy.
- Production `conversationStore` is read once and never written by simulator code.
- No Chrome tab message, BOSS read/send, Feishu request, alarm mutation, production pending approval, production send intent, baseline mutation, or daily-count mutation is permitted.
- Responses expose only bounded whitelist fields; never expose API keys, webhook secrets, raw provider bodies, full resume text, or raw model responses.
- UI always displays “仅模拟，未发送”.
- Implementation documentation must update `docs/08-boss-ai-trusteeship.md` and `docs/oss-notes.md`.

---

## File Structure

- Create `src/conversation/trusteeship-simulator.js`: one-shot memory storage, isolated engine composition, result projection, and stable error projection.
- Create `tests/trusteeship-simulator.test.js`: direct isolation and decision tests against the simulator module.
- Modify `src/background.js`: import and compose the simulator using protected real classifier and fact loader.
- Modify `src/conversation/trusteeship-runtime.js`: exact request schema and serialized dispatch.
- Modify `tests/trusteeship-runtime.test.js`: request validation, routing, and stable error tests.
- Modify `tests/trusteeship-background-contract.test.js`: service-worker import/composition contract.
- Modify `src/sidepanel.html`: dry-run form and result region.
- Modify `src/sidepanel.js`: managed-conversation options, submit lifecycle, and DOM-safe result rendering.
- Modify `src/sidepanel.css`: isolated simulator panel/result styling.
- Modify `tests/trusteeship-sidepanel-contract.test.js`: static accessibility/security contract.
- Modify `tests/sidepanel-runtime.test.js`: full wiring and rendered result tests.
- Modify `docs/08-boss-ai-trusteeship.md`: operator behavior and limitations.
- Modify `docs/oss-notes.md`: open-source references and implementation decision.

### Task 1: Isolated Simulator Core

**Files:**
- Create: `src/conversation/trusteeship-simulator.js`
- Create: `tests/trusteeship-simulator.test.js`

**Interfaces:**
- Consumes: `ConversationStore.create(storage, clock, idFactory)`, `MonitorEngine.create(deps)`, production store `getSnapshot()`, classifier `classify(input)` / `draft(input)`, policy, `getResumeFacts()`, and clock.
- Produces: `TrusteeshipSimulator.create(deps).simulate({ conversationId, message }) -> Promise<SimulationResult>`.
- `SimulationResult` contains `conversationId`, `message`, `classification`, `decision`, `draft`, `draftEvidenceIds`, `wouldSend`, and `simulated: true`.

- [ ] **Step 1: Write the failing automatic-reply isolation test**

Add a test that seeds a production snapshot containing one enabled Boss conversation, real-looking settings, and a `still_looking` classifier response. Record every production store method except `getSnapshot`, every reader/sender/notifier call, and the production snapshot before the call.

```js
test('runs the real engine in isolated memory and reports wouldSend without production writes', async () => {
  const before = structuredClone(productionSnapshot);
  const simulator = Simulator.create({
    storeModule: Store,
    engineModule: Engine,
    productionStore,
    classifier: safeClassifier,
    policy: Policy,
    getResumeFacts: async () => [{ id: 'faq-line-1', text: '问：还在看机会吗？；答：是的' }],
    clock: () => NOW,
    idFactory: (kind) => kind + '-simulation'
  });

  const result = await simulator.simulate({
    conversationId: 'conv-1',
    message: '还在看机会吗？'
  });

  assert.equal(result.decision.action, 'AUTO_REPLY');
  assert.equal(result.wouldSend, true);
  assert.equal(result.draft, '是的，我还在看合适机会。');
  assert.equal(result.simulated, true);
  assert.deepEqual(productionSnapshot, before);
  assert.deepEqual(productionWriteCalls, []);
  assert.equal(externalReaderCalls, 0);
  assert.equal(externalSenderCalls, 0);
  assert.equal(externalNotifierCalls, 0);
});
```

- [ ] **Step 2: Run the test and verify RED**

Run:

```bash
node --test tests/trusteeship-simulator.test.js
```

Expected: FAIL because `src/conversation/trusteeship-simulator.js` does not exist.

- [ ] **Step 3: Implement the minimum isolated engine composition**

Implement a UMD/CommonJS module with:

```js
function create(deps) {
  return {
    async simulate(input) {
      const production = await deps.productionStore.getSnapshot();
      const target = production.managedConversations[input.conversationId];
      const memory = createMemoryStorage(seedSnapshot(production, target));
      const isolatedStore = deps.storeModule.create(memory, deps.clock, deps.idFactory);
      const observations = { classification: null, draft: null, sentDraft: '' };
      const engine = deps.engineModule.create({
        store: isolatedStore,
        reader: createSyntheticReader(input.message, observations, deps.idFactory),
        classifier: createObservedClassifier(deps.classifier, observations),
        notifier: createNoopNotifier(),
        policy: deps.policy,
        clock: () => new Date(deps.clock()),
        getResumeFacts: deps.getResumeFacts
      });
      const summary = await engine.runCycle();
      return projectResult(input, observations, await isolatedStore.getSnapshot(), summary);
    }
  };
}
```

`seedSnapshot` must copy only the target conversation, normalize it to enabled `WAITING_HR`, remove pending/send/recovery fields, preserve current settings and auto-reply count, force `paused: false`, and set isolated Feishu to disabled. `createSyntheticReader` returns one `kind: "text"` message with an isolated fingerprint and never calls production page code. Its `send` records the draft and returns a synthetic success evidence object.

- [ ] **Step 4: Run the automatic-reply test and verify GREEN**

Run:

```bash
node --test tests/trusteeship-simulator.test.js
```

Expected: PASS with one test and no warnings.

- [ ] **Step 5: Add failing confirmation, rejection, validation, and failure tests**

Add independent tests asserting:

```js
assert.deepEqual(
  (await simulate('薪资是多少？')).decision,
  { action: 'REQUIRE_CONFIRMATION', reasonCode: 'HARD_RISK_SALARY' }
);
assert.equal((await simulate('薪资是多少？')).wouldSend, false);

assert.equal(
  (await simulateWithClassification('不合适', {
    category: 'important',
    confidence: 0.99,
    reasonCode: 'EXPLICIT_REJECTION',
    evidenceIds: [],
    fieldsNeeded: []
  })).wouldSend,
  false
);

await assert.rejects(
  () => simulator.simulate({ conversationId: 'missing', message: '您好' }),
  { code: 'CONVERSATION_NOT_FOUND' }
);
await assert.rejects(
  () => simulator.simulate({ conversationId: 'conv-1', message: '   ' }),
  { code: 'TRUSTEESHIP_MESSAGE_INVALID' }
);
```

Also assert AI classify/draft failures return one of the stable `AI_*` codes and never include a canary raw provider error.

- [ ] **Step 6: Run the new tests and verify RED**

Run:

```bash
node --test tests/trusteeship-simulator.test.js
```

Expected: FAIL on the first missing validation/error projection behavior, not on syntax or fixture setup.

- [ ] **Step 7: Implement validation and stable result projection**

Add helpers that:

- validate exact `conversationId` and message bounds with `Array.from(message).length`;
- verify target exists and `platform === "boss"`;
- derive `AUTO_REPLY/AUTO_REPLY_ALLOWED` only when synthetic sender recorded one send;
- derive confirmation reason and draft from the isolated pending approval;
- include a bounded copy of classifier fields only;
- throw stable `AI_CLASSIFY_FAILED`, `AI_CLASSIFICATION_INVALID`, `AI_DRAFT_FAILED`, `AI_DRAFT_INVALID`, `UNSUPPORTED_PLATFORM`, or `TRUSTEESHIP_SIMULATION_FAILED`;
- never copy exception messages into the response.

- [ ] **Step 8: Run simulator tests and verify GREEN**

Run:

```bash
node --test tests/trusteeship-simulator.test.js
```

Expected: all simulator tests PASS.

- [ ] **Step 9: Commit simulator core**

```bash
git add src/conversation/trusteeship-simulator.js tests/trusteeship-simulator.test.js
git commit -m "feat: add isolated trusteeship simulator"
```

### Task 2: Trusted Runtime and Background Wiring

**Files:**
- Modify: `src/conversation/trusteeship-runtime.js`
- Modify: `src/background.js`
- Modify: `tests/trusteeship-runtime.test.js`
- Modify: `tests/trusteeship-background-contract.test.js`

**Interfaces:**
- Consumes: Task 1 `TrusteeshipSimulator.create(deps)` and `.simulate(input)`.
- Produces: sidepanel-only `TRUSTEESHIP_SIMULATE_MESSAGE` request and `{ ok: true, result }` or `{ ok: false, code }`.

- [ ] **Step 1: Write failing exact-schema runtime tests**

Extend the valid message table with:

```js
{
  type: 'TRUSTEESHIP_SIMULATE_MESSAGE',
  conversationId: 'conv-1',
  message: '还在看机会吗？'
}
```

Extend the invalid table with empty text, 601 code points, 129-character ID, missing fields, and an extra field. Add a controller test whose injected simulator records the input and returns a safe result.

- [ ] **Step 2: Run runtime tests and verify RED**

Run:

```bash
node --test tests/trusteeship-runtime.test.js
```

Expected: FAIL because the new message is rejected and the controller has no simulator dependency.

- [ ] **Step 3: Implement runtime validation and dispatch**

Add `simulator` to `createController(options)` dependency validation. Validate the new request with an exact key set and Unicode message bound. Dispatch it without `checkRunningStateUnsafe()` or alarm reconciliation, but let the injected protected classifier enforce the current API proof:

```js
if (input.type === 'TRUSTEESHIP_SIMULATE_MESSAGE') {
  try {
    return { ok: true, result: await simulator.simulate({
      conversationId: input.conversationId,
      message: input.message.trim()
    }) };
  } catch (error) {
    return safeError(STABLE_SIMULATION_CODES.has(error && error.code)
      ? error.code
      : 'TRUSTEESHIP_SIMULATION_FAILED');
  }
}
```

- [ ] **Step 4: Run runtime tests and verify GREEN**

Run:

```bash
node --test tests/trusteeship-runtime.test.js
```

Expected: all runtime tests PASS.

- [ ] **Step 5: Write failing background contract tests**

Assert that `background.js` imports `/src/conversation/trusteeship-simulator.js`, composes it with `ConversationStore`, `MonitorEngine`, `conversationStore`, `protectedTrusteeshipClassifier`, `TrusteeshipPolicy`, and `getTrusteeshipResumeFacts`, then passes it to `TrusteeshipRuntime.createController`.

- [ ] **Step 6: Run background contract tests and verify RED**

Run:

```bash
node --test tests/trusteeship-background-contract.test.js
```

Expected: FAIL because the simulator is not imported or composed.

- [ ] **Step 7: Implement protected background composition**

Import the simulator before runtime. Create it only after `protectedTrusteeshipClassifier` and `getTrusteeshipResumeFacts` exist:

```js
const trusteeshipSimulator = TrusteeshipSimulator.create({
  storeModule: ConversationStore,
  engineModule: MonitorEngine,
  productionStore: conversationStore,
  classifier: protectedTrusteeshipClassifier,
  policy: TrusteeshipPolicy,
  getResumeFacts: getTrusteeshipResumeFacts,
  clock: () => Date.now(),
  idFactory: makeSimulationId
});
```

Pass `simulator: trusteeshipSimulator` to the runtime controller. `makeSimulationId` must use `crypto.randomUUID()` when available and must never reuse a production conversation ID as a message fingerprint or intent ID.

- [ ] **Step 8: Run runtime and background tests**

Run:

```bash
node --test tests/trusteeship-runtime.test.js tests/trusteeship-background-contract.test.js tests/background-runtime.test.js tests/privacy-contract.test.js
```

Expected: all tests PASS and privacy canaries remain absent.

- [ ] **Step 9: Commit runtime wiring**

```bash
git add src/background.js src/conversation/trusteeship-runtime.js tests/trusteeship-runtime.test.js tests/trusteeship-background-contract.test.js
git commit -m "feat: expose trusted trusteeship simulation"
```

### Task 3: Sidepanel Dry-Run UI

**Files:**
- Modify: `src/sidepanel.html`
- Modify: `src/sidepanel.js`
- Modify: `src/sidepanel.css`
- Modify: `tests/trusteeship-sidepanel-contract.test.js`
- Modify: `tests/sidepanel-runtime.test.js`

**Interfaces:**
- Consumes: Task 2 `TRUSTEESHIP_SIMULATE_MESSAGE`.
- Produces: accessible form IDs `trusteeshipSimulation`, `trusteeshipSimulationConversation`, `trusteeshipSimulationMessage`, `btnRunTrusteeshipSimulation`, `trusteeshipSimulationStatus`, and `trusteeshipSimulationResult`.

- [ ] **Step 1: Write failing static sidepanel contract tests**

Require every simulator element ID, `maxlength="600"`, an `aria-live="polite"` status/result region, the exact warning “使用真实 AI，但不会读取或写入 BOSS，不会修改托管状态或发送飞书。”, the exact result marker “仅模拟，未发送”, and use of `TRUSTEESHIP_SIMULATE_MESSAGE`.

- [ ] **Step 2: Run contract tests and verify RED**

Run:

```bash
node --test tests/trusteeship-sidepanel-contract.test.js
```

Expected: FAIL because simulator controls do not exist.

- [ ] **Step 3: Add minimal accessible markup and styling**

Place a `<details id="trusteeshipSimulation">` directly after “立即检查已登记岗位”. Add a labeled select, textarea, button, status paragraph, and result container. Add focused styles under `.trusteeship-simulation` and `.trusteeship-simulation-result`, including `overflow-wrap: anywhere`; do not use inline HTML injection.

- [ ] **Step 4: Run contract tests and verify partial GREEN**

Run:

```bash
node --test tests/trusteeship-sidepanel-contract.test.js
```

Expected: markup/style assertions PASS; the request wiring assertion remains RED.

- [ ] **Step 5: Write failing full-runtime UI tests**

Extend the fake Chrome runtime with a `TRUSTEESHIP_SIMULATE_MESSAGE` response. Assert:

```js
await h.ids.btnRunTrusteeshipSimulation.trigger('click');
assert.deepEqual(h.sent.find((item) => item.type === 'TRUSTEESHIP_SIMULATE_MESSAGE'), {
  type: 'TRUSTEESHIP_SIMULATE_MESSAGE',
  conversationId: 'conv-1',
  message: '还在看机会吗？'
});
assert.match(h.ids.trusteeshipSimulationResult.textContent, /AUTO_REPLY/);
assert.match(h.ids.trusteeshipSimulationResult.textContent, /仅模拟，未发送/);
assert.equal(h.ids.btnRunTrusteeshipSimulation.disabled, false);
```

Add error cases for no selected conversation, blank text, and a stable API proof error. Assert a raw canary error never appears.

- [ ] **Step 6: Run full-runtime tests and verify RED**

Run:

```bash
node --test tests/sidepanel-runtime.test.js
```

Expected: FAIL because options are not populated and the button has no listener.

- [ ] **Step 7: Implement DOM-safe options, submit, and result rendering**

Update `renderManagedConversations()` to rebuild the simulator `<select>` from the same bounded managed-conversation projection while preserving the selected ID when possible.

Add:

```js
function renderTrusteeshipSimulationResult(result) {
  const root = $('trusteeshipSimulationResult');
  root.replaceChildren();
  // Create labelled rows with document.createElement and textContent only.
}
```

The click handler trims input, enforces local bounds, disables the button, sends the exact request, renders only whitelist fields, displays stable translated errors, and restores the button in `finally`.

- [ ] **Step 8: Run sidepanel tests and verify GREEN**

Run:

```bash
node --test tests/trusteeship-sidepanel-contract.test.js tests/sidepanel-runtime.test.js tests/sidepanel-contract.test.js
```

Expected: all sidepanel tests PASS.

- [ ] **Step 9: Commit the UI**

```bash
git add src/sidepanel.html src/sidepanel.js src/sidepanel.css tests/trusteeship-sidepanel-contract.test.js tests/sidepanel-runtime.test.js
git commit -m "feat: add trusteeship dry-run controls"
```

### Task 4: Documentation and Full Verification

**Files:**
- Modify: `docs/08-boss-ai-trusteeship.md`
- Modify: `docs/oss-notes.md`
- Modify: `package.json` only if the explicit `test:boss` list does not automatically include the new simulator test.

**Interfaces:**
- Consumes: completed simulator runtime and UI.
- Produces: operator instructions, limitation statement, open-source provenance, and complete regression evidence.

- [ ] **Step 1: Update operator documentation**

Document:

- where to open “模拟 HR 新消息（不发送）”;
- how to interpret `AUTO_REPLY`, `REQUIRE_CONFIRMATION`, `wouldSend`, and stable errors;
- that real BOSS monitoring is only proven by a fresh HR message after the stored baseline;
- that simulation never changes BOSS, Feishu, alarms, pending approvals, daily count, or message baseline;
- the four fixtures: “还在看机会吗？”, “薪资是多少？”, “不合适”, and “经验可能不太匹配”.

- [ ] **Step 2: Update open-source notes**

Record the Rasa scripted-conversation, Botium controlled-input/output, and LangGraph explicit-interrupt ideas, clearly distinguishing reusable principles from code copied into this repository.

- [ ] **Step 3: Add the simulator test to explicit test lists**

If `npm run test:boss` enumerates files, insert `tests/trusteeship-simulator.test.js` beside the other trusteeship tests.

- [ ] **Step 4: Run targeted security and feature verification**

Run:

```bash
node --test tests/trusteeship-simulator.test.js tests/trusteeship-runtime.test.js tests/trusteeship-background-contract.test.js tests/trusteeship-sidepanel-contract.test.js tests/sidepanel-runtime.test.js tests/privacy-contract.test.js
```

Expected: all tests PASS, zero failures.

- [ ] **Step 5: Run the complete suite**

Run:

```bash
npm test
```

Expected: exit code 0, zero failing tests.

- [ ] **Step 6: Inspect repository state**

Run:

```bash
git diff --check
git status --short
git diff --stat
```

Expected: no whitespace errors; only planned implementation, tests, and documentation are modified.

- [ ] **Step 7: Commit the completed feature**

```bash
git add package.json docs/08-boss-ai-trusteeship.md docs/oss-notes.md
git commit -m "docs: explain trusteeship dry-run testing"
```

- [ ] **Step 8: Re-run full verification after commits**

Run:

```bash
npm test
git status --short --branch
```

Expected: tests remain green and the working tree is clean.
