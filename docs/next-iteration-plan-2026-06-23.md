# StudyShot Relay 下一阶段修改与迭代计划

> 制定日期：2026-06-23  
> 建议版本：0.5.1（安全与稳定性收敛）  
> 适用范围：`backend` / `desktop` / `linux-client` / `android` / 发布流程

## 1. 迭代目标

0.5.1 暂停扩展新功能，集中解决已经确认的凭证保护、本地控制面、桌面监听状态和后端运维问题。本轮完成后，项目应达到：

- 本机其他用户或进程不能未授权读取 Linux 客户端凭证或操作服务。
- 任何客户端不再静默将凭证降级为明文存储。
- 非 HTTPS 连接必须由用户明确开启，不能因地址拼写遗漏而意外降级。
- Desktop 的监听目录、监听器和 UI 状态始终一致。
- 后端可优雅停机，登录端点有独立限流和安全记录。
- 为 `targetSdk 35` 的前台服务限制形成经过实机验证的迁移方案。

## 2. P0：0.5.1 发布前必须完成

### 2.1 Linux 本地 Web 服务鉴权

**现状**

`linux-client/src/web/server.ts` 虽然只监听 `127.0.0.1`，但所有 API 无鉴权，且 `GET /api/config` 返回包含 `deviceToken` 的完整配置。同机其他用户或本地进程可通过扫描端口获取凭证并操作服务。

**修改要求**

1. Web 服务每次启动生成至少 256 bit 随机会话令牌。
2. `launch` 打开的首次 URL 携带一次性引导令牌；服务端验证后设置 `HttpOnly`、`SameSite=Strict` 会话 Cookie，然后重定向到不含令牌的 URL。
3. 所有 `/api/*` 和 `/api/logs` SSE 请求必须验证会话。修改状态的请求还应校验 `Origin` 为当前 `127.0.0.1:<port>`。
4. 将 `GET /api/config` 改为显式的前端 DTO，不得返回 `deviceToken`、管理 JWT 或任何其他凭证。
5. 图片库代理可在服务端内部继续使用 device token，但不得将它暴露给浏览器。
6. 收紧 CSP 的 `connect-src`，当前 Web UI 只需连接本地服务，应使用 `'self'`。

**验收标准**

- 无 Cookie 访问任意 `/api/*` 均返回 401。
- 伪造 `Origin` 的 POST/DELETE 请求被拒绝。
- 浏览器网络响应和页面 JS 内均搜索不到 device token。
- 新增自动化测试覆盖未鉴权、过期会话、Origin 校验和配置脱敏。

### 2.2 Android 凭证存储与发布签名

**修改要求**

1. 移除 `EncryptedSharedPreferences` 初始化失败后写入普通 `SharedPreferences` 的逻辑。
2. 加密存储不可用时，App 可进入仅诊断/设置状态，但必须阻止绑定、上传和接收，并显示持久错误而不是短暂 Snackbar。
3. 检测旧的 fallback 配置。如果能重建加密存储，则一次性迁移并删除明文；否则要求用户重新绑定。
4. `build.gradle.kts` 从环境变量或本机 `keystore.properties` 读取 keystore 路径、alias 和密码，仓库中不再出现固定密码。
5. `generate-keystore.sh` 仅生成开发/测试签名，不得被正式发布任务默认调用。

**签名密钥处理原则**

当前 keystore 文件已被 `.gitignore` 排除，已知密码不等于已知私钥。只有在确认正式签名私钥曾进入仓库、发布包或其他不可信环境时才轮换密钥；不做无依据的强制轮换。

**验收标准**

- 加密库初始化失败时，磁盘上不会新增明文 token。
- 正式构建缺少签名变量时明确失败，不会回退到测试密钥。
- 提供迁移成功、迁移失败和新安装三种测试。

### 2.3 HTTP 降级改为显式选择

**修改要求**

1. Desktop、Linux 和 Android 未填协议时统一默认为 `https://`。
2. 对非回环的 `http://` 地址，UI/CLI 必须要求显式开启“允许不安全 HTTP”，并清楚提示 token、密码和图片均可被窃听。
3. CLI 使用明确参数，例如 `--allow-insecure-http`；不得通过普通确认选项隐式开启。
4. 明文 HTTP 只用于用户明确管理的局域网/VPN 场景，配置页始终显示持久警告。
5. README 保留纯 IP 部署方式，但要求 VPN 或受信网络，不再将它呈现为与 HTTPS 等价的普通选项。

**说明**

本项目是用户自定义域名的自托管工具，0.5.1 不强制实施 Certificate Pinning。固定公钥会在用户更换域名或证书时造成不必要的不可用。

### 2.4 Desktop 监听器状态修复

**修改要求**

1. 选择监听目录后立即调用 `saveSettings({ watchDir })`，与下载目录的现有修复保持一致。
2. 区分“单文件上传失败”与“底层监听器已停止”。单次上传失败只记录事件，不得将 `watch.active` 改为 `false`。
3. 监听器发生不可恢复错误时，关闭 watcher、清空 `directoryWatcher`、更新 UI，确保用户可以再次点击启动。
4. 启动时设备 token 失效可以清除绑定，但必须在 UI 保留“设备已被撤销或凭证失效”原因和重新绑定入口。
5. 修复首次使用引导中“去绑定”和“去上传设置”两个空按钮。

**验收标准**

- 选择监听目录后立即触发状态刷新，输入框不会恢复旧值。
- 上传一个无效文件后 watcher 仍然运行，后续有效图片可继续上传。
- 模拟 watcher 致命错误后可从 UI 或托盘成功重启。
- 新增监听状态和目录持久化回归测试。

### 2.5 Backend 登录防护与优雅停机

**修改要求**

1. `/auth/login` 增加独立限流，建议默认 `5 次/分钟/IP`，并允许通过环境变量调整。
2. 用户不存在时仍执行一次 dummy bcrypt 校验，减少明显的用户存在性时序差异。
3. 记录登录成功、失败和限流事件。日志不得包含密码、JWT 或完整请求体。
4. JWT 验证显式限制 `algorithms: ["HS256"]`。本版本暂不引入 Redis/JTI 撤销表。
5. `SIGTERM`/`SIGINT` 到达时停止接收新请求，调用 `app.close()`，关闭 WebSocket、cleanup timer 和 Prisma。
6. `startCleanupTask()` 返回可调用的 stop handle，并对 timer 调用 `unref()`，便于测试和正常退出。

**验收标准**

- 连续错误登录触发 429，窗口结束后可恢复。
- 存在用户和不存在用户均返回统一凭据错误，测试确认 dummy hash 路径被执行。
- 向运行中容器发送 SIGTERM，进程在预定宽限内以 0 退出，无未处理拒绝。
- 重复启停测试不遗留 timer 或数据库连接。

## 3. P1：0.5.1 后紧接处理

### 3.1 Android 15 / targetSdk 35 前台服务迁移

Android 15 对以 `dataSync` 运行的前台服务引入每 24 小时共计 6 小时的后台限制，该限制在应用 target Android 15/API 35 后生效。当前 `targetSdk=34`，因此这是升级阻塞项，不是 Android 14 已发生的故障。

**迁移任务**

1. 使用 Android 15 实机或模拟器验证两个 `dataSync` 服务的共享配额行为。
2. 在 target 35 分支实现 `Service.onTimeout(int, int)`，停止服务并发出明确通知，不允许系统直接将应用判定为 ANR。
3. 评估合并上传/接收前台服务，减少状态分裂；注意合并服务不会增加 `dataSync` 总配额。
4. 形成可选方案的实机数据：用户交互重启、限时学习会话、降级为 WorkManager，或符合应用商店政策的其他 FGS 类型。
5. 不得仅为绕过限制就盲目改成 `specialUse`；必须同时评估实际用途、manifest justification 和分发渠道政策。
6. 不将 `BOOT_COMPLETED` 启动 `dataSync` FGS 作为主方案，Android 15 target 35 对此有明确限制。

### 3.2 Android 内存与文件生命周期

- 手动上传缓存在上传成功或终态失败后删除，并在启动时清理过期孤儿文件。
- 下载先写同目录临时文件，校验 SHA-256 后原子 rename；失败必须删除半成品。
- 图片预览使用采样解码，不将原尺寸图片同时保留为大型 `ByteArray` 和全尺寸 Bitmap。
- 为大图、写盘中断和缓存清理增加测试。

### 3.3 状态保留与平板布局

- 将 `AppState` 迁移到 `ViewModel`，避免 Activity 重建时丢失管理会话、图库列表和正在进行的操作。
- 不把 `android:configChanges` 作为状态管理的替代品；仅在确有平台层需求时添加。
- 引入 Window Size Classes，对平板设置页和管理页提供分栏/双列布局。

### 3.4 核心自动化测试

- Backend：WebSocket 鉴权、心跳超时、撤销关闭、delivery 幂等、登录限流。
- Linux：本地 Web 会话鉴权、配置脱敏、会话过期、权限撤销。
- Desktop：IPC 输入校验、目录选择持久化、watcher 错误状态。
- Android：URL 安全策略、加密存储故障、profile/权限推断、ViewModel 状态恢复。

## 4. P2：工程化与发布收尾

1. 建立 GitHub Actions，至少运行四端 typecheck/build、无数据库单元测试和 Android `assembleDebug`。
2. 对后端集成测试使用专用 PostgreSQL service，不再把“本机没有数据库”作为常态跳过理由。
3. 修复 `create-github-release.sh` 中的固定旧版本，从单一版本源读取版本号。
4. 发布脚本生成 `SHA256SUMS`，校验后与安装包一起上传；`RELEASES.md` 不得继续保留占位值。
5. 删除确认未使用的后端依赖，更新 lockfile 并完整重跑测试。
6. 修正协议文档中图库 `nextCursor` 的格式，使其与当前 base64url JSON 实现一致。
7. 为审计日志和 Desktop 图库列表补充游标分页，避免固定只展示前 N 条。

## 5. 本轮明确不做

以下项目不应阻塞 0.5.1：

- 全客户端 Certificate Pinning。
- 在无私钥泄漏证据时强制轮换 Android 签名。
- Redis/NATS 多实例 WebSocket 广播；当前部署模型仍为单实例。
- JWT refresh token 和通用 revocation list。
- 自动更新、完整 i18n、全端 UI 重设计。
- 只为缩小 APK 就将 R8/ProGuard 列为安全 P0；可在完成 keep rules 和回归测试后单独启用。

## 6. 建议实施顺序

1. Linux 本地 Web 鉴权与 token 脱敏。
2. Android 凭证存储和发布签名配置。
3. Desktop 监听目录和 watcher 状态修复。
4. 三端 HTTP 明文连接显式授权。
5. Backend 登录防护和优雅停机。
6. 补齐上述改动的自动化测试，完成 0.5.1 回归和发布。
7. 建立 targetSdk 35 分支完成前台服务迁移实验，实机结论回写到 `docs/android-background.md`。

## 7. 0.5.1 整体发布门槛

以下条件全部满足后才发布：

- Backend、Desktop、Linux TypeScript 构建通过，Android `compileDebugKotlin` 和 release 构建通过。
- Backend 单元测试和 PostgreSQL 集成测试全部通过。
- Linux 本地 Web 鉴权、Desktop watcher、Android 安全存储新增测试全部通过。
- 手工贯通“绑定 → 截图上传 → WebSocket 推送 → 下载 → 剪贴板”主链路。
- 对 Android 真机后台上传、Desktop 目录修改、Linux 本地 Web 未鉴权访问分别完成手工回归。
- 安装包使用正式密钥签名，`SHA256SUMS` 与实际文件一致。
- README、`RELEASES.md`、协议文档和应用内安全提示与实现一致。

## 8. 2026-06-23 实现审查后的返修清单

> 审查对象：`749ed3c fix: P0 security and stability hardening (0.5.1)`
> 审查结论：主体设计方向正确，但存在主链路回归和未完成的 P0，当前不能发布 0.5.1。

### 8.1 已验收的实现，不要重写

以下方向已经正确，返修应保留现有设计，只补边界和测试：

- Linux Web 使用一次性 boot token 换取 HttpOnly Cookie、验证 Origin、返回脱敏 DTO、CSP `connect-src 'self'`。
- Backend 登录专用限流、不存在用户的 dummy bcrypt、JWT `HS256` 限制。
- Backend cleanup stop handle、timer `unref()`、`SIGTERM`/`SIGINT` 停机框架。
- Android 禁止将 device token 新写入明文 SharedPreferences。
- Android 签名信息从环境变量或 gitignored `keystore.properties` 读取，缺少正式签名时 release 构建失败。
- Desktop 监听目录选择后立即持久化，且区分单文件上传失败与 watcher 致命错误。
- Desktop 设备撤销后保留明确错误原因，Android 首次使用页按钮实际执行导航。

### 8.2 R0-1：修复 Desktop 明文 HTTP 绑定主链路（阻塞发布）

**现有回归**

`RelayClient.registerDevice()` 在请求前正确验证了 `input.allowInsecureHttp`，但服务端创建设备后，调用 `ConfigStore.bindDevice()` 时没有传递该值。`ConfigStore` 二次校验随即抛错，导致服务端已创建设备，客户端却显示绑定失败且不保存 token。

**必须修改**

1. `registerDevice()` 调用 `config.bindDevice()` 时传递 `allowInsecureHttp: input.allowInsecureHttp === true`。
2. `createBindCodeWithLogin()`、`bindWithLogin()`、`adminLogin()` 中所有在远端请求成功后执行的 `saveSettings()`，必须同步传递已验证的 HTTP 授权。
3. 保证所有可本地验证的输入在远端副作用之前完成验证。远端成功后的本地持久化不得再因同一条已验证规则失败。
4. 不得通过删除 `ConfigStore` 的防御性校验来规避问题；应修复授权值在调用链中的传递。

**回归测试**

- HTTPS 绑定不需要 HTTP 授权。
- 非回环 HTTP 未授权时，在任何远端请求前失败。
- 非回环 HTTP 显式授权时，绑定、账号绑定、生成绑定码和管理登录都能成功并持久化授权。
- 绑定不得出现“远端已创建设备、本地仍未绑定”的结果。

### 8.3 R0-2：完成三端 HTTP 策略和旧配置迁移（阻塞发布）

**Android**

1. 在 `AppSettings` 和持久化层增加 `allowInsecureHttp`，默认为 `false`。
2. 绑定码绑定、账号绑定、管理登录和所有会发送凭证的 API 路径共用同一个 URL 安全校验器。
3. 非回环 `http://` 必须由用户在 UI 明确勾选，并显示持久警告。
4. 为保留明硧 IP/VPN 模式，Manifest 可暂时继续允许 cleartext，但应用层必须在发送请求前执行上述策略，不能只依赖 UI。

**Desktop 和 Linux 旧配置**

1. 加载到非回环 HTTP 且 `allowInsecureHttp !== true` 的旧配置时，标记为“等待用户确认”。
2. 在确认之前不得自动调用权限刷新、WebSocket、watcher 上传、pending 下载或图片库代理。
3. Desktop 的 `getDeviceMe()` / `connect()` / 上传和 Linux 的 `refreshDeviceIdentity()` / `startReceive()` / `startWatch()` 必须在真正网络请求前检查已存储的授权。
4. 用户确认后持久化选择；用户拒绝时保留绑定记录供更换 HTTPS 地址，但不发送 token。
5. 更新 README 中纯 IP + HTTP 流程，说明三端需要显式开启和持久风险提示。

**回归测试**

- 三端新配置缺省协议时默认 `https://`。
- loopback HTTP 可直接使用。
- 旧的非回环 HTTP 配置在首次启动时不发出任何携带 token 的请求。
- 显式授权后上传、接收和权限刷新恢复。

### 8.4 R0-3：修复 Android 加密故障状态（阻塞发布）

**必须修改**

1. 不得使用 `onDismissRequest = {}` 且确认按钮为空操作的全局 `AlertDialog`。
2. 首选使用顶部持久错误横幅，保留设置、帮助和诊断页的可访问性。如仍使用弹窗，“我知道了”必须真正关闭弹窗。
3. 加密存储不可用时，在 `AppRoot` 的服务启停条件中同时要求 `storageStatus is Ok` 和 token 可用。
4. 手动上传、自动上传、接收、权限刷新和绑定入口都必须拒绝执行，不得启动后台任务然后反复重试。
5. 页面上提供可操作的处理建议，但不自动清除用户数据。

**回归测试**

- 模拟 EncryptedSharedPreferences 初始化失败后，设置/帮助仍可访问。
- 不会启动上传或接收服务，不会排队手动上传任务。
- 磁盘上不会新增明文 device token。

### 8.5 R0-4：修复 Android fallback 迁移丢设置（阻塞发布）

**现有回归**

当加密存储恢复时，当前逻辑只复制 token、设备和成员字段，随后删除整个 fallback SharedPreferences。用户的自动上传、Wi-Fi、监听目录、排除目录、自动接收等配置会丢失。

**必须修改**

1. 在删除 fallback 文件前，按正确类型迁移全部已知设置：String、Boolean、Int、Long 和 StringSet 不得使用统一的字符串复制。
2. 使用同步 `commit()` 检查目标写入是否成功；仅在所有必需字段已写入后删除原文件。
3. 加密仍不可用时只删除 token 和设备绑定标识，保留所有非敏感设置。
4. 更长期可将“凭证加密库”和“普通应用设置”分成两个独立 store，但本次返修不得因重构扩大范围。

**回归测试**

- 构造包含所有数据类型的旧 fallback，迁移后值完全一致，且 token 只存在于加密 store。
- 目标写入失败时保留原 fallback，不出现部分迁移后删除源数据。
- 加密仍不可用时 token 被清理，但相册、排除目录和开关保留。

### 8.6 R0-5：修复 Linux Web 测试和关闭流程（阻塞发布）

**复现结果**

`npm test` 中 API、clipboard 和 HTTP safety 测试通过，进入 `web-auth.test.mjs` 后不退出。单独运行首个未鉴权测试，20 秒后仍卡在 `server.close()`。

**必须修改**

1. 生产服务关闭必须能处理浏览器 keep-alive 连接。可在 Fastify 构建参数中使用适用当前版本的 idle/force close 策略，或在关闭时显式关闭 idle connection。
2. `permissionTimer` 调用 `unref()`，并确保 close 路径即使某一个服务停止失败也会继续清理剩余资源。
3. 不得只在测试请求中添加 `Connection: close` 来掩盖生产关闭问题。
4. 会话生命周期需要一致：当前 Cookie 声称 12 小时，但服务端不校验过期时间，且 boot token 只能使用一次。二选一：
   - 改为与 Web 服务进程同寿命的浏览器 session Cookie，去掉不真实的 12 小时语义；或
   - 增加服务端 `expiresAt` 校验和可安全重新引导的完整流程。

**回归测试**

- `node --test test/web-auth.test.mjs` 在 10 秒内正常退出且返回 0。
- `npm test` 所有 Linux 测试通过并正常退出。
- 保持一个 keep-alive 请求后调用 `server.close()`，在明确时限内完成。
- 无 Cookie、伪造 Cookie、错误 Origin、boot token 重放、真实已绑定配置脱敏均有自动化测试。

### 8.7 R0-6：正确关闭 Desktop 致命错误后的 watcher

**必须修改**

1. chokidar `error` 事件中先保留当前 `FSWatcher` 引用，再将对外状态改为已停止。
2. 对原 `FSWatcher` 调用 `close()`，完成后再通知 `onFatal`。不得先将唯一引用置空后丢失关闭能力。
3. 对重复 `error`、用户同时点击停止、正在上传时发生致命错误做幂等处理。
4. 重启新 watcher 前必须确认旧 watcher 已关闭，避免重复事件和句柄泄漏。

**回归测试**

- 单文件上传失败后 watcher 继续处理下一个文件。
- 模拟 chokidar 致命错误后旧 watcher 的 `close()` 恰好调用一次。
- 从 UI 重启后只有一个有效 watcher，同一文件不会触发两次上传。

### 8.8 测试和提交要求

返修提交不得只修主路径，必须同时补回归测试：

1. Linux 保留现有 Web 鉴权测试并修到可正常退出，补真实已绑定 DTO 脱敏和会话生命周期测试。
2. Desktop 建立最小 Node 测试入口，覆盖 HTTP 授权传递、旧配置阻断和 watcher 致命错误关闭。
3. Android 增加 `testImplementation` 和可测试的存储/迁移边界，至少覆盖完整 fallback 迁移、加密故障以及 HTTP 策略。
4. Backend 保留新增登录测试。隔离 PostgreSQL 可用时必须运行全部 92 项集成测试，不得只报告 5 项无数据库单元测试。
5. 不要在返修中修改 `dist` 以外的无关生成文件；Linux `dist` 如按项目现有规则提交，必须与 `src` 重新构建后完全一致。

### 8.9 返修完成的唯一判定标准

以下条件全部满足后，才能将本次 P0 标记为完成：

- R0-1 至 R0-6 全部修复，每项都有自动化回归测试。
- Backend、Desktop、Linux 构建通过，Android `compileDebugKotlin` 和单元测试通过。
- `npm test` 在 Linux 客户端不挂起，正常返回 0。
- Backend PostgreSQL 集成测试在隔离数据库上全部通过。
- 手工验证 HTTPS、loopback HTTP、新的显式授权 HTTP、未授权旧 HTTP 配置四种场景。
- 手工验证 Android 加密存储不可用时 UI 仍可进入设置/帮助，且不启动传输任务。
- 通过上述门槛后再将四端版本从 `0.5.0` 统一升级为 `0.5.1`，更新 `RELEASES.md` 和 SHA-256。
