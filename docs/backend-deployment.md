# Backend Deployment

文档版本：2026-06-18

本文说明如何把 StudyShot Relay 后端部署到一台 Linux 服务器。推荐服务器使用 Docker Compose、PostgreSQL 和 Caddy。Caddy 负责 HTTPS 和 WSS，后端只在 Docker 内部监听 `3000`。

## 本地集成测试

```bash
cd backend
cp .env.test.example .env.test
npm run test:db:up
npm run test:db:migrate
npm test
npm run test:db:down
```

测试数据库使用独立的 `55432` 端口和 tmpfs，不会重置开发或生产数据库。

## 1. 部署目录

建议把后端目录放到服务器：

```bash
/opt/studyshot/backend
```

该目录至少包含：

- `Dockerfile`
- `docker-compose.prod.yml`
- `.env.production`
- `package.json`
- `package-lock.json`
- `prisma/`
- `src/`
- `docker/Caddyfile`

## 2. DNS

创建一个域名，例如：

```text
studyshot.example.com
```

把 DNS A/AAAA 记录指向服务器公网 IP。

客户端服务器地址填写：

```text
https://studyshot.example.com
```

WebSocket 地址由客户端从服务器地址推导：

```text
wss://studyshot.example.com/api/v1/ws
```

## 3. 环境文件

在 `backend/` 目录复制示例文件：

```bash
cp .env.production.example .env.production
```

必须修改：

- `PUBLIC_BASE_URL`
- `STUDYSHOT_DOMAIN`
- `ACME_EMAIL`
- `POSTGRES_PASSWORD`
- `DATABASE_URL` 中的数据库密码
- `JWT_SECRET`
- `INITIAL_OWNER_LOGIN`
- `INITIAL_OWNER_PASSWORD`

注意：

- `.env.production` 不能提交到代码仓库。
- `JWT_SECRET` 至少 32 字节随机字符串。
- `INITIAL_OWNER_PASSWORD` 至少 8 个字符。
- 首次启动时会创建初始主用户；如果用户已存在，重启不会覆盖密码。

生成随机密钥示例：

```bash
openssl rand -base64 48
```

## 4. 启动

推荐使用根目录一键部署脚本：

```bash
./scripts/deploy-backend.sh --domain studyshot.example.com --email admin@example.com
```

脚本会生成 `backend/.env.production`，并执行生产 Docker Compose 启动流程。已有 `.env.production` 时，脚本会直接复用该文件；如需重写，添加 `--force-env`。

如果没有域名，可以临时使用纯 IP HTTP 模式：

```bash
./scripts/deploy-backend.sh --ip-http 1.2.3.4
```

此模式会使用 `backend/docker-compose.ip-http.yml`，不启动 Caddy，不申请 HTTPS 证书，而是把后端直接映射到公网：

```text
http://1.2.3.4:3000
```

注意：纯 IP HTTP 不加密，公网长期使用会暴露 token 和图片内容。更稳妥的做法是仅用于临时测试，或者配合 Tailscale / ZeroTier / WireGuard 等私有网络使用。

也可以在 `backend/` 目录手动执行：

在 `backend/` 目录执行：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

启动顺序：

1. PostgreSQL 启动并通过健康检查。
2. 后端镜像构建。
3. 后端执行 `prisma migrate deploy`。
4. 后端启动 HTTP/WebSocket 服务。
5. Caddy 自动申请 HTTPS 证书并反向代理到后端。

查看日志：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f backend
docker compose --env-file .env.production -f docker-compose.prod.yml logs -f caddy
```

健康检查：

```bash
curl https://studyshot.example.com/api/v1/healthz
```

期望返回：

```json
{
  "success": true,
  "data": {
    "status": "ok"
  }
}
```

网页管理后台：

```text
https://studyshot.example.com/admin
```

纯 IP HTTP 模式对应：

```text
http://1.2.3.4:3000/admin
```

使用主用户账号登录后，可以创建绑定码、管理设备权限、创建子用户、管理用户组和查看审计日志。

## 5. 端口

公网只需要开放：

- `80/tcp`：Caddy 申请和续期证书。
- `443/tcp`：HTTPS/WSS。

不要把 PostgreSQL 端口暴露到公网。

`docker-compose.prod.yml` 中 PostgreSQL 没有 `ports`，只在 Compose 内部网络可访问。

## 6. HTTPS 与 WSS

Caddy 配置文件：

```text
backend/docker/Caddyfile
```

当前配置会：

- 为 `STUDYSHOT_DOMAIN` 自动申请证书。
- 反向代理所有 HTTP API。
- 自动支持 WebSocket upgrade。
- 限制请求体最大 32 MB。

如果你把 `MAX_IMAGE_SIZE_MB` 调大，Caddy 的 `request_body max_size` 也要同步调大。

## 7. 更新部署

拉取或上传新代码后：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml up -d --build
```

后端容器启动时会自动执行：

```bash
npm run db:migrate:deploy
```

因此新迁移会在启动前应用。

升级到 `0.4.1` 后可通过健康检查确认实际部署版本：

```bash
curl -fsS http://你的服务器:3000/api/v1/healthz
```

返回的 `version` 必须为 `0.4.1`。Android `0.4.1` 同时修复了 `0.4.0` 将大小写敏感绑定码转换为大写的问题。

## 8. 停止与重启

停止：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml down
```

重启：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml restart backend
```

只重启 Caddy：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml restart caddy
```

## 9. 数据卷

生产 compose 使用以下 Docker volumes：

- `postgres-data`：PostgreSQL 数据。
- `image-storage`：图片文件。
- `caddy-data`：Caddy 证书和运行数据。
- `caddy-config`：Caddy 配置缓存。

不要随意删除这些 volumes。

## 10. 数据库备份

创建备份目录：

```bash
mkdir -p backups
```

备份 PostgreSQL：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres pg_dump -U studyshot -d studyshot > backups/studyshot-$(date +%F-%H%M%S).sql
```

备份图片存储：

```bash
docker run --rm -v backend_image-storage:/data -v "$PWD/backups:/backups" alpine tar czf /backups/studyshot-images-$(date +%F-%H%M%S).tar.gz -C /data .
```

实际 volume 名可能带 Compose 项目前缀。用下面命令确认：

```bash
docker volume ls | grep image-storage
```

## 11. 恢复数据库

恢复前先停止后端，避免写入：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml stop backend
```

恢复 SQL：

```bash
cat backups/studyshot.sql | docker compose --env-file .env.production -f docker-compose.prod.yml exec -T postgres psql -U studyshot -d studyshot
```

恢复图片前确认目标 volume 名，然后按需解压。

恢复后启动后端：

```bash
docker compose --env-file .env.production -f docker-compose.prod.yml start backend
```

## 12. 安全检查

上线前必须确认：

- `.env.production` 中没有示例密码。
- `JWT_SECRET` 是随机值。
- `INITIAL_OWNER_PASSWORD` 已改。
- 服务器安全组只开放 80 和 443。
- PostgreSQL 没有映射公网端口。
- `PUBLIC_BASE_URL` 是 HTTPS。
- 客户端使用 `https://` 和 `wss://`。

## 13. 当前限制

- 当前后端镜像包含 Prisma CLI，用于容器启动时执行迁移。镜像体积不是最小，但部署简单。
- Caddy 请求体限制当前是 32 MB；后端默认最大图片大小是 30 MB。
- 本项目还没有完整 Web 管理 UI，管理能力主要通过 API 或后续桌面/安卓客户端承载。
