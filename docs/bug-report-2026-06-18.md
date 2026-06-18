# StudyShot Relay Bug 报告

文档版本：2026-06-18  
范围：Android App、后端、桌面客户端  
用途：记录当前代码审查发现的 bug、风险及修改建议，并在修复后更新状态。

## 状态说明

- `open`：未修复
- `fixed`：已修复
- `wontfix`：暂不修复（如 MVP 范围外或风险可接受）
- `verified`：已修复并验证

---

## 一、Android App

### A1. 绑定流程未捕获异常，点击绑定后闪退
- **优先级**：高
- **状态**：fixed
- **文件/行号**：`android/app/src/main/java/com/studyshot/relay/MainActivity.kt:265-267`
- **问题描述**：`scope.launch { message = bindDevice(...) }` 没有 try/catch。网络失败、URL 非法、服务端返回非 JSON、`EncryptedSharedPreferences` 写入失败等任何异常都会直接传递到未处理异常处理器，导致 App 闪退。
- **修改建议**：
  1. 在 `scope.launch` 内用 try/catch 包裹 `bindDevice()` 调用。
  2. 在 `bindDevice()` 内前置校验服务器地址和绑定码。
  3. 在 `StudyShotApiClient.executeJson()` 内处理非 JSON 响应。
  4. 给 `SecureSettings` 增加 `EncryptedSharedPreferences` 初始化失败的降级。

### A2. Android 9 (API 26-28) MediaStore 查询崩溃
- **优先级**：高
- **状态**：fixed
- **文件/行号**：`android/app/src/main/java/com/studyshot/relay/upload/MediaStoreScanner.kt:24, 40-42`
- **问题描述**：查询中使用了 `MediaStore.Images.Media.RELATIVE_PATH`，该列是 API 29+ 才加入。在 Android 9 及以下调用 `getColumnIndexOrThrow` 会抛 `IllegalArgumentException`，导致前台服务和省电扫描直接崩溃。
- **修改建议**：
  1. 仅当 `Build.VERSION.SDK_INT >= 29` 时才在 projection 中加入 `RELATIVE_PATH`。
  2. API < 29 时用 `MediaStore.Images.Media.DATA` 推导路径。
  3. 截图识别分支也要做相应的版本判断。

### A3. 已上传 hash 表写了但没用，无法防止同图重复上传
- **优先级**：高
- **状态**：fixed
- **文件/行号**：`android/app/src/main/java/com/studyshot/relay/upload/UploadWorker.kt:46-58, 85-91`
- **问题描述**：`UploadWorker` 只检查 `received_hashes`，不检查 `uploaded_hashes`。`uploaded_hashes` 只在成功后写入，却没有任何地方读取。同一截图出现两次时仍会再次上传（虽然服务端去重，但浪费流量和电量）。
- **修改建议**：
  1. 上传前 `if (dao.hasUploadedHash(sha256))` 则跳过并更新任务状态为 skipped/deduplicated。
  2. 将命中结果通知到 UI。

### A4. 上传失败无限重试，无上限
- **优先级**：高
- **状态**：fixed
- **文件/行号**：`android/app/src/main/java/com/studyshot/relay/upload/UploadWorker.kt:19, 93-118`
- **问题描述**：非 `ApiException` 异常（IO、JSONException、URI 异常等）一律 `Result.retry()`，且不读取 `runAttemptCount` 做上限。WorkManager 会指数退避后反复重试，耗电耗流量。
- **修改建议**：
  1. 根据 `runAttemptCount` 设上限（如 5 次），超过后返回 `Result.failure()`。
  2. 不可恢复错误（4xx、不支持格式、文件不存在）直接返回 `Result.failure()`。

### A5. 不支持的图片格式导致无限重试
- **优先级**：高
- **状态**：fixed
- **文件/行号**：`android/app/src/main/java/com/studyshot/relay/upload/UploadWorker.kt:60-62, 106-118`
- **问题描述**：`detectImageMimeType()` 只支持 PNG/JPEG/WEBP，HEIF/HEIC/BMP 等会 fallback 到 `contentResolver.getType()`，若仍返回 null 则抛 `IllegalArgumentException`，被当成普通异常无限 retry。
- **修改建议**：
  1. 明确不支持时返回 `Result.failure()` 并记录原因。
  2. 或扩展 MIME 检测支持 HEIF/HEIC/BMP。

### A6. WebSocket 接收服务状态多线程无同步
- **优先级**：高
- **状态**：fixed
- **文件/行号**：`android/app/src/main/java/com/studyshot/relay/RelayReceiveService.kt:36-41, 85-122, 298-310`
- **问题描述**：`socket`、`heartbeatJob`、`reconnectJob`、`reconnectDelayMs`、`lastMessageAt` 在 OkHttp 回调线程、`scope.launch`、UI/Service 主线程间无同步，存在可见性和竞态问题，可能导致重复 socket、空指针或状态错乱。
- **修改建议**：
  1. 使用 `@Volatile` + `AtomicReference` 或 `Mutex` 保护共享状态。
  2. `connect()` 加锁，确保旧 socket 关闭后再创建新 socket。
  3. 用 `WeakReference` 或在回调入口加 `isDestroyed` 标记，防止 Service 销毁后回调仍访问 Service。

### A7. EncryptedSharedPreferences 初始化失败导致启动崩溃
- **优先级**：高
- **状态**：fixed
- **文件/行号**：`android/app/src/main/java/com/studyshot/relay/data/SecureSettings.kt:24-36`
- **问题描述**：某些设备（一加/ColorOS、Android 10 生物识别 KeyStore 问题、系统更新后）创建 `EncryptedSharedPreferences` 会抛 `KeyStoreException`/`InvalidProtocolBufferException`，导致应用启动即崩溃。且使用的是 alpha 版 `security-crypto:1.1.0-alpha06`。
- **修改建议**：
  1. try/catch 初始化失败时降级到普通 `SharedPreferences`。
  2. 记录 warning 日志。
  3. 考虑降级到稳定版 `security-crypto:1.0.0`。

### A8. 截图识别规则过于简单，误报/漏报严重
- **优先级**：高
- **状态**：fixed
- **文件/行号**：`android/app/src/main/java/com/studyshot/relay/upload/MediaStoreScanner.kt:60-70`
- **问题描述**：仅通过路径/文件名是否包含 `screenshot`、`截图`、`截屏` 判断。任何含这些词的非截图都会被上传；某些 OEM 保存在 `Screen captures`、`Captures` 或被重命名的截图会漏掉。
- **修改建议**：
  1. 结合 `RELATIVE_PATH` 桶名白名单、最近时间窗、宽高比、文件大小等多维度判断。
  2. 允许用户配置截图目录。
  3. 增加常见 OEM 截图路径（如 `Pictures/Screenshots`、`DCIM/Screenshots`、`Screen captures`、`Captures`）。

### A9. ContentObserver 监听回调忽略 selfChange
- **优先级**：中
- **状态**：open
- **文件/行号**：`android/app/src/main/java/com/studyshot/relay/ScreenshotObserverService.kt:58`
- **问题描述**：`onChange(selfChange: Boolean)` 没有判断 `selfChange`，本 App 保存到相册的操作也会触发 `scanRecent()`。且只重写了单参数版本，无法拿到变更 URI。
- **修改建议**：
  1. 重写 `onChange(selfChange, uri)`。
  2. `selfChange` 为 true 时直接返回。
  3. 尽量按 URI 过滤。

### A10. 监听延迟过短，可能读到半写入图片
- **优先级**：中
- **状态**：open
- **文件/行号**：`android/app/src/main/java/com/studyshot/relay/ScreenshotObserverService.kt:76`
- **问题描述**：截图写入是一个过程，900ms 延迟对大图/慢卡仍可能读到不完整文件。
- **修改建议**：
  1. 增大延迟到 2-3 秒。
  2. 或在 Worker 内做完整性校验（能否 decode）。

### A11. 扫描窗口回退 5 秒，造成重复候选
- **优先级**：中
- **状态**：open
- **文件/行号**：`android/app/src/main/java/com/studyshot/relay/ScreenshotObserverService.kt:78`
- **问题描述**：`since = lastScanAtSeconds - 5` 导致前后两次扫描重叠 5 秒，若 URI 变化（如云同步后 media id 变化）会重复入队。
- **修改建议**：
  1. 持久化上次扫描到的最大 `DATE_ADDED` / media id。
  2. 入队前按 sha256 去重。

### A12. lastScanAtSeconds 未持久化，服务重启后大范围重扫
- **优先级**：中
- **状态**：open
- **文件/行号**：`android/app/src/main/java/com/studyshot/relay/ScreenshotObserverService.kt:24, 78-79`
- **问题描述**：服务被系统杀死后重启，`lastScanAtSeconds == 0`，会重新扫描最近 120 秒内的图片。
- **修改建议**：用 `DataStore`/`SharedPreferences`/数据库保存 checkpoint。

### A13. REALTIME 模式对 all_images 范围静默失效
- **优先级**：低
- **状态**：open
- **文件/行号**：`android/app/src/main/java/com/studyshot/relay/ScreenshotObserverService.kt:73`
- **问题描述**：`if (settings.autoUploadScope != "screenshot_only") return` 把实时监听写死为仅 screenshot，用户选择 all_images 后实时模式实际上不工作。
- **修改建议**：在 Scanner 中按 scope 过滤，或在此处根据 scope 放行并记录警告。

### A14. MediaStoreScanner 未按 MIME 类型过滤
- **优先级**：中
- **状态**：open
- **文件/行号**：`android/app/src/main/java/com/studyshot/relay/upload/MediaStoreScanner.kt:19-39`
- **问题描述**：selection 没有 `MIME_TYPE LIKE 'image/%'` 过滤，理论上如果 MediaStore 把非图片条目误归类，可能入队。
- **修改建议**：查询条件增加 MIME 类型过滤。

### A15. 终端错误会清空已计算的 sha256/fileSize
- **优先级**：中
- **状态**：fixed
- **文件/行号**：`android/app/src/main/java/com/studyshot/relay/upload/UploadWorker.kt:95-104`
- **问题描述**：400/401/403 或网络失败时，`updateUploadTask(..., sha256 = null, fileSize = null)` 会丢掉已经算好的 hash，导致下次重试重新读取整图。
- **修改建议**：保留已计算出的 sha256/fileSize，仅更新 status/lastError/attemptCount。

### A16. ExistingWorkPolicy.KEEP 导致 terminal-failed 任务无法重新入队
- **优先级**：中
- **状态**：open
- **文件/行号**：`android/app/src/main/java/com/studyshot/relay/upload/UploadRepository.kt:87-90`
- **问题描述**：`ExistingWorkPolicy.KEEP` 导致如果某条自动上传曾 terminal-failed，后续再 enqueue 同一 URI 不会重新调度 Worker，但 DB 里又被 `upsertUploadTask` 重置为 queued，出现“状态 queued 却永远没有 Worker”的不一致。
- **修改建议**：
  1. 入队前检查现有任务状态。
  2. terminal 状态需用户手动重试，或改用 `REPLACE`。

### A17. 省电扫描窗口 30 分钟与周期 15 分钟重叠
- **优先级**：中
- **状态**：open
- **文件/行号**：`android/app/src/main/java/com/studyshot/relay/upload/PowerSaveScanWorker.kt:27`
- **问题描述**：每 15 分钟扫描最近 30 分钟，重叠 2 倍，加上 `KEEP` 策略，可能反复唤醒并尝试入队同一批图。
- **修改建议**：扫描窗口改为略大于周期（如 17-20 分钟），或引入持久化 checkpoint。

### A18. 手动上传未做本地去重
- **优先级**：中
- **状态**：open
- **文件/行号**：`android/app/src/main/java/com/studyshot/relay/upload/UploadRepository.kt:23-46`
- **问题描述**：手动选择/分享同一张图会生成不同 taskId，重复上传。
- **修改建议**：手动入队前先算 hash 并查 `uploaded_hashes`/`received_hashes`。

### A19. 下载目录 .nomedia 重复创建
- **优先级**：低
- **状态**：fixed
- **文件/行号**：`android/app/src/main/java/com/studyshot/relay/RelayReceiveService.kt:197`
- **问题描述**：`.nomedia` 对每个文件调用 `createNewFile()`，结果未检查；逻辑上应该在目录创建时只创建一次。
- **修改建议**：在 `mkdirs()` 成功后一次性创建 `.nomedia`。

### A20. mkdirs() 结果未校验
- **优先级**：低
- **状态**：fixed
- **文件/行号**：`android/app/src/main/java/com/studyshot/relay/RelayReceiveService.kt:196`
- **问题描述**：`target.parentFile?.mkdirs()` 忽略返回值，若目录创建失败，后续 `writeBytes` 会抛异常但错误信息不直观。
- **修改建议**：校验返回值并抛出明确异常。

### A21. 保存到相册失败被静默吞掉
- **优先级**：中
- **状态**：fixed
- **文件/行号**：`android/app/src/main/java/com/studyshot/relay/RelayReceiveService.kt:209-213`
- **问题描述**：用户开启“保存到系统相册”后，`saveImageToGallery` 抛异常仅被 `runCatching` 捕获，没有日志、没有 UI/通知提示，用户以为已保存。
- **修改建议**：记录 error 日志/通知；确保 `IS_PENDING` 在异常时正确清理。

### A22. connect() 可能被并发调用导致多 socket
- **优先级**：中
- **状态**：fixed
- **文件/行号**：`android/app/src/main/java/com/studyshot/relay/RelayReceiveService.kt:77-86`
- **问题描述**：`connect()` 关闭旧 socket 后立即创建新 socket；若快速连续调用（如来回切设置），旧 socket 的回调仍可能在 running。
- **修改建议**：`connect()` 加锁；确保旧 listener 不会把新 socket 置 null。

### A23. 下载遇到 401/403 直接 stopSelf，中断其它投递
- **优先级**：中
- **状态**：fixed
- **文件/行号**：`android/app/src/main/java/com/studyshot/relay/RelayReceiveService.kt:171-175`
- **问题描述**：某一次 delivery 鉴权失败就 `stopSelf()`，当前 scope 被取消，其他 in-flight 下载可能停留在不一致状态。
- **修改建议**：先标记所有 pending delivery failed/needs_rebind，再优雅停止；或仅对当前 delivery 失败并触发全局重连/重绑定提示。

### A24. 重连永不放弃，持续耗电
- **优先级**：中
- **状态**：fixed
- **文件/行号**：`android/app/src/main/java/com/studyshot/relay/RelayReceiveService.kt:313-323`
- **问题描述**：只要 `autoReceiveEnabled` 为 true，就会指数退避到 60s 后无限重连；服务端永久不可达时持续唤醒设备。
- **修改建议**：设置最大重连次数或超长静默期；达到上限后通知用户并停止服务。

### A25. 下载完成通知未检查通知权限
- **优先级**：中
- **状态**：fixed
- **文件/行号**：`android/app/src/main/java/com/studyshot/relay/RelayReceiveService.kt:345-355`
- **问题描述**：Android 13+ 若用户拒绝 `POST_NOTIFICATIONS`，`manager.notify(...)` 会抛 `SecurityException`。
- **修改建议**：调用前检查 `NotificationManager.areNotificationsEnabled()` 或 try-catch。

### A26. 未处理“部分照片访问”的再次申请
- **优先级**：中
- **状态**：open
- **文件/行号**：`android/app/src/main/java/com/studyshot/relay/MainActivity.kt:99-115, 184-188, 683-696`
- **问题描述**：只申请了 `READ_MEDIA_IMAGES`/`READ_EXTERNAL_STORAGE` + `POST_NOTIFICATIONS`。Android 14 的部分照片访问下，用户选中的照片集合会变化，但代码没有提供再次请求扩大选择的逻辑。
- **修改建议**：检测到 `READ_MEDIA_VISUAL_USER_SELECTED` 时，给出引导按钮并可再次请求 `READ_MEDIA_IMAGES`。

### A27. 权限授权后不会自动启动已开启的服务
- **优先级**：中
- **状态**：open
- **文件/行号**：`android/app/src/main/java/com/studyshot/relay/MainActivity.kt:184-188, 190-204`
- **问题描述**：权限 launcher 回调只更新 `message`，LaunchedEffect 不依赖权限结果，因此授权后若自动上传/接收已开启，服务不会立即启动。
- **修改建议**：在权限结果回调中触发一次服务状态刷新。

### A28. 前台服务启动可能触发 Android 14+ 后台启动限制
- **优先级**：中
- **状态**：open
- **文件/行号**：`android/app/src/main/java/com/studyshot/relay/MainActivity.kt:117-124, 130-137`
- **问题描述**：直接调用 `startForegroundService`，若调用时应用不处于允许启动前台服务的生命周期（如配置变化间隙），Android 14 会抛 `ForegroundServiceStartNotAllowedException`。
- **修改建议**：捕获异常；必要时改用 WorkManager 兜底。

### A29. Manifest 中 cleartextTraffic 全局开启
- **优先级**：中
- **状态**：open
- **文件/行号**：`android/app/src/main/AndroidManifest.xml:21`
- **问题描述**：`android:usesCleartextTraffic="true"` 使所有 HTTP 流量明文传输，token 和图片可能在不可信网络被截获。
- **修改建议**：默认 HTTPS；仅对明确配置的本地 IP 通过 `network_security_config` 放行明文。

### A30. 前台服务类型未在代码中显式指定
- **优先级**：中
- **状态**：open
- **文件/行号**：`android/app/src/main/AndroidManifest.xml:40-48`, `ScreenshotObserverService.kt:29`, `RelayReceiveService.kt:50`
- **问题描述**：虽然 manifest 声明了 `foregroundServiceType="dataSync"`，但代码中直接调用 `startForeground(id, notification)`，在 Android 14 应显式传入 `FOREGROUND_SERVICE_TYPE_DATA_SYNC`。
- **修改建议**：使用 `ServiceCompat.startForeground(..., ServiceInfo.FOREGROUND_SERVICE_TYPE_DATA_SYNC)`。

### A31. 实时和省电逻辑依赖 UI 触发
- **优先级**：低
- **状态**：open
- **文件/行号**：`android/app/src/main/java/com/studyshot/relay/MainActivity.kt:190-204`
- **问题描述**：互斥逻辑只在 Compose 的 LaunchedEffect 中，设置变化靠 UI 页面触发；若用户在系统设置里快速开关权限/设置，可能出现短暂同时存在或漏启动。
- **修改建议**：将模式切换逻辑集中到 `ViewModel` 或 `BroadcastReceiver`；监听设置变化和 BOOT_COMPLETED 做兜底。

### A32. 关闭自动上传后前台服务可能仍在“空转”
- **优先级**：低
- **状态**：open
- **文件/行号**：`android/app/src/main/java/com/studyshot/relay/ScreenshotObserverService.kt:69-73`
- **问题描述**：设置改为 `autoUploadEnabled=false` 后，`scanRecent()` 会空返回，但通知仍显示“正在监听学习截图”，直到 MainActivity 的 LaunchedEffect 关闭服务。若用户不返回首页，服务会残留。
- **修改建议**：Service 内监听设置变化，条件不满足时主动 `stopSelf()`。

### A33. handleSharedImage 使用无生命周期绑定的 MainScope
- **优先级**：中
- **状态**：open
- **文件/行号**：`android/app/src/main/java/com/studyshot/relay/MainActivity.kt:94-97`
- **问题描述**：`kotlinx.coroutines.MainScope().launch(Dispatchers.IO)` 不跟随 Activity 生命周期，Activity 销毁后仍可能继续执行并访问 Activity 相关状态。
- **修改建议**：使用 `lifecycleScope.launch { withContext(Dispatchers.IO) { ... } }`。

### A34. Worker 每次都新建 ApiClient/SecureSettings/Database
- **优先级**：中
- **状态**：open
- **文件/行号**：`android/app/src/main/java/com/studyshot/relay/upload/UploadWorker.kt:21-22`, `PowerSaveScanWorker.kt:16-25`
- **问题描述**：没有复用 `StudyShotApp` 中的单例，每次 Worker 运行都新建对象，EncryptedSharedPreferences 解锁和数据库初始化开销较大。
- **修改建议**：通过 `applicationContext as StudyShotApp` 复用单例。

### A35. 手动上传缓存目录永不清理
- **优先级**：中
- **状态**：open
- **文件/行号**：`android/app/src/main/java/com/studyshot/relay/upload/UploadRepository.kt:114-124`
- **问题描述**：手动选择/分享的图片被复制到 `cacheDir/manual-uploads`，成功或失败后都不删除，会无限占用缓存空间。
- **修改建议**：Worker 完成后删除缓存文件；定期 LRU 清理。

### A36. 上传/下载都把整张图片读进内存
- **优先级**：中
- **状态**：open
- **文件/行号**：`android/app/src/main/java/com/studyshot/relay/network/StudyShotApiClient.kt:176-177, 248-249`
- **问题描述**：`it.readBytes()` 和 `response.body?.bytes()` 会把整张图片字节全部加载到内存，大图/多图并发时容易 OOM。
- **修改建议**：上传用基于 InputStream 的自定义 RequestBody；下载直接写入文件。

### A37. 下载记录未在开始时写入“downloading”状态
- **优先级**：中
- **状态**：open
- **文件/行号**：`android/app/src/main/java/com/studyshot/relay/RelayReceiveService.kt:147-161, 214-226`
- **问题描述**：只有下载完成后才写入 DB。如果服务进程在下载中崩溃，重启后无法识别该 delivery 已处理过，可能重复下载。
- **修改建议**：`processDelivery` 开始后先 upsert 一条 `status = "downloading"` 记录。

### A38. 上传时 sha256 与 body 可能不一致
- **优先级**：中
- **状态**：open
- **文件/行号**：`android/app/src/main/java/com/studyshot/relay/upload/UploadWorker.kt:43-68`, `StudyShotApiClient.kt:176-177`
- **问题描述**：先算 sha256，再重新打开流上传，两次读文件之间文件可能被覆盖，导致发送的 sha256 与实际 body 不一致，服务端校验失败。
- **修改建议**：上传时一边读取一边计算 hash，或先把文件完整复制到缓存后再处理。

### A39. mediaIdHash 基于不稳定的 media id
- **优先级**：低
- **状态**：open
- **文件/行号**：`android/app/src/main/java/com/studyshot/relay/upload/MediaStoreScanner.kt:52, 73-76`
- **问题描述**：`hashMediaId(id.toString())` 只对 MediaStore 的 `_ID` 做 hash，该 ID 在媒体库扫描/重启后可能复用，服务端可能看到重复或冲突的 `sourceMediaIdHash`。
- **修改建议**：组合 `_ID + DISPLAY_NAME + DATE_ADDED` 做 hash，或直接依赖 sha256。

---

## 二、后端

### B1. WebSocket 同设备重连竞态，会丢失新连接记录
- **优先级**：高
- **状态**：fixed
- **文件/行号**：`backend/src/plugins/ws.ts:100-105, 138-139`
- **问题描述**：建立新连接时先关闭旧 socket 并 `connections.delete(device.id)`，但旧 socket 的 `on("close")` 回调稍后会异步执行 `connections.delete(device.id)`。由于 `device.id` 相同，旧连接的 close 事件会把**刚刚插入的新连接**从 map 中删除。结果是：客户端虽然连着，但服务端 `connections` 里找不到它，收不到 `image.created` 通知。
- **修改建议**：`close` 回调应判断当前 map 中保存的是否是本次关闭的 socket：
  ```ts
  socket.on("close", () => {
    const current = connections.get(device.id);
    if (current?.socket === socket) connections.delete(device.id);
  });
  ```

### B2. originImageId 防循环检查在去重之后，可被绕过
- **优先级**：高
- **状态**：fixed
- **文件/行号**：`backend/src/routes/images.ts:78-80, 85-122`
- **问题描述**：如果客户端上传一个 1 小时内已存在过的文件并带上 `originImageId`，会先命中去重分支并返回成功，**不会拒绝**。这破坏了“上传请求带 `origin_image_id` 时拒绝”的防循环规则。
- **修改建议**：将 `originImageId` 检查移到去重查询之前，或在去重分支中也检查并返回 400。

### B3. originImageId 拒绝时未删除已存文件，可造成存储 DoS
- **优先级**：高
- **状态**：fixed
- **文件/行号**：`backend/src/routes/images.ts:64-80`
- **问题描述**：文件已写入存储并计算完 sha256 后才抛出 `LOOP_RISK`，但没有 `unlink` 该文件。攻击者可反复上传大文件并带 `originImageId` 填满磁盘。
- **修改建议**：在抛错前调用 `fs.promises.unlink(stored.absolutePath)`。

### B4. 投递生成遗漏“目标设备用户被禁用”检查
- **优先级**：高
- **状态**：fixed
- **文件/行号**：`backend/src/services/delivery.ts:12-22, 44-73`
- **问题描述**：`generateDeliveries` 查询目标设备时只过滤了 `revokedAt: null`，没有检查 `user.disabledAt`。若某设备所属用户被禁用，该设备仍可能收到新投递。
- **修改建议**：在 `targetDevices` 查询中 `include: { user: true }` 并过滤 `user.disabledAt: null`，或在循环里 `if (target.user.disabledAt) continue;`。

### B5. 设备鉴权插件是“可选”的，依赖各路由再检查
- **优先级**：中
- **状态**：open
- **文件/行号**：`backend/src/plugins/device-auth.ts:29-97`
- **问题描述**：`optionalDeviceAuth` 在 `onRequest` 阶段校验设备 token，但它是“可选”插件，未设置 `request.device` 的请求会继续进入路由。所有需要设备身份的路由必须自己再判断 `request.device`，新增路由时容易遗漏。
- **修改建议**：增加一个强制的 `requireDeviceAuth` hook 装饰器/前置钩子，统一拦截无设备身份或已被撤销/禁用的请求。

### B6. 禁用用户 HTTP 返回 403 而非协议约定的 401
- **优先级**：低
- **状态**：open
- **文件/行号**：`backend/src/plugins/device-auth.ts:68-74`
- **问题描述**：`docs/protocol.md` 第 46 行约定“token 缺失、无效、设备撤销或用户禁用”都应返回 401，但当前用户被禁用时返回 403。
- **修改建议**：将禁用用户的 HTTP 状态码从 403 改为 401，并在错误码中区分 `USER_DISABLED`。

### B7. WebSocket 建立连接后不再重新校验撤销/禁用状态
- **优先级**：中
- **状态**：open
- **文件/行号**：`backend/src/plugins/ws.ts:95-98, 148-156`
- **问题描述**：WS 仅在握手时校验 `revokedAt` / `user.disabledAt`，之后 90 秒心跳只检查是否超时，不会再查数据库。若用户被禁用或设备被撤销后未主动调用 `/devices/:id/revoke`，旧连接会一直保持到心跳超时或客户端重连。
- **修改建议**：心跳周期内定期（如每 30 秒）重新查询设备/用户状态，发现撤销或禁用立即 `socket.close(1008, ...)`。

### B8. 用户禁用时未关闭其所有设备的 WS
- **优先级**：中
- **状态**：open
- **文件/行号**：`backend/src/routes/admin.ts:144-150`
- **问题描述**：`PATCH /users/:userId` 将用户设为 disabled 后，没有主动关闭该用户下所有设备的 WebSocket 连接。这些连接会继续存活到心跳超时。
- **修改建议**：用户禁用后，查询该用户所有未撤销设备并调用 `closeConnectionsForDevice`。

### B9. 上传未服务端校验 autoUploadScope
- **优先级**：中
- **状态**：open
- **文件/行号**：`backend/src/routes/images.ts:52-59`
- **问题描述**：`permissions.md` 定义了 `autoUploadScope`，但服务端仅校验布尔权限，未按 `screenshot_only` / `selected_album` 等范围再校验。当前属于“客户端负责过滤”模式，服务端缺少最后一道防线。
- **修改建议**：在服务端根据 `sourceKind` 与设备 `autoUploadScope` 做范围校验，例如 `autoUploadScope === "manual_share_only"` 时拒绝非 `manual_share` 上传。

### B10. 路由级文件大小限制可能失效
- **优先级**：中
- **状态**：open
- **文件/行号**：`backend/src/routes/images.ts:38`
- **问题描述**：`request.file({ limits: { fileSize: request.server?.initialConfig.bodyLimit } })` 使用 `?.` 访问 `bodyLimit`，若在某些测试/代理环境下为 `undefined`，则会把单文件限制置空。`app.ts` 已注册全局 multipart limit，但此处显式覆盖可能把它抹掉。
- **修改建议**：统一使用 `config.MAX_IMAGE_SIZE_MB * 1024 * 1024` 显式常量。

### B11. 文件类型只查魔数，可存储任意数据
- **优先级**：中
- **状态**：open
- **文件/行号**：`backend/src/services/storage.ts:25-59, 88-134`
- **问题描述**：只检查文件前 12 字节魔数。攻击者可构造以 PNG/JPEG/WEBP 头部开头、后续附带任意数据的文件，通过校验并存入存储。`sharp.metadata()` 读取尺寸时可能仍成功，导致非图片文件被服务端保存并可通过下载接口取回。
- **修改建议**：使用 `sharp` 做一次完整解码/验证（或至少验证文件完整、无异常 trailing 数据），验证失败立即删除文件。

### B12. 校验失败产生孤儿文件
- **优先级**：中
- **状态**：open
- **文件/行号**：`backend/src/routes/images.ts:82, 126-149`
- **问题描述**：`getImageDimensions` 失败或事务内异常时，`stored.absolutePath` 处的文件不会被删除。
- **修改建议**：把“存储 + 校验 + 创建记录”包装在 try/finally 中，任何一步失败都清理已落地文件。

### B13. 关键操作缺少审计日志
- **优先级**：中
- **状态**：open
- **文件/行号**：`backend/src/routes/auth.ts`、`images.ts`、`deliveries.ts`、`plugins/ws.ts`
- **问题描述**：当前未记录登录成功/失败、图片下载、投递 ACK / 状态变更、WebSocket 连接/断开、权限被拒绝等安全事件。
- **修改建议**：在上述路径调用 `logAudit`，失败登录可记录 `actorUserId` 为 null 并只记录登录名（不要记密码）。

### B14. WebSocket 无速率限制
- **优先级**：中
- **状态**：open
- **文件/行号**：`backend/src/plugins/ws.ts:75-146`
- **问题描述**：`@fastify/rate-limit` 默认不限制 WebSocket 握手，恶意客户端可高频建立/断开连接放大 B1 的竞态问题。
- **修改建议**：在 WS 连接前增加基于 IP 的连接速率限制或连接数上限。

### B15. logger 脱敏未递归处理嵌套对象
- **优先级**：低
- **状态**：open
- **文件/行号**：`backend/src/logger.ts:35-46`
- **问题描述**：`sanitize` 只遍历 `meta` 的顶层 key，如果将来出现 `headers: { authorization: ... }` 或嵌套对象包含 token，将不会被脱敏。
- **修改建议**：对嵌套对象递归脱敏，或统一禁止记录原始 headers。

### B16. sha256 未限制十六进制字符
- **优先级**：低
- **状态**：open
- **文件/行号**：`backend/src/routes/images.ts:18`
- **问题描述**：`z.string().length(64)` 允许非十六进制字符。服务端会重新计算并比对，最终仍会被 `HASH_MISMATCH` 拒绝，不会导致越权，但弱化了输入校验。
- **修改建议**：使用 `z.string().regex(/^[0-9a-f]{64}$/i)`。

### B17. selected_devices 未再校验来源设备撤销状态
- **优先级**：低
- **状态**：open
- **文件/行号**：`backend/src/services/delivery.ts:59-70`
- **问题描述**：`shouldReceiveFrom` 仅查 `receiveSourceRule.enabled`，未校验 `sourceDevice` 是否被撤销/跨空间。由于上传时设备 token 已被鉴权，撤销设备无法上传，但这是“防御纵深”缺口。
- **修改建议**：在规则命中后再次确认 `sourceDevice.ownerUserId === target.ownerUserId` 且 `sourceDevice.revokedAt` 为 null。

### B18. WebSocket 端点路径与客户端不一致导致 404
- **优先级**：高
- **状态**：fixed
- **文件/行号**：`backend/src/plugins/ws.ts:76`
- **问题描述**：后端注册 WebSocket 路由为 `/ws`，而 Android 和桌面端均按协议文档连接 `/api/v1/ws`。OPD2508 的 `RelayReceiveService` 尝试连接 `/api/v1/ws` 时服务器返回 `404 Not Found`，WebSocket 无法建立，实时推送完全失效，设备只能依赖轮询（但当前客户端没有主动轮询 pending deliveries 的定时机制，因此表现为“永远收不到”）。
- **修改建议**：将 `app.get("/ws", ...)` 改为 `app.get("/api/v1/ws", ...)`，与协议文档和客户端保持一致。

---

## 三、桌面客户端

### D1. 设备撤销后未停止重试，会无限重连
- **优先级**：高
- **状态**：fixed
- **文件/行号**：`desktop/src/relay-client.ts:435-446, 751-761`
- **问题描述**：WebSocket `close` 事件不区分关闭码，即使设备被撤销也会指数退避无限重试。HTTP 401/403 也不调用 `disconnect()` 或 `clearBinding()`。
- **修改建议**：
  1. 识别鉴权/策略关闭码（如 `1008`）或 401/403 后停止自动重连。
  2. 清空 `autoReceive` 或 `clearBinding()`，并提示用户重新绑定。
  3. 服务端如能在关闭帧 reason 中返回 `DEVICE_REVOKED` 等标识，客户端可更精确识别。

### D2. deliveryId 跨会话去重缺失 + 内存泄漏
- **优先级**：高
- **状态**：fixed
- **文件/行号**：`desktop/src/relay-client.ts:199-200, 536-553`
- **问题描述**：`completedDeliveries` Set 只增不减；应用重启前已下载但 ACK 未成功的投递，重启后会重新下载。
- **修改建议**：
  1. 将 `completedDeliveries` 改为有上限的 LRU（例如最多保留最近 5000 个）。
  2. 在 `processDelivery()` 开头增加 `if (this.history.find(delivery.deliveryId)?.status === 'downloaded') return;` 等持久化去重检查。

### D3. WebSocket 重连无抖动、未区分关闭码
- **优先级**：中
- **状态**：fixed
- **文件/行号**：`desktop/src/relay-client.ts:197, 398-451, 751-761`
- **问题描述**：已实现指数退避，最大间隔 60 秒，但未加入随机抖动。大量客户端在同一服务端重启后会在几乎同一时刻发起重连，形成重连风暴。且未区分关闭原因，服务端因设备撤销或鉴权失败主动关闭时客户端仍会重试。
- **修改建议**：
  1. 在 `scheduleReconnect()` 中加入 ±20%~30% 随机抖动。
  2. 对鉴权/策略类关闭码停止自动重连，并将状态置为 `error`。

### D4. 下载目录不可写提示不足
- **优先级**：中
- **状态**：open
- **文件/行号**：`desktop/src/relay-client.ts:604-614`, `desktop/src/main.ts:173-178, 213-225`
- **问题描述**：目录不可写时异常会上抛到 `downloadWithRetries()`，经 3 次重试后 ACK `failed`，不会导致进程崩溃。但用户提示不足，磁盘错误不会将连接状态置为 `error`。
- **修改建议**：
  1. 在保存设置或选择目录后，对 `downloadDir` 做可写性探测。
  2. 不可写时立即向渲染进程报错。
  3. 下载因磁盘/权限失败时触发通知或托盘提示。

### D5. token 安全存储在 Linux 可能明文回退
- **优先级**：中
- **状态**：open
- **文件/行号**：`desktop/src/config-store.ts:169-196`
- **问题描述**：优先使用 Electron `safeStorage` 加密存储；不可用时回退到 `plainDeviceToken` 明文写入 `config.json`。Linux 无可用 keyring 时存在风险。
- **修改建议**：
  1. 在 `safeStorage` 不可用时引导用户绑定到系统 keyring，或至少明确弹窗警告。
  2. 解密失败时向 UI 返回可识别的错误，提示“token 无法解密，请重新绑定”。

### D6. macOS Dock 点击无法唤出已隐藏窗口
- **优先级**：中
- **状态**：open
- **文件/行号**：`desktop/src/main.ts:303-305`
- **问题描述**：`activate` 事件仅在没有窗口时才创建新窗口；若窗口只是隐藏，`BrowserWindow.getAllWindows().length === 0` 不成立，Dock 点击无法唤出已隐藏窗口。
- **修改建议**：在 `activate` 事件中：若窗口存在则 `show()`/`focus()`，否则创建。

### D7. Linux 开机自启不可靠
- **优先级**：中
- **状态**：open
- **文件/行号**：`desktop/src/config-store.ts:141-144`, `desktop/src/main.ts:104-156`
- **问题描述**：Electron 在 Linux 下仅写入 `~/.config/autostart`，依赖桌面环境且不稳定。未指定 `path` 与 `openAsHidden`；打包后 Windows 可能需要指向实际 `.exe` 路径。
- **修改建议**：
  1. Linux 平台增加 systemd/autostart 备用方案或文档说明。
  2. Windows 打包时校验 `setLoginItemSettings` 的 `path` 是否正确指向安装后的可执行文件。

### D8. IPC 处理器未校验发送方且参数未做运行时校验
- **优先级**：中
- **状态**：open
- **文件/行号**：`desktop/src/main.ts:158-283`, `desktop/src/preload.ts:1-52`
- **问题描述**：所有 `ipcMain.handle` 都未检查 `event.sender` / `event.senderFrame`，若未来出现多个窗口或 WebView，存在被非预期来源调用的风险。参数未做运行时类型校验，渲染进程若传入非预期类型可能抛出异常。
- **修改建议**：
  1. 为敏感 IPC 处理器增加 `event.sender.id` / `event.senderFrame.url` 校验。
  2. 对 IPC 入参做 `typeof` 校验，或使用 Zod 等轻量校验。

### D9. renderer.js 使用 innerHTML
- **优先级**：中
- **状态**：open
- **文件/行号**：`desktop/src/renderer/renderer.js:251, 275`
- **问题描述**：存在 `innerHTML = '<span>上传范围</span>'` 等静态注入，当前无用户输入进入，但容易在后续维护中引入 XSS。
- **修改建议**：将 `innerHTML` 替换为 `textContent` + `createElement`。

### D10. sha256 不匹配也进行重试
- **优先级**：低
- **状态**：open
- **文件/行号**：`desktop/src/relay-client.ts:598-602, 555-583`
- **问题描述**：下载后 sha256 校验失败会抛出异常，`downloadWithRetries()` 会进行最多 3 次线性退避重试。若服务端元数据本身错误会浪费 3 次流量。
- **修改建议**：对 sha256 不匹配与网络错误区分重试策略，例如元数据不匹配仅重试 1 次或不重试。

### D11. 剪贴板写入使用同步大文件读取
- **优先级**：低
- **状态**：open
- **文件/行号**：`desktop/src/relay-client.ts:673-684`
- **问题描述**：`nativeImage.createFromPath(filePath)` 是同步阻塞大文件读取，超大图片可能短暂卡死主进程。
- **修改建议**：可考虑使用异步方式或限制文件大小。

---

## 四、修复进度总览

| 组件 | 高优先级 | 中优先级 | 低优先级 | 已修复 |
|---|---|---|---|---|
| Android | 8 | 24 | 8 | 16 |
| 后端 | 4 | 10 | 3 | 4 |
| 桌面 | 2 | 6 | 3 | 3 |

**已修复**：A1, A2, A3, A4, A5, A6, A7, A8, A15, A19, A20, A21, A22, A23, A24, A25, B1, B2, B3, B4, D1, D2, D3

## 五、验证记录

- **后端**：`npm run build` 通过（`backend/src` TypeScript 无编译错误）。
- **桌面端**：`npm run typecheck` 通过（`desktop/src` TypeScript 无类型错误）。
- **安卓端**：`./gradlew :app:assembleDebug` 通过，生成 `android/app/build/outputs/apk/debug/app-debug.apk`。
  - 备注：最初系统只有 `openjdk-17-jre`（无 `jlink`）和 `openjdk-25-jdk-headless`（Gradle 8.2 不支持 Java 25）。已安装 `openjdk-17-jdk`，现可直接用 `JAVA_HOME=/usr/lib/jvm/java-17-openjdk-amd64` 编译。
