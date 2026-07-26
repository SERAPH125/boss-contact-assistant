# AI 明确拒绝自动礼貌结束设计

日期：2026-07-26

## 目标

当 HR 明确表达“不合适、不匹配、暂不考虑、岗位关闭、已招满”等拒绝语义时，由 AI 判断是否属于明确拒绝，并生成一条简短、自然、礼貌的结束语。系统在满足发送门禁后自动发送一次，随后把会话持久化为“已结束－未匹配”，停止监控和后续回复。

用户已明确选择：

- 是否属于明确拒绝完全由 AI 判断，不使用关键词、正则或固定短语覆盖模型结论；
- AI 只生成礼貌结束语，不继续争取、不追问原因、不推销经历；
- 静默时段内不发送，静默结束后再自动发送；
- 该类结束回复不计入每日自动回复额度；
- 同一会话只允许发送一次，结束后不得再次自动回复。

## 开源实践与本地经验

- [Rasa](https://github.com/RasaHQ/rasa) 将模型理解与确定性对话流程分开。本设计让 AI 负责“是否明确拒绝”和结束语生成，状态机负责静默、幂等、发送和终态。
- [langchain-ai/agents-from-scratch-ts](https://github.com/langchain-ai/agents-from-scratch-ts) 的邮件分类示例将 `respond / notify / ignore` 作为模型路由结果，再由持久工作流执行对应动作。本设计采用同样的“模型提议语义、流程执行动作”边界。
- 本地知识库 `技术复用/浏览器扩展-AI会话托管可靠性复盘.md` 的既有结论是：未知发送必须成为不可重放终态，成功必须有同目标的新 outgoing 证据，结束态必须幂等。本设计保留这些结论，只放宽明确拒绝后的首次礼貌结束回复。
- 本设计新增的产品选择是：不再使用确定性关键词纠正 AI 对拒绝语义的判断。该选择会增加误判风险，因此通过高置信度、草稿安全校验、静默延迟和发送幂等控制风险，但不声称消除模型误判。

## 采用方案

### AI 分类 + AI 草稿 + 独立 `AUTO_CLOSE` 工作流

新增分类：

```text
explicit_rejection
```

分类系统提示词要求：

- 明确拒绝时输出 `category: "explicit_rejection"`；
- `reasonCode: "EXPLICIT_REJECTION"`；
- 不要求简历或问答 evidence；
- “经验可能不太匹配、可能不太合适、暂时看起来不匹配”等含糊表达不得归为明确拒绝，应继续归为 `important`；
- 不使用本地关键词或正则覆盖分类结果。

分类器必须对所有可靠文本消息运行，即使当前没有简历或问答 facts。facts 为空时，普通事实类别仍会被既有 evidence 门禁阻止；只有 `explicit_rejection` 可以在空 evidence 下继续生成结束语。

只有同时满足以下 AI 输出条件时，策略才允许进入自动结束候选：

- `category === "explicit_rejection"`；
- `confidence >= 0.90`；
- `reasonCode === "EXPLICIT_REJECTION"`；
- `fieldsNeeded` 为空；
- 分类输出通过既有严格 JSON、唯一键和字段白名单校验。

AI 随后生成一条礼貌结束草稿。草稿不要求简历 evidence，但必须通过独立的出站格式校验：

- trim 后非空；
- 不超过 45 个 Unicode code points；
- 不包含 `?` 或 `？`；
- 不包含列表、换行或长段落；
- 不包含索要原因、继续争取、推销经历、薪资/面试/到岗承诺；
- 只表达收到、感谢和礼貌结束。

格式校验只判断出站文本是否安全，不重新判断 HR 是否明确拒绝。草稿不合格、AI 调用失败或分类置信度不足时，转入现有人工确认流程，不使用固定文案兜底。

## 确定性策略

策略新增动作：

```text
AUTO_CLOSE
```

`AUTO_CLOSE` 与普通 `AUTO_REPLY` 分离：

| 门禁 | `AUTO_REPLY` | `AUTO_CLOSE` |
| --- | --- | --- |
| 全局托管开启 | 必须 | 必须 |
| 逐会话托管开启 | 必须 | 必须 |
| AI 分类与置信度 | 白名单类别且 `>= 0.85` | `explicit_rejection` 且 `>= 0.90` |
| 简历/问答 evidence | 必须 | 不需要 |
| 硬风险事实回答 | 转人工 | 结束语不回答事实；草稿仍受出站校验 |
| 静默时段 | 转人工确认 | 持久化延迟，静默结束后重验 |
| 每日自动回复上限 | 计入并受限 | 不计入且不受限 |
| 已有待确认或发送中 | 阻止 | 阻止 |

AI 对明确拒绝的判断优先于普通类别白名单，但不能绕过全局/逐会话开关、目标会话绑定、API proof、静默时段、活动待办、发送意图和发送后证据。

## 状态模型

新增会话状态：

```text
WAITING_AUTO_CLOSE
ENDED_UNMATCHED
```

新增有界持久字段：

```js
pendingAutoClose: {
  fingerprint: "触发拒绝的 incoming 指纹",
  draft: "AI 礼貌结束语",
  confidence: 0.0,
  createdAt: 0
}
```

约束：

- `pendingAutoClose` 只允许存在于 `WAITING_AUTO_CLOSE`；
- 草稿最多 45 个 code points，指纹和时间继续使用现有净化边界；
- `WAITING_AUTO_CLOSE` 不创建待确认记录、不发飞书确认、不增加自动回复额度；
- `ENDED_UNMATCHED` 清除 `pendingApprovalId`、`pendingAutoClose` 和分类恢复元数据；完成的 `AUTO_CLOSE/SENT` intent 作为不可重放证据保留，但不得存在活动 `SENDING` intent；
- `ENDED_UNMATCHED` 是终态，周期引擎不再读取、分类、生成草稿或发送；
- 用户若未来需要恢复该会话，必须通过单独、显式的重新托管动作；本任务不自动恢复终态。

发送意图新增模式：

```text
AUTO_CLOSE
```

`AUTO_CLOSE` 与 `AUTO` 共用唯一意图、`SENDING`、发送证据和 `SEND_RESULT_UNKNOWN` 边界，但其成功或未知终态都不增加 `autoReplyCount`。

## 非静默流程

```text
读取新 incoming
→ AI 分类
→ explicit_rejection / confidence >= 0.90
→ AI 生成结束语
→ 出站格式校验
→ policy 返回 AUTO_CLOSE
→ 原子创建 AUTO_CLOSE intent
→ 重新验证目标会话与冻结草稿
→ 发送一次
→ 观察同目标的新 outgoing 证据
→ 成功：ENDED_UNMATCHED
→ 未知：PAUSED / SEND_RESULT_UNKNOWN
```

如果 AI 分类、草稿生成或出站格式校验在外部动作前失败，则创建普通人工确认待办。存储、API proof、目标绑定或页面环境失败继续使用现有暂停、退避和错误语义，不能伪装成普通待办。一旦 Enter/click 已尝试但证据不足，只能进入 `SEND_RESULT_UNKNOWN`，不得重新发送。

## 静默时段流程

静默时段内仍允许完成 AI 分类和草稿生成，但不能创建发送意图或触发 Boss 写入：

```text
AI 明确拒绝 + 安全草稿
→ 原子持久化 WAITING_AUTO_CLOSE + pendingAutoClose
→ 本轮结束，发送次数为 0
```

静默结束后的周期不能直接发送缓存草稿。必须先读取该会话最新历史并证明：

- `pendingAutoClose.fingerprint` 仍是最新 incoming；
- 没有更新的 HR 消息；
- 没有待确认任务或其他 `SENDING` intent；
- 全局与逐会话托管仍开启；
- API proof、目标绑定和页面发送门禁仍有效；
- 缓存草稿仍通过出站格式校验。

如果出现更新的 HR 消息，清除旧 `pendingAutoClose`，把会话恢复到分类流程并只处理最新可靠增量；旧结束语不得发送。若静默结束后的读取或目标证明不确定，按现有错误语义暂停或退避，不能乐观发送。

## AI 提示词变化

分类提示词：

- 删除“明确拒绝不得自动批准”的旧指令；
- 新增 `explicit_rejection` 类别及 90% 自动结束阈值说明；
- 强调明确拒绝与含糊不匹配的区别；
- 明确 AI 是唯一拒绝语义判定来源。

草稿提示词：

- `explicit_rejection` 时只能生成礼貌结束语；
- 不得提出任何问题；
- 不得请求重新考虑或解释原因；
- 不得补充、推销或纠正求职经历；
- 不得承诺薪资、面试、到岗或其他事项；
- 最多 45 个汉字；
- `evidenceIds` 允许为空。

其他分类与草稿规则保持不变。

## 引擎与存储边界

### Store

新增受限原子操作：

- `deferAutoClose(conversationId, fingerprint, draft, confidence)`；
- `createAutoCloseIntent(conversationId, fingerprint, draft)`；
- `completeAutoClose(intentId, sendEvidence)`；
- `cancelDeferredAutoClose(conversationId, fingerprint)`。

这些操作必须复核会话 owner、状态、指纹、全局开关、逐会话开关、活动待办和当前意图。`completeAutoClose` 只有在发送证据满足现有目标 ID、outgoing 指纹和观察时间要求时才能写入 `ENDED_UNMATCHED`。

### MonitorEngine

- `WAITING_HR` 继续处理真实新消息；
- `WAITING_AUTO_CLOSE` 在非静默周期先读取并重验最新 incoming，再决定发送、取消或暂停；
- `ENDED_UNMATCHED` 永远跳过；
- 普通 `AUTO_REPLY` 的日限与 evidence 规则不变；
- `AUTO_CLOSE` 不创建飞书待确认，不增加日限；
- AI、草稿或安全校验失败时创建一个普通人工确认待办，供用户编辑或选择不回复。

### Runtime 与发送器

不新增绕过页面门禁的发送接口。`AUTO_CLOSE` 复用现有 protected sender：

- 只使用当前活动 Boss 聊天页；
- 重新激活并验证唯一目标；
- 冻结草稿；
- Enter 与按钮互斥；
- 成功必须观察新 outgoing；
- 未知结果不可重放。

## UI

已登记岗位新增状态文案：

- `WAITING_AUTO_CLOSE`：`等待静默结束后礼貌回复`
- `ENDED_UNMATCHED`：`已结束－未匹配`

终态卡片不再显示“托管此岗位”已开启的运行状态，也不参与“正在托管 N 个岗位”的数量。可以保留“打开会话”和“从列表移除”，但不提供自动重试按钮。

本任务不新增自定义提示词输入框，也不允许用户在界面配置拒绝关键词。

## 演练模式

真实外发演练继续保持“演练本身不直接发送”的既有边界：

- AI 判断为明确拒绝时，演练结果显示生产策略动作 `AUTO_CLOSE`；
- 演练仍创建生产待确认项，只有用户确认后才真实发送；
- 演练不写入 `WAITING_AUTO_CLOSE` 或 `ENDED_UNMATCHED`；
- 演练不增加每日自动回复额度。

因此演练可以验证 AI 分类和草稿，但不能替代真实监控中的静默延迟、自动发送和终态验收。

## 错误处理

| 情况 | 行为 |
| --- | --- |
| AI 分类失败或输出无效 | 人工确认 |
| `explicit_rejection` 置信度不足 | 人工确认 |
| AI 草稿失败或出站校验失败 | 人工确认，不使用固定回复 |
| 静默期出现更新 HR 消息 | 取消旧延迟结束，重新分类最新消息 |
| 发送前目标不确定 | 不发送，按现有目标错误处理 |
| 发送动作后证据不足 | `SEND_RESULT_UNKNOWN`，永久不重放 |
| 成功证据完整 | `ENDED_UNMATCHED`，停止监控 |
| Worker 在 `WAITING_AUTO_CLOSE` 中断 | 从持久快照恢复并重新读取，不直接发送 |
| Worker 在 `AUTO_CLOSE/SENDING` 中断 | 收束为 `SEND_RESULT_UNKNOWN` |

## 测试策略

严格采用 RED → GREEN：

1. `ReplyAI`
   - 新类别解析；
   - 分类和草稿提示词；
   - `explicit_rejection` 空 evidence 合法；
   - 超长、问句、争取和承诺型结束语拒绝。
2. `TrusteeshipPolicy`
   - 高置信明确拒绝得到 `AUTO_CLOSE`；
   - 低置信、含糊分类、AI 失败得到人工确认；
   - 静默返回延迟动作；
   - 不受每日额度影响。
3. `ConversationStore`
   - 延迟结束状态和字段归一化；
   - `AUTO_CLOSE` intent 不计额度；
   - 成功进入 `ENDED_UNMATCHED`；
   - 未知发送不可重放；
   - 并发、恢复、禁用和重置清理。
4. `MonitorEngine`
   - 非静默明确拒绝自动发送一次；
   - 静默期零发送，结束后重验并发送；
   - 静默期出现新消息时取消旧草稿；
   - 成功后后续周期 reader、AI、sender 调用均为 0；
   - AI/草稿失败创建人工确认。
5. `Runtime / Sidepanel / Live drill`
   - DTO 只暴露安全状态；
   - 状态文案和托管计数正确；
   - 演练显示 `AUTO_CLOSE` 但不直接发送；
   - 隐私、凭证和高权限消息契约无回归。
6. 运行全量自动化、JavaScript 语法、Manifest JSON 和 `git diff --check`。

## 文档更新

实施完成后同步更新：

- `README.md`
- `docs/08-boss-ai-trusteeship.md`
- `docs/oss-notes.md`
- 本地知识库只读引用不自动修改；如需把新结论回写知识库，必须另获用户明确授权。

## 验收标准

- 明确拒绝是否成立只由 AI 分类决定，没有关键词或正则覆盖；
- 高置信 `explicit_rejection` 生成安全礼貌结束语并自动发送一次；
- 静默时段内绝不发送，静默结束后先重读并验证没有更新消息；
- `AUTO_CLOSE` 不增加且不受每日自动回复额度限制；
- 发送成功后状态为 `ENDED_UNMATCHED`，后续周期不读、不分类、不生成、不发送；
- AI 或草稿不可靠时进入人工确认，不使用固定文案兜底；
- 动作后证据不足仍为不可重放的 `SEND_RESULT_UNKNOWN`；
- 真实外发仍必须通过当前活动 Boss 页、目标复核和新 outgoing 证据；
- 开发文档和自动化测试全部同步通过。
