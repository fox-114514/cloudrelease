# StudyShot Relay Permissions

文档版本：2026-06-21（V2 多用户增强）

本文定义 StudyShot Relay 的权限边界。后端、安卓端、桌面端、Linux 客户端和后续编码 agent 必须共同遵守这些规则。

V2 的范围是「家庭/团队共享空间」模型：owner 是空间管理员，child 是成员。详细动机、需求拆解和取舍见：

- [多用户管理调查报告](../archive/2026-06/multi-user-investigation-2026-06-21.md)
- [多用户体验优化方案](../archive/2026-06/multi-user-optimization-plan.md)
- [多用户 V2 设计](../design/multi-user-v2.md)

## 1. 核心原则

- 权限执行单位可以是用户（JWT）或设备（device token），但「管理空间」的能力仅 owner JWT 可授予。
- 所有数据必须通过 `ownerUserId` 隔离主用户空间，租户查询必须先按 `ownerUserId` 过滤。
- owner 用户 token 可以管理整个空间，owner 名下的设备不会自动拥有管理权。
- child（成员）用户可以管理自己的设备、查看自己的图片；不能跨成员访问。
- 被撤销设备不能上传、下载、接收 WebSocket 事件或调用设备接口。
- 用户被禁用后，该用户的所有设备立即不可用。
- 跨成员资源访问应优先返回 `404 NOT_FOUND`，避免枚举存在性。
- 服务端权限始终是最终事实，客户端本地开关不能绕过服务端。
- 客户端 UI 可以隐藏无权限功能，但应避免显示一个必然返回 403/404 的控件。

## 2. 身份类型

### Owner 用户 token（空间管理员）

来源：`POST /api/v1/auth/login`

UI 文案：**空间管理员**。

能力：

- 创建设备绑定码，目标可任意同空间成员。
- 管理同一 owner 空间内用户、用户组、设备、权限、绑定码、审计日志。
- 授予或撤销 `canManageSpace`、`canCreateInvite`。
- 调整任何设备的接收范围，包括 `all_authorized_sources`。
- 查看全空间图库；按成员筛选图片。
- 预览/删除全空间图片。

限制：

- 不能跨 owner 空间访问任何资源。
- 不应长期保存在自动运行的后台进程里（管理 token 只用于后台手动登录）。

### Child 用户 token（成员）

来源：`POST /api/v1/auth/login`

UI 文案：**成员**。

能力（V2 起扩展）：

- 给自己创建 `bind_device` 绑定码。
- 改名、撤销、删除**自己名下**的设备。
- 调用 `GET /devices/me` 查看当前设备的实时服务端权限。
- 通过 `PATCH /devices/:id/profile` 更新自己设备的用途预设。
- 通过 `PUT /devices/:id/receive-config` 配置自己的接收范围（只能选 `disabled`、`same_user_only`、`selected_devices`，且 `selected_devices` 中的来源设备必须属于自己）。
- 列出、下载、删除**自己上传**的图片。

限制：

- 不能给其他用户创建绑定码。
- 不能调用 `PATCH /devices/:id/permissions`。
- 不能访问他人设备、他人图片（始终返回 `404`）。
- 不能配置 `all_authorized_sources`。
- 不能读取用户、用户组或审计日志。

### 设备 token

来源：`POST /api/v1/devices/register`

能力由设备权限决定（见 §3）。

- 普通设备 token：上传、下载、查看 `GET /devices/me`，**不能**自我管理其他设备。
- `canManageSpace` 设备 token：可管理同空间其他设备的运行时权限（`canAutoUpload` / `canManualUpload` / `canAutoReceive` / `canManualDownload` / `autoUploadScope` / `autoReceiveScope`）。
- `canCreateInvite` 设备 token：仅能为自己所属用户创建绑定码。

限制：

- 即使设备属于 owner 用户，token 的 `role` 字段也是所属用户的 role，但**不能**继承 owner 的管理能力，必须显式 `canManageSpace=true`。
- 设备 token 不能调用 `PATCH /devices/:id/permissions` 来授予自己或他人 `canManageSpace` / `canCreateInvite`（`OWNER_AUTH_REQUIRED_FOR_PRIVILEGED_PERMISSION`）。
- 设备 token 不能调用 `DELETE /api/v1/images/:id`。

## 3. 设备权限字段

完整的 8 个运行时字段位于 `DevicePermission` 表。V2 起：

- 客户端**必须**优先通过 `profile`（用途预设，§5）来修改其中 6 个运行时字段，避免产生 `canAutoReceive=true + autoReceiveScope=disabled` 等无效组合。
- 修改 `profile` 不会触碰 `canManualDownload` / `canManageSpace` / `canCreateInvite` 三个特权字段。

### `canAutoUpload`

允许设备自动上传监听到的图片。

服务端要求：

- `sourceKind != manual_share` 的上传必须检查此权限。

客户端要求：

- 没有该权限时，不要启动自动上传监听。
- 权限被服务端关闭后，应停止自动上传任务（V2 起还要在收到 `403` 后主动调用 `GET /devices/me` 刷新）。

### `canManualUpload`

允许设备通过手动选择或分享菜单上传图片。

服务端要求：

- `sourceKind = manual_share` 的上传必须检查此权限。

### `canAutoReceive`

允许服务器为该设备生成自动投递。

服务端要求：

- 生成 delivery 前必须检查此权限。
- 当 `autoReceiveScope=disabled` 时，无论 `canAutoReceive` 如何都不投递；通过 `PUT /devices/:id/receive-config` 原子化可避免状态不一致。

### `canManualDownload`

允许设备手动下载历史图片。**V2 起收紧边界**：

- 必须有合法 delivery（pending / notified / downloaded），**或者** `image.uploadUserId == device.userId`。
- 不再允许凭 `canManualDownload` 跨成员下载已知 image ID，统一返回 `404` 不暴露存在性。

### `canManageSpace`

允许设备管理当前 owner 空间。

能力包括：

- 查看空间内所有设备。
- 修改运行时权限（见 §6.7）。
- 撤销设备；删除已经撤销的设备（软删除，保留历史记录）。
- 为任意同空间用户创建设备绑定码。
- 浏览 / 删除空间内的图片库。
- 通过 `/images/{id}/download` 下载空间内任意未过期图片用于预览。

**V2 关键变化**：

- 该权限**只能由 owner 用户 token 授予**；`canManageSpace` 设备 token 修改 `canManageSpace` 或 `canCreateInvite` 会被拒绝，返回 `OWNER_AUTH_REQUIRED_FOR_PRIVILEGED_PERMISSION` 403。
- 这种「权限锁」是 spec §3 的核心安全要求，防止设备 token 泄露后扩散为完整空间接管。

### `canCreateInvite`

允许设备创建绑定码。

边界：

- 如果没有 `canManageSpace`，只能给该设备所属用户创建绑定码。
- 不能给其他用户创建绑定码。

典型用途：

- 已绑定的个人设备帮同一用户绑定另一台设备。

## 4. 设备用途预设（Profile）

V2 引入的「面向人」抽象，替代原始 8 个布尔字段的直接编辑。Profile 在请求/响应中以字符串形式存在，**不需要修改数据库枚举**。

```ts
type DeviceProfile = "manual_only" | "upload_only" | "receive_own" | "sync_own" | "custom";
```

| profile | canAutoUpload | canManualUpload | canAutoReceive | autoUploadScope | autoReceiveScope |
|---|---:|---:|---:|---|---|
| `manual_only` | false | true | false | `manual_share_only` | `disabled` |
| `upload_only` | true | true | false | `screenshot_only` | `disabled` |
| `receive_own` | false | true | true | `manual_share_only` | `same_user_only` |
| `sync_own` | true | true | true | `screenshot_only` | `same_user_only` |

约束：

- 客户端**不能**提交 `custom`（服务端校验）。`custom` 由服务端 `inferDeviceProfile()` 推断，仅用于 UI 提示用户「这个设备已不是任一标准预设」。
- 旧客户端不传 `profile` 时，服务端沿用旧的 `LEGACY_DEFAULT_PROFILE`（`canAutoUpload=false, canManualUpload=true, canAutoReceive=false, autoUploadScope=screenshot_only, autoReceiveScope=disabled`），并把响应中的 `profile` 字段标为 `custom`。
- 服务端实现：`backend/src/services/device-profiles.ts`，**必须**集中在该模块，禁止在多个路由复制硬编码。

## 5. 自动上传范围

字段：`autoUploadScope`

合法值：

- `screenshot_only`
- `selected_album`
- `manual_share_only`
- `all_images`

中文显示：仅截图 / 选定相册 / 仅手动分享 / 全部图片。

各值的语义与客户端要求见原 §4；V2 起只在 `profile` 映射或 owner 显式 PATCH 时被修改。

## 6. 自动接收范围

字段：`autoReceiveScope`

合法值：

- `disabled`：不自动接收。
- `all_authorized_sources`：接收同空间所有授权上传设备。
- `same_user_only`：只接收同一用户名下设备上传。
- `selected_devices`：仅接收 `receive_source_rules` 中显式配置的来源设备。

中文显示：不接收 / 仅我的设备 / 指定设备 / 空间全部。

### `selected_devices` 的闭环要求

V2 起使用 `PUT /devices/:id/receive-config` 原子地修改 mode 与来源规则：

1. `disabled`：设置 `canAutoReceive=false`、`autoReceiveScope=disabled`，删除全部旧规则。
2. `same_user_only`：设置 `canAutoReceive=true`、`autoReceiveScope=same_user_only`，删除旧规则。
3. `selected_devices`：要求 `sourceDeviceIds` 至少一项，事务内删除旧规则并批量插入新规则；child 用户传入跨成员来源设备返回 `404`。
4. `all_authorized_sources`：仅 owner JWT 或 `canManageSpace` 设备可调用。

禁止行为：

- 客户端分别调用 scope PATCH 与 rule PUT，否则中途失败会留下半配置状态。
- 选择 `selected_devices` 后保存空列表（服务端拒绝 `INVALID_RECEIVE_CONFIG`）。

## 7. 投递生成规则

服务端上传成功后生成 delivery 时必须按顺序检查：

1. 目标设备与上传设备同属一个 `ownerUserId`。
2. 目标设备未撤销、未软删除。
3. 目标设备用户未禁用。
4. 目标设备 ID 不等于上传设备 ID。
5. 目标设备 `canAutoReceive = true`。
6. 目标设备 `autoReceiveScope != disabled`。
7. 根据 `autoReceiveScope` 检查来源范围。

范围检查：

- `all_authorized_sources`：允许（owner 显式开启，跨成员）。
- `same_user_only`：`targetDevice.userId == uploadDevice.userId`。
- `selected_devices`：存在启用的 `targetDeviceId + sourceDeviceId` 规则。
- `disabled`：拒绝。

## 8. 上传权限规则

自动上传：

- `sourceKind` 为 `screenshot`、`selected_album` 或 `unknown` 时，服务端按自动上传处理。
- 设备必须有 `canAutoUpload = true`。
- 客户端还必须按 `autoUploadScope` 过滤本地来源。

手动上传：

- `sourceKind = manual_share`。
- 设备必须有 `canManualUpload = true`。

禁止行为：

- 客户端不得把后台监听到的图片伪装成 `manual_share`。
- 客户端不得在 `manual_share_only` 范围下继续后台监听。

## 9. 图片可见性

V2 起图片列表、下载、删除权限在 owner / canManageSpace / child / device 之间分层：

### `GET /api/v1/images`（列表）

- owner JWT：查看全空间，可选 `userId=<uuid>` 过滤同空间成员。
- canManageSpace 设备：查看全空间，可按 userId 过滤。
- child JWT：仅 `uploadUserId == request.user.userId`；传 `userId` 给他人时强制回到自身（也允许直接 403）。
- `canManualDownload=true` 的普通设备 token：仅查看 `uploadUserId == device.userId` 的图片。
- 其他普通设备 token：拒绝。

### `GET /api/v1/images/:imageId/download`

- owner JWT / canManageSpace：当前空间任意有效图片。
- child JWT：仅 `image.uploadUserId == request.user.userId`。
- 设备 token 有合法 delivery：允许。
- 设备 token 无 delivery：只有 `canManualDownload=true` **且** `image.uploadUserId == device.userId` 才允许。
- 其他情况一律 `404`，避免暴露其他成员图片是否存在。

### `DELETE /api/v1/images/:imageId`

- owner JWT / canManageSpace：当前空间任意图片。
- child JWT：仅自己的图片；删除他人图片返回 `404`。
- 设备 token：禁止，返回 `403`。

## 10. 下载权限规则

自动下载：

- 当前设备必须有对应 delivery。
- delivery 状态应为 `pending`、`notified` 或 `downloaded`。
- 图片未过期且未删除。

手动下载：

- 当前设备没有 delivery 时，必须有 `canManualDownload = true`，且 `image.uploadUserId == device.userId`。
- 不能跨成员使用 `canManualDownload` 下载已知 image ID。

禁止行为：

- 客户端不能根据 image ID 构造公开下载链接。
- 服务端不能返回真实磁盘路径。

## 11. 防循环规则

防循环必须服务端和客户端同时做。

服务端已经执行：

- 图片记录 `uploadDeviceId`。
- 生成 delivery 时排除上传设备自身。
- 同一 owner 空间、同一上传设备、1 小时内相同 sha256 去重。
- 上传请求带 `originImageId` 时拒绝，防止服务端下载图片被再次自动上传。

客户端必须执行：

- 自动下载目录默认使用 App 私有目录，不保存到系统相册。
- 如果用户选择保存到相册，目录必须放 `.nomedia`，并把下载图片 sha256 记入本地「已接收哈希表」。
- 自动上传前计算 sha256，如果命中已接收哈希表，跳过。
- 监听目录不能包含 App 的下载目录。

## 12. 推荐设备权限配置

### 安卓平板，只负责截图上传

```json
{
  "profile": "upload_only",
  "canManualDownload": false,
  "canManageSpace": false,
  "canCreateInvite": false
}
```

### Ubuntu 电脑，自动接收并写剪贴板（owner 管理设备）

```json
{
  "profile": "all_authorized_sources",
  "canManualDownload": false,
  "canManageSpace": true,
  "canCreateInvite": true
}
```

### 安卓手机，仅本机同步

```json
{
  "profile": "sync_own"
}
```

### 成员名下接收设备

```json
{
  "profile": "receive_own"
}
```

## 13. Review 检查清单

后续每次改权限相关代码，必须检查：

- 查询条件是否包含 `ownerUserId`（owner / canManageSpace 操作还需 `userId` 显式限定）。
- 是否把 owner 用户身份和 owner 设备身份混淆（`role === "owner"` 不等于拥有 owner JWT 权限）。
- 是否在 `bind-codes` / `devices/register` / `images` / `devices/:id/permissions` 等关键路径上区分 401 / 403 / 404：
  - 无身份 → 401 `UNAUTHORIZED` / `DEVICE_AUTH_REQUIRED`
  - 身份不足 → 403（带具体 code）
  - 跨成员资源访问 → 404 `NOT_FOUND`
- 提权路径是否只能由 owner JWT 完成（`canManageSpace` / `canCreateInvite`）。
- `profile` / `receive-config` 是否只更新 6 个运行时字段，是否不动 `canManualDownload` / `canManageSpace` / `canCreateInvite`。
- 自动上传是否检查 `canAutoUpload`。
- 手动上传是否检查 `canManualUpload`。
- 自动投递是否检查 `canAutoReceive` 和 `autoReceiveScope`。
- 上传设备是否被排除在投递目标之外。
- `selected_devices` 是否实际查询了 `receive_source_rules`。
- child 图片访问是否限定到 `uploadUserId == request.user.userId`。
- 撤销设备是否立即失效。
- 禁用用户后设备是否不能继续使用。

## 14. 审计要求

每个关键动作必须调用 `logAudit()`，metadata 不得包含：

- 原始绑定码
- device token
- password
- JWT
- 本地绝对文件路径

必须包含：

- `actorUserId` / `actorDeviceId`
- `targetUserId`（绑定相关）
- `targetDeviceId`
- `profile` 或接收 `mode`
- 跨成员配置时的 `sourceDeviceIds`

审计 action 列表见 `docs/spec/protocol.md`。

## 15. 上线前的多用户配置审计

部署新版本前运行：

```bash
cd backend
npm run audit:multi-user             # 只读
npm run audit:multi-user:apply       # 应用安全修复
```

脚本检测五类风险（详见 §16 of `multi-user-v2-development-spec.md`）：

- `canAutoReceive=true` 但 `scope=disabled` 的设备。
- `scope=selected_devices` 但没有来源规则的设备（应用 `--apply-safe-fixes` 时改为 `disabled`）。
- child 用户名下拥有 `canManageSpace` 的设备（仅报告，不自动撤销）。
- `canManualDownload=true` 的 child 设备。
- 已禁用用户未过期的绑定码（应用 `--apply-safe-fixes` 时立即过期）。

脚本默认只读，`--apply-safe-fixes` 也**不会**自动撤销 child 的 `canManageSpace`，需要 owner 人工审查。
