# StudyShot Relay 多用户 V2 详细开发规格

文档状态：可交付实现

目标版本：0.5.x

编写日期：2026-06-21

关联文档：

- [现状调查报告](./multi-user-investigation-2026-06-21.md)
- [产品优化方向](./multi-user-optimization-plan.md)
- [现有权限说明](./permissions.md)
- [现有协议文档](./protocol.md)

## 1. 文档用途和优先级

本文是交给实现型 AI 或开发者的工程规格。目标是在不重写整套数据库的前提下，完成第一版真正可用的多用户体验，并封住当前最容易误绑、串图和权限扩散的路径。

如果本文与“产品优化方向”存在差异，以本文为准。实现者不得自行扩大第一阶段范围。

必须遵守的执行规则：

1. 先完成后端和后端测试，再改客户端。
2. 每个鉴权查询必须包含 `ownerUserId`，或通过已经验证的设备/投递关系形成等价边界。
3. 数据库中的 `UserRole.child` 暂时保留；只把界面文案改成“成员”。
4. 第一阶段不引入 `Space`、`Membership`、Group 分享策略或新的最高管理员模型。
5. 第一阶段不实现设备历史图片归属迁移；历史审计数据不可批量改写。
6. 不允许客户端单独拼装多个布尔权限来表达普通用途；用途预设必须在服务端统一映射。
7. 服务端权限始终是最终事实，客户端本地开关不能绕过服务端。
8. 所有跨成员接收必须是显式配置，默认只能接收同一成员的图片。

## 2. 本期产品定义

本期采用“家庭/团队共享空间”模型：

- owner 在界面中称为“空间管理员”。
- child 在界面中称为“成员”。
- 空间管理员可以管理所有成员、设备和图片。
- 成员默认只能管理自己的设备、查看自己的图片。
- 成员之间默认不互相接收、浏览或手动下载图片。
- 跨成员自动接收只允许管理员显式配置。
- 普通成员可以用自己的账号自助绑定自己的设备。

本期不解决“一个账号加入多个 owner 空间”。当前 `ownerUserId` 继续作为租户边界。

## 3. 当前实现基线

实现者开始编码前必须确认以下现状仍成立：

### 3.1 后端

- 用户登录：`POST /api/v1/auth/login`，返回 7 天用户 JWT。
- 设备绑定码：`POST /api/v1/bind-codes`。
- 设备注册：`POST /api/v1/devices/register`。
- 普通成员 JWT 当前只能登录、列出自己的设备。
- 普通成员 JWT 当前不能创建绑定码、改名或撤销自己的设备。
- 图片上传身份由设备 token 推导，客户端不能提交 `uploadUserId`。
- 图片自动投递由 `autoReceiveScope` 决定。
- `all_authorized_sources` 会跨成员投递。
- `same_user_only` 依据 `targetDevice.userId == image.uploadUserId`。
- `selected_devices` 依赖 `ReceiveSourceRule`。
- `canManageSpace` 设备当前可以修改其他设备的 `canManageSpace`，存在权限自扩散。
- `canManualDownload` 当前允许设备下载同空间任意已知 image ID，对成员隐私过宽。

主要文件：

- `backend/prisma/schema.prisma`
- `backend/src/plugins/auth.ts`
- `backend/src/plugins/device-auth.ts`
- `backend/src/routes/auth.ts`
- `backend/src/routes/bind-codes.ts`
- `backend/src/routes/devices.ts`
- `backend/src/routes/images.ts`
- `backend/src/services/delivery.ts`
- `backend/src/routes/web-admin.ts`

### 3.2 Android

- 绑定页只接受服务器地址、绑定码和设备名。
- 管理登录允许 child 登录，但界面仍显示其无权执行的按钮。
- 创建绑定码请求不传 `userId`，owner 登录时生成的码只会绑定 owner。
- 设备详情可以切换布尔权限，但只能显示、不能修改接收范围。
- 注册响应中的用户归属和服务端权限没有形成持续同步状态。

主要文件：

- `network/ApiModels.kt`
- `network/StudyShotApiClient.kt`
- `data/SecureSettings.kt`
- `ui/navigation/AppState.kt`
- `ui/bind/BindScreen.kt`
- `ui/management/ManagementDevicesScreen.kt`
- `ui/management/ManagementDeviceDetailScreen.kt`
- `ui/management/ManagementCreateCodeScreen.kt`
- `ui/receive/ReceiveSettingsScreen.kt`

### 3.3 Electron 桌面端

- `createBindCodeWithLogin` 先登录再创建绑定码，但没有成员目标选择。
- 管理状态只维护设备列表，没有成员列表。
- 可以设置接收范围枚举，但没有 `selected_devices` 来源选择 UI。
- 本地自动上传/接收开关与服务端有效权限不是同一状态。

主要文件：

- `desktop/src/shared.ts`
- `desktop/src/config-store.ts`
- `desktop/src/relay-client.ts`
- `desktop/src/main.ts`
- `desktop/src/preload.ts`
- `desktop/src/renderer/renderer.js`
- `desktop/src/renderer/index.html`

### 3.4 Linux CLI/Web

- 绑定只接受已有绑定码。
- `DeviceConfig` 不保存成员归属和服务端权限。
- Web 管理页主要管理本地运行开关，缺少完整多用户流程。

主要文件：

- `linux-client/src/config.ts`
- `linux-client/src/api.ts`
- `linux-client/src/index.ts`
- `linux-client/src/web/server.ts`
- `linux-client/src/web/index.html`

## 4. 本期交付范围

本期必须完成以下八项：

1. 成员 JWT 可以为自己创建绑定码，但不能指定其他成员。
2. 新增绑定码预览接口，在注册前显示目标成员。
3. 设备注册支持安全的“用途预设”，默认不跨成员。
4. 新增 `GET /devices/me`，返回当前设备真实归属和权限。
5. 成员可以改名、撤销和删除自己的设备。
6. 成员可以查看、下载和删除自己的图片，但不能访问其他成员图片。
7. 禁止 `canManageSpace` 设备继续授予最高权限。
8. Android、Electron、Linux 至少完成身份显示、服务端权限同步和成员自助绑定。

本期推荐完成但可以拆成第二个 PR：

1. 原子接收配置接口和 `selected_devices` 来源选择 UI。
2. 后端 Web 管理页中文化范围名称和跨成员警告。
3. 多用户配置审计脚本。

本期明确不做：

- `Space` / `Membership` 数据模型重构。
- Group 参与授权；在实现前应隐藏或标记为“仅组织标签”。
- `invite_child_user` 完整邀请注册流程。
- 设备历史图片批量转移到另一成员。
- 多管理员角色、权限继承、组织层级。
- 外部 OAuth、短信或邮件邀请。

## 5. 术语和枚举

### 5.1 UI 术语

| 内部值 | UI 文案 |
|---|---|
| owner | 空间管理员 |
| child | 成员 |
| canManageSpace | 管理整个空间（高级） |
| canCreateInvite | 从此设备添加我的其他设备 |
| disabled | 不接收 |
| same_user_only | 仅接收我的设备 |
| selected_devices | 接收指定设备 |
| all_authorized_sources | 接收空间全部设备 |

代码和 API 为兼容现有客户端继续返回原枚举值，不在本期改数据库枚举。

### 5.2 设备用途预设

新增服务端枚举，仅用于请求/响应和 UI，不必写入数据库：

```ts
type DeviceProfile =
  | "manual_only"
  | "upload_only"
  | "receive_own"
  | "sync_own"
  | "custom";
```

`custom` 只用于服务端根据当前权限返回，客户端不能在注册请求中提交。

映射必须集中在新文件 `backend/src/services/device-profiles.ts`，不能在多个路由重复硬编码。

| profile | canAutoUpload | canManualUpload | canAutoReceive | autoUploadScope | autoReceiveScope |
|---|---:|---:|---:|---|---|
| manual_only | false | true | false | manual_share_only | disabled |
| upload_only | true | true | false | screenshot_only | disabled |
| receive_own | false | true | true | manual_share_only | same_user_only |
| sync_own | true | true | true | screenshot_only | same_user_only |

用途预设不得修改：

- `canManualDownload`
- `canManageSpace`
- `canCreateInvite`

注册请求不传 `profile` 时必须保持旧客户端默认行为：

```json
{
  "canAutoUpload": false,
  "canManualUpload": true,
  "canAutoReceive": false,
  "canManualDownload": false,
  "canManageSpace": false,
  "canCreateInvite": false,
  "autoUploadScope": "screenshot_only",
  "autoReceiveScope": "disabled"
}
```

这组旧默认在响应中可以推断为 `custom`，不要强行改写旧行为。

## 6. 后端接口规格

所有响应继续使用现有 envelope：

```json
{
  "success": true,
  "data": {}
}
```

错误继续使用：

```json
{
  "success": false,
  "error": {
    "code": "ERROR_CODE",
    "message": "Human readable message"
  }
}
```

### 6.1 调整 `POST /api/v1/bind-codes`

当前 schema 保持基本兼容，新增以下约束：

- `expiresInSeconds` 最大 3600 秒，默认 600 秒。
- `purpose=bind_device` 才进入本期自助绑定流程。
- 目标用户必须未禁用。

鉴权规则：

| 调用身份 | 不传 userId | 传自己的 userId | 传其他成员 userId |
|---|---:|---:|---:|
| owner JWT | 目标为 owner | 允许 | 允许，同空间且未禁用 |
| child JWT | 目标为自己 | 允许 | 403 |
| canCreateInvite 设备 | 目标为设备所属用户 | 允许 | 403 |
| canManageSpace 设备 | 目标为设备所属用户 | 允许 | 允许，同空间且未禁用 |
| 无身份 | 401 | 401 | 401 |

实现注意：当前无身份返回 403，应修正为 401。

成功响应增加目标用户摘要：

```json
{
  "success": true,
  "data": {
    "bindCode": "raw-one-time-code",
    "expiresAt": "2026-06-21T12:10:00.000Z",
    "targetUser": {
      "id": "uuid",
      "role": "child",
      "displayName": "张三"
    }
  }
}
```

不得返回目标用户登录名或密码相关信息。

新增审计 metadata：

```json
{
  "targetUserId": "uuid",
  "targetRole": "child",
  "expiresInSeconds": 600
}
```

错误码：

- `UNAUTHORIZED`：无身份。
- `FORBIDDEN`：成员或普通邀请设备指定其他用户。
- `TARGET_USER_DISABLED`：目标成员已禁用，409。
- `NOT_FOUND`：目标不属于当前空间。

### 6.2 新增 `POST /api/v1/bind-codes/preview`

用途：注册前确认“这台设备将属于谁”。该接口不消耗绑定码。

请求：

```json
{
  "bindCode": "raw-one-time-code"
}
```

鉴权：无需现有 token。绑定码本身是短期 bearer secret。必须受现有 rate limit 保护。

校验：

- trim 首尾空白，但保留大小写。
- code 不存在、已使用或已过期统一返回 `INVALID_BIND_CODE`，400。
- purpose 不是 `bind_device` 返回 `INVALID_BIND_CODE`。
- 目标用户不存在或已禁用返回 `INVALID_BIND_CODE`，不暴露内部状态。

成功响应：

```json
{
  "success": true,
  "data": {
    "expiresAt": "2026-06-21T12:10:00.000Z",
    "space": {
      "ownerUserId": "owner-uuid",
      "displayName": "王老师的空间"
    },
    "targetUser": {
      "id": "member-uuid",
      "role": "child",
      "displayName": "张三"
    }
  }
}
```

当前没有 `Space` 表，`space.displayName` 暂时使用 owner 用户 `displayName`；为空时使用“StudyShot 空间”。

不得返回：

- `emailOrLogin`
- `codeHash`
- 设备列表
- 其他成员信息

### 6.3 调整 `POST /api/v1/devices/register`

请求新增可选字段：

```json
{
  "bindCode": "raw-one-time-code",
  "deviceName": "张三的平板",
  "platform": "android",
  "osVersion": "Android 15",
  "appVersion": "0.5.0",
  "profile": "sync_own"
}
```

规则：

- `profile` 只接受 `manual_only`、`upload_only`、`receive_own`、`sync_own`。
- 不传时保留旧默认权限。
- profile 只能映射安全运行权限，绝不能授予 `canManageSpace`、`canCreateInvite` 或跨成员接收。
- 目标用户查询必须包含 `disabledAt: null`。
- 绑定码消费和设备/权限创建继续在同一个事务中。
- 单次使用的原子保护保持不变。

注册审计 metadata 增加：

```json
{
  "targetUserId": "uuid",
  "profile": "sync_own",
  "platform": "android",
  "deviceName": "张三的平板"
}
```

成功响应：

```json
{
  "success": true,
  "data": {
    "deviceId": "uuid",
    "deviceToken": "returned-once",
    "profile": "sync_own",
    "permissions": {
      "canAutoUpload": true,
      "canManualUpload": true,
      "canAutoReceive": true,
      "canManualDownload": false,
      "canManageSpace": false,
      "canCreateInvite": false,
      "autoUploadScope": "screenshot_only",
      "autoReceiveScope": "same_user_only"
    },
    "user": {
      "id": "member-uuid",
      "ownerUserId": "owner-uuid",
      "role": "child",
      "displayName": "张三"
    }
  }
}
```

### 6.4 新增 `GET /api/v1/devices/me`

鉴权：仅设备 token。用户 JWT 调用返回 401 `DEVICE_AUTH_REQUIRED`。

返回当前设备、所属成员和实时权限：

```json
{
  "success": true,
  "data": {
    "device": {
      "id": "uuid",
      "name": "张三的平板",
      "platform": "android",
      "appVersion": "0.5.0",
      "osVersion": "Android 15",
      "createdAt": "2026-06-21T12:00:00.000Z",
      "lastSeenAt": "2026-06-21T12:05:00.000Z",
      "revokedAt": null
    },
    "user": {
      "id": "member-uuid",
      "ownerUserId": "owner-uuid",
      "role": "child",
      "displayName": "张三"
    },
    "profile": "sync_own",
    "permissions": {}
  }
}
```

`profile` 由 `inferDeviceProfile()` 推断。任一字段与预设不完全匹配时返回 `custom`。

客户端调用时机：

- 注册成功后立即调用一次。
- 应用启动且已绑定时调用一次。
- 收到上传/下载 403 后刷新一次，再决定是否关闭本地任务。
- WebSocket 因 1008 关闭时刷新；若设备已撤销则进入重新绑定状态。

### 6.5 新增 `PATCH /api/v1/devices/:deviceId/profile`

用途：以原子方式设置安全用途，避免产生 `canAutoReceive=true + autoReceiveScope=disabled`。

请求：

```json
{
  "profile": "receive_own"
}
```

鉴权：

- owner JWT：当前空间任意设备。
- child JWT：仅 `device.userId == request.user.userId`。
- canManageSpace 设备：当前空间任意设备。
- 普通设备 token：禁止，避免设备 token 自行扩大服务端能力。

限制：

- 已撤销、已软删除设备返回 404。
- 只更新 profile 映射的六个运行时字段。
- 不修改三个高危/独立字段：`canManualDownload`、`canManageSpace`、`canCreateInvite`。
- 审计 action：`device.profile_updated`。

### 6.6 调整设备改名、撤销和删除

以下现有接口增加 child JWT 自管规则：

- `PATCH /devices/:deviceId`
- `POST /devices/:deviceId/revoke`
- `DELETE /devices/:deviceId`

授权矩阵：

| 身份 | 自己名下设备 | 其他成员设备 |
|---|---:|---:|
| owner JWT | 允许 | 允许 |
| child JWT | 允许 | 404 |
| canManageSpace 设备 | 允许 | 允许 |
| 普通设备 token | 禁止 | 禁止 |

对 child 返回其他成员设备时必须使用 404，而不是 403，避免枚举设备存在性。

删除仍要求先撤销。历史图片和审计记录保持不变。

### 6.7 限制高危权限授予

调整 `PATCH /devices/:deviceId/permissions`：

- owner JWT 可以修改所有字段。
- canManageSpace 设备只能修改运行时字段：
  - `canAutoUpload`
  - `canManualUpload`
  - `canAutoReceive`
  - `canManualDownload`
  - `autoUploadScope`
  - `autoReceiveScope`
- canManageSpace 设备不能修改：
  - `canManageSpace`
  - `canCreateInvite`
- child JWT 不能调用原始权限接口，只能调用 profile 和 receive-config 接口。

如果非 owner 请求体包含高危字段，整个请求返回 403，不得静默忽略部分字段。

错误码：`OWNER_AUTH_REQUIRED_FOR_PRIVILEGED_PERMISSION`。

至少补充以下测试：

- canManageSpace 设备不能给另一设备开启 `canManageSpace`。
- canManageSpace 设备不能给自己开启 `canCreateInvite`。
- owner JWT 仍可修改。

### 6.8 新增 `PUT /api/v1/devices/:deviceId/receive-config`

推荐本期完成。用途是原子配置接收模式和来源规则。

请求示例：

```json
{
  "mode": "selected_devices",
  "sourceDeviceIds": ["uuid-a", "uuid-b"]
}
```

合法 mode：

- `disabled`
- `same_user_only`
- `selected_devices`
- `all_authorized_sources`

规则：

- `disabled`：设置 `canAutoReceive=false`、scope disabled，删除目标设备的来源规则。
- `same_user_only`：设置 `canAutoReceive=true`、scope same_user_only，删除旧来源规则。
- `selected_devices`：要求至少一个 sourceDeviceId；设置 canAutoReceive true；事务内用新列表替换旧规则。
- `all_authorized_sources`：设置 canAutoReceive true；仅 owner JWT 或 canManageSpace 设备允许。

child JWT：

- 只能配置自己的目标设备。
- 只能使用 disabled、same_user_only、selected_devices。
- selected_devices 中所有来源设备也必须属于该 child。
- 任何跨成员 sourceDeviceId 返回 404。

owner / canManageSpace：

- 可以为当前空间目标设备选择同空间任意来源设备。
- 来源和目标都必须 `deletedAt=null`、`revokedAt=null`。

事务顺序：

1. 验证目标和全部来源。
2. 更新 DevicePermission。
3. 删除目标设备旧规则。
4. 批量创建新规则。
5. 写审计日志。

不要让客户端分别调用 scope PATCH 和多次 rule PUT，否则中途失败会留下半配置状态。

### 6.9 调整图片列表权限

调整 `GET /api/v1/images`：

- owner JWT：查看当前空间全部图片。
- canManageSpace 设备：查看当前空间全部图片。
- child JWT：只查看 `uploadUserId=request.user.userId`。
- 普通设备 token：仍禁止列图库。

新增 owner 可用查询参数：

```text
userId=<uuid>
```

规则：

- owner / canManageSpace 可以筛选同空间成员。
- child 传任何 userId 都强制使用自身 userId；建议如果不是自身直接 403，避免误解。
- 现有时间、过期和分页过滤保持。

### 6.10 调整图片下载权限

调整 `GET /api/v1/images/:imageId/download`：

1. owner JWT / canManageSpace：当前空间任意有效图片。
2. child JWT：仅 `image.uploadUserId == request.user.userId`。
3. 设备 token 有合法 delivery：允许。
4. 设备 token 无 delivery：只有 `canManualDownload=true` 且 `image.uploadUserId == device.userId` 才允许。
5. 其他情况 404，不返回 403，避免暴露其他成员图片是否存在。

这是一个有意的权限收紧：旧语义下 `canManualDownload` 可以跨成员下载已知 image ID；0.5.x 起不再允许。

### 6.11 调整图片删除权限

调整 `DELETE /api/v1/images/:imageId`：

- owner JWT / canManageSpace：当前空间任意图片。
- child JWT：仅自己的图片。
- 设备 token：禁止。
- child 删除其他成员图片返回 404。

现有软删除、delivery 过期和物理文件清理行为保持。

## 7. 推荐的后端代码结构

不要继续在每个路由中复制复杂角色判断。新增：

```text
backend/src/services/device-profiles.ts
backend/src/services/authorization.ts
```

### 7.1 `device-profiles.ts`

导出：

```ts
export type DeviceProfile = ...;
export const selectableDeviceProfileSchema = ...;
export function permissionsForProfile(profile: SelectableDeviceProfile): RuntimePermissionPatch;
export function inferDeviceProfile(permission: DevicePermission): DeviceProfile;
```

要求：

- `permissionsForProfile` 返回新对象，不修改传入对象。
- 用 `satisfies` 或明确类型保证字段完整。
- 单元测试覆盖每个 profile 和 custom 推断。

### 7.2 `authorization.ts`

建议导出小函数，而不是一个万能 context：

```ts
requireAnyAuth(request)
requireUserAuth(request)
requireDeviceAuth(request)
isOwnerUser(request)
canManageSpace(request)
canManageDevice(request, device)
canManageOwnDevice(request, device)
canReadImage(request, image, deliveryExists)
```

函数必须返回明确布尔值或抛 `AppError`，不得返回含糊的字符串 role。

租户资源查找仍应先按 `ownerUserId` 查询，不能先用全局 id 查询再在内存判断。

## 8. Android 实现规格

### 8.1 数据模型

修改 `ApiModels.kt`：

- `RegisterDeviceResponse` 增加 `user` 和 `profile`。
- 新增 `BindCodePreview`。
- 新增 `DeviceSelfInfo`。
- `DevicePermissions` 保持字段兼容。
- 新增 `DeviceProfile` 枚举或 sealed class，序列化值与后端一致。

### 8.2 API Client

修改 `StudyShotApiClient.kt`，新增：

```kotlin
suspend fun previewBindCode(serverBaseUrl: String, bindCode: String): BindCodePreview
suspend fun getDeviceMe(serverBaseUrl: String, deviceToken: String): DeviceSelfInfo
suspend fun updateDeviceProfile(serverBaseUrl: String, accessToken: String, deviceId: String, profile: String)
suspend fun updateReceiveConfig(...)
```

`createBindCode` 增加可选 `userId`。不传时保持当前用户。

`registerDevice` 增加 profile。

### 8.3 本地绑定状态

修改 `SecureSettings.kt`，持久化非敏感绑定信息：

- `boundUserId`
- `boundOwnerUserId`
- `boundUserDisplayName`
- `boundUserRole`
- `lastKnownDeviceProfile`
- `lastKnownPermissionsJson` 或逐字段值
- `permissionsFetchedAt`

设备 token 继续用现有加密方式保存。用户 JWT 不应因为绑定而长期保存。

旧配置迁移：字段缺失时允许为空；应用启动后通过 `/devices/me` 补齐。

### 8.4 绑定 UI

`BindScreen` 改成两个入口：

1. “使用账号绑定我的设备”。
2. “使用绑定码”。

账号绑定内部流程：

1. 调 `/auth/login`。
2. 调 `/bind-codes`，不传 userId，因此后端锁定登录用户。
3. 调 preview，显示目标成员。
4. 用户选择设备用途。
5. 调 register。
6. 保存 device token、用户摘要和权限。
7. 丢弃临时 JWT。

绑定码流程：

1. 输入服务器和 code。
2. 点击“下一步”先 preview。
3. 显示“将加入：空间名称”“设备属于：成员名称”。
4. 选择用途。
5. 明确点击“确认绑定”后 register。

禁止输入 code 后直接注册。

### 8.5 首页和设置

首页增加：

```text
当前身份：张三（成员）
设备用途：我的设备双向同步
服务端权限：已同步 / 同步失败
```

当本地开关与服务端权限冲突：

- 服务端禁止自动上传：停止 observer/worker，并显示“管理员已关闭自动上传”。
- 服务端禁止自动接收：停止期待投递，但可以保留 WebSocket 心跳。
- 接收 scope disabled：本地“自动接收”开关显示不可用原因。

### 8.6 管理 UI 角色隔离

owner：

- 查看全部设备。
- 选择成员生成绑定码。
- 修改 profile 和高级权限。
- 配置跨成员接收。

child：

- 只看自己的设备。
- 生成“添加我的设备”绑定码。
- 改名、撤销自己的设备。
- 修改安全 profile 和自己的来源设备。
- 不显示用户管理、全空间图片、canManageSpace 开关。

不要显示一个点击后必然 403 的控件。

## 9. Electron 桌面端实现规格

### 9.1 类型和配置

修改 `shared.ts`：

- `RegisterDeviceInput` 增加 profile。
- `CreateBindCodeInput` 增加可选 userId。
- 新增 BindCodePreview、BoundUserInfo、DeviceSelfInfo。
- RendererSettings 增加绑定用户摘要和服务端有效权限。

修改 `config-store.ts`：

- 保存 bound user 摘要和 lastKnownPermissions。
- 旧配置缺失字段时自动兼容。
- 不持久化绑定过程中使用的用户 JWT。

### 9.2 RelayClient

新增方法：

```ts
previewBindCode(...)
getDeviceMe()
bindWithLogin(...)
refreshEffectivePermissions()
updateDeviceProfile(...)
updateReceiveConfig(...)
```

`bindWithLogin` 必须完整执行 login → self bind code → preview → register，JWT 仅存在于方法局部变量。

连接和 watcher 启动前先检查 lastKnownPermissions；服务端 403 后强制刷新一次，仍禁止则停止对应功能并更新 UI。

### 9.3 Renderer

- 绑定页提供账号绑定和绑定码两种方式。
- code 绑定必须先 preview。
- 用卡片展示四个安全 profile。
- 管理端加载 `/users`，owner 创建码时必须选择目标成员。
- child 管理会话只展示自己的设备操作。
- `selected_devices` 选择后必须出现来源设备复选框。
- `all_authorized_sources` 显示红色跨成员隐私警告和确认对话框。

## 10. Linux CLI/Web 实现规格

### 10.1 配置结构

扩展 `DeviceConfig`：

```ts
interface DeviceConfig {
  serverBaseUrl: string;
  deviceId: string;
  deviceToken: string;
  deviceName: string;
  user?: {
    id: string;
    ownerUserId: string;
    role: string;
    displayName?: string;
  };
  profile?: string;
  permissions?: DevicePermissions;
  permissionsFetchedAt?: string;
}
```

所有新字段可选，兼容旧 config.json。

### 10.2 CLI

保留原命令：

```bash
studyshot-relay bind -s <server> -c <code> -n <name>
```

改为先 preview，在终端输出目标成员，用户输入确认后注册。增加 `--profile`，默认 manual_only。

新增：

```bash
studyshot-relay bind-login -s <server> -u <login> -n <name> --profile sync_own
```

密码必须通过隐藏输入提示读取，不允许要求用户使用 `--password`，避免进入 shell history。

新增：

```bash
studyshot-relay whoami
studyshot-relay permissions
studyshot-relay refresh-permissions
```

### 10.3 Web

- 本地 Web 绑定页复用 preview 和 profile。
- 显示绑定成员和有效权限。
- 自动上传/接收开关旁显示服务端是否允许。
- 本地设置不能把服务端禁止状态伪装为已生效。

构建后必须同步 `linux-client/dist`。

## 11. 后端 Web 管理页

`backend/src/routes/web-admin.ts` 当前是内联 HTML/JS。本期不要求重构框架，但必须做到：

- child 登录后不要调用 `/users`、`/groups`、`/audit-logs` 等必然 403 的接口。
- owner 页面把 child 文案显示为“成员”。
- 生成绑定码始终显示目标成员。
- 权限主界面优先显示 profile。
- 高级权限折叠显示。
- 接收范围显示中文说明。
- `all_authorized_sources` 标记“会接收其他成员图片”。
- `selected_devices` 同屏选择来源。
- Group 在未接入权限前标记“仅组织标签，不影响图片共享”，或直接隐藏。

## 12. 审计要求

新增或调整审计 action：

```text
bind_code.previewed              可选，不建议记录原始 code
bind_code.created
device.registered
device.profile_updated
device.receive_config_updated
device.updated
device.revoked
device.deleted
image.deleted
```

审计 metadata 不得包含：

- 原始绑定码
- device token
- password
- JWT
- 本地绝对文件路径

必须包含：

- actorUserId / actorDeviceId
- targetUserId（绑定相关）
- targetDeviceId
- profile 或接收 mode
- 跨成员配置时的 sourceDeviceIds

## 13. 错误码规范

新增错误码：

| code | HTTP | 使用场景 |
|---|---:|---|
| DEVICE_AUTH_REQUIRED | 401 | `/devices/me` 使用非设备身份 |
| TARGET_USER_DISABLED | 409 | 管理者为禁用成员创建码 |
| INVALID_DEVICE_PROFILE | 400 | profile 非法或 custom 被提交 |
| OWNER_AUTH_REQUIRED_FOR_PRIVILEGED_PERMISSION | 403 | 非 owner 修改最高权限 |
| INVALID_RECEIVE_CONFIG | 400 | selected_devices 无来源等 |
| CROSS_USER_SOURCE_FORBIDDEN | 404 | child 选择其他成员来源；生产环境可统一为 NOT_FOUND |

对跨租户或跨成员资源优先返回 404，避免资源枚举。

客户端不得根据英文 message 判断逻辑，必须根据 code。

## 14. 测试规格

### 14.1 后端绑定测试

在 `bind-codes.test.ts` / `devices.test.ts` 增加：

1. child JWT 不传 userId 可以创建自己的绑定码。
2. child JWT 显式传自己 userId 可以创建。
3. child JWT 传 owner 或另一 child userId 返回 403。
4. owner 可以为任意同空间未禁用成员创建。
5. 不能为其他 owner 空间用户创建。
6. 禁用成员创建绑定码返回 409。
7. expiresInSeconds 大于 3600 返回 400。
8. preview 返回目标成员但不返回 login。
9. preview 不消耗 code。
10. preview 已使用、过期、大小写错误的 code 返回统一错误。
11. register 各 profile 映射准确。
12. 不传 profile 保持旧默认。
13. custom profile 请求被拒绝。
14. 禁用用户的旧 code 无法注册。

### 14.2 设备权限测试

1. `/devices/me` 只返回当前设备。
2. child 只能改名自己的设备。
3. child 访问其他成员设备返回 404。
4. child 可撤销并删除自己的设备。
5. child profile 更新不会修改高危字段。
6. canManageSpace 设备不能授予 canManageSpace/canCreateInvite。
7. owner 仍可授予。
8. selected_devices 配置原子替换规则。
9. child selected_devices 只能选自己的来源。
10. owner 可以配置跨成员来源。
11. disabled 同时关闭 canAutoReceive 并删除规则。

### 14.3 图片隔离测试

至少创建：owner、child A、child B，各自两个设备。

用例：

1. A 上传，A 的 same_user_only 接收设备收到。
2. A 上传，B 的 same_user_only 设备不收到。
3. A 上传，owner 的 same_user_only 设备不收到。
4. 管理员显式把 owner 设备设为 all sources 后收到 A 图片。
5. A JWT 图片列表只看到 A 图片。
6. B JWT 不能用已知 image ID 下载 A 图片，返回 404。
7. B 设备即使 canManualDownload=true 也不能下载 A 图片。
8. A 设备 canManualDownload=true 可以下载 A 图片。
9. A JWT 可以删除 A 图片。
10. A JWT 删除 B 图片返回 404。
11. owner 可以查看和删除 A/B 图片。
12. 不同 owner 空间始终隔离。

### 14.4 客户端测试

Android：

- preview 成功后才允许确认绑定。
- child 登录绑定请求不携带其他 userId。
- 旧 SecureSettings 自动补全新字段。
- 服务端关闭权限后停止相应本地任务。
- child UI 不显示最高权限控制。

Electron：

- bindWithLogin 不把 JWT 写入 ConfigStore。
- preview 信息正确渲染。
- profile 映射请求正确。
- 403 后刷新权限并停止 watcher/receiver。
- selected_devices 没有来源时不能保存。

Linux：

- 旧 config 可读取。
- bind 命令 preview 后确认。
- bind-login 密码不出现在进程参数和配置文件。
- dist 与 src 构建一致。

## 15. 端到端验收场景

### 场景 A：成员自助绑定两台设备

前置：owner 已创建成员“张三”和密码。

步骤：

1. 张三在 Android 选择账号绑定。
2. 登录后界面显示“设备属于：张三”。
3. 选择“只上传截图”。
4. 张三在电脑端再次账号绑定。
5. 界面仍显示“设备属于：张三”。
6. 选择“只接收我的图片”。
7. Android 截图。

预期：

- 图片上传用户是张三。
- 电脑收到图片。
- owner 和其他成员设备在 same_user_only 下不收到。
- 全过程不需要 owner 生成绑定码。

### 场景 B：管理员代托管成员绑定

步骤：

1. owner 在成员“李四”详情页生成绑定码。
2. 新平板输入 code。
3. preview 显示“设备属于：李四”。
4. 选择 upload_only 并确认。

预期：设备归李四，不会误绑 owner。

### 场景 C：阻止跨成员下载

步骤：A 上传图片；测试者取得 image ID；B 设备拥有 canManualDownload。

预期：B 下载返回 404；A 自己或 owner 可以下载。

### 场景 D：阻止管理权限扩散

步骤：某设备已有 canManageSpace，尝试给另一设备开启 canManageSpace。

预期：403 `OWNER_AUTH_REQUIRED_FOR_PRIVILEGED_PERMISSION`；owner JWT 可以完成相同操作。

### 场景 E：旧客户端兼容

步骤：0.4.x 客户端不传 profile，使用旧绑定流程注册。

预期：注册成功；权限保持旧默认；新客户端通过 `/devices/me` 推断 profile=custom。

## 16. 数据迁移和上线策略

本期不需要 Prisma schema migration。全部接口变化应为新增或授权收紧。

上线前增加只读审计脚本，建议路径：

```text
backend/scripts/audit-multi-user-config.ts
```

输出：

- `canAutoReceive=true` 但 scope=disabled 的设备。
- scope=selected_devices 但没有启用来源规则的设备。
- child 名下拥有 canManageSpace 的设备。
- canManualDownload=true 的 child 设备。
- 已禁用用户仍存在未过期绑定码。

默认只输出，不自动改库。增加显式 `--apply-safe-fixes` 时只允许：

- 将无来源的 selected_devices 改为 canAutoReceive=false + disabled。
- 使禁用用户未使用绑定码立即过期。

不要自动撤销 child 的 canManageSpace；只报告给 owner 人工确认。

上线顺序：

1. 部署后端兼容版本。
2. 运行只读审计脚本。
3. 发布 Android/Electron/Linux 新客户端。
4. 确认新客户端占比后，再收紧 canManualDownload 跨成员语义。
5. 更新权限和协议文档。

如果必须一次发布，至少在 RELEASES.md 明确说明 `canManualDownload` 不再允许跨成员下载。

## 17. 安全检查清单

每个 PR reviewer 必须逐项确认：

- [ ] child 不能为其他用户创建绑定码。
- [ ] preview 不泄露登录名。
- [ ] profile 不能授予高危权限或 all sources。
- [ ] register 不能给 disabled 用户注册。
- [ ] `/devices/me` 不能查询任意 deviceId。
- [ ] child 设备管理查询同时含 ownerUserId 和 userId。
- [ ] 非 owner 不能修改 canManageSpace/canCreateInvite。
- [ ] member 图片列表含 uploadUserId 过滤。
- [ ] member 下载其他成员图片返回 404。
- [ ] canManualDownload 不扩大用户可见范围。
- [ ] delivery 仍按 ownerUserId 过滤。
- [ ] selected source 的目标和来源都验证 ownerUserId。
- [ ] token/code/password 不进入日志。
- [ ] 客户端不持久化临时绑定 JWT。
- [ ] 旧客户端省略新字段仍可工作。

## 18. 文档同步要求

实现完成后必须同步：

- `docs/permissions.md`
- `docs/protocol.md`
- `docs/study-shot-relay-spec.md`
- `README.md`
- `RELEASES.md`
- Android 帮助页和字符串
- Desktop/Linux README

协议文档必须包含完整请求、响应、错误码和权限矩阵，不能只写“支持成员绑定”。

## 19. 推荐提交拆分

建议按以下提交顺序，便于回滚和 review：

1. `test: add multi-user authorization scenarios`
2. `feat: allow members to bind their own devices`
3. `feat: add device identity and safe profiles`
4. `fix: enforce member image isolation`
5. `fix: restrict privileged permission delegation`
6. `feat: add atomic receive configuration`
7. `feat(android): add member-aware binding flow`
8. `feat(desktop): add member-aware binding flow`
9. `feat(linux): add member-aware binding flow`
10. `docs: update multi-user protocol and permissions`

每个提交都应保持可构建。不要把后端授权变化和三端大规模 UI 改动压成一个不可 review 的提交。

## 20. 验证命令

后端：

```bash
cd backend
npm run build
npm run test:unit
npm test
```

后端集成测试需要 `.env.test` 指向隔离 PostgreSQL，禁止对生产数据库运行测试清理。

Android：

```bash
cd android
./gradlew :app:compileDebugKotlin
./gradlew :app:testDebugUnitTest
```

Electron：

```bash
cd desktop
npm run typecheck
npm run build
```

Linux：

```bash
cd linux-client
npm run typecheck
npm run build
```

仓库检查：

```bash
git diff --check
git status --short
```

## 21. 完成定义

只有同时满足以下条件，任务才算完成：

1. owner、child、设备 token 的新授权矩阵均有后端测试。
2. 两个 child 用户之间的上传、投递、列表、下载和删除隔离均有测试。
3. child 能通过账号在至少 Android 和 Electron 上自助绑定。
4. 所有 code 绑定在注册前显示目标成员。
5. 新设备选择 receive_own 或 sync_own 后无需管理员再修 scope 即可工作。
6. `/devices/me` 在三端落地，客户端显示真实服务端权限。
7. canManageSpace 设备不能扩散最高权限。
8. selected_devices 不再存在“选了但没有来源”的静默失败 UI。
9. 旧客户端不传新字段仍可注册和运行。
10. 协议、权限、README 和发布说明全部同步。
11. 所有可运行测试通过；无法运行的测试必须给出明确环境原因，不得假报通过。

## 22. 后续版本路线

0.5.x 完成后，再单独设计以下内容，不要混入本期：

- 标准化 `Space` / `Membership` 模型。
- 一个账号加入多个空间。
- Group 成为真实分享策略。
- 有期限、不可转授的委派管理员。
- 托管成员、密码重置、成员归档和删除。
- 设备转移/重新认领流程。
- 图片级或相册级共享。

这些功能需要新的数据模型和迁移计划，应另建开发规格。
