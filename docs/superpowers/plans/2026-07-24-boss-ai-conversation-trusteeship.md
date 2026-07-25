# Boss AI 对话托管 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 为插件成功发起、且用户逐个明确开启托管的 Boss 岗位会话提供低频本地监控、低风险 AI 自动回复、重要问题插件内确认和飞书机器人通知。

**Architecture:** 使用 Manifest V3 `chrome.alarms` 唤醒后台，由独立的存储、状态机、回复策略、AI 输出校验、飞书通知和 Boss 页面适配模块协作。后台只轮询已登记的可靠会话 URL/标识，所有页面读取与发送都在目标身份二次校验后进行；策略先以确定性硬规则拦截高风险内容，再允许置信度达标的 AI 草稿进入安全发送器。待确认任务是本地唯一事实来源，飞书仅发送摘要通知。

**Tech Stack:** Chrome Extension Manifest V3、原生 JavaScript UMD/CommonJS、`chrome.storage.local`、`chrome.alarms`、Web Crypto API、飞书自定义机器人 Webhook、Node.js 内置测试运行器、HTML/CSS。

## Global Constraints

- 全局 `AI 对话托管` 和每个会话的 `托管此岗位` 均默认关闭。
- 只允许登记插件已成功联系、且能取得可靠 Boss 会话标识的岗位；禁止扫描全部聊天正文寻找目标。
- 每 5/10/15 分钟检查一次，默认 10 分钟；每轮最多 10 个会话并使用持久轮转游标。
- 低风险白名单之外全部进入人工确认；薪资、面试、到岗、离职原因、联系方式、附件/语音、承诺和混合问题必须人工确认。
- 自动回复要求 AI 置信度 `>= 0.85`、有简历事实依据、无未处理待办、未到日限；默认日限 10，硬上限 20。
- 发送前必须复用现有目标会话匹配和 `MessageSend.sendExactlyOnce`；目标或结果不确定时暂停，不自动重试。
- 静默时段内只收集目标消息，不自动发送、不发飞书；结束后合并为一条待办。
- Webhook 与签名密钥只存 `chrome.storage.local`，不得进入日志、AI 请求、错误详情或导出内容。
- 不存储 Boss Cookie、密码、验证码；不实现风控绕过、验证码破解或云端全天托管。
- 不引入运行时依赖或前端框架；所有新增核心模块必须可在浏览器和 Node 测试中运行。
- 自动化测试不访问真实 Boss 或真实飞书；真实账号只读/发送验收必须分阶段，任何真实发送都需用户另行明确授权。
- 当前仓库 `git rev-parse --verify HEAD` 失败，尚无可用提交基线。执行期间不得为了满足“频繁提交”而擅自创建包含全部现有未跟踪文件的初始提交；只有在正确基线恢复或用户明确授权后，才执行各任务末尾列出的提交命令。
- 每次代码修改必须同步更新 `docs/08-boss-ai-trusteeship.md` 的“实现状态与验证记录”，最终同时更新 README、设计规格和开源参考记录。

---

## 已确认的开源与官方参考

- [GeekGeekRun](https://github.com/geekgeekrun/geekgeekrun)：借鉴招聘站点自动化的适配器隔离、限速与人工参与边界，不复制其站点选择器。
- [feishu-webhook-sdk](https://github.com/jz0ojiang/feishu-webhook-sdk)：核对飞书自定义机器人 Webhook、HMAC-SHA256 签名和 Web Crypto 实现方式。
- [Hermes Agent Feishu integration](https://github.com/NousResearch/hermes-agent)：参考通知渠道与核心任务状态分离的集成方式。
- [Chrome Alarms API](https://developer.chrome.com/docs/extensions/reference/api/alarms)：使用持久 alarm 代替 Service Worker 内 `setInterval`。
- [Chrome Extension Service Worker 生命周期](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)：所有关键状态持久化，不能依赖后台内存长期存活。
- [飞书开放平台](https://open.feishu.cn/document/platform-overveiw/overview)：Phase 1 使用自定义机器人通知，不接入卡片回调审批。
- [BOSS直聘用户协议](https://www.zhipin.com/web/common/protocol/protocol-2019-09-30.html)：保留账号限权风险提示，不实现平台控制规避。

---

## File Map

### 新建

- `src/conversation/trusteeship-policy.js`：设置归一化、风险硬规则、置信度/依据/日限决策、静默时段判断。
- `src/conversation/conversation-store.js`：设置、托管会话、待办、发送意图与通知尝试的序列化持久化。
- `src/conversation/reply-ai.js`：分类/草稿 Prompt、JSON 输出解析和严格结构校验。
- `src/conversation/feishu-notifier.js`：Webhook 校验、签名、卡片构造、凭证脱敏和一次补发。
- `src/conversation/monitor-engine.js`：单轮监控、轮转、去重、状态转换、自动回复/待确认编排。
- `src/platform/boss/conversation-reader.js`：纯消息归一化、指纹、增量选择和可靠会话标识提取。
- `tests/trusteeship-policy.test.js`
- `tests/conversation-store.test.js`
- `tests/reply-ai.test.js`
- `tests/feishu-notifier.test.js`
- `tests/conversation-reader.test.js`
- `tests/monitor-engine.test.js`
- `tests/trusteeship-background-contract.test.js`
- `tests/trusteeship-sidepanel-contract.test.js`
- `tests/fixtures/boss-chat/*.json`：脱敏的 DOM 解析中间样本，不保存真实聊天内容。
- `docs/08-boss-ai-trusteeship.md`：用户配置、隐私边界、错误码、测试记录和发布说明。

### 修改

- `manifest.json`：增加 `alarms` 和飞书固定域名权限；加载读取所需脚本。
- `src/platform/boss/selectors.js`：新增保守的聊天标识和入站消息选择器。
- `src/platform/boss/content-chat.js`：返回可靠会话引用、读取目标增量消息、复用安全发送器发送托管回复。
- `src/background.js`：注册成功建联会话、alarm 调度、监控依赖注入和侧边栏消息协议。
- `src/sidepanel.html`：增加托管设置、飞书配置、状态角标和“待确认”页。
- `src/sidepanel.js`：加载/保存设置、测试飞书、会话开关、待办处理和目标页跳转。
- `src/sidepanel.css`：托管状态、待办卡片、表单错误和移动宽度样式。
- `tests/manifest.test.js`：权限和脚本顺序契约。
- `tests/background-contract.test.js`：确保原有一次批量确认与新调度协议并存。
- `tests/content-guard-contract.test.js`：确保读取与发送都失败关闭。
- `tests/sidepanel-contract.test.js`：确保原有批次确认与新待办 UI 并存。
- `README.md`
- `docs/07-multi-platform-design.md`
- `docs/oss-notes.md`
- `docs/superpowers/specs/2026-07-24-boss-ai-conversation-trusteeship-design.md`

---

### Task 0: 固定基线与公共契约

**Files:**
- Create: `docs/08-boss-ai-trusteeship.md`
- Modify: `tests/manifest.test.js`
- Modify: `manifest.json`

**Interfaces:**
- 存储前缀：`conversationTrusteeship`、`feishuNotification`、`managedConversations`、`pendingApprovals`
- Alarm 名称：`boss-ai-chat-monitor`
- 后台消息前缀：`TRUSTEESHIP_*`

- [x] **Step 1: 验证当前测试基线**

Run:

```bash
npm test
```

Expected: 现有 47 个测试全部通过，0 failures。

- [x] **Step 2: 先写权限失败测试**

在 `tests/manifest.test.js` 增加：

```js
test('declares bounded permissions for trusteeship scheduling and Feishu', () => {
  assert.ok(manifest.permissions.includes('alarms'));
  assert.ok(manifest.host_permissions.includes('https://open.feishu.cn/*'));
  assert.equal(
    manifest.host_permissions.some((pattern) => pattern === 'https://*/*'),
    false
  );
});
```

- [x] **Step 3: 运行并确认 RED**

Run:

```bash
node --test tests/manifest.test.js
```

Expected: FAIL，提示缺少 `alarms` 和飞书固定域名权限。

- [x] **Step 4: 最小修改 Manifest**

将权限修改为：

```json
"permissions": ["storage", "tabs", "scripting", "sidePanel", "offscreen", "alarms"],
"host_permissions": [
  "*://*.zhipin.com/*",
  "*://*.zhaopin.com/*",
  "*://*.liepin.com/*",
  "https://api.deepseek.com/*",
  "https://api.openai.com/*",
  "https://dashscope.aliyuncs.com/*",
  "https://open.feishu.cn/*"
]
```

不增加常驻的宽泛主机权限。

- [x] **Step 5: 建立活文档**

创建 `docs/08-boss-ai-trusteeship.md`，先记录：

- 已批准范围与非目标；
- 默认关闭、逐会话开启；
- 四个存储键、alarm 名称、消息协议；
- 当前状态：Task 0；
- 自动化验证结果；
- `NO_GIT_BASELINE` 注意项。

- [x] **Step 6: 运行验证**

Run:

```bash
node --test tests/manifest.test.js
npm test
```

Expected: 全部 PASS。

- [x] **Step 7: 条件提交**

仅当 `git rev-parse --verify HEAD` 成功时执行：

```bash
git add manifest.json tests/manifest.test.js docs/08-boss-ai-trusteeship.md
git commit -m "chore: define trusteeship runtime contract"
```

---

### Task 1: 回复政策与确定性风险门

**Files:**
- Create: `tests/trusteeship-policy.test.js`
- Create: `src/conversation/trusteeship-policy.js`
- Modify: `docs/08-boss-ai-trusteeship.md`

**Interfaces:**
- `TrusteeshipPolicy.normalizeSettings(input) -> settings`
- `TrusteeshipPolicy.detectHardRisk(message) -> { blocked, reasonCode, fieldsNeeded }`
- `TrusteeshipPolicy.isQuietHours(now, quietHours) -> boolean`
- `TrusteeshipPolicy.decide(input) -> { action, reasonCode }`
- `action`: `AUTO_REPLY | REQUIRE_CONFIRMATION | IGNORE`

- [x] **Step 1: 写失败测试**

至少覆盖：

```js
const test = require('node:test');
const assert = require('node:assert/strict');
const Policy = require('../src/conversation/trusteeship-policy.js');

test('defaults every automation switch to off', () => {
  const cfg = Policy.normalizeSettings({});
  assert.equal(cfg.enabled, false);
  assert.equal(cfg.intervalMinutes, 10);
  assert.equal(cfg.dailyAutoReplyLimit, 10);
});

test('hard-blocks salary, interview, arrival, contact and mixed questions', () => {
  for (const text of [
    '你的期望薪资是多少？',
    '明天下午两点可以来面试吗？',
    '最快什么时候到岗？',
    '加一下微信吧',
    '还在看机会吗，薪资期望多少？'
  ]) {
    assert.equal(Policy.detectHardRisk({ text, kind: 'text' }).blocked, true);
  }
});

test('requires confirmation below confidence or without resume evidence', () => {
  assert.deepEqual(Policy.decide({
    hardRisk: { blocked: false },
    ai: { category: 'resume_fact', confidence: 0.84, evidenceIds: ['r1'] },
    settings: { dailyAutoReplyLimit: 10 },
    dailyCount: 0,
    hasPendingApproval: false,
    quiet: false
  }).action, 'REQUIRE_CONFIRMATION');
});

test('quiet hours never auto-reply', () => {
  assert.equal(Policy.decide({
    hardRisk: { blocked: false },
    ai: { category: 'courtesy', confidence: 0.99, evidenceIds: [] },
    settings: { dailyAutoReplyLimit: 10 },
    dailyCount: 0,
    hasPendingApproval: false,
    quiet: true
  }).action, 'REQUIRE_CONFIRMATION');
});
```

还需测试：附件/语音、未知类型、AI 失败、已有待办、日限、跨午夜静默时段、允许的五类低风险消息、日限硬裁剪到 20。

- [x] **Step 2: 运行并确认 RED**

Run:

```bash
node --test tests/trusteeship-policy.test.js
```

Expected: FAIL，因为模块尚不存在。

- [x] **Step 3: 实现最小纯策略模块**

使用 UMD/CommonJS：

```js
(function (g, factory) {
  var api = factory();
  g.TrusteeshipPolicy = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : self, function () {
  var AUTO_CATEGORIES = new Set([
    'still_looking', 'resume_permission', 'courtesy',
    'please_wait', 'resume_fact'
  ]);

  function decide(input) {
    if (input.hardRisk.blocked) {
      return { action: 'REQUIRE_CONFIRMATION', reasonCode: input.hardRisk.reasonCode };
    }
    if (input.quiet) {
      return { action: 'REQUIRE_CONFIRMATION', reasonCode: 'QUIET_HOURS' };
    }
    // 再检查待办、日限、类别、置信度和 evidenceIds。
  }

  return { normalizeSettings, detectHardRisk, isQuietHours, decide };
});
```

硬规则先于 AI，且不得由 AI 结果覆盖。

- [x] **Step 4: 更新文档**

在 `docs/08-boss-ai-trusteeship.md` 记录硬拦类别、自动白名单、阈值和对应稳定错误码。

- [x] **Step 5: 验证**

Run:

```bash
node --test tests/trusteeship-policy.test.js
npm test
```

Expected: 全部 PASS。

- [x] **Step 6: 条件提交**

```bash
git add src/conversation/trusteeship-policy.js tests/trusteeship-policy.test.js docs/08-boss-ai-trusteeship.md
git commit -m "feat: add fail-closed reply policy"
```

---

### Task 2: 持久化状态机、去重和发送意图

**Files:**
- Create: `tests/conversation-store.test.js`
- Create: `src/conversation/conversation-store.js`
- Modify: `docs/08-boss-ai-trusteeship.md`

**Interfaces:**
- `ConversationStore.create(storage, clock, idFactory)`
- `store.getSnapshot()`
- `store.saveSettings(patch)`
- `store.registerConversation(ref)`
- `store.setManaged(conversationId, enabled)`
- `store.beginMessage(conversationId, fingerprint)`
- `store.createOrMergeApproval(input)`
- `store.createSendIntent(approvalId, draft)`
- `store.completeSend(intentId, evidence)`
- `store.markSendUnknown(intentId, reason)`
- `store.recordNotificationAttempt(approvalId, result)`
- `store.resetConversation(conversationId)`

**State values:**
- `DISABLED`
- `WAITING_HR`
- `CLASSIFYING`
- `DRAFTING_AUTO`
- `SENDING`
- `WAITING_CONFIRMATION`
- `PAUSED`

- [x] **Step 1: 写状态与并发失败测试**

覆盖：

```js
test('registers a contact disabled and refuses an unreliable reference', async () => {
  const store = createStore();
  await assert.rejects(
    () => store.registerConversation({ platform: 'boss', conversationId: '', url: '' }),
    (error) => error.code === 'UNRELIABLE_CONVERSATION_REF'
  );
  const saved = await store.registerConversation({
    platform: 'boss',
    conversationId: 'conv-1',
    url: 'https://www.zhipin.com/web/geek/chat?conversation=conv-1',
    jobId: 'job-1',
    company: '甲公司',
    position: '前端',
    hrName: '李经理'
  });
  assert.equal(saved.enabled, false);
  assert.equal(saved.state, 'DISABLED');
});

test('allows only one in-flight message per conversation', async () => {
  const [a, b] = await Promise.allSettled([
    store.beginMessage('conv-1', 'fp-1'),
    store.beginMessage('conv-1', 'fp-1')
  ]);
  assert.equal([a, b].filter((x) => x.status === 'fulfilled').length, 1);
});

test('merges later messages into one pending approval', async () => {
  const first = await store.createOrMergeApproval({
    conversationId: 'conv-1', incomingFingerprint: 'fp-1', messages: ['A']
  });
  const second = await store.createOrMergeApproval({
    conversationId: 'conv-1', incomingFingerprint: 'fp-2', messages: ['B']
  });
  assert.equal(first.approvalId, second.approvalId);
  assert.deepEqual(second.messages, ['A', 'B']);
});
```

还需覆盖：

- 非法状态转换拒绝；
- 禁用时删除最近 20 条上下文；
- 指纹只处理一次；
- 每日计数跨日重置；
- 发送意图只能消费一次；
- `SENDING` 状态在 Service Worker 恢复后转 `PAUSED/SEND_RESULT_UNKNOWN`；
- 飞书首次 + 最多一次补发；
- 不把凭证写入会话或待办。

- [x] **Step 2: 运行 RED**

```bash
node --test tests/conversation-store.test.js
```

Expected: FAIL，因为模块尚不存在。

- [x] **Step 3: 实现串行存储队列**

关键结构：

```js
function create(storage, clock, idFactory) {
  var queue = Promise.resolve();
  function serialized(work) {
    var next = queue.then(work, work);
    queue = next.catch(function () {});
    return next;
  }
  return {
    saveSettings: function (patch) {
      return serialized(function () { /* read-normalize-write */ });
    },
    beginMessage: function (conversationId, fingerprint) {
      return serialized(function () { /* dedupe + state transition */ });
    }
  };
}
```

持久对象必须只保存有界上下文：每个会话最多 20 条目标消息；待办只有一个活动实例。

- [x] **Step 4: 更新文档**

在 `docs/08-boss-ai-trusteeship.md` 加入存储模型、状态图、保留/删除规则和 Service Worker 恢复语义。

- [x] **Step 5: 验证**

```bash
node --test tests/conversation-store.test.js
npm test
```

Expected: 全部 PASS。

- [x] **Step 6: 条件提交**

```bash
git add src/conversation/conversation-store.js tests/conversation-store.test.js docs/08-boss-ai-trusteeship.md
git commit -m "feat: persist trusteeship conversation state"
```

---

### Task 3: AI 分类与草稿的严格契约

**Files:**
- Create: `tests/reply-ai.test.js`
- Create: `src/conversation/reply-ai.js`
- Modify: `docs/08-boss-ai-trusteeship.md`

**Interfaces:**
- `ReplyAI.buildClassificationMessages(input) -> ChatMessage[]`
- `ReplyAI.parseClassification(text) -> Classification`
- `ReplyAI.buildDraftMessages(input) -> ChatMessage[]`
- `ReplyAI.parseDraft(text) -> { draft, evidenceIds }`

**Classification:**

```js
{
  category: 'still_looking' | 'resume_permission' | 'courtesy' |
    'please_wait' | 'resume_fact' | 'important' | 'unknown',
  confidence: 0,
  reasonCode: 'CLASSIFIED_AS_LOW_RISK',
  evidenceIds: ['resume-line-1'],
  fieldsNeeded: []
}
```

- [x] **Step 1: 写解析失败测试**

测试：

- Markdown code fence 内 JSON 可解析；
- 非 JSON、缺字段、未知 category、`confidence > 1` 全部失败关闭；
- `resume_fact` 无 `evidenceIds` 时报 `AI_EVIDENCE_MISSING`；
- Draft 为空、过长（建议上限 300 个字符）、捏造未引用事实时失败；
- Prompt 明确禁止薪资/面试/到岗等自动回复；
- Prompt 只包含目标会话有界上下文，不包含飞书凭证。

- [x] **Step 2: 运行 RED**

```bash
node --test tests/reply-ai.test.js
```

Expected: FAIL，因为模块尚不存在。

- [x] **Step 3: 实现 Prompt 与严格解析器**

解析器只接受明确 JSON 对象，并对所有枚举、长度、范围做二次验证。AI 失败一律返回后台可转人工确认的稳定代码，不直接决定发送。

- [x] **Step 4: 更新文档**

记录 AI 输入边界、输出 Schema、失败降级和“策略硬规则优先于 AI”。

- [x] **Step 5: 验证与条件提交**

```bash
node --test tests/reply-ai.test.js
npm test
git add src/conversation/reply-ai.js tests/reply-ai.test.js docs/08-boss-ai-trusteeship.md
git commit -m "feat: validate AI reply decisions"
```

Expected: 测试全绿；提交仅在 Git 基线存在时执行。

---

### Task 4: 飞书通知、签名与凭证脱敏

**Files:**
- Create: `tests/feishu-notifier.test.js`
- Create: `src/conversation/feishu-notifier.js`
- Modify: `docs/08-boss-ai-trusteeship.md`
- Modify: `docs/oss-notes.md`

**Interfaces:**
- `FeishuNotifier.validateConfig(config)`
- `FeishuNotifier.sign(timestampSeconds, secret, subtle)`
- `FeishuNotifier.buildApprovalCard(input)`
- `FeishuNotifier.create({ fetchFn, subtle, clock }).send(config, card)`
- `FeishuNotifier.redactError(value, config)`

- [x] **Step 1: 写失败测试**

覆盖：

```js
test('accepts only the official custom-bot webhook path', () => {
  assert.doesNotThrow(() => Feishu.validateConfig({
    webhook: 'https://open.feishu.cn/open-apis/bot/v2/hook/example',
    signingSecret: 'secret'
  }));
  assert.throws(() => Feishu.validateConfig({
    webhook: 'https://evil.example/hook',
    signingSecret: 'secret'
  }), /FEISHU_WEBHOOK_INVALID/);
});

test('signs timestamp with HMAC-SHA256 and empty message', async () => {
  const actual = await Feishu.sign(1700000000, 'secret', crypto.webcrypto.subtle);
  // 期望值在测试中用 Node crypto 对 `${timestamp}\n${secret}` 空消息计算。
  assert.equal(actual, expected);
});
```

还需覆盖：

- 无签名密钥时不附加 `timestamp/sign`；
- 卡片只含公司、岗位、HR、阶段、摘要、原因、草稿和 Boss URL；
- 不含完整 20 条上下文、Webhook、secret、API key；
- HTTP 非 2xx、飞书 `code != 0` 均失败；
- 超时/网络错误脱敏；
- `redactError` 替换 webhook token 和 secret；
- 测试通知不会改变托管开关。

- [x] **Step 2: 运行 RED**

```bash
node --test tests/feishu-notifier.test.js
```

Expected: FAIL，因为模块尚不存在。

- [x] **Step 3: 实现 Web Crypto 签名**

核心实现：

```js
async function sign(timestamp, secret, subtle) {
  var encoder = new TextEncoder();
  var key = await subtle.importKey(
    'raw',
    encoder.encode(String(timestamp) + '\n' + secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  var bytes = await subtle.sign('HMAC', key, new Uint8Array());
  return bytesToBase64(new Uint8Array(bytes));
}
```

`fetchFn` 必须可注入；自动测试禁止请求真实飞书。

- [x] **Step 4: 更新文档**

在 `docs/08-boss-ai-trusteeship.md` 写明私人群建议、本地存储非系统钥匙串、通知失败不影响本地待办；在 `docs/oss-notes.md` 记录签名参考来源与未复制代码声明。

- [x] **Step 5: 验证与条件提交**

```bash
node --test tests/feishu-notifier.test.js
npm test
git add src/conversation/feishu-notifier.js tests/feishu-notifier.test.js docs/08-boss-ai-trusteeship.md docs/oss-notes.md
git commit -m "feat: add signed Feishu notifications"
```

Expected: 测试全绿；提交仅在 Git 基线存在时执行。

---

### Task 5: Boss 可靠会话标识与增量消息读取

**Files:**
- Create: `tests/conversation-reader.test.js`
- Create: `tests/fixtures/boss-chat/incoming-sequence.json`
- Create: `tests/fixtures/boss-chat/mixed-content.json`
- Create: `src/platform/boss/conversation-reader.js`
- Modify: `src/platform/boss/selectors.js`
- Modify: `src/platform/boss/content-chat.js`
- Modify: `tests/content-guard-contract.test.js`
- Modify: `manifest.json`
- Modify: `docs/08-boss-ai-trusteeship.md`

**Interfaces:**
- `BossConversationReader.extractConversationRef(input) -> ref | null`
- `BossConversationReader.normalizeMessages(rawItems) -> Message[]`
- `BossConversationReader.fingerprint(message) -> string`
- `BossConversationReader.selectNewIncoming(messages, lastFingerprint) -> Message[]`
- Content message: `GET_ACTIVE_CONVERSATION_REF`
- Content message: `READ_ACTIVE_CONVERSATION`
- Content message: `SEND_MANAGED_REPLY`

- [x] **Step 1: 写纯读取器失败测试**

Fixtures 使用脱敏中间数据：

```json
[
  {"id":"m1","direction":"outgoing","kind":"text","text":"您好","at":1700000000000},
  {"id":"m2","direction":"incoming","kind":"text","text":"还在看机会吗","at":1700000060000}
]
```

测试：

- 只有存在稳定 `conversationId` 和 Boss chat URL 才返回 ref；
- 不以公司/HR 文本拼接作为 conversationId；
- 只选择 last fingerprint 后的 incoming 消息；
- 连续 HR 消息保持顺序；
- incoming/outgoing 同文案不冲突；
- 附件、图片、语音保留 `kind` 但不提取隐私 URL；
- 缺消息 ID 时使用 `direction + kind + text + stableTime` 生成确定指纹；
- 撤回和时间分隔不当作普通文本；
- 最多返回 20 条。

- [x] **Step 2: 运行 RED**

```bash
node --test tests/conversation-reader.test.js
```

Expected: FAIL，因为模块尚不存在。

- [x] **Step 3: 实现纯读取器**

使用 UMD/CommonJS，不读取 DOM。`extractConversationRef` 只接受 URL 参数、活动会话链接或明确 `data-*` 标识中的稳定 ID；多个候选冲突时返回 `null`。

- [x] **Step 4: 写 content-script 契约失败测试**

在 `tests/content-guard-contract.test.js` 断言：

```js
assert.match(boss, /msg\.type === 'GET_ACTIVE_CONVERSATION_REF'/);
assert.match(boss, /msg\.type === 'READ_ACTIVE_CONVERSATION'/);
assert.match(boss, /msg\.type === 'SEND_MANAGED_REPLY'/);
assert.match(boss, /MessageSend\.matchesExpectedConversation/);
assert.match(boss, /MessageSend\.sendExactlyOnce/);
```

并断言 Manifest 在 `content-chat.js` 前加载 `conversation-reader.js`。

- [x] **Step 5: 扩展保守选择器和 content script**

`selectors.js` 增加明确字段：

```js
chat: {
  // 保留现有字段
  conversationLink: '.user-list-content li.active a[href*="/web/geek/chat"]',
  messageItem: '.chat-message-list .item',
  messageIncoming: '.chat-message-list .item-friend',
  messageOutgoing: '.chat-message-list .item-myself',
  messageText: '.message-content .text, .message-text',
  messageTime: 'time, [data-time]'
}
```

实施时必须用脱敏页面样本核对真实结构；选择器不匹配返回 `SELECTOR_UNAVAILABLE`，不得扩大到全页面任意 `.item` 或任意文本节点。

`content-chat.js`：

- 联系成功后返回 `conversationRef`，不可靠时仍可完成本次联系，但 UI 不显示托管开关；
- `READ_ACTIVE_CONVERSATION` 先用 ref + `activeConversationText` 双重校验；
- 只返回目标会话归一化消息；
- `SEND_MANAGED_REPLY` 复用现有输入、身份匹配与单发证据；
- 结果未知返回 `sendResultUnknown: true`，不重试。

- [x] **Step 6: 更新文档与验证**

```bash
node --test tests/conversation-reader.test.js tests/content-guard-contract.test.js tests/manifest.test.js
npm test
```

Expected: 全部 PASS。文档记录可靠标识来源、选择器失效策略和 fixture 覆盖范围。

- [x] **Step 7: 条件提交**

```bash
git add src/platform/boss/conversation-reader.js src/platform/boss/selectors.js src/platform/boss/content-chat.js manifest.json tests/conversation-reader.test.js tests/content-guard-contract.test.js tests/manifest.test.js tests/fixtures/boss-chat docs/08-boss-ai-trusteeship.md
git commit -m "feat: read managed Boss conversations safely"
```

---

### Task 6: 单轮监控引擎

**Files:**
- Create: `tests/monitor-engine.test.js`
- Create: `src/conversation/monitor-engine.js`
- Modify: `docs/08-boss-ai-trusteeship.md`

**Interfaces:**
- `MonitorEngine.create(deps)`
- `engine.runCycle() -> CycleSummary`
- `engine.resolveApproval(input) -> Result`

**Injected dependencies:**

```js
{
  store,
  reader: { read(conversation), send(conversation, draft, intent) },
  classifier: { classify(input), draft(input) },
  notifier: { notifyApproval(approval), notifyResolved(approval) },
  policy,
  clock
}
```

- [x] **Step 1: 写编排失败测试**

至少覆盖：

- 全局关闭：reader、AI、notifier 调用次数全部为 0；
- 未托管会话：不读取；
- 每轮最多 10 个，下一轮从持久游标继续；
- 无新消息：保持 `WAITING_HR`；
- 同指纹：不重复 AI、不重复通知；
- 低风险 + 0.85：草稿策略复核后只发送一次；
- 0.849、高风险、AI 失败、未知内容：创建待办；
- 有待办时后续消息合并，不自动发送；
- 静默时段创建/合并待办但不通知、不自动发；
- 自动回复日限；
- notify 首次失败后下一轮只补发一次；
- target uncertain / selector unavailable / send unknown 正确暂停；
- 一个会话失败不导致其他已安全定位会话被错误发送；
- `resolveApproval` 支持 `SEND_EDITED`、`NO_REPLY`、`DISABLE_CONVERSATION`；
- 用户确认发送前重新读取和校验目标；
- 已消费 send intent 不能再次发送。

- [x] **Step 2: 运行 RED**

```bash
node --test tests/monitor-engine.test.js
```

Expected: FAIL，因为模块尚不存在。

- [x] **Step 3: 实现显式管线**

`runCycle` 的单会话顺序固定为：

```text
读取持久状态
→ 校验全局/单会话开关
→ 精确读取目标会话
→ 增量指纹去重
→ 硬风险检测
→ AI 分类
→ 策略决策
→ 生成草稿
→ 草稿二次策略复核
→ 创建一次性发送意图或本地待办
→ 发送/通知
→ 持久化证据
```

不得捕获异常后默认继续发送。`CycleSummary` 只返回计数和稳定错误码，不含聊天原文或凭证。

- [x] **Step 4: 更新文档**

记录依赖边界、轮询流程、错误隔离、一次发送意图与恢复语义。

- [x] **Step 5: 验证与条件提交**

```bash
node --test tests/monitor-engine.test.js
npm test
git add src/conversation/monitor-engine.js tests/monitor-engine.test.js docs/08-boss-ai-trusteeship.md
git commit -m "feat: orchestrate managed conversation cycles"
```

Expected: 全部 PASS；提交仅在 Git 基线存在时执行。

---

### Task 7: Service Worker 调度与现有联系流程接入

**Files:**
- Create: `tests/trusteeship-background-contract.test.js`
- Modify: `src/background.js`
- Modify: `tests/background-contract.test.js`
- Modify: `docs/08-boss-ai-trusteeship.md`

**Runtime messages:**

- `TRUSTEESHIP_GET_STATE`
- `TRUSTEESHIP_SAVE_SETTINGS`
- `TRUSTEESHIP_TEST_FEISHU`
- `TRUSTEESHIP_SET_CONVERSATION`
- `TRUSTEESHIP_LIST_APPROVALS`
- `TRUSTEESHIP_RESOLVE_APPROVAL`
- `TRUSTEESHIP_OPEN_CONVERSATION`
- `TRUSTEESHIP_RUN_NOW`（只用于用户手动检查，不绕过策略）

- [x] **Step 1: 写后台契约失败测试**

断言：

- `importScripts` 顺序包含 policy、store、reply-ai、notifier、reader、engine；
- 监听 `chrome.alarms.onAlarm`，只处理 `boss-ai-chat-monitor`；
- 全局关闭会 `chrome.alarms.clear`；
- 5/10/15 之外的间隔在策略层拒绝；
- `onInstalled`、`onStartup` 和 worker 初始化都会 reconcile alarm；
- 原有 `PREPARE_DELIVERY/CONFIRM_DELIVERY` 协议保留；
- 原有 `START_DELIVER` 仍被拒绝；
- 成功 Boss 联系只在存在 `conversationRef` 时登记，且登记为 disabled；
- 日志函数不接收 webhook/secret/chat 原文。

- [x] **Step 2: 运行 RED**

```bash
node --test tests/trusteeship-background-contract.test.js tests/background-contract.test.js
```

Expected: 新契约 FAIL，原有契约 PASS。

- [x] **Step 3: 接入模块与 alarm**

后台增加：

```js
const TRUSTEESHIP_ALARM = 'boss-ai-chat-monitor';

async function reconcileTrusteeshipAlarm() {
  const snapshot = await conversationStore.getSnapshot();
  if (!snapshot.settings.enabled) {
    await chrome.alarms.clear(TRUSTEESHIP_ALARM);
    return;
  }
  await chrome.alarms.create(TRUSTEESHIP_ALARM, {
    delayInMinutes: snapshot.settings.intervalMinutes,
    periodInMinutes: snapshot.settings.intervalMinutes
  });
}
```

注意：实际 Chrome API 的 Promise/Callback 兼容应沿用项目现有封装风格并由假对象测试。

- [x] **Step 4: 实现只读 Boss 页面适配**

后台的 `reader.read`：

- 不查询、复用或导航既有 Boss chat tab；
- 每次只创建本轮独占、`active: false` 的临时 tab；
- 页面被用户接管后，在下一真实读取或写入前以同步 epoch/租约校验拒绝继续；
- 导航到已登记的精确 conversation URL；
- 等待加载并注入/确认 content script；
- 发送 `READ_ACTIVE_CONVERSATION`；
- 关闭仅由本轮创建的临时 tab；
- 登录/验证码/频率限制时全局暂停；
- ref/目标不一致时仅暂停该会话。

- [x] **Step 5: 接入 AI 与安全发送**

- `classifier.classify/draft` 复用现有 `callLLM`，但通过 `ReplyAI` 构建和解析消息；
- `reader.send` 发送 `SEND_MANAGED_REPLY`；
- 每次发送前查询 store 中未消费 intent；
- 成功证据明确后才增加自动回复日限；
- `sendResultUnknown` 立即暂停，不重放。

- [x] **Step 6: 登记现有成功联系**

在 Boss 成功 `SEND_ACTIVE`/可确认的建联结果后：

```js
if (result.success && result.conversationRef) {
  await conversationStore.registerConversation({
    ...result.conversationRef,
    platform: 'boss',
    jobId: job.id,
    company: job.company,
    position: job.name,
    hrName: job.hrName || ''
  });
}
```

若无可靠 ref，只记录“不可托管”，不影响本轮已确认联系结果。

- [x] **Step 7: 实现配置前置条件**

尝试开启全局托管前校验：

- API Key 已配置且最近测试可用；
- `resumeText` 非空；
- 飞书 enabled、Webhook 有效、最近测试成功；
- 风险已确认。

返回结构：

```js
{
  ok: false,
  code: 'TRUSTEESHIP_PREREQUISITE_FAILED',
  missing: ['api', 'resumeText', 'feishuTest', 'riskAccepted']
}
```

- [x] **Step 8: 更新文档与验证**

```bash
node --test tests/trusteeship-background-contract.test.js tests/background-contract.test.js
npm test
```

Expected: 所有原有 P0 批量确认测试与新增调度测试均 PASS。文档更新消息协议、alarm 恢复、tab 使用和错误码。

- [x] **Step 9: 条件提交**

```bash
git add src/background.js tests/trusteeship-background-contract.test.js tests/background-contract.test.js docs/08-boss-ai-trusteeship.md
git commit -m "feat: schedule Boss conversation trusteeship"
```

---

### Task 8: 侧边栏设置、会话开关与待确认工作台

**Files:**
- Create: `tests/trusteeship-sidepanel-contract.test.js`
- Modify: `src/sidepanel.html`
- Modify: `src/sidepanel.js`
- Modify: `src/sidepanel.css`
- Modify: `tests/sidepanel-contract.test.js`
- Modify: `docs/08-boss-ai-trusteeship.md`

**UI:**
- 配置子页：`AI 托管`
- 顶栏状态：`托管已关闭 / 正在托管 N 个岗位 / 等待确认 N 条 / 托管已暂停`
- 第四主标签：`待确认`
- 成功联系结果：`托管此岗位` 开关；无可靠 ref 时展示原因且不显示可用开关

- [x] **Step 1: 写 UI 契约失败测试**

断言 HTML 包含：

- 全局开关、5/10/15 分钟、1–20 日限、静默时段；
- 飞书 Webhook password input、签名密钥 password input、测试按钮；
- 本地存储非钥匙链警示；
- 风险提示；
- “待确认”主标签和角标；
- 待办的上下文、原因、需补字段、可编辑草稿；
- `修改并确认发送`、`不回复`、`关闭此会话托管`；
- 所有输入都有 label，状态区域有 `aria-live`；
- 原有 delivery modal 仍存在。

断言 JS：

- 使用全部 `TRUSTEESHIP_*` 消息；
- 聊天/凭证渲染不使用拼接 `innerHTML`；
- 发送按钮在请求进行中禁用；
- 失败不会乐观移除待办；
- tab 打开时刷新待办。

- [x] **Step 2: 运行 RED**

```bash
node --test tests/trusteeship-sidepanel-contract.test.js tests/sidepanel-contract.test.js
```

Expected: 新 UI 契约 FAIL，原有批量确认契约 PASS。

- [x] **Step 3: 增加配置 UI**

字段建议 ID：

```text
trusteeshipEnabled
trusteeshipInterval
autoReplyDailyLimit
quietHoursEnabled
quietHoursStart
quietHoursEnd
feishuEnabled
feishuWebhook
feishuSigningSecret
btnTestFeishu
trusteeshipStatus
```

总开关保存失败时恢复原状态，并按 `missing` 引导到对应配置字段。

- [x] **Step 4: 增加待确认页**

字段建议 ID：

```text
page-approvals
approvalBadge
approvalList
approvalEmpty
```

每个待办以 DOM API 和 `textContent` 构建，不将 HR 文本或 AI 草稿拼进 `innerHTML`。用户编辑后点击确认：

```js
await sendRuntimeMessage({
  type: 'TRUSTEESHIP_RESOLVE_APPROVAL',
  approvalId,
  action: 'SEND_EDITED',
  draft: textarea.value.trim()
});
```

成功后才刷新/移除待办。

- [x] **Step 5: 增加单会话开关**

- 只在 `managedConversations` 中已登记且 ref 可靠的记录上启用；
- 默认 unchecked；
- 用户逐个操作，不提供“全部开启托管”；
- 关闭时提示会删除该会话保存的最近聊天上下文；
- 不影响已经完成的首次联系记录。

- [x] **Step 6: 样式与可访问性**

覆盖 360–600px 侧边栏宽度；按钮具有 `:focus-visible`；待确认原因/状态不只靠颜色表达；Webhook/secret 默认遮罩，提供暂时显示按钮但不写日志。

- [x] **Step 7: 更新文档与验证**

```bash
node --test tests/trusteeship-sidepanel-contract.test.js tests/sidepanel-contract.test.js
npm test
```

Expected: 新旧 UI 契约及全套测试全部 PASS。文档加入逐字段配置与待确认操作指南。

- [x] **Step 8: 条件提交**

```bash
git add src/sidepanel.html src/sidepanel.js src/sidepanel.css tests/trusteeship-sidepanel-contract.test.js tests/sidepanel-contract.test.js docs/08-boss-ai-trusteeship.md
git commit -m "feat: add trusteeship controls and approval inbox"
```

---

### Task 9: 集成恢复、隐私回归和文档收口

**Files:**
- Modify: `tests/monitor-engine.test.js`
- Modify: `tests/trusteeship-background-contract.test.js`
- Modify: `tests/trusteeship-sidepanel-contract.test.js`
- Modify: `README.md`
- Modify: `docs/07-multi-platform-design.md`
- Modify: `docs/08-boss-ai-trusteeship.md`
- Modify: `docs/oss-notes.md`
- Modify: `docs/superpowers/specs/2026-07-24-boss-ai-conversation-trusteeship-design.md`

- [x] **Step 1: 增加故障恢复回归测试**

覆盖：

- Service Worker 在 `CLASSIFYING` 中断：下轮可安全重做分类，但消息不重复发送；
- 在 `CLASSIFYING` 与 `SENDING` 证据同时存在时优先恢复发送未知，绝不回到分类；首次恢复写失败后下一次读取重试，AUTO 额度仍只增加一次；
- `WAITING_CONFIRMATION` 的缺链、错链或重复 PENDING 恢复证据：`PAUSED/RECOVERY_STATE_UNCERTAIN` 且通知为 0；
- 在 `SENDING` 中断：会话、intent 和关联待办恢复为 `PAUSED/SEND_RESULT_UNKNOWN`；
- alarm 丢失：worker 初始化恢复一个，不创建重复 alarm；
- Chrome 休眠后只补查当前增量，不补跑每个错过的周期；
- 全局关闭：alarm 被清除、读取和 AI 调用为 0；
- 单会话关闭/重置：最近消息删除；
- 登录失效/验证码：全局暂停并给出恢复指引；
- 飞书失败：本地待办保留；通知前在 store reservation、engine 新鲜快照、runtime notifier post-await 三层重验 owner/link/唯一 PENDING；background 保护包装在入口只验 API proof，并在 runtime 的同一最新快照上同步组合 API-proof 与 engine owner 断言，不能覆盖调用方断言；
- 静默结束：多条消息合并一条通知；
- 日志、状态摘要、飞书 payload 不含 webhook token、secret、API key、完整聊天上下文、模型草稿、待补字段或任意自由文本摘要；
- 未知持久 pauseCode 在 store 与 runtime DTO 两层映射为 `UNKNOWN_PROCESSING_FAILURE`，侧边栏只显示稳定中文人工核对提示；
- approval、intent、terminal、disable、checkpoint、pause、NO_REPLY、reset 与重新启用路径都清理分类恢复元数据。

- [x] **Step 2: 执行静态敏感信息扫描**

Run:

```bash
rg -n "feishuWebhook|signingSecret|apiKey|recentMessages" src tests
```

Expected: 只出现在配置读取、脱敏、测试 fixture 或明确受控的数据边界；逐项审阅，日志调用附近不得出现凭证变量。

再运行：

```bash
rg -n "log\\(|console\\.|runtime\\.sendMessage" src/background.js src/conversation src/sidepanel.js
```

Expected: 所有外显错误均为稳定代码/安全摘要，不包含聊天原文或凭证。

- [x] **Step 3: 全量自动化验证**

Run:

```bash
npm test
```

Expected: 0 failures、0 skipped；必须包含策略、存储、AI、飞书、读取、监控、后台、UI 和既有联系安全回归。

- [ ] **Step 4: Chrome 手工无外部写入验收**

加载 unpacked extension 后只做本地/假服务验证：

1. 新安装全局开关和会话开关均关闭。
2. 开启条件缺失时显示具体缺项。
3. 飞书测试使用用户提供的测试机器人，成功后记录 `lastTestOk`；该步骤只写飞书，不访问 Boss。
4. 切换 5/10/15 分钟后在扩展 Service Worker 检查只有一个 alarm。
5. 关闭总开关后 alarm 消失。
6. 使用脱敏本地 fixture/测试页确认待办渲染、编辑、取消和禁用流程。

Expected: 不读取真实 Boss 聊天、不发 Boss 消息。

- [x] **Step 5: 更新全部相关文档**

- README：功能边界、默认关闭、配置步骤、风险与隐私；
- `docs/07-multi-platform-design.md`：新增 Boss 专属托管适配层，明确智联/猎聘未启用；
- `docs/08-boss-ai-trusteeship.md`：填写实际测试命令、结果、未验证项、错误码；
- `docs/oss-notes.md`：列出参考项目和实际借鉴点；
- 设计规格当前保持“release-review P1 的真实 background 双断言组合已按 TDD 修复，background VM 31/31、Task 9 broad focused 195/195、全量 306/306，等待新的 review-clean gate；待无外部写入 Chrome 验收和分阶段实号验收”；只有 review-clean gate 与 Step 4 通过后才可进一步上调状态。

- [ ] **Step 6: 条件提交**

```bash
git add README.md docs tests
git commit -m "docs: finalize trusteeship verification guide"
```

---

### Task 10: 分阶段真实账号验收与发布门

**Prerequisite:** 用户提供明确授权的 Boss 测试账号/测试岗位和飞书测试群；任何阶段失败立即停止，不自动进入下一阶段。

- [ ] **Stage 1: 连续一个工作日只读监控**

配置：

- 仅 1 个测试会话；
- 单会话开启；
- 全局自动回复日限临时设为 1，但通过测试钩子/只读模式禁止发送；
- 轮询 10 分钟；
- 人工观察 alarm、精确目标定位、增量去重、飞书首次通知与合并提醒。

验收：

- 无其他会话正文被保存/提交 AI；
- 无重复待办；
- 无活动标签页被导航；
- 选择器异常、登录异常都失败关闭。

- [ ] **Stage 2: 人工确认发送 1 条**

用户在插件内编辑并明确点击确认。验收：

- 发送前目标身份复核；
- 只发送一次；
- 页面和本地均有明确成功证据；
- 结果未知时暂停且不重试。

- [ ] **Stage 3: 低风险自动回复 1 条**

仅允许“是否仍在看机会”或基础礼貌回应，日限 1，用户现场观察。验收：

- AI 置信度达标；
- 回复不含捏造事实；
- 发送一次；
- 次日计数重置但不会重放历史消息。

- [ ] **Stage 4: 故障演练**

人工制造登录失效或测试页模拟验证码、选择器变化、飞书失败。验收：稳定错误码、全局/单会话暂停范围正确、恢复需用户操作。

- [ ] **Stage 5: 发布判断**

仅当以下全部满足才标记 Phase 1 可发布：

- 全局和单会话默认关闭；
- 全套自动测试 0 failures；
- 一工作日只读监控无重复；
- 单条人工确认和单条低风险自动回复无错发/重复；
- 所有异常路径失败关闭；
- README、隐私说明、风险说明、用户手册与实际行为一致。

未获得真实发送授权时，最终结论必须写为：`代码与本地/只读验收通过，真实 Boss 发送未验证`。

---

## 最终验收命令

```bash
npm test
node --test tests/trusteeship-policy.test.js
node --test tests/conversation-store.test.js
node --test tests/reply-ai.test.js
node --test tests/feishu-notifier.test.js
node --test tests/conversation-reader.test.js
node --test tests/monitor-engine.test.js
node --test tests/trusteeship-background-contract.test.js
node --test tests/trusteeship-sidepanel-contract.test.js
```

Expected: 所有命令退出码为 0；无真实 Boss 或飞书网络调用（飞书手工测试除外且需用户配置）。

## 明确禁止宣称

- 未执行 Stage 1 前，不得宣称“全天稳定监控已验证”。
- 未执行 Stage 2/3 前，不得宣称“真实 Boss 自动回复已验证”。
- 只通过静态契约测试，不得宣称 DOM 选择器已适配真实页面。
- 飞书测试通知成功，不代表 Boss 回复链路成功。
- Chrome 关闭或电脑休眠时，不得宣称仍在监控。
