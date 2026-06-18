# minimax审查报告

本报告由 opencode (MiniMax-M3) 自动审查产生。仅做问题发现与建议，不对代码进行修改。

> 说明：本审查报告基于独立阅读 `backend/src`、`desktop/src`、`android/app/src/main`、`scripts/`、`docs/`、配置文件等得到。已发现的问题与 `docs/bug-report-2026-06-18.md` 中已记录的内容**不重复**——本报告聚焦于该 bug 报告中尚未覆盖或分析角度不同的内容。所有未在源码、文档中明确修复的状态描述，均按照阅读时看到的代码现状撰写。

---

## 第 1 次更新 — 初始审查框架

- **更新时间戳**: 2026-06-18（初稿）
- **审查范围**: 项目结构概览、文档规范审查
- **审查方法**: 浏览项目目录、README、规格文档、源码入口

### 项目概况

这是一个跨设备图片快传系统，包含三部分：

| 模块 | 技术栈 | 用途 |
|------|--------|------|
| backend | Node.js + TypeScript + Fastify + Prisma | 后端 API + WebSocket |
| desktop | Electron + TypeScript | 桌面客户端 |
| android | Kotlin + Jetpack Compose | 安卓 App |

### 既有审查文档（已存在）

- `docs/bug-report-2026-06-18.md`：上一次审查发现 39 个 Android bug、17 个后端 bug、11 个桌面 bug。
- `docs/fix-report-2026-06-18.md`：记录了上轮 bug 的部分修复（管理 API、跨空间下载越权、selected_devices 等）。

本报告补充以上两份文档之外或更深入的问题。

### 待审查模块清单

- [x] backend/src 全部源码
- [x] desktop/src 全部源码
- [x] android/app 全部源码
- [x] 部署脚本 scripts/
- [x] 配置示例 .env.example / docker-compose*.yml
- [x] 文档 docs/

---

## 第 2 次更新 — 后端 (backend) 深入 bug 清单

- **更新时间戳**: 2026-06-18（第二轮）
- **审查范围**: 后端所有源文件 + Prisma schema + 测试 + 部署脚本

### B-NEW-1 — 上传请求体未在文件大小超限时保护事务
- **文件/行号**: `backend/src/routes/images.ts:38`
- **问题**: `request.file({ limits: { fileSize: request.server?.initialConfig.bodyLimit } })` 使用可选链访问 `initialConfig.bodyLimit`。Fastify 在不同运行模式下（直接 `app.listen()` / `app.inject()` / 反向代理后）初始 config 可能不可见；一旦 `bodyLimit` 为 `undefined`，`{ fileSize: undefined }` 可能被 `@fastify/multipart` 视为“无限制”，绕过全局限制。`app.ts:24` 已经设置了全局 `bodyLimit`，而本处的覆盖反而抹平了它。
- **建议**: 显式使用 `config.MAX_IMAGE_SIZE_MB * 1024 * 1024`，并在路由顶部一次性 `await request.file()`，依赖全局 `bodyLimit`，删除覆盖。

### B-NEW-2 — `notification` 状态写库和发送未做幂等性，可能重复推送
- **文件/行号**: `backend/src/plugins/ws.ts:17-65`
- **问题**: `notifyDevicesForImage()` 在循环里对每个目标调用 `client.socket.send(...)`，然后**异步**把 delivery 状态置为 `notified`。如果中途服务崩溃或数据库 update 失败（被 catch 吞掉），客户端可能先收到事件，但服务端状态仍为 `pending`，下次调用 `notifyDevicesForImage`（同一 imageId）会再发送一次。WebSocket 事件本身没有 server-side deliveryId 去重，依赖客户端幂等键。
- **建议**: 在发送之前先做 `findFirst({ status: 'notified' })` 过滤；或在事务里同时 update + send。事件用 `deliveryId-${Date.now()}` 生成 `eventId` 也有可能在并发时冲突。

### B-NEW-3 — WS `lastPongAt` 在不同消息类型间共享，但只有 ping/pong 重置
- **文件/行号**: `backend/src/plugins/ws.ts:119-135`, `desktop/src/relay-client.ts:766-776`
- **问题**: 服务端“心跳超时”是基于 `lastPongAt`，但只有客户端发送 `ping` 时才会重置。服务端真正可观察的客户端活跃信号是“收到任意消息”，包括 `hello.ack`（服务端发出的）、`image.created`（下行）。当前实现**只接受 `ping` 更新 `lastPongAt`**，那么客户端处于“长时间无新事件但仍连接”状态（例如 90 秒没有新图片）时不会被服务端判超时；而服务端 `setInterval` 30 秒检查一次，超时阈值 90 秒，正常情况下不会误杀。
- **真正风险**: 如果客户端从未发送 `ping`（实现缺失或 bug），socket 永远不会被服务端判定超时；同时 `lastPongAt` 初值被赋为 `Date.now()`（`ws.ts:110`），即“刚连上就算活”，导致僵尸连接最长可存活 90 秒。考虑到对端心跳频率 30 秒，正常情况 90 秒即可触发 timeout——但如果客户端把 ping 改成了 `hello`，就会导致服务端持续认为“超时未触发”。
- **建议**: 任何客户端消息都重置 `lastPongAt`；或者在服务端主动下行 `ping` 让客户端回应。

### B-NEW-4 — `registerDevice` 接收 client-generated device id，可能被恶意占用
- **文件/行号**: `backend/src/routes/devices.ts:15, 100-112`
- **问题**: `clientGeneratedDeviceId` 是可选的；如果同一设备被撤销后想重新绑定，客户端传入同样的 UUID 试图保留 deviceId，但撤销的 device 行还在数据库里（只是 `revokedAt` 被设置）。`prisma.device.create({ data: { id: body.clientGeneratedDeviceId } })` 直接把 PK 写死，**未检查该 id 是否已被使用**——攻击者可以预测/猜测其它已撤销设备的 UUID，把 `clientGeneratedDeviceId` 设成该 UUID，新设备会复用同一行（虽然 deviceTokenHash 不同，但 `uploadedImages`、`deliveries` 等外键全部挂在原 device 上，造成数据归属混乱）。
- **建议**: 限制 `clientGeneratedDeviceId` 只能是当前注册者**新生成**的 UUID；或者在事务里 `findUnique({ where: { id } })`，已存在则报错。

### B-NEW-5 — `bindCodes` 没有跨空间保护：用户 A 的绑定码可能注册到用户 B 名下
- **文件/行号**: `backend/src/routes/devices.ts:82-95`
- **问题**: 创建绑定码时允许 `userId` 指向同一 `ownerUserId` 空间内的任意用户，路由也校验了 `targetUserId` 在同一 owner 空间——这部分 OK。但**当 `userId` 缺失**（默认 `actorUserId`）时，actor 必须属于同一 ownerUserId；如果 owner 用户的 token 来自不同 owner 空间（不可能，因为 owner 只属于自己空间），但 child 用户 token 不能创建绑定码——OK。然而**没有限制**：owner token 创建绑定码后，绑定码的 `targetUserId` 一旦是另一个 child 用户，攻击者只要拿到绑定码就能注册设备到该 child 用户名下。协议文档 `protocol.md` 的“客户端要求”没有说“绑定码应当只有 owner 用户自己消费”，这是设计意图——但若 owner 与 child 共用同一物理机器且 child 偶然能看到 owner 创建的绑定码，会出现权限提升。
- **建议**: 在创建绑定码时记录 `createdByUserId` 与 `targetUserId`，并在注册时校验：`usedByDevice.userId` 必须等于 `targetUserId`（目前是的，因为 `data: { userId: targetUser.id }`），但**实际**只校验 user 是否属于同一空间，没有限制“必须是同一用户”。
- **结论**: 该风险中等，建议至少加日志。

### B-NEW-6 — `generateDeliveries` 的 delivery 创建没用事务边界
- **文件/行号**: `backend/src/services/delivery.ts:34-42`
- **问题**: 在 `tx.$transaction` 内调用 `generateDeliveries`，但 `generateDeliveries` 内部又调用 `tx.delivery.create(...)`。Prisma 的 `tx.delivery` 与 `tx` 共享同一连接是 OK 的。然而如果 `shouldReceiveFrom` 里 `db.receiveSourceRule.findUnique` 抛出，循环提前退出，部分 delivery 已经被创建到事务里，但事务还未提交——属于正常的 Prisma 行为。这里更值得关注的是：**`shouldReceiveFrom` 是 `async` 函数**，但 `generateDeliveries` 在循环里 `await` 它，**对每个目标设备是串行的**。当 owner 空间下设备数量为 100 时，N 次串行查询 `receiveSourceRule.findUnique` 会非常慢。
- **建议**: 改为并发 `Promise.all` 或批量查询 `receiveSourceRule.findMany({ where: { targetDeviceId: { in: ids }, sourceDeviceId: image.uploadDeviceId, enabled: true } })`。

### B-NEW-7 — `notifyDevicesForImage` 在 `findMany` 之后才更新 `notified` 状态，可能错过离线重连
- **文件/行号**: `backend/src/plugins/ws.ts:17-65`
- **问题**: 客户端在 `image.created` 事件到达时是离线的，下一次上线通过 `GET /deliveries/pending` 拿到 `pending` 状态的 deliveries。但如果服务端先调了 `notifyDevicesForImage`，`findMany` 过滤条件是 `status: { in: ["pending", "notified"] }`，所以 `pending` 状态的 delivery 在客户端离线时仍在 `pending`，上线后还能通过 pending 拉到——这没问题。但**反过来**：如果服务端先异步执行 `notifyDevicesForImage`，期间另一并发请求把同一 delivery 标记为 `downloaded`，`notifyDevicesForImage` 的循环还在 send 旧事件，客户端可能拉到已下载的 delivery 然后二次下载。
- **建议**: 在发送前再次校验 `delivery.status === 'pending'`，避免向已经 ack 过的设备再发事件。

### B-NEW-8 — `cleanup` 任务里 `prisma.image.findMany` 没有分页/分批，可能 OOM
- **文件/行号**: `backend/src/services/cleanup.ts:12-17`
- **问题**: `findMany` 默认没有分页。如果系统运行很久未清理，几万张过期图片会被一次性加载到内存，再逐个 `unlink`。`image.findMany` 默认 limit 是 `take: Number.MAX_SAFE_INTEGER`，确实会有内存风险。
- **建议**: 改为分批 `findMany({ take: 500 })` 循环处理，或用游标分页。

### B-NEW-9 — `cleanup` 没有处理孤儿文件（DB 中无记录但磁盘上还在）
- **文件/行号**: `backend/src/services/cleanup.ts`
- **问题**: `unlink` 是基于 DB 记录清理；如果上传失败但文件已落到磁盘（如 `HASH_MISMATCH` 早期版本未删除，现在已修复，但仍有 `getImageDimensions` 失败、事务失败、Sharp 抛错的场景），会产生孤儿文件长期占用磁盘。
- **建议**: 定期用 `fs.readdir(STORAGE_DIR/images)` 列出所有文件，与 `prisma.image.findMany({ select: { storageKey: true } })` 做差集，删除孤儿。

### B-NEW-10 — `delivery.ack` 的 status 写入不会限制已经终态的 delivery
- **文件/行号**: `backend/src/routes/deliveries.ts:78-85`
- **问题**: 客户端可能多次 ACK 同一 delivery（例如客户端本地状态错乱、`pending` 拉取时已被处理但仍返回）。当前 `update` 没有 `where: { status: { not: 'downloaded' } }` 之类保护，结果是 ACK `failed` 后还能被覆盖为 `downloaded`，日志就丢了。
- **建议**: 只允许从 `pending`/`notified` 状态更新；`downloaded`/`expired` 不应被覆盖。

### B-NEW-11 — JWT `expiresIn` 写死 7 天，没有 refresh/黑名单机制
- **文件/行号**: `backend/src/lib/jwt.ts:11-17`, `backend/src/plugins/auth.ts`
- **问题**: 用户 JWT 一旦签发 7 天有效，期间如果 owner 修改了密码或禁用账号，**旧的 JWT 仍然可用**（直到自然过期）。当前 `/auth/login` 成功后只重发 token，没有“撤销所有 token”机制。
- **建议**: 给 `users` 表加 `tokenVersion` 字段，每次登录自增；JWT 校验时对比。

### B-NEW-12 — `bindCodes` 没有限速，可能被穷举/滥用
- **文件/行号**: `backend/src/routes/bind-codes.ts`
- **问题**: `@fastify/rate-limit` 是全局 `1000 req/min/IP`，单个用户可以每分钟创建 1000 个绑定码。绑定码本身有 24B 熵（约 192 bit），但创建时是服务端资源消耗（DB 写入、token 生成）。恶意用户可以刷绑定码填表。
- **建议**: 给 `/bind-codes` 加专门的 rate-limit 配置，例如 `max: 10, timeWindow: '1 minute'`。

### B-NEW-13 — `auth/login` 失败无审计/限速，潜在凭据填充
- **文件/行号**: `backend/src/routes/auth.ts:14-53`
- **问题**: `verifyPassword` 使用 `bcrypt.compare`，每次约 100ms，攻击者可以高频试错。配合全局 rate-limit `1000/min/IP` 实际上足够缓解，但**没有失败计数**：5 次失败后锁账号这种标准实践缺失。日志也只记录“invalid credentials”，没有记录 IP 或登录名（出于隐私），无法追溯异常登录。
- **建议**: 引入 per-login 失败计数器（如 10 次失败锁定 15 分钟），并把失败审计记到 `audit_logs`。

### B-NEW-14 — `users.emailOrLogin` UNIQUE 但 lowercase 敏感
- **文件/行号**: `backend/prisma/schema.prisma:15`
- **问题**: `@unique @map("email_or_login")` 是大小写敏感的 unique；如果用户尝试登录 `Owner@...` 与 `owner@...` 会创建两个账户，并都能登录（除非显式 normalize）。当前代码没有 lowercase 化处理。
- **建议**: 在 `services/owner.ts` 创建 owner、admin 创建子用户、auth/login 时统一 `emailOrLogin.toLowerCase()`；或者迁移到 citext 字段。

### B-NEW-15 — `User.ownerUserId` 是字符串而非外键
- **文件/行号**: `backend/prisma/schema.prisma:12`
- **问题**: `ownerUserId String` 没有 `@relation` 也没有 `references`，因此数据库层面没有 FK 约束。如果 owner 用户被删除（目前没有删除 owner 接口，但未来可能加），children 的 `ownerUserId` 会变成悬空。`ensureInitialOwner()` 用两步更新（先 `ownerUserId: "self"` 后改为自己的 id），依赖 application 层。
- **建议**: 加 `ownerUserId String @relation("UserSpace", fields: [ownerUserId], references: [id], onDelete: Cascade)`，并迁移。

### B-NEW-16 — `auditLog.metadataJson` 没有大小限制
- **文件/行号**: `backend/src/services/audit.ts:21`, `backend/prisma/schema.prisma:256`
- **问题**: `metadata` 是 `Record<string, unknown>`，调用方可以传任意大的对象。`logAudit({ metadata: { hugeData: '...10MB' } })` 会被 JSON 序列化为 10MB 进 DB，单行 audit 拖垮存储和查询。
- **建议**: 在 `logAudit` 入口处做 JSON.stringify 后长度校验，超过 16KB 截断并打 warning。

### B-NEW-17 — `web-admin.ts` 直接 inline 565 行的 HTML 到字符串
- **文件/行号**: `backend/src/routes/web-admin.ts:3-565`
- **问题**: HTML、CSS、JS 全部写在字符串模板里。可维护性差、CSP header 写得非常宽松（`script-src 'unsafe-inline'`），缺少 SRI；`fetch('/api/v1' + path, ...)` 写死前缀没有错误处理（HTTP 4xx 抛出但没显示 API code 之外的内容）。
- **建议**: 把 HTML 抽到独立文件；CSP 收紧（删除 `'unsafe-inline'` 改用 nonce/hash）；fetch 加超时。

### B-NEW-18 — WebSocket 没有 origin 校验
- **文件/行号**: `backend/src/plugins/ws.ts:75-151`
- **问题**: `app.get('/ws', { websocket: true }, ...)` 没有校验 `req.headers.origin`。浏览器 WebSocket 不强制同源，跨站 WebSocket 攻击（CSWSH）允许恶意网页在用户已登录后端时建立 WS。考虑到后端用 Bearer token 而非 cookie，攻击者无法读到 token，但**如果用户从 `https://studyshot.example.com/admin` 登录后**切换到恶意站点，恶意站点可以从浏览器读取 `localStorage.studyshot_admin_token` 并建立 WS（如果站点打开 WS 端点），但需要 token 主动注入——风险中等。
- **建议**: 校验 `req.headers.origin` 在白名单内，或至少在 prod 模式下要求 origin 匹配 `PUBLIC_BASE_URL`。

### B-NEW-19 — `CORS_ALLOWED_ORIGINS` 为空时 CORS 不注册，Web Admin 跨域拉数据失败
- **文件/行号**: `backend/src/app.ts:34-38`, `.env.example:26`, `.env.production.example`
- **问题**: `if (config.CORS_ALLOWED_ORIGINS) { await app.register(cors, ...) }`，若环境变量为空字符串则 CORS 根本不挂载。Web Admin 部署在 `https://studyshot.example.com/admin`，前端通过 `fetch('/api/v1...')` 调用，**由于同源，浏览器不会发 CORS preflight**，所以即便 CORS 未注册也能工作——但若用户将后端部署在 `https://api.example.com`，前端在 `https://studyshot.example.com`，则跨域请求失败且无任何提示。
- **建议**: CORS 始终注册，仅 origin 列表为空时设为不限制或提示用户配置。

### B-NEW-20 — `JWT_SECRET` 没有 rotation 支持
- **文件/行号**: `backend/src/lib/jwt.ts`, `backend/src/config.ts`
- **问题**: JWT 一旦签发，服务端换了 `JWT_SECRET` 之后所有现有 token 立即失效，所有用户被迫重新登录。生产环境需要 key rotation 支持。
- **建议**: 支持 `JWT_SECRETS="old,new"`，校验时按顺序尝试。

### B-NEW-21 — Caddy 反代没有限制请求体大小
- **文件/行号**: `backend/docker/Caddyfile:8-10`
- **问题**: `request_body { max_size 32MB }` 与后端 `MAX_IMAGE_SIZE_MB=30` 不匹配。若用户把 `MAX_IMAGE_SIZE_MB` 调到 64，Caddy 会拒绝 32-64MB 请求，且返回 413（Fastify 还没看到请求）。建议 Caddy 的 `max_size` 与后端对齐，或直接禁用（Caddy 默认 1MB）。
- **建议**: 用占位符 `${MAX_IMAGE_SIZE_MB}` 动态注入或直接删除（让 Fastify 限制）。

### B-NEW-22 — `@fastify/cors`、`@fastify/env`、`ulid`、`fastify-type-provider-zod` 是依赖但未使用
- **文件/行号**: `backend/package.json:17, 18, 27, 30`
- **问题**: `ulid` 没有被任何源文件 import；`@fastify/env` 未注册；`fastify-type-provider-zod` 未在 `app.ts` 用 `withTypeProvider`；`@fastify/cors` 是用了但仅在条件分支。
- **建议**: 删除未用依赖，缩小供应链风险。`@fastify/cors` 在 if 块里用了，保留。

### B-NEW-23 — `logger.sanitize` 不递归处理嵌套对象
- **文件/行号**: `backend/src/logger.ts:35-46`（已经在 bug 报告 B15 列出，本处补充建议）
- **问题**: 当前 `sanitize` 只看顶层 key。若 metadata 是 `{ request: { headers: { authorization: 'Bearer xxx' } } }`，`request` 这个 key 不在黑名单，整个对象会原样打印。
- **建议**: 递归遍历对象/数组；或强制 metadata 必须是 `Record<string, primitive>`，禁止嵌套。

### B-NEW-24 — `cleanup` 任务的 `setInterval` 不可被 graceful shutdown 取消
- **文件/行号**: `backend/src/index.ts:12`, `backend/src/services/cleanup.ts:53`
- **问题**: `startCleanupTask()` 只启动 `setInterval`，没有返回 `unref()` 或 handle。Docker 容器 stop 时可能正在执行一个清理循环，事务提交中途被 SIGKILL，造成 DB 部分更新（虽然 `prisma.$transaction` 会原子化，但 unlink 已经发生可能让 DB 标记 deletedAt 但文件其实未删除，下次清理再删一次——非致命但可见）。
- **建议**: 保存 interval handle，在 `app.addHook('onClose', ...)` 中 `clearInterval`。

### B-NEW-25 — `registerDevice` 的 `osVersion` / `appVersion` 没有长度限制
- **文件/行号**: `backend/src/routes/devices.ts:13-14`
- **问题**: zod schema 默认只检查 `.default("")`，允许任意长字符串。恶意客户端可以传 1MB 的 `osVersion`。
- **建议**: 加 `.max(256)`。

### B-NEW-26 — `bind-codes.purpose` 字段实际只有 `bind_device` 被消费
- **文件/行号**: `backend/src/routes/bind-codes.ts:9`, `backend/src/routes/devices.ts:82-84`
- **问题**: 协议文档 `protocol.md` 提到 `invite_child_user` purpose，但 `/devices/register` 仅接受 `bind_device`，且没有任何 `/users/register` 接口使用 `invite_child_user` 绑定码——这些绑定码只能创建却永远消费不掉，相当于“孤儿码”。
- **建议**: 落实 `invite_child_user` 用途（让 child 用户通过绑定码设置密码），或删除该枚举值。

### B-NEW-27 — `notifyDevicesForImage` 的 `eventId` 不是真正唯一
- **文件/行号**: `backend/src/plugins/ws.ts:31`
- **问题**: `eventId: \`${delivery.id}-${Date.now()}\`` 在同一毫秒并发发送时可能重复。客户端按 `deliveryId` 幂等而不是 `eventId`，所以实际影响小，但日志/审计可能困惑。
- **建议**: 用 `crypto.randomUUID()` 或 monotonic counter。

### B-NEW-28 — `audit-logs` 接口 `limit` 默认 50、最大 100，没有分页 cursor
- **文件/行号**: `backend/src/routes/admin.ts:54-56, 310-335`
- **问题**: 大空间下审计日志超过 100 条就只能取最近 100，无法翻历史。
- **建议**: 加 `cursor` / `before` 参数；或导出 JSONL。

### B-NEW-29 — `app.ts` 中 `bodyLimit` 用 `MAX_IMAGE_SIZE_MB * 1024 * 1024`，但 multipart `limits.fileSize` 也用同一个值
- **文件/行号**: `backend/src/app.ts:24, 43-46`
- **问题**: 当 `bodyLimit = N`，`limits.fileSize = N` 时，所有 multipart 字段（包括 sha256、sourceKind 等小字段）的总和不超 N 是正确的；但若客户端在 multipart 中加了大量额外字段，Fastify 可能先读完整个 body 再决定是否截断，导致内存压力。`@fastify/multipart` v9 默认 streaming，对 `fileSize` 是硬截断，但非 file 字段会累积在内存。
- **建议**: `limits.fieldSize` 也显式限制（如 4KB）。

### B-NEW-30 — `expiresAt` 重新计算没有考虑去重路径
- **文件/行号**: `backend/src/routes/images.ts:124`
- **问题**: 去重时返回的 `expiresAt` 是**原图**的过期时间，不是“新上传”的过期时间。当前实现是 OK 的（去重应该返回原图信息），但客户端可能误以为该图是新上传的。
- **建议**: 文档化该行为，或在响应中加 `originalCreatedAt`。

---

## 第 3 次更新 — 桌面客户端 (desktop) 深入 bug 清单

- **更新时间戳**: 2026-06-18（第三轮）
- **审查范围**: `desktop/src` 全部源文件

### D-NEW-1 — `safeStorage` 不可用时 token 以明文写入 `config.json`，且没有任何用户可见警告
- **文件/行号**: `desktop/src/config-store.ts:184-196`
- **问题**: 在 Linux 上（没有合适的 keyring、Keyring daemon 未运行）`safeStorage.isEncryptionAvailable()` 返回 false，token 落到 `plainDeviceToken`。配置文件虽然 `chmod 0o600`，但**用户的密码、root 提权、误删后从备份恢复**等场景仍能泄露。`tokenStorageWarning` 字段被设置但只在 settings 渲染时显示（`renderer.js:332-333`），首次启动不会主动弹窗。
- **建议**: 启动时如果检测到 `plainFile` 状态，应**主动**通过 `dialog.showMessageBox` 警告并提供禁用自动接收或继续的选项。

### D-NEW-2 — `getDeviceToken()` 解密失败时静默返回 `undefined`
- **文件/行号**: `desktop/src/config-store.ts:169-178`
- **问题**: `try { return safeStorage.decryptString(...) } catch { return undefined }`。如果 OS keyring 状态变化（Keyring 重置、用户登录另一个会话），解密失败时用户看到的是“设备未绑定”，但其实是“设备已绑定但 token 无法解密”。这种状态下 `bindDevice()` 才能重新绑定——OK，但**没有用户可见的提示**说明这是“解密失败 vs 真的未绑定”。
- **建议**: 把解密失败显式记录到 UI 状态（`tokenStorageError`），提示用户重新绑定。

### D-NEW-3 — `removeAllListeners()` 后立即 `socket.close()`，未等待 close frame 发出
- **文件/行号**: `desktop/src/relay-client.ts:806-813`
- **问题**: `socket.removeAllListeners(); socket.close();` 在 `ws` 库中，close 触发的是“发送 close frame 然后关闭连接”，但 `removeAllListeners()` 已经移除了 `close` 监听器，导致 `connect()` 后面的 reconnect 逻辑不会被“close 事件”触发——但 `closeSocket()` 之后通常会紧接着 `setConnection` 设置新状态，所以**实际**没有 bug，但语义上很别扭。
- **建议**: 拆分 `socket.close(1000)` 与 listener 移除顺序；或者只 `removeAllListeners("message")` 等，避免 `close` 监听器也被移除。

### D-NEW-4 — `connect()` 在没有 baseUrl 或 token 时仅设置 status，不抛错
- **文件/行号**: `desktop/src/relay-client.ts:421-429`
- **问题**: `if (!this.config.serverBaseUrl || !token) { this.setConnection({ status: 'stopped', lastError: '设备未绑定' }); return; }`——从 IPC handler `connection:connect` 调用时（`main.ts:180-182`），**返回值是 state**，但调用方期望"成功连接"。当 IPC handler 看到 state 是 `stopped`，UI 不知道是没连还是连不上。
- **建议**: 抛错或返回明确的 `{ connected: false, reason: ... }`。

### D-NEW-5 — `formatTimestamp` 把所有日期按本地时区格式化，文件名不安全
- **文件/行号**: `desktop/src/relay-client.ts:150-162`
- **问题**: `formatTimestamp(delivery.createdAt)` 用 `getFullYear/Month/Date/Hours/Minutes/Seconds`，**没有分隔符**导致结果是 `20260618-181530` 这种。文件名 `20260618-181530_source_deviceid.png` 是文件名安全的。但**如果设备名包含 `:` 或 `/` 等字符**——`sanitizeFilePart` 已经替换为 `_`，OK。
- **结论**: 命名整体安全。

### D-NEW-6 — `desktop/dist/` 中编译产物包含 `.js.map`，源码映射暴露原始 TS 路径
- **文件/行号**: `desktop/tsconfig.json:14` `"sourceMap": true`
- **问题**: 生产构建包含 source map，崩溃报告可还原源码。Electron 打包时通常不需要 source map（用户不会调试）。
- **建议**: 生产打包时关闭 source map；或者至少不要 publish 出去。

### D-NEW-7 — `contextIsolation: true` 但 `sandbox: false`
- **文件/行号**: `desktop/src/main.ts:39`
- **问题**: 启用了 `contextIsolation` 但 `sandbox: false`。`sandbox` 关闭意味着 renderer 在 OS 沙箱之外运行，即便有 `contextIsolation`，XSS 通过 `nodeIntegration` 等漏洞仍可访问 Node.js API。当前 renderer 只暴露了 `studyshot` API 给 preload，**风险较低**，但建议保持 `sandbox: true`。
- **建议**: 设置 `sandbox: true` 并在 preload 中只用 `contextBridge`。

### D-NEW-8 — `webPreferences.preload` 指向 `.js` 文件
- **文件/行号**: `desktop/src/main.ts:36` `preload: path.join(__dirname, "preload.js")`
- **问题**: tsconfig 配置输出 `.js` 文件名，但 `package.json` 没有 `"main": "dist/main.js"` 对应的真实入口检查；`copy-renderer.mjs` 只复制了 renderer 文件，**没有复制 `preload.js`**！导致启动后找不到 preload。
- **严重性**: **高** — 启动可能直接失败。
- **建议**: 在 `copy-renderer.mjs` 中加入 `preload.js`，或改用 ts-node loader，或修改 npm scripts 让 `tsc` 之后 `copy-renderer` 一定执行。
- **补充验证**: `desktop/package.json:5 main: dist/main.js`；`tsconfig.json: outDir: dist`；编译后 `dist/preload.js` 应该存在，但 `copy-renderer.mjs` 没有复制 preload——`preload.js` 由 `tsc` 生成，没问题；但**如果 dev 时**未编译 preload.ts，会找不到文件。`start` 脚本会先 `npm run build`，OK。但 `package:linux` 也先 build，OK。

### D-NEW-9 — `tray.setContextMenu` 在 windows/linux 上菜单构建器假设有 `enabled` 字段，但 `tray` 不支持
- **文件/行号**: `desktop/src/main.ts:121-155`
- **问题**: `Menu.buildFromTemplate([{ label: ..., enabled: false }])` — Electron 支持 `enabled: false`，这是正常的，**无问题**。

### D-NEW-10 — `setConnection` 在 IPC 调用链里多次同步触发，导致 renderer 多次渲染
- **文件/行号**: `desktop/src/main.ts:64-67`, `desktop/src/relay-client.ts:815-822`
- **问题**: `broadcastState()` 每次 state 变化都触发 `mainWindow.webContents.send('state:changed', ...)`。WebSocket 每 30 秒一个 ping、连接断开触发 setConnection、fetch pending 触发 setConnection …… renderer 收到多次相同 state 会被 `renderState` 全量重绘，包括 history 列表——若下载历史 100 条，每次都会全部重建 DOM。
- **建议**: 加 `version` 计数器或 shallow diff；或 history 用 `requestAnimationFrame` debounce。

### D-NEW-11 — `connect()` 中如果同时调用 scheduleReconnect，reconnect 间隔从 1000 重置
- **文件/行号**: `desktop/src/relay-client.ts:440-444, 785-797`
- **问题**: `socket.on('open')` 中 `this.reconnectDelayMs = 1000`，意味着每次成功连接就把退避起点重置；如果服务端反复 1 秒后断开，客户端永远以 1 秒为起点重连，不会指数退避。
- **建议**: 不要在 open 中重置，而是只在 scheduleReconnect 中递增。

### D-NEW-12 — `parseEnvelope` 在响应不是 JSON 时抛出 `SyntaxError`
- **文件/行号**: `desktop/src/relay-client.ts:180-191`
- **问题**: `JSON.parse(text)` 如果后端返回 HTML 错误页（如 502 from reverse proxy），抛出 `SyntaxError`，但被外层 catch 捕获后**直接重新抛出 SyntaxError**，没有包装为 `ApiError`，UI 显示"Unexpected token"这种对用户不友好的消息。
- **建议**: catch 后包装为 `ApiError(502, "INVALID_RESPONSE", "Server returned non-JSON")`。

### D-NEW-13 — `safeStorage` 的 `decryptString` 失败时静默吞掉错误
- **文件/行号**: `desktop/src/config-store.ts:169-178`（同上 D-NEW-2）
- **问题**: 错误信息丢失，调试困难。
- **建议**: 至少 `console.warn` 一下。

### D-NEW-14 — IPC `dialog:chooseDownloadDir` 不验证返回值
- **文件/行号**: `desktop/src/main.ts:213-225`
- **问题**: 返回 `result.filePaths[0]`（任意字符串），保存后下次 `downloadOnce` 写入该路径，若用户选了一个只读目录会失败。
- **建议**: 在 `saveSettings({ downloadDir })` 中调用 `access(path, W_OK)` 测试可写。

### D-NEW-15 — `manualUploadButton` 上传后，`manualUploadResult` 没有去重显示
- **文件/行号**: `desktop/src/renderer/renderer.js:468-483`
- **问题**: 用户连续点上传，同一个结果会覆盖/重复显示——OK；但若 5 秒内连续上传多张，result 区只显示最后一张，前面的没反馈。
- **建议**: result 区域改为 list。

### D-NEW-16 — `webContents.setWindowOpenHandler` 与 `will-navigate` 阻止所有导航
- **文件/行号**: `desktop/src/main.ts:47-50`
- **问题**: `event.preventDefault()` 会阻止任何 navigation；用户在输入框粘贴 URL 时也不影响（粘贴是 input 事件），但 `Ctrl+Click` 链接会被阻止——正常。
- **结论**: 安全策略正确。

### D-NEW-17 — `nativeImage.createFromPath(filePath)` 是同步 IO，大图卡死主进程
- **文件/行号**: `desktop/src/relay-client.ts:707-718`
- **问题**: 已经在 bug 报告 D11 列出，本处补充：Linux/Wayland 下 `createFromPath` 还需要 X11 bridge，偶发崩溃。无异步替代。
- **建议**: 改用 `nativeImage.createFromBuffer`（已经 download 了 buffer，避免二次 IO）。

### D-NEW-18 — `uniquePath` 仅 1000 次重试，可能在共享下载目录被多进程同时写时 race
- **文件/行号**: `desktop/src/relay-client.ts:164-178`
- **问题**: `await access(candidate)` → `writeFile(filePath, ...)`，两个调用之间**没有原子性**。若两个 RelayClient 实例同时下载同一 delivery（理论上不会，因为 token 唯一，但…），会覆盖。
- **建议**: 加上 `wx` flag 的 `open(path, 'wx')` 或重试时再加随机后缀。

### D-NEW-19 — `IPC` 中 `admin:updatePermissions` 接收 `Partial<DevicePermissions>` 没有运行时校验
- **文件/行号**: `desktop/src/main.ts:266-270`, `desktop/src/preload.ts:35-38`
- **问题**: renderer 可以传任何对象到主进程；如果未来 XSS 漏洞导致 renderer 被入侵，可调用任意权限更新接口。
- **建议**: 加 zod 校验，或在 main 进程用 `Object.keys` 白名单。

### D-NEW-20 — `history-store` 不限制 history 文件大小，可能越来越大
- **文件/行号**: `desktop/src/history-store.ts:7, 37-43`
- **问题**: `MAX_HISTORY = 100` 在内存里限制，但磁盘上每次 `add/update` 都 `writeFile` 整个 JSON。若用户高频下载，每次数 KB 没问题；但 100 条 × 1KB = 100KB，单次 write 还可以接受。
- **建议**: 保留限制，无问题。

### D-NEW-21 — `setContextMenu` 每次 state 变化都重建菜单，闪烁
- **文件/行号**: `desktop/src/main.ts:104-156`, `desktop/src/relay-client.ts:64-67`
- **问题**: 每次 `broadcastState` 都会 `updateTrayMenu()` → 重建菜单。Linux 上 GTK 重建菜单会闪烁。
- **建议**: 仅在 `status` 变化时重建菜单；其他 state 字段用 `setToolTip` 更新。

### D-NEW-22 — `tray.on("click")` 仅在 Linux 上有意义，Windows 默认行为不一样
- **文件/行号**: `desktop/src/main.ts:94`
- **问题**: Windows 上 `tray` click 通常无效，需要双击；macOS 上 click 是 expected behavior。代码不区分平台。
- **建议**: `if (process.platform === 'linux')` 才绑定 click，Windows 走双击。

### D-NEW-23 — `scheduleReconnect` 在已经 stopped 状态下仍可能触发
- **文件/行号**: `desktop/src/relay-client.ts:472-478`
- **问题**: `if (this.config.autoReceive) { this.scheduleReconnect(...); } else { this.setConnection({ status: 'stopped' }); }`——`autoReceive` 可能短时间内被用户切换为 false；scheduleReconnect 内 setTimeout 仍会触发 `connect()`，再 setConnection(stopped) 再 setConnection(reconnecting)，形成闪烁。
- **建议**: `connect()` 内再次检查 `autoReceive`，否则直接返回。

### D-NEW-24 — `connect()` 不会校验 `serverBaseUrl` 是合法的 http(s) URL
- **文件/行号**: `desktop/src/relay-client.ts:434`
- **问题**: `new WebSocket(wsUrl(this.config.serverBaseUrl))` 如果 `serverBaseUrl` 是 `"not-a-url"`，`new URL(...)` 会抛错；抛错未被 try/catch，状态机进入不一致。
- **建议**: 校验 `URL.canParse` 后再 new。

### D-NEW-25 — `getState()` 返回的 `recentDownloads` 是引用，IPC 跨进程传递会序列化但 state 内部仍持有
- **文件/行号**: `desktop/src/relay-client.ts:239-246`, `desktop/src/history-store.ts:29-31`
- **问题**: `this.history.list()` 返回内部数组的引用，IPC 序列化的是拷贝，但 `history` 后续修改这个数组（`add` 时 `[record, ...this.records.filter(...)]`），**会创建新数组**——OK，不影响 IPC 已发送的副本。
- **结论**: 无问题。

### D-NEW-26 — WebSocket 重连抖动 `±25%` 的实现有偏差
- **文件/行号**: `desktop/src/relay-client.ts:785-797`
- **问题**: `const delay = Math.floor(baseDelay * (0.75 + Math.random() * 0.5));` 当 `baseDelay = 60000ms`（cap），实际范围 `[45000, 75000]`，**可能超过** 60000 上限。
- **建议**: 用 `delay = Math.min(60000, Math.floor(baseDelay * (0.75 + Math.random() * 0.5)))`。

### D-NEW-27 — `downloadOnce` 中 `await writeFile(filePath, buffer, { mode: 0o600 })` 不保证权限位设置成功
- **文件/行号**: `desktop/src/relay-client.ts:648`
- **问题**: Windows 上 mode 被忽略；Linux 上 `writeFile` 的 `{ mode }` 只在**创建时**生效，若文件已存在，权限位不变。当前 `uniquePath` 保证 `candidate` 不存在，所以 OK。但如果 Windows 用户把下载目录放到 FAT/exFAT，权限无意义。
- **建议**: 显式 `await chmod(filePath, 0o600)` 后置调用。

### D-NEW-28 — `fetchPending()` 串行 `for (const delivery of data.deliveries) { await this.processDelivery(delivery); }`
- **文件/行号**: `desktop/src/relay-client.ts:498-501`
- **问题**: 100 个 pending 时，串行下载慢。`processDelivery` 内部 `downloadWithRetries` 已经包含 3 次重试，进一步放大延迟。
- **建议**: `Promise.all(pending.map(processDelivery))`，但需要控制并发（`p-limit`）。

### D-NEW-29 — `notification` channel ID 重复使用导致通知互相覆盖
- **文件/行号**: `desktop/src/main.ts:67-69` (此为 desktop，无 Android 通道 ID 问题)
- **结论**: Electron `Notification` 自动管理，不存在此问题。

### D-NEW-30 — `manualUploadResult` 在多次上传中，老消息未清空
- **文件/行号**: `desktop/src/renderer/renderer.js:471-477`
- **问题**: 第二次上传前清空 `textContent = ""`，但第二次失败时 `hidden = true` 后下一次成功时**会**重新 `hidden = false`——OK。
- **结论**: 无问题。

---

## 第 4 次更新 — Android App 深入 bug 清单

- **更新时间戳**: 2026-06-18（第四轮）
- **审查范围**: `android/app/src/main` 全部 Kotlin 源文件

### A-NEW-1 — `MainScope()` 使用全局，Activity 销毁后仍执行
- **文件/行号**: `android/app/src/main/java/com/studyshot/relay/MainActivity.kt:94-97`
- **问题**: `kotlinx.coroutines.MainScope().launch(Dispatchers.IO)` 创建的是独立 scope，**不绑定 Activity 生命周期**。若用户从其他 App 分享图片触发 `ACTION_SEND`，handleSharedImage 启动后用户立即返回桌面，Activity 被销毁但 MainScope 仍存在；后续 `enqueueManualUpload` 仍会执行，可能在 Activity 已死的状态下更新 `app.uploadRepository`，**大概率 OK 因为 Repository 不依赖 Activity**，但读 URI 时若 ContentProvider 已被回收会失败。
- **建议**: 使用 `lifecycleScope`（已提到 bug 报告 A33）。

### A-NEW-2 — `getDeviceToken()` 在 `SecureSettings` 中无 suspend 包装
- **文件/行号**: `android/app/src/main/java/com/studyshot/relay/data/SecureSettings.kt:36`
- **问题**: `prefs.getString` 是同步 IO，但在 Composable `collectAsState()` 的 UI 线程中调用 `getDeviceToken()`（如 `MainActivity.kt:92`）可能阻塞主线程。EncryptedSharedPreferences 首次读需要解锁 KeyStore，可能耗时数百毫秒。
- **建议**: 在 `Worker` / `Service` 上下文中调用，UI 仅依赖 `settings` flow。

### A-NEW-3 — `EncryptedSharedPreferences` 失败后 `useEncryptedStorage` 永远为 false，**没有重试**机制
- **文件/行号**: `android/app/src/main/java/com/studyshot/relay/data/SecureSettings.kt:128-146`
- **问题**: 启动时如果 Keystore 临时不可用（如刚开机 Keystore 未加载），直接降级到 `plainFile` 的 SharedPreferences，从此永远不安全；即使 Keystore 后续恢复也不会重试。
- **建议**: 标记降级状态，下次启动重试 EncryptedSharedPreferences。

### A-NEW-4 — `PRIMARY KEY` 与 `unique index` 重叠
- **文件/行号**: `android/app/src/main/java/com/studyshot/relay/data/Entities.kt:10-13, 50-55`
- **问题**: `upload_tasks` 的 `uri` 列加了 `@Index(value = ["uri"], unique = true)`。但 `enqueueManualUpload` 多次调用会传同一个 URI（用户连点 2 次分享同一个图）——会抛 SQLiteConstraintException。
- **建议**: `enqueueManualUpload` 入库前 `getByUri`，已存在则复用；或者 `unique` 改为非 unique。

### A-NEW-5 — `hasUploadedHash` 只在 `UploadWorker.doWork` 检查，`UploadRepository.enqueueManualUpload` 没有预检
- **文件/行号**: `android/app/src/main/java/com/studyshot/relay/upload/UploadRepository.kt:23-46`, `UploadWorker.kt:44-70`
- **问题**: 手动分享/选择同一张图会重复 enqueue 不同的 taskId（UUID random vs URI-derived），重复上传。已经在 bug 报告 A18 提到，本处补充：
  - `enqueueAutoUpload` 用 `UUID.nameUUIDFromBytes(uri.toString().toByteArray())` 生成 taskId，**对同一 URI 始终相同**，所以 OK。
  - `enqueueManualUpload` 用 `UUID.randomUUID()`，**对同一文件不同 taskId**——重复上传。
- **建议**: `enqueueManualUpload` 也按 URI 去重，或入队前先查 `uploaded_hashes`（需要算 sha256）。

### A-NEW-6 — `createdAt` / `updatedAt` 没有默认值
- **文件/行号**: `android/app/src/main/java/com/studyshot/relay/data/Entities.kt:27-28, 46-47`
- **问题**: `@PrimaryKey val id` 但 `createdAt` / `updatedAt` 是 `Long` 非 nullable，没有默认值。调用方必须显式赋值——目前所有调用都赋值了，OK。但如果未来加新调用方忘了，会插入 0，DB 查询 `ORDER BY createdAt DESC` 会出错（1970-01-01）。
- **建议**: 给 `@ColumnInfo` 加默认值或 Room 的 `@field:DefaultValue`。

### A-NEW-7 — `MAX_RETRY_ATTEMPTS = 5`，但 Worker 重试 + 自动重入队会指数叠加
- **文件/行号**: `android/app/src/main/java/com/studyshot/relay/upload/UploadWorker.kt:23-26, 169`, `UploadRepository.kt:84`
- **问题**: WorkManager 自带指数退避（`BackoffPolicy.EXPONENTIAL, 30s`），加 `MAX_RETRY_ATTEMPTS=5`，最多重试 5 次。如果 `enqueueUniqueWork(name, KEEP)` 已经被前次 worker 失败队列占用，新一次 enqueue 不会重新入队（KEEP），但 `runAttemptCount` 持续递增，可能让同一个失败任务永远卡在 retry 队列。
- **建议**: 调小到 3 次；或在 `markFailed` 时取消 unique work。

### A-NEW-8 — `MediaStoreScanner.isLikelyScreenshot` 只检查路径/文件名，对 MIUI/华为等无中文截图目录不友好
- **文件/行号**: `android/app/src/main/java/com/studyshot/relay/upload/MediaStoreScanner.kt:71-103`
- **问题**: 关键字 `"screenshots"`、`"截图"`、`"截屏"` 等。但 MIUI 的截图目录是 `DCIM/Screenshots`，某些用户是 `Pictures/Screenshot`，部分是自定义。已经列出大部分，仍有：
  - OPPO：`DCIM/Screenshots` 或 `Pictures/Screenshots`
  - vivo：`DCIM/Screenshots`
  - 华为：`Pictures/Screenshots`
  - 三星：`DCIM/Screenshots`
- **结论**: 覆盖尚可。但**没有处理文件名后缀**：某些截图命名是 `Screenshot_2024-01-01-12-00-00.png`，前缀 `Screenshot` 但**有下划线+日期**，当前 `startsWith("screenshot")` 匹配 OK。安全。

### A-NEW-9 — `select-image` 用 `ActivityResultContracts.GetContent()`，但 `enqueueManualUpload` 假设可以从 URI 打开 InputStream
- **文件/行号**: `android/app/src/main/java/com/studyshot/relay/MainActivity.kt:176-183`, `UploadRepository.kt:114-124`
- **问题**: `ActivityResultContracts.GetContent()` 返回的 URI 是临时授权的 content URI，复制到 cache 后 task 完成时 URI 仍可读。但 `Uri.fromFile(target)` 用于 cache file——`Uri.fromFile` 在 Android 7+ 触发 `FileUriExposedException`！目前 target 是 cache 目录内，仅本 App 可访问，理论上 OK；但若以后调整 target 到 external dir，会崩。
- **建议**: 用 `FileProvider.getUriForFile` 输出。

### A-NEW-10 — `fetchPending` 在 Service scope 中并发 fetch，没有错误隔离
- **文件/行号**: `android/app/src/main/java/com/studyshot/relay/RelayReceiveService.kt:153-163`
- **问题**: `runCatching { ... }` 把整个 fetch 包住，**单个** delivery 抛出网络错误也会被吞掉，导致 `forEach { processDelivery(it) }` 后续不再执行——OK，没问题。
- **结论**: 实际行为是 OK 的，但 `runCatching` 吞掉错误日志。
- **建议**: 加 `.onFailure { Log.e(...) }`。

### A-NEW-11 — `showDownloadedNotification` 的 `manager.notify` ID 是 `(currentTimeMillis() % Int.MAX_VALUE).toInt()`
- **文件/行号**: `android/app/src/main/java/com/studyshot/relay/RelayReceiveService.kt:395`
- **问题**: `Int.MAX_VALUE = 2^31-1`，`currentTimeMillis()` 当前约 `1.7e12`，除以 2^31≈2.15e9，结果在 `[0, Int.MAX_VALUE)` 范围内但**不是均匀分布**——多数时间戳除以 2^31 后是 7xx,xxx,xxx 这种大整数，OK 但语义不清。
- **建议**: 直接 `notify(delivery.deliveryId.hashCode(), ...)`。

### A-NEW-12 — `downloadOnce` 中 `target.parentFile?.exists() && !parent.mkdirs()` 条件写反
- **文件/行号**: `android/app/src/main/java/com/studyshot/relay/RelayReceiveService.kt:215-218`
- **问题**: `if (parent == null || !parent.exists() && !parent.mkdirs())` 优先级：`!parent.exists() && !parent.mkdirs()` 先判断，然后与 `parent == null` OR。等价于 `parent == null || (!parent.exists() && !parent.mkdirs())`。如果 parent 存在（已创建过），整个表达式短路为 `parent == null || false`，**不报错**——OK。如果 parent 不存在，且 mkdirs 返回 false（权限不足），报错——OK。逻辑没错，但很难读。
- **建议**: 拆成两步。

### A-NEW-13 — `saveImageToGallery` 在 API < 29 上不会清理 IS_PENDING
- **文件/行号**: `android/app/src/main/java/com/studyshot/relay/RelayReceiveService.kt:258-286`
- **问题**: `if (Build.VERSION.SDK_INT >= 29) { values.put(IS_PENDING, 0); ... }`，API < 29 没 IS_PENDING 列，OK。但写入失败时 `contentResolver.delete(uri, null, null)` 仅在 `throw` 时执行，**`openOutputStream(uri) ?: error(...)` 抛出后 delete 执行，OK**。
- **结论**: 逻辑正确，但 `IS_PENDING` 的清理路径在 `catch` 抛出后才会清理——若写入过程**正常完成但 flush 失败**（罕见），不会清理。

### A-NEW-14 — `RecentImages` 查询时 `IS_PENDING = 0` 过滤可能漏掉刚写入的图
- **文件/行号**: `android/app/src/main/java/com/studyshot/relay/upload/MediaStoreScanner.kt:35-36`
- **问题**: `IS_PENDING = 0` 仅 API 29+。`ScreenshotObserverService.scanRecent()` 用 `delay(900)` 等待图片稳定。但某些设备上 MediaStore 在图片**刚**写入时会标记 IS_PENDING=1，900ms 后可能仍是 1（MediaStore 扫描耗时），查询不到。
- **建议**: 增加 delay 到 2-3 秒；或去掉 IS_PENDING 过滤。

### A-NEW-15 — `MainActivity.bindDevice` 用 `Build.MODEL` 作为 deviceName 默认值
- **文件/行号**: `android/app/src/main/java/com/studyshot/relay/MainActivity.kt:684, 693`
- **问题**: 同一型号的设备（同品牌）会得到相同默认名。问题不大，但用户可能混淆。
- **建议**: 提示用户在 Settings 修改。

### A-NEW-16 — `MainActivity` 的所有错误都用字符串拼接展示给用户
- **文件/行号**: `android/app/src/main/java/com/studyshot/relay/MainActivity.kt:269, 334, 351, 365, 381, 398`
- **问题**: `message = "绑定失败：${err.message ?: err.javaClass.simpleName}"` 直接拼接 `err.message`，可能是英文 + 异常堆栈片段，对用户不友好。
- **建议**: 用 `stringResource` + 错误码映射。

### A-NEW-17 — `LoginResponse` 中的 `user` 字段被解析但 Android 端没有持久化
- **文件/行号**: `android/app/src/main/java/com/studyshot/relay/network/StudyShotApiClient.kt:50-77`, `MainActivity.kt:325-335`
- **问题**: adminToken 仅存在 `var adminToken by remember { mutableStateOf<String?>(null) }`，进程被杀后丢失；下次启动需重新登录。可以接受（admin session 是短期），但桌面客户端也是这种行为，保持一致。

### A-NEW-18 — `enqueueManualUpload` 缓存文件没有清理策略
- **文件/行号**: `android/app/src/main/java/com/studyshot/relay/upload/UploadRepository.kt:114-124`
- **问题**: 每次 manual share 复制一份到 `cacheDir/manual-uploads/${taskId}.upload`。taskId 是 UUID，不会重用，文件永远积累。
- **建议**: Worker 完成后 `File(target).delete()`；或定时清理超过 7 天的 cache。

### A-NEW-19 — `UploadRepository.copyToUploadCache` 用 `Uri.fromFile`，Android 7+ 风险
- **文件/行号**: `android/app/src/main/java/com/studyshot/relay/upload/UploadRepository.kt:114-124`
- **问题**: `Uri.fromFile(target)` 返回 `file://` URI，`enqueueManualUpload` 把 `cachedUri.toString()` 存入 DB 字段，Worker 用 `Uri.parse` + `contentResolver.openInputStream(uri)` 读取——cache 目录是 app-private，`openInputStream` 应该 OK；但若未来改用 external dir，会触发 `FileUriExposedException`。
- **建议**: 用 `FileProvider`。

### A-NEW-20 — `MainActivity.handleSharedImage` 用 `MainScope`，**且** `enqueueManualUpload` 中 wifiOnly 用 `settings.wifiOnly` 旧值
- **文件/行号**: `android/app/src/main/java/com/studyshot/relay/MainActivity.kt:95`
- **问题**: 拿到的 settings 可能是用户切换 Wi-Fi only 之前的旧值，影响一致性。
- **建议**: 从 `app.secureSettings.settings.value` 直接读最新。

### A-NEW-21 — `RelayReceiveService.fetchPending` 错误处理吞异常
- **文件/行号**: `android/app/src/main/java/com/studyshot/relay/RelayReceiveService.kt:158-162`
- **问题**: `runCatching { ... }` 没有任何错误处理，失败时只 logcat。
- **建议**: 失败时也写入 `event_logs` 数据库，便于在 UI 展示。

### A-NEW-22 — `service.stopForeground` / `stopForegroundServiceCompat` 没显式调用
- **文件/行号**: `android/app/src/main/java/com/studyshot/relay/RelayReceiveService.kt:78-85, 92-95`, `ScreenshotObserverService.kt:46-51`
- **问题**: `stopSelf()` 只是停止 service，但 Android 14 上前台服务的通知需要 `stopForeground(STOP_FOREGROUND_REMOVE)`。否则通知可能残留。
- **建议**: 在 `onDestroy` 调用 `stopForeground(STOP_FOREGROUND_REMOVE)`。

### A-NEW-23 — `Build.VERSION.SDK_INT >= 26` 检查用了 `startForegroundService`，但 Android 12+ 要求 service 5 秒内 startForeground
- **文件/行号**: `android/app/src/main/java/com/studyshot/relay/MainActivity.kt:117-141`
- **问题**: Android 12+ 引入 `ForegroundServiceStartNotAllowedException`——若 App 在后台时调用 `startForegroundService`，且未在 5 秒内 `startForeground`，会抛异常被系统记录。当前 `onCreate` 中 `startForeground` 在 `onCreate` 立即调用，OK；但**后续**如 `bindPage` 触发 `startRealtimeService` 时 Activity 可能在后台（屏幕关闭），会抛异常。
- **建议**: catch `ForegroundServiceStartNotAllowedException`，重试或 WorkManager 兜底。

### A-NEW-24 — `ScreenshotObserverService.scanRecent` 重复 enqueue 同一 URI
- **文件/行号**: `android/app/src/main/java/com/studyshot/relay/ScreenshotObserverService.kt:75-89`
- **问题**: `lastScanAtSeconds = nowSeconds; val since = lastScanAtSeconds - 5` 是下一次扫描的起点——**下次扫描的 since 不包含这次的结果**。但 MediaStore 在一次 `onChange` 后可能被多次通知，每次都触发 `scanRecent`，每次都查 `since = lastScanAtSeconds - 5`（注意：`lastScanAtSeconds` 在 scope 内被修改为 `nowSeconds`，但 since 用的是更新后的 nowSeconds - 5）。这里逻辑有点绕。潜在 bug：连续通知触发多次扫描时，since 会向前推进，可能漏掉中间窗口的图片（窗口很窄）。
- **建议**: 持久化 `lastScannedMediaId` 或 `lastScannedDateAdded`，按主键单调推进。

### A-NEW-25 — `MainActivity.requiredPermissions` 申请了 `READ_MEDIA_IMAGES` 但没有 `READ_MEDIA_VISUAL_USER_SELECTED`
- **文件/行号**: `android/app/src/main/java/com/studyshot/relay/MainActivity.kt:698-711`
- **问题**: Android 14 部分照片访问 (`READ_MEDIA_VISUAL_USER_SELECTED`) 不在申请列表中——若用户首次选部分照片后想扩大，需要重新启动 App 走权限流程。当前 `hasPartialImagePermission` 只检测该权限但不申请，UI 也无引导按钮。
- **建议**: 增加"扩大照片访问"按钮，触发 `RequestPermission` for `READ_MEDIA_IMAGES`。

### A-NEW-26 — `PowerSaveScanWorker` 使用 `SchedulePowerSaveScan` 但 MainActivity 用 `cancelPowerSaveScan` 没有 stop service
- **文件/行号**: `android/app/src/main/java/com/studyshot/relay/upload/PowerSaveScanWorker.kt`, `MainActivity.kt:198-204`
- **问题**: Worker 由 WorkManager 调度，service 由 `startForegroundService` 启动；切换模式时两者独立调度，可能同时存在。
- **结论**: 设计上 Workers 与 Service 是两条路径，OK。

### A-NEW-27 — `UploadWorker.markFailed` 中 attemptDelta = 1，但 updateUploadTask 是 `attemptCount = attemptCount + attemptDelta`
- **文件/行号**: `android/app/src/main/java/com/studyshot/relay/upload/UploadWorker.kt:120-137`, `StudyShotDao.kt:33-42`
- **问题**: 累加 attemptCount，但 **runAttemptCount 是 WorkManager 的本地状态**，与 DB 中 attemptCount 不一致。失败重试后两次都 `attemptDelta=1`，DB 累计到 2 但 runAttemptCount 可能 1。
- **建议**: 用 `runAttemptCount` 写入 DB 替换 attemptDelta。

### A-NEW-28 — `NotificationManager.areNotificationsEnabled` 在 API < 26 不存在
- **文件/行号**: `android/app/src/main/java/com/studyshot/relay/RelayReceiveService.kt:380-385`
- **问题**: `Build.VERSION.SDK_INT >= 33` 检查保护了 API 33+ 的通知权限，OK。但 **API 31-32 没有专门的通知权限**（应用开关控制），所以 API < 33 走 else 分支不检查——OK。

### A-NEW-29 — `MainActivity.kt:707-710` `requiredPermissions` 没申请 `READ_MEDIA_VISUAL_USER_SELECTED`
- **文件/行号**: `android/app/src/main/java/com/studyshot/relay/MainActivity.kt:707-710`
- **问题**: `if (Build.VERSION.SDK_INT >= 33) add(POST_NOTIFICATIONS)` 但**没有** `READ_MEDIA_VISUAL_USER_SELECTED`（虽然 Manifest 已声明）。
- **建议**: 增加。

### A-NEW-30 — `AppSettings.deviceName` 默认值依赖 `Build.MODEL`
- **文件/行号**: `android/app/src/main/java/com/studyshot/relay/data/SecureSettings.kt:102`
- **问题**: 同一型号多台设备默认值相同，可能在桌面管理 UI 中混淆。
- **建议**: 默认加随机后缀或提示用户修改。

---

## 第 5 次更新 — 跨组件 / 协议一致性 / 文档问题

- **更新时间戳**: 2026-06-18（第五轮）
- **审查范围**: docs/ 与 code 协议一致性、跨端契约、配置规范

### X-NEW-1 — 协议文档 `protocol.md` 401 与实际行为不一致
- **文件/行号**: `docs/protocol.md:46` vs `backend/src/plugins/device-auth.ts:68-74`
- **问题**: `protocol.md` 第 46 行说 "401: token 缺失、无效、设备撤销或用户禁用"，但 `device-auth.ts` 在用户禁用时返回 **403** `USER_DISABLED`。bug 报告 B6 已记录，本处补充：客户端 `device-auth.ts` 的 403 在 desktop 客户端 `relay-client.ts:595-599` 中**也按 403 处理**（disconnect），与协议文档不一致。

### X-NEW-2 — `permissions.md` 第 12 行说"child 用户默认不能管理空间"，但代码中 `canManageSpace` 是设备权限
- **文件/行号**: `docs/permissions.md:12` vs `backend/src/plugins/device-auth.ts:8-21`
- **问题**: "child 用户默认不能管理空间"在文档语境下意味着 child 用户的**设备**默认 `canManageSpace = false`——这与代码一致。但 `permissions.md:148` 写到 `canManageSpace` 是"用户信任的主力电脑"——一个 device 权限被描述成"用户信任"，口径不一致。
- **建议**: 文档统一使用"设备"措辞。

### X-NEW-3 — `permissions.md` 与 `protocol.md` 中 `autoUploadScope` 枚举对 `selected_album` 的描述不具体
- **文件/行号**: `docs/permissions.md:196-202` vs `android/app/src/main/java/com/studyshot/relay/upload/MediaStoreScanner.kt`
- **问题**: `permissions.md` 说"用户必须明确选择来源"，但 Android 端没有 UI 让用户选择相册；`MediaStoreScanner` 只查询 `Screenshots` 目录，对 `selected_album` scope 不做任何额外处理——这是文档和实现的偏差。

### X-NEW-4 — `study-shot-relay-agent-tasklist.md` 中可能未列出已完成的更新
- **建议**: 阅读 `study-shot-relay-agent-tasklist.md`（未深入）确认任务清单与现状一致。

### X-NEW-5 — `bug-report-2026-06-18.md` 与 `fix-report-2026-06-18.md` 中标记为 `fixed` 的问题，源码确认
- **A1 fixed?**: `MainActivity.kt:265-267` 当前是 `scope.launch { try { message = bindDevice(...) } catch (err: Exception) { message = "..." } }`——OK，确实修复。
- **A2 fixed?**: `MediaStoreScanner.kt:24-32` 当前在 `if (Build.VERSION.SDK_INT >= 29)` 才加 RELATIVE_PATH——OK。
- **A3 fixed?**: `UploadWorker.kt:58-70` 当前检查 `hasUploadedHash`——OK。
- **A4 fixed?**: `UploadWorker.kt:23-26` 当前 `if (runAttemptCount > MAX_RETRY_ATTEMPTS)` return failure——OK。
- **A5 fixed?**: `UploadWorker.kt:72-76` 当前 `if (mimeType == null) return failure`——OK。
- **A6 fixed?**: `RelayReceiveService.kt` 用 `AtomicReference` + `Mutex`——OK。
- **A7 fixed?**: `SecureSettings.kt:140-145` 当前 try/catch 降级——OK。
- **A8 fixed?**: `MediaStoreScanner.kt` 加了 OEM 截图路径——OK。
- **A15 fixed?**: `UploadWorker.kt` 保留 sha256/fileSize——OK（COALESCE 实现）。
- **A19/A20 fixed?**: `RelayReceiveService.kt:215-224` 一次性创建 .nomedia + mkdirs 校验——OK。
- **A21 fixed?**: `RelayReceiveService.kt:235-240` runCatching + Log.e——OK。
- **A22 fixed?**: `RelayReceiveService.kt:89-140` connectMutex withLock——OK。
- **A23 fixed?**: `RelayReceiveService.kt:189-194` 不再 stopSelf——OK。
- **A24 fixed?**: `RelayReceiveService.kt:344-348` MAX_RECONNECT_ATTEMPTS——OK。
- **A25 fixed?**: `RelayReceiveService.kt:380-385` 检查 POST_NOTIFICATIONS——OK。
- **B1 fixed?**: `ws.ts:138-150` close handler 用 `current?.socket === socket` 判断——OK。
- **B2 fixed?**: `images.ts:77-85` originImageId 检查移到去重之前——OK。
- **B3 fixed?**: `images.ts:78-85` 拒绝时 unlink——OK。
- **B4 fixed?**: `delivery.ts:12-25` include user + filter disabledAt——OK。
- **D1 fixed?**: `relay-client.ts:464-471` close code 1008 → error 状态，不重连——OK。
- **D2 fixed?**: `relay-client.ts:193-211` LruSet + history.find 持久去重——OK。
- **D3 fixed?**: `relay-client.ts:785-797` ±25% jitter——OK。
- **结论**: 上轮 bug 报告标记 fixed 的项目，从源码看确实已修复。但**未验证测试**：测试在 PostgreSQL 不可用环境无法跑通，docs/fix-report 已记录。

### X-NEW-6 — `Dockerfile` 用 `node:22-bookworm-slim`，但 docker-compose 用 `postgres:16-alpine` + caddy:2-alpine
- **建议**: 不一致不影响功能，但记录。

### X-NEW-7 — `dist/` 目录被 gitignore，但 `backend/dist/` 里有旧版本文件，可能误上传
- **建议**: 验证 `.gitignore` 规则覆盖 `backend/dist/` 和 `desktop/dist/`。

### X-NEW-8 — `backend/.env` 文件在仓库中（`.env` 在 `.gitignore` 但 `.env.example` 例外）
- **文件/行号**: `backend/.env` (被跟踪？)
- **建议**: `git check-ignore backend/.env` 确认。

### X-NEW-9 — `desktop/dist/` 已构建的 artifacts 应清理
- **建议**: 在 CI 上 `rm -rf desktop/dist backend/dist android/app/build` 避免误导。

### X-NEW-10 — `docs/backend-deployment.md` / `docs/local-postgresql-setup.md` 未深入审查
- **建议**: 在需要时进一步审查。

---

## 第 6 次更新 — 安全审查与总结

- **更新时间戳**: 2026-06-18（第六轮）
- **审查范围**: 综合安全审查

### S-NEW-1 — bcrypt cost 12 是行业标准，但 cost 升级没有迁移路径
- **文件/行号**: `backend/src/lib/crypto.ts:4`
- **问题**: 当 bcrypt 升级到 cost 13/14 时，老用户登录会触发 `bcrypt.compare` 用新 cost 校验旧 hash——这没问题（cost 仅在 hash 时用），但**强制重哈希**逻辑不存在——用户永远不会升级到新 cost。
- **建议**: 登录成功后若 `bcrypt.getRounds(hash) < 12` 则重哈希。

### S-NEW-2 — JWT payload 没有 kid，rotation 困难
- **文件/行号**: `backend/src/lib/jwt.ts:13-17`
- **问题**: 同 B-NEW-20。

### S-NEW-3 — 数据库密码 `studyshot:studyshot` 是开发默认，部署需替换
- **建议**: `deploy-backend.sh` 强制覆盖默认。

### S-NEW-4 — `STORAGE_DIR` 没有验证创建权限，启动可能失败
- **文件/行号**: `backend/src/index.ts:8`, `backend/src/services/storage.ts:62-64`
- **问题**: `ensureStorageRoot()` 在路由调用时才创建——意味着第一次上传才报权限错误。启动时检查更好。
- **建议**: `start()` 中检查并 mkdir。

### S-NEW-5 — Caddy 没有 HSTS / Security Headers
- **文件/行号**: `backend/docker/Caddyfile:5-13`
- **问题**: `reverse_proxy` 透传所有头，没有加 `Strict-Transport-Security`、`X-Content-Type-Options`、`X-Frame-Options`。
- **建议**: 加 `header` 指令。

### S-NEW-6 — 桌面客户端 `config.json` 中 `tokenStorage: "plainFile"` 时无任何限制
- **同 D-NEW-1**：建议增加“明文 token 时强制禁用自动接收”的硬约束。

### S-NEW-7 — 安卓端 `usesCleartextTraffic="true"` 全局放行 HTTP
- **文件/行号**: `android/app/src/main/AndroidManifest.xml:21`
- **问题**: 配合 `<application android:networkSecurityConfig>` 可以只放行 localhost / 内网 IP。当前完全没有 network security config。
- **建议**: 加 `network_security_config.xml`，默认禁止明文，仅 debug build 或本地 IP 允许。

### S-NEW-8 — Android 端 ProGuard rules 为空，release build 可能反射失败
- **文件/行号**: `android/app/proguard-rules.pro:1`
- **问题**: Room、OkHttp、kotlinx coroutines、Compose 在 release build（`isMinifyEnabled = false` 当前未启用）启用 R8 时需要 keep 规则。当前 build 配置未启用 minify，所以**目前不影响**；但 release 一旦打开就会 NPE。
- **建议**: 提前把官方 keep 规则填入。

### S-NEW-9 — 后端 CORS `origin` 列表没有规范化
- **文件/行号**: `backend/src/app.ts:35-37`
- **问题**: `CORS_ALLOWED_ORIGINS` 分割后未 trim 末尾斜杠；`https://example.com` 与 `https://example.com/` 是两个不同 origin，会让浏览器拒绝。
- **建议**: 统一规范化。

### S-NEW-10 — 桌面端 `bindDevice` 中服务端 `deviceName.trim() || os.hostname()`，trim 后可能为空字符串
- **文件/行号**: `desktop/src/relay-client.ts:262-275`
- **问题**: `input.deviceName.trim() || os.hostname()`——若 `input.deviceName = "   "`，trim 后空字符串但 truthy check 是空字符串 falsy，所以 fallback 到 hostname——OK。

### 综合建议

1. **优先修复高危**: B-NEW-1（文件大小限制）、B-NEW-4（client-generated device id 占用）、B-NEW-11（JWT 无黑名单）、B-NEW-18（WS 无 origin 校验）。
2. **次优先**: A-NEW-3（EncryptedSharedPreferences 无重试）、S-NEW-7（cleartext 全局）、D-NEW-1（明文 token 无警告）。
3. **持续改进**: 所有 `**-NEW-**` 项目按业务优先级排期处理。

---

## 审查方法说明

- **工具**: 仅使用 `Read`、`Grep`、`Glob`、`Bash` 进行源码静态审查，**未运行**测试或编译（环境受限，参考 `docs/fix-report-2026-06-18.md`）。
- **不重复原则**: 已尽量避免与 `docs/bug-report-2026-06-18.md` 中已列出的项目重复；如确有重叠会显式标记（如 B-NEW-23 与 B15）。
- **建议原则**: 全部为"建议"，不修改代码；具体的实现选择由代码所有者决定。