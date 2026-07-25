# Reviewed Defects Remediation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 修复审查发现的全部外部副作用、MV3 生命周期、运行取消、跨平台状态、权限和文档缺陷，并建立零依赖回归测试。

**Architecture:** 将“单次发送”“运行安全”“持久 run”“自定义 API 权限”抽成可在 Service Worker、content script 和 Node 测试中共用的 UMD 小模块。Service Worker 在一次运行开始时固定平台与配置，持久化运行检查点，并通过 offscreen 文档在有界用户任务期间维持活跃；意外重启只进入阻塞态，不自动重放不确定的外部动作。

**Tech Stack:** Chrome Extension Manifest V3、原生 JavaScript、Node.js `node:test`、Chrome `storage` / `offscreen` / `permissions` API。

## Global Constraints

- 半自动红线不变：默认不选，只联系人工勾选岗位。
- 外部动作结果未知时 fail closed，不自动重试。
- 不引入第三方运行时或测试依赖。
- API Key 与简历继续只存浏览器本地。
- 当前仓库没有 `HEAD`，本计划不创建提交或 worktree。
- 每次代码修改后同步 README 和开发设计文档。

---

### Task 1: 建立零依赖回归测试骨架

**Files:**
- Create: `package.json`
- Create: `tests/message-send.test.js`
- Create: `tests/run-safety.test.js`
- Create: `tests/run-store.test.js`
- Create: `tests/api-permissions.test.js`
- Create: `tests/manifest.test.js`

**Interfaces:**
- Consumes: Node.js 18+ 内置 `node:test`。
- Produces: `npm test`，以及后续生产模块的期望 API。

- [x] **Step 1: 编写失败测试**

测试必须覆盖：回车成功后不再点按钮；回车失败才点一次按钮；发送超时返回失败；目标会话不匹配时拒绝；取消检查抛出静态错误；平台快照不可被 UI 切换污染；运行记录可开始、检查点、终止和恢复为阻塞；自定义 URL 只接受 HTTPS 或本机 HTTP；manifest 声明 offscreen 与可选主机权限。

- [x] **Step 2: 运行测试确认 RED**

Run: `npm test`

Expected: FAIL，原因是 `src/message-send.js`、`src/run-safety.js`、`src/run-store.js`、`src/api-permissions.js` 尚不存在，且 manifest 尚未声明新增能力。

---

### Task 2: 单次发送与目标会话闸门

**Files:**
- Create: `src/message-send.js`
- Modify: `src/platform/boss/content-chat.js`
- Modify: `src/platform/zhilian/content-chat.js`
- Modify: `src/platform/boss/content-search.js`
- Modify: `src/platform/boss/selectors.js`
- Modify: `src/background.js`
- Modify: `manifest.json`
- Test: `tests/message-send.test.js`

**Interfaces:**
- Produces: `MessageSend.sendExactlyOnce(options)`、`MessageSend.matchesExpectedConversation(text, expected)`。
- `SEND_ACTIVE` 消息新增 `expected: { id, name, company, hrName }`。

- [x] **Step 1: 运行单测确认 RED**

Run: `node --test tests/message-send.test.js`

- [x] **Step 2: 实现最小 UMD 发送闸门**

`sendExactlyOnce` 先触发回车并等待输入框清空或己方消息数增加；只有无证据时才点击一次发送按钮并再次验证。两条路径都无证据时返回失败。

- [x] **Step 3: 接入 Boss 与智联**

移除 Boss 的 `items[0]` 会话回退；发送前校验当前会话与期望岗位/公司/HR；智联超时不再返回成功；两个平台共用单次发送闸门。

- [x] **Step 4: 验证 GREEN**

Run: `node --test tests/message-send.test.js`

Expected: PASS。

---

### Task 3: 固定平台快照、可取消等待与正确计数

**Files:**
- Create: `src/run-safety.js`
- Modify: `src/platform/config.js`
- Modify: `src/background.js`
- Modify: `src/sidepanel.js`
- Test: `tests/run-safety.test.js`

**Interfaces:**
- Produces: `RunSafety.snapshotRunConfig(cfg)`、`RunSafety.checkpoint(state)`、`RunSafety.validateJobPlatform(job, platformId)`、`RunSafety.canSwitchPlatform(running, current, target)`。
- `PlatformConfig.loadFlatFor(platformId)` 读取固定平台配置。
- `bumpDailyUsage(platformId)` 必须显式接收运行平台。

- [x] **Step 1: 运行单测确认 RED**

Run: `node --test tests/run-safety.test.js`

- [x] **Step 2: 实现运行安全模块并接入**

一次运行开始后固定 `platformId`、配置和 processed；运行期间禁用平台卡片；每个 await 后、每个 `GO_CHAT`/`SEND_ACTIVE` 前检查取消；拟人等待改为可取消轮询。

- [x] **Step 3: 将建联与招呼语分开记账**

`GO_CHAT` 成功或结果不确定但已导航时立即将岗位标记为已联系并增加日限；随后招呼语失败只记录“已建联、招呼语失败”，不得再次进入重试集合。

- [x] **Step 4: 验证 GREEN**

Run: `node --test tests/run-safety.test.js`

Expected: PASS。

---

### Task 4: MV3 持久运行与意外中断阻塞

**Files:**
- Create: `src/run-store.js`
- Create: `src/offscreen.html`
- Create: `src/offscreen.js`
- Modify: `src/background.js`
- Modify: `src/sidepanel.js`
- Modify: `manifest.json`
- Test: `tests/run-store.test.js`
- Test: `tests/manifest.test.js`

**Interfaces:**
- Produces: `RunStore.create(storage, clock)`，提供 `start`、`patch`、`finish`、`recoverInterrupted`。
- 持久键：`sw_active_run`。

- [x] **Step 1: 运行单测确认 RED**

Run: `node --test tests/run-store.test.js tests/manifest.test.js`

- [x] **Step 2: 实现持久 run**

扫描和联系开始时写入 run；阶段、游标、结果、停止、阻塞和完成都更新检查点。Service Worker 启动发现遗留 running run 时，将其原子转为 blocked，提示人工核对，不自动恢复外部动作。

- [x] **Step 3: 实现有界 keepalive**

运行开始创建 offscreen 文档，每 20 秒发送 `KEEPALIVE`；任务终止后关闭。持久 run 仍是意外终止后的事实来源。

- [x] **Step 4: 验证 GREEN**

Run: `node --test tests/run-store.test.js tests/manifest.test.js`

Expected: PASS。

---

### Task 5: 自定义 API 主机权限

**Files:**
- Create: `src/api-permissions.js`
- Modify: `src/sidepanel.html`
- Modify: `src/sidepanel.js`
- Modify: `manifest.json`
- Test: `tests/api-permissions.test.js`
- Test: `tests/manifest.test.js`

**Interfaces:**
- Produces: `ApiPermissions.permissionPatternForBaseUrl(url)`、`ApiPermissions.ensure(chrome, url)`。

- [x] **Step 1: 运行单测确认 RED**

Run: `node --test tests/api-permissions.test.js tests/manifest.test.js`

- [x] **Step 2: 实现权限请求**

HTTPS 自定义域名按精确 origin 请求可选权限；HTTP 只允许 `localhost`、`127.0.0.1` 与 `::1`。保存、测试和扫描前若缺权限则停止并显示明确错误。

- [x] **Step 3: 验证 GREEN**

Run: `node --test tests/api-permissions.test.js tests/manifest.test.js`

Expected: PASS。

---

### Task 6: 文档一致性与完整验证

**Files:**
- Modify: `README.md`
- Modify: `docs/07-multi-platform-design.md`
- Modify: `docs/oss-notes.md`

**Interfaces:**
- Produces: 与 v0.3.4 实际能力一致的状态、测试、权限、恢复和安全语义说明。

- [x] **Step 1: 更新文档**

README 明确 Boss 与智联可用、猎聘开发中；开发文档增加单次发送、固定平台 run、建联记账、意外中断阻塞、自定义域名授权和测试命令；开源笔记记录本轮对照结论。

- [x] **Step 2: 运行完整验证**

Run: `npm test`

Expected: 所有测试通过。

Run: `for f in $(rg --files -g '*.js'); do node --check "$f"; done`

Expected: exit 0。

Run: `python3 -m json.tool manifest.json >/dev/null`

Expected: exit 0。

- [x] **Step 3: 检查工作区**

Run: `git status --short`

Expected: 仅包含本任务文件及用户原有未跟踪基线；不删除或覆盖无关文件。
