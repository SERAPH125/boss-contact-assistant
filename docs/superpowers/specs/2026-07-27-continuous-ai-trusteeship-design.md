# AI 持续会话托管与延迟回复设计

## 目标

让已登记并启用的 Boss 会话在浏览器保持运行、登录有效且全局托管开启时持续监控多轮 HR 对话。一次回复完成或发送回执暂时不可见时，不再自动退出整段会话托管。

会话仅在以下情况下结束或暂停：

- AI 以现有确定性授权门确认 HR 明确拒绝，礼貌结束语成功发送后进入 `ENDED_UNMATCHED`；
- 用户手动结束该会话托管；
- 登录失效、平台阻止、目标身份无法确认、消息顺序无法证明等不能安全继续的硬故障。

本功能不实现验证码破解、平台风控绕过、浏览器指纹伪造或发送结果未知后的盲目重发。随机延迟只用于回复节奏控制。

## 既有问题

当前实现把“该条消息发送结果尚未获得肯定证据”和“整个会话不能继续托管”绑定在一起：

```text
发送动作已尝试
→ 立即历史读取未出现匹配 outgoing
→ SEND_RESULT_UNKNOWN
→ conversation.state = PAUSED
→ 后续 HR 消息不再读取
```

2026-07-27 的真实会话证据表明：AI 回复已经存在于 Boss 服务端历史，但插件在发送成功后的同一秒写入 `SEND_RESULT_UNKNOWN`；HR 十二秒后发送的新消息因此没有被继续处理。现有“不重放未知发送意图”原则正确，错误之处是把单条发送锁扩散成整会话停机。

## 开源模式参考

- [AWS Transactional Outbox](https://github.com/aws-samples/transactional-outbox-pattern)：用持久化意图和幂等消费隔离重复副作用；未知结果不能直接等同于可安全重试。
- [Temporal Python SDK](https://github.com/temporalio/sdk-python)：长时间异步工作通过持久状态、定时唤醒和恢复继续推进，而不是因一次暂态未确认就终止整个流程。
- [LangGraph](https://github.com/langchain-ai/langgraph)：长流程使用显式、可恢复状态；人工确认只应阻塞需要授权的动作，不应关闭无副作用的持续观察。

采用这些模式的边界是：发送意图保持唯一且不可盲目重放，监控与发送权限分离，延迟任务和核验进度必须持久化。

## 用户体验原则

1. 用户勾选“托管此岗位”后，默认含义是持续托管，而不是只处理一轮问答。
2. 用户不需要理解发送协议或手动恢复常见的短暂回执延迟。
3. 一次发送正在等待核验时，岗位卡显示“正在核验发送 · 持续监控”，不显示“已暂停”。
4. 只有确实需要用户选择的内容进入待确认页。
5. 普通低风险自动回复采用 30～300 秒的持久随机延迟。
6. 延迟期间出现更新的 HR 消息时，不发送过时草稿；重新以最新有界上下文决策。
7. 明确拒绝只发送一次礼貌结束语，成功后结束会话。
8. 用户始终可以手动结束单个会话托管。
9. 用户可以一次启用全部符合条件的已登记岗位，不必逐张卡片勾选。
10. 审核页联系成功并完成登记后，AI 托管列表自动刷新，不要求用户切换页面或重开侧栏。

## 状态模型

### 会话状态

新增两个可恢复状态：

- `WAITING_REPLY_DUE`：已为最新 HR 消息生成并授权普通自动回复，等待持久到期时间。
- `VERIFYING_SEND`：该条发送动作可能已经发生，但尚未取得肯定 outgoing 证据；继续只读监控并核验，禁止重放同一意图。

保留现有主要状态：

- `WAITING_HR`
- `CLASSIFYING`
- `WAITING_CONFIRMATION`
- `WAITING_AUTO_CLOSE`
- `SENDING`
- `PAUSED`
- `DISABLED`
- `ENDED_UNMATCHED`

状态流：

```text
WAITING_HR
  → 发现新 incoming
  → CLASSIFYING
      ├─ 普通低风险自动回复
      │   → WAITING_REPLY_DUE
      │   → 到期前重读
      │   → SENDING
      │       ├─ 肯定证据 → WAITING_HR
      │       └─ 暂无肯定证据 → VERIFYING_SEND
      │                              ├─ 核验成功 → WAITING_HR
      │                              └─ 继续核验，不重放
      ├─ 需要人工确认 → WAITING_CONFIRMATION
      ├─ 明确拒绝
      │   → WAITING_AUTO_CLOSE
      │   → 到期发送一次结束语
      │       ├─ 肯定证据 → ENDED_UNMATCHED
      │       └─ 暂无肯定证据 → VERIFYING_SEND
      └─ 硬故障 → PAUSED

任意可托管状态
  → 用户手动结束
  → DISABLED
```

`VERIFYING_SEND` 必须保留原始 `sendIntent`、冻结草稿、目标会话、触发 incoming 指纹和已知发送时间范围。它不得创建新的相同发送意图。

## 持久延迟回复

普通低风险自动回复不再在分类完成后立即发送，而是持久化：

```js
pendingReply: {
  fingerprint: "id:...",
  draft: "冻结草稿",
  evidenceIds: ["..."],
  classification: {
    category: "low_risk_fact",
    confidence: 0.98
  },
  createdAt: 1785124000000,
  dueAt: 1785124184000
}
```

约束：

- `dueAt` 在 `createdAt + 30 秒` 到 `createdAt + 300 秒` 之间；
- 随机值只生成一次并持久化，Worker 恢复不得重新抽取；
- 对象必须绑定当前最后一条 incoming 指纹；
- 只有当前会话仍启用、全局托管仍运行、没有活动待办和没有活动发送意图时有效；
- 字段损坏、草稿变化、指纹不一致或状态不一致时不得发送；
- 普通回复仍受每日自动回复额度约束；
- 明确拒绝的结束语继续不计入普通额度。

### 新消息覆盖旧延迟

到期前若读到新的 HR 消息：

1. 原子取消旧 `pendingReply`；
2. 不发送旧草稿；
3. 将新消息加入有界最近上下文；
4. 以最新 incoming 指纹重新分类、生成草稿并授权；
5. 若仍为低风险自动回复，创建新的 30～300 秒延迟。

同一轮读取包含多条 HR 消息时，以顺序化的有界上下文处理，但只允许为最新尚未回答的 incoming 留下一个活动 `pendingReply`。

## 调度

保留现有 `boss-ai-chat-monitor` 周期 alarm，继续按用户配置的 5、10 或 15 分钟扫描会话。

新增单一 one-shot alarm：

```text
boss-ai-chat-due
```

它始终指向所有有效延迟任务中的最早 `dueAt`：

- 普通 `pendingReply`；
- 明确拒绝 `pendingAutoClose`；
- 需要近期再次核验的 `VERIFYING_SEND`。

每次新增、取消、完成或恢复延迟任务后重新计算最近到期时间。同名 one-shot alarm 覆盖旧配置，不为每个会话创建独立 alarm。alarm 唤醒后仍进入同一个 runtime FIFO 和 `MonitorEngine.runCycle()`，不能绕过租约、策略、额度和目标验证。

Chrome 对定时器精度不作实时保证，因此“30～300 秒”表示最早允许发送时间；实际执行可以稍晚，但绝不能早于 `dueAt`。

## 静默时段

分类发生在静默时段时：

- 普通回复和明确拒绝结束语都不发送；
- `dueAt` 设为下一个静默结束时间再加 30～300 秒；
- 静默期间继续只读监控；
- 若出现更新 HR 消息，取消旧延迟并基于最新消息重新决策；
- 静默结束唤醒时必须重读目标会话并重新验证状态。

## 发送与核验

### 同步发送确认

发送动作完成后不再只做一次立即历史读取。content handler 在不再次触发 Enter 或点击的前提下，对同一目标做有界核验：

- 最长约 10 秒；
- 每次重新校验目标会话；
- 每次只读 Boss 历史；
- 查找新的、方向为 outgoing、正文与冻结草稿完全一致且发送前不存在的消息；
- 找到唯一证据后返回成功。

### 跨周期持续核验

同步窗口内未找到证据时：

1. 将该意图持久化为 `SEND_RESULT_UNKNOWN`；
2. 会话进入 `VERIFYING_SEND`，而不是 `PAUSED`；
3. 不增加任何再次发送权限；
4. 保留触发消息 baseline，不跳过核验期间的新 incoming；
5. 周期扫描和最近到期 alarm 继续只读历史；
6. 找到精确 outgoing 后，把意图收束为 `SENT`：
   - 普通回复回到 `WAITING_HR`；
   - 明确拒绝结束语进入 `ENDED_UNMATCHED`；
7. 随后继续处理核验期间积累的新 HR 消息。

若长期无法证明发送结果，岗位仍显示“正在核验发送”，并提供：

- “打开会话”；
- “已确认已发送”；
- “手动结束托管”。

“已确认已发送”只解除单条发送锁并继续处理后续 incoming，不重发、不删除 Boss 消息。第一阶段不提供“确认未发送并自动重试”，避免重复消息。

## 持续多轮对话

普通自动回复成功后：

- 会话恢复 `WAITING_HR`；
- `enabled` 保持 `true`；
- 保留最后 incoming baseline、已处理指纹窗口和最新发送证据；
- 下一次 HR 新消息重新走读、分类、策略、延迟和发送流程；
- 不以“已经自动回复过一次”作为结束条件。

停止条件：

- 明确拒绝结束语得到肯定发送证据；
- 用户手动结束；
- 会话被从登记列表移除；
- 发生硬故障并进入 `PAUSED`。

## 用户手动结束

岗位卡增加“结束托管”操作。确认文案明确：

- 仅停止该岗位后续监控与自动回复；
- 不删除 Boss 历史消息；
- 清除活动延迟回复、延迟结束和待确认项；
- 若存在 `SENDING` 或 `VERIFYING_SEND` 意图，只终止后续处理，不改变该意图的不可重放终态。

手动结束后的状态使用现有 `DISABLED`，重新勾选托管时回到 `WAITING_HR`，并以最新可靠 incoming 建立继续监控的基线。

## 一键托管全部可用岗位

AI 托管区域增加“一键托管全部可用岗位”按钮。它只启用可以安全恢复的已登记会话：

- 已经处于启用状态的会话保持不变；
- `DISABLED` 且不存在活动待确认、活动延迟任务或发送锁的会话可以恢复为 `WAITING_HR`；
- `ENDED_UNMATCHED` 永远跳过，批量操作不能重新联系已经明确拒绝的 HR；
- `PAUSED` 跳过，避免越过登录、目标身份、消息协议或平台阻止等人工核对边界；
- `WAITING_CONFIRMATION`、`WAITING_REPLY_DUE`、`WAITING_AUTO_CLOSE`、`SENDING` 和 `VERIFYING_SEND` 保持当前状态，不重复创建工作项；
- 损坏、缺少 canonical conversation ID 或无法归一化的记录计为失败，不选择相似记录替代。

批量操作由 store 在同一串行读改写中处理，并返回有界统计：

```js
{
  enabled: 4,
  unchanged: 3,
  skipped: 2,
  failed: 0
}
```

UI 显示“已启用 N 个、保持 N 个、跳过 N 个、失败 N 个”。按钮不得循环调用单会话 runtime 接口，以免中途 Worker 休眠后产生部分结果且无法解释；runtime 提供一个批量协议，store 对当前快照完成一次确定性迁移和一次持久化。

同时提供“一键结束全部托管”，必须二次确认。它关闭所有尚未终结的会话、清理未产生外部写入的延迟任务和普通待确认项，但不得改变 `SENDING` / `VERIFYING_SEND` 意图的不可重放证据，也不删除 Boss 消息。`ENDED_UNMATCHED` 保持原终态。

## 联系成功后的响应式刷新

### 已确认根因

审核页“联系已选”成功后，background 已通过 `conversationStore.registerConversation(...)` 写入 `managedConversations`。sidepanel 的 `chrome.storage.onChanged` 当前只监听 `byPlatform`，没有订阅托管相关 key，因此 AI 托管区域继续展示旧的 `trusteeshipSnapshot`。

这属于视图同步缺陷，不是登记失败。修复不能在 UI 中根据联系结果伪造岗位卡片；持久 store 仍是唯一事实源。

### 订阅与刷新

sidepanel 监听以下 `chrome.storage.local` key：

- `managedConversations`
- `pendingApprovals`
- `conversationTrusteeship`
- `feishuNotification`

命中任意 key 时：

1. 使用一个 100～200 毫秒的合并刷新定时器吸收同一批或连续登记写入；
2. 调用一次 `TRUSTEESHIP_GET_STATE` 获取安全 DTO；
3. 更新顶部动态状态、待确认数量、已登记岗位列表、真实演练会话列表和批量按钮状态；
4. 不直接信任 `StorageChange.newValue` 构建公开 UI；
5. 不覆盖当前获得焦点或已变更但尚未保存的 API、求职设置、HR 问答、飞书和托管配置表单。

`TRUSTEESHIP_GET_STATE` 是只读操作，不会再次写 storage，因此不会形成变更监听循环。sidepanel 关闭后由浏览器自动释放监听；页面初始化仍主动读取一次完整状态。

### 联系流程反馈

后台每成功登记一个会话都会触发持久 storage 变化，侧栏可在任务仍运行时逐步显示新卡片。联系完成时无需额外刷新消息作为正确性的唯一依赖，但运行日志可以显示“已登记并加入 AI 托管列表”。

若联系成功但托管登记因元数据不可靠而失败：

- 本次联系结果保持成功；
- 不生成临时或未知身份的托管卡片；
- 运行日志显示“联系成功，托管登记失败，可打开会话后手动登记”；
- 后续 storage 订阅不会制造假登记。

## 错误处理

| 情况 | 行为 |
| --- | --- |
| 发送后短时未见 outgoing | `VERIFYING_SEND`，持续只读核验，不重发 |
| content script 短暂不可用 | 保持当前等待/核验状态，有界重试 |
| 登录失效 | 全局暂停并提示重新登录 |
| 平台阻止或验证码 | 全局暂停，不尝试绕过 |
| 目标会话无法唯一确认 | 单会话暂停，禁止发送 |
| 消息游标或方向无法确认 | 单会话暂停，禁止推进 baseline |
| AI/API 暂时失败且未产生外部写入 | 保持可恢复状态，下轮重试或进入人工确认 |
| 用户手动结束 | `DISABLED`，清理活动工作项 |

## UI

岗位卡状态文案：

- `WAITING_HR`：等待 HR
- `WAITING_REPLY_DUE`：已生成回复 · 预计 5 分钟内发送
- `SENDING`：正在发送
- `VERIFYING_SEND`：正在核验发送 · 持续监控
- `WAITING_CONFIRMATION`：等待确认
- `WAITING_AUTO_CLOSE`：已识别拒绝 · 等待礼貌结束
- `ENDED_UNMATCHED`：已结束－未匹配
- `DISABLED`：已手动结束

已登记岗位标题区域提供：

- “一键托管全部可用岗位”；
- “一键结束全部托管”；
- 批量操作后的启用、保持、跳过和失败统计。

顶部“正在托管 N 个岗位”包括 `WAITING_HR`、`WAITING_REPLY_DUE`、`CLASSIFYING`、`WAITING_CONFIRMATION`、`WAITING_AUTO_CLOSE`、`SENDING` 和 `VERIFYING_SEND`，不包括 `DISABLED`、`ENDED_UNMATCHED` 与 `PAUSED`。

## 数据与隐私

- 延迟对象只保存有界草稿、结构化分类摘要、事实 evidence ID、时间和指纹；
- 不新增 Cookie、Token、Webhook 或 API Key 日志；
- runtime 公共 DTO 逐字段投影新增状态，不自动暴露内部对象；
- 错误响应不包含原始页面 HTML、接口响应体或完整历史；
- 飞书仍只发送现有允许的有界正文和待确认信息。

## 测试

### Store

- 普通回复延迟对象只接受当前活动 incoming 指纹；
- 随机 `dueAt` 只生成一次并可跨 Worker 恢复；
- 新 incoming 原子取消旧延迟；
- 未到期不能创建发送意图；
- `SEND_RESULT_UNKNOWN` 转为 `VERIFYING_SEND` 而不是 `PAUSED`；
- 核验成功后普通回复回到 `WAITING_HR`；
- 核验成功后的明确拒绝进入 `ENDED_UNMATCHED`；
- 手动结束清理所有活动工作项且不重放意图。

### Engine

- 普通低风险消息创建延迟而不立即发送；
- 到期前周期只读、不重复调用 AI、不发送；
- 到期后先重读并重新授权；
- 延迟期间新消息替换旧草稿；
- 静默结束加 30～300 秒延迟；
- 未知发送继续监控并自动对账；
- 对账期间新 incoming 不丢失；
- 多轮 HR 对话能完成两次独立回复；
- 明确拒绝只结束一次。

### Runtime 与 alarm

- 最近 `dueAt` 创建单一 `boss-ai-chat-due`；
- 更早任务覆盖旧 one-shot alarm；
- 删除最后一个延迟任务会清除 due alarm；
- 周期 alarm 与 due alarm 共用 FIFO；
- Worker 恢复重新建立最近到期 alarm；
- global disabled/paused 清除两个 alarm。
- 批量启用只调用一个 runtime 协议并返回确定性统计；
- 批量启用跳过 `ENDED_UNMATCHED`、`PAUSED` 和全部活动工作状态；
- 批量结束保留未知发送意图的不可重放终态。

### Content handler

- 发送后历史延迟出现 outgoing 时，有界轮询确认成功；
- 轮询只读且 Enter/click 恰好一次；
- 目标变化时停止核验并返回未知；
- 十秒内无证据返回未知但不触发第二次发送。

### UI

- `VERIFYING_SEND` 显示为持续监控而非暂停；
- 提供打开会话、确认已发送和手动结束；
- 活跃托管计数包含可恢复等待状态；
- 延迟状态显示预计范围，不承诺精确秒级发送。
- “一键托管全部可用岗位”不会重新开启 `ENDED_UNMATCHED`；
- 批量结果显示启用、保持、跳过和失败数量；
- background 连续登记多个岗位时，storage 变化被合并为有界刷新；
- 登记刷新后列表出现新卡片，正在编辑的未保存配置不被覆盖；
- storage 新值不能绕过 `TRUSTEESHIP_GET_STATE` 的安全 DTO 投影。

### 回归

- 现有薪资、面试、到岗等硬风险仍进入人工确认；
- 日限只约束普通自动回复；
- 静默时段不产生 Boss 写入；
- 明确拒绝仍完全依赖现有 AI 结构化分类与确定性授权门；
- 旧 `SEND_RESULT_UNKNOWN/PAUSED` 数据迁移为 `VERIFYING_SEND` 时仍保留不可重放意图。

## 验收标准

1. 真实 HR 消息被检测后，普通低风险回复不会早于持久 `dueAt` 发送。
2. 浏览器后台 Worker 休眠并恢复后，延迟任务仍只执行一次。
3. 发送成功但历史回执延迟时，会话不进入暂停；下轮能自动核验并继续处理 HR 后续消息。
4. 同一会话完成至少两轮“HR 消息 → 延迟 AI 回复 → 继续等待 HR”。
5. HR 明确拒绝后只发送一次礼貌结束语并停止该会话。
6. 用户手动结束后不再读取或发送该会话。
7. 任意发送意图在未知状态下都不会被自动重放。
8. 一键托管只启用可安全恢复岗位，明确拒绝、暂停和活动工作状态全部跳过。
9. 审核页每次联系成功登记后，AI 托管列表无需刷新页面即可自动出现新岗位。
10. 聚焦测试与全量 `npm test` 通过，README、`docs/08-boss-ai-trusteeship.md` 和 `docs/oss-notes.md` 同步更新。
