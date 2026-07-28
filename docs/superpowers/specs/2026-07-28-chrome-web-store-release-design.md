# Chrome 应用商店发布链路设计

日期：2026-07-28

## 目标

为“求职联系助手”建立可重复、可审计的 Chrome 应用商店发布链路，产出一个 `manifest.json` 位于 ZIP 根目录、只包含运行时文件的上传包，并补齐隐私政策、权限说明、审核测试步骤和商店文案。

用户已经明确要求保留现有“满足策略条件时，无人逐条确认即可自动外发”的 AI 托管行为。本任务不会关闭、降级或改写该行为，只会在发布材料中如实披露其工作方式、控制项和商店审核风险。

## 公开项目与规范参考

- Chrome 官方扩展示例：[GoogleChrome/chrome-extensions-samples](https://github.com/GoogleChrome/chrome-extensions-samples)
- 最小 Manifest V3 工程结构：[SimGus/chrome-extension-v3-starter](https://github.com/SimGus/chrome-extension-v3-starter)
- Chrome Web Store 上架准备：[Prepare your extension](https://developer.chrome.com/docs/webstore/prepare)
- Chrome Web Store 政策：[Program Policies](https://developer.chrome.com/docs/webstore/program-policies/policies)
- Manifest V3 要求：[Manifest V3 requirements](https://developer.chrome.com/docs/webstore/program-policies/mv3-requirements)
- 权限使用要求：[Permissions requirements](https://developer.chrome.com/docs/webstore/program-policies/permissions/)
- 用户数据常见问题：[User Data FAQ](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq)

上述开源项目用于参考可加载扩展的最小目录结构和 MV3 文件组织；Chrome 官方文档作为发布包、权限、隐私和审核材料的最终依据。不复制第三方项目实现代码。

## 方案比较

### 方案 A：直接压缩整个仓库

优点是实现简单。缺点是测试、开发计划、`.DS_Store`、历史文件甚至未来误加入的本地材料都可能进入商店包，无法形成可靠的发布边界，因此不采用。

### 方案 B：先复制整个仓库，再维护排除列表

比方案 A 更可控，但排除列表默认允许未知新文件进入。随着项目增长，新的测试夹具、日志或敏感文件仍可能被漏排，因此不采用。

### 方案 C：显式运行时白名单

打包脚本只复制清单中列出的 Manifest、图标和运行时源文件；任何未列出的文件都不会进入 ZIP。脚本在打包前校验清单文件存在、无符号链接、Manifest 可解析、ZIP 根目录正确，并在完成后检查禁止项。该方案可复现、默认拒绝未知文件，作为本次实现。

## 产品范围收敛

当前产品实际支持 BOSS 直聘和智联招聘。猎聘仍是占位入口，注册表引用的脚本并不存在，却已经申请 `*.liepin.com` 主机权限。发布版将：

1. 从 Manifest 描述和 `host_permissions` 移除猎聘；
2. 从侧栏平台卡片和猎聘专属表单移除猎聘；
3. 从平台注册表和默认配置初始化中移除猎聘；
4. 更新用户文档，不再把猎聘描述为当前或即将可用的平台；
5. 用测试锁定源代码、Manifest 和发布包中不存在猎聘运行入口。

这不是新增平台能力，也不会影响 BOSS/智联现有数据。旧浏览器存储中可能残留的 `byPlatform.liepin` 配置不会执行，也不需要主动清除。

## 发布包边界

发布 ZIP 只包含：

- `manifest.json`
- `LICENSE`
- `icons/icon16.png`
- `icons/icon48.png`
- `icons/icon128.png`
- Manifest 和页面依赖的 `src/` 运行时文件

明确不包含：

- `tests/`
- `docs/`
- `scripts/`
- `package.json`
- `.git*`
- `.DS_Store`
- `.env*`、证书、日志和 ZIP
- 未被 Manifest 或运行时引用的历史兼容文件 `src/content-chat.js`、`src/content-search.js`、`src/selectors.js`

打包产物写入已由 `.gitignore` 排除的 `dist/chrome-web-store/`。ZIP 文件名包含 Manifest 版本号。

## 自动外发行为与审核风险

本任务不修改 AI 托管策略、发送门禁、静默时段、随机延时、额度、会话结束或人工待确认逻辑。普通低风险问题在用户已经开启全局和单会话托管后，仍可能由 AI 自动回复，无需逐条人工确认。

Chrome Web Store 当前政策对“代表用户发送消息”有严格要求，尤其关注用户能否确认内容和收件人。因此保留该行为会带来显著审核风险，甚至可能导致拒审。发布材料必须：

- 明确说明扩展会在用户开启托管后读取已登记会话并可能自动发送回复；
- 说明哪些数据会发送给用户选择的 AI 服务商和飞书；
- 说明用户可关闭全局托管、单会话托管、静默时段和每日额度；
- 不使用“完全安全”“不会封号”或隐瞒自动化的描述；
- 在审核测试步骤中提供关闭托管、开启托管、创建待确认和停止会话的完整路径。

如果商店最终拒绝该能力，本任务不擅自改为草稿模式；后续由用户决定是否维护商店合规版和完整功能版两个发行通道。

## 隐私与权限材料

新增公开隐私政策，覆盖：

- 浏览器本地保存的 API Key、Webhook、签名密钥、求职配置、岗位和会话状态；
- 发送给 AI 服务商的职位、简历依据和消息上下文；
- 发送给飞书的待确认通知内容；
- 数据用途、保存位置、第三方处理者、用户删除方式和安全限制；
- 不出售用户数据，不把数据用于与核心功能无关的广告。

新增商店上架文档，包含单一用途、简短描述、详细描述、权限逐项理由、数据披露答案、审核账号/页面准备、测试步骤、截图清单和发布检查表。隐私政策文件可以提交到公开 GitHub 仓库；商店后台填写的 URL 必须是无需登录即可访问的最终地址。

`https://*/*` 继续作为可选主机权限，仅在用户配置自定义 OpenAI 兼容 API 地址时按具体来源请求。文档必须说明该权限的用途和触发方式。固定服务商使用 Manifest 中的窄化主机权限。

## 打包与验证流程

新增 Node 打包脚本，并在 `package.json` 暴露 `npm run package:chrome`：

1. 读取和校验根目录 Manifest；
2. 根据显式白名单创建全新暂存目录；
3. 拒绝缺失文件、符号链接和非法路径；
4. 使用系统 ZIP 工具生成无扩展属性的上传包；
5. 重新读取 ZIP 清单，确认 `manifest.json` 位于根目录；
6. 拒绝任何禁止文件或未在白名单内的条目；
7. 输出 ZIP 绝对路径、版本号和文件数量。

自动化测试覆盖：

- Manifest 只声明 BOSS/智联平台；
- 侧栏、平台注册表和默认配置无猎聘入口；
- 发布白名单覆盖所有 Manifest 静态依赖；
- 生成的 ZIP 可解析、根目录正确、文件集合与白名单一致；
- 测试、文档、开发文件、历史脚本和敏感文件不入包；
- 现有无人确认自动外发相关代码路径未被改动，现有托管测试全部继续通过。

## 错误处理

- 缺少运行时文件：打包立即失败，不生成或覆盖成功产物；
- Manifest 版本非法：打包失败并指出字段；
- 系统缺少 ZIP 工具：明确提示安装或使用受支持环境；
- ZIP 含额外文件：验证失败并删除该次不可信产物；
- 工作区存在与本任务无关的修改：只修改、暂存和提交本任务文件，不恢复、不覆盖、不打包这些修改。

## 完成标准

1. 全量自动化测试通过；
2. `npm run package:chrome` 可重复生成版本化 ZIP；
3. ZIP 根目录存在 `manifest.json`，Chrome 可直接加载其解压目录；
4. ZIP 只含白名单运行时文件，无测试、文档、密钥、系统垃圾或猎聘入口；
5. 隐私政策和商店审核材料完整；
6. BOSS/智联现有功能和无人确认自动外发行为保持不变；
7. 相关开发文档同步更新；
8. 用户工作区已有的 `README.md`、`UPSTREAM_LICENSE`、`UPSTREAM_README.md` 删除状态保持不变。
