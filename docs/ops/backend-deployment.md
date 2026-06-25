# Backend Deployment

文档版本：2026-06-26

本文说明如何把 StudyShot Relay 后端部署到一台 Linux 服务器。当前版本为 `0.5.1`，推荐使用 Docker Compose、PostgreSQL 和 Caddy。Caddy 负责 HTTPS/WSS，后端容器只在 Compose 内部网络监听 `3000`。

## 0. 快速部署

在服务器上准备 Docker 和 Docker Compose，然后执行：

```bash
git clone https://github.com/fox-114514/cloudrelease.git
cd cloudrelease
./scripts/deploy-backend.sh --domain studyshot.example.com --email admin@example.com
```

脚本会：

- 生成 `backend/.env.production`，已有该文件时默认复用。
- 生成随机 PostgreSQL 密码、JWT secret 和初始 owner 密码。
- 使用 `backend/docker-compose.prod.yml` 启动 PostgreSQL、后端和 Caddy。
- 等待 `/api/v1/healthz` 健康检查通过。

首次生成的 owner 密码只在终端显示一次，必须立即保存。

没有域名时可以临时使用纯 IP HTTP：

```bash
./scripts/deploy-backend.sh --ip-http 1.2.3.4
```

纯 IP HTTP 不加密。公网长期使用会暴露 token、密码和图片内容，只建议临时测试，或配合 Tailscale / ZeroTier / WireGuard 等私有网络。

## 1. 部署模式

### 域名 + HTTPS

客户端服务器地址填写：

```text
https://studyshot.example.com
```

WebSocket 地址由客户端自动推导为：

```text
wss://studyshot.example.com/api/v1/ws
```

服务器安全组开放：

- `80/tcp`：Caddy 申请和续期证书。
- `443/tcp`：HTTPS 和 WSS。

不要把 PostgreSQL 暴露到公网。

### 纯 IP + HTTP

客户端服务器地址填写：

```text
http://1.2.3.4:3000
```

该模式使用 `backend/docker-compose.ip-http.yml`，不启动 Caddy，直接映射后端端口：

```text
${HTTP_PORT:-3000}:3000
```

## 2. 环境文件

生产环境文件位于：

```text
backend/.env.production
```

可以由部署脚本生成，也可以手动复制：

```bash
cd backend
cp .env.production.example .env.production
```

必须修改或确认：

- `PUBLIC_BASE_URL`
- `DEPLOY_MODE`
- `STUDYSHOT_DOMAIN` 和 `ACME_EMAIL`（HTTPS 模式）
- `PUBLIC_IP` 和 `HTTP_PORT`（IP HTTP 模式）
- `POSTGRES_PASSWORD`
- `DATABASE_URL` 中的数据库密码
- `JWT_SECRET`
- `INITIAL_OWNER_LOGIN`
- `INITIAL_OWNER_PASSWORD`

要求：

- `.env.production` 不得提交到 Git。
- `JWT_SECRET` 至少 32 字节随机字符串。
- `INITIAL_OWNER_PASSWORD` 至少 8 个字符。
- 初始 owner 只在用户不存在时创建；重启不会覆盖已有 owner 密码。

生成随机密钥示例：

```bash
openssl rand -base64 48
```

## 3. 手动启动

HTTPS 模式：

```bash
cd backend
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

IP HTTP 模式：

```bash
cd backend
docker compose --env-file .env.production -f docker-compose.ip-http.yml up -d --build
```

启动流程：

1. PostgreSQL 启动并通过健康检查。
2. 后端镜像构建。
3. 后端容器执行 `npm run db:migrate:deploy`。
4. 后端启动 HTTP/WebSocket 服务。
5. HTTPS 模式下，Caddy 自动申请证书并反向代理到后端。

查看日志：

```bash
cd backend
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f backend
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f caddy
```

IP HTTP 模式没有 `caddy` 服务：

```bash
docker compose --env-file .env.production -f docker-compose.ip-http.yml logs -f backend
```

## 4. 验证部署

健康检查：

```bash
curl -fsS https://studyshot.example.com/api/v1/healthz
```

期望返回类似：

```json
{
  "status": "ok",
  "service": "studyshot-relay-backend",
  "version": "0.5.1",
  "timestamp": "2026-06-26T00:00:00.000Z"
}
```

网页管理后台：

```text
https://studyshot.example.com/admin
```

IP HTTP 模式：

```text
http://1.2.3.4:3000/admin
```

部署后的基础验收：

1. 用 owner 登录 `/admin`。
2. 创建绑定码。
3. 客户端填服务器地址并绑定设备。
4. 给设备设置用途预设或接收范围。
5. 在授权上传设备截图，确认接收端几秒内收到。

## 5. 更新后端

拉取新代码后：

```bash
git pull
cd backend
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

IP HTTP 模式使用：

```bash
docker compose --env-file .env.production -f docker-compose.ip-http.yml up -d --build
```

后端容器启动时会自动执行：

```bash
npm run db:migrate:deploy
```

升级完成后用 `/api/v1/healthz` 确认 `version` 是当前版本，例如 `0.5.1`。

## 6. 发布客户端更新

0.5.1 支持自托管客户端更新。生产 Compose 会把服务器上的 `backend/releases/` 只读挂载到容器：

```text
backend/releases/ -> /var/lib/studyshot/releases/
```

建议服务器上的发布包也按版本号归档：

```text
backend/releases/
  0.5.1/
    StudyShot-Relay-Android-0.5.1.apk
    StudyShot-Relay-Windows-0.5.1-portable.exe
    StudyShot-Relay-Linux-Client-0.5.1_amd64.deb
  0.5.2/
    StudyShot-Relay-Desktop-Linux-0.5.2_amd64.deb
```

配置示例：

```dotenv
ANDROID_UPDATE_APK_PATH=/var/lib/studyshot/releases/0.5.1/StudyShot-Relay-Android-0.5.1.apk
ANDROID_UPDATE_VERSION_CODE=9
ANDROID_UPDATE_VERSION_NAME=0.5.1
ANDROID_UPDATE_RELEASE_NOTES=Android 0.5.1：修复登录提示、补充帮助页并加入自托管更新

WINDOWS_UPDATE_PACKAGE_PATH=/var/lib/studyshot/releases/0.5.1/StudyShot-Relay-Windows-0.5.1-portable.exe
WINDOWS_UPDATE_VERSION_NAME=0.5.1
WINDOWS_UPDATE_RELEASE_NOTES=Windows 0.5.1：新增自托管更新并精简包体

LINUX_DESKTOP_UPDATE_PACKAGE_PATH=/var/lib/studyshot/releases/0.5.2/StudyShot-Relay-Desktop-Linux-0.5.2_amd64.deb
LINUX_DESKTOP_UPDATE_VERSION_NAME=0.5.2
LINUX_DESKTOP_UPDATE_RELEASE_NOTES=Linux 桌面端 0.5.2：修复 WebSocket 重连弹错和 HTTPS 下旧 HTTP 警告残留

LINUX_CLI_UPDATE_PACKAGE_PATH=/var/lib/studyshot/releases/0.5.1/StudyShot-Relay-Linux-Client-0.5.1_amd64.deb
LINUX_CLI_UPDATE_VERSION_NAME=0.5.1
LINUX_CLI_UPDATE_RELEASE_NOTES=Linux CLI/Web 0.5.1：新增 update 命令和 Web 更新入口
```

注意：

- Android 必须递增 `ANDROID_UPDATE_VERSION_CODE`，并使用与已安装版本兼容的签名证书。
- Windows 和 Linux 使用语义化 `VERSION_NAME` 比较。
- 某通道的包路径或版本为空时，该通道返回 `available: false`。
- 后端会按文件内容计算 SHA-256，并把校验值返回给客户端。
- 客户端下载后必须校验 SHA-256；不一致时不会打开安装包。

更新发布配置后重建后端容器：

```bash
cd backend
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build backend
```

验证发布元数据需要已绑定设备 token：

```bash
curl -H "Authorization: Bearer DEVICE_TOKEN" \
  https://studyshot.example.com/api/v1/updates/android
```

桌面和 Linux 通道：

```bash
curl -H "Authorization: Bearer DEVICE_TOKEN" \
  https://studyshot.example.com/api/v1/updates/windows

curl -H "Authorization: Bearer DEVICE_TOKEN" \
  https://studyshot.example.com/api/v1/updates/linux-desktop

curl -H "Authorization: Bearer DEVICE_TOKEN" \
  https://studyshot.example.com/api/v1/updates/linux-cli
```

通道必须和设备平台匹配。Android 设备只能访问 `android`；Windows 设备只能访问 `windows`；Linux 设备可访问 `linux-desktop` 或 `linux-cli`。

## 7. 停止与重启

停止 HTTPS 部署：

```bash
cd backend
docker compose --env-file .env.production -f docker-compose.prod.yml down
```

重启后端：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml restart backend
```

只重启 Caddy：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml restart caddy
```

IP HTTP 模式把 compose 文件换成 `docker-compose.ip-http.yml`。

## 8. 数据卷

生产 compose 使用以下 Docker volumes：

- `postgres-data`：PostgreSQL 数据。
- `image-storage`：图片文件。
- `caddy-data`：Caddy 证书和运行数据。
- `caddy-config`：Caddy 配置缓存。

不要随意删除这些 volumes。

实际 volume 名可能带 Compose 项目前缀。确认方式：

```bash
docker volume ls | grep studyshot
docker volume ls | grep image-storage
```

## 9. 数据库和图片备份

创建备份目录：

```bash
mkdir -p backups
```

备份 PostgreSQL：

```bash
cd backend
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
  pg_dump -U studyshot -d studyshot > backups/studyshot-$(date +%F-%H%M%S).sql
```

备份图片存储：

```bash
docker run --rm \
  -v backend_image-storage:/data \
  -v "$PWD/backups:/backups" \
  alpine tar czf /backups/studyshot-images-$(date +%F-%H%M%S).tar.gz -C /data .
```

如果 volume 名不是 `backend_image-storage`，先用 `docker volume ls` 查实际名称。

## 10. 恢复

恢复前先停止后端，避免写入：

```bash
cd backend
docker compose --env-file .env.production -f docker-compose.prod.yml stop backend
```

恢复 SQL：

```bash
cat backups/studyshot.sql | docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres \
  psql -U studyshot -d studyshot
```

恢复图片前确认目标 volume 名，然后按需解压备份包。

恢复后启动后端：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml start backend
```

## 11. 本地集成测试

本地测试数据库使用独立 `55432` 端口和 tmpfs，不会重置开发或生产数据库：

```bash
cd backend
cp .env.test.example .env.test
npm run test:db:up
npm run test:db:migrate
npm test
npm run test:db:down
```

如果只跑不依赖数据库的单元测试：

```bash
npm run test:unit
```

## 12. 安全检查

上线前确认：

- `.env.production` 没有示例密码。
- `JWT_SECRET` 是随机值。
- `INITIAL_OWNER_PASSWORD` 已修改并妥善保存。
- HTTPS 模式只开放 `80/tcp` 和 `443/tcp`。
- PostgreSQL 没有映射公网端口。
- `PUBLIC_BASE_URL` 与实际访问地址一致。
- 正式客户端优先使用 `https://` 和 `wss://`。
- IP HTTP 模式只用于临时测试或受信私有网络。
- 发布更新包使用可信签名，Android `versionCode` 递增。

## 13. 当前限制

- 后端镜像包含 Prisma CLI，用于容器启动时执行迁移。镜像体积不是最小，但部署简单。
- Caddy 请求体限制当前是 32 MB；后端默认最大图片大小是 30 MB。如果调整 `MAX_IMAGE_SIZE_MB`，也要同步调整 `backend/docker/Caddyfile`。
- 自托管更新只分发安装包，不负责绕过系统安装确认。Android、Windows 和 Linux 都仍需要用户确认安装或打开安装器。
