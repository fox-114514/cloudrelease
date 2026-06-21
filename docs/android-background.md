# Android Background Upload Design

文档版本：2026-06-21

本文定义安卓端自动上传的后台策略。目标是低延迟上传截图，同时尽量不影响手写笔记体验。

## 1. 目标

安卓端必须做到：

- 默认只监听截图，不监听完整相册。
- 截图新增后尽快上传，正常网络下目标延迟 1 到 5 秒。
- 不持续扫描整个相册。
- 不因为重复 MediaStore 通知重复上传同一张图。
- 网络失败后可靠重试。
- 实时学习模式可以使用前台服务和常驻通知。
- 自动下载目录不能再次触发自动上传。

安卓端不做：

- 不做完整相册备份。
- 不默认申请 `MANAGE_EXTERNAL_STORAGE`。
- 不依赖厂商云服务或厂商推送。
- 不把 GPT 页面嵌入 WebView。

## 2. 推荐技术栈

- Kotlin
- Jetpack Compose
- OkHttp：HTTP、multipart、WebSocket
- WorkManager：可靠上传队列和失败重试
- Room：本地状态、去重哈希、上传队列、设置
- ContentResolver + MediaStore：读取图片元数据和文件流
- ContentObserver：实时监听媒体库变化
- Foreground Service：实时学习模式下保持上传监听
- Jetpack Security：保存设备 token

## 3. 权限策略

### Android 13+

使用：

- `READ_MEDIA_IMAGES`
- `POST_NOTIFICATIONS`，仅当前台服务通知需要展示时申请

注意：

- Android 14+ 存在“部分照片访问”。如果用户只授权部分照片，自动监听截图可能不完整。
- App 必须检测权限状态，并在 UI 显示“权限不足，可能漏传截图”。

### Android 12 及以下

使用：

- `READ_EXTERNAL_STORAGE`

### 不默认使用

- `MANAGE_EXTERNAL_STORAGE`

只有在用户明确知道风险，并且普通图片权限无法满足设备系统限制时，才考虑增加该权限路径。MVP 不要求实现。

## 4. 本地数据模型建议

Room 至少包含以下表或等价结构。

### `app_settings`

- `serverBaseUrl`
- `deviceId`
- `deviceTokenStored`
- `autoUploadEnabled`
- `autoUploadScope`
- `selectedAlbumUri`
- `foregroundModeEnabled`
- `wifiOnly`
- `meteredNetworkAllowed`

### `media_seen`

用途：避免重复处理 MediaStore 事件。

- `mediaIdHash`
- `uri`
- `sha256`
- `fileSize`
- `lastModified`
- `firstSeenAt`
- `uploadedImageId`
- `status`：`seen`、`queued`、`uploaded`、`deduplicated`、`skipped`、`failed`

### `upload_queue`

- `id`
- `uri`
- `sourceKind`
- `sourceDisplayName`
- `sourceMediaIdHash`
- `sha256`
- `fileSize`
- `attemptCount`
- `nextAttemptAt`
- `status`
- `lastError`

### `received_hashes`

用途：防止服务端下载图片被重新上传。

- `sha256`
- `originImageId`
- `receivedAt`

## 5. 截图识别

默认范围：`screenshot_only`。

优先判断：

- MediaStore `RELATIVE_PATH` 包含 `Pictures/Screenshots`
- MediaStore `RELATIVE_PATH` 包含 `DCIM/Screenshots`
- 厂商截图目录，例如 `Pictures/ScreenShot`、`Pictures/截图`

辅助判断：

- `DISPLAY_NAME` 包含 `Screenshot`
- `DISPLAY_NAME` 包含 `截屏` 或 `截图`
- `DATE_ADDED` 或 `DATE_TAKEN` 接近当前时间

禁止：

- 只靠文件名判断截图。
- 默认把所有新增图片都上传。

实现建议：

- 维护一份可配置的截图目录匹配列表。
- UI 允许用户查看当前识别到的截图目录。
- 如果某个设备截图目录特殊，允许用户手动选择 `selected_album`。
- `selected_album` 可以配置多个排除目录；命中排除目录或其后代的图片必须跳过。

## 6. ContentObserver 策略

监听 URI：

- `MediaStore.Images.Media.EXTERNAL_CONTENT_URI`

处理流程：

1. ContentObserver 收到变化通知。
2. 将同一次媒体写入产生的密集回调合并；当前实现使用 150 ms 防抖。
3. 不读取全相册，只查询最近一小段时间新增或修改的图片。
4. 查询条件建议基于 `DATE_ADDED`、`DATE_MODIFIED`、`RELATIVE_PATH`。
5. 对候选图片执行监听范围和排除目录过滤。
6. 写入 `media_seen`，已存在则跳过。
7. 实时模式的前台服务每秒主动扫描一次最近媒体，避免 ColorOS 等系统在后台延迟派发 ContentObserver 回调。
8. 图片可见后入 `upload_queue`；实时模式由前台服务立即上传，WorkManager 作为进程退出和网络失败后的兜底。

文件稳定判断：

- 连续两次读取 `SIZE` 一致。
- 能成功打开输入流。
- MIME 是图片类型。
- 文件大小大于 0。

不要做：

- 每次通知都扫描整个图片库。
- 在 ContentObserver 回调里直接上传大文件。
- 在主线程计算 sha256。
- 为同一个 MediaStore URI 重复创建任务或重写已完成任务。

## 7. 实时上传与 WorkManager 兜底策略

实时学习模式不能只依赖 WorkManager 启动上传。应用进入后台后，WorkManager 可能把任务交给系统 JobScheduler 批处理，即使监听已及时发现图片，也会产生不可预测的十秒级延迟。

当前策略：

- 前台服务监听到图片并写入本地队列后，直接在服务的 IO 协程中执行上传。
- ContentObserver 与每秒主动扫描并行工作；事件回调及时则立即处理，回调被厂商节流时主动扫描保证发现延迟有上界。
- 直传前先创建延迟 30 秒的 WorkManager 兜底任务，避免进程在上传中被终止后丢失任务。
- 直传成功或遇到不可重试错误后取消兜底任务。
- 断网、服务端临时错误等可重试情况保留兜底任务并按指数退避。
- “仅 Wi-Fi 上传”开启时，直传同样检查当前网络类型，不绕过用户设置。

非实时模式以及手动上传继续使用 WorkManager。

每个待上传图片创建唯一工作：

- unique name：`upload:<mediaIdHash>` 或 `upload:<sha256>`
- ExistingWorkPolicy：`KEEP`

约束：

- 默认需要网络连接。
- 如果用户开启“仅 Wi-Fi 上传”，添加 unmetered network 约束。
- 不要求充电。

重试：

- 网络错误：重试，指数退避。
- `5xx`：重试，指数退避。
- `429`：按退避重试。
- `401`：停止自动上传，提示重新绑定。
- `403`：停止该类上传，提示权限不足。
- `400 HASH_MISMATCH`：重新计算 sha256 后最多再试一次。
- `400 LOOP_RISK`：标记 skipped。
- `200 deduplicated = true`：标记 deduplicated。

上传成功：

- 记录 `uploadedImageId`。
- 记录服务端返回的 `expiresAt`。
- 将 sha256 加入本地已上传缓存，减少重复工作。

## 8. 前台服务策略

实时学习模式建议使用前台服务：

- 用户手动开启“实时学习模式”。
- 显示常驻通知，说明正在监听截图上传。
- 通知提供暂停按钮。
- 服务类型建议使用 data sync 相关类型。

前台服务职责：

- 保持 ContentObserver 注册。
- 在独立 IO 协程中执行直传，不阻塞 ContentObserver 的主线程回调。
- 正常网络下由前台服务直接上传，WorkManager 负责可靠兜底。

关闭条件：

- 用户关闭实时学习模式。
- 设备 token 失效。
- 自动上传权限被撤销。
- 用户退出绑定。

耗电边界：

- 非实时模式不做高频轮询；实时模式仅查询最近数秒的 MediaStore 记录，不扫描完整相册。
- 不持有长时间 CPU wake lock。
- 不在无新媒体事件时扫描相册。
- 上传结束后释放资源。

## 9. 手动上传与分享菜单

MVP 应支持手动上传入口：

- App 内选择图片上传。
- Android 分享菜单分享到 StudyShot Relay。

手动上传使用：

- `sourceKind = manual_share`
- 检查服务端 `canManualUpload`

手动上传不受 `autoUploadScope` 限制，但仍受文件大小、MIME、sha256 校验和服务端鉴权限制。

## 10. 防循环实现

安卓端必须实现本地防循环。

自动下载目录：

- 默认使用 App 私有目录。
- 不写入系统相册。
- 如果必须写入公共目录，目录下创建 `.nomedia`。

上传前检查：

1. 计算 sha256。
2. 查询 `received_hashes`。
3. 如果命中，跳过自动上传。
4. 如果图片元数据包含服务端来源标记，上传时设置 `originImageId`；当前服务端会拒绝。

目录排除：

- 自动上传监听不得包含 App 下载目录。
- `selected_album` 也不能选择 App 下载目录。
- 用户可反选已监听目录下的子文件夹；排除规则递归覆盖所有后代目录。

## 11. WebSocket 接收在安卓端的定位

安卓端可以实现 WebSocket 接收，但 MVP 的关键是上传。

如果安卓端开启自动接收：

- 使用设备 token 连接 `/api/v1/ws`。
- 收到事件后下载到 App 私有目录。
- 写入 `received_hashes`。
- ACK delivery。

如果安卓端只负责上传：

- 不需要长期保持 WebSocket。
- 可以只在设置页或管理页短连接获取状态。

## 12. 设置页最低要求

安卓 App 至少提供：

- 服务器地址。
- 当前绑定状态。
- 当前设备名。
- 当前权限摘要。
- 自动上传开关。
- 自动上传范围。
- 监听目录和排除子目录列表。
- 实时学习模式开关。
- 最近一次上传状态。
- 最近错误。
- 重新绑定或解绑入口。

不要用大段说明文字堆页面。设置项旁只保留必要状态和错误。

## 13. 错误提示规范

用户可理解的错误：

- 服务器不可达。
- 设备未绑定或绑定已失效。
- 没有自动上传权限。
- 没有图片读取权限。
- 当前是部分照片权限，可能无法自动监听截图。
- 文件太大。
- 图片校验失败。

日志可记录：

- HTTP 状态码。
- 服务端错误 code。
- deliveryId、imageId、mediaIdHash。
- 重试次数。

日志禁止记录：

- 设备 token。
- 用户密码。
- 原始绑定码。
- 完整图片内容。
- 不必要的完整文件路径。

## 14. 手工验收清单

安卓端任务完成后至少手工验证：

- 授权完整图片权限后，新截图能自动入队。
- 平板截图后，后端收到上传请求。
- 没有 `canAutoUpload` 权限时，自动上传停止并提示。
- 同一张截图触发多次 MediaStore 通知时，只上传一次。
- 选择监听目录并排除一个子目录后，根目录和其他子目录可上传，被排除目录及其后代不会上传。
- 开启实时模式后在前台滚动和切换页面无持续装饰动画造成的掉帧。
- 断网截图后，恢复网络能自动补传。
- App 关闭设置页后，实时学习模式仍能监听。
- 关闭实时学习模式后，不再后台监听。
- 下载目录或已接收图片不会被自动上传。
- 撤销设备后，上传返回 401/403，客户端停止自动任务。
