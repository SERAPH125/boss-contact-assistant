# User Manual Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Create a complete Chinese user operation manual and a standalone new-user quick-start guide for the current browser extension.

**Architecture:** `docs/user-manual.md` is the complete source of truth for end-user operation, while `docs/quick-start.md` is a shorter, independently readable first-run path extracted from it. `README.md` links to both documents without duplicating their full content.

**Tech Stack:** Markdown, current extension UI contracts in `src/sidepanel.html`, product behavior documented in `README.md` and `docs/08-boss-ai-trusteeship.md`, Node.js built-in test runner.

## Global Constraints

- Write for ordinary job seekers with no development background.
- Use the current visible UI labels exactly, including “岗位筛选”“联系已选”“保存托管设置”.
- Explain where an action happens, what to click, and what proves success.
- Never expose or request real API keys, Webhooks, signing secrets, cookies, or chat content.
- Clearly identify actions that may send real messages.
- Do not claim monitoring works after the browser is closed.
- Do not claim unverified platform behavior as production-proven.
- Do not add screenshots in the first version.
- Do not modify extension runtime behavior.

---

### Task 1: Complete User Operation Manual

**Files:**
- Create: `docs/user-manual.md`
- Reference: `src/sidepanel.html`
- Reference: `README.md`
- Reference: `docs/07-multi-platform-design.md`
- Reference: `docs/08-boss-ai-trusteeship.md`

**Interfaces:**
- Consumes: Current user-visible labels, defaults, supported platforms, AI trusteeship rules, Feishu persistence behavior, and recovery semantics.
- Produces: A complete standalone manual that `docs/quick-start.md` and `README.md` can link to.

- [ ] **Step 1: Create the manual outline**

Create these exact top-level sections:

```markdown
# 求职联系助手用户操作手册
## 1. 使用前先了解
## 2. 安装与打开扩展
## 3. 新用户快速上手
## 4. 配置详解
## 5. 扫描与岗位筛选
## 6. 确认并联系岗位
## 7. BOSS AI 对话托管
## 8. 飞书通知
## 9. 待确认消息
## 10. 真实外发演练
## 11. 状态说明
## 12. 常见问题与故障排查
## 13. 数据、隐私与安全
## 14. 更新、重载与卸载
```

- [ ] **Step 2: Write the first-run and ordinary contact workflow**

Document Chrome and Edge unpacked installation, BOSS/智联 login, platform selection, API test/save, job settings, scan, “岗位筛选”, batch confirmation, and “执行”. State that 猎聘 is visible but not enabled for scanning.

- [ ] **Step 3: Write the AI trusteeship workflow**

Document the exact prerequisites and the sequence:

```text
完成 API 测试
→ 填写简历要点或 HR 常用问答
→ 配置并测试飞书
→ 接受风险提示
→ 登记 BOSS 会话
→ 开启全局托管和逐岗位托管
→ 保存托管设置
→ 立即检查或等待 alarm
```

Explain 5/10/15-minute checks, 30–300-second reply delay, quiet hours, daily quota, explicit rejection auto-close, pending confirmation topics, and one-click bulk behavior.

- [ ] **Step 4: Write Feishu, approvals, status, and troubleshooting**

Explicitly explain:

- Feishu values require “保存托管设置”.
- Saved credentials are masked on reopen and shown as “已保存；重新输入可替换”.
- Chrome and Edge profiles do not share local settings.
- “等待 HR”“等待确认”“正在核验发送 · 持续监控”“已暂停”“已结束－未匹配” each have a user action.
- Troubleshooting starts from global running state, persisted registration count, current login, latest check result, and only then AI.

- [ ] **Step 5: Validate the complete manual**

Run:

```bash
rg -n "审核|TBD|TODO|规避平台风控|反检测|封号机制" docs/user-manual.md
rg -n "岗位筛选|联系已选|保存托管设置|立即检查已登记岗位|一键托管全部可用岗位" docs/user-manual.md
```

Expected:

- The first command has no output except a legitimate explanation that automatic actions may trigger account restrictions; prohibited bypass wording is absent.
- The second command finds every current UI label.

- [ ] **Step 6: Commit the complete manual**

```bash
git add docs/user-manual.md
git commit -m "docs: add complete user operation manual"
```

### Task 2: Standalone New-User Quick Start

**Files:**
- Create: `docs/quick-start.md`
- Reference: `docs/user-manual.md`

**Interfaces:**
- Consumes: The complete manual’s installation and first-run workflow.
- Produces: An independently readable guide that reaches one safe scan-and-contact cycle without requiring the full manual.

- [ ] **Step 1: Create the quick-start structure**

Use these exact sections:

```markdown
# 求职联系助手：新用户快速上手
## 开始前准备
## 第 1 步：安装并打开扩展
## 第 2 步：选择招聘平台
## 第 3 步：配置并测试 AI
## 第 4 步：填写求职设置
## 第 5 步：扫描和筛选岗位
## 第 6 步：确认并联系
## 第 7 步：查看执行结果
## 可选：开启 BOSS AI 托管
## 遇到问题先检查
## 下一步
```

- [ ] **Step 2: Extract the minimum safe workflow**

Keep the guide concise but include success evidence for each step. Link to the complete manual for detailed AI trusteeship, Feishu, approvals, statuses, privacy, and troubleshooting.

- [ ] **Step 3: Validate standalone readability**

Run:

```bash
rg -n "chrome://extensions|edge://extensions|测试连接|保存 API 配置|保存并扫描|岗位筛选|联系已选|执行" docs/quick-start.md
```

Expected: Every first-run milestone is present.

- [ ] **Step 4: Commit the quick-start guide**

```bash
git add docs/quick-start.md
git commit -m "docs: add new-user quick start"
```

### Task 3: Documentation Entry Points and Final Verification

**Files:**
- Modify: `README.md`
- Verify: `docs/user-manual.md`
- Verify: `docs/quick-start.md`

**Interfaces:**
- Consumes: Both completed user documents.
- Produces: Discoverable README links and a final evidence-backed documentation handoff.

- [ ] **Step 1: Add README navigation**

Add this block after the opening description and supported-platform list:

```markdown
## 使用文档

- [新用户快速上手](docs/quick-start.md)：第一次安装和跑通扫描、筛选、联系流程。
- [用户操作手册](docs/user-manual.md)：完整配置、AI 托管、飞书通知、待确认和故障排查。
```

- [ ] **Step 2: Check Markdown links and deprecated labels**

Run:

```bash
test -f docs/user-manual.md
test -f docs/quick-start.md
rg -n "docs/quick-start.md|docs/user-manual.md" README.md
rg -n "审核" README.md docs/user-manual.md docs/quick-start.md
```

Expected: Both files exist, both README links exist, and deprecated “审核” is absent.

- [ ] **Step 3: Run contract and formatting verification**

Run:

```bash
node --test tests/trusteeship-sidepanel-contract.test.js tests/sidepanel-contract.test.js
python3 -m json.tool manifest.json >/dev/null
git diff --check
git status --short
```

Expected: Tests pass, the manifest is valid JSON, formatting checks pass, and only intended documentation files are changed.

- [ ] **Step 4: Commit the README entry**

```bash
git add README.md
git commit -m "docs: link user guides from readme"
```
