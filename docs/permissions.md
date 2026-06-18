# StudyShot Relay Permissions

文档版本：2026-06-18

本文定义 StudyShot Relay 的权限边界。后端、安卓端、桌面端和后续编码 agent 必须共同遵守这些规则。

## 1. 核心原则

- 权限执行单位是设备，不是用户。
- 所有数据必须通过 `ownerUserId` 隔离主用户空间。
- owner 用户可以管理自己的空间，但 owner 名下的设备不会自动拥有管理权。
- child 用户默认不能管理空间。
- 被撤销设备不能上传、下载、接收 WebSocket 事件或调用设备接口。
- 用户被禁用后，该用户的所有设备应视为不可用。
- 客户端 UI 可以隐藏无权限功能，但真正的权限判断必须在服务端完成。

## 2. 身份类型

### Owner 用户 token

来源：`POST /api/v1/auth/login`

能力：

- 创建设备绑定码。
- 管理同一 owner 空间内用户、用户组、设备和权限。
- 查看审计日志。
- 不用于自动上传、自动下载、WebSocket 接收。

限制：

- 不能跨 owner 空间访问任何资源。
- 不应长期保存在自动运行后台进程里。

### Child 用户 token

来源：`POST /api/v1/auth/login`

能力：

- 当前主要用于登录身份。
- 可查看自己名下设备列表。

限制：

- 不能创建空间级绑定码。
- 不能修改他人设备权限。
- 不能管理用户、用户组或审计日志。

### 设备 token

来源：`POST /api/v1/devices/register`

能力由设备权限决定：

- 自动上传。
- 手动上传。
- 自动接收。
- 手动下载。
- 管理空间。
- 创建邀请。

限制：

- 即使设备属于 owner 用户，也不能自动获得管理能力。
- 必须显式开启 `canManageSpace` 后才可以管理空间。
- 设备 token 一旦泄露，应撤销该设备并重新绑定。

## 3. 设备权限字段

### `canAutoUpload`

允许设备自动上传监听到的图片。

典型开启对象：

- 安卓平板，开启截图监听。
- 安卓手机，用户明确希望后台监听截图时。

服务端要求：

- `sourceKind != manual_share` 的上传必须检查此权限。

客户端要求：

- 没有该权限时，不要启动自动上传监听。
- 权限被服务端关闭后，应停止自动上传任务。

### `canManualUpload`

允许设备通过手动选择或分享菜单上传图片。

典型开启对象：

- 大多数已绑定设备可以开启。

服务端要求：

- `sourceKind = manual_share` 的上传必须检查此权限。

客户端要求：

- 没有该权限时，隐藏或禁用手动上传入口。

### `canAutoReceive`

允许服务器为该设备生成自动投递。

典型开启对象：

- Ubuntu/Windows 桌面客户端。
- 需要自动接收的手机。

服务端要求：

- 生成 delivery 前必须检查此权限。

客户端要求：

- 没有该权限时，可以保持 WebSocket 连接用于状态，但不应期望收到图片事件。

### `canManualDownload`

允许设备手动下载历史图片。

典型开启对象：

- 管理端设备。
- 需要查看历史记录的设备。

服务端要求：

- 没有 delivery 的图片下载，必须要求此权限。
- 有合法 delivery 的自动下载，不需要此权限。

客户端要求：

- 历史图片页面必须根据此权限控制入口。

### `canManageSpace`

允许设备管理当前 owner 空间。

能力包括：

- 查看空间内所有设备。
- 修改设备权限。
- 撤销设备。
- 管理用户、用户组和审计日志。
- 为任意同空间用户创建设备绑定码。

典型开启对象：

- 用户信任的主力电脑。

风险：

- 该权限等价于高危管理权限。不要默认开启。
- 安卓平板或手机如果只是上传截图，不应开启。

### `canCreateInvite`

允许设备创建绑定码。

边界：

- 如果没有 `canManageSpace`，只能给该设备所属用户创建绑定码。
- 不能给其他用户创建绑定码。

典型用途：

- 已绑定的个人设备帮同一用户绑定另一台设备。

## 4. 自动上传范围

字段：`autoUploadScope`

合法值：

- `screenshot_only`
- `selected_album`
- `manual_share_only`
- `all_images`

### `screenshot_only`

默认值。只自动上传系统截图目录或可识别截图来源。

客户端判断建议：

- Android MediaStore `RELATIVE_PATH` 包含 `Pictures/Screenshots`、`DCIM/Screenshots` 或厂商截图目录。
- 文件名包含常见截图前缀只能作为辅助，不要单独依赖。
- 用户可以在设置中确认具体目录。

### `selected_album`

只监听用户显式选择的相册或目录。

客户端要求：

- 用户必须明确选择来源。
- UI 必须显示当前选择的来源。
- 变更来源后，本地监听规则要立即更新或提示重启服务。

### `manual_share_only`

不做后台监听，只允许用户主动分享或手动选择上传。

客户端要求：

- 不注册相册 ContentObserver。
- 不启动自动上传后台任务。

### `all_images`

监听全部新增图片。不推荐。

客户端要求：

- 必须二次确认。
- 必须明确提示隐私风险和误传风险。
- 不应作为默认选项。

## 5. 自动接收范围

字段：`autoReceiveScope`

合法值：

- `disabled`
- `all_authorized_sources`
- `same_user_only`
- `selected_devices`

### `disabled`

不自动接收。

服务端行为：

- 即使 `canAutoReceive = true`，也不应为该设备生成自动投递。

### `all_authorized_sources`

接收同一 owner 空间内所有授权上传设备的图片。

服务端行为：

- 排除上传设备自身。
- 排除撤销设备。
- 排除没有自动接收权限的目标设备。

### `same_user_only`

只接收同一用户名下设备上传的图片。

典型用途：

- 多个子用户共用同一服务器时，避免互相收到图片。

### `selected_devices`

只接收显式配置的来源设备。

服务端行为：

- 必须存在 `receive_source_rules` 记录。
- 规则 `enabled = true` 才允许投递。
- 没有规则时不投递。

客户端要求：

- 管理 UI 应提供来源设备选择列表。
- UI 上要明确这是自动接收来源，不是上传权限。

## 6. 投递生成规则

服务端上传成功后生成 delivery 时必须按顺序检查：

1. 目标设备与上传设备同属一个 `ownerUserId`。
2. 目标设备未撤销。
3. 目标设备用户未禁用。
4. 目标设备 ID 不等于上传设备 ID。
5. 目标设备 `canAutoReceive = true`。
6. 目标设备 `autoReceiveScope != disabled`。
7. 根据 `autoReceiveScope` 检查来源范围。

范围检查：

- `all_authorized_sources`：允许。
- `same_user_only`：`targetDevice.userId == uploadDevice.userId`。
- `selected_devices`：存在启用的 `targetDeviceId + sourceDeviceId` 规则。
- `disabled`：拒绝。

## 7. 上传权限规则

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

## 8. 下载权限规则

自动下载：

- 当前设备必须有对应 delivery。
- delivery 状态应为 `pending`、`notified` 或 `downloaded`。
- 图片未过期且未删除。

手动下载：

- 当前设备没有 delivery 时，必须有 `canManualDownload = true`。
- 仍然必须限制在同一 owner 空间。

禁止行为：

- 客户端不能根据 image ID 构造公开下载链接。
- 服务端不能返回真实磁盘路径。

## 9. 防循环规则

防循环必须服务端和客户端同时做。

服务端已经执行：

- 图片记录 `uploadDeviceId`。
- 生成 delivery 时排除上传设备自身。
- 同一 owner 空间、同一上传设备、1 小时内相同 sha256 去重。
- 上传请求带 `originImageId` 时拒绝，防止服务端下载图片被再次自动上传。

安卓客户端必须执行：

- 自动下载目录默认使用 App 私有目录，不保存到系统相册。
- 如果用户选择保存到相册，目录必须放 `.nomedia`，并把下载图片 sha256 记入本地“已接收哈希表”。
- 自动上传前计算 sha256，如果命中已接收哈希表，跳过。
- 监听目录不能包含 App 的下载目录。

桌面客户端当前要求：

- 默认不做本地目录自动上传。
- 下载目录不参与上传监听。
- 如果未来支持桌面自动上传，必须排除下载目录。

## 10. 推荐设备权限配置

### 安卓平板，只负责截图上传

```json
{
  "canAutoUpload": true,
  "canManualUpload": true,
  "canAutoReceive": false,
  "canManualDownload": false,
  "canManageSpace": false,
  "canCreateInvite": false,
  "autoUploadScope": "screenshot_only",
  "autoReceiveScope": "disabled"
}
```

### Ubuntu 电脑，自动接收并写剪贴板

```json
{
  "canAutoUpload": false,
  "canManualUpload": true,
  "canAutoReceive": true,
  "canManualDownload": false,
  "canManageSpace": true,
  "canCreateInvite": true,
  "autoUploadScope": "manual_share_only",
  "autoReceiveScope": "all_authorized_sources"
}
```

### 安卓手机，手动上传，必要时自动接收

```json
{
  "canAutoUpload": false,
  "canManualUpload": true,
  "canAutoReceive": true,
  "canManualDownload": false,
  "canManageSpace": false,
  "canCreateInvite": false,
  "autoUploadScope": "manual_share_only",
  "autoReceiveScope": "same_user_only"
}
```

## 11. Review 检查清单

后续每次改权限相关代码，必须检查：

- 查询条件是否包含 `ownerUserId`。
- 是否把 owner 用户身份和 owner 设备身份混淆。
- 管理接口是否要求 owner 用户 token 或 `canManageSpace` 设备 token。
- 自动上传是否检查 `canAutoUpload`。
- 手动上传是否检查 `canManualUpload`。
- 自动投递是否检查 `canAutoReceive` 和 `autoReceiveScope`。
- 上传设备是否被排除在投递目标之外。
- `selected_devices` 是否确实查了 `receive_source_rules`。
- 撤销设备是否立即失效。
- 禁用用户后设备是否不能继续使用。

