# 开源基线笔记（JobCopilot Fork）

> 基线已拍板：**Fork JobCopilot**（`huluobo2237-pixel/JobCopilot`）  
> 扩展包源目录：仓库内 `JobCopilot · AI/`（已展平到本仓库根）  
> 许可证：MIT（见 `LICENSE` / `UPSTREAM_LICENSE`）

## 上游结构

| 文件 | 职责 |
|------|------|
| `manifest.json` | MV3 + sidePanel + zhipin content scripts |
| `src/background.js` | 扫描 → 筛选 → 联系编排；LLM；拟人化节奏 |
| `src/humanize.js` | 三角分布延迟、拟人滚动/点击、活跃度解析 |
| `src/content-search.js` | 列表 scrape、开 JD、立即沟通→继续沟通 |
| `src/content-chat.js` | 聊天页发图 + 招呼语 |
| `src/selectors.js` | DOM 选择器 + 城市码 |
| `src/sidepanel.*` | 配置 / 岗位筛选 / 执行 |

## 消息流（保留）

```
Sidepanel ──START_COLLECT / START_DELIVER / PAUSE / STOP──→ Service Worker
Service Worker ──SCRAPE / OPEN_JD / GO_CHAT──→ content-search
Service Worker ──SEND_ACTIVE──→ content-chat
Service Worker ──LOG / PHASE / PROGRESS / SCREENED / DONE──→ Sidepanel
```

## 拟人化降风险（v0.2）— 借鉴开源，不做对抗破解

| 借鉴来源 | 落地能力 |
|----------|----------|
| [boss_batch_push](https://github.com/yangfeng20/boss_batch_push) | 过滤不活跃 Boss；投递锁防并发 |
| [BossAssistant](https://github.com/CSUlyc/BossAssistant) | 日限、弹窗确认、HR 活跃筛选思路 |
| [boss-auto-apply](https://github.com/muyuniao/boss-auto-apply) | 随机间隔区间、活跃度门槛 |
| [boss-autogreet](https://github.com/imwyvern/boss-autogreet) | 批次后长休息、验证码停机 |

**已实现：** 三角分布随机间隔、批次休息、拟人滚动/点击抖动、活跃过滤、操作锁、验证码/上限停机。

**明确不做：** 滑块/验证码自动破解、浏览器指纹伪造、隐身浏览器、绕过平台沟通上限。

## 我们相对上游的产品收紧

| 上游倾向 | Boss联系助手 |
|----------|--------------|
| 「投递选中」、默认勾选匹配项 | 「联系已选」、**默认全不选**、未选禁用主按钮 |
| 强依赖 DeepSeek Key 才能收集 | BYOK；无 Key 时规则扫描可用 |
| 固定短间隔 | 可配置日限 + 拟人间隔 + 批次休息 |
| 单页折叠卡片 UI | 底栏三 Tab：配置 / 岗位筛选 / 执行 |

## 多平台进展（v0.3）

- 产品名：**求职联系助手**
- `src/platform/registry.js`：Boss / 智联注册表（JobsIn 式）
- `src/platform/config.js`：`activePlatform` + `byPlatform` 分平台日限/招呼语
- `src/platform/boss/*`：现网 Boss 脚本迁入
- 智联：`ready: true`，MVP 已包含列表扫描和单岗位投递/沟通，仍需测试账号真机验收。

2026-07-28 的 Chrome 应用商店发布收敛移除了未实现的猎聘占位入口、注册表项和主机权限，也移除了界面未提供服务商入口的 DashScope 固定主机权限。商店包只声明并交付已有运行实现的 Boss 与智联；自定义 OpenAI 兼容服务继续按用户填写的具体来源申请可选权限。未来若重新增加平台或固定服务商，必须先完成实现、自动化回归和真机验收，再恢复产品入口与权限。

## v0.3.6 Chrome 应用商店发布参考

- [GoogleChrome/chrome-extensions-samples](https://github.com/GoogleChrome/chrome-extensions-samples)：参考 Manifest V3 扩展的最小运行目录和官方 API 示例组织。
- [SimGus/chrome-extension-v3-starter](https://github.com/SimGus/chrome-extension-v3-starter)：对照最小 MV3 工程根目录结构；没有复制其实现代码。
- [Chrome Web Store: Prepare your extension](https://developer.chrome.com/docs/webstore/prepare)：确认上传 ZIP 的 `manifest.json` 必须位于包根目录。
- [Chrome Web Store Program Policies](https://developer.chrome.com/docs/webstore/program-policies/policies)、[Manifest V3 requirements](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements)、[Permissions requirements](https://developer.chrome.com/docs/webstore/program-policies/permissions/) 和 [User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)：用于确定权限最小化、隐私披露和审核材料边界。
- [Chrome Web Store Best listing practices](https://developer.chrome.com/docs/webstore/best-listing)：用于准备单一用途、清晰功能描述、脱敏截图和审核可复现步骤。
- [drivendataorg/repro-zipfile](https://github.com/drivendataorg/repro-zipfile)：对照其固定 ZIP 成员时间和权限的可复现归档原则；本仓库没有引入其 Python 依赖或复制其实现。
- [archiverjs/node-archiver#383](https://github.com/archiverjs/node-archiver/issues/383)：对照确定性 ZIP 还需要固定日期和稳定成员顺序的实践记录。

本仓库使用显式运行时白名单生成商店 ZIP，未知文件默认不入包。用户明确要求保留开启 AI 托管后的无人逐条确认自动外发；这一行为不在本轮改写，但必须在隐私政策和审核说明中如实披露其控制方式与审核风险。

完成前校验发现原打包器的 `copyFile()` 会让暂存成员带上每次构建的当前时间；`zip -X` 只去除额外属性，不会消除 ZIP DOS 时间字段。间隔约三秒重建可稳定复现“37 个成员内容相同但 SHA-256 不同”。修复后，暂存文件统一为 `0644`、`1980-01-01 00:00:00 UTC`，压缩进程固定 `TZ=UTC`，成员仍按显式白名单顺序写入；自动化会跨越 ZIP 两秒时间粒度重建并比较完整 SHA-256。

## v0.3.5 安全收紧对照

本轮继续对照以下开源与官方实现：

- [JobCopilot](https://github.com/huluobo2237-pixel/JobCopilot)：保留“扫描 → 人工审核 → 逐个闭环”的基础流程。
- [BossAssistant](https://github.com/CSUlyc/BossAssistant)：对照暂停、停止、日限和本地去重的产品语义。
- [boss_batch_push](https://github.com/yangfeng20/boss_batch_push)：其历史修复明确包含重复发送问题；本仓库因此把回车与按钮改为有证据的互斥提交。
- [JobsIn](https://github.com/Chinaduanyun/JobsIn)：继续使用平台适配器边界，不引入其后端或全自动投递路径。
- [Chrome Extension Service Worker Lifecycle](https://developer.chrome.com/docs/extensions/develop/concepts/service-workers/lifecycle)：全局内存会随 Worker 终止丢失，因此新增持久 run 与意外中断阻塞。
- [Chrome Offscreen API](https://developer.chrome.com/docs/extensions/reference/api/offscreen)：按官方 `runtime.getContexts()` 模式创建有界 offscreen 文档，任务终止即关闭。
- [Chrome Cross-origin Requests](https://developer.chrome.com/docs/extensions/develop/concepts/network-requests)：自定义 API 域名必须取得 host permission。

落地规则：

- 目标会话无法证明时不发送，禁止选择“第一条会话”兜底。
- 外部写入结果未知时不自动重放。
- 建联去重与日计数一次写入。
- run 固定平台配置；运行中不可切换平台。
- Service Worker 意外中断后只停机并要求人工核对。

## v0.3.5 智联筛选修复对照

- [loks666/get_jobs](https://github.com/loks666/get_jobs)：复核智联适配仍属于高变动、需真机验证的链路，不照搬其全自动投递实现。
- [iszhouhua/zhaopin](https://github.com/iszhouhua/zhaopin)：其新版智联抓取记录明确从中文 `jl` 旧地址迁移到数字 `cityId`，用于确认城市必须按平台 ID 传递。
- 智联现网页面交叉验证：`/sou/jl653` 返回杭州职位；旧的 `?jl=杭州` 会重定向成无效 `jl杭州` 路由并返回跨城市职位。

本仓库据此新增 `src/platform/search-filters.js`，统一负责智联城市编码和职位卡二次过滤；未知城市失败关闭，经验与学历不再只是保存配置而不执行。

## v0.3.5 飞书通知（Task 4）参考与边界

- [larksuite/node-sdk](https://github.com/larksuite/node-sdk)：核对交互式消息卡的 `interactive` 消息类型与卡片结构；没有引入 SDK 依赖。
- [feishu-webhook-sdk](https://github.com/jz0ojiang/feishu-webhook-sdk)：按已批准实现计划核对飞书自定义机器人 Webhook 与 HMAC-SHA256 签名约定；没有复制其源代码。

本仓库以原生 Web Crypto、注入式 `fetch` 和严格 URL/字段白名单独立实现 `src/conversation/feishu-notifier.js`。安全审查后，模块私有 `WeakSet` 只允许本模块构造并深冻结的 `plain_text` 卡片外发，并在外发前精确回扫配置的 Webhook、token 和非空 secret 的原始/JSON 转义形式；不复制 SDK 的代码或引入其依赖。通知只发脱敏摘要；Webhook、签名密钥、API Key、完整聊天上下文和任意未知输入均不进入卡片、返回结果或日志。飞书通知失败不改变本地待确认任务，且自动化测试仅使用 fake fetch，不发起真实飞书请求。

## v0.3.5 Boss 会话读取（Task 5）参考与边界

- [GeekGeekRun](https://github.com/geekgeekrun/geekgeekrun)：确认 Boss 自动化适配依赖高变动页面结构，异常和目标不确定时必须停机；没有复制其选择器或全自动流程。
- [Chrome 扩展消息传递文档源码](https://github.com/GoogleChrome/developer.chrome.com/blob/main/site/en/docs/extensions/mv3/messaging/index.md)：确认 content script 及其数据属于低信任边界，所有输入都应验证和净化。
- [W3C ARIA Authoring Practices](https://github.com/w3c/aria-practices)：参考 `aria-controls` / `aria-labelledby` 对活动控件和面板的显式关联语义；仅在 Boss 页面已经提供该关系时使用，不注入或猜测 ARIA。
- [Selenium expected conditions](https://github.com/SeleniumHQ/selenium/blob/trunk/py/selenium/webdriver/support/expected_conditions.py)：参考异步 UI 动作前重新定位并验证元素仍可交互、过期元素按不确定处理的模式；本仓库没有引入 Selenium，只把这一边界落实为 fallback 前重验 owned scope、原输入框、原按钮和冻结草稿。

本仓库据此新增零 DOM 的 `src/platform/boss/conversation-reader.js`：只接受显式 `conversationId` / `uid`、精确 HTTPS Boss chat URL 和明确消息方向/类型；冲突 ID、未知方向、撤回、时间分隔、无安全稳定时间和碰撞指纹全部失败关闭。内容脚本要求唯一可见活动链接/消息容器及显式 dataset/ARIA ownership，只在 owned container 内读取和计算发送证据；固定选择器失效返回 `SELECTOR_UNAVAILABLE`，ref、ownership 或身份不匹配返回 `TARGET_UNCERTAIN`。VM/fake DOM 测试加载真实 production handler，但仍是完全合成环境；未访问真实 Boss，也不构成真实 DOM 或发送验收。

最终复审进一步固定跨调用 cursor 和发送 fallback：没有 incoming 时 GET 返回 `''`，可原样传给 READ；READ 的非空 cursor 只能命中 incoming。Enter 已经尝试而没有证据时，若 fallback 发现控件对象或输入文本发生变化，不点击替换按钮并返回 `SEND_RESULT_UNKNOWN`。

## v0.3.6 Boss 多会话切换登记修复

- [browser-use/browser-harness 的 BOSS-zhipin domain skill](https://github.com/browser-use/browser-harness)：其 2026-05-01 实号记录说明，当前聊天 `bossId` 应从用户点击会话后最新一条 `/wapi/zpchat/geek/historyMsg` Resource Timing 记录读取；页面会保留此前会话的请求。只采用这一可验证的读取顺序，不复制其自动化代码或引入依赖。
- [GeekGeekRun](https://github.com/geekgeekrun/geekgeekrun) 与 [get_jobs](https://github.com/loks666/get_jobs)：再次确认 Boss 页面和反自动化行为会持续变化，真实异常必须停机，不能通过选择第一条会话或放宽到任意请求来“提高成功率”。

2026-07-25 实号只读登记复现了 `TARGET_UNCERTAIN`：聊天 URL 无 `uid`，活动项与消息容器无 dataset/ARIA 关系，同时 Resource Timing 已包含多个历史 `bossId`。旧实现要求所有历史请求全局唯一，因此用户只要切换过会话就必然失败。修复后只从末尾反向选择最新一条同源、HTTPS、精确路径的 `historyMsg`；最新匹配请求仍必须只有一个格式安全的 `bossId`，畸形参数立即失败且不会回退到更旧 ID，页面 `uid` 仍优先，随后仍由好友列表唯一对齐 `encryptUid`。对应真实生产 handler 回归先以 26/27 RED 证明旧逻辑，再以 27/27 GREEN 验证修复。

第二次实号登记暴露 `MESSAGE_ORDER_UNCERTAIN`：当前会话包含 BOSS 自带的“你与该职位竞争者 PK 情况…查看详细分析”卡片，它没有 `item-friend` / `item-myself` 方向。最初的窄修复只忽略这一固定文案；第三次实号登记仍被另一种无方向系统节点阻断，证明逐卡片 DOM 白名单不是稳定架构。

当时依据 browser-harness 的 2026-05-01 实号记录，历史接口普通消息被描述为 `type=3`、系统消息为 `type=4`，且 `received` 被解释为方向；该阶段因此把登记基线、周期读取和发送后证据统一改为同源 `/wapi/zpchat/geek/historyMsg`，并暂按 `received` 判向、按 `mid` 建游标。2026-07-26 的双向实号样本已经推翻“`received` 可独立判向”这一假设，后续修复见本文 v0.3.6「方向误判与真实发送」；这里仅保留为历史决策记录。

脱敏诊断随后取得真实形状 `type=1, body.type=1, received=true`：它证明顶层包络已与公开样本不同，但当时仍错误地把布尔 `received` 当作方向。该阶段回归只验证了包络兼容，未取得同一 peer 的双向消息对照，因此不能视为方向语义的最终验收。

首次成功登记的实号卡片又暴露 DOM 身份污染：`.friend-content` 是姓名、公司、职位、时间和预览的复合节点，宽泛的 `[class*="name"]` 会取得拼接文本。browser-harness 同样把 `.friend-content` 描述为复合会话项。修复后，已经通过 DOM ID 唯一对齐的好友列表结构化 `name / brandName / jobName` 成为登记元数据首选，scoped DOM 仅对缺失字段兜底；重新登记同一 peer 会由 store 原地更新元数据，不新增重复记录。生产 handler 回归先 RED 复现拼接，再以 34/34 GREEN 验证。

## v0.3.6 Boss 后台会话恢复修复

- [browser-use/browser-harness 的 BOSS chat skill](https://github.com/browser-use/browser-harness/blob/main/agent-workspace/domain-skills/BOSS-zhipin/chat.md) 明确记录：现网页面打开会话的实测动作是点击 `.friend-content`，点击后等待消息加载；`bossId` 再从随后产生的 history 请求或 WebSocket 数据取得。它没有证明直接导航 `?uid=<encryptUid>` 必然激活目标会话。
- [browser-use/browser-use](https://github.com/browser-use/browser-use) 的持久浏览器会话与动作后重新读取页面状态模式用于交叉检查：导航参数只能作为恢复尝试，不能替代动作后的目标证据。

2026-07-25 实号“立即检查”出现两个已登记岗位同时 `PAUSED / CONVERSATION_UNAVAILABLE`、`lastCheckedAt = 0`。代码回溯确认 page adapter 只创建 `active:false` 临时标签并打开 `?uid=`，content handler 随即要求活动 scope 已经是目标；中间没有 browser-harness 实测所需的列表点击，因此 direct URL 未激活会话时必然暂停。修复新增唯一候选激活：公司/岗位/HR 去空白后评分，两个以上有效字段要求至少命中两项，仅一个字段时要求唯一命中，最高分并列即失败；点击后仍必须用 canonical peerId/alias 与 scoped identity 二次证明。没有选择第一条兜底，也没有复用、刷新或切换用户现有标签。

同轮补充可恢复性和可观测性：只有没有待办、没有 `SENDING` 的 `CONVERSATION_UNAVAILABLE` / `SELECTOR_UNAVAILABLE` 暂停可由“重试托管”无损恢复，消息游标与最近检查时间保留；其他暂停保持人工核对。手动周期 summary 含错误时显示“检查未全部完成”和真实成功检查数。对应生产 handler、store 和完整 sidepanel VM 均以失败用例先行。

自动化最终证据：读路径会话激活、发送路径会话激活、无损恢复和失败 summary 均完成 RED → GREEN；全量 `npm test` 为 356/356，全部 JavaScript `node --check`、Manifest JSON 校验和 `git diff --check` 退出 0。该证据仍是 fake DOM / fake Chrome 自动化；真实 Boss 只读周期需要重新加载扩展后由用户再次验证。

## v0.3.6 Boss 稳定 ID 监控与开源实现复核

- [browser-use/browser-harness 的 BOSS chat skill](https://github.com/browser-use/browser-harness/blob/main/agent-workspace/domain-skills/BOSS-zhipin/chat.md) 的实号记录把会话列表描述为 WebSocket 加载，并记录历史消息可按稳定 `bossId` 直接请求 `/wapi/zpchat/geek/historyMsg`；`type / body.type / received / mid` 分别提供包络、正文类型、方向和稳定游标。这说明只读监控不需要先把该会话变成可见活动 DOM。
- [GeekGeekRun 的未回复提醒流程](https://github.com/geekgeekrun/geekgeekrun/blob/main/packages/ui/src/main/flow/READ_NO_REPLY_AUTO_REMINDER_MAIN/index.ts) 使用持久 Puppeteer 页面循环读取会话列表，按稳定岗位/联系人标识绑定目标，并把 Boss 和消息记录写入 SQLite；其 [Boss 操作实现](https://github.com/geekgeekrun/geekgeekrun/blob/main/packages/ui/src/main/flow/READ_NO_REPLY_AUTO_REMINDER_MAIN/boss-operation.ts) 在需要操作页面时才滚动虚拟列表、点击目标、等待 `historyMsg`，发送前后读取目标状态。可复用的是“稳定身份、持久游标、列表发现、消息记录、动作后复核”的分层，不依赖其 Electron/Puppeteer 运行时或 Vue 私有字段。
- [boss_batch_push](https://github.com/yangfeng20/boss_batch_push) 通过 iframe/UI 模拟并强调发送时必须使用正确的目标 friend ID；它再次证明“点击成功”不能替代目标绑定。该项目与本扩展运行模型不同，不作为可直接移植实现。
- [browser-use/browser-use](https://github.com/browser-use/browser-use) 的持久浏览器和动作后重新观察模式用于复核恢复与证据边界；[Chrome Extension 消息传递](https://developer.chrome.com/docs/extensions/develop/concepts/messaging) 用于保持 MV3 background/content 的低信任输入校验。
- [boss-agent-cli](https://github.com/can4hou6joeng4/boss-agent-cli) 当前实现把用户主动登录组织为 Cookie / CDP / QR / 浏览器兜底链路，并以平台 adapter、SQLite 本地状态、接口漂移诊断和低风险模式阻断招聘者写操作。可复用的是“认证与业务动作解耦、平台隔离、默认拒绝高风险写入、状态可诊断”的边界；本扩展已经依托用户现有 Chrome 会话，因此不引入 Patchright、不导出 Cookie，也不把其登录回退链路描述成风控规避能力。

用户实测四个已登记岗位在点击“重试托管”后都回到 `WAITING_HR`，但下一次“立即检查”又全部变为 `PAUSED / CONVERSATION_UNAVAILABLE`。这证明上一版“临时标签中按文本点击会话，再读取历史”的修复仍把只读监控错误绑定在虚拟会话列表和活动 DOM 上：Node fake 会立即切换 dataset，真实 Boss 的 WebSocket/虚拟列表不会提供同样保证，因而整批在读取前失败，`checked` 保持 0。

本轮将读写路径拆开。canonical peerId/aliases 在用户登记时通过好友列表唯一建立并由 store 严格保存；`READ_ACTIVE_CONVERSATION` 周期检查只重新净化该稳定引用，然后直接按 ID 请求历史，不点击列表、不改变活动会话，也不重复依赖好友列表。`SEND_MANAGED_REPLY` 仍必须激活唯一匹配会话，并保留 scoped identity、持久 `SENDING` intent、冻结草稿及发送后新 outgoing 证据。这样既采用了开源项目的稳定绑定与持久游标思想，也保留本仓库更严格的失败关闭和两阶段发送边界。

同轮修复错误可观测性：`MESSAGE_ORDER_UNCERTAIN` 现在贯穿 page adapter、engine 和侧栏，不再降级为 `CONVERSATION_UNAVAILABLE`；它会明确提示 Boss 消息结构发生变化并停止自动回复。新增回归均先复现 RED，再验证 GREEN：只读不激活无关会话、runtime 保留消息结构错误、engine 持久化对应单会话暂停、sidepanel 显示明确中文说明。

真实 Chrome 复测仍出现“检查 0 个 / 会话暂不可用”，且消息结构错误的新文案没有触发。根因收敛到上一轮新增的每轮 `getGeekFriendList` 复核：登记成功已经证明稳定 peer，而好友列表在 inactive 临时标签中短暂不可用时，上层把 `PEER_LIST_UNAVAILABLE` 归一化成通用暂停，历史接口实际上尚未被尝试。修复先以“好友列表 500、登记 peer 的 historyMsg 正常”测试复现 RED，再让 READ 只依赖严格净化的持久 peer ref 并得到 GREEN；登记与发送身份门保持不变。

许可证和账号安全边界保持不变：只参考公开架构与行为，独立实现；不复制许可证不允许使用的代码，不导出 Cookie，不依赖 Vue 私有对象作为唯一事实源，不直接构造 WebSocket 发送，也不实现验证码破解、指纹伪装或风控绕过。这些做法既不能提高本故障的正确性，也会扩大维护、合规和封号风险。

## v0.3.6 已登记岗位反复“已暂停”修复

- [chrome.tabs 官方文档](https://developer.chrome.com/docs/extensions/reference/api/tabs) 与 [GoogleChrome/chrome-extensions-samples](https://github.com/GoogleChrome/chrome-extensions-samples)（Apache-2.0）：`tabs.query({ url })` 先查找已有标签、命中就复用，是官方推荐的单例标签模式；host permission 已经允许对匹配标签直接 `scripting.executeScript` 与 `tabs.sendMessage`，不需要先导航或激活。据此把只读检查从“每个会话新建一个临时标签并冷启动整个 SPA”改为“优先复用用户已经打开的聊天页”。
- [Chromium 扩展官方讨论组关于 MV3 content script 注入时序的结论](https://groups.google.com/a/chromium.org/g/chromium-extensions/c/WKY7WaBhFZA/m/fZSyTFN0AwAJ)：扩展重载后既有标签不会自动运行 content script，`Receiving end does not exist` 是常态而非故障，推荐做法是捕获该错误、重新注入并重试，而不是把它当作终态失败。据此把 `CONTENT_SCRIPT_UNAVAILABLE` 从“立即暂停”改为可重试错误。
- [browser-use/browser-harness 的 BOSS chat skill](https://github.com/browser-use/browser-harness/blob/main/agent-workspace/domain-skills/BOSS-zhipin/chat.md) 与 [GeekGeekRun](https://github.com/geekgeekrun/geekgeekrun)：两者的实号记录对 `historyMsg` 顶层 `type` 的取值口径并不一致（一处 `3`=普通 / `4`=系统，另一处 `1`=文本…`5`=系统），且都强调 Boss 的消息种类会持续增加。这证明把顶层 `type` 当作白名单判据在架构上就不成立。
- [get_jobs](https://github.com/loks666/get_jobs)：再次确认真实异常必须停机，退避重试只能用于明确无外部写入的只读路径，不能用于发送。

用户实测的死循环是“点‘重试托管’恢复 → 点‘立即检查已登记岗位’再次全部 `PAUSED`”。根因有三条，且互相放大：

1. **只读路径每轮都新建临时标签**。每个已登记岗位一轮就要冷启动一次 Boss SPA（登录态恢复、WebSocket、虚拟列表），临时标签里 content script 常常还没就绪，读取就以 `CONTENT_SCRIPT_UNAVAILABLE` / `CONVERSATION_UNAVAILABLE` 结束。这与官方单例标签模式相反，也是自找的冷启动成本。
2. **`historyMsg` 解析以顶层 `type` 为白名单判据**。现网只要出现一条样本未覆盖的消息（新卡片类型、缺 `mid` 的条目、空文本正文），整批读取就 `MESSAGE_ORDER_UNCERTAIN` 失败关闭，而它被上层归一化后表现为“会话暂不可用”。
3. **只读失败一次即 `PAUSED`**。上面两类瞬时错误没有任何外部写入，却和“发送结果未知”享受同等的失败关闭强度，于是每轮检查都能把全部岗位重新打回暂停。

本轮修复对应三点。只读复用 `tabs.query({ url: 'https://*.zhipin.com/web/geek/chat*' })` 命中的用户标签，只注入并 `sendMessage`，绝不导航、不激活、不关闭；复用只在环境类错误上回退到临时标签，语义类错误直接返回，不重放。`READ_ACTIVE_CONVERSATION` 因此在可见标签上也允许执行，可见性否决收窄到会产生页面副作用的发送路径。解析改为：顶层 `type` 只保留公开一致的 `type=4` 系统消息排除，方向看布尔 `received`，正文种类看 `body.type`，未知正文降级为 `attachment` 交人工确认，游标 `mid` 缺失时回退 `time`，只有真正无法建立稳定指纹才失败。可重试只读错误由 `store.recordReadFailure` 记连续失败次数，满 3 次才 `PAUSED`；任一次成功检查或手动重开清零计数，旧版遗留的可重试暂停在下一轮自动恢复一次。侧栏不再只显示“已暂停”，而是显示真实失败码与“第 N/3 次，下轮自动重试”。

回归先 RED 后 GREEN：只读在可见标签上成功、复用标签不被导航或关闭、临时标签回退、发送仍拒绝可见标签、未知 body 类型不整批失败、缺方向条目被跳过而其余照读、无 `mid` 时用 `time` 建游标、退避到阈值才暂停、成功检查清零、旧暂停自动恢复、DTO 投影重试进度。全量 `npm test` 376/376，`node --check`、Manifest JSON 校验与 `git diff --check` 均退出 0。仍为 fake DOM / fake Chrome 证据，真实 Boss 只读周期需用户重新加载扩展后验证。

2026-07-26 使用 [ego-lite](https://github.com/citrolabs/ego-lite) 的隔离任务空间复用真实 BOSS 登录态，逐层验证了主标签、真实 side panel target、Service Worker 和不可见临时标签。实号结果表明 canonical peerId、好友 alias、history baseline、临时标签 PING 和 `READ_ACTIVE_CONVERSATION` 均成功；真正失败发生在 `protectedTrusteeshipPageAdapter`：UI 前置检查直接读取 storage，认为 API 证明有效，但 `PlatformConfig.loadFlat()` 只投影了 proof version，遗漏 proof ok/time，导致运行时必然抛 `API_PROOF_STALE`，随后又被 engine 错归为单会话 `CONVERSATION_UNAVAILABLE`。修复把完整证明字段纳入同一 flat snapshot，并把读取竞态中的 `API_PROOF_STALE` 映射为全局 `PREREQUISITE_CHANGED`，不再消耗岗位的三次读取退避。该诊断沿用了 browser-harness / boss-agent-cli 的“稳定 ID + 分层证据 + 明确失败边界”思想，没有复制其平台写入或规避风控实现。

精确点击当前工作区扩展卡片的 `dev-reload-button` 后，运行中 `PlatformConfig.loadFlatFor` 已包含 proof ok/time；真实受保护 reader 与完整 controller 周期随后通过，结果为 `checked=1 / errors=[]`，会话保持 `WAITING_HR` 且最近检查时间已落盘、失败计数归零。自动化全量为 378/378，语法、Manifest 和 diff 校验通过。此证据只覆盖真实只读监控，不覆盖 LLM 草稿、自动发送或飞书通知。

## v0.3.6 BOSS SPA 切换后旧 URL 登记错对象修复

- [browser-use/browser-harness 的 BOSS chat skill](https://github.com/browser-use/browser-harness/blob/main/agent-workspace/domain-skills/BOSS-zhipin/chat.md) 记录的实号顺序是点击 `.friend-content` 后等待该会话的消息请求，再从 `historyMsg` 取得 `bossId`；这说明动作后的页面与网络证据必须重新观察，不能把动作前 URL 当成当前会话事实。
- [boss-agent-cli](https://github.com/can4hou6joeng4/boss-agent-cli) 当前默认低风险模式会阻断聊天读取与回复；本轮只沿用其结构化身份、平台隔离和失败关闭边界，没有可直接复制的自动回复绑定代码。
- 本地知识库 `技术复用/Electron只读采集与持久租约-Phase2B复盘.md` 的既有结论是“网络响应必须精确匹配、公共引用不能替代动作时重新证明、Replay/测试/真实平台证据必须分层”。本轮新结论是：BOSS SPA 的地址栏 `uid`、最新精确 `historyMsg bossId` 和活动会话 scoped identity 都只能作为候选证据；三者冲突时必须通过好友列表结构化身份唯一收敛，不能固定偏爱 URL 或网络中的任意一方。

真实 ego-lite 复现中，地址栏保持 `uid=2ce53…`（徐海霞），用户点击后的 selected item 与标题为谭辉，最新同源精确请求为 `historyMsg?bossId=71208…`；旧 `CAPTURE_ACTIVE_CONVERSATION` 最终仍返回 `2ce53… / 智驭信息 / 徐海霞`。根因是 `resolveOwnedConversation()` 的 `page uid || history bossId` 固定优先级。修复保留所有安全候选 ID，逐个对齐好友列表，再用活动 scoped identity 只接受唯一结构化匹配；CAPTURE 也改为先确认 canonical peer，再读取该 peer 的历史基线。若候选身份零命中或多命中则返回 `PEER_ID_UNRESOLVED`，不会猜测或登记。

## v0.3.6 已登记岗位“打开会话”假成功修复

- [browser-use/browser-harness 的 BOSS chat skill](https://github.com/browser-use/browser-harness/blob/main/agent-workspace/domain-skills/BOSS-zhipin/chat.md) 与 [geekgeekrun](https://github.com/geekgeekrun/geekgeekrun) 的聊天/提醒流程都把“找到列表项 → 点击 → 等待消息区 → 再观察目标”作为打开会话的动作证据，没有把带 `uid` 的页面 URL 本身当作会话已经激活的证明。
- 本地知识库 `技术复用/Electron只读采集与持久租约-Phase2B复盘.md` 的既有结论是：公共 DTO 或 source URL 只能定位候选资源，动作发生时仍必须重新证明资源身份。当前新增结论是：用户显式“打开会话”与后台只读监控是两条不同链路；前者允许激活焦点标签并点击唯一候选，后者必须保持无页面副作用，二者不能因共享同一 peerId 而混合验收。

旧 `TRUSTEESHIP_OPEN_CONVERSATION` 只校验存储 URL 后执行 `tabs.create({ active: true })`，随即返回 `ok: true`；BOSS SPA 不按 `?uid=` 激活会话时，用户看到的是空白消息区，后台却已报告成功。修复后 runtime 先选择当前焦点窗口的活动 Boss 聊天页，再发送独立的 `OPEN_MANAGED_CONVERSATION` 协议；content handler 按公司/岗位/HR 找到唯一列表候选并点击，随后必须同时通过 canonical peerId/alias 与 scoped identity 校验。没有唯一候选、内容脚本不可用或动作后身份不一致均返回稳定错误，不再假成功，也不会触发消息发送。没有可复用聊天页时才允许以已净化 URL 新建活动标签，页面加载后仍执行同一点击与复核协议。

回归先以三条 RED 证明旧行为：OPEN handler 缺失、runtime 错误新建标签、目标未确认仍返回成功。首次 GREEN 实号复测又发现两项真实差异：BOSS 慢切换可能超过发送链原有的 24 次等待上限；从徐海霞切回谭辉后，活动 DOM 和最新 history peer 已变化，但地址栏仍保留徐海霞旧 `uid`。OPEN 因此单独使用最多 60 次、每次 350ms 的有界等待；目标复核不再要求单一 `conversationRef.conversationId` 等于登记 ID，而是在安全 `conversationCandidateIds` 中匹配 store 的唯一 canonical peer/aliases，并继续强制 scoped company/HR identity 一致。该放宽不会接受仅有旧 URL、身份不符或候选不唯一的页面，也不影响发送前继续执行相同身份重验。

2026-07-26 最终 ego-lite 实号证据为：当前窗口同一 Boss 标签内，谭辉 → 徐海霞打开返回 `ok: true`，捕获 peer `2ce53e5a7f33b6460nF92t-0EVFT`、alias `557129133`、公司智驭信息、HR 徐海霞；随后徐海霞 → 谭辉打开同样返回 `ok: true`，虽然地址栏仍是徐海霞旧 `uid`，可见 selected item/header 与捕获结果均为江西盐选科技有限公司/谭辉，peer `71208d45ce85b0360HJ-3Ni8FVZR`、alias `764751541`。两次都复用原标签，没有新建空白聊天页，也没有发送消息。只读 alarm 与这两个 canonical peer 的受保护历史读取亦分别成功；这些证据仍不能替代真实新来信、LLM 分类、自动发送或飞书出站验收。

## v0.3.6 全局关闭时“检查 0 个已完成”误报修复

- [BullMQ Redis](https://github.com/taskforcesh/bullmq-redis) 把队列状态明确区分为 `PAUSED` 与 `RUNNING`，暂停时取任务操作不返回工作项；[Agent Zero 的 scheduler 文档](https://github.com/agent0ai/agent-zero/blob/main/docs/guides/usage.md) 同样把 disabled/running 作为可观察状态。当前实现只借鉴“调度状态必须在执行入口显式门禁”的原则，没有引入其代码或依赖。
- 本地知识库 `技术复用/Electron只读采集与持久租约-Phase2B复盘.md` 的既有结论是：门禁与真实副作用之间必须保持可证明的连续租约。当前新增结论是：手动“立即检查”也不能绕过全局运行状态；由 engine 内部静默跳过虽然没有副作用，但会产生“成功空跑”的错误产品事实。

2026-07-26 实号状态证明：两个登记会话均 `enabled=true / WAITING_HR`，但全局为 `enabled=false / paused=true / PREREQUISITE_CHANGED` 且 alarm 已清除；旧入口仍返回全零成功 summary，正是侧栏“检查 0 个已完成”的根因。新增 `checkRunningStateUnsafe()` 在手动和 alarm 两个入口先读取持久运行状态；关闭或暂停统一返回 `TRUSTEESHIP_NOT_RUNNING`，engine 调用为 0，侧栏明确引导开启并保存。回归先以 runtime/sidepanel 两项 RED 复现，再转为 GREEN；全量 `npm test` 为 386/386，全部 JavaScript 语法、Manifest JSON 与 `git diff --check` 退出 0。

扩展精确重载后，API proof、HR FAQ、风险确认和飞书 proof 均仍有效；恢复全局托管并现场运行得到 `checked=2 / newMessages=0 / pending=0 / autoSent=0 / errors=[]`，两条会话 `lastCheckedAt` 都更新且读失败计数为 0，同名 10 分钟 alarm 已重建。侧栏当前显示“正在托管 2 个岗位”和“检查 2 个”。本轮没有新消息，也没有任何 Boss 发送。

## v0.3.6 AI 托管真实外发演练

本轮先检索并对照三个开源实现：

- [Rasa](https://github.com/RasaHQ/rasa) 的 conversation-driven 测试把一组预设用户消息送入同一对话决策链，再断言动作结果；本项目据此复用生产 engine，而不是另写一套“看起来相同”的判断器。
- [Botium Bindings WebdriverIO](https://github.com/codeforequity-at/botium-bindings-webdriverio) 把合成输入和受控输出适配器放在真实对话逻辑边界之外；本项目据此让合成 HR 输入只参与一次性 AI/策略评估，不污染真实消息游标。
- [LangGraph](https://github.com/langchain-ai/langgraph) 的 interrupt / human-in-the-loop 模型把自动执行与人工确认作为显式状态；本项目据此把演练输出先持久化为 `LIVE_DRILL / PENDING`，最终 Boss 写入继续经过插件内人工确认。
- [larksuite/node-sdk](https://github.com/larksuite/node-sdk) 用于复核飞书机器人 Webhook 与交互式应用能力的边界：当前自定义 Webhook 仍是单向通知，插件不能假装从飞书按钮直接完成确认。

上述参考只用于验证架构与测试边界，没有复制其源码，也没有新增运行时依赖。当前独立实现将旧隔离模拟器升级为 `trusteeship-live-drill.js`：合成消息仍在一次性 store 中运行真实 `MonitorEngine`、受保护 AI、简历事实和策略；评估结束后才通过专用生产 store 方法创建 `origin=LIVE_DRILL` 的待确认，并复用 production notification reservation 发飞书。专用写入不得改动真实 baseline、已处理指纹、最近消息、monitor cursor 或自动回复额度。runtime 只接受精确 `{ type, conversationId, message }`，限制 ID 与 1–600 code-points 消息，并将 provider 异常收敛成稳定错误码。侧栏要求逐次勾选外发确认，结果使用 DOM 节点与 `textContent` 渲染。

飞书 payload 现在可包含经过 code-point 限长和敏感模式清洗的“模拟 HR 正文 / HR 正文”与拟回复；API Key、Webhook token、签名密钥、provider error 和未声明对象字段仍禁止外发。飞书仍不能批准；用户在插件待确认页执行 `SEND_EDITED` 后，生产 engine 才重新读取并验证目标会话，再调用真实 sender。

真实外发演练可以逐段证明 AI/策略、持久待办、飞书和人工确认发送，但不能替代真实 Boss 新来信检测。新增三周期 fixture 证明同一入站指纹的 `newMessages` 为 `0 → 1 → 0`，只生成一个 `LIVE_MONITOR` 待办、一次通知且确认前发送为 0；实号监控最终仍必须由登记 baseline 之后真正到达的一条 HR 消息验证。推荐固定演练样本为“还在看机会吗？”“薪资是多少？”“不合适”“经验可能不太匹配”。

## v0.3.6 方向误判、可见页真实发送与未知待办清理

本轮继续对照 [browser-use/browser-harness](https://github.com/browser-use/browser-harness) 的“真实浏览器动作后观察证据”、[boss-agent-cli](https://github.com/can4hou6joeng4/boss-agent-cli) 的平台边界与人工写入门禁，以及 [GeekGeekRun](https://github.com/geekgeekrun/geekgeekrun) 的 Boss 消息适配记录。开源样本可以提供候选字段和动作顺序，但不能替代当前账号、当前接口版本的双向实号对照；本地知识库 `技术复用/浏览器扩展-AI会话托管可靠性复盘.md` 的既有结论“未知发送是终态、不得自动重放，成功必须有新 outgoing 正证据”继续作为安全边界。

真实演练首次从扩展自建的 inactive 临时页执行后进入 `SEND_RESULT_UNKNOWN`，Boss 页面没有新的 outgoing。经用户对精确 HR 和精确草稿授权，只在可见活动 Boss 页重试一次，15:44 出现 `[送达] 是的，仍在看机会。`。随后对该会话和一条已知拒绝会话读取原始历史：本人发出的三条消息、HR 发出的“不合适”以及刚发送成功的草稿全部为 `received=true`；可靠区别是 `from.uid/to.uid` 与好友列表对端数字 `uid` 的关系。由此确认两个独立根因：

1. `received` 在当前接口不是方向字段，旧 parser 会把本人 outgoing 误判为 incoming，也会错过发送后的 outgoing 正证据；
2. inactive 临时标签虽适合无副作用读取，却没有产生可靠的真实输入/发送动作；写路径必须绑定用户当前 active 的 Boss chat 标签并在每个动作前重验。

修复在登记 ref 中同时持久化 canonical `encryptUid` 和数字 `peerUid`；历史方向严格按 `from.uid === peerUid` 为 incoming、`to.uid === peerUid` 为 outgoing，两边都不成立或同时成立就失败关闭。旧记录可用 canonical peer 在好友列表唯一补齐 `peerUid`。只读仍可复用可见页或回退 inactive 临时页；sender 则只接受当前焦点窗口的 active Boss chat 页，找不到或中途失活均返回未知，不创建隐藏写入页。该设计没有复制开源源码，也没有引入私有发信协议。

`SEND_RESULT_UNKNOWN` 仍是不可重放的发送意图终态，但不应永久堵住侧栏。新增独立的 `TRUSTEESHIP_ACK_UNKNOWN_SEND` 人工核对协议：只在 approval、owner 会话和 UNKNOWN intent 三者精确链接时，删除插件本地待确认、解除该会话暂停；UNKNOWN intent 保留终态，不会重新可消费。侧栏按钮明确写为“已核对，清除此项”，确认文案说明不会发送、不会删除 Boss 消息。普通待办的 `NO_REPLY` 文案同步改为“不回复并移除”，避免用户把它误解为删除站内消息。

## v0.3.6 真实 BOSS 编辑器作用域修复

本轮继续参考 [browser-use/browser-use](https://github.com/browser-use/browser-use) 对浏览器动作“先定位可见可交互控件、动作后重新观察”的边界，以及 [boss-agent-cli](https://github.com/can4hou6joeng4/boss-agent-cli) 对写操作默认阻断和诊断分层的设计。参考项目只用于确定动作与证据边界，没有复制其代码、没有调用 BOSS 私有发信协议。

ego-lite 对徐海霞会话的精确单次发送排查得到三组现场证据：活动标签、canonical peer/alias、目标身份和历史读取全部成功；页面观察器没有记录到 input、Enter 或消息 DOM mutation；真实结构为 `.chat-record → .message-content → .chat-conversation`，而 `#chat-input` 与 `button.btn-send` 位于 `.chat-conversation` 的另一个分支。旧实现直接使用 `container.parentElement` 作为输入控件查询范围，因而在任何外部动作前就返回选择器失败，上层再保守收束为 `SEND_RESULT_UNKNOWN`。

修复保留消息读取用的直接父级 `pane`，另从消息容器向上有界查找同时包含输入框与发送按钮的最近共同 `controlPane`。控件查找只在该共同祖先内进行，要求输入框和按钮各自唯一；发送前重验还要求原 `pane`、`controlPane`、输入框和按钮对象全部未变化。新增 fake DOM 回归先以真实的兄弟分支结构复现 `SELECTOR_UNAVAILABLE`，再转为成功发送证据；另加双输入/双按钮歧义用例，确认动作数为 0 且以 `TARGET_UNCERTAIN` 失败关闭。该修复不会全页面查找第一组控件，也不会重放已经进入 UNKNOWN 的意图。模块回归为 49/49，全量自动化为 411/411；JavaScript 语法、Manifest 和 diff 检查均通过。扩展重载后的实号只读探针确认：depth 0 的 `.message-content` 为 0 个输入/0 个按钮，depth 1 的 `.chat-conversation` 恰好为 1 个输入/1 个按钮，修复会选择后者且未触发任何发送。

## v0.3.7 AI 明确拒绝分类契约

本阶段继续对照 [Rasa](https://github.com/RasaHQ/rasa) 的 NLU/对话动作分层与 [LangGraph](https://github.com/langchain-ai/langgraph) 的显式状态、人工确认边界：模型负责给出受限结构化判断，确定性运行时只验证输出形状并决定后续动作。本地知识库 `技术复用/浏览器扩展-AI会话托管可靠性复盘.md` 的既有结论仍是“未知发送必须终态且不得自动重放、成功需要新 outgoing 正证据”；本轮新增结论是“明确拒绝的语义识别可以完全交给 AI，但输出必须落入独立类别和严格字段契约，不能让模型自由文本直接取得发送权限”。

`ReplyAI` 新增 `explicit_rejection` 类别。分类提示要求 AI 独立判断语义，使用 `reasonCode=EXPLICIT_REJECTION`、空 `evidenceIds` 和空 `fieldsNeeded`；代码没有新增 HR 正文关键词或正则分类器。草稿阶段只投影有界分类摘要，并且只有当前分类上下文确认为 `explicit_rejection` 时才允许空简历依据；其他事实或普通回复仍保留非空 evidence 要求。拒绝示例和礼貌结束语只存在于模型提示中，不参与本地分类覆盖。该提交尚未授权真实自动结束，后续仍需策略、状态机、静默延迟和发送证据门。

策略阶段延续 [Open Policy Agent](https://github.com/open-policy-agent/opa) 的“结构化输入与确定性授权分离”思路：`TrusteeshipPolicy` 不重新解释 HR 正文，只验证 AI 分类的类别、原因码、置信度和空字段形状。严格命中时返回 `AUTO_CLOSE`，静默时段返回 `DEFER_AUTO_CLOSE`；全局/单会话授权和活动待办仍先行，普通自动回复日限不参与结束动作。另一个确定性校验器只检查将要外发的 AI 结束语是否短、单行、礼貌且不包含问题、争取、经历推销或承诺，因此没有变相加入拒绝关键词分类。该阶段 19 项 policy 测试先 RED 后 GREEN；状态持久化和真实发送仍在后续任务中完成。

持久化阶段复用本地知识库 `技术复用/浏览器扩展-AI会话托管可靠性复盘.md` 的既有外部副作用结论，并继续对照 [AWS Transactional Outbox 示例](https://github.com/aws-samples/transactional-outbox-pattern) 与 [BullMQ](https://github.com/taskforcesh/bullmq) 的意图/恢复边界：先原子写入唯一意图，再执行页面写入；Worker 中断只收束为未知终态，不把幂等键误当成可以安全重试的证明。本轮新增 `WAITING_AUTO_CLOSE`、`ENDED_UNMATCHED` 和 `AUTO_CLOSE` intent；延迟对象绑定当前 incoming 指纹、45 字内冻结草稿、置信度和时间，损坏或跨状态字段不会被信任。

`AUTO_CLOSE` 复用现有发送肯定证据和 `SEND_RESULT_UNKNOWN` 终态，但从普通 AUTO 额度预留、成功计数、未知计数及 fresh Worker 恢复计数中完全排除。成功时会话关闭为 `ENDED_UNMATCHED` 并保留 `AUTO_CLOSE/SENT` 证据；只有显式重新托管才能恢复。存储与恢复聚焦测试为 75/75，覆盖完整/损坏延迟状态、即时和延迟意图、满额度成功、未知结果、Worker 恢复、重置及重新托管。

监控引擎即时路径继续沿用 [Rasa](https://github.com/RasaHQ/rasa) 的“同一对话决策链跑真实动作”边界、[LangGraph](https://github.com/langchain-ai/langgraph) 的显式终态，以及 [Open Policy Agent](https://github.com/open-policy-agent/opa) 的模型判断与确定性授权分层：可靠文本即使没有简历事实也会先分类，但只有严格 `explicit_rejection` 允许空依据；结束语还要经过独立确定性校验和发送前最新快照二次策略门。非静默命中后引擎先创建唯一 `AUTO_CLOSE` intent，再复用现有 Boss sender 和肯定证据收束为 `ENDED_UNMATCHED`；满普通额度仍可执行且计数不变，第二周期不会再读取或发送。草稿失败、不安全草稿和 provider 异常全部降级为不含原始内容的本地待办，未知发送进入不可重放的 `SEND_RESULT_UNKNOWN`。该即时路径落地时监控引擎聚焦测试为 53/53。

静默调度阶段继续借鉴 [BullMQ](https://github.com/taskforcesh/bullmq) 的延迟任务必须持久化并在执行时重新验证状态、[LangGraph](https://github.com/langchain-ai/langgraph) 的可恢复显式节点，以及 AWS outbox 的“意图先于副作用”边界。`DEFER_AUTO_CLOSE` 只保存当前指纹、已验证的冻结结束语和置信度；`WAITING_AUTO_CLOSE` 被纳入只读轮询，但静默期间不重复调用 AI、不创建通知或发送意图。静默结束后先读取同一会话：零增量才重验草稿、授权和精确指纹并创建 `AUTO_CLOSE` intent；存在更新来信则先原子取消旧延迟对象，再处理新消息。checkpoint 现可在精确匹配延迟指纹时更新检查时间而不清除延迟对象。引擎与 store 联合测试为 122/122，覆盖静默内重复检查、跨日唤醒、新消息取消、新 engine 实例恢复及额度保持为零。

演练与 UI 阶段继续采用 Rasa 对话测试“生产决策链、隔离外部动作”的做法：一次性 store 中真实运行 engine，隔离 sender 只记录 `AUTO_CLOSE` 模式和草稿；投影可报告 `wouldSend=true`，但生产侧始终只创建 `LIVE_DRILL/PENDING`，不会创建或复制隔离发送意图。runtime 的会话状态改为固定 allowlist，侧栏显示 `WAITING_AUTO_CLOSE=等待静默结束后礼貌回复`、`ENDED_UNMATCHED=已结束－未匹配`；结束卡不计入活跃托管数量、没有开关或重试，仅可打开或移除。五组 runtime/live-drill/sidepanel/background 聚焦回归为 112/112。

完全依赖 AI 判断明确拒绝意味着语义误判风险不会被本地拒绝关键词规则兜底：假阳性可能提前发送礼貌结束语，假阴性则进入普通人工确认或其他分类。本项目接受用户选择的这一权衡，但没有把自由文本直接等同于发送权限；确定性层仍只接受精确类别、原因码、`>=0.90` 置信度、空 evidence/fields 形状，并独立限制结束语、静默延迟、最新消息重读、唯一 intent、目标证明和未知发送终态。若后续需要降低假阳性，应调高结构化置信阈值或恢复人工确认，而不是增加隐藏的关键词覆盖。

2026-07-26 最终分支验证：`npm test` 为 433/433；仓库内全部 JavaScript 通过 `node --check`，Manifest JSON 可解析，当前工作树与 `main...HEAD` 均无 `git diff --check` 错误。完整差异复核确认：HR 正文没有新增关键词/正则拒绝分类器；本地正则只校验拟外发结束语；`AUTO_CLOSE` 不参与普通额度 reservation、成功计数、未知计数或 Worker 恢复计数；`ENDED_UNMATCHED` 不进入 engine 读取；live drill 只使用隔离 sender，并且生产侧只能写 `LIVE_DRILL/PENDING`。

浏览器验收按无外发边界执行：已在新建 ego-lite Agent 任务空间重载扩展，并确认新版侧栏存在 `AUTO_CLOSE` 演练投影和“当前尚未发送给 HR”提示。该隔离空间不继承用户窗口中的扩展本地存储，因此没有 API 配置和已登记会话，无法运行真实 AI 演练；尝试只读接入现有用户窗口时，扩展管理页原生菜单阻断了可靠自动操作，已停止而未创建待办、未发飞书、未写 Boss，并关闭隔离任务空间。自动化 live-drill 回归覆盖合成明确拒绝并证明 `AUTO_CLOSE / EXPLICIT_REJECTION_AUTO_CLOSE / wouldSend=true / sentToBoss=false`，但不能替代真实新来信生产验收。

## v0.3.7 审核页自动登记“未知公司/无法打开”修复

- [GeekGeekRun](https://github.com/geekgeekrun/geekgeekrun) 明确提示其页面交互会随 BOSS DOM 变化而失效，本轮只借鉴“页面适配层必须可替换”的边界。
- [Chrome 扩展 Service Worker 迁移文档源码](https://github.com/GoogleChrome/developer.chrome.com/blob/main/site/en/docs/extensions/migrating/to-service-workers/index.md) 要求 MV3 使用持久存储而不是 Worker 内存作为事实源；[消息传递文档源码](https://github.com/GoogleChrome/developer.chrome.com/blob/main/site/en/docs/extensions/mv3/messaging/index.md) 要求把 content script 数据视为不可信并在边界验证。当前实现据此把“规范会话引用 + 结构化好友身份”作为登记事实，而不是直接信任审核卡片。
- 本地知识库 `技术复用/浏览器扩展-AI会话托管可靠性复盘.md` 的既有结论是“先 canonical ID 对齐，再读取结构化 friend-list 字段，DOM 仅补缺；打开成功需要动作后重新证明”。本轮新诊断是：旧自动联系路径虽然已经解析出规范身份，却在 `captureManagementMetadata → background.registerConversation` 跨层传递中丢掉了公司、岗位、联系人和 `peerUid`；`WAITING_HR` 因而只是本地状态，不是可打开性的证据。

修复新增纯函数登记边界，规范聊天元数据优先、审核卡片回退，并防止空回退覆盖已知身份。打开路径携带 `peerUid`，先按 canonical peerId 唯一恢复好友结构化身份，再定位唯一列表候选并执行 canonical/alias + scoped identity 复核；成功后 runtime 原地回写，惰性修复旧“未知公司/联系人错位”记录。没有引入开源运行时、没有复制选择器或平台写入代码，也没有新增真实发送路径。

2026-07-27 ego-browser 验收先把页面切到另一位 HR，再用“canonical peerId 正确、公司为空、联系人误存公司名、缺少 peerUid”的旧记录打开目标。任务空间内扩展精确重载后，页面切回正确 HR，handler 返回规范公司、联系人、数字 peerUid 和同一 canonical 引用；动作后的 selected item 与最新 `historyMsg bossId` 同时支持该结果。验收没有触发任何外部写入。测试过程中还确认：仅重载网页不足以替换已经安装实例中的旧 content listener，开发验收必须先精确重载对应浏览器上下文里的扩展，再重载目标页，否则会把旧代码行为误判为新代码失败。

## v0.3.5 Task 9 恢复、幂等与隐私回归参考

- [Chrome Extension Service Worker 迁移文档源码](https://github.com/GoogleChrome/developer.chrome.com/blob/main/site/en/docs/extensions/migrating/to-service-workers/index.md) 与 [GoogleChrome/chrome-extensions-samples](https://github.com/GoogleChrome/chrome-extensions-samples)（Apache-2.0）用于复核 MV3 Worker 会被终止、持久存储应作为事实源、事件监听应在顶层注册，以及周期任务应使用具名 `chrome.alarms`。本项目据此验证同名 `boss-ai-chat-monitor` 只表达一个逻辑 alarm，并验证旧 `scheduledTime` 事件只触发一次当前周期。
- [BullMQ](https://github.com/taskforcesh/bullmq)（MIT）和其 [locked jobs](https://github.com/taskforcesh/bullmq-redis) 说明自定义 job ID 可做队列期内去重，但锁丢失/任务 stalled 时仍可能重新处理，不能把“唯一 ID”误认为外部副作用的 exactly-once。Boss 恢复因此先处理任何 `sendIntent.status === SENDING`：未知终态、AUTO 额度一次、绝不重放，之后才允许判断 `CLASSIFYING` 证据。
- [AWS Transactional Outbox 示例](https://github.com/aws-samples/transactional-outbox-pattern)（MIT-0）说明业务状态和消息通知的双写会产生不一致，消费者仍需按消息 ID 幂等处理；[MassTransit](https://github.com/MassTransit/MassTransit)（Apache-2.0）用于交叉检查 outbox/inbox 的持久 reservation 边界。本项目据此保留“先落本地待办/通知 reservation，再尝试飞书”的顺序，并在 RESERVE、engine 二次快照和 notifier 内部 await 后分别验证唯一 owner/link；任何阶段失效都不外发。
- [AWS SDK for JavaScript v3](https://github.com/aws/aws-sdk-js-v3)（Apache-2.0）的 middleware lifecycle 将签名归入 `finalizeRequest`、网络请求归入 HTTP handler，说明“准备完整请求”和“实际 dispatch”可以保持为两个明确阶段。本项目只借鉴该分层原则：飞书 client 完成异步签名和序列化后交出同步 fetch thunk，runtime 在最新持久状态门禁后才 dispatch；background 组合层同步串联 API-proof 与调用方 owner 断言，不能用前者覆盖后者。没有复制 AWS SDK 代码或引入依赖。

上述项目均为参考依据，没有复制源代码、没有新增运行时依赖。Task 9 的具体新增实现——`SENDING` 恢复优先级、`classificationBaseline + classificationOriginState` 严格证据、单会话唯一 PENDING 门禁、固定且不含模型自由文本的飞书卡片、签名后 prepared dispatch 门禁、pause-code/reason 双层归一化、settings 逐字段公共 DTO、统一元数据清理及实际 store/engine/runtime/sidepanel 组合测试——均为本仓库独立实现。

## v0.3.8 持续多轮托管与列表自动同步

- [AWS Transactional Outbox Pattern](https://github.com/aws-samples/transactional-outbox-pattern)：采用“持久意图先于外部发送”，但不把唯一 intent ID 误当成站外 exactly-once 保证。
- [Temporal](https://github.com/temporalio/temporal) 与 [LangGraph](https://github.com/langchain-ai/langgraph)：采用显式、可恢复的等待节点，把随机回复时刻作为持久业务状态，而不是依赖 Service Worker 内存计时器。
- [Plasmo](https://github.com/PlasmoHQ/plasmo) 与 [WXT](https://github.com/wxt-dev/wxt)：采用扩展页面把 storage change 当作失效通知、重新读取可信公共状态的同步边界；当前实现仍使用原生 Chrome API，没有引入框架。

用户实测表明“发送后约 0.1 秒没有回执就暂停”不符合持续托管产品语义。修复后，普通安全回复持久化 30–300 秒随机 due time，到点重读后才发送；成功后回到 `WAITING_HR`，不会因完成一轮回复而退出。明确拒绝仍单次礼貌结束为 `ENDED_UNMATCHED`，批量开启明确跳过该状态。

发送结果未知被拆成“原 intent 不可重放”和“会话仍可只读核验”两个正交事实。content sender 在发送动作后有界轮询历史回执；仍未知时 store 进入 `VERIFYING_SEND`，后续周期通过独立 `VERIFY_MANAGED_SEND` 查找同一 canonical peer 上、同一冻结草稿且晚于意图创建时间的唯一 outgoing。命中后原子收束为 SENT 并恢复 `WAITING_HR`；没有证据时保持核验，不再次按 Enter 或点击发送。

“一键托管全部可用岗位”只发送一次严格 runtime 消息并由 store 原子处理，不在 UI 循环单卡操作。岗位筛选页联系成功产生的 `managedConversations` 写入会触发 150ms 合并刷新，sidepanel 重新读取 runtime DTO 并重绘卡片；刷新不覆盖用户尚未保存的表单值。该实现对应本地知识库 `技术复用/浏览器扩展-AI会话托管可靠性复盘.md` 的既有“持久事实源 + 不盲重放”结论；“核验与托管状态正交、未知发送后可恢复持续监控”是本轮新增结论。

## 岗位筛选 UI 命名

- [boss_batch_push](https://github.com/yangfeng20/boss_batch_push) 把批量联系前的步骤描述为先筛选、再确认投递目标。
- [get_jobs](https://github.com/loks666/get_jobs) 以 AI 匹配和岗位筛选组织求职流程。

当前 UI 因此把用户可见的“审核”统一改为“岗位筛选”，同时保留内部 `review` 状态键，避免纯产品文案调整扩大为状态机迁移。
