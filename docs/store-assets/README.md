# Chrome Web Store 图片素材

本目录保存“求职联系助手”0.3.6 的 Chrome Web Store 图片素材。所有画面均由本地合成演示数据生成，不读取扩展存储，也不包含真实招聘账号、HR、会话、简历或凭据。

## 可直接上传的文件

| 文件 | 尺寸 | Chrome Web Store 字段 |
| --- | --- | --- |
| `01-job-screening.png` | 1280×800 | 屏幕截图 |
| `02-contact-confirmation.png` | 1280×800 | 屏幕截图 |
| `03-ai-trusteeship.png` | 1280×800 | 屏幕截图 |
| `04-human-confirmation.png` | 1280×800 | 屏幕截图 |
| `05-execution-log.png` | 1280×800 | 屏幕截图 |
| `promo-small-440x280.png` | 440×280 | 小型宣传图块 |
| `promo-marquee-1400x560.png` | 1400×560 | 顶部宣传图块 |

全部输出为 24 位 PNG，无 Alpha 透明层。

商店截图最多上传 5 张，建议按文件名前缀顺序上传。宣传图分别放入后台对应的小型宣传图块和顶部宣传图块字段。

## 预览源

`source/preview.html` 是隔离的静态素材预览，不是扩展运行页面。它通过查询参数选择场景：

```text
http://127.0.0.1:4173/docs/store-assets/source/preview.html?scene=job-screening
```

可用场景：

- `job-screening`
- `contact-confirmation`
- `ai-trusteeship`
- `human-confirmation`
- `execution-log`
- `promo-small`
- `promo-marquee`

在仓库根目录启动本地预览：

```bash
python3 -m http.server 4173 --bind 127.0.0.1
```

素材使用 ego-browser 独立任务空间加载上述本地页面，并通过 Chrome 的矢量打印通道输出单页 PDF。1280×800 场景使用 13.333333×8.333333 英寸页面；其他场景按 `像素÷96` 设置页面尺寸。然后使用 Poppler 在 96 DPI 下生成 PNG，从而保持目标像素尺寸和无 Alpha 通道。

## 自动验证

运行：

```bash
npm run validate:store-assets
```

校验器会逐张确认：

- 七个文件全部存在；
- 文件签名和元数据均为 PNG；
- 像素尺寸与场景清单一致；
- 不包含 Alpha 透明层。

场景契约测试：

```bash
node --test tests/store-assets-source.test.js
```

该测试核对七个场景、尺寸、输出文件名、合成数据标记和禁止出现的真实数据样本或误导性承诺。

## 发布前人工检查

- 逐张以原始尺寸打开，检查文字裁切、重叠和可读性；
- 确认没有浏览器标签、书签、系统通知或鼠标焦点框；
- 确认公司、HR、岗位、聊天和执行记录都是合成内容；
- 确认没有账号名、联系方式、会话 ID、AI 密钥或飞书凭据；
- 确认文案没有暗示招聘平台背书、保证求职结果或保证账号安全。

本目录只提供商店展示素材，不会进入扩展 ZIP，也不改变 AI 托管、自动外发或其他运行时行为。
