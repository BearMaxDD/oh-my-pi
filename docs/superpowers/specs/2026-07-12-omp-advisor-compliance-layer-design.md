# OMP Advisor 合规层设计（轻量监管开发规则）

| 项目 | 内容 |
| --- | --- |
| 文档类型 | 设计规格（Design Spec） |
| 日期 | 2026-07-12 |
| 状态 | 已批准（头脑风暴终批） |
| 权威性 | **本轮实现的权威规格** |
| 核心基线 | `oh-my-pi-16.4.6`（OMP 16.4.6） |
| 上游 | `can1357/oh-my-pi` |
| 取代 | `2026-07-12-omp-16.4.6-migration-follow-upstream-design.md`（重型全量迁移，已 superseded） |
| 官方基础 | `docs/advisor-watchdog.md`、`packages/coding-agent/src/advisor/**` |

---

## 1. 问题陈述

1. **自研过重**：PlanRun、严格角色路由、Superpowers 多角色门禁等体系体量大、侵入核心深，跟版与维护成本高。
2. **真实痛点更轻**：主代理/模型经常不遵守开发规则（跳 TDD、无验证宣称完成、范围蔓延、幻觉 API）。需要的是**监管与纠偏**，不是再造一套重型编排器。
3. **官方已有合适底座**：16.4.6 Advisor 提供旁路第二模型、`advise(nit|concern|blocker)`、WATCHDOG 配置、emission guard、只读核查工具。应在此上做轻量合规层，而不是平行重建。

---

## 2. 目标

### 2.1 产品目标

建设 **Advisor 合规层（Advisor Compliance Layer）**：

- 用官方 Advisor **监控开发方向与过程纪律**；
- 在模型违规时给出 **concern/blocker** 级纠偏；
- 留下 **轻量可审计证据**；
- 提供 **项目级 Watchdog 规则包** 与 **会话内状态面板**；
- 可选接入 **codebase-memory 自动上下文**，帮助看对代码；
- 架构保持 **可跟 16.x 新版本**：实现主体在薄扩展包，核心补丁趋近于 0。

### 2.2 非目标（本轮）

- PlanRun 全套状态机 / 修复环 / 阶段账本
- Superpowers 多角色门禁军团
- 严格角色模型路由执行器（spawn 硬绑定全链路）
- 硬 tool-hook 禁写生产代码（方案 3，后置）
- Codex Adapter
- 把官方 AdvisorRuntime 重写成另一套 agent

---

## 3. 决策记录

| 决策 | 选择 | 理由 |
| --- | --- | --- |
| 瘦身策略 | 中度瘦身：Advisor 主线 + 少量轻量能力 | 用户确认自研过重 |
| 监管架构 | **方案 2：Advisor 合规层** | 平衡有效性与跟版成本 |
| 未选纯 Watchdog 配置 | — | 缺证据/面板/可测拦截信号 |
| 未选硬门禁混合 | — | 易误伤、易重新做重 |
| PlanRun/Superpowers | 本轮不做，仅路线图 | 与瘦身一致 |
| 轻量附加 | Codebase Memory autocontext 可选 | 低耦合，增强审查质量 |
| 基线 | 16.4.6 | 新核心不变 |

---

## 4. 架构

### 4.1 运行时拓扑

```text
Primary Agent (OMP 16.4.6)
   │ transcript delta / tool activity
   ▼
Official AdvisorRuntime
   │ read/grep/glob + advise
   │ prompt augmented by compliance layer
   ▼
@bearmaxdd/omp-custom  (thin; this wave = compliance)
  ├── rule-packs/          # WATCHDOG + scenario checklists
  ├── signals/             # session activity summary
  ├── inject/              # compliance prompt injection
  ├── evidence/            # JSONL/md log
  ├── panel/               # status panel model
  └── memory/              # optional autocontext
   │
   advise(nit|concern|blocker) → Primary steering / asides
   evidence + panel → user visibility
```

### 4.2 硬约束

1. **优先扩展，不改 Advisor 核心实现**（`AdvisorRuntime` / emission guard 保持上游）。
2. **合规层不得演变成 PlanRun**：无多阶段状态机、无强制角色军团。
3. **Advisor 仍是建议/打断通道**，不是审批人；默认不授予写/exec 工具。
4. **关闭扩展后核心必须可启动**。
5. **跟版冲突面**：目标为 extension 注册 + 配置文件；核心白名单默认空或极少。

---

## 5. 组件设计

### 5.1 Rule Packs

- 人类可读：`WATCHDOG.md` 片段 / 项目 `WATCHDOG.yml` 推荐配置。
- 机器可读：checklist 条目（id、描述、默认 severity、触发信号提示）。
- 内置默认包至少覆盖：
  1. 无测试先改生产代码
  2. 无验证宣称完成
  3. 范围蔓延
  4. 跳过既定计划/清单
  5. 明显错误 API / 幻觉
- 项目可启用/禁用 pack，可覆盖 severity。

### 5.2 Session Signal Collector

从 extension 事件或可观察会话信号生成**摘要**（不是完整重放）：

- 最近编辑路径（src vs test 粗分）
- 是否观察到测试/验证命令
- 是否出现“完成/已修复/LGTM”类宣称
- 是否触碰计划外路径（若用户提供 scope 提示）

信号用于**提示 Advisor**，最终语义判断仍由 Advisor 模型 + 只读核查完成。

### 5.3 Compliance Prompt Injector

在每次 Advisor 更新周期附加短上下文：

- 当前启用 rule pack 焦点
- 最新 signal 摘要（有上限、可截断）
- 判定指引：何时 nit / concern / blocker
- 提醒：沿用 emission guard 规则，不刷空话

注入必须有 token 预算；超限丢弃低优先级信号细节。

### 5.4 Evidence Log

轻量追加写：

```text
schema_version: advisor.compliance.evidence.v1
ts, session_id, turn_hint
signals_digest
advise: { severity, note, rule_ids? }
outcome: accepted | suppressed_by_guard | ...
```

失败策略：内存环形缓冲 + 警告，不阻断 advise。

### 5.5 Status Panel

会话内轻量展示：

- Advisor enabled / model
- 当前 rule packs
- 最近 N 条告警（severity + 摘要）
- 打断次数 / immune 状态（若可读取）

优先复用现有 `/advisor status` 与 UI 挂载点；无则 extension 命令 `/compliance` 或面板入口。

### 5.6 Codebase Memory Autocontext（可选 Wave）

- 代码任务识别后注入优先使用 codebase-memory 的提示
- MCP 不可用时降级，不阻断

---

## 6. 数据流

```text
Primary turn ends
  → Signal Collector 更新摘要
  → AdvisorRuntime 接收 delta
  → Injector 附加规则焦点 + 信号
  → Advisor 只读核查
  → advise(...)
  → EmissionGuard
  → Primary 旁注或打断
  → Evidence append
  → Panel refresh
```

---

## 7. 错误处理

| 场景 | 行为 |
| --- | --- |
| Advisor 未启用/无模型 | 面板提示；primary 不受影响 |
| 规则包缺失/损坏 | 回退内置默认纪律包 |
| Memory 不可用 | 跳过 autocontext |
| Evidence 写失败 | 内存缓冲 + 警告 |
| 误报过多 | 调 severity / immuneTurns / 禁用 pack |
| 扩展加载失败 | 核心正常；合规功能不可用 |

---

## 8. 跟版与仓库策略

### 8.1 基线

- 以 **16.4.6** 为唯一新核心开发基线（git 化并对齐 upstream tag 的操作在实现计划中执行）。
- 旧 16.3.3 重型自研树：只读参考，**不作为本轮迁移源的全量拷贝对象**。

### 8.2 包

- 薄 `@bearmaxdd/omp-custom`（或等价名）本轮仅包含：compliance + rule packs + optional memory。
- 通过 `omp.extensions` / 官方扩展机制加载。
- fork 尽量无核心 diff；若必须，单列白名单并文档化。

### 8.3 升版 runbook（轻量）

1. `git fetch upstream --tags` 并 merge `vX.Y.Z`
2. 检查 extension API / advisor settings 是否变化
3. 跑 omp-custom 合规层测试
4. 跑 2～3 个行为夹具（跳测试、假完成、扩展 off）
5. 记录变更

---

## 9. 测试与验收

### 9.1 单元

- rule pack 加载/合并/禁用
- signal 摘要
- injector 截断与稳定性
- evidence schema
- panel model

### 9.2 行为验收（必须可演示）

1. 故意只改生产路径、不跑测试 → 出现 concern 或 blocker
2. 无验证宣称完成 → blocker 或等价打断
3. 重复空话 advise 被 guard 抑制（不刷屏）
4. evidence 中可见对应事件
5. 面板可见最近告警
6. 关闭扩展后 OMP 正常工作

### 9.3 分波

| Wave | 内容 |
| --- | --- |
| 0 | 16.4.6 基线 git 化 + 空扩展脚手架可加载 |
| 1 | 规则包 + Injector + 默认纪律规则 |
| 2 | Signals + Evidence + 行为夹具 |
| 3 | Status panel / 可见性 |
| 4 | Codebase-memory autocontext（可选） |
| Later | 硬 tool-hook；PlanRun/严格路由若仍需要再单独立项 |

---

## 10. 路线图（明确不做进本轮）

以下能力**不删除历史文档**，但不进入本轮实现计划主路径：

- PlanRun 执行闭环
- Superpowers 多角色与 codebase-memory 强制门禁体系（重型）
- 严格角色模型绑定执行器 + 批量分配全链路
- Codex Adapter

若未来需要，必须单独规格，并证明不会把合规层再次做重。

---

## 11. 与旧规格关系

| 文档 | 状态 |
| --- | --- |
| `2026-07-12-omp-advisor-compliance-layer-design.md` | **当前权威** |
| `2026-07-12-omp-16.4.6-migration-follow-upstream-design.md` | **Superseded**：重型全量迁移归档，仅作历史与路线图参考 |
| `docs/PRD/2026-07-03-omp-custom-package-architecture.md` | 仍有参考价值，但本轮 omp-custom 范围收缩为合规层 |

---

## 12. 开放问题（实现计划关闭）

1. 面板挂载：扩展命令 vs 现有 `/advisor` UI 扩展点，以 16.4.6 实际 API 为准。
2. Signal 采集：纯 prompt 侧估计 vs extension 事件钩子的最小集合。
3. omp-custom 落点：独立仓 vs 临时 monorepo 包（默认倾向独立仓，但本轮以实现简单为先可 path 依赖）。

---

## 13. 批准记录

- 用户确认：自研过重，转向 Advisor 监管开发规则。
- 策略：中度瘦身；轻量替代而非 PlanRun/Superpowers 全套。
- 架构：Advisor 合规层（方案 2）。
- 分节批准：§1 架构、§2 组件、§3 流程、§4 测试分波。
- 总设计终批：2026-07-12（会话内用户确认）。
