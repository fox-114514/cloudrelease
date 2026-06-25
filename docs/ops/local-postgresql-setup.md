# 本地 PostgreSQL 配置记录

记录日期：2026-06-18

## 当前配置

由于当前环境没有 PostgreSQL 服务端包，且没有可用的 sudo 交互权限，本项目使用用户态 PostgreSQL：

- PostgreSQL 版本：18.4
- 服务端二进制目录：`.local-pg/usr/lib/postgresql/18/bin`
- 数据目录：`.local-pg-data`
- 日志文件：`.local-pg.log`
- 监听地址：`localhost`
- 监听端口：`55432`
- 数据库用户：`studyshot`
- 认证方式：本地开发使用 `trust`

已创建数据库：

- `studyshot`
- `studyshot_test`

当前后端配置：

- `backend/.env` 指向 `postgresql://studyshot:studyshot@localhost:55432/studyshot`
- `backend/.env.test` 指向 `postgresql://studyshot:studyshot@localhost:55432/studyshot_test`

## 启动 PostgreSQL

在项目根目录执行：

```bash
.local-pg/usr/lib/postgresql/18/bin/pg_ctl \
  -D /home/fox/桌面/1/.local-pg-data \
  -l /home/fox/桌面/1/.local-pg.log \
  -o "-c listen_addresses=localhost -c port=55432 -c unix_socket_directories=/tmp" \
  start
```

## 停止 PostgreSQL

```bash
.local-pg/usr/lib/postgresql/18/bin/pg_ctl \
  -D /home/fox/桌面/1/.local-pg-data \
  stop
```

## 检查状态

```bash
.local-pg/usr/lib/postgresql/18/bin/pg_ctl \
  -D /home/fox/桌面/1/.local-pg-data \
  status
```

```bash
pg_isready -h localhost -p 55432 -U studyshot
```

## 运行迁移

业务库：

```bash
cd backend
npx prisma migrate deploy
```

测试库：

```bash
cd backend
env DATABASE_URL=postgresql://studyshot:studyshot@localhost:55432/studyshot_test \
  npx prisma migrate deploy
```

## 运行测试

```bash
cd backend
npm test
```

## 已验证结果

已通过：

- `npx prisma migrate deploy`
- `env DATABASE_URL=postgresql://studyshot:studyshot@localhost:55432/studyshot_test npx prisma migrate deploy`
- `npm test`

测试结果：

- 4 个测试文件通过
- 23 个测试通过

## 注意

`.local-pg/`、`.local-pg-data/`、`.local-pg.log` 和下载的 `postgresql-*.deb` 已加入 `.gitignore`，不要提交这些本地运行产物。
