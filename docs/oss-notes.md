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
| `src/sidepanel.*` | 配置 / 审核 / 执行 |

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
| 单页折叠卡片 UI | 底栏三 Tab：配置 / 审核 / 执行 |

## 多平台进展（v0.3）

- 产品名：**求职联系助手**
- `src/platform/registry.js`：Boss / 智联 / 猎聘注册表（JobsIn 式）
- `src/platform/config.js`：`activePlatform` + `byPlatform` 分平台日限/招呼语
- `src/platform/boss/*`：现网 Boss 脚本迁入
- 智联：`ready: true`，MVP 已包含列表扫描和单岗位投递/沟通，仍需测试账号真机验收。
- 猎聘：`ready: false`，UI 可选、扫描禁用，待 M4 真机适配。

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

## v0.3.5 Task 9 恢复、幂等与隐私回归参考

- [Chrome Extension Service Worker 迁移文档源码](https://github.com/GoogleChrome/developer.chrome.com/blob/main/site/en/docs/extensions/migrating/to-service-workers/index.md) 与 [GoogleChrome/chrome-extensions-samples](https://github.com/GoogleChrome/chrome-extensions-samples)（Apache-2.0）用于复核 MV3 Worker 会被终止、持久存储应作为事实源、事件监听应在顶层注册，以及周期任务应使用具名 `chrome.alarms`。本项目据此验证同名 `boss-ai-chat-monitor` 只表达一个逻辑 alarm，并验证旧 `scheduledTime` 事件只触发一次当前周期。
- [BullMQ](https://github.com/taskforcesh/bullmq)（MIT）和其 [locked jobs](https://github.com/taskforcesh/bullmq-redis) 说明自定义 job ID 可做队列期内去重，但锁丢失/任务 stalled 时仍可能重新处理，不能把“唯一 ID”误认为外部副作用的 exactly-once。Boss 恢复因此先处理任何 `sendIntent.status === SENDING`：未知终态、AUTO 额度一次、绝不重放，之后才允许判断 `CLASSIFYING` 证据。
- [AWS Transactional Outbox 示例](https://github.com/aws-samples/transactional-outbox-pattern)（MIT-0）说明业务状态和消息通知的双写会产生不一致，消费者仍需按消息 ID 幂等处理；[MassTransit](https://github.com/MassTransit/MassTransit)（Apache-2.0）用于交叉检查 outbox/inbox 的持久 reservation 边界。本项目据此保留“先落本地待办/通知 reservation，再尝试飞书”的顺序，并在 RESERVE、engine 二次快照和 notifier 内部 await 后分别验证唯一 owner/link；任何阶段失效都不外发。
- [AWS SDK for JavaScript v3](https://github.com/aws/aws-sdk-js-v3)（Apache-2.0）的 middleware lifecycle 将签名归入 `finalizeRequest`、网络请求归入 HTTP handler，说明“准备完整请求”和“实际 dispatch”可以保持为两个明确阶段。本项目只借鉴该分层原则：飞书 client 完成异步签名和序列化后交出同步 fetch thunk，runtime 在最新持久状态门禁后才 dispatch；background 组合层同步串联 API-proof 与调用方 owner 断言，不能用前者覆盖后者。没有复制 AWS SDK 代码或引入依赖。

上述项目均为参考依据，没有复制源代码、没有新增运行时依赖。Task 9 的具体新增实现——`SENDING` 恢复优先级、`classificationBaseline + classificationOriginState` 严格证据、单会话唯一 PENDING 门禁、固定且不含模型自由文本的飞书卡片、签名后 prepared dispatch 门禁、pause-code/reason 双层归一化、settings 逐字段公共 DTO、统一元数据清理及实际 store/engine/runtime/sidepanel 组合测试——均为本仓库独立实现。
