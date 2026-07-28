# 求职联系助手 · 多平台设计方案与 TODO

> 状态：**M1/M2 已落地**；**M3 智联适配器 MVP 已落地**（列表扫描 + 沟通/投递）；P0 批次信任闸门自动验收已通过；当前发布范围固定为 Boss / 智联
> 基线产品：Chrome 侧边栏扩展（Fork JobCopilot）  
> UI 原型：Canvas `multi-platform-ui-design.canvas.tsx`  
> 日期：2026-07-24

---

## 0. 已拍板决策

| # | 议题 | 结论 |
|---|------|------|
| 1 | 产品名 | **求职联系助手** |
| 2 | 平台入口 | **配置页双卡片**（Boss / 智联） |
| 3 | 混合勾选多平台 | **否** — 同时只跑一个平台；切换清空勾选 |
| 4 | 招呼语 / 日限 | **每平台各存一份** |
| 5 | 未登录横幅 | **与 Boss 同款**（文案换域名即可） |

不变红线：半自动（默认不选 → 联系已选）、BYOK、拟人化降风险、验证码/上限 **停机不破解**。

---

## 1. 产品一句话

在已登录的招聘站点页，用侧边栏完成：**选平台 → 扫描 → AI/规则打分 → 人工勾选 → 仅对已选岗位逐个发起沟通**。  
当前支持 **Boss（已有）→ 智联**；不做全自动海投、不做多平台并行队列。

---

## 2. 尽量不重复造轮子：开源借鉴地图

### 2.1 直接复用（本仓库已有，勿重写）

| 模块 | 来源 | 做法 |
|------|------|------|
| 扩展壳 / SW 编排 / 侧边栏三 Tab | JobCopilot Fork | 只加「平台」配置步与适配器路由 |
| 拟人化：`humanize.js`、日限、批次休息、操作锁 | boss_batch_push / BossAssistant / boss-autogreet 思路 | **全局共用**，各平台只调参数 |
| BYOK + 规则/LLM 筛选 | 现有 `background.js` | 筛选输入改为「当前平台配置」 |
| 登录横幅 / 风险告知 / 审核默认不选 | 现有 UI | 文案模板化，按平台换 host |

### 2.2 架构借鉴（抄接口形状，不整仓搬）

| 开源 | 形态 | 借鉴什么 | 不照搬什么 |
|------|------|----------|------------|
| [Chinaduanyun/JobsIn](https://github.com/Chinaduanyun/JobsIn) | Web + MV3，Boss 已实现，智联/猎聘 **接口预留** | `BaseScraper` 式：`scrape` / `openDetail` / `contact` / `sendGreeting`；平台注册表 | 不引入其 FastAPI 后端与「一键全投」 |
| [CSUlyc/BossAssistant](https://github.com/CSUlyc/BossAssistant) | MV3 React | 半自动沟通、弹窗、日限、去重 key、本地记录 | UI 仍用我们的三 Tab + 平台卡片 |
| [loks666/get_jobs](https://github.com/loks666/get_jobs) | Java 多平台脚本 | **业务知识**：智联需指定默认简历；猎聘打招呼与主动发消息上限不同；城市/薪资过滤字段 | 不迁 Java/Selenium；不复制全自动海投 |
| [yangfeng20/boss_batch_push](https://github.com/yangfeng20/boss_batch_push) | 油猴 | 不活跃 Boss 过滤、投递锁 | 仅 Boss；逻辑已部分落地 |
| Auto-JobHunter / 油猴「Boss+智联」脚本 | RPA / Userscript | 真机选择器与流程线索（调研期对照） | **不**用 Stealth 强对抗；不合并成全自动脚本 |

### 2.3 明确不造 / 不做

- 不为多平台重写扩展脚手架（继续 MV3 + sidePanel）
- 不自建后端代理、账号体系
- 不把 get_jobs / Auto-JobHunter 整仓嵌进扩展
- 不做验证码破解、指纹伪造
- Phase 1 不做前程无忧 / 拉勾（JobsIn 虽预留，排期靠后）

---

## 3. 目标架构（适配器模式）

```text
┌──────────────┐     message      ┌─────────────────┐
│  Sidepanel   │ ←──────────────→ │ Service Worker  │
│ 平台卡片+三Tab │   命令/状态/日志  │ 队列·限速·LLM   │
└──────────────┘                  └────────┬────────┘
                                           │ platformId
                    ┌──────────────────────┴──────────────────────┐
                    ▼                                             ▼
            platform/boss/*                              platform/zhilian/*
            selectors+content                            selectors+content
            (已有，整理迁入)                               (已实现)
```

**统一适配器接口（建议 TypeScript 或 JSDoc 约定）：**

```text
PlatformAdapter {
  id, display, hosts[], listUrlPatterns, chatUrlPatterns
  buildSearchUrl(cfg) → string
  scrape(opts) → { jobs[], skippedInactive? }
  openDetail(job) → { jd?, blocked?, needLogin? }
  startContact(job) → { success, blocked?, needLogin? }
  sendGreeting({ greeting, image? }) → { success, blocked? }
  detectLogin() / detectBlock()
  defaultFilterFields()  // 平台专属筛选项 schema
}
```

新增平台 = 实现一套 adapter + selectors + content scripts + manifest matches，**不改**审核/执行主状态机。

---

## 4. UI / 交互规范（对齐拍板）

### 4.1 命名与顶栏

- 扩展名 / 侧栏标题：**求职联系助手**
- 顶栏右侧 Pill：当前平台短名（Boss / 智联）
- 今日用量：显示 **当前平台** 的 `今日 N/M`（因日限每平台独立）

### 4.2 配置三子页

1. **平台**：双卡片单选；切换 → 清空 `selectedIds` + 提示「已切换，请重新扫描」
2. **API**：全局一份 BYOK（不按平台拆 Key）
3. **求职设置**（原「筛选限速」）：读 `settings.byPlatform[platformId]` + 全局简历材料  
   - 求职意向：关键词、城市、包含/排除  
   - 简历材料：简历要点、简历图片（从 API 页迁出）  
   - 平台条件：Boss 活跃天数；智联经验/学历
   - 招呼语、扫描数、日限、间隔、批次休息

主按钮文案：`保存并扫描{平台短名}`

智联筛选实现约束：

- 搜索 URL 的 `jl` 必须使用智联数字城市 ID；不得直接填中文城市名。
- 地点、工作经验、学历必须在扫描结果上再次校验，防止站点重定向、缓存或 DOM 异常导致筛选失效。
- 未识别城市采用失败关闭：停止扫描并提示，不允许退化为全国岗位。
- 经验、学历按职位卡展示值精确匹配；未填写时不限制。

### 4.3 审核 / 执行

- 审核列表 **仅当前平台** 岗位；行上平台徽标可保留（防误读）
- 默认不选；「联系已选」未选禁用
- 点职位名 → 在对应站点 tab 打开详情（沿用现逻辑，按 job.link host）
- 执行日志前缀带平台短名；停机原因同款（验证码 / 日限 / 登录）

### 4.4 未登录横幅（同款）

模板：`尚未检测到 {平台} 登录态。请先在浏览器打开并登录 {host}，再扫描。`

---

## 5. 存储 Schema（每平台配置）

```text
activePlatform: 'boss' | 'zhilian'

api: { provider, apiKey, baseUrl, resumeText, resumeImage }  // 全局

byPlatform: {
  boss:    { keyword, city, includeKeywords, excludeKeywords, count,
             dailyLimit, intervalMinSec, intervalMaxSec, batchSize,
             batchRestMinSec, batchRestMaxSec, greetingTemplate,
             filterInactive, activityMaxDays,
             contactDay, contactCount, processed{} }
  zhilian: { ...公共, experience, education, contactDay, contactCount, processed{} }
}

riskAccepted: boolean
sw_jobs / sw_screened: 带 platformId，切换平台不混用
```

---

## 6. 平台差异（实施时必读）

| | Boss（现网） | 智联 |
|--|-------------|------|
| 主站 | zhipin.com | zhaopin.com |
| 主操作 | 立即沟通 | 立即申请 / 聊一聊（真机确认） |
| 上限注意 | 沟通次数 / 验证码 | 日投上限约百级；需默认简历（get_jobs） |
| MVP 联系语义 | 沟通 + 招呼语 | 优先「聊一聊/沟通」路径；申请类若需简历附件则 Phase 2 |
| 选择器 | 已有 | 已实现，仍需真机持续验收 |

文案统一用「联系」，避免对用户说「海投」。

---

## 7. 实施 TODO（可执行）

### Phase M0 · 方案锁定与调研（0.5–1 天）【当前】

- [x] UI 决策：1B / 2卡片 / 3否 / 4每平台 / 5同款
- [x] 你确认本设计方案无大改
- [x] Clone/浏览对照：JobsIn（adapter 形状）、get_jobs 智联说明、BossAssistant
- [ ] 真机：智联列表页 / 详情 / 沟通按钮截图 + 初选 selectors
- [x] 更新 `docs/oss-notes.md` 增加多平台借鉴段（方案通过后）

### Phase M1 · 架构抽取（1–2 天）— **不改用户可见行为**

- [x] 产品改名：manifest / sidepanel / README → **求职联系助手**
- [x] 抽出 `platform/types` + `platform/registry`（先只注册 boss）
- [x] 将现有 Boss content/selectors 迁到 `platform/boss/`（或等价目录），SW 经 registry 调用
- [x] storage 改为 `activePlatform` + `byPlatform.boss`（迁移旧配置一次）
- [ ] 回归：Boss 扫描 / 审核 / 联系 / 日限 / 跳转详情 与现网一致

### Phase M2 · UI：平台卡片 + 每平台配置（1 天）

- [x] 配置子页：平台 / API / 筛选（对齐 Canvas）
- [x] 切换平台清空选择 + 提示
- [x] 顶栏 Pill + 当前平台今日 N/M
- [x] 未登录横幅模板化
- [x] 筛选页按平台显示专属字段（Boss 活跃度；智联经验/学历）

### Phase M3 · 智联适配器 MVP（2–4 天）

- [x] manifest：`*://*.zhaopin.com/*` host + content_scripts
- [x] `platform/zhilian`：selectors、scrape、openDetail、startContact、sendGreeting、detectLogin/Block（主路径立即投递；网页聊可用则发招呼）
- [x] 借鉴 get_jobs：默认简历提示；日限独立
- [x] 复用 humanize + 审核/执行状态机
- [ ] 真机验收：登录 → 扫描 → 勾选 1–2 → 联系 → 停机场景

### Phase M3.1 · 智联筛选完整性修复（2026-07-24）

- [x] 复现旧 URL：`jl=杭州` 被重定向为无效路由段，返回跨城市职位。
- [x] 改用数字城市 ID；杭州为 `653`。
- [x] 扫描消息携带 `city / experience / education`。
- [x] 从职位卡解析 `location / experience / education` 并做二次过滤。
- [x] 未知城市停止扫描，修复同类“静默按全国搜索”风险。
- [x] 增加纯函数与集成契约测试。

### Phase M5 · 打磨（1–2 天）

- [x] README：多平台安装、风险、开源致谢与许可证
- [x] 选择器失效可读错误
- [x] 无 Key / 有 Key 规则分支具备自动化安全测试；真实站点 happy path 仍需测试账号验收
- [ ]（可选）联系记录按平台分 tab / 导出

### 明确排期外（不做进本轮）

- [ ] 前程无忧 / 拉勾
- [ ] 多平台同时扫描或混合勾选
- [ ] HR 自动回复（BossAssistant Phase 2）
- [ ] 独立后端 / Playwright 桌面端（JobsIn / Auto-JobHunter 路线）

---

## 8. 工作量粗估

| 阶段 | 人日 |
|------|------|
| M0 确认 + 真机调研 | 0.5–1 |
| M1 架构抽取（Boss 行为不变） | 1–2 |
| M2 多平台 UI + 每平台存储 | 1 |
| M3 智联 | 2–4 |
| M5 打磨 | 1–2 |
| **合计** | **约 6–10 人日** |

实施顺序：**M1 → M2 → M3**（先抽层再铺平台）。

---

## 9. 验收标准（多平台 DoD）

1. 名称显示为「求职联系助手」；配置页双卡片可选 Boss / 智联
2. 同时只能激活一个平台；切换后勾选清空，审核列表不混平台  
3. API Key 全局一份；招呼语与日限 **每平台独立** 且刷新后仍在  
4. 未登录横幅同款样式，host 随平台变化  
5. Boss 原有能力不回退；智联可完成「扫描 → 勾选 → 联系已选」
6. 遇验证码/日限停机；README 含风险与开源致谢  

---

## 10. 后续工作

- 用测试账号完成 Boss / 智联单岗位真机验收和停机场景录制。
- 发布前检查 Chrome 权限提示、未签名加载流程与风险文案。

---

## 11. v0.3.5 运行安全实现

### 11.1 单次发送与目标身份

- `src/message-send.js` 统一 Boss / 智联发送协议。
- 先执行回车并等待“输入框清空或己方消息增加”；只有无证据时才点击一次发送按钮。
- 发送简历图片和文字前，当前活动会话必须命中目标岗位、公司或 HR；不再回退会话列表第一项。
- 消息通道在发送阶段关闭时视为结果未知，不自动重发，避免重复招呼。

### 11.2 固定平台运行与原子记账

- 运行开始时对配置做深拷贝快照，固定 `platformId`、日限与筛选参数。
- 运行期间禁用平台卡片和会话重置，后台同时拒绝岗位 `platform` 与 run 不一致的输入。
- `GO_CHAT` 成功或已进入不确定外部终态后，通过一次 storage 写入同时更新 `processed` 和 `contactCount`。
- “建联”和“发送招呼语”分别记录；后者失败不撤销前者，也不自动再次联系。

### 11.3 取消、持久 run 与 MV3 生命周期

- 拟人等待按 250ms 检查取消；LLM fetch 使用 `AbortController`。
- 每个页面、LLM、消息和等待边界后都在下一次外部动作前检查取消。
- `sw_active_run` 保存 run ID、平台、阶段、游标、结果和终态。
- 用户任务期间创建 `src/offscreen.html`，每 20 秒发送心跳；任务终止即关闭。
- Service Worker 启动发现遗留 `running` 时，只转为 `blocked/service_worker_interrupted`，不恢复或重放外部动作。

### 11.4 自定义 API 权限

- `src/api-permissions.js` 将 Base URL 规范化为精确 host permission。
- 公网端点必须是 HTTPS；HTTP 仅允许本机回环地址。
- 权限在保存、测试或扫描按钮的用户手势内请求；拒绝授权则不启动 API 请求。

### 11.5 自动化验证

```bash
npm test
```

测试覆盖：

- 会话身份匹配、回车/按钮互斥和发送失败；
- 运行取消、平台隔离和原子联系记账；
- run 检查点、终态和意外中断阻塞；
- manifest 能力与自定义 API 权限。

真实站点选择器、登录态、弹窗和风控提示不能由 Node 单测证明，发布前仍需用测试账号完成 Boss / 智联的单岗位验收。

---

## 12. P0 批次信任闸门（2026-07-24）

### 12.1 已实现流程

1. 用户可勾选一个或多个岗位，侧边栏只发送 `PREPARE_DELIVERY`。
2. Service Worker 使用当前平台、持久扫描缓存、去重记录、日限和间隔配置生成确定性计划。
3. 后台保存一个有效期 120 秒、只能消费一次的 `sw_pending_delivery`。
4. 侧边栏显示一个批次确认单；多人批次只确认一次，不逐人弹窗。
5. `CONFIRM_DELIVERY` 消费意图并重新构建计划；平台、缓存、岗位或额度有变化时拒绝启动。
6. 后台使用意图冻结的岗位 ID 启动原有逐岗状态机。旧 `START_DELIVER` 只返回 `CONFIRMATION_REQUIRED`。

取消按钮、Escape 和遮罩点击都会撤销确认意图。确认请求提交期间取消入口被锁定，避免用户误以为已经撤销一个实际已启动的批次。

### 12.2 停机与不确定结果

- `TARGET_UNCERTAIN`：当前会话或投递目标无法与预期岗位、公司或 HR 对齐。
- `SELECTOR_UNAVAILABLE`：岗位卡片、联系按钮、聊天脚本或输入框无法安全定位。
- `SEND_RESULT_UNKNOWN`：点击联系或发送后无法确认结果；系统保守记入去重与今日用量并停止整批。
- `SERVICE_WORKER_INTERRUPTED`：发现遗留运行记录，只恢复为阻塞态，不恢复动作。
- `LOGIN_REQUIRED`、`DAILY_LIMIT_REACHED`、`PLATFORM_MISMATCH` 等同样带稳定错误码和恢复建议。

侧边栏恢复卡片使用 `role="alert"` 显示错误码、原因和下一步；日志使用 `role="log" aria-live="polite"`。确认对话框支持焦点进入、Tab 循环、Escape 取消与关闭后焦点恢复。

### 12.3 自动验收证据

2026-07-24 自动测试结果：`npm test` 通过 47/47。覆盖：

- 批次去重、跨平台、缓存缺失、全已处理、额度用尽和超额拒绝；
- 时间估算、120 秒边界、新意图覆盖、取消、过期、错误 ID、并发双消费；
- 后台旧入口拒绝、冻结岗位重校验和结构化阻塞契约；
- Boss/智联搜索与聊天适配器对目标不确定、选择器失效和结果未知的分类；
- 智联数字城市 ID、未知城市失败关闭、城市/经验/学历职位卡二次过滤；
- 确认单、显式标签、键盘行为、焦点样式、日志与恢复卡片语义；
- 既有单次发送、原子记账、取消、平台隔离、运行恢复与权限测试。

### 12.3.1 JavaScript URL 与扩展 CSP

Boss 页面部分可点击元素可能是 `href="javascript:…"` 的链接，或位于这种链接内部。内容脚本直接派发 `click` 时，浏览器会尝试执行该 JavaScript URL；MV3 隔离世界的扩展 CSP 会拒绝执行并在扩展错误页记录违规。

`src/humanize.js` 现在会识别目标或最近链接祖先的 `javascript:` scheme，仅对该次点击调用 `preventDefault()`：页面注册的点击监听器仍会执行，但不会再触发 JavaScript URL 默认导航。普通 HTTPS 链接保持原行为。`tests/humanize-click.test.js` 分别覆盖危险链接子元素和普通 HTTPS 链接。

完整静态验证命令见 README。真实账号验收不会由自动化结果替代。

### 12.4 真机验收状态

| 平台 | 自动与静态验证 | 测试账号真实联系 |
|---|---|---|
| Boss | 通过 | 待用户提供测试账号/测试岗位并在动作前明确授权 |
| 智联 | 通过 | 待用户提供测试账号/测试岗位并在动作前明确授权 |

真机验收时至少验证：一次批次确认、取消零副作用、两岗位执行顺序、停止后无下一次动作、登录/选择器失效停机、扩展重启不重放。

---

## 13. Boss AI 对话托管的平台边界（Phase 1）

Boss 托管是建立在现有“联系已选”之后的独立能力层，不属于通用多平台联系适配器：

- `src/platform/boss/conversation-reader.js` 与 `src/platform/boss/content-chat.js` 负责 Boss 专用的只读消息识别和受控发送证据。
- `src/conversation/*` 负责跨页面的状态机、策略、持久租约、通知 reservation、alarm 调度与工作台 DTO。
- Boss 恢复首先收束任何持久 `SENDING` 为 `SEND_RESULT_UNKNOWN`；分类证据不能覆盖未知外部写入。不存在未知发送时，分类恢复才使用原子保存的来源状态与上一可靠游标；legacy、损坏或矛盾状态以 `RECOVERY_STATE_UNCERTAIN` 失败关闭。
- `WAITING_CONFIRMATION` 只有在同会话恰好存在一个、且与 `pendingApprovalId` 精确链接的 `PENDING` 时才能恢复或通知；reservation 与 notifier 内部 await 后的最终 egress 都重新验证 owner。background 保护包装不得用 API-proof 断言替换 engine 的 owner 断言，而要对同一最新快照同步组合两者；矛盾/孤儿/重复待办零外发。
- 飞书外部卡片不复用本地待办 DTO：只接受固定模板、稳定枚举、公司/岗位/HR 安全元数据和重建后的 Boss URL；HR 消息、模型 `draft` / `fieldsNeeded` 只留在本地。
- store 归一化与 runtime 公共 DTO 各自执行暂停码 allowlist；未知持久值固定映射为 `UNKNOWN_PROCESSING_FAILURE`，不会把原始 provider/页面错误暴露给 UI。
- 上述恢复、通知与 DTO 规则均为 Boss Phase 1 的专用证据，不会把该策略泛化为其他平台已经具备的能力。
- 只有 Boss 的可靠 `conversationRef` 能登记为托管会话；全局与逐会话开关都默认关闭。
- 智联当前只有扫描、筛选与单岗位联系能力，没有会话读取、消息指纹、托管状态机或自动回复适配。

因此 Phase 1 不把 Boss 选择器或发送协议抽象成“看似通用”的智联实现，也不在智联显示可用托管开关。若未来扩展平台，必须分别完成稳定会话 ID、owned DOM scope、发送肯定证据、登录/风控分类和真实账号分阶段验收；不能仅复用 UI 或状态机就宣称平台支持。
