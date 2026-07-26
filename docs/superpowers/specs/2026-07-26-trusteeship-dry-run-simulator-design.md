# AI 托管安全干跑模拟器设计

日期：2026-07-26

## 目标

在没有真实 HR 新消息时，允许用户从侧栏手工输入一条模拟 HR 消息，验证当前真实 API、当前提示词、简历/问答依据、确定性风险策略和托管编排能否得到预期结果。

模拟测试必须做到：

- 不读取或操作 BOSS 页面；
- 不向 BOSS 发送任何消息；
- 不修改真实 `managedConversations`、`lastIncomingFingerprint`、`pendingApprovals`、发送意图、每日自动回复次数或 alarm；
- 不发送飞书通知；
- 不把模拟结果混入生产会话状态；
- 明确展示模型结果、策略结果、拟回复内容和所有阻断原因。

本功能是对“AI 决策链”的安全验证，不替代真实 BOSS 新消息的端到端检测和发送验证。

## 开源项目参考

- [Rasa](https://github.com/rasahq/rasa) 使用脚本化对话与测试环境验证对话行为。可复用的思想是：测试输入和期望行为应当可重复执行，并与生产对话状态隔离。
- [Botium WebdriverIO Connector](https://github.com/codeforequity-at/botium-connector-webdriverio) 将受控输入转换为机器人消息，再捕获输出用于断言。可复用的思想是：把“输入消息”和“输出观察”做成明确测试边界。
- [LangGraph interrupt](https://github.com/langchain-ai/langgraph/blob/main/libs/langgraph/langgraph/types.py) 提供可持久化的人机确认中断。可复用的思想是：需要确认的结果必须作为显式决策返回，不能被测试模式偷偷视为已发送。

本项目不会复制这些项目的实现代码，只采用可验证、隔离和显式结果的设计原则。

## 当前事实

现有 `MonitorEngine.runCycle()` 只处理 `reader.read()` 返回的真实新消息。侧栏“立即检查已登记岗位”通过 `TRUSTEESHIP_RUN_NOW` 进入同一生产周期，没有注入测试消息的能力。

`tests/monitor-engine.test.js` 和 `tests/trusteeship-integration-recovery.test.js` 已经覆盖虚拟 reader、虚拟 classifier 和虚拟 sender，但分类与草稿结果是测试预设值，不能证明当前真实 API 和提示词正确工作。

真实浏览器验证曾得到 `checked > 0 / newMessages = 0`。这证明读取周期运行成功，但因为没有登记基线后的新消息，AI 分类、草稿和策略分支没有被调用。

## 方案比较

### 方案 A：直接调用分类器和策略

侧栏把模拟文本传给后台，后台依次调用真实分类器、草稿器和 policy。

优点：实现量小。

缺点：绕过 `MonitorEngine` 的实际编排，无法验证消息归一化、二次策略门、自动发送意图分支和待确认分支之间的连接。

### 方案 B：隔离内存中的完整 `MonitorEngine` 干跑（采用）

为每次模拟创建一次性内存 storage 和一次性 `ConversationStore`，复制被选会话的非敏感身份、当前托管设置和当前每日计数。虚拟 reader 注入唯一模拟消息；真实 classifier、真实 `getResumeFacts` 和真实 policy 保持不变；虚拟 sender 只记录 `wouldSend` 并返回可验证的模拟成功证据；虚拟 notifier 永不出网。

周期结束后只读取内存 snapshot，转换成安全结果并销毁全部模拟对象。

优点：

- 最大程度复用生产编排；
- 能证明消息进入、分类、草稿、策略、二次门禁和发送/待确认分支的连接；
- 生产 storage、BOSS 页面和飞书完全不参与。

缺点：需要严格约束模拟依赖和输出字段，并增加比方案 A 更多的测试。

### 方案 C：清空真实消息基线后重放历史消息（拒绝）

该方案会修改 `lastIncomingFingerprint`，可能造成重复回复或污染去重状态，不能作为测试功能。

## 用户界面

在“AI 对话托管”配置页、“立即检查已登记岗位”按钮下方新增折叠区“模拟 HR 新消息（不发送）”：

1. 会话选择：只列出当前已登记的 Boss 会话；默认选择第一条，用户可切换。
2. 消息输入：单条纯文本，去除首尾空白，最多 600 个 Unicode code point。
3. “运行安全模拟”按钮。
4. 固定提示：“使用真实 AI，但不会读取/写入 BOSS，不会修改托管状态或发送飞书。”
5. 结果区显示：
   - 模拟消息；
   - AI 分类、置信度和 `reasonCode`；
   - AI 引用的事实 ID；
   - 策略动作：`AUTO_REPLY` 或 `REQUIRE_CONFIRMATION`；
   - 最终阻断原因；
   - 草稿；
   - `wouldSend`；
   - “仅模拟，未发送”的醒目标记。

结果区不得显示 API Key、Webhook、签名密钥、完整简历文本或模型原始响应。

## 消息契约

新增仅允许侧栏发送的高权限消息：

```json
{
  "type": "TRUSTEESHIP_SIMULATE_MESSAGE",
  "conversationId": "可靠会话标识",
  "message": "模拟 HR 文本"
}
```

验证规则：

- 必须是精确字段集合，额外字段拒绝；
- `conversationId` 必须是 1—128 字符的非空字符串；
- `message` 必须是 1—600 Unicode code point 的非空字符串；
- 会话必须存在、平台必须为 `boss`；
- 仍使用现有 `isTrustedTrusteeshipSender`，网页 content script 不能调用；
- API 测试证明必须当前有效；失效时返回既有稳定错误码，不降级为伪 AI。

成功响应：

```json
{
  "ok": true,
  "result": {
    "conversationId": "conv-id",
    "message": "还在看机会吗？",
    "classification": {
      "category": "still_looking",
      "confidence": 0.91,
      "reasonCode": "SAFE",
      "evidenceIds": ["faq-line-1"],
      "fieldsNeeded": []
    },
    "decision": {
      "action": "AUTO_REPLY",
      "reasonCode": "AUTO_REPLY_ALLOWED"
    },
    "draft": "是的，我还在看合适机会。",
    "draftEvidenceIds": ["faq-line-1"],
    "wouldSend": true,
    "simulated": true
  }
}
```

待确认结果同样返回 `ok: true`，但 `decision.action` 为 `REQUIRE_CONFIRMATION`、`wouldSend` 为 `false`。运行错误返回 `{ "ok": false, "code": "稳定错误码" }`，不泄露供应商响应、网络正文或密钥。

## 数据流与隔离边界

1. 侧栏验证空输入后发送 `TRUSTEESHIP_SIMULATE_MESSAGE`。
2. runtime 验证消息 schema 和会话存在性。
3. simulator 读取一次生产 snapshot，仅复制：
   - 目标会话身份字段和 `recentMessages`；
   - 规范化托管设置；
   - 当前 `autoReplyCount`；
   - 当前时间；
   - 通过既有加载器得到的事实 ID/文本。
4. simulator 创建一次性 memory storage 和一次性 `ConversationStore`。
5. 将复制的会话登记到内存 store 并启用，模拟会话状态固定为 `WAITING_HR`；生产会话的暂停、待确认或发送意图不复制。
6. 虚拟 reader 返回一条 `kind: "text"` 的模拟新消息，fingerprint 使用一次性不可预测测试 ID，baseline 等于该 ID。
7. `MonitorEngine` 使用真实 classifier、真实 policy 和真实事实运行一轮。
8. 虚拟 sender 不接触 Chrome tab，只记录 draft 并返回仅存在于内存的模拟成功证据。
9. 虚拟 notifier 返回本地成功对象，不访问飞书。
10. 从内存 snapshot、classifier 观察记录和 sender 观察记录生成白名单响应；随后释放引用。

生产 `conversationStore` 只有第 3 步的一次 `getSnapshot()` 读取。任何 simulator 代码不得持有生产 store 的写方法。

## 结果解释

模拟结果区应告诉用户：

- `AUTO_REPLY + wouldSend=true`：在当前设置、事实、模型结果和策略下，生产流程会尝试自动发送；本次没有发送。
- `REQUIRE_CONFIRMATION`：生产流程会进入人工确认；显示最先阻断自动发送的稳定原因。
- AI/API 错误：本次没有得到可信分类或草稿；不允许包装成“模拟成功”。

对于“明确不合适”场景，当前提示词要求分类为 `important / EXPLICIT_REJECTION`，因此预期为 `REQUIRE_CONFIRMATION` 且无自动发送。模拟器只报告现行生产行为，不在本功能内新增“自动关闭会话”状态转换。

## 错误处理

- 输入错误：`INVALID_TRUSTEESHIP_MESSAGE`。
- 会话不存在：`CONVERSATION_NOT_FOUND`。
- 会话平台错误：`UNSUPPORTED_PLATFORM`。
- API 证明过期：复用 `API_PROOF_STALE`。
- 模型分类或草稿失败：返回稳定的 `AI_CLASSIFY_FAILED`、`AI_CLASSIFICATION_INVALID`、`AI_DRAFT_FAILED` 或 `AI_DRAFT_INVALID`；禁止原始错误透出。
- 内存编排异常：`TRUSTEESHIP_SIMULATION_FAILED`。

模拟异常不得暂停全局托管或目标会话。

## 测试策略

按 TDD 增加以下测试：

1. runtime schema：接受唯一合法结构；拒绝额外字段、空文本、超长文本和超长会话 ID。
2. 隔离测试：运行前后生产 storage 深度相等；生产 reader、sender、notifier 调用次数均为 0。
3. 自动回复模拟：真实编排得到 `AUTO_REPLY`，虚拟 sender 记录一次，响应 `wouldSend=true`，但生产每日计数不变。
4. 待确认模拟：硬风险“薪资是多少？”得到 `REQUIRE_CONFIRMATION`，虚拟 sender 为 0。
5. 明确拒绝模拟：模型返回 `important / EXPLICIT_REJECTION` 时不发送。
6. AI 失败：返回稳定错误且不产生任何外部副作用。
7. sidepanel contract：控件、消息类型、警示语和结果字段存在。
8. sidepanel runtime：按钮禁用/恢复、输入验证、成功和错误投影正确。
9. 完整现有测试套件回归。

## 验收标准

- 用户能选择已登记会话、输入模拟 HR 文本并得到真实 AI 决策结果；
- UI 和响应始终标明“仅模拟，未发送”；
- 无 BOSS tab 消息、无飞书请求、无 production storage 写入；
- 不创建真实待确认、不增加回复计数、不修改消息基线或 alarm；
- “还在看机会吗？”、“薪资是多少？”、“不合适”和 AI 故障场景都有自动化覆盖；
- 相关实现说明同步更新 `docs/08-boss-ai-trusteeship.md` 和 `docs/oss-notes.md`。

## 非目标

- 不模拟 BOSS DOM、WebSocket、虚拟列表或 selector；
- 不证明 alarm 能发现真实新消息；
- 不执行真实发送；
- 不允许通过调试参数绕过 API 证明、风险策略或发送门禁；
- 不把模拟器扩展成批量提示词评测平台。
