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

脚本会先创建全新暂存目录，校验每个白名单文件是普通文件且不是符号链接，复制文件后生成 ZIP，再读取 ZIP 清单并与白名单逐项比较。任一阶段失败都会删除该次不可信产物。

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
6. 上传商店图标、截图和宣传图片；
7. 按审核测试步骤准备 BOSS/智联页面和测试说明；
8. 再次核对数据披露和 AI 自动外发说明；
9. 提交审核。

## 重要审核风险

本项目按用户决定保留 AI 托管中的无人逐条确认自动外发。该行为不会因为商店打包而关闭或变成仅草稿模式。

Chrome 应用商店对代表用户发送消息的能力审查严格。提交材料必须如实说明：

- 用户先主动开启全局和单会话托管；
- 扩展会读取已登记的 BOSS 会话；
- 满足安全策略的回复可能不经逐条确认直接发送；
- 用户可以关闭托管、设置静默时段和每日额度；
- 重要或不确定问题进入待确认。

隐瞒该行为会增加拒审和后续下架风险。若审核方不接受，应由产品负责人决定是否另建商店合规发行通道，不能在本发布脚本中偷偷改写运行逻辑。
