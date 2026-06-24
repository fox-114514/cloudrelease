# StudyShot Relay 变更日志（Changelog）

本文档由自动化 agent 维护，记录后端 / 桌面 / 安卓各端的代码变更，便于不同会话的 agent 之间同步进度。

## 写入约定

- 每次产生新 commit **必须**在本文件追加一条记录，不允许漏。
- 倒序排列：最新条目在最上方。
- 每条记录包含以下字段：
  - **时间**：commit 时间（commit 作者时区）。
  - **Commit**：短 hash（7 位）。
  - **模块**：`backend` / `desktop` / `android` / `infra` / `docs`。
  - **状态**：`merged` / `deployed`（已推到远端 main）/ `rolled-back`。
  - **改动文件**：本 commit 涉及的文件路径列表。
  - **概述**：3-6 行说清楚做了什么、为什么、影响谁。
  - **破坏性**：是/否；若是，说明客户端必须如何适配。
  - **依赖 / 后续**：需要其他模块配合的事项、遗留 TODO。
- 不要重复记录已被 revert 的 commit；如果一个 commit 被另一个 commit 回滚，新增一条引用 revert hash 的记录。
- 跨 commit 的"持续工作"应在最新条目里维护"上一条"链接。
- 中文。

## 当前状态概览（截至 2026-06-19）

- 后端已部署的图片库 + 多选功能已合并并推到远端 main。
- 工作区仍有上一轮 fix session 的未提交改动（见 `docs/fix-report-2026-06-18.md`），建议下一个 agent 先决定是否补一个 commit。
- 后端集成测试 (`npm test`) 在当前环境无法跑通，因为 PostgreSQL 容器镜像拉取超时（参考 `docs/fix-report-2026-06-18.md` 末尾）。新建功能后必须至少保证 `npm run build` 与 `npx prisma validate` 通过。
- Android App UI 改版与图标改版已完成（worktree，未提交），版本号待下一次发版提交时升到 0.2.0。

---

## 条目

### 2026-06-19 00:55 — `<pending>` — Android App UI 改版：4 Tab + 子页 + 新图标 + 版本升 0.2.0

- **模块**: android
- **状态**: merged
- **Commit**: `<pending>`
- **改动文件**:
  - `android/app/build.gradle.kts` — 加 `navigation-compose:2.7.7`、`material-icons-core/-extended:1.6.1`、`animation:1.6.1`；开启 `buildConfig`；`versionCode` 1→2，`versionName` 0.1.0→0.2.0
  - `android/app/src/main/java/com/studyshot/relay/MainActivity.kt` — 从 1279 行巨型 Composable 缩到 117 行，只承载 NavHost + 接收 Intent.ACTION_SEND
  - `android/app/src/main/java/com/studyshot/relay/network/AdminSession.kt`（新增）— `AdminSession` 从 MainActivity `private data class` 提到 network 包公开
  - `android/app/src/main/java/com/studyshot/relay/ui/**`（新增 13 个文件）— theme、components、navigation、11 个屏幕 + 5 个帮助子页
  - `android/app/src/main/res/drawable/ic_launcher_foreground.xml` — 图标重做：墨绿底 + 白色截图卡(带笔记横线) + 右上斜上箭头
  - `android/app/src/main/res/values/{colors,strings,styles}.xml` — 系统栏透明化，跟随主题
  - `.gitignore` — 加 `android/local.properties`
- **概述**:
  - 旧: 单 Activity + 5 Tab 一屏塞到底,管理 Tab 里再嵌 2 Tab,`InfoCard` 当 toast 用,`Card{Column{Text}}` 堆叠是常态。
  - 新: `androidx.navigation` NavHost,4 个底部 Tab(主页/记录/设置/帮助),16 个子路由。`SurfaceCard + SettingsGroup/SettingsRow + QuickActionCard + StatusPill + ConnectionDot` 替换无差别 `Card`;Snackbar 替换 `InfoCard`。
  - 5 处动效: 状态点 1.4s 反向缩放脉冲 + 外圈 1.8s 涟漪、`MetricTile` 数值 `AnimatedContent` 淡入淡出、NavHost 页面切换水平位移 220ms、FAQ 折叠 chevron `animateFloatAsState` 旋转、Snackbar 从底部上滑。
  - 主页化简: 大标题 + 连接点 + 4 块快速入口卡(绑定/上传/接收/图集/管理) + 2x2 状态指标 + 最近 5 条活动。
  - 6 个帮助子页: 首启 onboarding、6 条 FAQ 折叠、后台运行原理(ColorOS/MIUI/HarmonyOS 厂商限制)、权限说明、关于(版本/服务器)、管理常用问题。
  - 主题去 MUI 默认灰: 墨绿 `#0F7B6C` + 冷纸白 `#F4F5F7`，dark mode 单独色板(墨底 + 米白文字)。Typography 不用 Inter，用 system sans 调字重和字距。
- **行为**: 完全保持原 MainScreen 的所有 API 调用、LaunchedEffect 触发服务、Settings/Management 上传下载逻辑；后端协议、API 客户端、Repository、Service、Data 层未动。
- **破坏性**: 否。仅 UI 重新组织。旧 client 不会因为这次升级断开。
- **依赖 / 后续**: `material-icons-extended` 增加约 1MB APK（21.7 MB）；服务/绑定/上传行为完全没变，旧用户升级零感知。后续若需要动画更激进可加 `GSAP-style` 物理动效；当前 Motion 5 的脉冲+位移已够用。
- **验证**: `./gradlew :app:assembleDebug` 通过；APK 21.7 MB。

### 2026-06-18 21:50 — `a95769e` — 修复：已删除图片错误加载 + 批量删除后视觉不同步

- **模块**: backend (images.ts) + web-admin
- **状态**: deployed
- **Commit**: `a95769e`
- **改动文件**:
  - `backend/src/routes/images.ts`
  - `backend/src/routes/images.test.ts`
  - `backend/src/routes/web-admin.ts`
  - `docs/protocol.md`
- **概述**:
  - **bug 1（用户截图反馈）**：`GET /images` 之前 `filter=all` 会返回 `deletedAt` 不为空的图片。这些"已删除"的图片 `/download` 端点会拒绝（404），UI 显示"预览失败"，再点删除又全部 404 → "已删除 0 张，失败 12 张"，且刷新后仍在列表里，**无法根除**。
  - **修复 1**：后端默认 `where.deletedAt = null`，所有 filter 统一排除已删除图片。
  - **bug 2（顺带）**：批量删除全部失败时，`state.selectedImageIds` 清空了，但卡片 DOM 上的 `is-selected` class 没同步——视觉上"已选中"，但计数"已选 0"。
  - **修复 2**：新增 `syncSelectionVisual()` 在批量删除后调用，遍历卡片 DOM 同步 class / 复选标记 / 提示文本。
  - **bug 3（顺带）**：`loadImages(reset=true)` 现在也清理已不在新列表里的 `selectedImageIds`（比如另一标签页删除了图片）。
  - 测试新增 2 个：`filter=all` 排除已删除、`filter=expired` 排除已删除。
  - 文档：protocol.md §11 注释改为"所有 filter 默认排除已删除"。
- **破坏性**: 是——客户端如果依赖"列出包括已删除图片"的旧行为会看不到已删除项。需要查看删除历史请用 audit-logs。
- **依赖 / 后续**: 若未来需要"显示/恢复已删除图片"，应加单独的 `includeDeleted=true` 参数或新 filter，不应该靠把 deletedAt 重新塞进默认结果实现。

### 2026-06-18 21:00 — `20c3e92` — web-admin 图片库多选 + 缩略图缓存

- **模块**: backend web-admin (浏览器内 SPA)
- **状态**: deployed
- **Commit**: `20c3e92`
- **改动文件**: `backend/src/routes/web-admin.ts`
- **概述**:
  - 工具栏新增 `多选` 按钮，进入/退出选择模式。
  - 顶部出现操作栏：`已选 N | 全选本页 | 删除所选 (N) | 取消`。
  - 选择模式下点卡片任意位置都切换选中，不再打开预览；卡片显示复选标记 + accent 色描边。
  - 批量删除走 `Promise.allSettled` 并行请求，结束后分别报告成功/失败数。
  - **顺带修 bug**：之前 `loadImagePreview` 命中缓存直接 early-return，导致删除后其它卡片永远卡在"加载中…"。现在命中缓存时直接恢复 DOM。
  - 删除改为只 `removeCardFromDom(id)` + `revokePreview(id)`，不再触发全量 `renderImages`。
  - `selectMode` / `selectedImageIds` 在筛选切换、刷新、退出登录时清空，避免跨上下文泄漏。
- **破坏性**: 无（纯前端 SPA 行为变化）。
- **依赖 / 后续**:
  - 筛选变化/刷新会清空选择，用户重新选。如想"保留跨筛选的选中"需在状态层做改动。
  - "全选本页" 当前页最大 50，超过 50 的需要加载更多后再全选。
  - 没有进度条；`Promise.allSettled` 在请求数过大时可能触发 rate-limit（当前全局 1000/min/IP，50 张远低于上限）。

### 2026-06-18 20:16 — `abf2169` — web-admin 图片库（初版）

- **模块**: backend (API + web-admin UI) + docs
- **状态**: deployed
- **Commit**: `abf2169`
- **改动文件**:
  - `backend/src/routes/images.ts` — 新增 `GET /images` 列表、`DELETE /images/:id` 删除；扩展 `GET /download` 允许 admin
  - `backend/src/routes/images.test.ts` — 8 个新测试
  - `backend/src/routes/web-admin.ts` — 新增"图片"标签页 + 模态预览
  - `docs/protocol.md` — §11 补充三个接口的契约
  - `docs/permissions.md` — `canManageSpace` 能力项新增图片库管理
- **概述**:
  - `GET /api/v1/images`：admin only（owner 用户或 `canManageSpace` 设备），支持 `limit`（默认 50，最大 100）、`before` 游标、`filter`（`all` / `active` / `expired` / `today` / `week` / `month`）。
  - `DELETE /api/v1/images/:imageId`：事务内标 `deletedAt` + 把 `pending`/`notified` 投递改为 `expired`；best-effort `unlink` 磁盘文件；写 `audit_logs`。
  - `GET /api/v1/images/:id/download` 现在允许 owner 用户或 `canManageSpace` 设备直接访问（之前只允许设备），用于网页预览。
  - Web Admin：网格卡片 + 缩略图懒加载（`fetch` → blob URL）+ 模态预览 + 元数据表 + 单张删除。
  - CSP `img-src` 增加 `blob:` 以支持 blob URL 预览。
- **破坏性**: 无（向后兼容，仅扩展鉴权）。
- **依赖 / 后续**:
  - 缩略图走整图 + blob URL，图片大时内存占用高；后续可加 `GET /thumbnail` 服务端 resize。
  - 列表响应里 `nextCursor` 是 ISO 时间字符串，与 `before` 查询参数配对使用；不要改成页码（避免 offset 性能问题）。

### 历史 commit（非本 agent）

- `cf1ffa9` 2026-06-18 16:17 — Add built-in web admin dashboard
- `7409a54` 2026-06-18 16:00 — Support IP-only HTTP backend deployment
- `e513ac1` 2026-06-18 15:50 — Initial StudyShot Relay implementation

### 未提交的本地改动（待下一 agent 决定）

参考 `docs/fix-report-2026-06-18.md` 中的"追加修复"段落，涉及：

- `backend/src/plugins/ws.ts`（+10 行）— B1 修复
- `backend/src/services/delivery.ts`（+5 行）— B4 修复
- `desktop/src/relay-client.ts`（+48 行）— D1/D2/D3 修复
- `android/app/src/main/java/com/studyshot/relay/...`（多个 Kotlin 文件，~384 行变化）— A1-A7/A15/A19-A25 修复
- `docs/study-shot-relay-agent-tasklist.md`（+636 行）— 任务清单大幅重写
- `docs/bug-report-2026-06-18.md`（新增文件，540 行）— 上一轮 bug 报告
- `minimax审查报告.md`（新增文件，仓库根目录）— minimax 审查报告，包含 80+ 仍待修复项
- **Android App UI 重构**（本轮 worktree，未提交）：
  - `android/app/build.gradle.kts` — 加 `navigation-compose` 2.7.7、`material-icons-core/-extended` 1.6.1、`animation` 1.6.1，开启 `buildConfig`。
  - `android/app/src/main/java/com/studyshot/relay/MainActivity.kt` — 从 1279 行巨型 Composable 缩到 117 行，承载 NavHost。
  - `android/app/src/main/java/com/studyshot/relay/network/AdminSession.kt`（新增）— `AdminSession` 提到 network 包，从 `MainActivity` 的 `private data class` 公开化。
  - `android/app/src/main/java/com/studyshot/relay/ui/**`（新增，约 12 个文件）— 主题/通用组件/导航/11 个屏幕 + 帮助子页。MainScreen 5-Tab 全部拆为子路由。
  - `android/app/src/main/res/values/{colors,strings,styles}.xml` — status bar / nav bar 透明化、纯背景色变化。
  - 行为：完全保持原 MainScreen 的所有 API 调用、LaunchedEffect 触发服务、Settings/Management 上传下载逻辑。
  - 破坏性：无。仅 UI 重新组织。Activity/Service/Data 层未动。
  - 验证：`./gradlew :app:assembleDebug` 在本地环境通过，产出 `app-debug.apk` 21.7 MB。

## 已知缺口（来自图片库相关代码 + minimax 审查）

- 服务端未做服务端缩略图（`sharp` resize），网页端需下载完整图片才能预览。
- 回收站 / 恢复：删除后只能从数据库/磁盘恢复，未实现 UI。
- 批量删除无进度反馈 UI。
- 跨页多选未实现（"全选本页"）。
- 后端 Prisma 测试套件无法在当前环境运行（PostgreSQL 镜像拉取超时）。
- minimax 审查报告中标记为 `open` 的若干 Android / 桌面 bug 未修复。

## 模板（后续条目请复制粘贴）

```markdown
### YYYY-MM-DD HH:MM — `<short-hash>` — <一句话标题>

- **模块**: <backend | desktop | android | infra | docs>
- **状态**: <merged | deployed | rolled-back>
- **Commit**: `<short-hash>`
- **改动文件**: `path1`、`path2`
- **概述**:
  - <要点 1>
  - <要点 2>
- **破坏性**: 是/否；<若否则省略>
- **依赖 / 后续**: <若空则省略>
```