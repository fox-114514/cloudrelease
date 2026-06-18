# StudyShot Relay Protocol

文档版本：2026-06-18

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
- `404`：目标不存在、跨空间访问或图片过期。下载场景可将投递标记为失败或跳过。
- `409`：资源冲突，例如登录名已存在。
- `429`：限速。客户端应退避后重试。
- `5xx`：服务端错误。客户端应指数退避重试。

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

鉴权：

- owner 用户 token 可以创建。
- 有 `canCreateInvite` 或 `canManageSpace` 的设备 token 可以创建。
- 只有 owner 用户或 `canManageSpace` 设备可以给其他用户创建设备绑定码。
- 只有 `canCreateInvite` 的设备只能给自身用户创建绑定码。

请求：

```json
{
  "purpose": "bind_device",
  "userId": "optional-target-user-id",
  "deviceNameHint": "Ubuntu laptop",
  "expiresInSeconds": 600
}
```

成功响应：

```json
{
  "success": true,
  "data": {
    "bindCode": "<raw-code-shown-once>",
    "expiresAt": "2026-06-18T01:00:00.000Z"
  }
}
```

客户端要求：

- `bindCode` 只显示一次，服务端不再明文保存。
- 默认有效期使用 600 秒。
- 绑定码过期或使用失败后，客户端应引导用户重新创建绑定码。

## 6. 设备注册

### `POST /api/v1/devices/register`

用途：新设备使用绑定码注册，获取设备 ID 和设备 token。

鉴权：不需要。

请求：

```json
{
  "bindCode": "<raw-code>",
  "deviceName": "OnePlus Pad",
  "platform": "android",
  "osVersion": "14",
  "appVersion": "0.1.0",
  "clientGeneratedDeviceId": "optional-uuid"
}
```

字段约束：

- `platform` 只能是 `android`、`windows`、`linux`。
- `clientGeneratedDeviceId` 可选；如果传入，必须是 UUID。

成功响应：

```json
{
  "success": true,
  "data": {
    "deviceId": "uuid",
    "deviceToken": "<raw-device-token-shown-once>",
    "permissions": {
      "canAutoUpload": false,
      "canManualUpload": true,
      "canAutoReceive": false,
      "canManualDownload": false,
      "canManageSpace": false,
      "canCreateInvite": false,
      "autoUploadScope": "screenshot_only",
      "autoReceiveScope": "disabled"
    },
    "user": {
      "id": "uuid",
      "ownerUserId": "uuid",
      "role": "owner",
      "displayName": "Owner"
    }
  }
}
```

客户端要求：

- `deviceToken` 只在注册响应出现一次，必须立刻保存到安全存储。
- 新设备默认权限很小。自动上传、自动接收需要后续由管理端开启。
- 如果响应成功但本地保存 token 失败，客户端必须提示用户重新绑定，不能继续进入半绑定状态。

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
        "userDisplayName": "Owner",
        "name": "Ubuntu laptop",
        "platform": "linux",
        "appVersion": "0.1.0",
        "osVersion": "Ubuntu 24.04",
        "lastSeenAt": "2026-06-18T01:00:00.000Z",
        "createdAt": "2026-06-18T00:00:00.000Z",
        "revokedAt": null,
        "permissions": {
          "deviceId": "uuid",
          "canAutoUpload": false,
          "canManualUpload": true,
          "canAutoReceive": true,
          "canManualDownload": false,
          "canManageSpace": false,
          "canCreateInvite": false,
          "autoUploadScope": "screenshot_only",
          "autoReceiveScope": "all_authorized_sources",
          "createdAt": "2026-06-18T00:00:00.000Z",
          "updatedAt": "2026-06-18T00:00:00.000Z"
        }
      }
    ]
  }
}
```

### `PATCH /api/v1/devices/{deviceId}/permissions`

用途：修改设备权限。

鉴权：owner 用户 token 或 `canManageSpace` 设备 token。

请求字段均可选：

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

用途：修改设备基础信息。当前支持设备名。

鉴权：owner 用户 token 或 `canManageSpace` 设备 token。

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

鉴权：owner 用户 token 或 `canManageSpace` 设备 token。

成功响应：

```json
{
  "success": true,
  "data": {
    "revokedAt": "2026-06-18T01:00:00.000Z"
  }
}
```

## 8. 接收来源规则

这些接口只在目标设备 `autoReceiveScope = selected_devices` 时影响自动投递。

### `GET /api/v1/devices/{deviceId}/receive-sources`

鉴权：owner 用户 token 或 `canManageSpace` 设备 token。

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

用途：创建或更新一条来源允许规则。

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

用途：删除一条来源规则。

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

用途：客户端启动或 WebSocket 重连后补收未完成投递。

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

- 启动后立即调用一次。
- WebSocket 连接成功或重连成功后调用一次。
- 本地要记录正在处理和已处理的 `deliveryId`，避免重复下载。
- 对同一个 delivery 重复收到 WebSocket 事件和 pending 响应时，只处理一次。

## 11. 图片下载

### `GET /api/v1/images/{imageId}/download`

用途：下载图片二进制。

鉴权：设备 token。

授权条件：

- 当前设备存在该图片的投递，且投递状态是 `pending`、`notified` 或 `downloaded`；或
- 当前设备有 `canManualDownload = true`。

响应：

- `Content-Type`：图片 MIME，例如 `image/png`
- `Content-Length`：文件大小
- Body：图片二进制流

客户端要求：

- 下载后自行计算 sha256，与事件或 pending 元数据比较。
- sha256 不一致时不要 ACK `downloaded`，应 ACK `failed` 或本地重试后再 ACK。
- 下载失败不应崩溃，应保留投递状态等待重试。

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
- 每次连接成功后调用 `GET /deliveries/pending`。

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
5. 调用 `/deliveries/pending`。
6. 收到 `image.created` 或 pending 记录后，按 `deliveryId` 去重。
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
