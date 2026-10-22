# KAIDO 峠の伝説 · 汉化优化版网页补丁工具

**在线使用：https://genkiproject.github.io/kaido-touge-no-densetsu-cn/**

手机及电脑浏览器本地为日版原版 ISO 应用 **1.4.1 抓地平衡调整版**补丁。ISO 不上传；仓库只包含网页、约10 MB差分和说明，不含游戏镜像或记忆卡。

## 使用

1. 准备未修改的日版 **SLPM-66022** ISO（不是 SLPM-66023）。
2. 打开网页，选择 ISO，点击“制作汉化优化版”。
3. 支持直接保存的浏览器会让你选择新的输出文件名；其他浏览器尝试本地临时存储，完成后点击下载。
4. 等待完整输出校验通过；临时存储模式中，请确认下载完成后再清理临时文件。
5. 完整重启模拟器，加载新 ISO，通过游戏内普通记忆卡存档继续，不载入旧版即时存档。

推荐新版 Android Chrome 或桌面 Chrome / Edge；页面按实际API能力检测。Safari、Firefox等环境使用临时存储模式时，4.64 GB文件导出受设备、配额和浏览器限制，**不保证所有手机可用**。建议在原版之外预留至少10 GB，保持页面在前台。[兼容性与依据](docs/MOBILE_COMPATIBILITY.md)。

## 版本内容

- 简体中文菜单、改装、赛事等内容；全部预录影片保留原文原画。
- 1.4.1收回1.4过强的额外抓地和侧向响应，放宽自然侧倾，保留真实轮胎等级。
- 继承改装扩展、摄像机／FOV／震动、幽灵车选项、记录挑战拉花和此前优化。
- 汉化／校对／贴图及优化信息版署名：**Hamagaki（瑶山枫叶）**。字体资源许可见assets/licenses/。

## 完整校验

| 文件 | 字节数 | SHA-256 |
| --- | ---: | --- |
| 日版原版 | 4,621,631,488 | `db026968bfc55da9730a1e179f89ecda75a23b12c040a6f6dc1375381b1e4115` |
| 1.4.1输出 | 4,636,448,768 | `2b9b47c2b97229b0556f7b0cac22c678d9aa3a5b48df452ef22102d0cf3ae8b9` |
| assets/kaido-1.4.1.kpatch | 10,052,639 | `21890c86ccdbbfdc3e686ce5e4988314b4d83407c425e178b1bb37edc4c4791a` |

原版、补丁与生成流校验SHA-256，Worker保存后再次读文件校验。原版只读；非空输出拒绝覆盖。ISO以4 MiB分块处理，64位COPY地址检查安全整数，不把整个ISO拼接成内存Blob。临时存储输出保留到用户明确清理；中断后可用网页入口清理精确记录的临时文件。

## 本地运行及测试

无需安装依赖或构建，使用Node22+：

```sh
npm test
python -m http.server 8080
```

打开http://localhost:8080。正式托管需HTTPS。GitHub Pages使用main分支根目录，.nojekyll保证静态资源直接提供。

可选真实镜像全量流回归（只读原版、丢弃生成流、不另存完整ISO）：

```powershell
$env:KAIDO_TEST_ORIGINAL_ISO = 'D:/PCSX2/GAMES/Kaidou - Touge no Densetsu (Japan).iso'
node --test tests/engine.test.mjs
```

本机真实原版全量生成流SHA已与正式1.4.1一致；移动尺寸布局及Worker测试不等于Android／iOS实机4.64 GB导出已验证。

## 许可及反馈

网页代码遵循仓库MIT许可；游戏及补丁内第三方资源保留各自版权与许可。请保留汉化署名和仓库链接，不倒卖汉化资源。本站不提供原版或汉化完整ISO下载。

[报告问题](https://github.com/genkiproject/kaido-touge-no-densetsu-cn/issues)时请附浏览器、设备、保存方式及错误提示，不提交个人ISO、记忆卡或密钥。
