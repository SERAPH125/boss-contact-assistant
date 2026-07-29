# AI 托管飞书配置前置展示 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 AI 托管页面最上方优先展示完整飞书 Webhook 配置区块。

**Architecture:** 只调整 `src/sidepanel.html` 的 DOM 原生顺序，保留所有字段 ID 和事件绑定。使用静态契约测试固定飞书区块必须早于托管开关及 HR 常用问答，并同步更新用户手册和开源参考记录。

**Tech Stack:** Manifest V3、原生 HTML/CSS/JavaScript、Node.js `node:test`

## Global Constraints

- 保留所有飞书字段和按钮的既有 ID。
- 不修改 Webhook、签名密钥的保存和脱敏显示逻辑。
- 不修改飞书测试通知、托管前置校验或消息发送逻辑。
- 不新增权限、网络请求或运行时依赖。
- DOM、键盘焦点和屏幕阅读器顺序保持一致。

---

### Task 1: 固定并实现飞书配置前置顺序

**Files:**
- Modify: `tests/trusteeship-sidepanel-contract.test.js`
- Modify: `src/sidepanel.html`
- Modify: `docs/user-manual.md`
- Modify: `docs/oss-notes.md`

**Interfaces:**
- Consumes: `src/sidepanel.js` 通过既有元素 ID 绑定的飞书和托管事件。
- Produces: 飞书配置区块早于 `trusteeshipEnabled` 和 `secHrFaq` 的 DOM 契约。

- [x] **Step 1: Write the failing test**

在 `tests/trusteeship-sidepanel-contract.test.js` 增加：

```js
test('places Feishu setup before other AI trusteeship controls', () => {
  const paneIdx = html.indexOf('id="setup-trusteeship"');
  const feishuIdx = html.indexOf('id="feishuEnabled"');
  const settingsIdx = html.indexOf('id="trusteeshipEnabled"');
  const faqIdx = html.indexOf('id="secHrFaq"');
  assert.ok(paneIdx >= 0);
  assert.ok(feishuIdx > paneIdx && feishuIdx < settingsIdx);
  assert.ok(feishuIdx < faqIdx);
});
```

- [x] **Step 2: Run test to verify it fails**

Run:

```bash
node --test tests/trusteeship-sidepanel-contract.test.js
```

Expected: 新增测试因 `feishuIdx > settingsIdx` 失败。

- [x] **Step 3: Write minimal implementation**

把 `src/sidepanel.html` 中从“飞书通知（Phase 1）”标题到“发送飞书测试通知”按钮的完整区块，移动到 AI 托管说明段落之后。保留原有标记、ID、文字和事件绑定。

在 `docs/user-manual.md` 明确“配置 → AI 托管”打开后先配置并测试飞书；在 `docs/oss-notes.md` 记录配置前置的开源参考与边界。

- [x] **Step 4: Run focused tests**

Run:

```bash
node --test tests/trusteeship-sidepanel-contract.test.js tests/sidepanel-runtime.test.js
```

Expected: 全部通过。

- [x] **Step 5: Run full verification**

Run:

```bash
npm test
```

Expected: 全部测试通过。

Run:

```bash
find src tests scripts -type f \( -name '*.js' -o -name '*.mjs' \) -print0 | xargs -0 -n1 node --check
```

Expected: 全部退出 0。
