# 手机浏览器与大文件兼容说明

核对日期：2026-10-22。下列内容区分浏览器公开的 API 能力与实际设备验证；API 存在不代表任意手机都能完成 4 GB 以上 ISO 的保存。

## 浏览器选择

| 环境 | 直接选择输出位置 | 兼容路径 | 建议 |
| --- | --- | --- | --- |
| Android Chrome 132 及以上 | MDN 兼容数据已列出支持 | 运行时检测 `showSaveFilePicker` | 优先使用此类浏览器并保存到手机本地存储 |
| 桌面 Chrome / Edge | Chromium 支持保存文件选择器 | 直接逐块写出文件 | 手机遇到存储或导出问题时，可在电脑处理后复制 ISO |
| Safari / iPhone / iPad | 当前 MDN 数据未列出支持 | 需要浏览器私有存储与下载导出 | 不承诺所有设备均能导出 4.31 GB 文件 |
| Firefox 与不支持选择器的浏览器 | 当前 MDN 数据未列出支持 | 需要浏览器私有存储与下载导出 | 能否运行取决于页面能力检测及设备空间 |

具体设备以页面的功能检测结果为准，不能只通过浏览器名称判断。Chrome Android 从 132 开始支持保存文件选择器，旧版兼容文章中“Android 不支持”的结论已经过时。依据：[MDN 官方兼容数据](https://github.com/mdn/browser-compat-data/blob/main/api/Window.json)、[Chrome 开发文档](https://developer.chrome.com/docs/capabilities/web-apis/file-system-access)。

## 两种保存方式

### 直接保存

浏览器支持 `showSaveFilePicker()` 时，用户通过一次点击选择输出位置，页面随后逐块读取输入、逐块写入新 ISO。选择器要求 HTTPS 和即时用户操作；应先选保存位置，再开始耗时的校验与生成。[MDN：showSaveFilePicker](https://developer.mozilla.org/en-US/docs/Web/API/Window/showSaveFilePicker)

`createWritable()` 通常先写临时文件，关闭流后才提交。浏览器、操作系统和存储设备仍可能需要额外空间，页面无法承诺恰好一个输出文件大小的可用空间就一定足够。[MDN：createWritable](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createWritable)

### 浏览器临时存储后导出

不支持直接保存的环境，可以在独立 Worker 中使用 OPFS 的同步访问句柄逐块生成文件。OPFS 文件在浏览器的私有空间内，不能直接当作“已经保存到下载目录”的用户文件。[MDN：createSyncAccessHandle](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/createSyncAccessHandle)

生成后可以取得 `File`，建立对象 URL，再由用户点击保存。此路径避免在页面 JavaScript 中拼接一个完整 ISO 的数组，但不构成浏览器内部零拷贝或大文件导出成功的保证。[MDN：getFile](https://developer.mozilla.org/en-US/docs/Web/API/FileSystemFileHandle/getFile)、[MDN：createObjectURL](https://developer.mozilla.org/en-US/docs/Web/API/URL/createObjectURL_static)

下载可能仍需另一份文件的空间。用户确认导出完成前，不应删除 OPFS 文件或立即撤销其对象 URL；底层文件被移除后，已取得的 `File` 可能不再可读。页面应提供单独的清理入口，并明确提示先检查下载结果。

## 空间与后台运行

- 原版 ISO 约 4.30 GB，输出约 4.31 GB；GB 沿用 Windows 的文件大小显示口径，按 1024³ 字节换算并截取两位小数（严格单位为 GiB）。原版文件必须保留。
- 直接保存需要输出文件及浏览器临时操作的空间。使用 OPFS 后再下载时，建议在原版之外预留至少 10 GB；这是预留建议，不是可用性保证。
- `navigator.storage.estimate()` 提供的是网站配额和用量估算，不能当作手机“真实剩余磁盘空间”。配额看似充足时仍可能写入失败；页面需要处理空间不足错误。
- 私有存储默认可能被浏览器回收；申请持久化也可能不获准。无痕模式的配额、持久性与功能可能不同。
- 保持页面在前台，避免切换应用或锁屏。屏幕常亮请求可能被系统拒绝或释放，不能保证浏览器后台继续运行。

依据：[MDN：存储配额与回收](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)、[WebKit：存储策略](https://webkit.org/blog/14403/updates-to-storage-policy/)、[MDN：屏幕常亮](https://developer.mozilla.org/en-US/docs/Web/API/Screen_Wake_Lock_API)。

## 发布与验证表述

页面应显示实际校验进度和真实完成状态。应分别报告：输入 ISO 验证通过、输出生成与校验通过、已请求浏览器下载；浏览器下载请求不等于下载目录中已经存在一个完整文件。

维护者发布时应记录实际浏览器、保存方式、输入与输出字节数、输出 SHA-256。桌面模拟手机尺寸只验证布局，不能称为 Android 或 iOS 实机大文件测试。手机大文件端到端验证未完成前，不应标注“全手机支持”或“iOS 已验证”。

## 版本识别

本作日版产品编号为 **SLPM-66022**。仓库初始 README 中的 `SLPM-66023` 应修正，文件名或扩展名不能代替原版 ISO 的字节数与 SHA-256 校验。
