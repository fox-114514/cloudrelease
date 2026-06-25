# StudyShot Relay 安装包

版本：Linux 桌面端 0.5.2；Android / 后端 / Windows / Linux CLI 0.5.1
生成时间：2026-06-26

## 可用安装包

| 平台 | 文件名 | 大小 | 说明 |
|---|---|---|---|
| Windows | `releases/0.5.1/StudyShot-Relay-Windows-0.5.1-portable.exe` | ~83 MB | 精简语言资源的单文件便携版，支持服务器更新 |
| Android | `releases/0.5.1/StudyShot-Relay-Android-0.5.1.apk` | ~12 MB | Release 签名版，身份显示 + 自助绑定 + 用途预设 |
| Linux (桌面) | `releases/0.5.2/StudyShot-Relay-Desktop-Linux-0.5.2_amd64.deb` | ~86 MB | Electron 桌面端热修复，支持服务器更新 |
| Linux (AppImage) | `releases/0.5.2/StudyShot-Relay-Desktop-Linux-0.5.2.AppImage` | ~85 MB | 精简语言资源的免安装桌面端热修复 |
| Linux (CLI/Web) | `releases/0.5.1/StudyShot-Relay-Linux-Client-0.5.1_amd64.deb` | ~1.5 MB | 命令行 + Web 管理界面，支持服务器更新 |

## 0.5.2 变更（Linux 桌面端）

- 修复 Electron 主进程在 WebSocket 尚未建立时重建连接，调用 `close()` 抛出 `WebSocket was closed before the connection was established` 并弹出 JavaScript error 的问题。
- 修复服务器已切换到 HTTPS 后，旧 HTTP 配置确认提示仍残留显示的问题。
- 版本号升至 `0.5.2`，便于 `.deb` 覆盖安装；Android、后端、Windows 和 Linux CLI/Web 仍为 `0.5.1`。

## 0.5.1 变更

- 修复 Android 登录或绑定成功时提示文字叠加，以及管理登录表单错误使用全屏宽高约束的问题。
- Android 帮助页补充可执行的配置、排错、数据位置、权限和更新说明，并修正自动上传与后台连接描述。
- 新增自托管 Android 更新：设备 token 保护的版本/API 下载接口、WebSocket 更新事件、启动定时检查、用户确认下载、公共 Downloads 保存、SHA-256 校验和系统安装器拉起。
- Android `versionCode` 更新为 9；以后发布 APK 必须继续递增并使用同一签名证书。
- Windows、Linux 桌面端和 Linux CLI/Web 新增独立更新通道、版本检查、WebSocket 通知、用户确认下载、SHA-256 校验和安装包拉起。
- Windows portable 从约 90.7 MB 降至约 83.1 MB；Electron Linux AppImage 从约 126.1 MB 降至约 88.9 MB；独立 Linux `.deb` 从约 4.8 MB 降至约 1.5 MB。

所有文件按版本号位于项目根目录 `releases/<version>/`。当前 Linux 桌面端位于 `releases/0.5.2/`，其余 0.5.1 安装包位于 `releases/0.5.1/`；旧 `0.4.x` 安装包继续保留供回退，`0.4.0` 以下安装包已清理。

## SHA-256

```text
73e890d1a46ed668d0582b7fd06d8350dd4d511369c55f66c6c0bfa66ec138f0  releases/0.5.2/StudyShot-Relay-Desktop-Linux-0.5.2.AppImage
91f61bdc993d4852c5a864bf7827c940cd314276f11f2b7218d9d8f0459decfb  releases/0.5.2/StudyShot-Relay-Desktop-Linux-0.5.2_amd64.deb
3211cdd7fa6b217324762b03017abb273b500b0d38d9e05babbfa0ddd86beac1  releases/0.5.1/StudyShot-Relay-Android-0.5.1.apk
8946a9396d0cd17c061240da93551b5761ff40174492a55ffece99f8751c6cd1  releases/0.5.1/StudyShot-Relay-Windows-0.5.1-portable.exe
8cacd0b23ff0c10cd095f2288aaf6bd35d8592a11e7e5c32dd23d352e0510b52  releases/0.5.1/StudyShot-Relay-Linux-Client-0.5.1_amd64.deb
```

## 使用方式

### Windows

双击 `releases/0.5.1/StudyShot-Relay-Windows-0.5.1-portable.exe` 直接运行。

### Android

```bash
adb install -r releases/0.5.1/StudyShot-Relay-Android-0.5.1.apk
```

### Linux 桌面端 (.deb)

```bash
sudo dpkg -i releases/0.5.2/StudyShot-Relay-Desktop-Linux-0.5.2_amd64.deb
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
