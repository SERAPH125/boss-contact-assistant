# Boss AI 对话托管

## 已批准范围与非目标

本功能仅为插件已经成功联系、且用户逐会话明确开启的 Boss 直聘岗位会话提供低频本地监控、低风险 AI 回复与人工确认。Chrome 和有效 Boss 登录态必须保持可用。

不扫描全部 Boss 会话，不保证规避平台限制或账号风险；不做验证码破解、风控绕过、云端全天托管，也不存储 Boss Cookie、密码或验证码。

## 默认安全边界

- API 连通性测试结果与 `provider + API Key + baseUrl` 三元组及持久化 `apiConfigVersion` 绑定；其中任一项变化都会递增版本并立即清除旧成功状态，必须由相同版本的测试证明重新开启托管。旧用户缺少版本字段时安全兼容为版本 `0`。

- 全局 `AI 对话托管` 默认关闭。
- 每个岗位会话的 `托管此岗位` 默认关闭，必须由用户单独开启。
- Phase 1 运行时已经实现，但只有两个开关均显式开启、所有前置证明有效且没有暂停原因时才会监控或发送。真实 Boss 的 alarm、两个已登记会话只读历史读取和显式打开会话已验收；真实新来信后的 LLM 分类/草稿、Boss 发送和飞书外部链路仍未验收。

## 公共契约

| 类型 | 固定值 |
| --- | --- |
| 存储前缀 | `conversationTrusteeship`、`feishuNotification`、`managedConversations`、`pendingApprovals` |
| Chrome alarm | `boss-ai-chat-monitor` |
| 后台消息 | `TRUSTEESHIP_*` |
| 飞书主机权限 | `https://open.feishu.cn/*` |

`manifest.json` 仅新增 `alarms` 权限和飞书固定域名权限；没有新增常驻 `https://*/*` 主机权限。既有 `https://*/*` 仍是按需申请的 optional host permission，不改变其用途。

## 回复政策与确定性风险门

`src/conversation/trusteeship-policy.js` 是纯 UMD/CommonJS 策略模块；它不调用 AI、Chrome、Boss 或飞书。调用方必须先传入消息的确定性风险结果，`decide` 不修改任何输入，并始终返回稳定的 `reasonCode`。

- 托管及静默开关默认关闭；检查间隔只接受 5、10、15 分钟，默认 10 分钟。
- 自动回复日限默认 10，所有配置和决策都硬裁剪为 1–20。
- 只有全局 `settings.enabled === true` 且会话 `conversationEnabled === true`，才可能返回 `AUTO_REPLY`；任一条件为 `false` 或缺失均进入人工确认。AI 置信度、依据、类别、待办、日限和静默检查不构成对这两个显式授权门的替代。
- 在双开关已开启的前提下，只有 `still_looking`、`resume_permission`、`courtesy`、`please_wait`、`resume_fact` 五类，且 AI 置信度 `>= 0.85`、有非空简历/明确配置依据、无待确认任务、未到日限、非静默时段时，才返回 `AUTO_REPLY`。
- `explicit_rejection` 是独立结束动作，不进入普通自动回复白名单。只有 AI 同时给出 `confidence >= 0.90`、`reasonCode=EXPLICIT_REJECTION`、空 `evidenceIds` 和空 `fieldsNeeded`，且全局/单会话开启、没有活动待办时，策略才返回 `AUTO_CLOSE`；静默时段返回 `DEFER_AUTO_CLOSE`。该动作不回答原问题，所以不受原消息中的普通硬风险词或每日自动回复额度阻挡。这里没有读取 HR 正文的拒绝关键词或正则。
- `validateAutoCloseDraft` 只校验 AI 已生成的外发结束语：去首尾空白后必须为 1–45 个 Unicode code points、单行、礼貌且不含问题、列表、继续争取、经历推销或薪资/面试/到岗承诺。校验器不读取 HR 正文，也不参与判断是否属于明确拒绝。
- 薪资、面试、到岗、离职原因、联系方式、经历补充、测评/作业/Offer/承诺均由文本规则先拦截；例如 `月薪`、`年薪`、`笔试`、`机试`、`测试题`、`工作经验`、`项目经验`。图片、附件、语音及任何非 `text` 类型也一律人工确认。AI 结果不能覆盖这些结论。
- 英文薪资只匹配明确短语 `salary package` 和 `compensation package`；单独的 `package`（例如 `package manager`）不视为薪资风险。

| 情形 | 稳定错误码 |
| --- | --- |
| 无风险文本 | `NO_HARD_RISK` |
| 薪资 / 面试 / 到岗 / 离职 / 联系方式 | `HARD_RISK_SALARY` / `HARD_RISK_INTERVIEW` / `HARD_RISK_ARRIVAL` / `HARD_RISK_RESIGNATION` / `HARD_RISK_CONTACT` |
| 经历补充 / 承诺类事项 | `HARD_RISK_EXPERIENCE` / `HARD_RISK_COMMITMENT` |
| 图片、附件、语音或未知消息类型 | `NON_TEXT_MESSAGE` |
| 全局托管关闭 / 会话未明确托管 | `TRUSTEESHIP_DISABLED` / `CONVERSATION_NOT_MANAGED` |
| 静默、已有待办、已达日限 | `QUIET_HOURS` / `PENDING_APPROVAL_EXISTS` / `DAILY_AUTO_REPLY_LIMIT_REACHED` |
| AI 不可用、类别非白名单、置信度不足、缺少依据 | `AI_UNAVAILABLE` / `CATEGORY_REQUIRES_CONFIRMATION` / `AI_CONFIDENCE_TOO_LOW` / `MISSING_RESUME_EVIDENCE` |
| 通过所有确定性门 | `AUTO_REPLY_ALLOWED` |
| 明确拒绝立即结束 / 静默延迟结束 | `EXPLICIT_REJECTION_AUTO_CLOSE` / `QUIET_HOURS_AUTO_CLOSE` |
| 结束语安全校验 | `AUTO_CLOSE_DRAFT_VALID` 或固定 `AUTO_CLOSE_DRAFT_*` 失败码 |

## AI 分类与草稿契约

`src/conversation/reply-ai.js` 是纯 UMD/CommonJS 提示词与 JSON 契约模块；它不调用 LLM、Chrome、Boss、飞书或网络，也不决定是否发送。`TrusteeshipPolicy` 的确定性风险门始终具有最高优先级：即使 AI 给出低风险结论，薪资、面试、到岗、离职、联系方式、经历扩展、测评/Offer/承诺等重要事项也绝不可自动批准。明确拒绝是否成立只由 AI 语义分类判断；这里没有 HR 正文关键词、正则或本地分类覆盖。

- `buildClassificationMessages(input)` 与 `buildDraftMessages(input)` 只读取并序列化目标岗位身份（公司、岗位、HR、岗位 ID）、最近 20 条目标会话消息（按原时间顺序，每条最多 600 字符）、最多 40 条编号简历事实（每条最多 600 字符），以及草稿阶段的有界分类摘要（类别、置信度、原因码）。它们不会整体序列化调用对象，因此 API Key、飞书 Webhook/签名和任意配置字段不能进入 AI 输入。
- 分类输出必须是且只能是一个 JSON 对象（可被一个完整的 `json` Markdown fence 包裹），字段严格为 `category`、`confidence`、`reasonCode`、`evidenceIds`、`fieldsNeeded`。类别仅允许 `still_looking`、`resume_permission`、`courtesy`、`please_wait`、`resume_fact`、`explicit_rejection`、`important`、`unknown`；置信度只能在 0–1；数组中的 ID/字段名必须为非空且不重复字符串。`resume_fact` 没有依据固定失败为 `AI_EVIDENCE_MISSING`。`explicit_rejection` 的提示词契约要求 `reasonCode=EXPLICIT_REJECTION`、空 `evidenceIds` 和空 `fieldsNeeded`；含糊拒绝仍归为 `important`。
- 草稿输出字段严格为 `draft` 和 `evidenceIds`。草稿必须是非空字符串，最多 300 个 Unicode code points；依据 ID 必须为非空、唯一字符串数组。仅当运行时把当前分类上下文明确传为 `explicit_rejection` 时，解析器允许空依据；其他类别继续固定失败为 `AI_EVIDENCE_MISSING`。该解析器只验证“模型声明了依据”，不会断言 ID 确实属于当前简历；成员关系和拒绝结束语的 45 字、安全文案约束仍必须由后续引擎与策略在发送门之前核验。
- 非 JSON、对象外的解释文字、数组、重复 JSON 键、未知/缺失字段、越界值和畸形数组全部失败关闭。异常以稳定 `error.code`（例如 `AI_OUTPUT_INVALID`、`AI_OUTPUT_DUPLICATE_KEY`、`AI_CLASSIFICATION_INVALID`、`AI_DRAFT_INVALID`、`AI_EVIDENCE_MISSING`）交给后台转人工确认；错误消息不包含原始模型输出。

当前 Task 3 验证：新增 `tests/reply-ai.test.js` 后先以缺少模块的 `MODULE_NOT_FOUND` 完成 TDD RED；实现后 `node --test tests/reply-ai.test.js` 为 9/9 通过，`npm test` 为 94/94 通过。审查修复另以“最早 20 条而非最近 20 条”的失败用例完成 RED，再以最新窗口实现完成 GREEN。

## 持久状态机与存储模型

`src/conversation/conversation-store.js` 是浏览器/Node 双环境 UMD/CommonJS 模块，只依赖注入的异步键值存储、时钟和 ID 生成器。它不调用 Chrome 页面、AI、Boss 或飞书。模块用 `WeakMap<storage, { queue, recoveryInitialized }>` 为同一 storage 对象共享 Promise 尾队列与恢复所有权；即使调用方创建多个 store 实例，公开读改写仍严格串行，且前序失败不会阻断后继操作。

模块只读写以下四个顶层存储键，不创建第五个发送队列键：

| 存储键 | 内容与边界 |
| --- | --- |
| `conversationTrusteeship` | 全局开关、检查间隔、自动回复日限、按本地日期归一化的日计数、静默时段、游标与全局暂停信息 |
| `feishuNotification` | 飞书开关、Webhook、签名密钥和最近测试结果；凭证只允许存在于此独立设置对象 |
| `managedConversations` | 已可靠登记的 Boss 会话、状态、最近消息、最近指纹、活动待办引用、可选的有界 `pendingAutoClose`，以及当前一个有界 `sendIntent` |
| `pendingApprovals` | 待办内容、状态、草稿和最多两次的安全通知结果；不保存原始通知错误或凭证 |

可靠会话引用必须同时满足：`platform === "boss"`、非空且不含空白的稳定 `conversationId`、非空 `jobId`，以及 HTTPS 的 `*.zhipin.com` 主机和精确 `/web/geek/chat` 或 `/web/geek/chat/` 路径；任何更深子路径都拒绝。新登记会话一律为 `enabled: false`、`DISABLED`；返回值和快照均为深拷贝，调用方修改返回对象不会反向修改存储。

```text
DISABLED
  └─ setManaged(true) → WAITING_HR

WAITING_HR / WAITING_CONFIRMATION
  └─ beginMessage(新指纹) → CLASSIFYING

CLASSIFYING
  ├─ createOrMergeApproval → WAITING_CONFIRMATION
  ├─ deferAutoClose → WAITING_AUTO_CLOSE
  └─ createAutoCloseIntent → SENDING

WAITING_AUTO_CLOSE
  ├─ cancelDeferredAutoClose(发现更新消息) → WAITING_HR
  └─ createAutoCloseIntent(静默结束且重读无更新) → SENDING

WAITING_CONFIRMATION
  ├─ 更多消息 → 合并进同一个活动待办
  └─ createSendIntent → SENDING

SENDING
  ├─ completeSend(明确证据) → WAITING_HR；仅 AUTO intent 原子增加当日计数
  ├─ completeSend(AUTO_CLOSE 明确证据) → ENDED_UNMATCHED；不增加当日计数
  └─ markSendUnknown / Worker 恢复 → PAUSED

ENDED_UNMATCHED
  └─ setManaged(true) → WAITING_HR（必须由用户显式重新托管）

PAUSED
  └─ resetConversation → WAITING_HR

任意启用状态
  └─ setManaged(false) → DISABLED
```

`beginMessage` 在持久化指纹和进入 `CLASSIFYING` 后才返回；它还原子保存上一可靠 `classificationBaseline` 和进入前的 `classificationOriginState`（只允许 `WAITING_HR` / `WAITING_CONFIRMATION`）。同一 storage 上即使多个 store 实例并发，竞态中也只有一个调用能成功。fresh Worker 会先检查任何会话态或 intent 态的 `SENDING`，并优先收束为 `SEND_RESULT_UNKNOWN`；只有不存在发送中断时，才允许进入 `CLASSIFYING` 恢复。证据一致的分类恢复还要求原始 baseline、来源状态、活动指纹、当前游标、去重窗口和活动待办全部一致；`WAITING_CONFIRMATION` 来源必须恰好存在一个同会话 `PENDING` 待办且 `pendingApprovalId` 精确链接它。空字符串 baseline 合法。legacy 缺字段、字段损坏、活动指纹矛盾、缺链/错链或重复活动待办都会持久进入 `PAUSED/RECOVERY_STATE_UNCERTAIN`，保留原 `lastIncomingFingerprint` 与有界去重证据，禁止读页、AI、通知和发送。恢复写失败不会取得恢复所有权，下一次读取会重试。

同一会话最多保留最近 20 条目标消息和 20 个去重指纹，后到消息按原顺序合入同一个活动待办，超过上限只保留最新 20 条。合并前会重新验证 `pendingApprovalId` 必须指向同会话的 `PENDING` 待办；若旧数据已有重复活动待办，按 `createdAt`、再按 `approvalId` 确定性保留最旧项，其余写为 `CANCELLED_DUPLICATE`，绝不跨会话合并。关闭托管或重置会话不会信任 `pendingApprovalId`：它会清除链接，并只按 `conversationId` 确定性关闭真正属于目标会话的活动待办，外会话待办保持不变。已经见过的指纹继续保留在有界去重窗口中，避免重置后立即重放。approval、intent、terminal、disable、checkpoint、pause 与 reset 路径都会清理两项分类恢复元数据。

## 两阶段发送与恢复语义

用户确认待办后，`createSendIntent` 先把唯一 `intentId`、`mode: "MANUAL"`、`approvalId`、冻结草稿和 `SENDING` 状态原子写入对应会话的 `sendIntent`，调用方随后才能执行外部发送。引擎通过 `createAutoSendIntent(conversationId, fingerprint, draft)` 只允许当前 `CLASSIFYING` 的活动指纹创建 `mode: "AUTO"` 意图；同一原子读改写还会重验全局已启用、未暂停，并以 `autoReplyCount + 所有 SENDING AUTO 预留数` 对比日限。共享同一 storage 的多个 store/engine 实例因此不能越过日限或在运行中暂停后继续发送。

明确拒绝使用独立 `mode: "AUTO_CLOSE"`：`deferAutoClose` 只接受当前 `CLASSIFYING` 活动指纹，并原子持久化 45 code-points 内的冻结结束语、置信度与创建时间；`cancelDeferredAutoClose` 只接受同一精确指纹。`createAutoCloseIntent` 可从同一 `CLASSIFYING` 指纹或完整的 `WAITING_AUTO_CLOSE` 缓存创建，但延迟路径还要求草稿逐字一致。三个入口都会重验全局/单会话授权、活动待办和发送中意图；它们不读取或预留普通自动回复额度。

仍为 `SENDING` 的旧意图不能覆盖，已终态意图可由后续新指纹替换。`completeSend` 的终态证据必须同时满足 `success === true`、`targetConversationId` 精确匹配当前会话、`sentFingerprint` 非空且 `observedAt` 是正有限数；`ok: false`、空证据或目标不匹配均拒绝，并保持意图与待办在 `SENDING`。同一意图一旦进入 `SENT` 或 `SEND_RESULT_UNKNOWN` 就不能再次消费；AUTO 的成功与未知结果都各自在终态持久写中消耗一次当日额度，MANUAL 与 AUTO_CLOSE 不增加。AUTO_CLOSE 成功后会话写为 `enabled=false / ENDED_UNMATCHED`，清除活动待办、延迟结束和分类恢复元数据，保留 `AUTO_CLOSE/SENT` 意图作为不可重放证据。只有用户再次执行 `setManaged(true)` 才回到 `WAITING_HR`。

Task 6 为状态机补充受限转换 API，而没有新增顶层存储键或通用更新方法：

- `markConversationChecked(conversationId, { baseline })` 只在本轮读取批次全部处理完毕、且会话处于 `WAITING_HR` 或 `WAITING_CONFIRMATION` 时，使用 store 时钟写入 `lastCheckedAt` 和字符串基线；调用方附加字段不会落盘。
- `pauseConversation(conversationId, code)` 只接受 `TARGET_UNCERTAIN`、`SELECTOR_UNAVAILABLE`、`SEND_RESULT_UNKNOWN`、`MESSAGE_ORDER_UNCERTAIN`、`CONVERSATION_UNAVAILABLE`、`RECOVERY_STATE_UNCERTAIN`，写入固定码并清空原始原因。
- `resolveApprovalWithoutSend(approvalId)` 只消费当前活动的 `PENDING` 待办，将其置为终态 `NO_REPLY`、清除会话链接，并回到 `WAITING_HR` 或 `DISABLED`。
- `recordNotificationAttempt(approvalId, operation)` 是唯一公开通知转换入口，只接受 `RESERVE`、`COMPLETE`、`CANCEL` 三个 phase；不再公开独立 reserve/complete 方法，也不接受旧版单阶段结果。
- AUTO / AUTO_CLOSE / MANUAL 的模式随 intent 持久化；损坏或旧版无模式意图按 MANUAL 归一化，避免历史人工发送错误增加自动计数。

store 的公开方法预算固定为 22 个：`getSnapshot`、`saveSettings`、`registerConversation`、`setManaged`、`beginMessage`、`createOrMergeApproval`、`createLiveDrillApproval`、`createSendIntent`、`createAutoSendIntent`、`deferAutoClose`、`cancelDeferredAutoClose`、`createAutoCloseIntent`、`completeSend`、`markSendUnknown`、`markConversationChecked`、`pauseConversation`、`recordReadFailure`、`acknowledgeUnknownSend`、`resolveApprovalWithoutSend`、`recordNotificationAttempt`、`resetConversation`、`removeConversation`。

Manifest V3 Service Worker 可能在发送请求与响应之间终止。恢复所有权属于当前加载的模块/Worker，而不是某个 store 实例：同一模块和 storage 上创建第二个 store 时不得把仍在执行的 `SENDING` 误判为中断；只有全新模块加载（即新 Worker）首次读取持久状态时，如发现会话或意图仍为 `SENDING`，才原地改写为下列终态。该分支优先于同一损坏快照上的 `CLASSIFYING` 恢复，不能回退到重新分类：

```text
conversation.state = PAUSED
conversation.pauseCode = SEND_RESULT_UNKNOWN
sendIntent.status = SEND_RESULT_UNKNOWN
approval.status = SEND_RESULT_UNKNOWN
```

恢复写入成功后才把该模块中对应 storage 的 `recoveryInitialized` 标为完成；若第一次 `storage.set` 短暂失败，下一次调用会再次执行恢复。若肯定发送后的 `completeSend` 落盘失败，紧接着 `markSendUnknown` 也落盘失败，store 会重新置空恢复所有权；引擎最多触发一次有界 `getSnapshot`，使同模块下一次读取立即把仍持久化的 `SENDING` 收束为 `PAUSED / SEND_RESULT_UNKNOWN`。AUTO 额度只消耗一次，AUTO_CLOSE 在成功、未知结果、禁用/重置或 fresh Worker 恢复中都不消耗额度，任何模式都不会重发。普通同日 `getSnapshot` 不写 storage，只有实际的未知发送恢复或跨日计数归一化才在读取路径持久化。

该意图永久不可重放，只能由用户核对 Boss 实际消息后重置会话。未知发送的意图原因、会话 `pauseCode` 和 `pauseReason` 固定为 `SEND_RESULT_UNKNOWN`，忽略调用方原始错误文本；其他持久 `pauseReason` 一律归一化为空。AUTO 额度在成功或未知终态中都只消费一次，即使首次恢复写失败后重试也不会重复增加。在 `SENDING` 期间禁用或重置也必须真实持久化这个固定值。飞书待办通知通过单一 `recordNotificationAttempt` 执行 `RESERVE → 外部通知 → COMPLETE`：`RESERVE` 在同一原子读改写中重验最新全局 enabled、paused、store 时钟、静默时段，以及 owner 会话仍启用、仍为 `WAITING_CONFIRMATION`、精确链接该待办且同会话恰好只有一个 `PENDING`。多 engine 并发只有一个能取得预留。引擎在预留后重读快照；Feishu client 完成时钟、签名、卡片回扫和请求序列化后只生成一个同步 fetch thunk，不直接出站。runtime 随后再次异步读取最新快照；background 保护层在入口只验证 API proof，在 runtime 提供同一份最新快照时先同步复核该 proof lease，再同步调用 engine 传入的全局、静默、飞书、owner、link 与唯一待办断言，最后在同一调用栈调用 thunk。包装层不得以 API-proof 断言替换调用方断言，也不得用没有快照的入口调用 owner 断言；最终组合断言与 `fetchFn` invocation 之间没有 `await`。仅首次已经落盘的已知失败 `FAILED` 允许一次补发；首次成功、未知结果、仍在 `SENDING`、终结写失败或第二次尝试都永久阻止自动重试。未出站前若二次门禁不再允许，`CANCEL` 删除 reservation；若签名期间才失效，当前 reservation 收束为安全 `UNKNOWN` 并永久阻止自动重试。待办只记录预留 ID、状态、次数、时间和固定通知码；不记录 Webhook、签名密钥、Token、原始异常或响应体。

## 单轮监控引擎

`src/conversation/monitor-engine.js` 是零 Chrome、零 DOM、零网络的 UMD/CommonJS 编排模块。`MonitorEngine.create(deps)` 在创建时验证 store、Boss reader、分类/草稿器、飞书 notifier、确定性 policy 和 clock 的全部必需方法；真实页面、LLM 和飞书访问只能由后续后台组合层通过依赖注入提供。`runCycle()` 只返回：

```text
{ checked, newMessages, autoSent, pending, skipped, errors: [稳定错误码] }
```

其中不包含聊天原文、简历、Webhook、API Key、发送证据或原始异常。全局关闭或全局暂停时，不调用 reader、分类/草稿器、`getResumeFacts` 或 notifier。逐会话 `PAUSED`、`DISABLED`、`CLASSIFYING` 和 `SENDING` 也不会进入页面读取。

同一 `MonitorEngine` 实例的 `runCycle()` 和 `resolveApproval()` 共用一条操作队列，任何 reader、AI、notifier 或发送副作用都不会在该实例内交叠。单轮先对当前快照中已启用的 Boss 会话按 `conversationId` 稳定排序，再从持久化 `monitorCursor` 轮转选取最多 10 个；游标只按实际尝试的槽位推进，例如第一个槽位发现全局登录失效时只推进 1，而不是跳过整批 10 个。每个安全会话严格执行：

```text
读取并校验目标与增量批次
→ 持久化 beginMessage 指纹
→ 硬风险检测
→ AI 分类
→ 确定性策略决策
→ 可选草稿
→ 依据成员关系与策略二次复核
→ 持久 AUTO intent 或本地待办
→ 外部发送 / 待办通知
→ 明确证据终态与读取 checkpoint
```

reader 返回值始终视为不可信：成功结果必须包含 `conversationRef.conversationId` 和 `conversationRef.url`；ID 与 URL 必须分别精确等于持久值，URL 还必须是规范化的 HTTPS `*.zhipin.com/web/geek/chat` 单一会话查询。可选顶层 `conversationId` 以及任一层出现的 URL、岗位、公司、HR、平台等身份字段都必须逐项与持久值一致。最多 20 条消息必须是严格归一化 incoming；非空批次的 `baseline` 必须等于最后一条消息指纹，空批次则必须等于请求时会话的 `lastIncomingFingerprint`，否则在 AI、发送和 cursor checkpoint 前失败关闭。`TARGET_UNCERTAIN` 和 `SELECTOR_UNAVAILABLE` 只暂停对应会话；`LOGIN_REQUIRED` 和 `BOSS_BLOCKED` 全局暂停并停止读取后续会话，同轮也不发送历史待办通知。任一未列入 reader allowlist 的外部错误统一映射为 `CONVERSATION_UNAVAILABLE`；分类、草稿抛错分别固定为 `AI_CLASSIFY_FAILED`、`AI_DRAFT_FAILED`，store/notifier 的未知错误也只映射到固定码，原始 `error.code` 不进入快照、摘要或通知载荷。

可选的异步 `getResumeFacts()` 每轮最多调用一次。它的结果最多归一化为 100 条 `{ id, text, number }`，要求唯一非空 ID 和有界正文。可靠文本消息即使没有简历事实也仍会进入 AI 分类，以便 AI 能识别不需要简历依据的 `explicit_rejection`；其他分类和草稿继续要求非空 `evidenceIds`，且必须是本轮编号简历事实 ID 的子集。草稿最多 300 个 Unicode code points。硬风险、非文本、低置信度、AI/解析/依据失败、普通回复日限、普通回复静默、已有待办和未知内部失败都会先落本地待办，绝不自动发送；硬风险与非文本仍可保存一个经过相同依据校验的建议草稿。

明确拒绝已经接入生产监控编排：只有分类严格满足 `explicit_rejection / EXPLICIT_REJECTION / confidence >= 0.90 / 空 evidenceIds / 空 fieldsNeeded`，且 AI 结束语再通过 `validateAutoCloseDraft`，引擎才会在发送前重读最新快照、重算策略、原子创建 `AUTO_CLOSE` intent，再复用既有 sender 和肯定发送证据终结为 `ENDED_UNMATCHED`。非静默时段可即时执行；静默时段只持久化绑定当前 incoming 指纹的 `WAITING_AUTO_CLOSE`，零 Boss 写入、零飞书待办、零额度预留。静默内后续周期只重读和更新 checkpoint，不重复 AI 分类或草稿；静默结束后必须先重读，只有没有更新来信才使用冻结草稿创建 intent。若出现更新来信，旧延迟结束会先取消，再按新消息重新走分类与策略。成功只发送一次、不会增加普通自动回复计数，下一轮因会话已停用而不会再读；未知发送结果固定进入 `PAUSED / SEND_RESULT_UNKNOWN`，不得重放。AI 草稿失败、格式错误或结束语安全校验失败时只创建不含原始异常及不安全草稿的本地待办。

本地 `PENDING` 待办是通知事实源。只有非静默、全局未暂停、飞书已开启，且 owner 会话仍启用、处于 `WAITING_CONFIRMATION`、精确链接该待办、同会话恰好只有一个 `PENDING` 时才通知；通知尝试的 `SENDING` 预留落盘后，引擎还会立即读取最新快照，并以当前 clock/policy 重算全部门禁。任一门禁变化都先 `CANCEL` 且不出站；通过后 notifier 会在自己的异步快照读取之后、真实 client 调用之前同步重验一次。零次通知或首次已知失败的历史待办即使没有新消息也会被考虑；同一待办同轮最多尝试一次，首次失败只能在下一轮补一次。静默时段继续合并消息但不通知、不自动发送。

Task 7 组合层必须保持一个后台 Worker、一个共享 storage 对象和一个共享 engine/store 组合实例；这是把“预留后快照复核”到 notifier 调用之间的剩余同步窗口收口到单一后台所有者的明确边界。不同 storage 包装对象或多个后台所有者不属于本任务已证明的原子域，不能据此宣称跨进程 exactly-once。

`resolveApproval(input)` 只接受 `SEND_EDITED`、`NO_REPLY`、`DISABLE_CONVERSATION`。人工草稿会先 trim，要求非空且最多 300 个 Unicode code points；发送前立即重读并重新校验目标，随后持久化唯一 MANUAL intent，再执行一次发送。任何未知发送结果都调用 `markSendUnknown`，使 intent 永久终态并暂停会话；已消费、已解决或未知的 intent/待办不能再次发送。`notifyResolved` 只在本地终态已经持久化后调用，通知失败不反转本地处理结果。

## Boss 可靠会话标识与增量读取

托管主键对齐开源实践：以好友列表 API 的 **`encryptUid` 作为 canonical peerId**（存储字段名仍为 `conversationId`），打开 URL 统一为 `?uid=<peerId>`；DOM 上的 `conversationId`/`uid` 仅作 `aliases`。活动会话、身份和发送控件仍要求 DOM owned-scope；登记基线、周期增量与发送后证据改读当前页面同源 `/wapi/zpchat/geek/historyMsg`，**不引入 MQTT / 内部发信协议，也不调用内部发信 API**。好友列表或历史接口不可用、响应结构不明确、无法唯一对齐时均失败关闭，不得用未验证 DOM ID 或页面文案冒充稳定主键。

**首条招呼不由托管/联系 AI 生成**：联系流程只发送用户配置的招呼语模板（可含 `{jobName}` / `{company}`）。建联后的多轮分类与草稿统一采用“求职者本人”身份、45 个汉字上限和六条最高优先级规则：明确拒绝完全由 AI 语义判断为 `explicit_rejection / EXPLICIT_REJECTION`，示例短语只是提示上下文而不是本地关键词规则；含糊拒绝归为 `important` 并等待人工确认；事实回复只能引用简历或 HR 常用问答，不得编造经验或承诺薪资、面试和到岗时间。明确拒绝的草稿只允许一次简短礼貌结束语，不继续争取、追问或推销经历，结束后的后续检查不得重复回复。即时 `AUTO_CLOSE` 和静默 `DEFER_AUTO_CLOSE → 重读 → AUTO_CLOSE` 均已接入持久意图、真实 sender 和 `ENDED_UNMATCHED` 终态。薪资/面试/到岗等普通回答仍由原硬风险门进入待确认。

`src/platform/boss/peer-identity.js` 负责纯函数解析：`resolvePeerIdentity({ domIds, friends, origin })` → `{ peerId, peerUid, url, aliases, peerSource: 'encryptUid' }`。`peerId` 是好友列表 `encryptUid`，`peerUid` 是同一条好友记录的数字 `uid`，后者只用于历史消息方向判定。`src/platform/boss/conversation-reader.js` 仍是零 DOM、零网络模块，只从页面 URL / 活动链接 / dataset 抽取原始 `conversationId` 或 `uid`；公司、岗位、HR、预览文本不能生成会话 ID。

- 页面和活动链接必须是 HTTPS 的 `*.zhipin.com`，原始路径必须精确为 `/web/geek/chat`；根域名、尾随/额外路径、点段、反斜杠、其他主机和不安全 ID 均拒绝。ID 接受 `[A-Za-z0-9_~-]{1,128}`（兼容开源实测含 `~` 的 encryptUid）。多个显式来源出现不同 ID 时返回 `null`。空 `activeHref` 视为未提供（现网 `.friend-content` 常无 geek/chat 锚点）。消息容器兼容 `.chat-message-list` 与 `.chat-record`；在单活动会话 + 单容器且无共享 dataset/ARIA 时，页面 URL 的 `uid` 是优先软归属标识。URL 无 ID 时，从 Resource Timing 末尾反向查找最新一条同源、HTTPS、精确 `/wapi/zpchat/geek/historyMsg` 请求，并仅接受唯一且格式安全的 `bossId` 参数；此前打开过的会话请求允许保留，外域伪装路径被忽略，最新匹配请求的重复/畸形参数失败关闭。
- DOM reader 输出 `{ conversationId, url }`；登记/托管前由 peer resolver 归一为 `{ conversationId: peerId, peerUid, url: ?uid=peerId, aliases }`。旧记录没有 `peerUid` 时，reader 必须以 canonical peerId 在好友列表唯一找回同一条记录后再读取，不能猜测方向。
- 同源历史接口固定请求当前 `bossId`、`maxMsgId=0`、`c=20`、`page=1`、`src=0` 并携带当前登录 Cookie。响应必须是 `code=0` 且包含数组 `zpData.messages`；按接口的最新优先顺序反转为时间正序。顶层 `type` 的口径在各公开实现之间并不一致，因此它不作为普通消息白名单，只排除已知系统包络/正文类型。方向不再使用 `received`：2026-07-26 实号响应中本人发出的“是的，仍在看机会。”和 HR 发出的“不合适”均为 `received=true`。解析器要求 `from.uid/to.uid` 与登记的 `peerUid` 恰好建立一条关系：`from.uid === peerUid` 为 incoming，`to.uid === peerUid` 为 outgoing；两边都匹配、都不匹配或缺失数字 UID 都返回 `MESSAGE_ORDER_UNCERTAIN`，不能跳过后继续自动处理。正文种类由 `body.type` 决定：`1` 且文本非空为 `text`，岗位卡 `8` 与系统通知 `16` 跳过，其余（含未知 body 类型、`body.type=1` 但空文本）降级为无正文 `attachment`，由上层策略强制人工确认。游标优先取 `mid`，缺失时回退到 `time`；`mid` 与 `time` 都按 int64 处理，同时接受安全整数和纯数字字符串。无稳定游标、重复/碰撞游标或响应异常时返回 `MESSAGE_ORDER_UNCERTAIN`。该错误只附带有界的 `type / body.type / received / mid / time` 标量形状，其中 `mid` 与 `time` 只回传形状而非取值，不包含正文、人员或岗位信息。
- 纯函数 `normalizeMessages` 只处理数组或对象形式的 array-like 输入，最多检查最近 200 个原始项；方向必须明确为 `incoming` 或 `outgoing`，类型只允许 `text`、`image`、`attachment`、`voice`。文本最多 600 个 Unicode code points；非文本消息保留类型但清空文本，不保留附件、图片、语音或头像 URL。
- 指纹优先使用历史接口明确且安全的 `mid`；否则必须有有限、非负且不超过 `Number.MAX_SAFE_INTEGER` 的整数稳定时间，再以方向、类型、文本和时间做确定性非明文哈希。同一批中任何重复或碰撞指纹的全部候选均丢弃，内容脚本会因数量不一致而失败关闭，禁止反向猜测。没有普通 incoming 时可以登记空 incoming baseline；只要普通消息无法建立唯一可靠游标，就返回 `MESSAGE_ORDER_UNCERTAIN`。
- `selectNewIncoming` 只返回基线之后的 incoming，保持页面顺序且每轮最多 20 条；找不到非空基线时返回空数组，不重放整段历史。纯 API 省略第二参数时仍只返回最后 20 条供显式初始化；传入明确空串表示“此前没有 incoming”，从第一条开始按 20 条分页。

Boss chat content script 失败关闭的消息契约：

| 消息 | 前置校验与结果 |
| --- | --- |
| `GET_ACTIVE_CONVERSATION_REF` | 要求恰好一个可见活动会话节点（旧版 active link，或无锚点的 `.friend-content` / active item）和一个可见消息容器（`.chat-message-list` 或 `.chat-record`）。优先通过相同 `conversationId`/`uid` dataset、`aria-controls` 或 `aria-labelledby` 证明归属；缺少这些关系时只接受页面 `uid`，或最新且严格校验的同源 `historyMsg?bossId=` 软标识；身份文本只读取唯一 active item 和 owned pane 内 header |
| `CAPTURE_ACTIVE_CONVERSATION` / `PROBE_PEER_IDENTITY` | 在 owned 活动会话上同时收集活动 DOM ID、页面 `uid` 和最新同源精确 `historyMsg bossId`，再请求 `getGeekFriendList.json`。候选 ID 冲突时，必须由活动会话 scoped identity 在结构化好友 `name / brandName / jobName` 中唯一命中；零命中或多命中均失败关闭。公司、岗位和 HR 优先使用最终唯一好友记录的结构化字段。CAPTURE 先绑定 canonical `encryptUid`、aliases 和数字 `peerUid`，再按该 peer 读取历史并建立 incoming 基线；任一失败不写 store |
| `READ_ACTIVE_CONVERSATION` | 不激活或依赖当前活动 DOM。要求调用对象自有的字符串 `lastFingerprint`，重新净化登记时已经通过好友列表唯一建立且由 store 严格保存的 canonical peerId/aliases，然后直接按 canonical peerId 从同源历史接口读取；周期检查不重复请求好友列表。返回给 engine 的 ref 始终使用 canonical peerId/URL。没有 incoming 时 GET 返回空串（绝不返回 `null`），可原样传给 READ；遗漏/非字符串返回 `BASELINE_REQUIRED`，非空基线必须命中 incoming，否则返回 `BASELINE_NOT_FOUND` |
| `SEND_MANAGED_REPLY` | Enter 和 fallback button 每次动作前同步重验 ref、身份和同一个 owned scope，证据后再次重验；fallback 还要求输入框与按钮都是最初对象且输入内容精确等于冻结草稿，任一变化都不点击。发送前记录历史接口 outgoing 指纹，发送后只接受同目标历史接口中新增且文案等于草稿的唯一 outgoing |

READ 在最近 20 条历史接口消息窗口内最多返回 20 条新增 incoming，并把 cursor 推进到最后返回项；若检查间隔内消息量已使非空 baseline 离开窗口，则返回 `BASELINE_NOT_FOUND` 并暂停，不猜测或跳过。outgoing 指纹不能充当 incoming cursor。SEND 成功必须同时返回非空 `sentFingerprint`、精确 `targetConversationId` 和有限正数 `observedAt`。动作前目标已变化返回 `TARGET_UNCERTAIN` 且不触发动作；Enter 已触发后如 fallback 发现控件或草稿变化，以及其后发生目标变化、历史接口读取失败或没有新匹配消息，一律返回 `SEND_RESULT_UNKNOWN` 且不重试。

固定选择器缺失时返回 `SELECTOR_UNAVAILABLE`；历史接口、消息类型、方向、`mid` 或顺序不能全部可靠确认时返回 `MESSAGE_ORDER_UNCERTAIN`；ref、归属或身份不一致及多可见活动节点/容器时返回 `TARGET_UNCERTAIN`。managed 登录失效与页面阻止分别稳定返回 `LOGIN_REQUIRED` 和 `BOSS_BLOCKED`，所有 managed 失败都包含 `success: false` 与 `errorCode`。不得改用全页面任意 `.item`、任意文本节点或第一条会话兜底。既有 `SEND` / `SEND_ACTIVE` 行为保持：一次联系已有肯定发送结果后，只有 ref、身份和当前消息基线都可靠时才附加 `conversationRef` 与 `baselineIncomingFingerprint`；附加元数据失败不会追溯改变本次联系成功结果，只会使该会话不可登记托管。

`tests/fixtures/boss-chat/*.json` 全部是脱敏的合成中间数据；`tests/boss-content-chat.test.js` 使用最小 VM/fake DOM 加载真实生产脚本并调用实际注册的 runtime handler，覆盖 hidden decoy、多可见容器、显式/软归属、跨域与多 ID history 资源、最新请求参数畸形、历史接口方向与系统消息过滤、不可追踪 incoming、未知历史类型、baseline 分页、发送前/后切换目标及新 outgoing 证据。2026-07-25 的实号只读登记先后暴露：Resource Timing 会保留多个旧 `bossId`，以及 DOM `.message-item` 混入多类无方向系统节点。当前实现已从“逐个 DOM 系统卡白名单”升级为使用历史接口 `type/received/mid`；登记、周期读取和发送证据的生产 handler 回归均通过。2026-07-26 已在 ego-lite 中完成两个真实登记会话的受保护历史读取和显式打开正反切换；真实发送仍未执行，因此只能确认监控读取与打开链路，不能宣称真实自动回复已经通过。

## 飞书通知、签名与凭证边界

`src/conversation/feishu-notifier.js` 是零依赖 UMD/CommonJS 通知模块。它只构造通知并通过注入的 `fetch` 发送一次；它不读取 Chrome、不访问 Boss 页面，也不修改全局或逐会话托管开关。真实飞书请求不属于自动化测试范围。建议把机器人加入仅自己或受信任协作者可见的私人群；外发卡片也只允许安全岗位元数据、固定阶段、固定摘要、固定等待状态和受限 Boss URL。

- Webhook 的原始字符串必须精确匹配 ASCII 形式 `https://open.feishu.cn/open-apis/bot/v2/hook/[A-Za-z0-9_-]+`；在 URL 归一化前即拒绝端口、认证信息、查询、片段、点段、百分号编码、反斜杠和额外路径。
- 配置的 Webhook 和签名密钥仅应保存在独立的 `feishuNotification` 本地设置中。`chrome.storage.local` 不是系统钥匙串：用户应使用最小权限的机器人，并可随时在飞书端轮换或删除 Webhook。
- 配置了签名密钥时，`timestamp` 为秒字符串；签名是以 `${timestamp}\n${secret}` 为 HMAC-SHA256 密钥、空字节消息计算后 Base64 编码的结果。未配置密钥时不发送 `timestamp` 或 `sign`。
- 自动待办通知使用 `client.send(config, card, dispatchPrepared)`：client 完成所有异步签名和同步序列化后把一次性同步 fetch thunk 交给 runtime；runtime 在自己的最终持久状态复核后立即调用。显式 `TRUSTEESHIP_TEST_FEISHU` 和 notifier 独立单元调用不传第三个参数，保持直接发送一次的既有行为。
- `buildApprovalCard` 的返回对象会深冻结并登记到模块私有 `WeakSet`；`send` 只接受该对象本身，任意重建、变造或外部输入均以 `FEISHU_CARD_INVALID` 拒绝，绝不触发 fetch。验证配置后、签名或 fetch 前，发送器还会序列化回扫整个已品牌卡片：完整 Webhook、提取的 Webhook token 和非空签名密钥均同时按原始文本及 `JSON.stringify(value).slice(1, -1)` 的转义文本精确匹配，任一形式出现即拒绝外发。卡片只接受安全的公司/岗位/HR 元数据、稳定阶段枚举、固定摘要、布尔等待状态和受限 Boss URL；调用方传入的 HR 对话、模型草稿、`fieldsNeeded`、`reasonCode`、任意自由文本 stage/summary/wait 都不会被序列化。卡片一律使用 `plain_text`，不接受 Markdown 链接/提及渲染；完整聊天上下文、Webhook、签名密钥、API Key 和未知输入字段一律不进入卡片。
- Boss 链接只允许 HTTPS 子域名 `*.zhipin.com` 的精确 `/web/geek/chat`（可带尾斜杠）路径。点段、反斜杠和编码路径技巧被拒绝；DNS 主机名总长最多 253、每个标签 1–63 字符，最终重建 URL（即使无查询）最多 512 字符。输出 URL 只保留值符合 `[A-Za-z0-9_~-]{1,128}` 的 `conversationId`、`uid`、`jobId`、`encryptJobId` 查询项，片段和其余参数全部丢弃；不能构造安全 URL 时不显示打开按钮。
- 从时钟、签名、fetch 到 `response.json()` 是同一个可中止的超时操作；超时会中止 fetch 并返回 `TIMEOUT`，晚到的 Promise 被观察但不会泄漏异常。注入时钟必须返回原始、有限且正数的毫秒值，且向下取整后的秒数必须大于 0；NaN、Infinity、字符串、包装 Number、零和负数均在签名/fetch 前返回 `UNKNOWN`。HTTP 非 2xx、飞书返回 `code !== 0`、网络和超时分别收束为稳定错误码，时钟/签名异常为 `UNKNOWN`。结果不包含 URL、响应体或原始异常；脱敏器会删除完整 Webhook、token、签名密钥、带引号的 Bearer/API-key 形式和任意 URL 查询串（循环对象也安全收束）。通知失败不会删除或改变本地待确认任务，仍由 `ConversationStore` 的有限重试语义控制。

## Service Worker 调度与现有联系流程接入

`src/background.js` 是唯一后台所有者，并按策略、store、ReplyAI、飞书、Boss reader、engine、runtime helper 的依赖顺序加载模块。它只创建一个 `ConversationStore`、一个 `MonitorEngine`、一个注入 `fetch` / Web Crypto 的飞书 client 和一个 `TrusteeshipRuntime` controller；不得创建第二个 storage wrapper 或 engine。它的 protected notifier 对 approval/resolved 通知都保留调用方断言：入口单独验证 API proof，最终快照上按 `API proof → caller assertion` 的同步顺序组合，非函数 caller 按未提供处理。`src/conversation/trusteeship-runtime.js` 是浏览器/Node 双环境组合助手，生产环境只接受这组后台单例，测试环境则注入 fake Chrome、fake engine 和 fake notifier，自动化测试不访问真实 Boss、LLM 或飞书。

Chrome alarm 固定为 `boss-ai-chat-monitor`。Worker 初始化、`runtime.onInstalled`、`runtime.onStartup` 和成功保存托管配置后都会 reconcile：全局关闭或全局暂停时清除 alarm；只有开启且间隔为 5、10、15 分钟之一时，才用同名 alarm 创建对应 `delayInMinutes` / `periodInMinutes`。同名 `alarms.create` 替换旧配置，因此不会累积多个周期。alarm listener 忽略所有其他名称；alarm 与用户 `TRUSTEESHIP_RUN_NOW` 都进入同一个 runtime FIFO 和同一个 `MonitorEngine.runCycle()`，不会绕过 engine 的策略、日限、静默或 intent 门。

所有 `TRUSTEESHIP_*` 用户消息、受控 API 配置保存 `SAVE_API_CONFIG`，以及会真实调用 LLM 并写入托管证明的 `TEST_API`，只接受无 `tab` / `frameId` 且 URL 精确等于本扩展 `/src/sidepanel.html` 的 sender；Boss content script、其他扩展页、外部扩展和畸形 sender 全部在副作用前以固定码拒绝。各消息还执行顶层与嵌套对象的 exact-key、长度、类型和 action 枚举校验。Alarm 不伪造用户消息，而是调用 controller 的内部调度入口。Worker 任一初始化步骤失败时会尽力持久化全局暂停、清除 alarm，之后所有托管用户入口、`SAVE_API_CONFIG` 和 `TEST_API` 只返回 `SERVICE_WORKER_INTERRUPTED`，alarm 不调用 engine、reader、AI、notifier 或 sender。即使暂停持久化持续失败，`onInstalled` / `onStartup` 也只重试 fail-closed/clear，绝不执行可创建 alarm 的普通 reconcile。

后台消息固定为：

| 消息 | 行为与安全边界 |
| --- | --- |
| `TRUSTEESHIP_GET_STATE` | 逐字段重建固定 allowlist 的托管设置、有界已登记会话、待办数量和遮罩后的飞书状态；不整体 clone 存储对象，不返回未知内部字段、raw pauseReason、Webhook 或签名密钥 |
| `TRUSTEESHIP_SAVE_SETTINGS` | 只保存本地设置；间隔不是 5/10/15 时返回 `TRUSTEESHIP_INTERVAL_INVALID`；响应中的飞书只包含 `hasWebhook` / `hasSigningSecret` 与测试状态 |
| `TRUSTEESHIP_TEST_FEISHU` | 唯一直接发送“测试卡片”的入口；只在用户显式消息触发后更新 `lastTestOk` / `lastTestAt`，返回稳定码且不返回凭证或响应体 |
| `TRUSTEESHIP_SET_CONVERSATION` | 只接受单个已经可靠登记的 `conversationId` 和布尔 `enabled`；不存在“全部开启”协议 |
| `TRUSTEESHIP_REMOVE_CONVERSATION` | 彻底删除已登记会话及其关联待确认记录；侧栏「从列表移除」使用 |
| `TRUSTEESHIP_REGISTER_ACTIVE` | 用户显式操作：读取当前聚焦窗口中活动的 Boss 聊天页，捕获可靠会话标识与基线后登记；`enable: true` 时立即开启该岗位托管；不降低策略门，不打开新标签 |
| `TRUSTEESHIP_LIST_APPROVALS` | 只返回最多 100 个本地 `PENDING` 待办；每个最多 20 条、每条 600 字符的上下文以及 300 code points 草稿，不含任何凭证 |
| `TRUSTEESHIP_RESOLVE_APPROVAL` | 原样委托同一个 engine 的串行 `resolveApproval()` |
| `TRUSTEESHIP_ACK_UNKNOWN_SEND` | 只接受一个有界 `approvalId`；必须精确命中 `SEND_RESULT_UNKNOWN` 待办、owner 会话和终态 UNKNOWN intent。删除本地待办、清除会话的未知暂停，但不发送、不重放 intent，也不删除 Boss 消息 |
| `TRUSTEESHIP_OPEN_CONVERSATION` | 只在用户显式操作时，从已登记记录取出稳定引用；优先复用当前焦点窗口的 Boss 聊天页并激活唯一匹配列表项，没有聊天页时才以安全 URL 新建标签；content handler 必须再次用 canonical peerId/alias 与 scoped identity 证明目标，未证明时返回稳定错误而不报告成功 |
| `TRUSTEESHIP_RUN_NOW` | 仅手动触发同一 engine 周期，不改变配置或降低任何策略门；全局关闭或暂停时返回 `TRUSTEESHIP_NOT_RUNNING` 且 engine 调用为 0，不得把空跑包装成成功检查 |
| `SAVE_API_CONFIG` | sidepanel 保存 API 设置的唯一支持入口；只接受固定 provider 与有界 `apiKey/baseUrl/resumeText`，调用注入的 `PlatformConfig.saveApi` 并与设置、周期、resolve、API 测试共用 controller FIFO |

尝试把全局托管从关闭改为开启时，后台会以当前本地时钟检查全部前置条件：API Key 存在且 `TEST_API` 在 24 小时内成功、`resumeText` 非空、飞书已开启且配置有效并在 24 小时内测试成功、用户已经接受风险提示。任一条件缺失都不会开启或创建 alarm，而是返回：

```json
{
  "ok": false,
  "code": "TRUSTEESHIP_PREREQUISITE_FAILED",
  "missing": ["api", "resumeText", "feishuTest", "riskAccepted"]
}
```

既有 `TEST_API` 在开始时冻结规范化出站身份和 `apiConfigVersion`，只有模型返回去除首尾空白后大小写不敏感的精确 `ok`，且回写前后当前身份/版本都未变化时，才写 `apiLastTestOk`、`apiLastTestAt` 与同版本 `apiLastTestVersion`。晚到旧响应或 A→B→A 返回 `API_TEST_STALE`，旧 proof 保持不可用；空串、解释文字、网络或协议错误会写失败证明。证明写入异常只返回固定 `API_TEST_PERSIST_FAILED`，不产生未处理 rejection。成功/失败响应不返回模型原文、API Key 或供应商响应体。飞书测试复用后台唯一 client；Webhook 或签名密钥任一变化都会清除旧 `lastTestOk/lastTestAt`，必须对新凭据重新测试。自动通知继续由 engine 的通知 reservation 路径触发，不能调用测试消息绕过。

API 证明采用共享后台所有权与三层连续失效边界，而不是只在侧边栏启用时检查一次：

1. sidepanel 不再直接调用 `PlatformConfig.saveApi`。`SAVE_API_CONFIG` 由 background 校验受信 sender 和 exact schema 后调用 controller 的专用 `saveApiConfig()`；`TEST_API` 同样只通过专用 `runApiTest()` 进入 controller。两者与 `SAVE_SETTINGS`、run、scheduled、resolve 共用一条 FIFO：周期先取得所有权时，配置保存必须等周期退出；保存先取得所有权时，会先清 proof、停用/暂停并清 alarm，后续周期在 engine 前被拒绝。
2. `TRUSTEESHIP_SAVE_SETTINGS` 在飞书配置写入等异步步骤之后重新读取 API/证明版本和全部前置条件，只有最新值仍满足时才提交 `enabled:true`；轮换竞态会固定返回 `TRUSTEESHIP_PREREQUISITE_FAILED`，持久化 `enabled:false / paused:true / PREREQUISITE_CHANGED` 并清除 alarm。
3. `chrome.storage.onChanged` 只监听 `provider`、`apiKey`、`dsKey`、`baseUrl`、`apiConfigVersion` 的真实变化；listener 一进入即同步递增 Worker 内存中的 `apiProofEpoch`，再把幂等 `invalidateApiProof()` 排入 controller FIFO。暂停持久化失败仍会清 alarm；仅 `apiLastTestOk`、`apiLastTestAt`、`apiLastTestVersion` 的证明写入既不递增 epoch，也不误暂停。
4. `loadCurrentProvenApiConfig()` 在任何异步读取之前冻结当前 epoch，返回 `{ cfg, epoch }` 租约；读取期间 epoch 已变化会直接拒绝。reader、sender、classifier、draft 与飞书 notifier 在各自每个真实 `tabs` / `sendMessage` / `fetch` / `client.send` 前同步 `assertLease()`，断言与真实 API 调用之间没有 `await`。classifier 使用同一租约的冻结 `cfg`，使 `callLLM`/`fetch` 在该 JS turn 发起；页面加载、store 快照或其他内部 await 期间发生外部轮换时，后续托管页面消息、Boss 发送及飞书 client 调用均为 0，并返回固定 `API_PROOF_STALE`。临时 tab 的 `finally` 关闭属于安全清理，不被旧租约阻止。

`TRUSTEESHIP_RUN_NOW`、alarm 的内部 scheduled 入口与 `TRUSTEESHIP_RESOLVE_APPROVAL` 在进入 engine 前还会重新检查全部前置条件。AUTO/MANUAL intent 持久化前也使用相同证明门禁，因此 AI 已完成后再轮换不会留下可恢复发送意图。恢复必须先对当前 API 版本重新执行显式 `TEST_API`，再保存启用设置；成功启用会清除旧暂停码。

API 前置检查与受保护 reader/classifier/notifier 必须消费同一个完整配置快照。`PlatformConfig.loadFlatFor()` 除 provider、Key、base URL 和 `apiConfigVersion` 外，还必须保留 `apiLastTestVersion`、`apiLastTestOk`、`apiLastTestAt`；否则 UI 直接读 storage 会判定证明有效，而受保护适配器会把投影后缺字段的配置判定为 `API_PROOF_STALE`。读取期间真正发生的 `API_PROOF_STALE` 统一映射为全局 `PREREQUISITE_CHANGED`，清除 alarm 并等待重新证明，禁止写成单会话 `CONVERSATION_UNAVAILABLE` 或增加 `readFailureCount`。

Boss 页面适配器按读写分级使用标签。只读 reader 在页面里只发一次同源历史消息请求，不点击列表、不切换会话、不改动 DOM，因此允许先用 `tabs.query({ url: 'https://*.zhipin.com/web/geek/chat*' })` 复用用户已经打开的 Boss 聊天页，省掉每个会话一次的 SPA 冷启动；复用标签只做注入和 `sendMessage`，绝不 `tabs.update` 导航、不置为 active、不在结束时关闭它。没有可复用标签，或复用只因环境问题（`CONTENT_SCRIPT_UNAVAILABLE` / `CONVERSATION_UNAVAILABLE`）失败时，才回退到本轮独占的 `active: false` 临时标签重试一次；`TARGET_UNCERTAIN`、`MESSAGE_ORDER_UNCERTAIN`、`LOGIN_REQUIRED`、`BOSS_BLOCKED` 等语义结果直接返回，不在临时标签里重放。只读 reader 不把 `?uid=` 当成页面已激活目标，也不点击会话列表：canonical peerId/aliases 只在用户登记时通过好友列表唯一建立，周期检查重新执行稳定引用的格式、域名和 ID 集合净化后，直接请求该 peer 的同源历史接口，不再把好友列表可用性作为每轮依赖。因此后台监控与用户当前活动会话解耦，好友列表短暂失败、虚拟列表、WebSocket 首屏和临时标签未激活会话不会再把所有登记岗位同时暂停。

sender 属于不同的高权限路径。它只接受当前焦点窗口中 active、加载完成且 URL 为 Boss chat 的现有标签，不再创建不可见临时写入页；找不到该标签或发送前标签失去 active 状态都收束为 `SEND_RESULT_UNKNOWN`。随后按 [browser-harness BOSS chat skill](https://github.com/browser-use/browser-harness/blob/main/agent-workspace/domain-skills/BOSS-zhipin/chat.md) 的实号路径，从 `.friend-content` 列表中按公司、岗位和 HR 文本评分，只接受至少两项命中（仅有一个有效字段时要求唯一命中）且最高分唯一的候选，然后点击它。点击后最多有界等待 24 次；只有最新活动 scope 同时通过 canonical peerId/alias 与 expected identity 校验，才允许进入发送。零候选、并列候选或二次证明失败都按原稳定错误失败关闭，禁止选择第一条兜底。当前 BOSS DOM 中 `.chat-record` 位于 `.message-content`，编辑器与 `button.btn-send` 则位于同一 `.chat-conversation` 的兄弟分支；content handler 因此保留消息读取 pane，并另外从消息容器向上最多八层解析同时包含可见输入框和发送按钮的最近 `controlPane`。发送前后的 owned-scope 复核同时要求 `pane` 与 `controlPane` 对象未变化；`controlPane` 缺失或其中控件不唯一都会在动作前失败关闭，禁止全页面选择第一组控件。

只读回退临时标签在创建后、加载后、注入前后以及实际读取前通过 `tabs.get` 复核仍为 inactive；任一步发现用户接管都会立即拒绝。发送路径反过来要求当前标签持续 active：content handler 只在 runtime 传入 `allowVisible: true` 且 tab 身份已经由后台证明时允许 `SEND_MANAGED_REPLY`，目标激活等待及每一次 Enter/click 前仍重验 exact target 和冻结草稿。若 Enter 已经实际尝试，之后失去证据只会收束为 `SEND_RESULT_UNKNOWN`，不会误称为“未发送”。后台等待 complete、PING 或按固定顺序注入 selectors / humanize / message-send / reader / content-chat 后才执行托管协议。tabs、scripting 与 alarms 共用 Chrome 调用包装器；每个 API 只调用一次并提供 callback，若同一次调用返回 Promise 也会观察该 Promise，callback/Promise 的先到结果由统一 settle guard 只提交一次，`runtime.lastError` 只在 callback 内读取；实现不再依赖真实 Chrome 绑定恒为 `0` 的 `Function.length`。sender 在内容消息出站前重读 store，要求同会话存在相同 `intentId`、`status: "SENDING"` 和冻结草稿，否则返回 `SEND_RESULT_UNKNOWN`，绝不发送。登录失效和页面阻止写入全局暂停；目标、选择器和未知发送只返回稳定码，原始页面错误不进入 runtime 响应。

只读失败不再一次就暂停。`CONVERSATION_UNAVAILABLE`、`SELECTOR_UNAVAILABLE` 和 `CONTENT_SCRIPT_UNAVAILABLE` 属于可重试的环境错误，`store.recordReadFailure` 把连续失败次数记在会话上，未达 `READ_FAILURE_PAUSE_THRESHOLD = 3` 时会话保持 `WAITING_HR`，下一轮 alarm 自动重试；只有第 3 次仍失败才写入 `PAUSED` 与对应暂停码。任何一次成功检查（`markConversationChecked`）或用户手动重新开启（`setManaged(true)`）都会清零该计数与 `lastReadErrorCode`。`TARGET_UNCERTAIN`、`MESSAGE_ORDER_UNCERTAIN` 等非重试码仍然一次即暂停，全局码（`LOGIN_REQUIRED` / `BOSS_BLOCKED`）仍走全局暂停，都不进入退避。旧版本遗留的 `PAUSED` 记录若暂停码可重试且 `readFailureCount` 为 0，会在下一轮开始时自动恢复一次，避免用户为升级前的暂停反复手点“重试托管”。侧栏对退避中的会话显示“上次检查失败（原因），第 N/3 次，下轮自动重试”，而不是笼统的“已暂停”。

达到阈值后的 `PAUSED/CONVERSATION_UNAVAILABLE` 或 `PAUSED/SELECTOR_UNAVAILABLE` 仍然没有外部写入。岗位卡因此显示“重试托管”；store 只在会话没有活动待办、也没有 `SENDING` intent 时把它恢复为 `WAITING_HR`，保留 `lastIncomingFingerprint`、`lastCheckedAt` 和去重窗口。`TARGET_UNCERTAIN`、`MESSAGE_ORDER_UNCERTAIN`、`SEND_RESULT_UNKNOWN`、`RECOVERY_STATE_UNCERTAIN` 与 `UNKNOWN_PROCESSING_FAILURE` 仍要求更强的人工核对，不能走该捷径。runtime 和 engine 会原样保留安全的 `MESSAGE_ORDER_UNCERTAIN`，侧栏显示“Boss 消息结构发生变化，已停止自动回复”，不再归一化成无法定位根因的“会话暂不可用”。“立即检查”会展示 `checked/newMessages/pending/autoSent` 的安全计数；summary 含稳定错误时明确显示“检查未全部完成”，不再把零成功、已暂停的周期描述为完成。

runtime 只从固定状态 allowlist 向侧栏投影会话状态，新增 `WAITING_AUTO_CLOSE` 和 `ENDED_UNMATCHED`；未知持久状态不会把原始 provider 文本带入 DOM。岗位卡把前者显示为“等待静默结束后礼貌回复”，仍算正在托管；后者显示为“已结束－未匹配”，不计入顶栏正在托管数量，也不显示已勾选的托管开关或“重试托管”，只保留“打开会话”和“从列表移除”。用户若确实要恢复该会话，必须通过显式重新托管入口重新授权，不能由周期自动恢复。

分类与草稿 adapter 只能调用 `ReplyAI.build*Messages`、既有 `callLLM` 和 `ReplyAI.parse*`，不会手工拼接 prompt，也不会把配置对象、API Key 或飞书凭证传给 ReplyAI。`getResumeFacts` 是 engine 的每轮一次 seam：每次调用只读取一份最新 `resumeText`，按非空行生成最多 100 条 `resume-line-N`，每条最多 600 code points；ReplyAI 仍按自身契约只选取 prompt 所需的有界窗口。

既有 Boss `SEND_ACTIVE` 已明确成功后，只有同时返回可靠 `conversationRef` 和字符串 `baselineIncomingFingerprint` 时，后台才调用唯一 store 登记；新记录仍为 `enabled: false / DISABLED`，并只在首次登记时保存该基线（包括空字符串）。ref、基线或 store 校验失败不会追溯改变本轮联系成功，也不会产生可用托管开关。原有 `PREPARE_DELIVERY / CONFIRM_DELIVERY / CANCEL_DELIVERY` 保持不变，旧 `START_DELIVER` 仍以 `CONFIRMATION_REQUIRED` 拒绝。

## 实现状态与验证记录

当前状态：API proof flat snapshot 缺字段导致只读周期误报 `CONVERSATION_UNAVAILABLE` 的实号缺陷已修复。2026-07-26 已通过 ego-browser 确认 10 分钟 alarm 存在，并完成已登记 canonical peer 的无外部写入受保护历史读取；显式“打开会话”也已在同一当前标签内完成正反切换及动作后 canonical peer/alias、公司和 HR 身份复核。真实外发演练首次从不可见临时页执行后进入 `SEND_RESULT_UNKNOWN` 且 Boss 无 outgoing；用户授权的精确单次可见页重试在 15:44 得到 `[送达]` outgoing。实号历史进一步证明当前 `received=true` 同时出现在本人和 HR 两个方向，可靠方向必须由登记 peer 的数字 `uid` 对比 `from.uid/to.uid`；相应 parser、发送证据与 active-tab sender 已修复。随后对徐海霞会话的精确单次操作记录到 `SEND_RESULT_UNKNOWN`，但页面观察器确认输入、Enter 和 DOM mutation 均为 0；目标、peer 和历史均已通过，根因是旧 `scope.pane` 只指向 `.message-content`，无法命中兄弟分支控件。最近共同会话祖先修复已增加真实层级与多控件歧义回归。该次消息确定未外发，仍不自动重放；待确认的未知发送项可以在人工核对后清除本地记录，原 UNKNOWN intent 保持终态。真实 HR 新来信后的定时捕获、LLM 分类/草稿/自动回复与真实飞书通知仍未验证。

- 基线：`npm test` 通过，47 tests、0 failures。
- TDD RED：新增 manifest 权限契约后，`node --test tests/manifest.test.js` 如预期因缺少 `alarms` 失败。
- TDD GREEN：`node --test tests/manifest.test.js` 通过，4 tests、0 failures。
- 完整验证：`npm test` 通过，48 tests、0 failures。
- Manifest JSON 验证：`python3 -m json.tool manifest.json >/dev/null` 通过。
- 本任务自动化测试不访问真实 Boss 或飞书服务，因此不构成真实聊天读取、发送或通知验收。
- Task 1 TDD RED：`node --test tests/trusteeship-policy.test.js` 因策略模块尚不存在而以 `MODULE_NOT_FOUND` 失败，符合新模块缺失的预期。
- Task 1 TDD GREEN：`node --test tests/trusteeship-policy.test.js` 通过，11 tests、0 failures；`npm test` 通过，59 tests、0 failures。
- Task 1 审查修复 RED：新增双开关和关键词用例后，聚焦测试为 13 tests、11 passes、2 failures（`月薪` 未拦截、关闭全局托管仍自动回复）。
- Task 1 审查修复 GREEN：最小修复后，`node --test tests/trusteeship-policy.test.js` 通过，13 tests、0 failures；`npm test` 通过，61 tests、0 failures。
- Task 1 第二轮审查：省略 `settings` 与 `conversationEnabled` 的默认关闭回归用例在新增时已通过（覆盖补强，非 RED）；裸 `package manager` 用例如预期失败后收窄英文薪资短语。最终 `node --test tests/trusteeship-policy.test.js` 通过，15 tests、0 failures；`npm test` 通过，63 tests、0 failures。
- Task 2 TDD RED：`node --test tests/conversation-store.test.js` 因持久状态模块尚不存在而以 `MODULE_NOT_FOUND` 失败，符合新模块缺失的预期。
- Task 2 TDD GREEN：`node --test tests/conversation-store.test.js` 通过，13 tests、0 failures；覆盖四个固定键、可靠引用、非法转换、并发去重、有界待办、禁用/重置、发送意图终态、Worker 恢复、通知补发与凭证隔离。
- Task 2 完整验证：`npm test` 通过，76 tests、0 failures。测试使用内存存储和注入时钟/ID，不访问真实 Chrome 页面、AI、Boss 或飞书，因此不构成外部发送验收。
- Task 2 审查修复 RED：扩展聚焦测试后为 18 tests、9 passes、9 failures；失败分别证明 URL 子路径误接收、跨 store 实例竞态双成功、终态证据字段缺失/弱校验、任意原因/通知码落盘、恢复写失败后不再重试、普通读写放大，以及损坏待办引用导致跨会话合并。
- Task 2 审查修复 GREEN：共享 storage 队列、恢复提交顺序、只在状态实际变化时写入、严格肯定证据、固定错误 allowlist、精确 URL 路径和确定性待办修复完成后，聚焦测试 18/18 通过；`npm test` 81/81 通过。
- Task 2 第二轮审查 RED：聚焦测试扩展到 22 项后为 18 passes、4 failures；同 Worker 新 store 把 live `SENDING` 错误恢复为 `PAUSED`，禁用与重置遗漏本会话待办，且 SENDING 关闭把 `management_disabled_during_send` 真实写入 storage。
- Task 2 第二轮审查 GREEN：恢复所有权与队列统一为模块级 storage 状态，fresh module 测试证明只有新 Worker 才恢复；禁用/重置按会话归属关闭活动待办并固定未知原因。聚焦测试 22/22 通过；`npm test` 85/85 通过。
- Task 4 TDD RED：新增 `tests/feishu-notifier.test.js` 后，`node --test tests/feishu-notifier.test.js` 因通知模块尚不存在而以 `MODULE_NOT_FOUND` 失败，符合新模块缺失的预期。
- Task 4 TDD GREEN：Web Crypto HMAC-SHA256 空消息签名、严格 Webhook/Boss URL、白名单有界卡片、注入式 fetch/超时及稳定脱敏结果实现后，聚焦测试 8/8 通过。审查补强先新增编码斜杠和根域名 Boss URL 两个失败用例（6/8 通过），再收紧 URL 校验，恢复为 8/8 通过；随后加入“fetch 忽略 AbortSignal”超时用例，先得到错误的 `OK`，再改为 `Promise.race` 加中止信号，恢复 8/8 通过；`npm test` 最终 102/102 通过，且 `node --check src/conversation/feishu-notifier.js` 通过。
- Task 4 安全审查修复 RED：新增原始 Webhook 归一化绕过、Boss 查询/路径技巧、任意卡片外发、卡片变造、Markdown/凭证注入、签名/JSON 解析悬挂、时钟异常和循环/引号凭证脱敏用例后，聚焦测试 5/12 通过，明确暴露所有审查项。
- Task 4 安全审查修复 GREEN：模块私有卡片品牌与深冻结、`plain_text` 脱敏卡片、原始 ASCII Webhook 规则、有界 Boss URL 重建和 clock→sign→fetch→JSON 单一超时竞速落地后，聚焦测试 12/12 通过；`npm test` 新鲜完整验证 106/106 通过。
- Task 4 第二次复审 RED：新增精确不透明凭证回扫、超长 DNS 主机名和非原始/非正时钟值用例后，聚焦测试为 11/14 通过，三个失败分别证明卡片凭证仍可出站、超长主机名仍可入按钮、无效 clock 仍可触发请求。
- Task 4 第二次复审 GREEN：在签名/fetch 前序列化检查完整 Webhook/token/非空 secret，增加 DNS 与最终 URL 上限，并验证 clock 的原始正有限毫秒及正秒数后，聚焦测试 14/14 通过；`npm test` 新鲜完整验证 108/108 通过。
- Task 4 最终阻塞 RED：加入含双引号和反斜杠的签名密钥用例后，卡片 JSON 转义形式未被原始凭证回扫识别，且结构化错误中的同一转义值未被 `redactError` 替换；聚焦测试 14/16 通过。
- Task 4 最终阻塞 GREEN：每个精确凭证统一派生去重的原始/JSON-string-content 转义形式，并在外发卡片回扫和错误脱敏共用；聚焦测试 16/16 通过，`npm test` 新鲜完整验证 110/110 通过。
- Task 5 TDD RED：新增纯读取器、content 消息契约和 manifest 顺序测试后，聚焦命令如预期出现 `MODULE_NOT_FOUND`、三项 content 操作缺失和 reader 未加载三个失败。
- Task 5 GREEN：纯读取器 8/8 通过，reader + content 契约 + manifest 聚焦测试 16/16 通过；自审再以点段 URL 和抛错 dataset getter 两个失败用例完成 RED，最小修复后纯读取器 9/9 通过。
- Task 5 最终验证：`node --test tests/conversation-reader.test.js tests/content-guard-contract.test.js tests/manifest.test.js` 为 17/17 通过；`npm test` 为 121/121 通过；reader/content 语法检查和 manifest JSON 解析均通过。测试没有访问真实 Boss 或执行真实发送。
- Task 5 审查修复 RED：reader 新增无稳定时间、unsafe time、碰撞指纹和空串 cursor 用例后为 9/11 通过；VM/fake DOM 真实 handler 测试初次为 1/9 通过，失败分别证明 document-wide hidden decoy 泄漏、多可见/无 ownership 未拒绝、baseline 未强制、cursor 跳过余量、managed 登录码不稳定、发送前后未重验及缺少 scoped outgoing 证据。
- Task 5 审查修复 GREEN：reader 11/11、VM content 9/9、reader/content/message/contract/manifest 聚焦 32/32 通过；首次全量 `npm test` 为 132/132 通过。真实 Boss 与真实发送仍未执行。
- Task 5 最终复审 RED：VM content 新增无 incoming 的 GET→READ 空基线往返、outgoing 基线拒绝、Enter 后替换控件不得 fallback 点击三个用例，旧实现为 9/12 通过。
- Task 5 最终复审 GREEN：无 incoming 的基线统一为空串；READ 非空基线只匹配 incoming；fallback 重验同一输入框、同一按钮和精确草稿，Enter 已尝试后的任何不确定性收束为 `SEND_RESULT_UNKNOWN`。VM content 12/12、聚焦 35/35、全量 135/135 通过。
- Task 6 store 扩展 RED：新增 checkpoint、AUTO intent/原子日计数、固定码暂停、NO_REPLY 和 MANUAL 不计数用例后，聚焦测试为 22 passes、5 failures，失败均为新 API 或 `mode` 尚不存在；另一个后续新指纹用例明确证明终态 AUTO intent 会错误阻止新 intent。
- Task 6 store 扩展 GREEN：五个受限 API、AUTO/MANUAL 模式和仅 AUTO 成功原子计数完成；后续新指纹可替换已终态 intent，仍在 `SENDING` 的 intent 不可覆盖。`node --test tests/conversation-store.test.js` 为 28/28 通过。
- Task 6 引擎 RED：`node --test tests/monitor-engine.test.js` 先因缺少 `src/conversation/monitor-engine.js` 以 `MODULE_NOT_FOUND` 失败。首轮实现后聚焦 store + engine 为 42/42 通过；安全自审新增逐会话 PAUSED 禁读、运行中全局暂停禁通知和未知策略失败转待办三个真实失败用例，最小修复后 engine 17/17、store + engine 45/45 通过。
- Task 6 最终验证：`node --check src/conversation/monitor-engine.js` 与 `node --check src/conversation/conversation-store.js` 均退出 0；`node --test tests/conversation-store.test.js tests/monitor-engine.test.js` 为 45/45 通过；`npm test` 为 158/158 通过。全部为内存存储和注入 fake 的自动化验证，没有访问 Chrome、真实 Boss、LLM 或飞书。
- Task 6 审查修复 RED：store + engine 聚焦测试扩展到 60 项后为 46 passes、14 failures；强化同实例操作队列断言后另有 1 个独立失败，共确认 15 个缺陷，覆盖跨实例额度/通知竞态、全局暂停竞态、reader 身份与 checkpoint、任意错误码泄漏、提前停止游标和 resolve 映射。
- Task 6 审查修复 GREEN：共享 storage 的 AUTO 原子预留、AUTO 未知计数（含禁用时终结）、通知 reservation 两阶段、engine 操作 FIFO、严格 reader 身份/checkpoint、稳定错误映射和实际尝试游标完成后，`node --test tests/conversation-store.test.js tests/monitor-engine.test.js` 为 62/62 通过；语法检查通过，`npm test` 为 175/175 通过。
- Task 6 最终收口 RED：单一通知 phase API、原子 enabled/paused/quiet 门禁、预出站 quiet/pause 二次复核、CANCEL、双终态落盘失败恢复和 15 方法公共预算加入后，聚焦测试为 68 tests、57 passes、11 failures。
- Task 6 最终收口 GREEN：移除独立 reserve/complete 公共方法及旧单阶段语义；`recordNotificationAttempt` 的 RESERVE/COMPLETE/CANCEL、预出站最新快照复核、恢复所有权失效与有界同模块恢复完成后，语法检查通过，聚焦测试 68/68、`npm test` 181/181 通过。
- Task 7 TDD RED：新增后台契约、runtime fake Chrome 测试和初始 incoming 基线用例后，后台/store 聚焦为 47 tests、39 passes、8 failures；runtime 单测以缺少 `src/conversation/trusteeship-runtime.js` 的 `MODULE_NOT_FOUND` 失败。原有三项 background 契约继续通过。
- Task 7 GREEN：单 store/engine/notifier/runtime、alarm 生命周期、八类 runtime 消息、前置条件、inactive/temporary tab 生命周期、ReplyAI/简历 seam、飞书测试状态与成功联系登记完成后，聚焦 54/54、全量 `npm test` 196/196 通过。
- Task 7 安全自审 RED/GREEN：新增“inactive 候选在导航前被用户激活”和“托管发送前登录失效”两个竞态用例，旧实现为 7/9；导航前 `tabs.get` 二次复核和 sender 全局暂停落地后，runtime + background 聚焦 19/19 通过。最终全量为 198/198，语法检查通过。全部 Chrome/Boss/LLM/飞书行为均由 fake/injection 覆盖，没有真实外部操作。
- Task 7 独立审查修复：runtime/content 聚焦测试先出现 10 个预期失败，真实执行 `background.js` 的 VM fake 先出现 5/6 失败，API 凭据绑定也先因旧测试状态未清而失败。修复后，凭据测试与 explicit `ok` 协议、独占临时 tab/可见性边界、初始化 fail-closed、sidepanel sender + exact schema、内部 alarm 入口、controller FIFO 和 Chrome callback/Promise exactly-once 兼容均有行为覆盖；旧 background 行为 regex 只保留 import order，运行行为由 VM 测试接管。最终 `npm test` 为 207/207，通过语法检查，未访问真实 Boss、LLM 或飞书。
- Task 7 第二轮独立复审修复：新增持久 API version/proof version、pending 旧响应与 ABA、草稿填充/Enter 后 visibility、原生 `length === 0` callback、失败 lifecycle 和 `TEST_API` 授权/写失败用例；各组均先复现预期失败。修复后聚焦 133/133、全量 `npm test` 217/217 通过；晚到测试固定 `API_TEST_STALE`，已尝试 Enter 后的接管保持 `SEND_RESULT_UNKNOWN` 且不 fallback click，未执行真实 Boss、LLM 或飞书操作。
- Task 7 最终复审修复：SAVE_SETTINGS A→B 竞态、controller 配置失效、四类受保护外部依赖与 intent 前门禁分别先形成 RED；旧实现的 runtime 为 16/19、background VM 为 12/15。三层连续证明门禁完成后，runtime/background/engine 聚焦为 67/67；配置身份变化固定暂停并清 alarm，proof-only 写入不暂停，轮换后的 reader/LLM/Boss sender/飞书调用均为 0，AUTO/MANUAL intent 也不会在最后门禁后创建。最终 `npm test` 为 225/225，相关生产与测试 JavaScript 的 `node --check` 全部退出 0。
- Task 8 TDD RED：新增 `tests/trusteeship-sidepanel-contract.test.js` 后，`node --test tests/trusteeship-sidepanel-contract.test.js tests/sidepanel-contract.test.js` 中既有 delivery modal 契约 6/6 通过；新增托管设置、待确认工作台、消息与样式四项契约均因功能尚不存在失败。随后新增 `tests/sidepanel-runtime.test.js`，最小 VM helper 的保存回滚、前置条件导航、待办 resolve 与单会话回滚四项也均以缺少 controller 失败。
- Task 8 GREEN：侧边栏新增默认关闭的 AI 托管设置（5/10/15 分钟、1–20 日限、静默时段、默认遮罩的飞书凭证、显式风险说明和手动飞书测试）；`TRUSTEESHIP_GET_STATE` 驱动顶栏状态、已登记岗位和待确认角标。密码不会从状态响应回填，已保存凭证只显示无敏感内容的占位提示；空凭证输入也不会在保存其他设置时覆盖持久凭证。
- 待确认页只以 DOM API、`textContent` 和 `value` 构建聊天上下文、草稿与操作控件。`SEND_EDITED` 才携带草稿；每张卡在 resolve 期间禁用全部动作，失败（尤其 `SEND_RESULT_UNKNOWN`）保留卡和编辑值，只有 `ok === true` 后才刷新。关闭单会话托管在明确提示会删除最近聊天上下文后才发送单个 `TRUSTEESHIP_SET_CONVERSATION`，失败会恢复原值。
- Task 8 聚焦验证：`node --test tests/trusteeship-sidepanel-contract.test.js tests/sidepanel-runtime.test.js tests/sidepanel-contract.test.js` 14/14 通过；`node --check src/sidepanel.js` 通过。测试使用静态契约和 Node VM/fake dependencies，不调用真实 Boss、LLM 或飞书；360–600px 样式与 ARIA 语义为代码/契约覆盖，尚未作真实 Chrome 手工验收。
- Task 8 独立审查修复：runtime 在公共边界把 engine allowlist 中的 `errorCode` 收束为稳定 `code`，UI 也防御性读取 `code || errorCode`。`SEND_RESULT_UNKNOWN` 作为持久待确认项计入 badge，重开后仍显示只读人工核对卡且只提供“打开 Boss 会话”，没有再次发送、拒绝或关闭会话的入口。顶栏按 `enabled → paused → pending → active` 取值；已登记岗位使用中文状态/暂停原因并展示安全 DTO 的最近检查时间。
- Task 8 审查修复验证：完整生产 `sidepanel.js` 的 Node VM/fake DOM 覆盖初始化、状态组合、真实 unknown 响应、重开只读、成功刷新和会话关闭回滚；runtime/静态契约覆盖公共错误码、DTO、完整 missing 清单、ARIA 和长词换行。`npm test` 249/249 通过；`node --check src/sidepanel.js` 与 `node --check src/conversation/trusteeship-runtime.js` 通过。所有验证未访问真实 Boss、LLM 或飞书。
- Task 8 独立复审修复：首次收到真实 `SEND_RESULT_UNKNOWN` 后，当前旧卡不会短暂恢复编辑或 resolve。它保持 textarea `disabled + readOnly` 与所有 resolve 控件禁用，先提示人工核对并立即请求持久列表；列表刷新失败时旧卡仍保持禁用，刷新成功后替换为“本次尝试草稿（只读）”和唯一的“打开 Boss 会话”。普通失败仍恢复可编辑草稿，成功仍刷新。完整 sidepanel VM 使用延迟刷新断言“unknown 响应返回后、刷新 promise 完成前”没有第二次 `TRUSTEESHIP_RESOLVE_APPROVAL`。

## 版本控制注意项

当前仓库没有可验证的 Git `HEAD`（`NO_GIT_BASELINE`）。本任务不会初始化 Git、暂存或提交；待合法基线恢复或用户明确授权后，再执行提交操作。

## 参考依据

既有计划已确认的依据：Chrome Alarms API 用于 MV3 Service Worker 调度；Chrome Cross-origin Requests 指明自定义 API 域名需对应 host permission；[GeekGeekRun](https://github.com/geekgeekrun/geekgeekrun) 提供适配器隔离和人工参与边界的参考。

Task 1 新检索的开源参考：[Open Policy Agent](https://github.com/open-policy-agent/opa) 将输入数据与确定性策略决策分离；[node-casbin](https://github.com/apache/casbin-node-casbin) 的 deny-override 模型说明显式拒绝规则应先于允许结论。本模块只借鉴这两个边界原则，因浏览器扩展需要零运行时依赖而未引入其库。

Task 2 新检索的开源参考：[idb-keyval](https://github.com/jakearchibald/idb-keyval) 明确展示异步 `get`/`set` 读改写会丢更新，并用排队的 `update` 保证顺序；[Chrome 扩展迁移文档源码](https://github.com/GoogleChrome/developer.chrome.com/blob/main/site/en/docs/extensions/migrating/to-service-workers/index.md) 强调 MV3 Service Worker 短生命周期下应以持久存储为事实源；[Workbox](https://github.com/GoogleChrome/workbox) 的 Background Sync 面向可重放请求队列，本模块的聊天发送结果可能未知，因此只借鉴持久队列边界，不采用自动重放。

Task 2 审查修复新增参考：[OWASP REST Security Cheat Sheet](https://github.com/OWASP/CheatSheetSeries/blob/master/cheatsheets/REST_Security_Cheat_Sheet.md) 要求不信任输入对象并将值约束到固定范围；本轮据此把外部通知结果和发送证据收窄为明确字段与离散 allowlist。

Task 4 已检索的开源参考：[larksuite/node-sdk](https://github.com/larksuite/node-sdk) 展示了飞书交互式卡片使用 `interactive` 消息类型；已批准计划中的 [feishu-webhook-sdk](https://github.com/jz0ojiang/feishu-webhook-sdk) 用于核对自定义机器人 Webhook 与 HMAC-SHA256 签名约定。本模块没有复制任一项目的源代码：为满足浏览器扩展的零依赖、私有卡片品牌和可注入测试边界，使用 Web Crypto 与原生 `fetch` 独立实现最小通知逻辑。

Task 5 新检索的开源参考：[GeekGeekRun](https://github.com/geekgeekrun/geekgeekrun) 说明 Boss 会话自动化依赖高变动 UI 且需要明确异常停机；[Chrome 扩展消息传递文档源码](https://github.com/GoogleChrome/developer.chrome.com/blob/main/site/en/docs/extensions/mv3/messaging/index.md) 明确要求把 content script 数据视为不可信并验证、净化输入。本任务仅借鉴“适配器隔离、输入不可信、失败关闭”的边界，没有复制项目选择器、真实会话数据或自动发送流程。

Task 6 新检索的开源参考：[BullMQ](https://github.com/taskforcesh/bullmq) 把持久化、原子操作和 deduplication 作为任务执行的一等边界；[Temporal TypeScript SDK](https://github.com/temporalio/sdk-typescript) 展示了把外部副作用放在可审计工作流边界中的实现方向。审查修复继续核对 [SAP CAP Transactional Outbox](https://github.com/cap-js-community/transactional-outbox) 与 [MassTransit](https://github.com/MassTransit/MassTransit) 的 outbox/inbox 语义，用于确认通知必须先持久化 reservation 再出站，且未知/未终结结果不得自动重放；最终收口又核对 [BullMQ locked jobs](https://github.com/taskforcesh/bullmq-redis) 的 owner token、active 状态与受控终态释放边界。本任务仅借鉴这些边界原则，没有引入其运行时或复制实现。

Task 7 新检索的开源参考：[GoogleChrome/chrome-extensions-samples](https://github.com/GoogleChrome/chrome-extensions-samples) 用于核对 MV3 service worker 的事件监听与 Chrome API 组合方式；[Chrome 扩展 Service Worker 迁移文档源码](https://github.com/GoogleChrome/developer.chrome.com/blob/main/site/en/docs/extensions/migrating/to-service-workers/index.md) 展示了用 `chrome.alarms` 替代不可靠 DOM timer，并在 worker 事件入口恢复持久状态；[MDN WebExtensions 示例](https://github.com/mdn/webextensions-examples) 用于交叉检查 background/content 消息边界。本任务只借鉴事件驱动调度、alarm 恢复和消息适配原则，没有复制开源项目源代码或引入运行时依赖。

Task 8 新检索的开源参考：[GoogleChrome/chrome-extensions-samples](https://github.com/GoogleChrome/chrome-extensions-samples) 的 side panel 示例用于核对面板状态不应依赖“刚刚打开”这一时序假设；[MDN WebExtensions examples](https://github.com/mdn/webextensions-examples) 与其 storage 文档用于核对扩展设置应经受控扩展存储/消息边界处理。当前实现据此把状态、badge 和列表刷新统一委托给既有 `TRUSTEESHIP_*` 后台接口，并在 UI 中只渲染已遮罩的凭证状态；没有复制开源代码或引入依赖。

本机 Obsidian 既有结论引用：`技术复用/Electron只读采集与持久租约-Phase2B复盘.md` 提出的“稳定排序与显式 cursor”“终态响应丢失不等于未提交”和“keyed FIFO 只保存 tail”原则。Task 2 的新实现建议是在浏览器扩展存储上采用单 worker Promise 尾队列，并把未知发送收束为人工核对；Task 6 的新实现建议是把这些原则应用于最多 10 个会话的单轮游标编排和一次性 AUTO/MANUAL intent。这些是当前 Boss 插件的实现决策，不是笔记中已经验证过的 Boss 场景结论。

## Task 9 集成、恢复与隐私验收

### 恢复与调度语义

| 场景 | 自动化固定行为 |
| --- | --- |
| Worker 在证据一致的 `CLASSIFYING` 中断 | 恢复 `classificationBaseline + classificationOriginState`；`WAITING_HR` 可重新分类一次，`WAITING_CONFIRMATION` 保留原 PENDING 待办并直接合并一次，AI/发送为 0 |
| `WAITING_CONFIRMATION` 恢复证据缺链、错链或重复 PENDING | `PAUSED/RECOVERY_STATE_UNCERTAIN`；通知为 0 |
| legacy / 损坏 / 矛盾 `CLASSIFYING` | `PAUSED/RECOVERY_STATE_UNCERTAIN`；保留原游标与有界去重证据，不读页、不调用 AI/通知/发送；恢复持久化失败后重试 |
| 同一 raw 快照同时存在 `CLASSIFYING` 与 `SENDING` | `SENDING` 恢复优先；intent、会话和关联待办全部收束为 `SEND_RESULT_UNKNOWN`，绝不重新分类 |
| Worker 在 `SENDING` 中断 | 保持发送结果未知的人工核对终态，不自动重放；AUTO 额度在恢复重试后仍只按一次消耗 |
| alarm 重建 | 始终使用唯一逻辑名称 `boss-ai-chat-monitor`；5 / 10 / 15 分钟只更新该 alarm |
| 过期 `scheduledTime` 事件 | 事件入口只启动一次“当前”周期，不补跑历史 tick |
| 全局关闭 | 清除 alarm，不读取 Boss、不调用 LLM、不发送飞书 |
| 单会话关闭 | 删除该会话最近上下文和活动待办；不会撤销此前已经成功联系的事实 |
| 静默时段收到多条消息 | 合并为一个本地待办，静默期间零通知；退出静默后只发送一个合并通知 |
| 飞书失败 | 本地待办不丢失，通知最多补发一次 |
| 通知预留后 owner 被暂停、禁用、改链或出现重复 PENDING | store 原子预留、engine 新鲜快照和签名/序列化后的 runtime dispatch 门禁中止外发；fetch 调用为 0 |
| `subtle.sign` await 期间 owner 暂停、断链、出现第二待办、全局/飞书关闭或进入静默 | client 只交出 prepared fetch thunk；runtime 读取最终快照后拒绝 dispatch，reservation 收束为安全未知且不重试 |
| 真实 background 包装层的双租约组合 | actual store → engine → protected notifier → runtime notifier → actual Feishu client；六类 owner 变化 fetch 为 0，正常为 1，API proof 轮换为 0；resolved caller 断言保留且非函数安全 |
| 登录失效 / Boss 阻止 | 全局暂停并清 alarm；侧边栏显示中文重新登录或验证码/风控处理指引，必须人工恢复 |
| 未知发送结果 | 持久只读人工核对卡只允许打开 Boss 会话，不再提供再次发送 |

公共持久 pauseCode allowlist 包括 `LOGIN_REQUIRED`、`BOSS_BLOCKED`、`SERVICE_WORKER_INTERRUPTED`、`PREREQUISITE_CHANGED`、`API_CONFIG_CHANGED`、`TARGET_UNCERTAIN`、`SELECTOR_UNAVAILABLE`、`SEND_RESULT_UNKNOWN`、`MESSAGE_ORDER_UNCERTAIN`、`CONVERSATION_UNAVAILABLE`、`RECOVERY_STATE_UNCERTAIN` 和 `UNKNOWN_PROCESSING_FAILURE`。store 归一化与 runtime DTO 投影各自执行一次 allowlist；任何未知原始值统一映射为 `UNKNOWN_PROCESSING_FAILURE`。`pauseReason` 只允许随未知发送固定为 `SEND_RESULT_UNKNOWN`，其他值全部清空。runtime settings DTO 逐字段构造固定 10 个公共字段，`quietHours` 也逐字段构造，内部新增字段不会自动外溢。`API_PROOF_STALE` 是运行时操作错误而非持久 pauseCode。

### 隐私边界与静态扫描

真实模块组合测试执行 classifier error、draft error、send error，以及成功进入人工确认的模型回显分支；每条链使用 actual store → engine → runtime controller/notifier → 真实 `FeishuNotifier.create()`，只用 fake fetch 捕获最终 HTTP body。当前授权后的通知契约允许最新 HR 正文和拟回复进入卡片，但必须先做 code-point 长度限制与 URL、`@`、凭证特征清洗；API Key、Webhook token、签名密钥、provider body、raw error 和未声明的任意对象字段仍不得进入最终请求、周期摘要或 controller response。卡片来源只接受 `LIVE_MONITOR` / `LIVE_DRILL`，并分别标记“HR 正文”或“模拟 HR 正文”。

对 `src` / `tests` 的 `apiKey`、`feishuWebhook`、`signingSecret`、`recentMessages`、`console`、`LOG` 和 `runtime.sendMessage` 定向扫描确认：托管模块没有 raw console/log 输出，凭证只出现在配置校验、签名或测试 fixture，聊天只进入有界本地状态与 AI 输入。`src/background.js` 仍含 Task 9 范围外的既有联系/扫描 raw error 日志；本任务没有按要求顺手重构该旧链路。独立的生产 background VM 测试证明 `TEST_API` 的 provider/credential canary 不进入响应、runtime 消息或其中的 `LOG/BLOCKED/PHASE` 事件；完整 sidepanel VM 证明未知原始错误码不进入 status 或 managed-conversation DOM。这里是多个真实边界测试的组合证据，不宣称一次单链执行跨过所有浏览器 UI 表面。

### 自动化证据与未覆盖边界

- 首轮新增恢复/隐私测试：2 tests、0 passes、2 failures，分别暴露 `CLASSIFYING` 永久卡住和完整 HR 消息进入飞书卡片。
- UI 恢复指引 RED：10 tests 中 1 项失败，证明 `LOGIN_REQUIRED` / `BOSS_BLOCKED` 没有中文下一步提示。
- 独立审查 P1 恢复 RED：integration 5 项中 4 项失败，证明来源状态未保存、legacy/损坏状态未 fail closed、恢复失败未重试；空 baseline 合法项通过。GREEN 后 5/5。
- GREEN 自检又用 RED 证明“可靠登记 baseline 不一定已进入 processed window”；移除这一过强假设后 integration 最终 6/6。
- 2026-07-26 ego-browser 实号诊断：同一 peer 的 `CAPTURE_ACTIVE_CONVERSATION`、不可见临时标签 PING、`READ_ACTIVE_CONVERSATION` 及持久 baseline 重放全部成功，但 engine 仍返回 `CONVERSATION_UNAVAILABLE`。直接调用 `protectedTrusteeshipPageAdapter.read` 得到 `API_PROOF_STALE`；安全摘要进一步证明原始 storage 的 Key、版本和 24 小时证明均有效，而 `PlatformConfig.loadFlat()` 丢失 `apiLastTestOk/apiLastTestAt`。新增配置投影和 engine 全局归类回归先 RED，修复后聚焦测试 GREEN。
- 修复后全量 `npm test` 为 378/378；修改脚本 `node --check`、Manifest JSON 与 `git diff --check` 全部退出 0。精确重载当前工作区的未打包扩展后，真实 Service Worker 中 `protectedTrusteeshipPageAdapter.read` 成功，完整 controller 周期返回 `checked=1 / newMessages=0 / autoSent=0 / pending=0 / errors=[]`；store 为 `WAITING_HR`、`lastCheckedAt>0`、`readFailureCount=0`、`lastReadErrorCode=""`。这证明 Chrome 保持运行且登录有效时的已登记会话监控读取闭环可用，但没有证明新来信分类、LLM 草稿、真实发送或飞书出站。
- 2026-07-26 ego-browser 切换会话登记复现：地址栏仍是徐海霞的 `uid=2ce53…`，可见 selected item、会话标题和最新精确 `historyMsg` 已是谭辉且 `bossId=71208…`，旧 handler 却返回徐海霞并读取旧 baseline。新增“旧 page uid + 新 history id + 新 scoped identity”的生产 handler 回归先 RED（实际得到 `stale-peer`），三证据唯一绑定并把历史读取移到 canonical peer 确认之后再 GREEN；真实扩展复测必须同时看到返回 peer 为 `71208…` 且“已登记岗位”数量新增，不能只凭按钮提示判定成功。
- 2026-07-26 ego-browser 手动检查复现：两个岗位均已启用且为 `WAITING_HR`，但全局为 `enabled=false / paused=true / PREREQUISITE_CHANGED`，alarm 不存在；旧 `TRUSTEESHIP_RUN_NOW` 仍进入 engine，engine 因全局门禁返回全零 summary，侧栏错误显示“本轮检查已完成：检查 0 个”。新增 runtime/sidepanel 回归先 RED，再以 `TRUSTEESHIP_NOT_RUNNING` 和明确中文恢复指引 GREEN。全部前置证明仍有效时恢复全局托管并现场重跑，得到 `checked=2 / errors=[]`，两个 `lastCheckedAt` 更新、失败计数为 0、10 分钟 alarm 重建；没有新消息，也没有发送。
- 独立审查 P1 隐私 RED：修正测试自身 substring 定位错误后，3 项中 2 项按预期因最终飞书 HTTP body 含开头 marker 失败；send-error 分支通过。固定通知文案后 3/3。
- 独立审查 P1 UI RED：目标用例因没有 `RECOVERY_STATE_UNCERTAIN` 中文文案失败；修复后 sidepanel VM 12/12。
- 第二轮复审恢复优先级 RED：integration 8 项中 2 项失败，分别证明组合 `CLASSIFYING + SENDING` 被错误走入分类恢复、首次未知终态写失败没有按预期拒绝；修复并校正测试时钟后 8/8。
- 第二轮 owner/link 门禁 RED：integration + store + engine 共 87 项，79 passes、8 failures，覆盖 5 个无效原子预留（含父级汇总）、通知前 owner 变化仍外发，以及 orphan 待办仍通知；三层门禁后 87/87。
- 第二轮成功隐私 RED：privacy 4 项中 1 项失败，证明模型 `fieldsNeeded` / draft 回显进入最终 HTTP body；builder 防御测试 17 项中 1 项失败，证明任意自由文本入口可泄漏。固定外发 schema 后分别 4/4、17/17。
- 第二轮恢复元数据清理 RED：store 52 项中 4 项失败（3 个子用例与父级汇总），覆盖 checkpoint、NO_REPLY、enable；全部终态/管理路径清理后 52/52。
- 第二轮 pauseCode DTO/UI RED：runtime 25 项中 1 项失败，sidepanel 13 项中 1 项失败；store/runtime 双 allowlist 与稳定中文提示后分别 25/25、13/13。
- 第三轮 pauseReason/settings RED：actual store 保留 raw global pauseReason，controller 整体 clone settings；与签名竞态合跑 68 项时这两项失败。store 固定 reason 归一化和 runtime settings 逐字段重建后通过。
- 第三轮签名 await 竞态 RED：同一 68 项聚焦测试中，owner pause、approval 断链、第二 local PENDING、全局关闭、飞书关闭和进入静默 6 项都错误得到 `fetchCount = 1`；prepared dispatch thunk 与 runtime 最终门禁后 6 项均为 0，正常签名路径仍为 1，聚焦 68/68。
- 第三轮广覆盖聚焦命令（Feishu/runtime/monitor/privacy/background/sidepanel/store/recovery）184/184；随后新增 client prepared-dispatch 直接单测，Feishu 18/18。
- release-review background 组合 RED：真实生产 VM 的 8 个核心路径中 6 个 owner 竞态错误 fetch 1，正常 fetch 1 与 API rotation fetch 0 通过；补入 resolved 断言透传后完整 RED 为 10 项中 7 项失败。包装层改为双断言组合后 background 组合 10/10，完整 background VM 31/31。
- 最终广覆盖聚焦命令（Feishu/runtime/monitor/privacy/background/sidepanel/store/recovery）195/195；全量：`npm test` 306/306。修改的生产/测试 JavaScript `node --check`、Manifest JSON、敏感/egress 扫描和 `git diff --check` 全部退出 0；扫描仍明确列出 Task 9 范围外的旧联系/扫描 raw error 日志。仓库仍无可验证 Git `HEAD`，因此 `git diff --check` 不能替代 commit-range 审查。

Task 9 的自动化测试使用内存存储、fake Chrome、fake fetch、Node VM 和合成消息；它本身不构成真实平台验收。此后已经用 ego-browser 完成上述无外部写入的真实 Boss alarm、双会话读取、显式打开会话和 `checked=2` 手动周期验收。真实 LLM/飞书与 Boss 发送仍必须按下一节分阶段验证。

Task 10 必须分阶段且每阶段单独获授权：先做一个完整工作日的只读监控；再用测试岗位人工确认发送一条；然后仅一个会话、日限 1 条观察一条低风险自动回复；最后验证登录失效、验证码/风控和页面变化停机。任一阶段未通过都不能进入下一阶段，也不能宣称真实 Boss 发送已验证。

## 真实外发演练

侧边栏「配置 → AI 托管」提供折叠面板「真实外发演练」。它用于在暂时没有真实 HR 新消息时验证当前 API、分类器、提示词、确定性风险策略、待确认、飞书通知和人工确认发送链路：

1. 选择一个已登记、已开启托管且处于 `WAITING_HR` 的 Boss 会话。
2. 输入 1–600 个 Unicode 字符的模拟 HR 消息。
3. 阅读风险说明，并为本次操作勾选“我确认继续后会创建可真实发送给所选 HR 的待确认任务”。
4. 点击「创建真实发送待确认」。
5. 在飞书或插件「待确认」页核对目标、模拟 HR 正文和拟回复；只有在插件内执行 `SEND_EDITED` 才会重新验证目标并真实发送。

推荐依次使用四条固定样本：

| 模拟来信 | 预期重点 |
| --- | --- |
| `还在看机会吗？` | 只有已填写问答或简历可直接作答时才允许 `AUTO_REPLY`；否则转人工确认 |
| `薪资是多少？` | 硬风险先于模型结论，必须 `REQUIRE_CONFIRMATION` |
| `不合适` | 演练报告 `AUTO_CLOSE / EXPLICIT_REJECTION_AUTO_CLOSE` 和拟结束语，但仍只创建人工待确认；真实监控非静默时才会单次自动结束 |
| `经验可能不太匹配` | 含糊拒绝，只生成草稿并等待人工确认 |

`src/conversation/trusteeship-live-drill.js` 先把目标会话、设置与当天计数复制到一次性内存 store，用合成 reader 运行真实 `MonitorEngine`、受保护 AI、简历事实和策略；隔离 sender 只捕获建议草稿和 intent 模式，不访问 Boss。若真实 engine 在隔离环境中产生 `AUTO_CLOSE` intent，演练结果会投影为 `AUTO_CLOSE / EXPLICIT_REJECTION_AUTO_CLOSE / wouldSend=true`；这只是“真实监控将如何决策”的报告。评估成功后，它仍只调用生产 store 的专用 `createLiveDrillApproval`：创建 `origin=LIVE_DRILL` 的本地 `PENDING`，并复用生产通知 reservation/租约发送飞书，绝不把隔离 intent 写入生产 store。该专用写入不得修改真实 `lastIncomingFingerprint`、`processedFingerprints`、`recentMessages`、monitor cursor、自动回复额度或真实读取时间。

演练待办和真实监控待办使用同一个插件确认发送入口。用户执行 `SEND_EDITED` 时，生产 engine 仍会冻结一次性意图、重新打开并读取目标会话、核对 canonical peer/alias、scoped identity 和发送后 outgoing 证据；演练入口本身绝不直接发送 Boss。已有活动待办、会话暂停/禁用、全局托管未运行、API 证明过期或目标不再处于 `WAITING_HR` 时均失败关闭，不允许演练覆盖真实待办或真实游标。

飞书卡片会把演练来源标记为“模拟 HR 正文”，并可携带经过 Unicode 长度限制、URL/@/凭证特征清洗的正文和拟回复；真实监控通知标记为“HR 正文”。飞书 Webhook 仍是单向通知，不提供确认按钮；最终批准继续在插件内完成。输入协议只接受精确的 `conversationId` 和 `message` 两个字段，未知 provider 错误不会直接显示在侧边栏。

演练通过只能证明“合成输入 → 真实 AI/策略 → 生产待确认 → 飞书 → 插件确认 → 真实 sender”的相应已执行阶段。它**不能证明** Boss 页面已经检测到真实新来信，也不能替代 Task 10 的真实入站验收。真实监控必须满足：

1. 登记并保存稳定 baseline 后，由 HR 新发一条消息；
2. 手动周期或 alarm 显示 `checked > 0` 且 `newMessages > 0`；
3. 该消息只生成一次预期的 `LIVE_MONITOR` 待办、结束动作或低风险回复；
4. 再次检查显示 `newMessages = 0`，不得重复分类、通知或回复。

自动化回归使用三轮稳定 reader fixture 验证 `newMessages` 为 `0 → 1 → 0`，同一消息只产生一个 `LIVE_MONITOR` 待办、一次通知且确认前 Boss send 为 0。这证明消息游标和幂等状态机契约，但真实站点的新来信捕获仍需上述实号事件才能最终验收。

本轮还修正了分类证据归一化边界：普通分类和事实回答仍必须提供可核对的简历/问答 evidence；只有严格的 `explicit_rejection` 可以没有简历 evidence，并且只能取得受限的单次结束动作权限。这样“明确拒绝 → 单次礼貌结束”和“含糊拒绝 → 人工确认”不会被错误改写成 `AI_CLASSIFICATION_INVALID`。

### AI 明确拒绝自动结束的最终验证

2026-07-26 分支全量验证为 433/433；全部 JavaScript 语法、Manifest JSON、当前工作树及 `main...HEAD` 的空白检查均通过。完整差异审查确认：AI 是 HR 明确拒绝的唯一语义分类器；确定性层只校验结构化分类形状和拟结束语安全，不按 HR 正文关键词覆写 AI；`AUTO_CLOSE` 不占普通日限；成功后进入 `ENDED_UNMATCHED`，后续周期不会再次读取或发送；live drill 的隔离 sender 不可能直接调用生产 Boss sender。

无外发浏览器验收已完成扩展重载和新版侧栏投影检查。ego-lite Agent 隔离空间没有继承用户窗口的扩展本地 API/登记状态，因此未能在该空间发起真实 AI 演练；现有用户窗口的原生扩展菜单又无法被界面控制可靠关闭，测试在任何外部写入前停止。过程中没有创建待确认、没有飞书通知、没有 Boss 消息。合成明确拒绝的 live-drill 行为由自动化测试验证为 `AUTO_CLOSE / EXPLICIT_REJECTION_AUTO_CLOSE / wouldSend=true / sentToBoss=false`。

这些证据仍不能证明真实 HR 拒绝消息已被生产监控捕获。最终实号验收必须由 baseline 之后的新 HR 消息触发，并观察：非静默直接结束或静默延迟结束、恰好一条匹配 outgoing、状态为 `ENDED_UNMATCHED`，以及下一周期对该会话读取/发送均为 0。未经用户对精确目标和草稿的新授权，本验证不会制造真实 HR 消息。

这些是既有计划结论；本任务的新实现建议仅限于以固定、最小权限落实上述契约。

历史记录（已被 2026-07-26 实号验收取代）：2026-07-25 后台会话恢复修复新增读/发送目标激活、临时暂停无损恢复和周期摘要回归；当时全量为 356/356，但真实平台证据仍停留在“登记成功、旧后台恢复路径失败”。

历史记录（真实只读周期已于 2026-07-26 验收）：2026-07-25 反复暂停修复把只读路径与写路径彻底分级：只读复用用户已打开的 Boss 聊天标签并放宽可见性否决、`historyMsg` 解析不再以顶层 `type` 为判据且补 `time` 游标回退、可重试只读失败改为 3 次有界退避、侧栏投影 `readFailureCount / readRetryLimit / lastReadErrorCode` 并显示重试进度。新增回归覆盖复用标签只读、临时标签回退、发送仍只用临时标签、未知 body 类型、缺方向条目、空文本正文、无 `mid` 时的 `time` 回退、退避计数与清零、旧版遗留暂停自动恢复以及 DTO 投影；当时全量 `npm test` 为 376/376。

## v0.3.7 审核页自动登记身份与会话打开修复

审核页岗位卡是易失的展示层数据，不能成为 AI 托管的最终身份源。现网变更后，卡片公司选择器可能为空，联系人选择器还可能读到公司名；旧流程在一键联系成功后直接保存这些字段，同时丢弃聊天页好友列表已经解析出的 `name / brandName / jobName / peerUid`，因此出现“未知公司”、HR/公司错位。卡片显示 `WAITING_HR` 只证明本地开关已启用，不证明该引用能重新打开或读取。

修复后的自动登记使用独立 `ConversationRegistration` 边界：聊天页返回的结构化公司、岗位、联系人和 canonical 会话引用优先，审核卡片只补齐空字段；`peerUid` 与 aliases 一并持久化，重复登记的空字符串不得擦除已有身份。用户点击“打开会话”时，content handler 先用 canonical peerId 从好友列表唯一恢复结构化身份，再以该身份定位唯一列表候选并完成 canonical/alias 与 scoped identity 双重确认；成功响应会由 runtime 原地重登记，以修复旧版错误卡片。好友列表不能唯一解析、候选不唯一或动作后身份不一致仍失败关闭，且整个打开/修复过程不发送消息。

回归采用四个独立断点：`SEND_ACTIVE` 必须返回规范身份，自动登记必须优先使用它，`OPEN_MANAGED_CONVERSATION` 必须携带 `peerUid` 并能用规范身份修复错误期望，store 不得被空回退字段降级。聚焦组合测试为 205/205。此自动化证据覆盖绑定、打开和惰性修复，不替代扩展重载后的真实页面验收；旧记录只有在规范 ID 仍可唯一映射时才可修复，否则应移除后从正确会话重新登记。

2026-07-27 ego-browser 无外发实号验收：先在隔离任务空间选择“刘梦瑶 / 江西琵琶网络科技”，再以旧版错误形态调用“打开会话”——canonical peerId 正确，但公司为空、联系人错写为“杭州双一”、`peerUid` 为空。精确重载该任务空间内的未打包扩展后，新 handler 成功切换到“罗榜伟 / 杭州双一 / 跨境电商运营”，返回同一 canonical peerId、数字 `peerUid=763614226`、`company=杭州双一`、`hrName=罗榜伟`，最新 `historyMsg` 的 `bossId` 也与 canonical peerId 一致。整个验收只切换会话并读取身份，没有填写编辑器、创建待确认、发送飞书或发送 Boss 消息。该证据证明旧错误登记的“打开 + 身份返回”链路可用；runtime 对旧卡片的原地回写由自动化测试覆盖，用户窗口仍需在重载扩展后点击一次“打开会话”才能触发惰性修复。
