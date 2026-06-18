# StudyShot Relay（学习截图快传）

一个私有、低延迟的跨设备图片快传系统。

## 目标

用户在安卓平板上写作业、手写笔记并截图后，图片自动上传到用户自己的服务器；授权的电脑或手机自动接收并下载，电脑端最好自动写入剪贴板。用户只需要在其他页面（例如 GPT 页面）按 `Ctrl+V` 粘贴图片即可。

这不是网盘、不是完整相册同步、不是聊天软件、也不是 GPT API 客户端。

## 组成

- `backend/`：Node.js + TypeScript + Fastify 后端服务。
- `desktop/`：Electron + TypeScript 桌面客户端，支持 Windows / Ubuntu。
- `android/`：Kotlin + Jetpack Compose 安卓 App。
- `docs/`：规格文档与开发任务清单。

## 核心约束

- 默认只自动上传截图，不默认监听整个相册。
- 权限必须落实到设备级。
- 上传设备不会收到自己上传的图片。
- 安卓下载目录不会再次触发自动上传。
- WebSocket 是实时通知主链路，pending deliveries 是补偿链路。
- 所有图片下载必须鉴权，不生成公开 URL。

## 文档

- [完整方案规格](docs/study-shot-relay-spec.md)
- [开发任务清单](docs/study-shot-relay-agent-tasklist.md)
- [客户端/后端协议](docs/protocol.md)
- [权限模型](docs/permissions.md)
- [Android 后台上传设计](docs/android-background.md)
- [后端部署](docs/backend-deployment.md)
- [本地 PostgreSQL 配置](docs/local-postgresql-setup.md)
- [桌面客户端说明](desktop/README.md)

## 一键部署后端

在服务器上安装 Docker 和 Docker Compose 后，克隆仓库并执行：

```bash
./scripts/deploy-backend.sh --domain studyshot.example.com --email admin@example.com
```

脚本会在服务器本地生成 `backend/.env.production`，构建并启动 PostgreSQL、后端和 Caddy。首次运行如果没有指定 `--owner-password`，脚本会生成主用户密码并只在终端显示一次。

没有域名时可以临时用纯 IP HTTP 部署：

```bash
./scripts/deploy-backend.sh --ip-http 1.2.3.4
```

客户端服务器地址填写：

```text
http://1.2.3.4:3000
```

纯 IP HTTP 不加密，只建议临时测试，或配合 Tailscale / ZeroTier / WireGuard 等私有网络使用。

## 网页管理后台

部署完成后可以用浏览器打开：

```text
https://你的域名/admin
```

纯 IP HTTP 模式打开：

```text
http://你的服务器IP:3000/admin
```

使用主用户登录后，可以创建绑定码、管理设备权限、创建子用户、管理分组并查看审计日志。
