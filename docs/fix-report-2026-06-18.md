# 修复记录：2026-06-18 后端权限与测试环境

## 修复范围

本次修复针对上一轮检查发现的三个问题：

1. 具有 `canManageSpace` 的设备调用 `GET /api/v1/devices` 时，仍被错误限制为只能查看自己用户下的设备。
2. 测试清库逻辑缺少安全护栏，存在误清非测试数据库的风险。
3. Docker Compose 只创建业务数据库 `studyshot`，没有为测试创建 `studyshot_test`。

## 已修改文件

- `backend/src/routes/devices.ts`
- `backend/src/routes/devices.test.ts`
- `backend/src/test/setup.ts`
- `backend/docker-compose.yml`
- `backend/docker/initdb/01-create-test-db.sql`

## 具体修复

### 1. 修复管理设备列表过滤条件

原逻辑：

- 设备 token 只有具备 `canManageSpace` 才允许进入 `GET /devices`。
- 但进入查询后，只要不是 owner user token，就会加上 `where.userId = auth.userId`。
- 这导致具备 `canManageSpace` 的设备仍然只能看到自己用户下的设备，无法管理整个空间。

现逻辑：

- 无 `canManageSpace` 的设备仍然禁止访问 `GET /devices`。
- owner user token 可以查看整个空间。
- 具备 `canManageSpace` 的设备 token 可以查看整个空间。
- 普通 child user token 只能查看自己的设备。

### 2. 增加回归测试

新增测试覆盖：

- 具备 `canManageSpace` 的设备 token 可以列出同一空间下多个用户的设备。

该测试用于防止后续再次把管理设备错误限制到单个用户范围。

### 3. 增加测试清库安全护栏

`backend/src/test/setup.ts` 现在会在清空数据库前检查：

- `NODE_ENV` 必须是 `test`。
- `DATABASE_URL` 必须包含 `_test`。

如果条件不满足，测试会直接失败，不会执行 `deleteMany()`。

这个护栏用于避免测试误连开发库或生产库后清空核心表。

### 4. 增加测试数据库初始化脚本

新增：

- `backend/docker/initdb/01-create-test-db.sql`

该脚本会在 PostgreSQL 容器首次初始化时创建：

- `studyshot_test`

同时更新 `backend/docker-compose.yml`，把 `./docker/initdb` 挂载到 PostgreSQL 官方镜像的初始化目录：

- `/docker-entrypoint-initdb.d`

注意：PostgreSQL 官方镜像只会在数据卷首次初始化时执行该目录下的脚本。如果本地已经存在旧的 `postgres-data` volume，需要手动创建 `studyshot_test`，或者重建 volume。

## 验证结果

已通过：

- `npm run build`
- `npx prisma validate`

未在当前环境跑通：

- `npm test`

失败原因：

- 当前环境没有可连接的 PostgreSQL 服务。
- 尝试用 Docker Compose 启动 `postgres` 时，Docker 需要拉取 `postgres:16-alpine`。
- 当前环境访问 Docker Hub 超时，无法完成镜像拉取。

失败不是 TypeScript 编译问题，也不是 Prisma schema 校验问题；测试卡在连接 `localhost:5432` 的 PostgreSQL。

## 后续验证建议

在有 Docker 网络访问的环境中执行：

```bash
cd backend
docker compose up -d postgres
npx prisma migrate deploy
DATABASE_URL=postgresql://studyshot:studyshot@localhost:5432/studyshot_test npx prisma migrate deploy
npm test
```

如果已有旧的 `postgres-data` volume，初始化脚本不会自动补建 `studyshot_test`。可以选择：

```bash
cd backend
docker compose down -v
docker compose up -d postgres
```

或者手动创建测试数据库后再对 `studyshot_test` 跑迁移。

---

## 追加修复：后端完成度检查后的安全与功能补齐

追加时间：2026-06-18

### 修复范围

本轮针对“后端写完”检查中发现的问题继续修复和补充：

1. 图片下载接口存在跨主用户空间的手动下载越权风险。
2. `selected_devices` 接收范围没有实现，设置后永远不会生成投递。
3. WebSocket `image.created` 事件里的 `uploadDeviceName` 错误填成目标设备名。
4. 用户、用户组、审计日志等管理接口缺失。
5. 接收来源规则缺少管理接口。
6. 图片保留时间配置 `DEFAULT_RETENTION_DAYS` 没有被上传逻辑使用。
7. 测试存储目录没有加入 `.gitignore`。

### 已修改文件

- `backend/src/routes/images.ts`
- `backend/src/services/delivery.ts`
- `backend/src/plugins/ws.ts`
- `backend/src/routes/admin.ts`
- `backend/src/routes/devices.ts`
- `backend/src/routes/images.test.ts`
- `backend/src/routes/devices.test.ts`
- `backend/src/app.ts`
- `.gitignore`

### 具体修复

#### 1. 修复跨空间图片下载越权

`GET /api/v1/images/:imageId/download` 现在查询图片时会限制：

- `ownerUserId = request.device.ownerUserId`

这保证了 `canManualDownload` 只在当前主用户空间内生效。即使设备拥有手动下载权限，也不能通过猜测 `imageId` 下载其他空间的图片。

新增回归测试：

- `forbids manual download across owner spaces`

#### 2. 实现 `selected_devices` 投递规则

`generateDeliveries()` 现在支持读取 `receive_source_rules`：

- 目标设备 `autoReceiveScope = selected_devices` 时，只有存在启用的 `(targetDeviceId, sourceDeviceId)` 规则才会生成投递。
- 没有规则时不会生成投递。

新增回归测试：

- `creates delivery for selected_devices only when receive source rule exists`

#### 3. 补充接收来源规则管理 API

新增设备接收来源规则接口：

- `GET /api/v1/devices/:deviceId/receive-sources`
- `PUT /api/v1/devices/:deviceId/receive-sources/:sourceDeviceId`
- `DELETE /api/v1/devices/:deviceId/receive-sources/:sourceDeviceId`

权限要求：

- owner user token，或
- 具备 `canManageSpace` 的设备 token

接口会检查目标设备和来源设备必须属于同一个 owner space。

新增回归测试：

- `allows owner user token to configure selected source devices`

#### 4. 修复 WebSocket 来源设备名

`image.created` 事件中的：

- `source.uploadDeviceName`

现在来自上传设备 `image.uploadDevice.name`，不再错误使用目标接收设备名。

#### 5. 补充基础管理 API

新增 `backend/src/routes/admin.ts`，并注册到 `/api/v1`。

新增接口：

- `GET /api/v1/users`
- `POST /api/v1/users`
- `PATCH /api/v1/users/:userId`
- `GET /api/v1/groups`
- `POST /api/v1/groups`
- `POST /api/v1/groups/:groupId/members`
- `DELETE /api/v1/groups/:groupId/members/:userId`
- `GET /api/v1/audit-logs`

权限要求：

- owner user token，或
- 具备 `canManageSpace` 的设备 token

当前实现覆盖 MVP 管理需求：创建/禁用子用户、查看用户、创建用户组、管理组成员、查询审计日志。

#### 6. 使用图片保留时间配置

上传图片时的过期时间现在使用：

- `config.DEFAULT_RETENTION_DAYS`

不再写死 30 天。

#### 7. 忽略测试存储产物

`.gitignore` 新增：

- `test-storage/`
- `backend/storage/`
- `backend/test-storage/`

避免测试生成的图片进入仓库。

### 验证结果

已通过：

- `npm run build`
- `npx prisma validate`

仍未在当前环境跑通：

- `npm test`

当前失败原因仍是环境问题：

- Vitest 已发现并执行 23 个测试。
- 所有测试都失败在 `backend/src/test/setup.ts` 清库阶段。
- Prisma 无法连接 `localhost:5432` PostgreSQL。

关键错误：

```text
Can't reach database server at `localhost:5432`
```

这表示测试数据库服务未启动或当前环境无法连接 PostgreSQL。此前尝试通过 Docker Compose 启动 PostgreSQL 时，Docker Hub 拉取 `postgres:16-alpine` 超时，因此本环境无法完成数据库集成测试。

### 后续验证命令

在可拉取 Docker 镜像或已有 PostgreSQL 的环境中执行：

```bash
cd backend
docker compose up -d postgres
npx prisma migrate deploy
DATABASE_URL=postgresql://studyshot:studyshot@localhost:5432/studyshot_test npx prisma migrate deploy
npm test
```

如果已有旧数据卷，且里面没有 `studyshot_test`，需要重建 volume 或手动创建测试库：

```bash
cd backend
docker compose down -v
docker compose up -d postgres
```
