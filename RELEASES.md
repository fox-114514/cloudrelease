# StudyShot Relay 安装包

版本：Windows / Linux 桌面端 0.5.7；Android 0.5.2；后端 / Linux CLI 0.5.1
生成时间：2026-06-29

## 可用安装包

| 平台 | 文件名 | 大小 | 说明 |
|---|---|---|---|
| Windows | `releases/0.5.7/StudyShot-Relay-Windows-0.5.7-portable.exe` | ~80 MB | 精简语言资源的单文件便携版，修复分屏窄窗口导航 |
| Android | `releases/0.5.2/StudyShot-Relay-Android-0.5.2.apk` | ~12 MB | Release 签名版，修复创建绑定码页面错位 |
| Linux (桌面) | `releases/0.5.7/StudyShot-Relay-Desktop-Linux-0.5.7_amd64.deb` | ~86 MB | Electron 桌面端热修复，支持服务器更新 |
| Linux (AppImage) | `releases/0.5.7/StudyShot-Relay-Desktop-Linux-0.5.7.AppImage` | ~85 MB | 精简语言资源的免安装桌面端热修复 |
| Linux (CLI/Web) | `releases/0.5.1/StudyShot-Relay-Linux-Client-0.5.1_amd64.deb` | ~1.5 MB | 命令行 + Web 管理界面，支持服务器更新 |

## 0.5.7 变更（Windows / Linux 桌面端）

- 修复分屏或窄窗口下，顶部导航所在 grid 隐式行被拉高，导致当前标签背景变成竖向白色胶囊的问题。
- 窄屏导航现在明确使用 `auto + 1fr` 两行布局，导航项固定为正常按钮高度，内容区继续独立滚动。
- Windows portable 和 Linux 桌面端版本号升至 `0.5.7`；Android 仍为 `0.5.2`，后端和 Linux CLI/Web 仍为 `0.5.1`。

## 0.5.6 变更（Windows / Linux 桌面端）

- 全屏或宽屏窗口下，右侧内容列在内容区内居中显示，避免内容贴左造成大面积单侧留白。
- 右侧内容列最大宽度调整为 `1040px`，普通窗口宽度下仍自适应。
- Windows portable 和 Linux 桌面端版本号升至 `0.5.6`；Android 仍为 `0.5.2`，后端和 Linux CLI/Web 仍为 `0.5.1`。

## 0.5.5 变更（Windows / Linux 桌面端）

- 修复 CSS `.banner { display: flex; }` 覆盖 `[hidden]` 默认隐藏规则，导致旧明文 HTTP 提示框在 HTTPS 配置下仍显示的问题。
- 新增全局 `[hidden] { display: none !important; }`，确保所有被 JS 标记隐藏的提示、错误和状态块都能真正隐藏。
- Windows portable 和 Linux 桌面端版本号升至 `0.5.5`；Android 仍为 `0.5.2`，后端和 Linux CLI/Web 仍为 `0.5.1`。

## 0.5.4 变更（Windows / Linux 桌面端）

- Linux 桌面端自托管更新下载 `.deb` 后，优先通过 `pkexec apt install -y <package>` 调起系统包管理器升级，避免本地图形应用中心只显示“已安装”而不升级。
- 若 `pkexec` 不可用，会回退到打开安装包，并在错误信息中给出终端安装命令。
- Windows portable 和 Linux 桌面端版本号升至 `0.5.4`；Android 仍为 `0.5.2`，后端和 Linux CLI/Web 仍为 `0.5.1`。

## 0.5.3 变更（Windows / Linux 桌面端）

- 修复桌面端左侧导航会跟随鼠标滚轮滚动的问题；现在只有右侧内容区滚动。
- “暂不连接”会在本次应用会话内隐藏旧明文 HTTP 确认提示，避免状态刷新后反复出现；仍继续阻止携带 token 的请求。
- Windows portable 和 Linux 桌面端版本号升至 `0.5.3`；Android 仍为 `0.5.2`，后端和 Linux CLI/Web 仍为 `0.5.1`。

## 0.5.2 变更（Android / Linux 桌面端）

- 修复 Android 管理页创建绑定码后，绑定码、有效期说明和复制按钮在结果卡片内重叠错位的问题。
- Android `versionCode` 更新为 10，`versionName` 更新为 `0.5.2`。
- 修复 Electron 主进程在 WebSocket 尚未建立时重建连接，调用 `close()` 抛出 `WebSocket was closed before the connection was established` 并弹出 JavaScript error 的问题。
- 修复服务器已切换到 HTTPS 后，旧 HTTP 配置确认提示仍残留显示的问题。
- Linux 桌面端版本号升至 `0.5.2`，便于 `.deb` 覆盖安装；后端、Windows 和 Linux CLI/Web 仍为 `0.5.1`。

## 0.5.1 变更

- 修复 Android 登录或绑定成功时提示文字叠加，以及管理登录表单错误使用全屏宽高约束的问题。
- Android 帮助页补充可执行的配置、排错、数据位置、权限和更新说明，并修正自动上传与后台连接描述。
- 新增自托管 Android 更新：设备 token 保护的版本/API 下载接口、WebSocket 更新事件、启动定时检查、用户确认下载、公共 Downloads 保存、SHA-256 校验和系统安装器拉起。
- Android `versionCode` 更新为 9；以后发布 APK 必须继续递增并使用同一签名证书。
- Windows、Linux 桌面端和 Linux CLI/Web 新增独立更新通道、版本检查、WebSocket 通知、用户确认下载、SHA-256 校验和安装包拉起。
- Windows portable 从约 90.7 MB 降至约 83.1 MB；Electron Linux AppImage 从约 126.1 MB 降至约 88.9 MB；独立 Linux `.deb` 从约 4.8 MB 降至约 1.5 MB。

所有文件按版本号位于项目根目录 `releases/<version>/`。当前 Windows 和 Linux 桌面端位于 `releases/0.5.7/`，Android 位于 `releases/0.5.2/`，其余 0.5.1 安装包位于 `releases/0.5.1/`；旧 `0.4.x` 安装包继续保留供回退，`0.4.0` 以下安装包已清理。

## SHA-256

```text
fd5e12b84a17193bc14259e95ea2ea0ec7a2ec482a0b26345692679c04326bbb  releases/0.5.7/StudyShot-Relay-Desktop-Linux-0.5.7.AppImage
97d68f2058f5d7e9aa83a9d8cc4803710d975135e1e1c840811044a4185fb906  releases/0.5.7/StudyShot-Relay-Desktop-Linux-0.5.7_amd64.deb
84f4d54741ddb9fdc9a854cf56e57235d1d156d9da4e986a48cb28257f54ff9a  releases/0.5.7/StudyShot-Relay-Windows-0.5.7-portable.exe
4096423a160817cdb05cda7b3c9e070e821c5090f421f84fb55521b7bce6808f  releases/0.5.6/StudyShot-Relay-Desktop-Linux-0.5.6.AppImage
a53c4e0ac055f97adb4964b3a6ffd77e0b61c5b22c70c4df0e7e3f6c0006801a  releases/0.5.6/StudyShot-Relay-Desktop-Linux-0.5.6_amd64.deb
921afb3c7fa8783a2aaffc4504ac8958785a92540d5c7e0171df88d1ee5325f2  releases/0.5.6/StudyShot-Relay-Windows-0.5.6-portable.exe
8ae10bf38975e944da8216ca104a4efe8581861b76286117237d5561a933df74  releases/0.5.2/StudyShot-Relay-Android-0.5.2.apk
8cacd0b23ff0c10cd095f2288aaf6bd35d8592a11e7e5c32dd23d352e0510b52  releases/0.5.1/StudyShot-Relay-Linux-Client-0.5.1_amd64.deb
```

## 使用方式

### Windows

双击 `releases/0.5.7/StudyShot-Relay-Windows-0.5.7-portable.exe` 直接运行。

### Android

```bash
adb install -r releases/0.5.2/StudyShot-Relay-Android-0.5.2.apk
```

### Linux 桌面端 (.deb)

```bash
sudo apt install ./releases/0.5.7/StudyShot-Relay-Desktop-Linux-0.5.7_amd64.deb
# 如果依赖缺失
sudo apt-get install -f
```

安装后从应用菜单启动 **StudyShot Relay**。

### Linux 客户端 (.deb)

安装 `releases/0.5.1/StudyShot-Relay-Linux-Client-0.5.1_amd64.deb` 后可运行 `studyshot-relay update` 手动检查更新。

## 0.5.0 变更（多用户 V2）

按 [多用户 V2 设计](docs/design/multi-user-v2.md) 实施，主要范围：

### 后端

- `POST /api/v1/bind-codes` 支持 child JWT 给自己创建绑定码；`expiresInSeconds` 上限 3600；返回 `targetUser` 摘要；目标用户禁用返回 `409 TARGET_USER_DISABLED`；无身份返回 `401 UNAUTHORIZED`。
- 新增 `POST /api/v1/bind-codes/preview`：不消耗绑定码，返回空间与目标成员摘要；错误统一 `400 INVALID_BIND_CODE`，不泄露内部状态。
- `POST /api/v1/devices/register` 支持 `profile` 字段（`manual_only` / `upload_only` / `receive_own` / `sync_own`）；不传则保持旧默认；`custom` 不接受；目标用户禁用返回 `400 INVALID_BIND_CODE`；返回 `user` 与 `profile`。
- 新增 `GET /api/v1/devices/me`：返回当前设备身份、所属用户与推断 profile（设备 token）。
- 新增 `PATCH /api/v1/devices/:id/profile`：原子设置用途预设，只改 6 个运行时字段。
- 新增 `PUT /api/v1/devices/:id/receive-config`：原子设置接收模式与来源规则。
- 设备改名 / 撤销 / 删除接口支持 child JWT 自管；跨成员返回 `404`，普通设备 token 返回 `403`。
- `PATCH /api/v1/devices/:id/permissions` 收紧：`canManageSpace` 设备不能再授予 `canManageSpace` / `canCreateInvite`；child JWT 完全不能调用。
- `GET /api/v1/images` 列表按 `uploadUserId` 隔离；owner / canManageSpace 可用 `userId` 过滤同空间成员。
- `GET /api/v1/images/:id/download` 收紧：跨成员下载返回 `404`；`canManualDownload` 不再跨成员下载已知 image ID。
- `DELETE /api/v1/images/:id` 收紧：child 仅自己图片；设备 token 始终 `403`。
- 新增 `backend/src/services/device-profiles.ts` 与 `backend/src/services/authorization.ts`；权限判断集中，不在路由分散。
- 新增 `backend/src/scripts/audit-multi-user-config.ts` 与 `npm run audit:multi-user[:apply]` 命令。
- 新错误码：`DEVICE_AUTH_REQUIRED` / `TARGET_USER_DISABLED` / `INVALID_DEVICE_PROFILE` / `OWNER_AUTH_REQUIRED_FOR_PRIVILEGED_PERMISSION` / `INVALID_RECEIVE_CONFIG` / `CROSS_USER_SOURCE_FORBIDDEN`。
- 后端测试从 40 项扩到 88 项；已在隔离 PostgreSQL `localhost:55432/studyshot_test` 上执行 `npm test`，5 项单元测试和 88 项集成测试全部通过。

### Web 管理页 (`/admin`)

- child 文案统一改为「成员」；owner 仍是「空间管理员」。
- 身份条幅：当前身份 + 角色 + 空间 ID。
- 设备表新增「用途预设」列（manual_only / upload_only / receive_own / sync_own / custom），高级布尔权限折叠。
- 范围中文化：仅截图 / 选定相册 / 仅手动分享 / 全部图片；不接收 / 仅我的设备 / 指定设备 / 空间全部。
- `all_authorized_sources` 二次确认跨成员警告；`selected_devices` 同屏选择来源设备。
- 全部 members 可生成「给我自己的绑定码」入口。
- child 登录后自动隐藏「成员」「分组」「审计」导航项与对应调用；快速创建绑定码要求选择目标成员并展示目标成员摘要。
- Group 区块横幅：当前仅作组织标签，不影响图片共享或投递规则。

### Android 客户端

- 新增 `BindCodePreview` / `BindCodeTargetUser` / `DeviceSelfInfo` / `BindCodeSpace` / `DeviceSelfDevice` / `BindCodeRequest` / `UserSummary` 数据模型。
- `StudyShotApiClient` 新增 `previewBindCode` / `getDeviceMe` / `updateDeviceProfile` / `updateReceiveConfig`；`registerDevice` 增加 `profile` 与 `user` 摘要字段。
- `SecureSettings` 持久化 `boundUserId` / `boundOwnerUserId` / `boundUserDisplayName` / `boundUserRole` / `lastKnownDeviceProfile` / `lastKnownPermissionsJson` / `permissionsFetchedAt`。
- `BindScreen` 增加两种入口：使用绑定码（强制 preview 后再确认）/ 使用账号绑定（登录→自动生成自绑码→选择 profile→注册→丢弃 JWT）。
- `ManagementCreateCodeScreen` 在卡片中显示目标成员摘要。
- 首页 / 设置显示当前身份 + 设备用途预设。
- 启动时调用 `refreshSelfIdentity`，WebSocket 1008 关闭时也调用。

### Electron 桌面端

- `shared.ts` 新增 `BoundUserInfo` / `DeviceProfile` / `DeviceSelfInfo` / `BindCodePreview` / `BindCodeTargetUser` 类型；`ManagedDevice` 增加 `userRole` / `profile`；`RendererSettings` 增加 `boundUser` / `lastKnownProfile` / `lastKnownPermissions` / `permissionsFetchedAt`。
- `config-store.ts` 持久化新字段；旧配置自动兼容（缺失字段为空）。
- `RelayClient` 新增 `previewBindCode` / `getDeviceMe` / `refreshEffectivePermissions` / `updateDeviceProfile` / `updateReceiveConfig` / `bindWithLogin`（登录 + 自动注册 + JWT 局部丢弃）。
- `preload.ts` 暴露对应 IPC；`main.ts` 重新映射所有 IPC handler。
- 启动时调用 `refreshEffectivePermissions`；403/401 后停止 watcher / receiver 并提示重新绑定。
- 保留旧的 `createBindCodeWithLogin` 入口用于管理员生成绑定码场景。

### Linux 客户端

- CLI `bind` 强制预览目标成员并确认，支持 `--profile`。
- 新增 `bind-login`，密码使用隐藏终端输入；临时 JWT 不写入配置。
- 新增 `whoami` / `permissions` / `refresh-permissions`。
- CLI/Web 配置保存绑定成员、profile、有效权限和刷新时间。
- Web 支持账号绑定、code 预览确认、身份/权限展示；本地自动开关受服务端有效权限约束。
- 长时间运行时每 5 分钟刷新权限，服务端撤权后停止对应 watcher / receiver。

## 部署与升级

按以下顺序发布（与 spec §16 一致）：

1. 部署后端 0.5.1，并保留 0.4.x 兼容路径。
2. 在新版本上执行 `npm run audit:multi-user` 做一次只读扫描；可选 `--apply-safe-fixes` 收紧无来源 `selected_devices` 与禁用成员的过期绑定码。
3. 发布 Android / Electron 新版本。
4. 监控一段时间后，服务端收紧 `canManualDownload` 跨成员语义（已在 0.5.0 中默认收紧）。
5. 同步更新 `docs/spec/permissions.md`、`docs/spec/protocol.md`、RELEASES.md（如本文件）。

## Android 0.4.3 变更

- OPD2508/ColorOS 实机确认后台 MediaStore 回调存在数秒延迟。
- 实时模式新增每秒一次的最近媒体主动扫描，与 ContentObserver 事件监听并行。
- 图片发现后仍由前台服务直接上传，并保留 WorkManager 可靠兜底。
- 后端和 Ubuntu/Linux 客户端无须更新，继续兼容 `0.4.1`。

## Android 0.4.2 变更

- 实时学习模式在前台服务中直接执行上传，不再等待后台 WorkManager/JobScheduler 调度。
- 上传前创建延迟 WorkManager 任务作为进程退出兜底；直传成功后自动取消。
- 断网和临时服务端错误继续按原有策略可靠重试，并保留"仅 Wi-Fi"约束。
- 后端和 Ubuntu/Linux 客户端无须更新，继续兼容 `0.4.1`。

## 0.4.1 变更

- 修复 Android 将大小写敏感绑定码强制转换为大写，导致新设备无法绑定的问题。
- Android 和后端会忽略绑定码首尾空白，同时完整保留原始大小写。
- 新增复制绑定码包含空白的后端回归测试；完整测试为 40 项。
- 后端、Android、桌面端和 Linux 客户端版本统一为 `0.4.1`。

## 注意事项

- Windows 版本为单文件 NSIS 便携包，不需要安装。
- Android 发布 APK 必须使用同一签名证书；`versionCode` 必须递增，否则系统会拒绝覆盖安装。
- Linux 桌面端 `.deb` 和 Linux 客户端 `.deb` 是两个不同的应用，可按需安装。
- 0.5.0 中**不允许**客户端用 `canManageSpace` 设备为他人授予 `canManageSpace` 或 `canCreateInvite`；上线前请运行只读审计脚本确认存量无意外扩散。
