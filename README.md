# StudyShot Relay

> 平板写笔记,截一张图,几秒后电脑的剪贴板里就是这张图。然后你在 GPT、Claude、任何编辑器里 `Ctrl+V` 粘贴,继续干活。

自己搭的私有中转,不上云、不依赖微信和厂商账号,只做一件事:把截图从安卓设备推到其他设备,延迟压到几秒内。

## 需求

我自己的场景:平板手写笔记,电脑用 GPT 辅助。"截图 → 传图 → 贴到 GPT" 这条链路,试过几个办法都不顺手:

- **平板分屏** — 发热、笔迹延迟,书写体验崩。
- **微信文件助手** — 6 步切换,每步都要离开当前页面。
- **厂商中转站**(ColorOS / MIUI / HarmonyOS) — 同步几十秒到一分钟,跨品牌直接用不了。

StudyShot Relay 想把这件事压成两步:**截图 → 等几秒 → Ctrl+V**。

为了让这玩意儿不变成"什么都能传"的全家桶,几个底线:

- 只自动上传截图,不动相册
- 权限到设备,不到用户
- 上传设备不会收到自己传的图(避免循环)
- 下载目录不进截图监听(避免循环)
- 图片 URL 全部鉴权,没有公开链接
- WebSocket 实时推送,断网时靠 pending 投递补

## 技术栈

| 模块 | 选型 |
| --- | --- |
| 后端 | Node.js + TypeScript + Fastify + Prisma + PostgreSQL |
| 实时通道 | WebSocket(`@fastify/websocket` + `ws`) |
| Android | Kotlin + Jetpack Compose + OkHttp + WorkManager + Room |
| 桌面(Windows / Linux) | Electron + TypeScript |
| Linux CLI / Web UI | Node.js + TypeScript + Fastify + chokidar |
| 部署 | Docker Compose + Caddy(自动 HTTPS) |

## 功能

**核心**

- 设备绑定:owner 在网页后台生成一次性绑定码,新设备凭码注册
- 实时推送:图片上传后,授权设备通过 WebSocket 在几秒内收到通知
- 离线补偿:设备重连后弹窗展示 pending 数量，由用户选择接收或忽略
- 多用户多设备:owner 空间管理员 / child 成员用户,同一用户下多设备可同时在线;成员可自助绑定、改名、撤销自己的设备
- 设备级权限:每个设备独立控制"自动上传 / 自动接收 / 管理空间"等能力,后端强校验
- 审计日志:登录、绑定、撤销、权限变更、删除等关键操作全部留痕

**Android**

- 监听 `MediaStore` 截图目录,新增即上传
- 可选择多个监听目录，并排除其中不应上传的子文件夹
- 实时学习模式可启前台服务,保活应对国产 ROM 后台限制
- 合并 MediaStore 事件、去除常驻装饰动画，降低前台扫描和渲染开销
- WorkManager 退避重试,进程被杀不丢任务
- 4 Tab UI(主页 / 记录 / 设置 / 帮助),带 6 个帮助子页
- 支持系统分享菜单手动上传任意图片
- 设备 token 用 Jetpack Security 加密存在本地
- 管理登录失败后可直接修改重试；生成的绑定码持续显示并自动复制
- 绑定码保留原始大小写，并自动忽略粘贴内容的首尾空白
- 实时学习模式结合 MediaStore 事件与每秒主动扫描，并由前台服务直接上传，规避厂商后台回调和 WorkManager 批处理延迟

**桌面(Windows / Ubuntu)**

- 可监听本地目录自动上传，并排除任意子文件夹及其后代
- 自动下载到指定目录
- 可选自动写入剪贴板,任意窗口 `Ctrl+V` 即可粘贴
- 托盘常驻,支持暂停 / 恢复
- 开机自启、桌面通知、最近接收记录
- 可用成员账号自助绑定；绑定码注册前显示目标成员
- 显示服务端有效权限，撤权后自动停止对应上传/接收
- owner 管理全空间设备，成员只管理自己的设备

**Linux 客户端**

- 一条命令 `studyshot-relay launch` 拉起 Web 管理界面,自动开浏览器
- CLI 完整子命令:`bind` / `bind-login` / `whoami` / `permissions` / `refresh-permissions` / `unbind` / `receive` / `watch` / `upload` / `run` / `status`
- code 绑定强制预览成员；账号绑定密码使用隐藏输入，不进入 shell history
- 目录监控自动上传 / 长连接自动下载
- 下载后通过 `wl-copy` / `xclip` 自动写入 Linux 系统剪贴板
- 提供 `assets/install-desktop.sh` 一键装到系统应用菜单,带专属图标

**网页管理后台**

访问 `https://你的域名/admin`:

- 设备列表、改名、改权限、撤销
- 删除已撤销设备，同时保留图片与审计历史
- 子用户、用户组管理
- 图片库:缩略图网格、预览、批量多选删除、按时间筛选(全部 / 有效 / 过期 / 今天 / 本周 / 本月)

## 一键部署

需要一台 Linux 服务器,装好 Docker + Docker Compose。域名 + HTTPS 模式由 Caddy 自动申请证书。

**域名 + HTTPS(推荐)**

```bash
git clone https://github.com/fox-114514/cloudrelease.git
cd cloudrelease
./scripts/deploy-backend.sh --domain studyshot.example.com --email admin@example.com
```

首次跑会生成主用户(`owner`)的随机密码,**只在终端显示一次**,记下来。

部署完的验证流程:

1. 浏览器打开 `https://studyshot.example.com/admin`,用 `owner` 登录
2. 生成一个设备绑定码
3. 客户端填服务器地址 `https://studyshot.example.com`、输入绑定码完成注册
4. 回到后台给该设备勾上"自动接收"
5. 在授权设备上截一张图,看接收端几秒内是否到

**纯 IP + HTTP(临时)**

没域名时这样,建议配合 Tailscale / ZeroTier / WireGuard 等私有网络用,**不加密**:

```bash
./scripts/deploy-backend.sh --ip-http 1.2.3.4
```

客户端服务器地址填 `http://1.2.3.4:3000`。

数据库备份、迁移、升级等运维细节见 [docs/ops/backend-deployment.md](docs/ops/backend-deployment.md)。

## 文档

- [文档索引](docs/index.md) — 当前文档结构和维护规则
- [项目完整规格](docs/spec/product-spec.md) — 目标、场景、约束、详细设计
- [客户端 / 后端协议](docs/spec/protocol.md) — HTTP API、WebSocket 消息、错误码
- [权限模型](docs/spec/permissions.md) — 用户 / 设备 / 能力项的边界
- [多用户 V2 设计](docs/design/multi-user-v2.md)
- [Android 后台上传设计](docs/design/android-background.md)
- [后端部署](docs/ops/backend-deployment.md)
- [桌面客户端](desktop/README.md)
- [Linux 客户端](linux-client/README.md)
