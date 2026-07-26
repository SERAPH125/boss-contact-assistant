# AI 托管真实外发演练设计

## 目标

把现有“模拟 HR 新消息（不发送）”入口直接升级为“真实外发演练”：

1. 用户选择一个已登记、已托管的 Boss 会话并输入一条模拟 HR 消息；
2. 系统使用当前真实 API、提示词、简历/问答依据和确定性策略生成分类与草稿；
3. 无论策略原本是否允许自动回复，演练都不得直接自动发送，而是在生产待确认队列创建一条 `PENDING` 记录；
4. 飞书待确认通知可包含经净化、限长后的模拟 HR 正文和拟回复；
5. 用户只能在插件“待确认”页编辑并点击“修改并确认发送”，随后复用生产目标复核、发送意图、发送证据和未知结果终止链路，把消息真实发送给所选 HR。

## 用户授权与边界

- 用户已明确授权真实外发演练向所选真实 HR 发送消息。
- 真实发送仍必须经过插件内人工确认；运行演练本身不能直接发给 HR。
- Boss 中手动撤回消息不删除已经发送到飞书群的正文。
- 原安全模拟语义不再保留；入口、状态文案、运行时消息和开发文档必须全部改为“真实外发演练”，避免用户误判副作用。
- 演练产生的模拟 HR 消息不得写入真实会话的监控基线、`processedFingerprints` 或 `recentMessages`，否则会污染后续真实新消息检测和 AI 上下文。
- 同一会话已有真实待确认任务、正在发送或暂停时，演练必须拒绝创建第二个待确认任务。
- 演练不证明真实页面监控已经成功。真实监控能力必须由生产 reader 的独立测试和浏览器实测证明。

## 采用方案

### 生产待确认队列 + 生产发送链路

保留现有一次性内存 AI 评估，用它生成分类、策略结果和草稿；评估结束后不再只返回报告，而是调用生产 store 的专用 `createLiveDrillApproval()`：

- 创建 `origin: "LIVE_DRILL"` 的生产 `PENDING` approval；
- 不修改真实 Boss 消息基线和最近消息；
- 把会话切换到 `WAITING_CONFIRMATION`；
- 复用 MonitorEngine 的通知租约、飞书重试和状态复核发送一次通知；
- 最终发送继续走既有 `resolveApproval({ action: "SEND_EDITED" })`。

该方案沿用 [LangGraph](https://github.com/langchain-ai/langgraph) 的 interrupt / human-in-the-loop 思路：先持久化暂停点，再由人工恢复外部动作。飞书仍使用 [larksuite/node-sdk](https://github.com/larksuite/node-sdk) 所对应的单向自定义机器人通知模式；没有引入卡片按钮回调服务，最终确认仍在插件内完成。

未采用“演练按钮直接调用 Boss sender”，因为它会绕过持久发送意图、目标复核和未知结果不可重试门禁。未采用“直接在飞书确认”，因为现有自定义 Webhook 不能接收卡片动作回调，需要新增飞书应用和服务端事件入口。

## 数据模型

生产 approval 新增：

```js
{
  origin: "LIVE_MONITOR" | "LIVE_DRILL"
}
```

旧数据缺少 `origin` 时归一化为 `LIVE_MONITOR`。

`createLiveDrillApproval(input)` 接收：

```js
{
  conversationId: "稳定 peer id",
  drillFingerprint: "live-drill:随机 ID",
  message: "模拟 HR 正文",
  reasonCode: "策略原因",
  fieldsNeeded: [],
  draft: "拟回复或空字符串"
}
```

它只允许 `enabled=true` 且 `state=WAITING_HR`、没有活动 approval/send intent 的 Boss 会话。

## 飞书正文

MonitorEngine 的飞书 payload 新增：

```js
{
  origin: "LIVE_MONITOR" | "LIVE_DRILL",
  latestMessage: "最后一条 HR 正文",
  draft: "拟回复"
}
```

卡片使用 `plain_text`：

- `LIVE_DRILL` 显示“模拟 HR 正文”；
- `LIVE_MONITOR` 显示“HR 正文”；
- 正文与草稿各最多 600 个 Unicode code points；
- 继续移除控制字符、URL、`@` mention 和疑似凭据；
- Webhook、签名密钥和 API Key 仍不得进入卡片。

## 运行时和界面

后台消息改为：

```js
{
  type: "TRUSTEESHIP_STAGE_LIVE_DRILL",
  conversationId: "...",
  message: "..."
}
```

运行前必须验证：

- 全局托管已开启且未暂停；
- API 测试证明、回复依据、飞书测试和风险确认仍有效；
- 目标会话已登记且已托管；
- 用户勾选本轮真实外发演练确认框。

成功响应包含 `approvalId`、AI 分类、原策略结果、草稿、飞书通知结果和 `liveDrill: true`。界面显示“已创建真实发送待确认；当前尚未发送给 HR”，刷新待确认徽标，但不声称监控已验证。

## 真实监控验收

真实监控与演练分开验收：

1. 单元/集成测试用真实 `ConversationStore + MonitorEngine` 和 reader fixture 证明：基线后的 incoming message 只处理一次，创建 approval 或执行策略动作；
2. Boss reader 契约测试证明 stable peer、消息方向、基线和消息 fingerprint 能从当前页面协议/DOM 结构解析；
3. 浏览器实测“立即检查已登记岗位”必须至少报告 `checked > 0`，并更新目标会话最近检查时间；
4. 只有真实 HR 在基线后发来一条新消息，且生产周期显示 `newMessages > 0`，才算端到端证明真实监控捕获成功；
5. 真实发送演练只证明“AI → 待确认 → 飞书 → 目标复核 → Boss 发送”链路，不替代第 4 条。

## 验收标准

- 原“仅模拟，未发送”入口和文案不存在；
- 运行演练会创建一个生产待确认任务，但不会立即发送 Boss；
- 飞书卡片包含标注后的模拟 HR 正文和拟回复，且不泄露凭据；
- 在插件待确认页确认后，生产 sender 只向 approval 绑定的稳定会话发送一次；
- 取消或不回复后恢复 `WAITING_HR`；
- 演练不会修改真实消息基线、已处理 fingerprint、最近真实消息或自动回复计数；
- 已有待确认、会话暂停、托管未运行或前置条件失效时稳定拒绝；
- 生产监控 fixture 回归、隐私回归、全量测试、语法检查和 Manifest 校验通过；
- `docs/08-boss-ai-trusteeship.md`、`docs/oss-notes.md` 和 README 中相关说明同步更新。
