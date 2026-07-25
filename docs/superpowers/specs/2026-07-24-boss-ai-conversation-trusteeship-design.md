# Boss AI 对话托管功能设计

> 状态：开发完成，自动化与本地 VM 验收通过；待无外部写入 Chrome 验收和分阶段实号验收  
> 日期：2026-07-24  
> 适用产品：求职联系助手 Chrome 扩展  
> 目标版本：Phase 1（本地定时监控 + 飞书通知 + 插件内确认）

## 1. 背景与目标

用户通过插件主动联系选中的 Boss 直聘岗位后，HR 可能立即回复，也可能数小时或数天后回复。用户无法持续盯住聊天页面，容易错过沟通窗口。

本功能为用户明确托管的岗位提供有限自动对话能力：

1. Chrome 运行且 Boss 登录有效时，定时检查托管会话的新消息。
2. 对低风险、答案有明确依据的问题自动回复。
3. 对薪资、面试、到岗等重要问题暂停自动回复。
4. 通过用户自己的飞书群机器人发送待确认通知。
5. 用户回到插件查看上下文、修改草稿并确认发送。

该功能不是无人值守聊天机器人，不接管用户的全部 Boss 会话，也不保证规避平台限权或封号。

## 2. 已确认的产品决策

| 议题 | 决策 |
|---|---|
| 自动化等级 | 方案 B：普通问题自动回复，重要问题人工确认 |
| 运行边界 | 仅在电脑和 Chrome 运行、Boss 登录有效时监控 |
| 监控方式 | 方案一：低频定时轮询 |
| 检查间隔 | 用户可选 5 / 10 / 15 分钟，默认 10 分钟 |
| 托管范围 | 仅插件发起联系、且用户明确开启托管的岗位 |
| 通知渠道 | 用户自行配置飞书群机器人 Webhook |
| 飞书职责 | 只负责通知；确认、修改和发送在插件内完成 |
| 默认状态 | 全局开关关闭，单会话开关关闭 |
| 真实发送 | 发送前再次验证目标会话；不确定时失败关闭 |

## 3. 非目标

Phase 1 不实现：

- 浏览器关闭或电脑休眠后的云端全天监控。
- 保存或托管用户的 Boss Cookie、登录凭证。
- 接管插件外建立的历史会话。
- 在飞书卡片内直接批准或发送 Boss 回复。
- 自动处理薪资、面试、到岗、联系方式、Offer 等重要决策。
- 图片、附件、语音的自动理解和自动回复。
- 验证码破解、风控绕过、指纹伪造或发送结果未知后的自动重试。

## 4. 用户开关与状态

### 4.1 全局开关

设置项名称：`AI 对话托管`

- 默认关闭。
- 关闭时不创建检查任务，不读取目标聊天正文，不调用 AI，不发送飞书通知。
- 开启前必须满足：
  - 已配置可用的 AI Provider 和 API Key；
  - 已填写可供回答问题的简历文字；
  - 已配置飞书 Webhook；
  - 飞书测试通知成功；
  - 用户确认平台限权风险提示。
- 总开关关闭后，取消定时检查并暂停所有会话，但保留各会话的托管选择和待办。
- 再次开启时先执行补查并展示恢复摘要，不立即重放或发送历史草稿。

### 4.2 单会话开关

设置项名称：`托管此岗位`

- 仅对插件成功建立联系且能记录可靠 Boss 会话标识的岗位显示。
- 默认关闭，必须由用户逐个开启。
- 关闭后立即停止该会话的检查与自动回复。
- 无法通过会话标识直接定位时，拒绝开启托管。
- 不以扫描整个聊天列表作为目标定位兜底。

### 4.3 状态展示

顶栏显示以下一种状态：

- `托管已关闭`
- `正在托管 N 个岗位`
- `等待确认 N 条`
- `托管已暂停`

每个托管岗位显示：

- 当前聊天阶段；
- 最后检查时间；
- 最后一条新消息时间；
- 当前动作：等待 HR / 已自动回复 / 等待确认 / 已暂停；
- 暂停原因或待确认原因。

## 5. 对话状态机

```text
DISABLED
  └─ 用户开启单会话托管 → WAITING_HR

WAITING_HR
  ├─ 无新消息 → WAITING_HR
  ├─ 收到新消息 → CLASSIFYING
  └─ 登录/目标异常 → PAUSED

CLASSIFYING
  ├─ 低风险且有依据 → DRAFTING_AUTO
  ├─ 重要/不确定 → WAITING_CONFIRMATION
  └─ AI失败 → WAITING_CONFIRMATION

DRAFTING_AUTO
  ├─ 策略复核通过 → SENDING
  └─ 策略复核失败 → WAITING_CONFIRMATION

SENDING
  ├─ 发送证据明确 → WAITING_HR
  ├─ 发送结果未知 → PAUSED
  └─ 目标不确定 → PAUSED

WAITING_CONFIRMATION
  ├─ 用户确认发送 → SENDING
  ├─ 用户不回复 → WAITING_HR
  ├─ 用户关闭托管 → DISABLED
  └─ 收到更多消息 → 合并到当前待办

PAUSED
  ├─ 用户处理并恢复 → WAITING_HR
  └─ 用户关闭托管 → DISABLED
```

进入 `CLASSIFYING` 时必须原子保存上一可靠 `classificationBaseline` 和来源状态
`classificationOriginState`（仅 `WAITING_HR` / `WAITING_CONFIRMATION`）。新 Worker 只有在
baseline、来源状态、活动指纹、当前游标、去重窗口及活动待办全部一致时才允许回滚并重做分类；
空字符串 baseline 合法。legacy、字段损坏或任一证据矛盾都进入
`PAUSED/RECOVERY_STATE_UNCERTAIN`，保留原游标与去重证据，禁止页面读取、AI、通知和发送，
由用户人工核对后恢复。

任何 `sendIntent.status === SENDING` 的持久快照都先于上述分类证据判断收束为
`PAUSED/SEND_RESULT_UNKNOWN`；关联 intent/approval 同步进入未知终态，AUTO 额度恰好消费一次，
清理分类恢复元数据且绝不重放。首次终态持久化失败时不取得恢复所有权，下一次读取必须重试。

同一会话始终串行处理，同时最多存在一个活动待办。恢复 `WAITING_CONFIRMATION`、通知
reservation 和最终外发都必须证明：owner 已启用、未暂停、仍为 `WAITING_CONFIRMATION`，
`pendingApprovalId` 精确链接当前 approval，且同会话恰好一个 `PENDING`。孤儿、错链或重复
PENDING 一律失败关闭且不通知。

## 6. 自动回复策略

### 6.1 允许自动回复

只有同时满足以下条件才允许自动发送：

1. 会话属于已登记、已开启托管的岗位。
2. HR 消息属于已批准的低风险类型。
3. 答案能从用户简历或明确配置中找到。
4. AI 分类置信度不低于 `0.85`；低于门槛一律转人工确认。
5. 消息不包含任何重要决策或承诺。
6. 当前会话没有未完成的人工确认任务。
7. 当日自动回复数量未达到上限。
8. 发送前目标会话复核通过。

Phase 1 低风险范围：

- 是否仍在看机会；
- 是否方便发送简历；
- 基础礼貌回应；
- 请稍等、稍后回复；
- 对简历中明确事实的直接复述。

### 6.2 必须人工确认

以下任一条件成立时，禁止自动发送：

- 薪资、期望薪资或待遇谈判；
- 面试时间、地点、方式或改期；
- 到岗时间、在职状态的具体承诺；
- 离职原因；
- 工作经历、项目经历的补充或扩展；
- 微信、电话、身份证等个人信息；
- 测评、作业、Offer 或任何形式的承诺；
- 图片、附件、语音；
- 一条消息同时包含普通问题和重要问题；
- AI 无法从用户资料中找到可靠答案；
- 消息含义、顺序、目标会话或发送结果不确定。

### 6.3 数量限制

- 自动回复独立日限：默认 10 条。
- 用户可在 1–20 条之间调整，产品硬上限为 20 条。
- 达到上限后，新消息全部进入人工确认。
- 同一 HR 消息通过稳定消息指纹只处理一次。

## 7. 定时监控设计

### 7.1 调度

- 使用 `chrome.alarms`，不用可能随 Service Worker 终止而丢失的 `setInterval`。
- 用户可选择 5 / 10 / 15 分钟，默认 10 分钟。
- 扩展启动时检查并恢复缺失的 alarm。
- 每轮最多检查 10 个托管会话，超出部分使用轮转游标顺延到下一轮。
- Chrome 或设备休眠期间不执行；恢复后补查，不补跑错过的每个定时点。

### 7.2 页面使用

- 优先复用不处于用户活动状态的 Boss 标签页。
- 不导航或改写用户当前正在操作的活动标签页。
- 没有可用页面时，可创建 `active: false` 的临时 Boss 聊天标签页，检查结束后关闭。
- 页面出现登录、验证码、操作频繁或选择器失效时立即停止本轮。
- 只通过已记录的会话标识直达托管目标。

### 7.3 隐私边界

- 其他会话内容不进入 AI、不写入存储、不发送飞书。
- 若 Boss 页面结构导致必须扫描全部会话正文才能定位目标，本轮失败关闭。
- 目标会话只保留生成回复所需的有界上下文。
- 默认最多保留最近 20 条目标会话文本；关闭托管或重置会话时删除。
- 飞书只发送固定提示、稳定枚举和公司/岗位/HR 等安全元数据；完整上下文、模型草稿和待补字段留在本机。

## 8. 飞书通知

### 8.1 用户配置

设置区名称：`飞书通知`

字段：

- 启用飞书通知；
- Webhook 地址；
- 签名密钥；
- 发送测试通知；
- 通知静默时段。

约束：

- 建议用户创建只有本人参与的私人群。
- Webhook 和签名密钥保存在 `chrome.storage.local`，界面默认遮罩。
- 两项凭证不得进入运行日志、错误详情、AI请求或导出文件。
- Chrome 扩展本地存储不等同于操作系统密钥链；设置页必须明确这一限制。

### 8.2 待确认卡片

卡片包含：

- 公司、岗位、HR；
- 固定枚举的当前阶段；
- 固定提示“HR 有新消息，请在插件内查看完整上下文”；
- 固定等待状态；
- `打开 Boss 处理`按钮。

卡片不得包含 HR 原始聊天、模型 `draft`、模型 `fieldsNeeded`、任意 reason 自由文本或任意
wait 自由文本；builder 也必须使用 allowlist 防御调用方误传。Phase 1 的飞书自定义机器人只
负责通知。按钮打开 Boss 聊天页面；用户随后通过扩展入口进入“待确认”页。插件中的待办是唯一
事实来源，不能以飞书卡片是否送达作为任务状态。

自动待办通知的 client 必须先完成时钟读取、签名、卡片凭证回扫和请求序列化，只产出一个
同步 fetch dispatch thunk。runtime 在拿到 thunk 后重新读取持久快照，复核全局开关/暂停、
静默时段、飞书开关、owner 会话状态、精确 approval link 和同会话唯一 PENDING，随后在
同一同步调用栈调用 thunk。最终复核与 `fetchFn` invocation 之间不得有 `await`。
background 包装层必须在入口只校验 API proof；runtime 取得最新持久快照后，包装层必须
先同步复核同一 API-proof lease，再把同一快照传给 engine 的 owner/link/唯一 PENDING/
global/quiet/Feishu 断言。不得替换调用方断言，也不得用没有快照的入口调用 owner 断言。
`notifyApproval` 与 `notifyResolved` 都遵守这一组合规则；非函数调用方断言按未提供处理。
显式飞书测试不带 dispatch hook，仍保持用户点击后直接发送一次。

### 8.3 通知去重与失败

- 同一待办只发送一次首次通知。
- 等待确认期间收到后续消息时更新本地待办；下一轮最多发送一条合并提醒。
- 通知静默时段内继续收集目标消息，但不自动回复、不发送飞书；静默结束后生成一条合并待办通知。
- 飞书失败后最多补发一次。
- 补发仍失败时保留本地红色待办角标，不阻塞用户手动处理。
- 处理完成后补发“已处理”通知；Phase 1 不要求更新原卡片。
- `RESERVE` 与最终 egress 前都重验 owner、精确链接和同会话唯一 PENDING；notifier 内部
  `await store.getSnapshot()` 后必须同步断言通过，断言与 client 外发之间不得再有 `await`。

## 9. 人工确认流程

1. 用户从飞书通知获知待办。
2. 用户打开 Boss 页面和插件侧边栏。
3. 插件“待确认”页展示：
   - 目标身份；
   - 必要聊天上下文；
   - AI 分类结果与原因；
   - 需要补充的字段；
   - 可编辑回复草稿。
4. 用户选择：
   - 修改并确认发送；
   - 不回复；
   - 关闭该会话托管。
5. 确认发送前重新校验当前会话与岗位、公司、HR。
6. 发送成功后记录证据并恢复等待 HR 状态。
7. 结果未知时暂停会话，不自动重试。

## 10. 技术组件

| 组件 | 职责 |
|---|---|
| `ConversationRegistry` | 保存插件建联结果与可靠会话标识 |
| `MonitorScheduler` | 管理 alarm、轮转游标和本轮检查预算 |
| `MessageCollector` | 读取目标会话增量消息 |
| `ConversationStateMachine` | 保证每个会话串行和状态合法 |
| `ReplyPolicy` | 低风险白名单、重要问题规则、置信度与日限 |
| `ReplyGenerator` | 使用简历、JD和目标上下文生成草稿 |
| `PendingApprovalStore` | 持久化人工确认任务 |
| `FeishuNotifier` | 签名、通知、去重、一次补发 |
| `SafeSender` | 复用目标会话校验和单次发送证据 |
| `TrusteeshipController` | 全局开关、暂停、恢复和结构化错误 |

模块之间使用普通数据对象通信。页面 DOM 解析与策略判断分离，便于用固定页面样本测试而不访问真实 Boss。

## 11. 建议存储模型

```text
conversationTrusteeship: {
  enabled: boolean,
  intervalMinutes: 5 | 10 | 15,
  dailyAutoReplyLimit: number,
  autoReplyDay: YYYY-MM-DD,
  autoReplyCount: number,
  quietHours: { enabled, start, end },
  monitorCursor: number,
  paused: boolean,
  pauseCode: string,
  pauseReason: "" | "SEND_RESULT_UNKNOWN"
}

feishuNotification: {
  enabled: boolean,
  webhook: string,
  signingSecret: string,
  lastTestAt: number,
  lastTestOk: boolean
}

managedConversations: {
  [conversationId]: {
    jobId,
    platform: "boss",
    company,
    position,
    hrName,
    enabled,
    state,
    lastCheckedAt,
    lastIncomingFingerprint,
    recentMessages[],
    pendingApprovalId,
    pauseCode,
    pauseReason
  }
}

pendingApprovals: {
  [approvalId]: {
    conversationId,
    incomingFingerprint,
    stage,
    reasonCode,
    fieldsNeeded[],
    draft,
    status,
    createdAt,
    updatedAt,
    feishuNotifyAttempts
  }
}
```

全局和逐会话 `pauseCode` 只允许固定公开代码；store 归一化与 runtime DTO 必须分别执行
allowlist。未知/损坏持久值统一映射为 `UNKNOWN_PROCESSING_FAILURE`，UI 显示稳定人工核对文案，
不得原样返回 provider、页面或凭证形态文本。所有 complete、unknown、pause、checkpoint、
NO_REPLY、disable、reset、enable 路径统一清理 `activeFingerprint`、
`classificationBaseline`、`classificationOriginState`。

不得存储 Boss Cookie、密码、验证码或完整账户凭证。

## 12. 错误与停机规则

### 全局暂停

- Boss 登录失效；
- 出现验证码、人机验证或操作频繁；
- 全局配置损坏；
- 监控选择器整体失效；
- 连续多轮无法安全定位任何托管会话。

### 单会话暂停

- 目标身份无法匹配；
- 消息顺序不确定；
- 发送结果未知；
- 同一消息出现冲突处理记录；
- 会话被删除或岗位信息无法对应。

### 降级为人工确认

- AI 请求失败；
- AI 输出解析失败；
- 分类置信度不足；
- 答案证据不足；
- 自动回复达到日限；
- 消息包含未知内容类型。

所有暂停都必须显示稳定错误代码、原因和下一步操作。持久 `pauseReason` 只有未知发送可以
固定为 `SEND_RESULT_UNKNOWN`，其他 raw/legacy 值一律清空。`TRUSTEESHIP_GET_STATE`
必须逐字段重建 settings 及 quietHours 公共 DTO，不能整体 clone 持久对象。禁止无提示自动恢复发送。

## 13. 安全与合规

- Boss 用户协议限制未经许可的第三方工具和非真实用户程序；本功能不能消除账号限权风险。
- 用户必须在首次开启时确认风险提示。
- 不提供验证码破解、规避检测或突破平台限制的能力。
- AI 输出不得捏造简历事实。
- 简历、JD和聊天上下文只发送给用户配置的 AI Provider。
- 飞书通知只发送固定模板、稳定枚举和安全岗位元数据，避免在群聊泄露完整求职沟通。
- 飞书待确认通知不发送任何 HR 原始聊天片段或由其驱动的模型自由文本（包括 `draft` /
  `fieldsNeeded`）；只发送固定提示“HR 有新消息，请在插件内查看完整上下文”，完整有界上下文
  和模型输出只留在插件本地待办。
- 飞书签名与序列化不能拥有最终网络 dispatch；自动通知的实际 fetch 只能由 runtime 在签名后
  完成最新持久状态复核，并在无 await 的同一同步栈中触发。
- 公共 settings/pause DTO 必须逐字段 allowlist；未知 pauseCode 映射固定 fallback，raw
  pauseReason 和未来新增的内部存储字段不得自动外溢。
- 所有外部写入使用一次性动作和幂等记录；结果未知时不重放。

## 14. 测试与验收

### 14.1 自动测试

- 全局开关默认关闭，关闭时不存在 alarm 和页面访问。
- 未登记会话、未开启单会话开关时不能读取或发送。
- 5 / 10 / 15 分钟配置与 alarm 恢复。
- 每轮 10 个会话预算和轮转公平性。
- 状态机合法转换与非法转换拒绝。
- 低风险白名单和重要问题硬拦。
- 混合问题、附件、语音全部进入人工确认。
- 自动回复日限和跨日重置。
- 新消息指纹去重。
- 同一会话串行处理。
- 待确认期间后续消息合并。
- 飞书签名、测试通知、通知去重和一次补发。
- 飞书签名 await 期间 owner 暂停、断链、第二 PENDING、全局/飞书关闭或进入静默均不得 fetch；
  owner 不变时签名请求只 fetch 一次。
- 真实 `background.js` VM 必须执行 actual store → actual engine → protected notifier →
  actual runtime notifier → actual Feishu client 组合；六类 owner 变化 fetch 为 0，正常路径为 1，
  API proof 轮换仍为 0，并覆盖 resolved 通知断言透传。
- raw pauseReason、未知/内部 settings 字段不进入 `TRUSTEESHIP_GET_STATE`，未知发送 reason
  仍固定为 `SEND_RESULT_UNKNOWN`。
- 目标身份不确定、发送未知、登录失效、验证码时失败关闭。
- Service Worker 中断后从持久状态恢复但不重放发送。
- Webhook、签名密钥和聊天原文不进入日志。

### 14.2 页面样本测试

- 使用脱敏的 Boss 聊天 DOM fixture 验证目标会话定位与消息解析。
- 页面结构变化时返回 `SELECTOR_UNAVAILABLE`，不得回落到宽泛选择器发送。
- 模拟未读消息、连续消息、撤回、时间分隔和发送气泡。

### 14.3 真实账号验收

分阶段执行：

1. 只读检查：验证定时唤醒、目标直达、新消息去重和飞书通知。
2. 人工确认发送：使用测试岗位和明确授权，只发送一条。
3. 低风险自动回复：单会话、日限 1 条、人工现场观察。
4. 验证码、登录失效、页面变化：确认立即停机。

未经单独明确授权，不执行真实 Boss 回复，也不宣称真实自动发送验收通过。

## 15. 发布验收标准

只有同时满足以下条件才能向普通用户开放：

1. 全局和单会话开关均默认关闭。
2. 所有自动与页面样本测试通过。
3. 飞书测试通知成功后才能开启托管。
4. 真实账号只读监控至少连续运行一个完整工作日，无重复待办。
5. 真实发送完成单会话、单消息验收，无错发和重复发送。
6. 所有异常路径均能失败关闭并提供恢复指引。
7. README、隐私说明、风险说明和用户手册同步更新。

## 16. 参考资料

- [BOSS直聘用户协议](https://www.zhipin.com/web/common/protocol/protocol-2019-09-30.html)
- [Chrome Extension Service Worker 生命周期](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)
- [Chrome Alarms API](https://developer.chrome.com/docs/extensions/reference/api/alarms)
- [飞书应用类型与机器人能力](https://open.feishu.cn/document/platform-overveiw/overview)
- [feishu-webhook-sdk](https://github.com/jz0ojiang/feishu-webhook-sdk)
- [GeekGeekRun](https://github.com/geekgeekrun/geekgeekrun)
