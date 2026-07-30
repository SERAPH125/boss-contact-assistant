# Chrome 应用商店发布操作说明

适用版本：0.3.6  
更新日期：2026-07-28

## 发布边界

Chrome 应用商店上传包不是整个 Git 仓库。发布脚本只复制显式白名单中的运行文件，未知文件默认不进入 ZIP。

发布包包含：

- 根目录 `manifest.json` 和 `LICENSE`；
- 三个扩展图标；
- Manifest、后台 Worker、侧栏和内容脚本需要的 `src/` 运行文件。

发布包不会包含：

- `tests/`、`docs/`、`scripts/` 和 `package.json`；
- `.git*`、`.DS_Store`、`.env*`、日志、证书和历史 ZIP；
- 未被当前扩展引用的旧版 `src/content-chat.js`、`src/content-search.js`、`src/selectors.js`。

白名单的唯一代码事实源是 `scripts/chrome-store-files.mjs`。不要改成“压缩全仓库再排除文件”的方式。

## 前置条件

- Node.js 可执行文件；
- macOS 自带的 `/usr/bin/zip`；
- macOS 自带的 `/usr/bin/unzip`；
- Manifest 版本符合 Chrome 的数字版本格式。

## 生成上传包

在仓库根目录运行：

```bash
npm run package:chrome
```

当前版本输出：

```text
dist/chrome-web-store/boss-contact-assistant-0.3.6.zip
```

脚本会先创建全新暂存目录，校验每个白名单文件是普通文件且不是符号链接，复制后把成员权限固定为 `0644`、时间固定为 ZIP 最早支持的 `1980-01-01 00:00:00 UTC`，再按白名单顺序生成 ZIP，并读取 ZIP 清单逐项比较。这样相同输入跨时间构建会得到相同二进制和 SHA-256。任一阶段失败都会删除该次不可信产物。

## 本地验证

查看文件清单：

```bash
/usr/bin/unzip -Z1 dist/chrome-web-store/boss-contact-assistant-0.3.6.zip
```

验证 ZIP 完整性：

```bash
/usr/bin/unzip -t dist/chrome-web-store/boss-contact-assistant-0.3.6.zip
```

检查根目录 Manifest：

```bash
/usr/bin/unzip -p dist/chrome-web-store/boss-contact-assistant-0.3.6.zip manifest.json
```

也可以把 ZIP 解压到一个新的临时目录，再在 `chrome://extensions` 中使用“加载已解压的扩展程序”选择该目录进行安装检查。

## 上传步骤

1. 登录 Chrome Web Store 开发者后台；
2. 创建新项目；
3. 上传 `dist/chrome-web-store/boss-contact-assistant-0.3.6.zip`；
4. 填写 `docs/chrome-web-store-listing.md` 中准备的商店文案和权限理由；
5. 填写无需登录即可访问的隐私政策 URL；
6. 按 `docs/store-assets/README.md` 上传 5 张截图和 2 张宣传图片；
7. 按审核测试步骤准备 BOSS/智联页面和测试说明；
8. 再次核对数据披露和 AI 自动外发说明；
9. 提交审核。

公开隐私政策建议填写：

```text
https://raw.githubusercontent.com/SERAPH125/boss-contact-assistant/main/docs/privacy-policy.md
```

该文件推送到公开仓库后，必须使用无登录浏览器窗口验证可访问（HTTP 200），再填写到 Chrome Web Store。完整商店文案、权限理由、数据披露和审核步骤见 `docs/chrome-web-store-listing.md`。

## 提交前清单

- `npm test` 全量通过；
- `npm run package:chrome` 成功；
- `/usr/bin/unzip -t` 验证 ZIP 完整；
- ZIP 根目录含 `manifest.json`；
- Manifest 只声明当前支持的 BOSS/智联招聘平台；
- 隐私政策 URL 公开可访问；
- 数据披露包括招聘网站消息、AI 服务商、飞书和自动发送；
- `npm run validate:store-assets` 验证 7 张商店图片尺寸和无 Alpha 通道；
- 商店截图使用 `docs/store-assets/` 中的合成数据素材，不包含真实 HR 信息和任何凭据；
- 审核测试账号、AI Key 和飞书 Webhook 只通过私密审核说明提供；
- 已在提交说明中披露自动外发审核风险。

## 重要审核风险

本项目按用户决定保留 AI 托管中的无人逐条确认自动外发。该行为不会因为商店打包而关闭或变成仅草稿模式。

Chrome 应用商店对代表用户发送消息的能力审查严格。提交材料必须如实说明：

- 用户先主动开启全局和单会话托管；
- 扩展会读取已登记的 BOSS 会话；
- 满足安全策略的回复可能不经逐条确认直接发送；
- 用户可以关闭托管、设置静默时段和每日额度；
- 重要或不确定问题进入待确认。

隐瞒该行为会增加拒审和后续下架风险。若审核方不接受，应由产品负责人决定是否另建商店合规发行通道，不能在本发布脚本中偷偷改写运行逻辑。

## 2026-07-28 发布验证记录

验证环境：macOS、Node.js、系统 `/usr/bin/zip` 与 `/usr/bin/unzip`。

执行结果：

- `node --check src/background.js`：通过；
- `node --check src/sidepanel.js`：通过；
- `npm test`：460/460 通过；
- `npm run package:chrome`：跨 ZIP 两秒时间粒度连续两次成功，二进制完全一致；
- ZIP：`boss-contact-assistant-0.3.6.zip`；
- ZIP 文件数：37；
- 两次构建 SHA-256：`1537017859dfcd42b1904935bf95f21316e4172c13db0e652caa2ded6bdb4190`；
- ZIP 成员元数据：时间统一为 `1980-01-01 00:00 UTC`，文件权限统一为 `0644`；
- `/usr/bin/unzip -t`：37 个文件全部通过；
- 禁止项检查：无 `tests/`、`docs/`、`scripts/`、`package.json`、`.DS_Store`、`.env*`、猎聘入口或旧版兼容脚本；
- Manifest：根目录可读取，只声明 BOSS、智联、DeepSeek、OpenAI 和飞书固定主机访问；自定义兼容 API 继续按具体来源请求可选权限。

自动外发托管保持启用且未改动。本轮没有修改 `src/conversation/trusteeship-policy.js`、`src/conversation/monitor-engine.js`、`src/conversation/trusteeship-runtime.js`、`src/conversation/reply-ai.js` 或发送协议；相关既有回归包含在上述 460 项通过结果中。

## 2026-07-28 商店图片验证记录

- 生成目录：`docs/store-assets/`；
- 屏幕截图：5 张，均为 1280×800；
- 小型宣传图块：440×280；
- 顶部宣传图块：1400×560；
- `npm run validate:store-assets`：7/7 通过，全部为 PNG 且无 Alpha；
- 人工视觉检查：无裁切、重叠、浏览器外框或真实个人数据；
- 数据来源：完全合成，不读取扩展存储和招聘网站会话；
- 运行时影响：无。图片生成没有修改扩展代码、AI 托管策略或自动外发行为。
