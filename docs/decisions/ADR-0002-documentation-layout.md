# ADR-0002：文档目录分层

- 日期：2026-06-25
- 状态：accepted
- 决策人：人工维护者 + Codex

## 背景

项目已有 README、发布说明、规格、协议、权限、调研、修复报告、bug 报告和审查报告，但文件分布混杂：部分长期规格和一次性调研同处 `docs/`，根目录也残留历史报告。

## 决策

文档分为公开长期文档和内部流水账两类：

```text
docs/
  index.md
  spec/
  design/
  ops/
  decisions/
  archive/

docs-internal/   # 本机内部台账，不推送到公开远程仓库
```

`docs/` 只放当前事实来源、设计、运维和决策。`docs-internal/` 放持续追加的内部台账，但仅在维护者本机保留，不推送到公开远程仓库。旧的一次性报告进入归档目录，不再作为当前事实来源。

## 写入规则

- 修改协议、权限或产品行为时，优先更新 `docs/spec/`。
- 每次实质性代码或发布变更，追加本机 `docs-internal/updates.md`。
- 每次模型或人工审查，追加本机 `docs-internal/reviews.md`。
- 人工提出的缺陷进入本机 `docs-internal/bugs.md`。
- 人工提出的新功能、优化或工程建议进入本机 `docs-internal/suggestions.md`。
- 构建、测试、签名、部署和实机结果进入本机 `docs-internal/verification.md`。
- 一次性调研、旧计划和过期报告归档到 `archive/YYYY-MM/`。

## 后果

- 后续维护者先看 `docs/index.md`，不会在旧调研和当前规格之间来回猜。
- 台账按编号追加，便于追踪来源、状态和验证结果。
- 归档内容仍可查证，但不和当前事实来源竞争。
