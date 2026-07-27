# 岗位筛选 UI 命名实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 将用户可见的“审核”流程阶段统一改名为“岗位筛选”，且不改变内部状态与业务行为。

**Architecture:** 保留内部 `review` 标识，只替换 HTML、运行时提示和恢复建议中的用户可见文案。使用现有 UI 契约测试保护导航、提示和按钮的一致性，并同步更新当前开发文档。

**Tech Stack:** Chrome MV3、原生 JavaScript、Node.js `node:test`。

## Global Constraints

- 不修改 `review` 内部状态键、DOM ID 或消息协议。
- 不修改 AI 托管、岗位联系或会话轮询行为。
- 先验证文案契约测试 RED，再实施最小改动。
- 更新 README 与相关当前开发文档。

---

### Task 1: 统一岗位筛选文案

**Files:**
- Modify: `tests/trusteeship-sidepanel-contract.test.js`
- Modify: `src/sidepanel.html`
- Modify: `src/sidepanel.js`
- Modify: `src/delivery-guard.js`
- Modify: `README.md`
- Modify: `docs/08-boss-ai-trusteeship.md`
- Modify: `docs/oss-notes.md`

**Interfaces:**
- Consumes: 现有 `review` 页面和投递恢复提示。
- Produces: 用户可见名称“岗位筛选”，内部接口不变。

- [ ] **Step 1: 写入失败的 UI 文案契约测试**

新增测试，要求主导航、扫描提示、返回按钮和恢复建议使用“岗位筛选”，并拒绝旧的“返回审核”“待审核”文案。

- [ ] **Step 2: 运行定向测试验证 RED**

Run: `node --test tests/trusteeship-sidepanel-contract.test.js`

Expected: FAIL，因为现有 UI 仍显示“审核”。

- [ ] **Step 3: 实施最小文案修改**

修改用户可见文案；保留 `data-tab="review"`、`page-review` 及内部状态名称。

- [ ] **Step 4: 更新开发文档**

同步 README、AI 托管开发文档和开源调研记录中的当前产品名称。

- [ ] **Step 5: 运行定向和完整测试**

Run:

```bash
node --test tests/trusteeship-sidepanel-contract.test.js tests/sidepanel-runtime.test.js tests/delivery-guard.test.js
npm test
```

Expected: 全部 PASS。

