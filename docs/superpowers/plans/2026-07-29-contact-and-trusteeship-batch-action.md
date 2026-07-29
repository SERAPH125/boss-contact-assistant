# Contact And Trusteeship Batch Action Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add mutually exclusive “联系已选” and “联系已选并开启 AI 托管” batch actions whose selected jobs and mode remain frozen through confirmation and execution.

**Architecture:** Extend the existing one-time delivery intent with a whitelisted `deliveryMode`, then propagate that frozen value from preparation into `runDeliver`. The contact loop keeps its current external-contact semantics; only verified successful BOSS conversations in trusteeship mode are registered with `enabled=true`, while the conversation store remains authoritative for terminal-state protection.

**Tech Stack:** Chrome MV3 extension, plain JavaScript, Node.js `node:test`, HTML/CSS sidepanel UI.

## Global Constraints

- Keep the exact user-facing labels `联系已选` and `联系已选并开启 AI 托管`.
- The two batch actions are mutually exclusive from preparation until cancellation or execution.
- `CONTACT_ONLY` never enables trusteeship.
- `CONTACT_AND_TRUSTEESHIP` only enables a reliably registered successful BOSS conversation.
- Never reopen `ENDED_UNMATCHED`.
- Keep Zhili contact-only because AI trusteeship is unsupported there.
- Update development and user documentation with every code change.

---

### Task 1: Freeze Delivery Mode In The One-Time Intent

**Files:**
- Modify: `tests/delivery-guard.test.js`
- Modify: `src/delivery-guard.js`

**Interfaces:**
- Consumes: `DeliveryGuard.prepare(input)` with `input.deliveryMode`.
- Produces: `plan.deliveryMode`, persisted `intent.deliveryMode`, and mode comparison in `assertIntentMatchesPlan(intent, plan)`.

- [x] **Step 1: Write the failing tests**

Add tests proving `CONTACT_ONLY` is the safe default, `CONTACT_AND_TRUSTEESHIP` is accepted, invalid values are rejected, the intent persists the mode, and a different rebuilt mode fails matching.

- [x] **Step 2: Run test to verify it fails**

Run: `node --test tests/delivery-guard.test.js`
Expected: FAIL because delivery plans and intents do not yet expose `deliveryMode`.

- [x] **Step 3: Write minimal implementation**

Add exported constants/normalization, carry the mode through `prepare`, persist it in `createIntentStore`, and compare it in `assertIntentMatchesPlan`.

- [x] **Step 4: Run test to verify it passes**

Run: `node --test tests/delivery-guard.test.js`
Expected: PASS.

### Task 2: Propagate Mode And Enable Only Verified Successful Conversations

**Files:**
- Modify: `tests/conversation-registration.test.js`
- Modify: `tests/background-contract.test.js`
- Modify: `src/conversation/conversation-registration.js`
- Modify: `src/background.js`

**Interfaces:**
- Consumes: `prepareDelivery(jobIds, deliveryMode)` and the consumed intent.
- Produces: `runDeliver(jobIds, { reserved, deliveryMode })` and `ConversationRegistration.fromSuccessfulContact(job, result, options)`.

- [x] **Step 1: Write the failing tests**

Add registration tests proving contact-only produces `enabled=false` and trusteeship mode produces `enabled=true`. Add background contract assertions proving the mode is accepted only during preparation and is passed from the consumed intent into `runDeliver`.

- [x] **Step 2: Run tests to verify they fail**

Run: `node --test tests/conversation-registration.test.js tests/background-contract.test.js`
Expected: FAIL because registration does not accept mode options and background does not propagate a frozen mode.

- [x] **Step 3: Write minimal implementation**

Pass the mode into plan construction and execution. Add `enabled` to registration input, and log a distinct warning if enabling trusteeship fails after a successful contact.

- [x] **Step 4: Run tests to verify they pass**

Run: `node --test tests/conversation-registration.test.js tests/background-contract.test.js`
Expected: PASS.

### Task 3: Add Mutually Exclusive Sidepanel Actions

**Files:**
- Modify: `tests/sidepanel-contract.test.js`
- Modify: `tests/sidepanel-runtime.test.js`
- Modify: `src/sidepanel.html`
- Modify: `src/sidepanel.css`
- Modify: `src/sidepanel.js`

**Interfaces:**
- Consumes: selected job IDs and active platform.
- Produces: `startDeliveryPreparation(deliveryMode, sourceButton)` and a confirmation modal rendered from `plan.deliveryMode`.

- [x] **Step 1: Write the failing tests**

Add contract/runtime tests for both labels, BOSS-only visibility of the trusteeship button, shared disabled state, frozen PREPARE payload, and mode-specific confirmation text.

- [x] **Step 2: Run tests to verify they fail**

Run: `node --test tests/sidepanel-contract.test.js tests/sidepanel-runtime.test.js`
Expected: FAIL because the second button and mode-aware UI do not exist.

- [x] **Step 3: Write minimal implementation**

Add the second button, shared button-state renderer, a single preparation handler parameterized by mode, modal copy for the frozen plan, and CSS for a responsive two-action group.

- [x] **Step 4: Run tests to verify they pass**

Run: `node --test tests/sidepanel-contract.test.js tests/sidepanel-runtime.test.js`
Expected: PASS.

### Task 4: Documentation And Full Verification

**Files:**
- Modify: `docs/07-multi-platform-design.md`
- Modify: `docs/user-manual.md`
- Modify: `docs/quick-start.md`

**Interfaces:**
- Consumes: final UI and behavior.
- Produces: developer and user-facing descriptions matching production behavior.

- [x] **Step 1: Update documentation**

Document the two mutually exclusive modes, confirmation behavior, BOSS-only trusteeship action, successful-contact requirement, and terminal-state protection.

- [x] **Step 2: Run focused tests**

Run: `node --test tests/delivery-guard.test.js tests/conversation-registration.test.js tests/background-contract.test.js tests/sidepanel-contract.test.js tests/sidepanel-runtime.test.js`
Expected: PASS.

- [x] **Step 3: Run the complete suite**

Run: `npm test`
Expected: PASS with no regressions.

- [x] **Step 4: Inspect the final diff**

Run: `git diff --check` and inspect only the files listed in this plan, preserving unrelated dirty-worktree changes.
