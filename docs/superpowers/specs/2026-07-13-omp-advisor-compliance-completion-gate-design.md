# OMP Advisor 合规完成门设计

| 项目 | 内容 |
| --- | --- |
| 文档类型 | 设计规格（Design Spec） |
| 状态 | 已批准，待实现计划 |
| 日期 | 2026-07-13 |
| 目标基线 | 上游 `v16.4.6`（tag `20c0a2e4101d8507e7cbbaf547baa4f9f2340b73`） |
| 当前本地基线 | OMP `16.3.3`，仅作重型实现归档来源 |
| 取代 | `docs/superpowers/specs/2026-07-12-omp-advisor-compliance-layer-design.md` |
| 相关历史 | 严格角色路由、PlanRun、批量角色模型分配和其 Evidence 设计/实现 |
| 权威结论 | Advisor 是任务是否完成的唯一裁决者；严格路由体系不迁移到新基线 |

---

## 1. 决策摘要

OMP Custom 的主目标从“多角色、严格模型绑定、阶段化编排”调整为“让开发任务持续遵守 TDD 合同，并且只有在 Advisor 明确判定通过时才允许完成”。

本设计确认以下决定：

1. 从官方 `v16.4.6` 干净基线重建，不在当前 `16.3.3` 重型树上做大规模删除后再升级。
2. 当前重型分支在迁移开始时打归档 tag，保留只读参考，不迁移其运行时代码。
3. PlanRun、严格角色路由、角色模型批量分配、模型锁、阶段账本和旧路由 Evidence 不进入新基线。
4. 新能力位于独立薄扩展 `@bearmaxdd/omp-compliance`；主 fork 默认零核心补丁。
5. 每个任务显式绑定一份 TDD 文档；该原文是本任务的唯一合同源。
6. 主代理准备结束时必须调用 `compliance_complete`。
7. Advisor 是唯一的 `pass` / `remediate` 质量裁决者；确定性信号只能作为它的审查证据，不能自行判定任务通过或失败。
8. 未通过时，系统将 Advisor 给出的结构化修复项送回主代理，任务继续修复并重新核验，不设次数上限。
9. 没有实质进展的重复失败触发 `stalled` 保护；它不是完成，也不是质量裁决，只用于阻止无意义循环。
10. 若官方 `v16.4.6` 没有可供 Advisor 发送结构化 verdict 的扩展点，允许一处白名单核心补丁：向 Advisor 注入 `compliance_verdict` 并将其结果交给薄扩展。

---

## 2. 问题与边界

### 2.1 要解决的问题

当前开发流程的主要风险不是“子代理用了错误模型”，而是主代理可能：

- 未先写测试就修改生产代码；
- 测试、构建或类型检查失败后仍宣称完成；
- 修改超出已批准 TDD 文档的范围；
- 跳过计划中的验证命令；
- 引用了工作区中不存在的 API、配置或架构约束；
- 在没有完整证据的情况下结束任务。

这些风险本质上属于过程纪律、任务完成质量和上下文理解问题，适合由官方 Advisor 的旁路审阅能力处理。

### 2.2 不把 Advisor 误用为硬规则引擎

Advisor 的结论是质量裁决，但它必须建立在可复查事实之上。合规层只收集和归纳以下事实：

- 已修改路径及其粗粒度类别（生产、测试、文档、配置）；
- 已执行的工具和命令；
- 测试、构建、类型检查等命令的退出状态和摘要；
- 用户绑定 TDD 文档的原文、哈希和提炼摘要；
- 主代理发起完成请求时的工作区 diff 指纹。

合规层不得用“编辑生产文件但没见到测试”之类的规则直接把任务判定为失败。它只能把该事实交给 Advisor；只有 Advisor 的正式 verdict 决定任务进入 `completed` 或 `remediation_required`。

### 2.3 明确不做

- PlanRun 阶段状态机、执行账本、修复环或阶段调度；
- `task -> role -> exact model` 的严格角色路由；
- 角色模型批量分配、角色模型审计和模型锁；
- 子代理模型回退控制；
- 通过“没有 advisory”猜测任务已通过；
- 在首版使用 `tool_call` 对生产编辑进行硬阻断；
- 把完整聊天、密钥、完整 provider 响应写入合规 Evidence。

---

## 3. 现有能力依据

当前 OMP 代码已经具备合规层的核心底座：

| 现有能力 | 代码/文档位置 | 在本设计中的作用 |
| --- | --- | --- |
| Advisor 增量审阅 | `src/advisor/runtime.ts` | Advisor 在每个主代理 turn 后接收新 transcript delta |
| 工具和思考可见性 | `formatSessionHistoryMarkdown(... includeThinking/includeToolIntent ...)` | 让 Advisor 看到主代理推理、工具意图和工具结果 |
| 审阅工具 | `docs/advisor-watchdog.md` | 默认使用 `read`、`grep`、`glob` 和 `advise` |
| `WATCHDOG.md/yml` | `src/advisor/watchdog.ts` | 提供项目级审阅重点和 Advisor 配置 |
| `nit/concern/blocker` | `src/advisor/advise-tool.ts` | 为修复任务提供旁注或中断式纠偏 |
| Emission Guard | `src/advisor/emission-guard.ts` | 防止空话、重复 advice 和单周期刷屏 |
| 扩展工具事件 | `src/extensibility/extensions/*` | 采集 `tool_call`、`tool_result`、`turn_end` 等事实信号 |
| 任务完成前回传 | `AgentSession` steering / custom message | 将修复要求交还主代理 |

现有 Advisor 的 `advise` 是单向建议通道，不提供“审核通过”的机器可读语义。因此合规完成门必须引入显式 verdict 协议，不能用 silence、`nit` 或文本正则代替。

---

## 4. 目标架构

```text
用户
  │ /compliance start <tdd.md>
  ▼
@bearmaxdd/omp-compliance
  ├── Contract Loader
  ├── Session State
  ├── Signal Collector
  ├── Advisor Context Injector
  ├── Completion Gate
  ├── Evidence Store
  └── Status Panel / Command
       │
       │ 结构化事实 + TDD 合同
       ▼
官方 AdvisorRuntime
  ├── WATCHDOG.md/yml
  ├── read / grep / glob
  ├── advise(nit|concern|blocker)
  └── compliance_verdict(pass|remediate)
       │
       ├── pass -> completed
       └── remediate -> 主代理修复 -> 再次 compliance_complete
```

### 4.1 组件职责

| 组件 | 职责 | 不负责 |
| --- | --- | --- |
| Contract Loader | 加载 TDD 原文、提炼摘要、计算合同哈希 | 判定任务是否通过 |
| Session State | 保存 active/completing/remediating/stalled/completed 状态 | 多阶段编排或子任务 DAG |
| Signal Collector | 聚合路径、命令、退出码和完成请求快照 | 直接拦截或裁决 |
| Context Injector | 在 completion review 时给 Advisor 注入紧凑事实和合同定位 | 重写 Advisor 核心 prompt 或 transcript |
| Completion Gate | 请求 verdict、写入状态和把修复交还主代理 | 根据规则自行判定 pass/fail |
| Evidence Store | 追加可审计 verdict、摘要和指纹 | 保存敏感全文或 provider secrets |
| Status Surface | 展示当前任务、最近 verdict、修复项和 stalled 原因 | 替代现有 `/advisor status` |

### 4.2 核心与扩展的边界

优先使用 `v16.4.6` 的官方扩展 API、Advisor 配置和工具注册能力。迁移验证应首先确认 Advisor 能否获得一个扩展提供的结构化 verdict 工具或等价的受观察结果通道。

如果不存在该能力，允许唯一核心补丁：

```text
AdvisorRuntime 建造 Advisor 工具集合时：
  当 omp-compliance 启用 -> 注入 ComplianceVerdictTool
  ComplianceVerdictTool -> 调用 extension 的 verdict sink
```

补丁约束：

- 只添加 `compliance_verdict`，不改 `AdvisorRuntime` 的 delta、重试、emission guard 或模型路由语义；
- 扩展关闭时工具不存在，官方 Advisor 行为完全不变；
- 补丁在 fork 中有单独文档、测试和升级冲突检查；
- 不向 Advisor 授予写、exec、浏览器或主代理状态修改能力。

---

## 5. TDD 合同

### 5.1 绑定方式

每个任务必须显式开始：

```text
/compliance start docs/superpowers/plans/2026-07-13-feature-tdd.md
```

该命令完成：

1. 解析并存储规范化的绝对/项目相对 TDD 路径；
2. 读取原文并计算 `contract_hash`；
3. 生成有长度上限的摘要；
4. 创建唯一 `task_id`；
5. 将任务状态置为 `active`；
6. 向主代理和 Advisor 发送“此任务受合规完成门约束”的短提示。

### 5.2 原文优先

TDD 文档原文始终是合同源。摘要仅帮助减少 token 和驱动状态面板。Advisor 需要时必须能用只读工具读取原文。

首版识别常见 Markdown 结构：

- 目标与范围；
- 修改/创建文件；
- 测试先行步骤；
- 验证命令及预期；
- 完成或验收条件。

如果文档没有可提炼结构，状态标记为 `contract_summary_incomplete`，但任务仍可进行。Advisor 在完成审查时被明确要求读取原文并自行解释，而不是把提取失败当作通过或失败。

### 5.3 合同不可变性

任务运行期间保存 `contract_hash`。TDD 原文发生变化时：

- 下一次 `compliance_complete` 检测哈希变化；
- Advisor 收到原合同哈希、新哈希和变更摘要；
- Advisor 决定合同变更是否合理；
- Evidence 记录新版本；
- 不允许静默用修改后的文档覆盖先前审查语境。

---

## 6. 任务状态机与无限修复循环

```text
inactive
  -> active                    (/compliance start)
  -> completion_requested      (compliance_complete)
  -> advisor_reviewing
  -> completed                 (Advisor verdict: pass)
  -> remediation_required      (Advisor verdict: remediate)
  -> active                    (修复任务已注入主代理)
  -> stalled                   (无进展重复失败)
  -> active                    (用户补充方向或出现实质进展)
```

### 6.1 `compliance_complete`

主代理不能自行用自然语言将受管任务标记完成。它必须调用：

```text
compliance_complete({ summary, claimed_verification? })
```

调用后，Completion Gate 创建一个 completion snapshot，包括：

- 当前 TDD 路径和合同哈希；
- 自上次 verdict 以来的工具/命令摘要；
- 工作区 diff 指纹与变更路径；
- 主代理提交的完成摘要；
- 先前 remediation 的完成情况。

Gate 向 Advisor 发出专门的 completion review 请求，并等待结构化 verdict。此期间状态为 `advisor_reviewing`，主代理不能得到完成确认。

### 6.2 Advisor 唯一裁决

Advisor 只能通过以下结构返回审查结论：

```ts
interface ComplianceVerdict {
  schema_version: 1;
  task_id: string;
  contract_hash: string;
  status: "pass" | "remediate";
  summary: string;
  findings: Array<{
    rule_id: string;
    reason: string;
    required_fix: string;
    evidence_refs?: string[];
  }>;
}
```

规则：

- 只有 `status: "pass"` 可以把任务写入 `completed`；
- `status: "remediate"` 必须至少包含一条 `required_fix`；
- 无 verdict、格式无效、task ID 或合同哈希不匹配时，不通过，也不视为失败裁决；状态保留 `advisor_reviewing` 并按 Advisor 运行时的失败策略处理；
- 合规层不从测试退出码、路径范围或 Advisor 是否沉默推断通过；
- Advisor 可使用 `advise(concern|blocker)` 向主代理解释修复紧急性，但任务状态只由 `ComplianceVerdict` 改变。

### 6.3 无限修复与无进展保护

修复循环没有次数上限。每次 remediation 后，主代理继续工作并重新调用 `compliance_complete`。

为避免纯重复消耗，系统计算每次未通过审查的无进展指纹：

```text
worktree_diff_hash + normalized_findings + verification_result_hash + contract_hash
```

如果连续出现相同指纹且没有工作区、验证结果或合同的实质变化，状态切换为 `stalled`。`stalled`：

- 不是 `pass`；
- 不是 Advisor 对质量的完成裁决；
- 不自动向主代理伪造新修复工作；
- 等待用户补充目标、修改合同、手动恢复或中止任务。

任何实质变化都会清除 stalled 判定并恢复 `active`。

---

## 7. Advisor 审查协议

### 7.1 Completion Review 上下文

当 `compliance_complete` 被调用，Injector 向 Advisor 提供短且稳定的结构：

```text
<compliance-task>
task_id: ...
tdd_path: ...
contract_hash: ...
contract_summary: ...
changed_paths: ...
verification_summary: ...
prior_remediation: ...
completion_claim: ...
</compliance-task>
```

Advisor 系统提示补充规则：

1. 必须先核对 TDD 原文、工作区和证据，再给 verdict；
2. 证据不充分时使用 `remediate`，并明确需要补什么；
3. 不得用“看起来不错”“LGTM”“继续”等空话替代 verdict；
4. 不得因为检测到某个事实信号而绕过整体语义审查；
5. `pass` 表示任务符合绑定 TDD 合同，而不是仅代表命令曾经成功；
6. 若 TDD 文档在执行中变更，必须评估变更对合同的影响。

### 7.2 规则包

`WATCHDOG.md/yml` 继续承担项目特定审查重点。薄扩展提供一个默认合规规则包，给 Advisor 提醒：

- 检查测试是否能覆盖新增或修改行为；
- 检查宣称完成前的验证证据；
- 检查变更是否超出 TDD 合同范围；
- 检查 API、配置和路径是否在工作区真实存在；
- 检查之前 remediation 是否确实关闭。

这些规则是 Advisor 的审查准则，不是合规层自行触发 pass/fail 的 if/else。

### 7.3 权限

Advisor 默认工具集保持：

```text
read, grep, glob, advise, compliance_verdict
```

不授予 `edit`、`write`、`bash`、`eval`、`task`、浏览器或其他副作用工具。质量审查和修复执行严格分离：Advisor 决定并解释，主代理修复。

---

## 8. 信号、Evidence 与状态面板

### 8.1 Signal Collector

扩展订阅官方事件：

- `session_start`：恢复或初始化 task state；
- `tool_call`：记录工具名、路径或命令意图摘要；
- `tool_result`：记录退出状态、路径结果和有限长度输出摘要；
- `turn_end`：更新最近活动摘要；
- `agent_end`：只刷新显示，不自动判定完成。

信号保留最小必要信息。命令输出按字节数截断并做敏感字段脱敏；大文件内容、完整聊天和密钥不写入合规存储。

### 8.2 Evidence JSONL

每次状态变化和 Advisor verdict 追加一条记录：

```json
{
  "schema_version": "omp.compliance.evidence.v1",
  "ts": "2026-07-13T00:00:00.000Z",
  "task_id": "task_...",
  "event": "completion_requested | verdict | remediation | stalled | completed",
  "tdd_document": "docs/.../task-tdd.md",
  "contract_hash": "sha256:...",
  "attempt": 7,
  "signal_digest": {
    "changed_paths": ["packages/example/src/a.ts"],
    "verification_commands": [{ "command": "bun test ...", "exit_code": 0 }]
  },
  "advisor_verdict": {
    "status": "remediate",
    "finding_count": 1
  },
  "worktree_fingerprint": "sha256:..."
}
```

Evidence 路径建议为项目私有运行目录：

```text
.omp/compliance/tasks/<task_id>/evidence.jsonl
.omp/compliance/tasks/<task_id>/state.json
```

项目可选择把这些文件加入版本控制；默认不要求提交，以免把运行历史混入产品代码。

### 8.3 Status Surface

新增：

```text
/compliance status
/compliance history
/compliance resume <task_id>
/compliance stop
```

状态视图至少展示：

- 当前 TDD 路径与合同哈希短码；
- `active`、`advisor_reviewing`、`remediation_required`、`stalled` 或 `completed`；
- 最近 verdict 和 required fixes；
- 当前 attempt；
- Advisor 模型和运行状态；
- 最近验证命令摘要。

---

## 9. 迁移与归档策略

### 9.1 归档当前实现

在任何迁移前，为当前重型树创建不可变归档引用，例如：

```text
archive/strict-runtime-2026-07-13
```

归档保留：

- 历史 PRD、TRD、TDD；
- 严格角色路由、PlanRun、模型锁和旧 Evidence 实现；
- 可视化草图与对应提交；
- 已有测试和行为参考。

归档不再接收功能开发。安全或严重构建问题仅在需要时以独立修复提交处理。

### 9.2 新基线

从官方 `v16.4.6` 创建干净工作分支：

```text
upstream/v16.4.6
  -> BearMaxDD main
  -> 安装 @bearmaxdd/omp-compliance
```

迁移验证顺序：

1. 官方 `v16.4.6` 的 Advisor、WATCHDOG、扩展加载和测试基线可运行；
2. 验证 Advisor 是否有无补丁 verdict 工具/观察接口；
3. 若无，实施唯一白名单核心补丁并用 upstream 行为回归测试覆盖；
4. 安装空扩展，验证关闭扩展时 OMP 完全正常；
5. 再按实现计划逐步加入任务合同、信号、verdict 和状态面板。

### 9.3 独立仓库

长期推荐：

```text
BearMaxDD/omp-custom
```

该仓库只维护 `@bearmaxdd/omp-compliance`、规则包、测试夹具、升级 runbook 和文档。OMP fork 仅保留：

- 官方上游同步；
- 扩展安装/接线；
- 可能存在的单一 `compliance_verdict` 白名单补丁。

---

## 10. 错误处理与降级

| 场景 | 行为 |
| --- | --- |
| Advisor 未启用或没有可用模型 | 不能执行 `compliance_complete`；任务保持 active，提示配置 Advisor |
| Advisor 运行失败 | 保持 `advisor_reviewing`，遵循官方重试；不默认通过 |
| verdict 无效或不匹配 | 记录协议错误，保持 `advisor_reviewing`，不默认通过 |
| TDD 文档丢失 | 任务暂停为 `stalled`，要求重新绑定合同或恢复文件 |
| 摘要提取失败 | Advisor 直接读取原文，仍可裁决 |
| Evidence 写入失败 | 运行时内存缓冲并发出可见警告；不得把未持久化 evidence 当作 completed |
| 同一失败无进展重复 | 进入 `stalled`，等待用户输入 |
| 扩展加载失败或被关闭 | OMP 和官方 Advisor 正常工作；没有受管任务完成门 |

---

## 11. 测试与验收

### 11.1 单元测试

- TDD 路径校验、合同哈希和摘要提取；
- task state 合法迁移；
- signal 脱敏、截断和指纹稳定性；
- verdict schema 校验；
- remediation 注入；
- stalled 判定和实质变更后的恢复；
- Evidence JSONL 追加与恢复；
- 状态面板模型。

### 11.2 Advisor 协议测试

- `pass` 是唯一完成入口；
- silence、`nit`、`concern` 或仅命令成功不能完成任务；
- `remediate` 没有 `required_fix` 时 verdict 被拒绝；
- 合同哈希不匹配时 verdict 被拒绝；
- Advisor 只能使用只读工具和 `compliance_verdict`；
- emission guard 仍会抑制重复空话，但不吞掉合法 verdict。

### 11.3 行为夹具

| 场景 | 预期 |
| --- | --- |
| 只改生产代码、未补测试 | Advisor 给出 remediate 和明确测试修复项 |
| 测试失败仍调用 complete | Advisor 给出 remediate |
| 范围超出 TDD | Advisor 判断是否需要 remediate，并说明范围证据 |
| TDD 摘要不完整 | Advisor 读取原文后仍能作出 verdict |
| 完整实现、测试和验证 | Advisor 发出 pass，任务进入 completed |
| 多次修复后通过 | 记录连续 attempts，最终 completed |
| 同一失败无变化 | 进入 stalled，不完成 |
| 扩展关闭 | OMP 正常运行，未出现完成门副作用 |

### 11.4 上游升级回归

每次升级 `v16.x`：

1. 运行官方 Advisor 相关测试；
2. 运行 compliance 扩展单元和行为夹具；
3. 验证扩展关闭；
4. 验证 `pass`、`remediate` 和 `stalled`；
5. 若有白名单补丁，检查其 diff 是否仍只覆盖 verdict 接线点。

---

## 12. 完成定义

以下条件全部满足，才算完成本设计：

1. 新 fork 基线来自官方 `v16.4.6`，当前 `16.3.3` 重型树已归档；
2. 严格路由、PlanRun、角色批量分配和旧 Evidence 没有迁移到新基线；
3. 任务可显式绑定 TDD 文档；
4. TDD 原文和合同哈希在整个任务中可追溯；
5. 主代理只能通过 `compliance_complete` 请求完成；
6. Advisor 能以结构化 `ComplianceVerdict` 唯一决定 pass/remediate；
7. pass 是唯一 `completed` 入口；
8. remediate 自动让主代理接收结构化修复任务并继续循环；
9. 无次数上限，但无实质进展时安全进入 stalled；
10. Evidence 和状态面板可解释当前结论；
11. Advisor 默认保持只读；
12. 扩展关闭后官方 OMP 不受影响；
13. 若存在核心补丁，它只服务于 `compliance_verdict` 接线并已被独立测试。

---

## 13. 后续交接

本规格已经完成产品和技术边界确认。下一步只能先基于本文件生成 TDD 实现计划；在实现计划批准前，不进行 v16.4.6 迁移、归档 tag、删除旧体系、创建新仓库或改动 OMP 核心。
