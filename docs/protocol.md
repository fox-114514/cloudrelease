# StudyShot Relay Protocol

文档版本：2026-06-21

本文是客户端与后端对接的协议契约。安卓 App、桌面客户端和后续编码 agent 必须以本文为准；如果代码行为变化，必须同步更新本文。

## 1. 基础约定

- HTTP API 前缀：`/api/v1`
- WebSocket 路径：`/api/v1/ws`
- HTTP 鉴权头：`Authorization: Bearer <token>`
- 图片下载必须走鉴权 HTTP 接口，不存在公开图片 URL。
- 用户登录 token 与设备 token 是两类 token：
  - 用户登录 token：由 `/auth/login` 返回，是 JWT，用于创建绑定码、管理用户和设备。
  - 设备 token：由 `/devices/register` 返回，是随机 token，用于上传、下载、WebSocket、ACK。
- 客户端不得把 token 写入普通日志、崩溃日志或 UI 截图。
- 时间字段使用 ISO 8601 字符串。
- ID 当前为 UUID 字符串。

## 2. 通用响应格式

成功响应：

```json
{
  "success": true,
  "data": {}
}
```

错误响应：

```json
{
  "success": false,
  "error": {
    "code": "FORBIDDEN",
    "message": "Human readable message",
    "details": {}
  }
}
```

客户端处理原则：

- `401`：token 缺失、无效、设备撤销或用户禁用。客户端应停止当前自动任务，并提示重新绑定或重新登录。
- `403`：身份有效但权限不足。客户端应保留配置，显示权限不足，不要反复重试同一操作。
- `400`：请求格式或业务参数错误。客户端应修正请求，不要无限重试。
- `404`：目标不存在、跨空间访问、跨成员资源访问或图片过期。下载场景可将投递标记为失败或跳过。
- `409`：资源冲突，例如登录名已存在、目标成员已禁用、删除未撤销设备。
- `429`：限速。客户端应退避后重试。
- `5xx`：服务端错误。客户端应指数退避重试。

客户端应**始终根据 `error.code` 判断逻辑**，不要根据英文 `message` 拼接。新增或更新的错误码：

| code | HTTP | 场景 |
|---|---:|---|
| `UNAUTHORIZED` | 401 | 缺失身份；包括 bind-codes 无 token |
| `DEVICE_AUTH_REQUIRED` | 401 | `/devices/me` 使用非设备身份 |
| `FORBIDDEN` | 403 | 身份有效但权限不足 |
| `TARGET_USER_DISABLED` | 409 | 为禁用成员创建绑定码 |
| `INVALID_DEVICE_PROFILE` | 400 | profile 非法或提交了 `custom` |
| `OWNER_AUTH_REQUIRED_FOR_PRIVILEGED_PERMISSION` | 403 | 非 owner 试图授予 `canManageSpace` / `canCreateInvite` |
| `INVALID_RECEIVE_CONFIG` | 400 | `selected_devices` 无来源等 |
| `CROSS_USER_SOURCE_FORBIDDEN` | 404 | child 用户选择了其他成员来源；生产环境建议统一返回 `NOT_FOUND` |

## 3. 健康检查

### `GET /api/v1/healthz`

用途：检查后端是否存活。

鉴权：不需要。

成功响应：

```json
{
  "success": true,
  "data": {
    "status": "ok"
  }
}
```

## 4. 登录

### `POST /api/v1/auth/login`

用途：主用户或子用户登录，获取用户级访问 token。

鉴权：不需要。

请求：

```json
{
  "login": "owner",
  "password": "password"
}
```

成功响应：

```json
{
  "success": true,
  "data": {
    "accessToken": "<user-jwt>",
    "user": {
      "id": "uuid",
      "ownerUserId": "uuid",
      "role": "owner",
      "displayName": "Owner",
      "emailOrLogin": "owner"
    }
  }
}
```

客户端要求：

- 桌面端和安卓端只有在需要管理空间、创建绑定码、配置权限时才需要用户登录。
- 普通自动上传/自动接收使用设备 token，不使用用户 token。

## 5. 绑定码

### `POST /api/v1/bind-codes`

用途：创建一次性绑定码。当前后端已实现 `bind_device` 和 `invite_child_user` 两种 purpose，但 `/devices/register` 只接受 `bind_device`。

鉴权矩阵（V2）：

| 调用身份 | 不传 `userId` | 传自己的 `userId` | 传其他成员 `userId` |
|---|---:|---:|---:|
| owner 用户 token | 目标为 owner | 允许 | 允许（必须同空间、未禁用） |
| child 用户 token | 目标为自己 | 允许 | **403** |
| `canCreateInvite` 设备 token | 目标为设备所属用户 | 允许 | **403** |
| `canManageSpace` 设备 token | 目标为设备所属用户 | 允许 | 允许（必须同空间、未禁用） |
| 无身份 | **401** `UNAUTHORIZED` | **401** | **401** |

请求：

```json
{
  "purpose": "bind_device",
  "userId": "optional-target-user-id",
  "deviceNameHint": "Ubuntu laptop",
  "expiresInSeconds": 600
}
```

约束：

- `expiresInSeconds` 必须为正整数且 `≤ 3600`，默认 `600`。
- `purpose` 当前仅消费 `bind_device`，`invite_child_user` 暂时只是占位枚举，注册时被拒。

成功响应：

```json
{
  "success": true,
  "data": {
    "bindCode": "<raw-code-shown-once>",
    "expiresAt": "2026-06-18T01:00:00.000Z",
    "targetUser": {
      "id": "uuid",
      "role": "child",
      "displayName": "张三"
    }
  }
}
```

错误响应：

- `401 UNAUTHORIZED`：无身份。
- `403 FORBIDDEN`：成员或普通邀请设备指定其他用户。
- `404 NOT_FOUND`：目标不属于当前 owner 空间。
- `409 TARGET_USER_DISABLED`：目标成员已禁用。
- `400`：参数非法（如 `expiresInSeconds > 3600`）。

审计 metadata：`{ targetUserId, targetRole, expiresInSeconds }`。**绝不**记录原始 `bindCode`。

### `POST /api/v1/bind-codes/preview`（V2 新增）

用途：注册前预览「这台设备将属于谁」。**不消费**绑定码。

鉴权：无需 token。绑定码本身即短期 bearer 受现有 rate limit 保护。

请求：

```json
{
  "bindCode": "raw-one-time-code"
}
```

校验：

- 去除首尾空白但保留大小写。
- 不存在 / 已使用 / 已过期 / `purpose != bind_device` / 目标用户已禁用，统一返回 `400 INVALID_BIND_CODE`，**不**泄露具体状态。

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
      "id": "uuid",
      "role": "child",
      "displayName": "张三"
    }
  }
}
```

客户端要求：

- 注册流程必须先调用 preview，确认目标成员后再调用 `/devices/register`。
- 不在响应中显示 `emailOrLogin`、`passwordHash` 或设备列表。

## 6. 设备注册

### `POST /api/v1/devices/register`

用途：新设备使用绑定码注册，获取设备 ID 和设备 token。

鉴权：不需要（绑定码本身是短期 bearer）。

请求：

```json
{
  "bindCode": "<raw-code>",
  "deviceName": "OnePlus Pad",
  "platform": "android",
  "osVersion": "14",
  "appVersion": "0.1.0",
  "clientGeneratedDeviceId": "optional-uuid",
  "profile": "sync_own"
}
```

字段约束：

- `platform` 只能是 `android`、`windows`、`linux`。
- `clientGeneratedDeviceId` 可选；如果传入，必须是 UUID。
- `profile`（V2 新增）可选：`manual_only` / `upload_only` / `receive_own` / `sync_own`。
  - owner 目标不传时保持旧默认；child 目标不传时默认 `receive_own`（`autoReceiveScope=same_user_only`）。
  - 提交 `custom` 返回 `400 INVALID_DEVICE_PROFILE`。
  - profile 不授予管理类权限。child 新设备默认 `canManualUpload=true`、`canManualDownload=true`；owner 新设备的 `canManualDownload` 默认仍为 `false`。
- 目标用户 `disabledAt` 必须为 `null`，否则返回 `400 INVALID_BIND_CODE`。

成功响应：

```json
{
  "success": true,
  "data": {
    "deviceId": "uuid",
    "deviceToken": "<raw-device-token-shown-once>",
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
      "id": "uuid",
      "ownerUserId": "uuid",
      "role": "child",
      "displayName": "张三"
    }
  }
}
```

客户端要求：

- `deviceToken` 只在注册响应出现一次，必须立刻保存到安全存储。
- 推荐立即调用 `GET /devices/me` 确认服务端真实权限与本地保存一致。
- 如果响应成功但本地保存 token 失败，客户端必须提示用户重新绑定，不能继续进入半绑定状态。
- 同一事务内完成「绑定码消费 + 设备创建 + 权限创建 + 审计日志」。

## 7. 设备列表与权限

### `GET /api/v1/devices`

用途：列出当前空间内设备。

鉴权：

- owner 用户 token：可列出空间内所有设备。
- `canManageSpace` 设备 token：可列出空间内所有设备。
- child 用户 token：只能列出自己的设备。
- 普通设备 token：禁止调用。

成功响应节选：

```json
{
  "success": true,
  "data": {
    "devices": [
      {
        "id": "uuid",
        "ownerUserId": "uuid",
        "userId": "uuid",
        "userDisplayName": "张三",
        "userRole": "child",
        "name": "张三的平板",
        "platform": "android",
        "appVersion": "0.5.0",
        "osVersion": "Android 15",
        "lastSeenAt": "2026-06-18T01:00:00.000Z",
        "createdAt": "2026-06-18T00:00:00.000Z",
        "revokedAt": null,
        "profile": "sync_own",
        "receiveSourceDeviceIds": [],
        "permissions": {
          "canAutoUpload": true,
          "canManualUpload": true,
          "canAutoReceive": true,
          "canManualDownload": false,
          "canManageSpace": false,
          "canCreateInvite": false,
          "autoUploadScope": "screenshot_only",
          "autoReceiveScope": "same_user_only"
        }
      }
    ]
  }
}
```

### `GET /api/v1/devices/me`（V2 新增）

用途：让当前设备查看自己的真实归属与服务端权限。

鉴权：**仅设备 token**。用户 JWT 调用返回 `401 DEVICE_AUTH_REQUIRED`。

成功响应：

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
      "id": "uuid",
      "ownerUserId": "uuid",
      "role": "child",
      "displayName": "张三"
    },
    "profile": "sync_own",
    "permissions": {}
  }
}
```

`profile` 由服务端推断；任一字段与预设不完全匹配时为 `custom`。

客户端调用时机：

- 注册成功后立即调用一次。
- 应用启动且已绑定时调用一次。
- 收到上传/下载 403 后刷新一次，再决定是否关闭本地任务。
- WebSocket 因 1008 关闭时刷新一次；若设备已撤销则进入重新绑定状态。

### `PATCH /api/v1/devices/{deviceId}/profile`（V2 新增）

用途：以原子方式设置设备用途预设，避免产生 `canAutoReceive=true + autoReceiveScope=disabled` 等无效组合。

鉴权：

- owner 用户 token：当前空间任意设备。
- child 用户 token：仅 `device.userId == request.user.userId`。
- `canManageSpace` 设备 token：当前空间任意设备。
- 普通设备 token：**禁止**。

请求：

```json
{
  "profile": "receive_own"
}
```

`profile` 仅允许 `manual_only` / `upload_only` / `receive_own` / `sync_own`，提交 `custom` 返回 `400 INVALID_DEVICE_PROFILE`。

行为：

- 只更新 6 个运行时字段；**不**修改 `canManualDownload` / `canManageSpace` / `canCreateInvite`。
- 审计 action：`device.profile_updated`，metadata：`{ profile }`。

### `PATCH /api/v1/devices/{deviceId}/permissions`

用途：修改设备权限。**V2 起收紧** — 仅 owner JWT 可授予特权字段。

鉴权：

- owner 用户 token：可修改所有字段。
- `canManageSpace` 设备 token：仅可修改 6 个运行时字段；提交 `canManageSpace` / `canCreateInvite` 返回 `403 OWNER_AUTH_REQUIRED_FOR_PRIVILEGED_PERMISSION`。
- child 用户 token：仅可修改本人设备的 `canManualUpload` / `canManualDownload`；自动权限使用 profile / receive-config，其他字段返回 `403 CHILD_PERMISSION_FIELD_FORBIDDEN`。
- 普通设备 token：禁止调用，返回 `403`。

请求字段均可选（运行时 6 字段 + 特权 3 字段）：

```json
{
  "canAutoUpload": true,
  "canManualUpload": true,
  "canAutoReceive": true,
  "canManualDownload": true,
  "canManageSpace": false,
  "canCreateInvite": false,
  "autoUploadScope": "screenshot_only",
  "autoReceiveScope": "all_authorized_sources"
}
```

合法枚举：

- `autoUploadScope`：`screenshot_only`、`selected_album`、`manual_share_only`、`all_images`
- `autoReceiveScope`：`disabled`、`all_authorized_sources`、`same_user_only`、`selected_devices`

### `PATCH /api/v1/devices/{deviceId}`

用途：修改设备基础信息（设备名）。

鉴权（V2）：

- owner 用户 token：任意设备。
- child 用户 token：**仅自己名下**设备；其他成员设备返回 `404`。
- `canManageSpace` 设备 token：当前空间任意设备。
- 普通设备 token：返回 `403`。

请求：

```json
{
  "name": "Ubuntu laptop"
}
```

成功响应：

```json
{
  "success": true,
  "data": {
    "device": {
      "id": "uuid",
      "name": "Ubuntu laptop"
    }
  }
}
```

### `POST /api/v1/devices/{deviceId}/revoke`

用途：撤销设备。撤销后设备 token 失效，WebSocket 连接会被关闭。

鉴权矩阵同上：owner / canManageSpace 任意设备；child 仅自己设备；其他成员返回 `404`；普通设备 token 返回 `403`。

成功响应：

```json
{
  "success": true,
  "data": {
    "revokedAt": "2026-06-18T01:00:00.000Z"
  }
}
```

### `DELETE /api/v1/devices/{deviceId}`

用途：从设备管理列表删除一个已经撤销的设备。

鉴权矩阵同上。

约束：

- 必须先撤销设备；删除仍有效的设备返回 `409 DEVICE_NOT_REVOKED`。
- 服务端采用软删除，保留历史图片、投递和审计关系。
- 删除后设备不再出现在 `GET /devices`，设备 token 继续保持无效。

成功响应：

```json
{
  "success": true,
  "data": {
    "deletedAt": "2026-06-21T01:00:00.000Z"
  }
}
```

## 8. 接收配置

### `PUT /api/v1/devices/{deviceId}/receive-config`（V2 推荐）

用途：原子化地修改接收模式与来源规则，避免出现 `canAutoReceive=true + autoReceiveScope=disabled` 半配置状态。

鉴权：

- owner JWT / canManageSpace 设备：当前空间任意设备。
- child JWT：仅自己设备，且只能使用 `disabled` / `same_user_only` / `selected_devices`。

请求：

```json
{
  "mode": "selected_devices",
  "sourceDeviceIds": ["uuid-a", "uuid-b"]
}
```

合法 mode 与对应副作用：

| mode | 运行时副作用 | 来源规则 |
|---|---|---|
| `disabled` | `canAutoReceive=false`、`autoReceiveScope=disabled` | 删除全部旧规则 |
| `same_user_only` | `canAutoReceive=true`、`autoReceiveScope=same_user_only` | 删除旧规则 |
| `selected_devices` | `canAutoReceive=true`、`autoReceiveScope=selected_devices` | 事务内替换为 `sourceDeviceIds`（必须至少 1 项） |
| `all_authorized_sources` | `canAutoReceive=true`、`autoReceiveScope=all_authorized_sources` | 删除旧规则；**仅** owner / canManageSpace 可调用 |

child 用户调用 `selected_devices` 时，所有 `sourceDeviceIds` 必须属于自己；传入跨成员来源返回 `404`。

错误：

- `400 INVALID_RECEIVE_CONFIG`：`selected_devices` 缺少来源。
- `404 NOT_FOUND`：目标或来源设备不属于当前空间。
- `403 FORBIDDEN`：child 选择 `all_authorized_sources`。
- `404 CROSS_USER_SOURCE_FORBIDDEN`：child 选择了其他成员来源。

### `GET /api/v1/devices/{deviceId}/receive-sources`

这些旧的细粒度接口保留兼容，但在新代码里**优先**使用上面的 `receive-config`。

鉴权：owner 用户 token、`canManageSpace` 设备 token，或 child 用户 token 查询自己名下的目标设备；child 查询其他成员设备返回 `404`。

成功响应：

```json
{
  "success": true,
  "data": {
    "rules": [
      {
        "targetDeviceId": "receiver-device-id",
        "sourceDeviceId": "uploader-device-id",
        "sourceDeviceName": "OnePlus Pad",
        "enabled": true,
        "createdAt": "2026-06-18T01:00:00.000Z"
      }
    ]
  }
}
```

### `PUT /api/v1/devices/{deviceId}/receive-sources/{sourceDeviceId}`

请求：

```json
{
  "enabled": true
}
```

约束：

- `deviceId` 不能等于 `sourceDeviceId`。
- 两台设备必须属于同一 owner 空间。

### `DELETE /api/v1/devices/{deviceId}/receive-sources/{sourceDeviceId}`

成功响应：

```json
{
  "success": true,
  "data": {
    "removed": true
  }
}
```

## 9. 图片上传

### `POST /api/v1/images`

用途：上传图片并生成投递。

鉴权：设备 token。

Content-Type：`multipart/form-data`

文件字段：

- `file`：图片文件。

表单字段：

- `sha256`：必填，客户端计算的文件 sha256，64 位十六进制。
- `sourceKind`：可选，`screenshot`、`manual_share`、`selected_album`、`unknown`，默认 `unknown`。
- `sourceDisplayName`：可选，来源显示名，例如 `Screenshots`。
- `sourceMediaIdHash`：可选，安卓 MediaStore ID 的本地 hash，不要上传裸 ID。
- `capturedAt`：可选，ISO 8601 字符串；当前后端只校验格式，未持久化。
- `originImageId`：可选，UUID。自动上传时如果图片来自服务端下载，应传该字段；当前后端会拒绝，避免循环。

权限规则：

- `sourceKind = manual_share` 需要 `canManualUpload = true`。
- 其他 `sourceKind` 需要 `canAutoUpload = true`。
- 设备撤销或用户禁用后不能上传。

成功响应：

```json
{
  "success": true,
  "data": {
    "imageId": "uuid",
    "deduplicated": false,
    "createdDeliveriesCount": 1,
    "expiresAt": "2026-07-18T01:00:00.000Z"
  }
}
```

去重响应：

```json
{
  "success": true,
  "data": {
    "imageId": "existing-image-id",
    "deduplicated": true,
    "createdDeliveriesCount": 0,
    "expiresAt": "2026-07-18T01:00:00.000Z"
  }
}
```

客户端要求：

- 自动上传前必须计算 sha256。
- 同一 MediaStore 事件可能重复触发，客户端本地也要去重。
- 遇到 `deduplicated = true` 不应提示错误。
- 非手动上传不要把 `sourceKind` 填成 `manual_share` 来绕过自动上传权限。

## 10. Pending Deliveries

### `GET /api/v1/deliveries/pending`

用途：客户端启动或 WebSocket 重连后查询未完成投递。

鉴权：设备 token。

返回范围：

- 只返回当前设备的 `pending` 或 `notified` 投递。
- 不返回过期图片。
- 不返回跨 owner 空间图片。
- 当前最多返回 100 条，按创建时间升序。

成功响应：

```json
{
  "success": true,
  "data": {
    "totalPending": 135,
    "hasMore": true,
    "deliveries": [
      {
        "deliveryId": "uuid",
        "image": {
          "id": "uuid",
          "mimeType": "image/png",
          "fileSize": 102400,
          "width": 1920,
          "height": 1080,
          "sha256": "64-hex"
        },
        "source": {
          "uploadUserId": "uuid",
          "uploadDeviceId": "uuid",
          "uploadDeviceName": "OnePlus Pad"
        },
        "createdAt": "2026-06-18T01:00:00.000Z",
        "expiresAt": "2026-07-18T01:00:00.000Z"
      }
    ]
  }
}
```

客户端要求：

- WebSocket 连接成功或重连成功后调用一次，只展示离线投递确认，不自动下载。
- 用户选择“接收”后按批处理；`hasMore = true` 或处理后仍有 pending 时继续拉取。
- 用户选择“忽略”时，对当前离线投递 ACK `skipped`。
- 本地要记录正在处理和已处理的 `deliveryId`，避免重复下载。
- 对同一个 delivery 重复收到 WebSocket 事件和 pending 响应时，只处理一次。

## 11. 图片下载

### `GET /api/v1/images/{imageId}/download`

用途：下载图片二进制。

鉴权：设备 token、owner 用户 token，或 `canManageSpace` 设备 token。

授权条件：

- 当前设备存在该图片的投递，且投递状态是 `pending`、`notified` 或 `downloaded`；或
- 当前设备有 `canManualDownload = true`；或
- 调用方是 owner 用户，或具备 `canManageSpace` 的设备（管理身份可访问空间内任意图片）。

响应：

- `Content-Type`：图片 MIME，例如 `image/png`
- `Content-Length`：文件大小
- Body：图片二进制流

客户端要求：

- 下载后自行计算 sha256，与事件或 pending 元数据比较。
- sha256 不一致时不要 ACK `downloaded`，应 ACK `failed` 或本地重试后再 ACK。
- 下载失败不应崩溃，应保留投递状态等待重试。
- 管理后台通过该接口配合 `Authorization: Bearer <user-jwt>` 实现图片预览。

### `GET /api/v1/images`（管理列表）

用途：列出当前身份可见的图片，用于图库和手动下载。

鉴权（V2）：

- owner 用户 token：查看全空间；可按成员筛选。
- `canManageSpace` 设备 token：同上。
- child 用户 token：仅 `uploadUserId == request.user.userId`；`userId` 给他人返回 `403`。
- `canManualDownload=true` 的普通设备 token：仅查看 `uploadUserId == device.userId` 的图片。
- 其他普通设备 token：禁止。

请求参数（query）：

- `limit`：单页条数，默认 `50`，最大 `100`。
- `before`：以 ISO 8601 时间分页，返回 `createdAt < before` 的记录。
- `filter`：可选 `all` / `active` / `expired` / `today` / `week` / `month`。
- `userId`（V2 新增）：owner / canManageSpace 可按成员筛选；child 忽略或 403。

成功响应：

```json
{
  "success": true,
  "data": {
    "images": [
      {
        "id": "uuid",
        "mimeType": "image/png",
        "fileSize": 102400,
        "width": 1920,
        "height": 1080,
        "sha256": "64-hex",
        "sourceKind": "screenshot",
        "sourceDisplayName": "Screenshots",
        "uploadedBy": {
          "userId": "uuid",
          "userDisplayName": "张三",
          "deviceId": "uuid",
          "deviceName": "张三的平板"
        },
        "createdAt": "2026-06-18T01:00:00.000Z",
        "expiresAt": "2026-07-18T01:00:00.000Z",
        "isExpired": false
      }
    ],
    "nextCursor": "2026-06-17T22:00:00.000Z"
  }
}
```

`nextCursor` 为 `null` 表示没有更多记录。

注意：

- 所有 `filter` 都默认排除已删除（`deletedAt` 不为空）的图片。已删除的图片无法预览（`GET /download` 也会拒绝它们），再删除也会 404。如果需要查看删除历史，请查询 `audit-logs`（`action = "image.deleted"`）。
- 服务端按 `createdAt DESC` 返回。

### `GET /api/v1/images/{imageId}/download`

鉴权与授权条件（V2）：

- owner JWT / canManageSpace：当前空间任意有效图片。
- child JWT：仅 `image.uploadUserId == request.user.userId`。
- 设备 token 拥有合法 delivery：允许。
- 设备 token 无 delivery：只有 `canManualDownload=true` **且** `image.uploadUserId == device.userId` 才允许。
- 其他情况一律 `404`，**不**返回 `403`，避免泄露其他成员图片是否存在。

响应：

- `Content-Type`：图片 MIME，例如 `image/png`
- `Content-Length`：文件大小
- Body：图片二进制流

客户端要求：

- 下载后自行计算 sha256，与事件或 pending 元数据比较。
- sha256 不一致时不要 ACK `downloaded`，应 ACK `failed` 或本地重试后再 ACK。
- 下载失败不应崩溃，应保留投递状态等待重试。
- 管理后台通过该接口配合 `Authorization: Bearer <user-jwt>` 实现图片预览。

### `DELETE /api/v1/images/{imageId}`（管理删除）

用途：删除一张图片及磁盘文件。

鉴权（V2）：

- owner JWT / canManageSpace：当前空间任意图片。
- child JWT：仅自己的图片；他人图片返回 `404`。
- 普通设备 token：**禁止**，返回 `403`。

行为：

- 把 `images.deletedAt` 标记为当前时间。
- 把该图片所有 `pending` / `notified` 投递置为 `expired`（不再向目标设备投递）。
- 尝试 unlink 磁盘上的存储文件；失败仅记录日志，不影响接口成功。
- 写入 `audit_logs` 记录 `image.deleted`。

成功响应：

```json
{
  "success": true,
  "data": {
    "imageId": "uuid",
    "deletedAt": "2026-06-18T01:00:00.000Z"
  }
}
```

错误情况：

- `404`：图片不存在、属于其他 owner 空间、被删除，或 child 删除他人图片。
- `403`：设备 token 删除。

## 12. 投递 ACK

### `POST /api/v1/deliveries/{deliveryId}/ack`

用途：客户端处理投递后回报状态。

鉴权：设备 token。只能 ACK 当前设备自己的 delivery。

请求：

```json
{
  "status": "downloaded",
  "errorMessage": "optional failure reason",
  "localPathHint": "optional local path hint"
}
```

合法状态：

- `downloaded`
- `failed`
- `skipped`

当前后端会保存 `status` 和 `errorMessage`；`localPathHint` 目前只作为客户端兼容字段，不持久化。

成功响应：

```json
{
  "success": true,
  "data": {
    "deliveryId": "uuid",
    "status": "downloaded"
  }
}
```

客户端要求：

- 文件保存成功并校验 sha256 后才 ACK `downloaded`。
- 用户暂停自动接收、来源不想接收、文件已过期等可 ACK `skipped`。
- 网络错误时优先本地重试，不要过早 ACK `failed`。

## 13. 用户和用户组管理

这些接口用于管理页面，不是自动上传/接收主链路。

鉴权：owner 用户 token 或 `canManageSpace` 设备 token。

### `GET /api/v1/users`

返回当前 owner 空间内所有用户。

### `POST /api/v1/users`

创建 child 用户。

请求：

```json
{
  "login": "child-login",
  "password": "at-least-8-chars",
  "displayName": "Child"
}
```

### `PATCH /api/v1/users/{userId}`

更新显示名或禁用状态。

请求：

```json
{
  "displayName": "New name",
  "disabled": false
}
```

### `GET /api/v1/groups`

返回当前 owner 空间内所有用户组。

### `POST /api/v1/groups`

创建用户组。

请求：

```json
{
  "name": "My devices"
}
```

### `POST /api/v1/groups/{groupId}/members`

添加组成员。

请求：

```json
{
  "userId": "uuid"
}
```

### `DELETE /api/v1/groups/{groupId}/members/{userId}`

移除组成员。

### `GET /api/v1/audit-logs?limit=50`

返回审计日志。`limit` 最大 100。

鉴权：owner 用户 token 或 `canManageSpace` 设备 token。child JWT / 普通设备 token 返回 `403`。

### 审计 metadata 要求

记录在 `metadataJson` 中：

- 不得包含：原始绑定码、device token、password、JWT、本地绝对文件路径。
- 必须包含：`actorUserId` / `actorDeviceId`，绑定相关包含 `targetUserId`，设备相关包含 `targetDeviceId`，profile 或接收 `mode`，跨成员配置时的 `sourceDeviceIds`。

V2 涉及的关键 action：

| action | 触发 |
|---|---|
| `bind_code.created` | `POST /bind-codes` 成功 |
| `bind_code.previewed` | （可选）记录 `POST /bind-codes/preview` 调用，但**不**记录原始 code |
| `device.registered` | `POST /devices/register` 成功 |
| `device.profile_updated` | `PATCH /devices/:id/profile` |
| `device.receive_config_updated` | `PUT /devices/:id/receive-config` |
| `device.permissions_updated` | `PATCH /devices/:id/permissions` |
| `device.updated` | 设备改名 |
| `device.revoked` | `POST /devices/:id/revoke` |
| `device.deleted` | `DELETE /devices/:id` 软删除 |
| `image.deleted` | `DELETE /images/:id` |
| `image.uploaded` | `POST /images` 成功 |
| `image.upload_deduplicated` | 同 sha256 一小时内去重命中 |
| `user.created` / `user.updated` | 用户管理 |

## 14. WebSocket

### 连接

URL：

```text
wss://<host>/api/v1/ws
```

开发环境可以使用：

```text
ws://localhost:3000/api/v1/ws
```

鉴权：

```http
Authorization: Bearer <device-token>
```

约束：

- 只能使用设备 token。
- 使用用户 JWT 会被关闭。
- 同一设备建立新连接时，旧连接会被关闭。
- 设备撤销后，服务端会关闭连接。

### 客户端消息

连接成功后发送：

```json
{
  "type": "hello"
}
```

服务端响应：

```json
{
  "type": "hello.ack",
  "serverTime": "2026-06-18T01:00:00.000Z"
}
```

客户端心跳：

```json
{
  "type": "ping"
}
```

服务端响应：

```json
{
  "type": "pong"
}
```

客户端心跳建议：

- 每 25 到 30 秒发送一次 `ping`。
- 90 秒内未收到服务端响应或 socket 关闭时，进入重连。
- 重连使用指数退避，最大 60 秒。
- 每次连接成功后调用 `GET /deliveries/pending`，有积压时由用户确认接收或忽略。

### 服务端图片事件

```json
{
  "type": "image.created",
  "eventId": "delivery-id-timestamp",
  "deliveryId": "uuid",
  "image": {
    "id": "uuid",
    "mimeType": "image/png",
    "fileSize": 102400,
    "width": 1920,
    "height": 1080,
    "sha256": "64-hex"
  },
  "source": {
    "uploadUserId": "uuid",
    "uploadDeviceId": "uuid",
    "uploadDeviceName": "OnePlus Pad"
  },
  "createdAt": "2026-06-18T01:00:00.000Z",
  "expiresAt": "2026-07-18T01:00:00.000Z"
}
```

客户端处理：

- 以 `deliveryId` 作为幂等键。
- 不要从事件拼公开 URL，应调用 `/images/{imageId}/download`。
- 下载成功后调用 ACK。
- WebSocket 消息丢失不影响最终一致性，pending 接口负责补偿。

## 15. 桌面客户端最小接收流程

1. 用户输入服务器地址和绑定码。
2. 调用 `/devices/register`，保存 `deviceId` 与 `deviceToken`。
3. 建立 WebSocket。
4. 发送 `hello`，等待 `hello.ack`。
5. 调用 `/deliveries/pending`，如有离线积压则弹窗询问用户。
6. 用户确认后处理 pending；在线收到的 `image.created` 仍自动处理，并按 `deliveryId` 去重。
7. 调用 `/images/{imageId}/download` 下载图片。
8. 保存到本地下载目录。
9. 计算 sha256，与元数据比较。
10. 可选写入系统剪贴板。
11. 调用 `/deliveries/{deliveryId}/ack`。

## 16. 安卓客户端最小上传流程

1. 用户输入服务器地址和绑定码。
2. 调用 `/devices/register`，保存 `deviceId` 与 `deviceToken`。
3. 用户授予图片读取权限。
4. App 开启截图监听。
5. MediaStore 通知新图片后，判断是否在截图目录或用户选择目录。
6. 等待文件写入稳定。
7. 计算 sha256，查本地去重表。
8. 以 `sourceKind = screenshot` 调用 `/images`。
9. 上传成功后记录本地上传状态。
10. 遇到网络失败时交给 WorkManager 重试。
