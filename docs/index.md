# StudyShot Relay 文档索引

本文档说明项目文档的放置规则。README 面向第一次使用者；这里面向维护者和后续 agent。

## 目录规则

- `docs/spec/`：长期有效的产品、协议、权限规格。代码行为变化后必须同步。
- `docs/design/`：某个子系统或阶段性方案的设计说明。实现完成后仍可作为设计依据。
- `docs/ops/`：部署、数据库、发布和运维操作。
- `docs/decisions/`：架构决策记录，记录为什么这样做。
- `docs/archive/`：历史调研、旧计划和一次性报告。归档内容只作为背景，不作为当前事实来源。
- `docs-internal/`：内部维护台账，包括更新、审查、人工 bug、建议和验证记录。

## 当前事实来源

- [产品完整规格](spec/product-spec.md)
- [客户端 / 后端协议](spec/protocol.md)
- [权限模型](spec/permissions.md)
- [多用户 V2 设计](design/multi-user-v2.md)
- [Android 后台上传设计](design/android-background.md)
- [后端部署](ops/backend-deployment.md)
- [本地 PostgreSQL 配置](ops/local-postgresql-setup.md)

## 内部台账

- [更新记录](../docs-internal/updates.md)
- [审查报告](../docs-internal/reviews.md)
- [人工 bug 报告](../docs-internal/bugs.md)
- [人工更新建议](../docs-internal/suggestions.md)
- [验证记录](../docs-internal/verification.md)
- [Agent 任务清单](../docs-internal/study-shot-relay-agent-tasklist.md)

## 决策记录

- [ADR-0001：发布包按版本目录归档](decisions/ADR-0001-release-layout.md)
- [ADR-0002：文档目录分层](decisions/ADR-0002-documentation-layout.md)

## 归档

旧调研和一次性报告放在：

- [docs/archive/2026-06](archive/2026-06/)
- [docs-internal/archive/2026-06](../docs-internal/archive/2026-06/)

归档文档中的路径可能保留历史写法；如果与当前索引冲突，以本文件和 `docs/spec/` 为准。
