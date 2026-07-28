# Chrome Store Visual Assets Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Generate seven privacy-safe, upload-ready Chrome Web Store images for 求职联系助手 at the exact required dimensions.

**Architecture:** Build a deterministic local HTML/CSS preview with one synthetic scene per query parameter, render every scene at its native canvas size in the isolated ego-browser task space, capture an opaque JPEG, and convert it to a 24-bit PNG without resizing. A Node validator and contract test enforce the expected scene set, dimensions, PNG format, and no-alpha requirement. Product runtime code and extension storage are not changed.

**Tech Stack:** Static HTML/CSS/JavaScript, Node.js test runner, ego-browser CLI/CDP, macOS `sips`, PNG assets.

## Global Constraints

- Use only synthetic companies, HR names, roles, messages, quotas, and logs.
- Never read or display the user's current BOSS conversations, account identity, API Key, Feishu Webhook, signing secret, résumé, or conversation IDs.
- Keep automatic outbound trusteeship accurately represented as an optional current feature.
- Do not claim platform endorsement, guaranteed safety, risk-control avoidance, or guaranteed recruitment outcomes.
- Generate at native output dimensions: screenshots at 1280×800, small promo at 440×280, marquee promo at 1400×560.
- Deliver 24-bit PNG files with no Alpha channel.
- Use ego-browser task space `chrome store assets` for rendering and capture.
- Preserve unrelated working-tree deletions and do not stage them.
- Update developer/release documentation with generation and validation instructions.

---

## Task 1: Add the visual-scene contract test

**Files:**

- Create: `tests/store-assets-source.test.js`
- Reference: `docs/superpowers/specs/2026-07-28-chrome-store-visual-assets-design.md`

- [ ] Add a failing test that expects `docs/store-assets/source/preview.html`, `preview.css`, and `preview.js`.
- [ ] Assert that the source declares exactly these seven scenes:
  `job-screening`, `contact-confirmation`, `ai-trusteeship`,
  `human-confirmation`, `execution-log`, `promo-small`, and
  `promo-marquee`.
- [ ] Assert that the source includes the approved product claims and synthetic fixture marker.
- [ ] Assert that known real-data samples and forbidden claims are absent.
- [ ] Run `node --test tests/store-assets-source.test.js` and confirm the expected RED failure.

## Task 2: Implement the deterministic synthetic preview

**Files:**

- Create: `docs/store-assets/source/preview.html`
- Create: `docs/store-assets/source/preview.css`
- Create: `docs/store-assets/source/preview.js`
- Reuse: `icons/icon128.png`

- [ ] Add one full-canvas root and select the scene from `?scene=<name>`.
- [ ] Build shared screenshot chrome: neutral background, product header, title,
  side navigation, quota badge, and content card system.
- [ ] Implement the five 1280×800 feature scenes using only synthetic fixture data.
- [ ] Implement the 440×280 small promotional tile with short copy readable at thumbnail size.
- [ ] Implement the 1400×560 marquee tile with product copy and simplified interface cards.
- [ ] Ensure every scene has an opaque background and no remote fonts, images, or network dependencies.
- [ ] Run `node --test tests/store-assets-source.test.js` and confirm GREEN.

## Task 3: Add automated output validation

**Files:**

- Create: `scripts/validate-store-assets.mjs`
- Modify: `package.json`
- Test: `tests/store-assets-source.test.js`

- [ ] Add `npm run validate:store-assets`.
- [ ] Validate the exact seven output paths and expected dimensions.
- [ ] Use `sips` to reject missing files, wrong dimensions, non-PNG files, or Alpha channels.
- [ ] Print one bounded success line per asset and fail with a clear message.
- [ ] Extend the contract test to assert the output manifest in the validator.
- [ ] Run the focused test and confirm GREEN.

## Task 4: Render all assets with ego-browser

**Files generated:**

- Create: `docs/store-assets/01-job-screening.png`
- Create: `docs/store-assets/02-contact-confirmation.png`
- Create: `docs/store-assets/03-ai-trusteeship.png`
- Create: `docs/store-assets/04-human-confirmation.png`
- Create: `docs/store-assets/05-execution-log.png`
- Create: `docs/store-assets/promo-small-440x280.png`
- Create: `docs/store-assets/promo-marquee-1400x560.png`

- [ ] Start a local static server bound to `127.0.0.1`.
- [ ] Reuse ego-browser task space `chrome store assets`.
- [ ] For each scene, set the browser viewport to the exact target dimensions.
- [ ] Capture at 100% scale as a quality-100 JPEG to avoid an Alpha channel.
- [ ] Convert each JPEG to its final PNG with `sips` without resizing.
- [ ] Remove only the temporary JPEG capture files after the PNGs are verified.
- [ ] Run `npm run validate:store-assets`.

## Task 5: Visual and privacy QA

**Files:**

- Inspect: all seven files under `docs/store-assets/`

- [ ] Open and visually inspect every image at native dimensions.
- [ ] Confirm no clipped text, overlap, browser chrome, cursor, focus ring, or scrollbars.
- [ ] Confirm the small tile remains readable at 440×280.
- [ ] Confirm every company, HR, message, and job is synthetic.
- [ ] Confirm no credentials, URLs containing tokens, platform account names, real conversation IDs, or external tab titles appear.
- [ ] If an issue is found, fix the source and regenerate only the affected scene.
- [ ] Re-run `npm run validate:store-assets`.

## Task 6: Document generation and upload usage

**Files:**

- Create: `docs/store-assets/README.md`
- Modify: `docs/chrome-web-store-release.md`
- Modify: `docs/chrome-web-store-listing.md`

- [ ] Document the seven files, dimensions, intended dashboard field, and synthetic-data guarantee.
- [ ] Document how to serve the preview and regenerate with ego-browser.
- [ ] Document the validation command and manual privacy checklist.
- [ ] Link the assets from the Chrome Web Store release and listing guides.
- [ ] Record that the visual-asset work does not change product runtime behavior.
- [ ] Run documentation and source contract tests.

## Task 7: Final verification and commit

**Files:**

- Verify: all files created or modified by Tasks 1–6

- [ ] Run `npm test`.
- [ ] Run `npm run validate:store-assets`.
- [ ] Inspect `git diff --check`.
- [ ] Inspect `git status --short` and exclude unrelated deleted files.
- [ ] Commit only the implementation plan, preview source, tests, validator, generated images, and related documentation.
- [ ] Close ego-browser task space `chrome store assets` with `keep: false` only after all verification passes.
