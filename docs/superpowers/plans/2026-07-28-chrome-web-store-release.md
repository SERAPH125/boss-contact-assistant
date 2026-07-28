# Chrome Web Store Release Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a reproducible, allowlisted Chrome Web Store ZIP and the disclosure/review materials required to submit the current extension.

**Architecture:** The product source is narrowed to the two implemented platforms, BOSS and Zhilian. A focused Node release module owns the exact runtime allowlist and validation, while a thin CLI creates a clean staging directory and ZIP; contract tests execute the real CLI and inspect the real archive. Store-facing privacy and review documents describe the unchanged automatic outbound AI behavior honestly.

**Tech Stack:** Manifest V3, browser extension JavaScript, Node.js built-ins, `node:test`, system `zip`/`unzip`, Markdown.

## Global Constraints

- Preserve automatic AI replies without per-message human confirmation; do not modify trusteeship policy, monitor, sender, quiet-hours, delay, quota, or end-state behavior.
- Support only BOSS and Zhilian in the submitted product; remove the unfinished Liepin UI, registry entry, default configuration, description, and host permission.
- Package only an explicit runtime allowlist; unknown files are excluded by default.
- Keep `manifest.json` at the ZIP root.
- Do not package tests, docs, scripts, `package.json`, `.git*`, `.DS_Store`, `.env*`, archives, certificates, logs, or unreferenced legacy scripts.
- Do not add runtime npm dependencies.
- Keep existing unrelated deletions of `README.md`, `UPSTREAM_LICENSE`, and `UPSTREAM_README.md` untouched and out of all commits.
- Update relevant developer and user documentation after code changes.

---

### Task 1: Remove the unfinished Liepin product surface

**Files:**
- Modify: `tests/manifest.test.js`
- Modify: `tests/sidepanel-contract.test.js`
- Modify: `tests/platform-config-api-test-binding.test.js`
- Modify: `manifest.json`
- Modify: `src/platform/registry.js`
- Modify: `src/platform/config.js`
- Modify: `src/sidepanel.html`
- Modify: `src/sidepanel.js`
- Modify: `docs/07-multi-platform-design.md`
- Modify: `docs/oss-notes.md`
- Modify: `docs/user-manual.md`
- Modify: `docs/quick-start.md`

**Interfaces:**
- Consumes: existing global `PLATFORMS`, `defaultPlatformCfg(id)`, `PlatformConfig.ensureMigrated()`, and side-panel `activePlatform`.
- Produces: a two-platform product contract where only `boss` and `zhilian` can be selected or initialized.

- [ ] **Step 1: Write failing platform-scope tests**

Add contract assertions equivalent to:

```js
test('submits only implemented recruitment platforms', () => {
  assert.equal(manifest.host_permissions.some((p) => p.includes('liepin.com')), false);
  assert.doesNotMatch(manifest.description, /猎聘|Liepin/i);
});

test('does not render or configure an unfinished Liepin platform', () => {
  assert.doesNotMatch(html, /data-platform="liepin"|fields-liepin|猎聘/);
  assert.doesNotMatch(script, /activePlatform === 'liepin'|'liepin'/);
});
```

Extend the configuration harness test to call `ensureMigrated()` with no prior `byPlatform` and assert:

```js
assert.deepEqual(Object.keys(result.byPlatform).sort(), ['boss', 'zhilian']);
```

Load `src/platform/registry.js` in a minimal VM and assert `Object.keys(PLATFORMS)` is exactly `['boss', 'zhilian']`.

- [ ] **Step 2: Run the focused tests and verify RED**

Run:

```bash
node --test tests/manifest.test.js tests/sidepanel-contract.test.js tests/platform-config-api-test-binding.test.js
```

Expected: failures identify the existing Liepin host permission, UI card/fields, registry entry, and default configuration.

- [ ] **Step 3: Implement the two-platform source contract**

Make these minimal changes:

```json
"description": "半自动双平台：Boss / 智联。扫描 → 勾选 → 仅联系已选。拟人化降风险，BYOK。"
```

Remove `*://*.liepin.com/*` from `host_permissions`; delete the `liepin` registry object and `byPlatform.liepin` initialization; delete the Liepin platform card and filter fields; reduce side-panel field switching and platform hints to `boss` and `zhilian`; delete Liepin-only form collection.

Update the four affected documents so the public feature matrix and architecture describe only BOSS and Zhilian. Add the 2026-07-28 Chrome release references and decision to `docs/oss-notes.md`.

- [ ] **Step 4: Run the focused tests and verify GREEN**

Run:

```bash
node --test tests/manifest.test.js tests/sidepanel-contract.test.js tests/platform-config-api-test-binding.test.js
```

Expected: all focused tests pass.

- [ ] **Step 5: Commit only Task 1 files**

```bash
git add manifest.json src/platform/registry.js src/platform/config.js src/sidepanel.html src/sidepanel.js \
  tests/manifest.test.js tests/sidepanel-contract.test.js tests/platform-config-api-test-binding.test.js \
  docs/07-multi-platform-design.md docs/oss-notes.md docs/user-manual.md docs/quick-start.md
git commit -m "chore: remove unfinished Liepin release surface"
```

---

### Task 2: Add an allowlisted Chrome package builder

**Files:**
- Create: `scripts/chrome-store-files.mjs`
- Create: `scripts/build-chrome-store-package.mjs`
- Create: `tests/chrome-store-package.test.js`
- Modify: `package.json`
- Create: `docs/chrome-web-store-release.md`

**Interfaces:**
- Produces: `CHROME_STORE_FILES: readonly string[]`.
- Produces: `validateReleaseFile(root, relativePath): Promise<void>`.
- Produces: CLI command `npm run package:chrome`.
- Produces: `dist/chrome-web-store/boss-contact-assistant-<manifest.version>.zip`.

- [ ] **Step 1: Write the failing release-package test**

Create a test that imports the allowlist, spawns the real package script, reads the real ZIP listing with `/usr/bin/unzip -Z1`, and asserts:

```js
assert.equal(result.status, 0, result.stderr);
assert.ok(entries.includes('manifest.json'));
assert.deepEqual(entries.sort(), [...CHROME_STORE_FILES].sort());
for (const forbidden of [
  /^tests\//, /^docs\//, /^scripts\//, /^package\.json$/,
  /(^|\/)\.DS_Store$/, /\.env/, /\.zip$/, /^src\/content-(chat|search)\.js$/,
  /^src\/selectors\.js$/
]) {
  assert.equal(entries.some((entry) => forbidden.test(entry)), false);
}
```

Also parse every Manifest icon, background worker, side-panel page, content script, and its local HTML/CSS/script dependencies and assert each is present in `CHROME_STORE_FILES`.

- [ ] **Step 2: Run the package test and verify RED**

Run:

```bash
node --test tests/chrome-store-package.test.js
```

Expected: failure because the release module and package script do not exist.

- [ ] **Step 3: Implement the allowlist module**

`scripts/chrome-store-files.mjs` exports a frozen array containing only `manifest.json`, `LICENSE`, three icons, and the runtime files enumerated in the approved design. Normalize paths with POSIX separators, reject absolute paths and `..`, and use `lstat()` to reject symbolic links.

The module must not derive its list from `find`, `git ls-files`, or a denylist.

- [ ] **Step 4: Implement the package CLI**

The CLI must:

```js
const manifest = JSON.parse(await readFile(join(root, 'manifest.json'), 'utf8'));
if (!/^\d+\.\d+\.\d+(?:\.\d+)?$/.test(manifest.version)) {
  throw new Error('manifest.version must be a Chrome version string');
}
```

Then it creates a new staging directory under `dist/chrome-web-store/`, copies allowlisted files with `copyFile`, invokes `/usr/bin/zip -X -q -r <archive> .` from the staging directory, verifies the listing through `/usr/bin/unzip -Z1`, and only retains the archive when its normalized file set exactly matches the allowlist. On failure it removes the incomplete archive and exits non-zero with a bounded message.

Add:

```json
"package:chrome": "node scripts/build-chrome-store-package.mjs"
```

Document the command, output path, prerequisites, allowlist boundary, verification commands, and store upload procedure in `docs/chrome-web-store-release.md`.

- [ ] **Step 5: Run the package test and verify GREEN**

Run:

```bash
node --test tests/chrome-store-package.test.js
```

Expected: pass and produce the versioned ZIP.

- [ ] **Step 6: Commit only Task 2 files**

```bash
git add scripts/chrome-store-files.mjs scripts/build-chrome-store-package.mjs \
  tests/chrome-store-package.test.js package.json docs/chrome-web-store-release.md
git commit -m "build: add allowlisted Chrome store package"
```

---

### Task 3: Add privacy, disclosure, and reviewer materials

**Files:**
- Create: `docs/privacy-policy.md`
- Create: `docs/chrome-web-store-listing.md`
- Create: `tests/chrome-store-docs.test.js`
- Modify: `docs/chrome-web-store-release.md`
- Modify: `docs/oss-notes.md`

**Interfaces:**
- Produces: a public privacy policy suitable for an unauthenticated repository URL.
- Produces: copy-ready Chrome Web Store listing, permission justifications, data-use answers, and reviewer instructions.

- [ ] **Step 1: Write failing documentation contract tests**

Create assertions that require the privacy policy to mention local storage, API keys, AI providers, Feishu, recruitment-site messages, deletion, no sale, contact method, and the unchanged automatic-send behavior:

```js
for (const phrase of [
  'API Key', '飞书', 'AI 服务商', '浏览器本地', '自动发送',
  '删除', '不会出售'
]) {
  assert.match(privacy, new RegExp(phrase));
}
```

Require the listing document to contain single purpose, short description, detailed description, `storage`, `tabs`, `scripting`, `sidePanel`, `offscreen`, `alarms`, host-permission reasons, reviewer steps, screenshot checklist, and a prominent automatic-send review-risk note.

- [ ] **Step 2: Run the documentation test and verify RED**

Run:

```bash
node --test tests/chrome-store-docs.test.js
```

Expected: failure because the documents do not exist.

- [ ] **Step 3: Write the privacy policy**

The policy must state:

- credentials and configuration are stored in `chrome.storage.local`;
- job data, resume facts, and relevant conversation text may be sent to the user-selected AI endpoint;
- approval notifications may be sent to the configured Feishu webhook;
- enabled trusteeship can send bounded replies automatically without per-message confirmation;
- data is used only for the extension’s user-facing purpose and is not sold or used for advertising;
- uninstalling the extension or clearing extension storage removes local data;
- third-party services retain/process data under their own policies;
- contact is the repository’s public Issues URL.

- [ ] **Step 4: Write the store listing and reviewer instructions**

Include copy-ready title, short description, detailed description, single-purpose statement, each permission justification, data-disclosure selections, exact setup and reviewer test steps for BOSS/Zhilian, how to disable trusteeship, screenshots/assets checklist, and the known risk that current automatic outbound behavior may be rejected under Chrome’s messaging policy.

Update `docs/chrome-web-store-release.md` with the final public privacy URL pattern and a pre-submission checklist. Update `docs/oss-notes.md` with the official Chrome policy sources used.

- [ ] **Step 5: Run the documentation test and verify GREEN**

Run:

```bash
node --test tests/chrome-store-docs.test.js
```

Expected: pass.

- [ ] **Step 6: Commit only Task 3 files**

```bash
git add docs/privacy-policy.md docs/chrome-web-store-listing.md \
  docs/chrome-web-store-release.md docs/oss-notes.md tests/chrome-store-docs.test.js
git commit -m "docs: add Chrome store privacy and review materials"
```

---

### Task 4: Verify the unchanged product and final upload artifact

**Files:**
- Modify: `docs/chrome-web-store-release.md`
- Modify: `docs/08-boss-ai-trusteeship.md`
- Generated, ignored: `dist/chrome-web-store/boss-contact-assistant-0.3.6.zip`

**Interfaces:**
- Consumes: `npm test`, `npm run package:chrome`, and the allowlisted archive.
- Produces: a verified upload artifact and recorded verification evidence.

- [ ] **Step 1: Run syntax and full regression tests**

Run:

```bash
node --check src/background.js
node --check src/sidepanel.js
npm test
```

Expected: all checks pass, including all existing AI trusteeship tests that prove automatic outbound behavior was not disabled.

- [ ] **Step 2: Build the final ZIP twice and verify reproducible membership**

Run:

```bash
npm run package:chrome
/usr/bin/unzip -Z1 dist/chrome-web-store/boss-contact-assistant-0.3.6.zip
npm run package:chrome
/usr/bin/unzip -t dist/chrome-web-store/boss-contact-assistant-0.3.6.zip
```

Expected: both builds succeed; the archive is structurally valid and its entry set exactly matches the allowlist.

- [ ] **Step 3: Inspect package content and policy boundaries**

Run:

```bash
/usr/bin/unzip -p dist/chrome-web-store/boss-contact-assistant-0.3.6.zip manifest.json
/usr/bin/unzip -Z1 dist/chrome-web-store/boss-contact-assistant-0.3.6.zip | \
  grep -E '(^tests/|^docs/|^scripts/|package.json|\\.DS_Store|\\.env|liepin|src/content-chat\\.js|src/content-search\\.js|src/selectors\\.js)'
```

Expected: Manifest parses and contains no Liepin permission; the forbidden-entry search returns no lines.

- [ ] **Step 4: Record verification evidence in developer docs**

Append the date, commands, test count, ZIP name, entry count, and the explicit statement “automatic outbound trusteeship remains enabled and unchanged” to `docs/chrome-web-store-release.md` and `docs/08-boss-ai-trusteeship.md`.

- [ ] **Step 5: Run final diff and workspace checks**

Run:

```bash
git diff --check
git status --short --branch
git diff --name-status HEAD
```

Expected: no whitespace errors; only this task’s intended files plus the three preserved external deletions are visible.

- [ ] **Step 6: Commit final verification docs**

```bash
git add docs/chrome-web-store-release.md docs/08-boss-ai-trusteeship.md
git commit -m "docs: record Chrome store package verification"
```
