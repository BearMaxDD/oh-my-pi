# OMP Advisor 合规完成门 TDD 实现计划

> **面向执行代理：** 必须按本计划逐任务执行。每个代码任务开始前，先通过 codebase-memory MCP 获取当前目标仓库的图谱、符号和源码/调用链证据；每个受管代码任务还必须通过官方 `task` 工具委派至少一个实际子代理。不得把主代理口述、普通文本搜索或空 TaskTool 调用当作证据。完成一项后更新勾选状态、保存命令输出摘要，并在提交前完成该项验证。

**目标：** 以官方 `v16.4.6` 为干净基线，交付独立包 `@bearmaxdd/omp-compliance`。它让每个受管开发任务显式绑定 TDD 文档，采集最小必要的 codebase-memory 与官方 `task` 子代理事实，并且只能由 Advisor 的结构化 `ComplianceVerdict` 将任务判为通过；未通过自动回送修复任务，无次数上限，无实质进展时进入 `stalled`。

**架构：** 新建独立仓库 `/Users/mima1234/Code/super/omp-custom` 维护扩展、规则包、测试夹具和升级 runbook；`/Users/mima1234/Code/super/oh-my-pi` 仅保留上游同步、扩展接线，以及在官方扩展 API 无法把 Advisor verdict 送回扩展时的唯一白名单桥接补丁。扩展以 `ExtensionAPI` 注册命令与 `compliance_complete` 工具，以 `tool_call` / `tool_result` 采集证据，以 session state + JSONL 持久化任务生命周期。Advisor 自身仍是只读审阅者，`pass | remediate` 是唯一质量裁决。

**技术栈：** TypeScript、Bun、`bun:test`、Biome、tsgo、OMP `ExtensionAPI`、`ExtensionRunner`、官方 `TaskTool`、AdvisorRuntime、codebase-memory MCP、JSONL。

---

## 1. 计划依据、代码图谱与范围锁定

### 1.1 已核对的真实代码锚点

本计划基于已批准规格 [2026-07-13-omp-advisor-compliance-completion-gate-design.md](../specs/2026-07-13-omp-advisor-compliance-completion-gate-design.md)，并在当前树重新索引 `Users-mima1234-Code-super-oh-my-pi` 后确认下列边界。执行迁移时必须在 `v16.4.6` 工作树重新确认这些同名符号；不能因当前 `16.3.3` 的路径仍可用而跳过探测。

| 链路 | 当前真实锚点 | 已确认行为 | 本计划的使用方式 |
| --- | --- | --- | --- |
| Advisor 建造 | `packages/coding-agent/src/session/agent-session.ts` 的 `AgentSession.#buildAdvisorRuntime()` | Advisor Agent 的工具集合是 `[adviseTool, ...advisorTools]`，默认不会取得主代理的扩展工具 | 先探测是否存在无补丁 verdict 注入点；没有才执行唯一桥接补丁 |
| Advisor 建议回送 | `AgentSession.#routeAdvice()` | `nit/concern/blocker` 只是一条建议/steer 通道 | 不把 silence 或 `advise` 文本当 verdict |
| Advisor 增量循环 | `packages/coding-agent/src/advisor/runtime.ts` 的 `AdvisorRuntime.#drain()` | 每个主代理更新进入 Advisor，运行失败有重试与 backlog 保护 | 保持 delta、重试和 Emission Guard 行为不变 |
| 扩展 API | `src/extensibility/extensions/types.ts` 的 `ExtensionAPI` | 支持 `registerTool`、`registerCommand`、`on(session_start|turn_end|tool_call|tool_result|agent_end)`、`sendMessage`、`appendEntry` | 所有业务能力优先写在独立扩展中 |
| 工具事件 | `src/extensibility/extensions/wrapper.ts` 的 `ExtensionToolWrapper.execute()` | 执行前触发 `tool_call`，结果后触发 `tool_result`，自定义/MCP 工具以 `toolName: string` 出现 | 被动采集 MCP 与 TaskTool 事实，首版不阻断生产编辑 |
| 事件派发 | `src/extensibility/extensions/runner.ts` 的 `emitToolCall()`、`emitToolResult()` | 扩展可读事件；`tool_call` 技术上可 block | 合规层只观察并记录，不基于确定性规则自行 pass/fail |
| MCP 桥接 | `src/mcp/tool-bridge.ts` 的 `DeferredMCPTool.execute()` 和 `createMCPToolName()` | MCP 调用最终是普通自定义工具事件，结果包含 `details` | 归一化 `codebase-memory` 的 index、搜索、源码/调用链证据 |
| 官方子代理 | `src/task/index.ts` 的 `TaskTool.execute()`、`TaskTool.#runSpawn()` | 普通 `task` 调用会启动官方子代理并返回任务详情 | 只识别通用 TaskTool，不带入角色模型强绑定 |
| 子代理结束 | `src/task/executor.ts` 的 `runSubagent()` | 生命周期包含 agent id、退出码、失败原因、时长和会话工件 | 把真实委派及其输出引用折叠为 Evidence |
| 扩展加载 | `src/extensibility/extensions/loader.ts` 的 `discoverAndLoadExtensions()` | 项目 `.omp/extensions`、用户扩展、配置路径及包清单均可发现 | 独立包通过 `omp.extensions` 清单安装，支持关闭后完全无副作用 |

### 1.2 目标仓库与提交边界

| 仓库 | 绝对路径 | 允许变更 | 明确禁止 |
| --- | --- | --- | --- |
| OMP fork | `/Users/mima1234/Code/super/oh-my-pi` | upstream `v16.4.6` 同步、扩展安装示例、必要时单一 `compliance_verdict` 桥接补丁及其测试 | 迁移严格路由、PlanRun、批量角色分配、模型锁、旧路由 Evidence |
| 独立扩展 | `/Users/mima1234/Code/super/omp-custom` | `@bearmaxdd/omp-compliance` 源码、规则包、单测、行为夹具、发布与升级文档 | fork 的通用 CLI、模型路由或 Provider 改造 |
| 当前重型实现 | 当前 `oh-my-pi` 的归档 tag | 只读对照、历史追溯 | 在 tag 之后继续增加功能 |

### 1.3 受管任务的固定定义

```ts
type ComplianceTaskKind = "code" | "non_code";

interface ComplianceExecutionPolicy {
	taskKind: ComplianceTaskKind;
	requiresCodebaseMcp: boolean;
	requiresSubagentDelegation: boolean;
}
```

- `code` 默认两个 `requires*` 都为 `true`。
- `non_code` 只有在 TDD 原文或 `/compliance start` 显式豁免且 Advisor 在 verdict 中接受豁免理由时，才允许为 `false`。
- 缺少所需证据时，Collector 只记录事实；Advisor 必须返回 `remediate`，不能由本地 if/else 直接把任务判失败或判通过。

### 1.4 明确不在本计划中

- 严格 `task -> role -> exact model` 路由、角色模型批量分配、模型锁或 fallback 禁止；
- PlanRun、阶段账本、阶段调度、子任务 DAG、旧路由 Evidence；
- 用测试退出码、路径匹配、没有 advice 或文本正则直接计算 `pass`；
- Advisor 的写文件、执行 shell、浏览器、`task`、编辑或模型选择权限；
- 把完整聊天、密钥、完整 Provider 响应写进 `.omp/compliance`；
- 对所有普通聊天强制启动完成门。没有 `/compliance start` 的会话保持官方 OMP 行为。

---

## 2. 统一执行前置条件

在开始下列任意代码任务前，执行者必须在对应仓库记录以下证据；若索引陈旧或不存在，先调用 `index_repository`，而不是回退到纯文本搜索。

1. `index_status` 或 `index_repository`：确认目标 repo 已就绪；
2. `search_graph` 或 `search_code`：定位本任务涉及的符号；
3. `get_code_snippet` 或 `trace_path`：读取至少一个实现或调用链；
4. 将项目名、符号、文件与摘要写入子代理任务回报；
5. 对 `code` 任务，主代理用官方 `task` 发出至少一个清晰、可验证的子代理单元，并保留 agent id、任务摘要、退出状态与 codebase 引用。

建议的图谱查询形状：

```text
search_graph(query="ExtensionAPI registerTool tool_call tool_result")
search_graph(query="AgentSession buildAdvisorRuntime AdviseTool")
trace_path(function_name="<查询返回的 qualified name>", direction="both", mode="calls")
get_code_snippet(qualified_name="<查询返回的 qualified name>")
```

每一任务的提交均使用中文 Conventional Commit，并且只暂存该任务列出的文件。不要把 `.superpowers/brainstorm/*/state/`、用户未提交变更或运行 Evidence 混入提交。

---

## 3. 任务 1：归档重型树并建立 v16.4.6 可重复基线

**仓库：** `/Users/mima1234/Code/super/oh-my-pi`

**文件：**

- 创建：`docs/superpowers/migrations/2026-07-13-v16.4.6-compliance-baseline.md`
- 修改：`README.md`（仅增加扩展安装入口的短链接；不得复制实现说明）
- 不迁移：`packages/coding-agent/src/codex-plan-run/**`、严格路由/模型锁相关文件、`test/task/strict-role-*.test.ts`

**目标：** 把当前 `16.3.3` 重型树保存为可追溯历史，从官方 `v16.4.6` 创建新的工作线，并把“空扩展关闭时官方行为不变”变为可复验基线。

- [ ] **步骤 1：先验证归档点和上游 tag，写失败的基线断言脚本**

创建一个仅做只读检查的 shell 脚本片段，断言下列条件；在切换前它应因 `HEAD` 尚非 `v16.4.6` 而失败：

```bash
test "$(git rev-parse HEAD)" = "$(git rev-parse upstream/v16.4.6)"
bun --cwd=packages/coding-agent run check:types
bun test packages/coding-agent/test/advisor/advisor-visibility.test.ts
```

运行：

```bash
git fetch upstream --tags
git show-ref --verify --quiet refs/tags/v16.4.6
git describe --tags --always HEAD
```

预期：tag 存在；当前重型树不能通过 `HEAD == upstream/v16.4.6` 断言。

- [ ] **步骤 2：创建不可变归档引用和隔离新工作树**

先检查 tag 是否已存在且指向当前 HEAD；只在一致或不存在时创建，避免覆盖历史：

```bash
git tag -a archive/strict-runtime-2026-07-13 -m "归档：严格路由与 PlanRun 重型实现"
git push origin archive/strict-runtime-2026-07-13
git worktree add ../oh-my-pi-v16.4.6-compliance -b mima/omp-compliance-v16.4.6 upstream/v16.4.6
```

在新 worktree 中核验 `packages/coding-agent/package.json` 的版本、Advisor/扩展/TaskTool 文件和测试命令。若 `v16.4.6` 文件路径或 API 已变化，更新本计划的迁移记录和后续锚点，再继续；不得从归档分支拷贝运行时代码来“对齐”版本。

- [ ] **步骤 3：在新基线写最小 smoke 测试/脚本说明**

在迁移说明中记录以下命令及预期输出：

```bash
bun install --frozen-lockfile
bun --cwd=packages/coding-agent run check:types
bun test packages/coding-agent/test/advisor/advisor-visibility.test.ts
bun test packages/coding-agent/test/extensibility
bun test packages/coding-agent/test/task/task-spawn.test.ts
```

说明必须列出本计划不迁移的四类能力，并说明新 worktree 在此阶段不含合规扩展。

- [ ] **步骤 4：运行基线验证，确认通过**

运行步骤 3 的命令及：

```bash
git diff --exit-code upstream/v16.4.6 -- packages/coding-agent/src/codex-plan-run
git diff --exit-code upstream/v16.4.6 -- packages/coding-agent/src/task/model-routing.ts
```

预期：所有官方基线测试通过；两个 diff 为空；归档 tag 可解析；新分支基于 v16.4.6。

- [ ] **步骤 5：提交迁移记录**

```bash
git add docs/superpowers/migrations/2026-07-13-v16.4.6-compliance-baseline.md README.md
git commit -m "文档：建立 v16.4.6 合规扩展基线"
```

---

## 4. 任务 2：创建独立包、可安装清单和关闭扩展回归

**仓库：** `/Users/mima1234/Code/super/omp-custom`

**文件：**

- 创建：`package.json`、`bun.lock`、`tsconfig.json`、`biome.json`
- 创建：`packages/omp-compliance/package.json`
- 创建：`packages/omp-compliance/src/extension.ts`
- 创建：`packages/omp-compliance/src/index.ts`
- 创建：`packages/omp-compliance/test/extension-loading.test.ts`
- 创建：`packages/omp-compliance/test/support/fake-extension-api.ts`
- 创建：`README.md`、`docs/install-local.md`

**目标：** 建立唯一发布物 `@bearmaxdd/omp-compliance`，它通过 `omp.extensions` 声明入口，既可作为项目 `.omp/extensions` 下的本地包加载，也可通过 OMP 设置显式加载；禁用或未安装时不改变官方 OMP。

- [ ] **步骤 1：先写失败的包清单与加载测试**

```ts
import { describe, expect, it } from "bun:test";
import manifest from "../package.json";
import extension from "../src/extension";
import { createFakeExtensionApi } from "./support/fake-extension-api";

describe("omp-compliance extension packaging", () => {
	it("声明可被 OMP 扩展发现的唯一入口", () => {
		expect(manifest.name).toBe("@bearmaxdd/omp-compliance");
		expect(manifest.omp).toEqual({ extensions: ["./dist/extension.js"] });
	});

	it("加载后只注册合规命令和完成工具，不改写内置工具", () => {
		const api = createFakeExtensionApi();
		extension(api);
		expect(api.commands()).toEqual(expect.arrayContaining(["compliance"]));
		expect(api.tools()).toEqual(expect.arrayContaining(["compliance_complete"]));
		expect(api.blockedToolCalls()).toHaveLength(0);
	});
});
```

运行：

```bash
bun --cwd=packages/omp-compliance test test/extension-loading.test.ts
```

预期：FAIL，因为独立 workspace、清单和入口尚不存在。

- [ ] **步骤 2：实现最小 workspace 与 ExtensionAPI 入口**

`packages/omp-compliance/package.json` 固定：

```json
{
  "name": "@bearmaxdd/omp-compliance",
  "version": "0.1.0",
  "type": "module",
  "exports": { ".": "./dist/index.js", "./extension": "./dist/extension.js" },
  "omp": { "extensions": ["./dist/extension.js"] },
  "peerDependencies": { "@oh-my-pi/pi-coding-agent": "16.4.x" }
}
```

入口只注册占位命令、占位完成工具和无副作用事件订阅，所有业务逻辑留给后续任务。`fake-extension-api.ts` 必须以严格的最小接口模拟 `registerTool`、`registerCommand`、`on`、`sendMessage` 和 `appendEntry`，而不是 mock 整个 OMP。

- [ ] **步骤 3：补充真实安装 smoke 测试**

在临时项目中以 `bun pack` 安装包，写入 `.omp/extensions/omp-compliance/package.json`，然后在新 v16.4.6 worktree 中运行一次扩展发现测试。测试需同时覆盖：

```text
未安装/--no-extensions：没有 compliance 工具和命令
已安装：发现 extension entry，但尚无受管任务时不发送消息、不写 .omp/compliance
```

可复用 upstream `packages/coding-agent/test/extensibility/*` 的加载 helper；不要把测试复制到 OMP fork 的产品测试树。

- [ ] **步骤 4：运行通过验证**

```bash
bun --cwd=packages/omp-compliance test test/extension-loading.test.ts
bun --cwd=packages/omp-compliance run check
bun --cwd=packages/omp-compliance run build
```

再在 `../oh-my-pi-v16.4.6-compliance` 中运行扩展加载 smoke。预期：加载和关闭两条路径都通过，关闭路径的工具清单与官方基线一致。

- [ ] **步骤 5：提交**

```bash
git add package.json bun.lock tsconfig.json biome.json README.md docs/install-local.md packages/omp-compliance
git commit -m "构建：初始化 OMP 合规扩展独立包"
```

---

## 5. 任务 3：TDD 合同解析、哈希与执行政策

**仓库：** `/Users/mima1234/Code/super/omp-custom`

**文件：**

- 创建：`packages/omp-compliance/src/contract/types.ts`
- 创建：`packages/omp-compliance/src/contract/load-contract.ts`
- 创建：`packages/omp-compliance/src/contract/markdown-summary.ts`
- 创建：`packages/omp-compliance/src/contract/execution-policy.ts`
- 创建：`packages/omp-compliance/test/contract/load-contract.test.ts`
- 创建：`packages/omp-compliance/test/contract/execution-policy.test.ts`
- 创建：`packages/omp-compliance/test/fixtures/contracts/{code-task,non-code-exempt,unstructured}.md`

**目标：** `/compliance start <tdd.md>` 可加载项目内 TDD，保存规范化相对路径、原文 SHA-256、受限摘要和可解释的执行政策；原文始终是合同源，摘要不完整不是本地失败裁决。

- [ ] **步骤 1：写失败的合同测试**

```ts
it("代码合同默认要求图谱和子代理证据", async () => {
	const contract = await loadComplianceContract(fixture("code-task.md"), repoRoot);
	expect(contract.policy).toEqual({
		taskKind: "code",
		requiresCodebaseMcp: true,
		requiresSubagentDelegation: true,
	});
	expect(contract.contractHash).toMatch(/^sha256:/);
	expect(contract.tddPath).toBe("docs/plans/code-task.md");
});

it("只有显式声明的非代码合同才可豁免", async () => {
	const contract = await loadComplianceContract(fixture("non-code-exempt.md"), repoRoot);
	expect(contract.policy).toEqual({
		taskKind: "non_code",
		requiresCodebaseMcp: false,
		requiresSubagentDelegation: false,
	});
});

it("无结构 Markdown 保留原文并标记摘要不完整", async () => {
	const contract = await loadComplianceContract(fixture("unstructured.md"), repoRoot);
	expect(contract.summaryStatus).toBe("incomplete");
	expect(contract.sourceText.length).toBeGreaterThan(0);
});
```

运行：

```bash
bun --cwd=packages/omp-compliance test test/contract/load-contract.test.ts test/contract/execution-policy.test.ts
```

预期：FAIL，模块不存在。

- [ ] **步骤 2：实现最小合同域模型**

实现以下稳定字段，不引入 PlanRun 的 stage、角色或模型字段：

```ts
interface ComplianceContract {
	taskId: string;
	tddPath: string;
	contractHash: `sha256:${string}`;
	sourceText: string;
	summary: ContractSummary;
	summaryStatus: "complete" | "incomplete";
	policy: ComplianceExecutionPolicy;
}
```

路径必须拒绝 repo root 外的绝对路径、符号链接逃逸和缺失文件；但错误应是 `ContractLoadError`，由上层转为 `stalled`，不是无声 fallback。摘要提取只识别目标、范围、文件、测试、验证、完成条件；保留上限并记录截断标识。

- [ ] **步骤 3：加入合同变更检测测试**

在读取初始合同后修改 fixture，断言 `compareContractRevision()` 返回旧/新 hash 与有限变更摘要；不能静默替换先前 hash。

- [ ] **步骤 4：运行通过验证**

```bash
bun --cwd=packages/omp-compliance test test/contract
bun --cwd=packages/omp-compliance run check
```

预期：代码默认政策正确，明确非代码豁免保持可审计，未结构化文档仍可被 Advisor 读取原文。

- [ ] **步骤 5：提交**

```bash
git add packages/omp-compliance/src/contract packages/omp-compliance/test/contract packages/omp-compliance/test/fixtures/contracts
git commit -m "功能：增加合规 TDD 合同与执行政策"
```

---

## 6. 任务 4：任务状态机、JSONL Evidence 与 stalled 保护

**仓库：** `/Users/mima1234/Code/super/omp-custom`

**文件：**

- 创建：`packages/omp-compliance/src/state/types.ts`
- 创建：`packages/omp-compliance/src/state/task-state-machine.ts`
- 创建：`packages/omp-compliance/src/evidence/evidence-store.ts`
- 创建：`packages/omp-compliance/src/evidence/redaction.ts`
- 创建：`packages/omp-compliance/src/evidence/fingerprint.ts`
- 创建：`packages/omp-compliance/test/state/task-state-machine.test.ts`
- 创建：`packages/omp-compliance/test/evidence/evidence-store.test.ts`
- 创建：`packages/omp-compliance/test/evidence/fingerprint.test.ts`

**目标：** 提供 `inactive -> active -> completion_requested -> advisor_reviewing -> completed|remediation_required|stalled` 的唯一状态机，持久化为 `.omp/compliance/tasks/<task_id>/state.json` 与追加式 `evidence.jsonl`；`stalled` 仅阻止无意义循环，绝不伪装为质量 verdict。

- [ ] **步骤 1：写失败的状态转换测试**

```ts
it("只有有效 pass verdict 能完成任务", () => {
	const state = activeTask();
	expect(transition(state, { type: "completion_requested" }).status).toBe("advisor_reviewing");
	expect(transition(state, { type: "advisor_silent" }).status).not.toBe("completed");
	expect(transition(state, verdict({ status: "pass" })).status).toBe("completed");
});

it("连续无变化 remediation 进入 stalled，但实质变化可恢复", () => {
	const first = remediationState({ fingerprint: "same" });
	expect(transition(first, remediation({ fingerprint: "same" })).status).toBe("stalled");
	expect(transition(stalledState(), activity({ worktreeFingerprint: "changed" })).status).toBe("active");
});
```

- [ ] **步骤 2：运行测试验证失败**

```bash
bun --cwd=packages/omp-compliance test test/state/task-state-machine.test.ts test/evidence/evidence-store.test.ts
```

预期：FAIL，状态机与 store 尚不存在。

- [ ] **步骤 3：实现最小状态与 Evidence 写入**

`EvidenceRecord` 必须含 `schema_version`、时间、task id、合同路径/hash、attempt、状态事件、signal digest、可选 verdict 摘要和工作树指纹。输出与命令摘要按字节上限截断，使用 `redaction.ts` 删除 API key、Authorization、token、cookie 等模式；不要保存原始聊天或 provider 响应。

无进展 fingerprint 固定为：

```text
sha256(worktree_diff_hash + normalized_findings + verification_result_hash + contract_hash)
```

`remediate` 必须至少一个 `required_fix`。无 verdict、schema 失败、task/hash 不匹配保持 `advisor_reviewing` 并写协议错误 Evidence，不可完成。

- [ ] **步骤 4：补充崩溃恢复和原子性测试**

覆盖 JSONL 追加后重新实例化、state 原子写临时文件替换、损坏末尾行容错读取、Evidence 写失败时内存 pending buffer 与可见 warning。验证不得因为 Evidence 持久化失败把任务改为 `completed`。

- [ ] **步骤 5：运行通过验证**

```bash
bun --cwd=packages/omp-compliance test test/state test/evidence
bun --cwd=packages/omp-compliance run check
```

- [ ] **步骤 6：提交**

```bash
git add packages/omp-compliance/src/state packages/omp-compliance/src/evidence packages/omp-compliance/test/state packages/omp-compliance/test/evidence
git commit -m "功能：增加合规状态机与审计证据"
```

---

## 7. 任务 5：采集 codebase-memory MCP 与官方 TaskTool 证据

**仓库：** `/Users/mima1234/Code/super/omp-custom`

**文件：**

- 创建：`packages/omp-compliance/src/signals/types.ts`
- 创建：`packages/omp-compliance/src/signals/tool-event-collector.ts`
- 创建：`packages/omp-compliance/src/signals/codebase-memory.ts`
- 创建：`packages/omp-compliance/src/signals/task-delegation.ts`
- 创建：`packages/omp-compliance/src/signals/verification.ts`
- 创建：`packages/omp-compliance/test/signals/tool-event-collector.test.ts`
- 创建：`packages/omp-compliance/test/signals/codebase-memory.test.ts`
- 创建：`packages/omp-compliance/test/signals/task-delegation.test.ts`

**目标：** 只通过官方扩展 `tool_call/tool_result` 事件收集事实。识别 codebase-memory 的 index、搜索和源码/调用链层级，识别官方 `task` 的实际委派及结果，采集验证命令退出码与变更路径摘要；不拦截工具，不创建角色/模型路由。

- [ ] **步骤 1：写失败的归一化测试**

```ts
it("仅在 index、搜索、源码或调用链证据连续存在时标记 codebase evidence complete", () => {
	const collector = new ToolEventCollector();
	collector.recordCall(mcpCall("codebase-memory", "index_status", {}));
	collector.recordResult(mcpResult("index_status", { ready: true }));
	collector.recordCall(mcpCall("codebase-memory", "search_graph", { query: "TaskTool" }));
	collector.recordResult(mcpResult("search_graph", { references: ["src/task/index.ts:TaskTool"] }));
	collector.recordCall(mcpCall("codebase-memory", "get_code_snippet", { qualified_name: "TaskTool.execute" }));
	expect(collector.snapshot().codebaseMemory).toMatchObject({
		indexReady: true,
		queries: ["search_graph", "get_code_snippet"],
		references: ["src/task/index.ts:TaskTool"],
	});
});

it("只接受有真实结果的官方 task 委派", () => {
	const collector = new ToolEventCollector();
	collector.recordCall(taskCall({ agent: "implementer", assignment: "实现 fixture" }));
	collector.recordResult(taskResult({ agentId: "agent-42", exitCode: 0, output: "参照 src/a.ts" }));
	expect(collector.snapshot().subagentDelegations).toEqual([
		expect.objectContaining({ agentId: "agent-42", status: "completed" }),
	]);
});
```

运行：

```bash
bun --cwd=packages/omp-compliance test test/signals/tool-event-collector.test.ts test/signals/codebase-memory.test.ts test/signals/task-delegation.test.ts
```

预期：FAIL，collector 不存在。

- [ ] **步骤 2：实现可审计的事件归一化**

`codebase-memory.ts` 只认可以下工具名的规范化后缀或完整名：

```text
index_repository, index_status
search_graph, search_code
get_code_snippet, trace_path
```

Collector 必须关联 call/result 的 toolCallId，记录服务器名、工具名、成功/失败、有限参数摘要和结果引用。不能仅因自然语言输出出现 `search_graph` 就建立证据。

`task-delegation.ts` 必须把 `toolName === "task"` 与结果 details 匹配，抽取 agent id、任务摘要、exit/aborted、时长、输出工件和其中明确的 codebase 引用；空调用、没有 result、错误 result 都只能成为“不充分”的事实。

- [ ] **步骤 3：接入 ExtensionAPI 事件但保持旁路**

在 `extension.ts` 增加：

```ts
pi.on("tool_call", event => runtime.recordToolCall(event));
pi.on("tool_result", event => runtime.recordToolResult(event));
pi.on("turn_end", event => runtime.recordTurnEnd(event));
pi.on("agent_end", event => runtime.refreshPresentation());
```

这些 handler 必须返回 `undefined`，绝不返回 `{ block: true }`，也不改写工具结果。每个 active task 仅采集开始时间之后的事件。

- [ ] **步骤 4：补充 MCP 名称变体与敏感信息测试**

覆盖 deferred MCP 名称、不同 server alias、`search_code` 的纯文本检索边界、task 失败/中止、含 token 的 bash 输出、巨大结果截断。断言 UI/Evidence 只保留引用与脱敏摘要。

- [ ] **步骤 5：运行通过验证**

```bash
bun --cwd=packages/omp-compliance test test/signals
bun --cwd=packages/omp-compliance run check
```

- [ ] **步骤 6：提交**

```bash
git add packages/omp-compliance/src/signals packages/omp-compliance/src/extension.ts packages/omp-compliance/test/signals
git commit -m "功能：采集合规图谱与子代理证据"
```

---

## 8. 任务 6：`/compliance start`、`compliance_complete` 与修复注入

**仓库：** `/Users/mima1234/Code/super/omp-custom`

**文件：**

- 创建：`packages/omp-compliance/src/runtime/compliance-runtime.ts`
- 创建：`packages/omp-compliance/src/runtime/completion-gate.ts`
- 创建：`packages/omp-compliance/src/tools/compliance-complete-tool.ts`
- 创建：`packages/omp-compliance/src/commands/compliance-command.ts`
- 创建：`packages/omp-compliance/src/remediation/inject-required-fix.ts`
- 创建：`packages/omp-compliance/test/runtime/completion-gate.test.ts`
- 创建：`packages/omp-compliance/test/tools/compliance-complete-tool.test.ts`
- 创建：`packages/omp-compliance/test/commands/compliance-command.test.ts`

**目标：** 提供 `/compliance start|stop|resume` 与 `compliance_complete({ summary, claimed_verification? })`。完成工具只构造 completion snapshot 并请求 Advisor review；它自身不分析成功与否。收到有效 `remediate` 后自动把结构化 required fixes 作为主代理下一轮消息，继续等待新完成请求。

- [ ] **步骤 1：写失败的完成门测试**

```ts
it("完成请求只进入 advisor_reviewing，不会依据测试命令自行完成", async () => {
	const gate = await startManagedCodeTask();
	gate.recordVerification({ command: "bun test", exitCode: 0 });
	const result = await gate.requestCompletion({ summary: "已完成" });
	expect(result.status).toBe("advisor_reviewing");
	expect(result.completionSnapshot.codebaseMemory).toBeDefined();
});

it("remediate 自动回送 required_fix，并允许无限次再次完成", async () => {
	const gate = await startManagedCodeTask();
	await gate.requestCompletion({ summary: "第一次" });
	await gate.acceptVerdict(validVerdict({ status: "remediate", findings: [finding("补测试")] }));
	expect(gate.state.status).toBe("remediation_required");
	expect(fakeSession.messages()).toContain("补测试");
	expect(gate.resumeAfterRemediation()).toBe("active");
});
```

- [ ] **步骤 2：运行测试验证失败**

```bash
bun --cwd=packages/omp-compliance test test/runtime/completion-gate.test.ts test/tools/compliance-complete-tool.test.ts test/commands/compliance-command.test.ts
```

- [ ] **步骤 3：实现命令和完成 snapshot**

`/compliance start <tdd.md>` 调用任务 3 的 loader、创建唯一 task id、写入 `active` Evidence，并向主代理发送简短受管提示。`compliance_complete` 的参数 schema 至少为：

```ts
{
	summary: z.string().min(1).max(4000),
	claimed_verification: z.array(z.string().max(500)).max(30).optional(),
}
```

snapshot 必须包含合同、当前/上次 verdict 之后的 signals、diff fingerprint、主代理声明、已关闭/未关闭 remediation。对政策要求的 codebase 或 task evidence，仅计算 `present|missing|partial` 事实；不得在该层产生 `pass|remediate`。

- [ ] **步骤 4：实现修复消息与状态边界**

`remediate` 必须通过 `pi.sendMessage(..., { deliverAs: "nextTurn", triggerTurn: true })` 或 v16.4.6 等价主代理 steering API 注入，内容为 task id、合同 hash、finding id、reason、required_fix、evidence refs。无效 verdict 不注入消息，保持 `advisor_reviewing`。`stalled` 时停止自动注入，并给用户可见状态说明。

- [ ] **步骤 5：补充合同变更、缺失 Advisor 和重复调用测试**

覆盖：合同 hash 已变、没有 Advisor、同一时刻两次 complete、上次仍在 reviewing、非代码豁免、Evidence 写失败。所有路径不得绕开 Advisor 完成门。

- [ ] **步骤 6：运行通过验证**

```bash
bun --cwd=packages/omp-compliance test test/runtime test/tools test/commands
bun --cwd=packages/omp-compliance run check
```

- [ ] **步骤 7：提交**

```bash
git add packages/omp-compliance/src/runtime packages/omp-compliance/src/tools packages/omp-compliance/src/commands packages/omp-compliance/src/remediation packages/omp-compliance/test/runtime packages/omp-compliance/test/tools packages/omp-compliance/test/commands
git commit -m "功能：增加合规完成门与修复回送"
```

---

## 9. 任务 7：Advisor 审查上下文、默认规则包与 verdict 协议

**仓库：** `/Users/mima1234/Code/super/omp-custom`

**文件：**

- 创建：`packages/omp-compliance/src/advisor/verdict-schema.ts`
- 创建：`packages/omp-compliance/src/advisor/completion-context.ts`
- 创建：`packages/omp-compliance/src/advisor/default-rule-pack.ts`
- 创建：`packages/omp-compliance/src/advisor/verdict-sink.ts`
- 创建：`packages/omp-compliance/test/advisor/verdict-schema.test.ts`
- 创建：`packages/omp-compliance/test/advisor/completion-context.test.ts`
- 创建：`packages/omp-compliance/test/advisor/default-rule-pack.test.ts`

**目标：** 将稳定、紧凑的 completion context 与默认规则送给 Advisor，并严格校验唯一 verdict 协议。规则包要求 Advisor 在 required evidence 缺失时 `remediate`，但实现层不替代 Advisor 的语义裁决。

- [ ] **步骤 1：写失败的 verdict schema 测试**

```ts
it("只接受绑定当前 task 和合同 hash 的 pass/remediate", () => {
	expect(parseVerdict(validVerdict({ status: "pass", findings: [] }), context)).toMatchObject({ status: "pass" });
	expect(() => parseVerdict(validVerdict({ task_id: "other" }), context)).toThrow("task_id");
	expect(() => parseVerdict(validVerdict({ contract_hash: "sha256:other" }), context)).toThrow("contract_hash");
});

it("remediate 必须包含可执行 required_fix", () => {
	expect(() => parseVerdict(validVerdict({ status: "remediate", findings: [] }), context)).toThrow("required_fix");
});

it("代码任务的规则包明确要求缺少图谱或 task evidence 时 remediation", () => {
	expect(renderCompletionRules(codePolicy)).toContain("requiresCodebaseMcp");
	expect(renderCompletionRules(codePolicy)).toContain("requiresSubagentDelegation");
});
```

- [ ] **步骤 2：运行测试验证失败**

```bash
bun --cwd=packages/omp-compliance test test/advisor/verdict-schema.test.ts test/advisor/completion-context.test.ts test/advisor/default-rule-pack.test.ts
```

- [ ] **步骤 3：实现完整协议和最小上下文**

实现设计规格中的 `ComplianceVerdict`，`schema_version` 固定为 `1`。`completion-context.ts` 输出：

```text
<compliance-task>
task_id: ...
tdd_path: ...
contract_hash: ...
execution_policy: ...
contract_summary: ...
changed_paths: ...
verification_summary: ...
codebase_memory_evidence: ...
subagent_delegation_evidence: ...
prior_remediation: ...
completion_claim: ...
</compliance-task>
```

内容采用严格长度上限、脱敏和 deterministic 排序；原文路径始终可让只读 Advisor 用 `read` 复查。默认规则包需明确：`pass` 表示符合 TDD，不等于命令曾成功；代码任务缺少所需证据时必须 `remediate`；Advisor 只能使用 `read, grep, glob, advise, compliance_verdict`。

- [ ] **步骤 4：测试 verdict sink 的幂等和竞态**

同一 `(task_id, contract_hash, attempt)` 的重复 verdict 只能被处理一次；过期 attempt 记协议错误而不覆盖新状态；`pass` 后的迟到 `remediate` 不可回滚 completed。

- [ ] **步骤 5：运行通过验证**

```bash
bun --cwd=packages/omp-compliance test test/advisor
bun --cwd=packages/omp-compliance run check
```

- [ ] **步骤 6：提交**

```bash
git add packages/omp-compliance/src/advisor packages/omp-compliance/test/advisor
git commit -m "功能：定义 Advisor 合规裁决协议"
```

---

## 10. 任务 8：先探测 v16.4.6 Verdict 接口，再实施唯一白名单桥接补丁

**仓库：** `/Users/mima1234/Code/super/oh-my-pi-v16.4.6-compliance`，必要时同步更新 `/Users/mima1234/Code/super/omp-custom`

**候选文件：**

- 探测优先：`packages/coding-agent/src/extensibility/extensions/types.ts`、`packages/coding-agent/src/extensibility/extensions/runner.ts`、`packages/coding-agent/src/session/agent-session.ts`
- 条件创建：`packages/coding-agent/src/advisor/compliance-verdict-tool.ts`
- 条件修改：`packages/coding-agent/src/session/agent-session.ts`
- 条件创建：`packages/coding-agent/test/advisor/compliance-verdict-tool.test.ts`
- 条件创建：`packages/coding-agent/test/session/advisor-compliance-bridge.test.ts`
- 修改：`/Users/mima1234/Code/super/omp-custom/packages/omp-compliance/src/advisor/verdict-sink.ts`

**目标：** 优先证明扩展 API 是否已经能让 Advisor 调用结构化 verdict sink。若不能，才增加唯一桥接：`ComplianceVerdictTool` 只向已启用的 compliance 扩展交付 payload，且仅被 Advisor 看见；不泛化为任意 Advisor plugin API，不碰 Advisor delta、重试、Emission Guard、模型/角色路由。

- [ ] **步骤 1：在 v16.4.6 写失败的能力探测测试**

测试首先使用真实 ExtensionAPI 加载一个最小 fixture，要求：当 compliance 扩展启用并发出完成 review 时，Advisor 工具集中存在 `compliance_verdict`，且调用 payload 能到达扩展 sink；关闭扩展后该工具不存在。

```bash
bun test packages/coding-agent/test/advisor/compliance-verdict-tool.test.ts
```

预期：在无官方接口的 v16.4.6 上 FAIL，并输出缺失的具体 extension/advisor API，而不是直接修改核心。

- [ ] **步骤 2：执行 API 探测并作出单一分支选择**

必须在 v16.4.6 的 codebase-memory 图谱中重新查找：

```text
search_graph(query="ExtensionAPI AdvisorRuntime register advisor tool")
search_graph(query="AgentSession buildAdvisorRuntime advisor tools")
get_code_snippet(qualified_name="<v16.4.6 Advisor builder>")
```

选择规则：

1. 若官方 API 已能安全注册只对 Advisor 可见的结构化工具，写一条兼容接线提交，**不改 fork 核心**；
2. 若没有，则执行步骤 3 的白名单补丁；
3. 不允许第三种“把 verdict 写成普通 `advise` 文本再 regex 解析”的降级方案。

- [ ] **步骤 3：仅在探测失败时实现最小桥接**

桥接的唯一可见核心变化是：

```text
compliance extension enabled
  -> 注册一个当前 session 的 verdict sink
  -> AgentSession.#buildAdvisorRuntime() 给 Advisor Agent 增加 ComplianceVerdictTool
  -> ComplianceVerdictTool 校验 schema 后调用 sink
  -> sink 回到 @bearmaxdd/omp-compliance CompletionGate
```

约束：

- `ComplianceVerdictTool` 只接受设计规格的字段，不允许自由文本执行命令；
- 它不写文件、不调用 shell、不调 `task`、不修改主代理工具；
- extension 未启用时不创建工具、不注册 sink；
- `AdviseTool` 与 `AdvisorEmissionGuard` 的原有语义不变；
- 不引入通用 `registerAdvisorTool()` 或任何面向角色/模型的 API；
- 补丁必须独立成一笔最小中文提交，后续升级可用 `git diff upstream/v16.4.6 -- <两处文件>` 审计。

- [ ] **步骤 4：写并运行桥接回归测试**

至少覆盖：有效 `pass`、带 required_fix 的 `remediate`、无效 schema、task/hash 不匹配、同一 verdict 重复、extension disabled、Advisor 不可用。重点断言：只有 sink 接到合法 `pass` 后 extension state 才会 completed；核心测试不能依赖真实 LLM。

```bash
bun test packages/coding-agent/test/advisor/compliance-verdict-tool.test.ts packages/coding-agent/test/session/advisor-compliance-bridge.test.ts
bun --cwd=packages/coding-agent run check:types
```

- [ ] **步骤 5：提交（按探测结论二选一）**

无核心补丁：

```bash
git add <仅扩展兼容接线文件>
git commit -m "功能：接入官方 Advisor 合规裁决接口"
```

需要白名单补丁：

```bash
git add packages/coding-agent/src/advisor/compliance-verdict-tool.ts packages/coding-agent/src/session/agent-session.ts packages/coding-agent/test/advisor/compliance-verdict-tool.test.ts packages/coding-agent/test/session/advisor-compliance-bridge.test.ts
git commit -m "功能：接线 Advisor 合规裁决工具"
```

---

## 11. 任务 9：状态命令、面板模型和会话恢复

**仓库：** `/Users/mima1234/Code/super/omp-custom`

**文件：**

- 创建：`packages/omp-compliance/src/status/status-view-model.ts`
- 创建：`packages/omp-compliance/src/status/history-reader.ts`
- 修改：`packages/omp-compliance/src/commands/compliance-command.ts`
- 创建：`packages/omp-compliance/test/status/status-view-model.test.ts`
- 创建：`packages/omp-compliance/test/status/history-reader.test.ts`
- 修改：`packages/omp-compliance/test/commands/compliance-command.test.ts`

**目标：** 交付 `/compliance status`、`/compliance history`、`/compliance resume <task_id>`、`/compliance stop`。视图只读取状态/Evidence，不成为第二个任务编排器。

- [ ] **步骤 1：写失败的状态视图测试**

```ts
it("显示合同、attempt、最近 verdict、必须修复项和证据缺口", () => {
	const view = toStatusViewModel(remediationTask());
	expect(view.status).toBe("remediation_required");
	expect(view.requiredFixes).toEqual(["补充失败路径测试"]);
	expect(view.evidence.codebaseMemory).toBe("partial");
	expect(view.advisor).toMatchObject({ available: true });
});

it("resume 只恢复 stalled/暂停任务，不可覆盖 completed", async () => {
	expect(await command("resume task-stalled")).toMatchObject({ status: "active" });
	expect(await command("resume task-completed")).toMatchObject({ error: "already_completed" });
});
```

- [ ] **步骤 2：运行测试验证失败**

```bash
bun --cwd=packages/omp-compliance test test/status test/commands/compliance-command.test.ts
```

- [ ] **步骤 3：实现只读状态投影**

状态面板至少展示：TDD 路径、合同 hash 短码、状态、attempt、Advisor 可用性、最近 verdict、required fixes、验证摘要、codebase-memory 与 TaskTool evidence 的 `missing|partial|present`。`history` 读取 JSONL 时显示时间顺序、忽略脱敏外的原始大输出。

`stop` 只停止受管任务并记录 `stopped` 事件；不得终止 OMP 会话、子代理或 Advisor。`resume` 需要明确 task id 并重新检查合同是否存在；合同丢失保留 `stalled`。

- [ ] **步骤 4：补充 TUI 文本宽度和无 state 场景测试**

覆盖超长路径、中文 required fix、无 active task、损坏 Evidence、Advisor 不可用。渲染使用稳定列宽/换行，不产生截断后误导性 `pass` 文案。

- [ ] **步骤 5：运行通过验证**

```bash
bun --cwd=packages/omp-compliance test test/status test/commands/compliance-command.test.ts
bun --cwd=packages/omp-compliance run check
```

- [ ] **步骤 6：提交**

```bash
git add packages/omp-compliance/src/status packages/omp-compliance/src/commands/compliance-command.ts packages/omp-compliance/test/status packages/omp-compliance/test/commands/compliance-command.test.ts
git commit -m "功能：增加合规状态与历史命令"
```

---

## 12. 任务 10：端到端行为夹具与 Advisor 质量门验收

**仓库：** `/Users/mima1234/Code/super/omp-custom`，必要桥接测试同时在 v16.4.6 fork 运行

**文件：**

- 创建：`packages/omp-compliance/test/fixtures/behavior/*`
- 创建：`packages/omp-compliance/test/behavior/compliance-flow.test.ts`
- 创建：`packages/omp-compliance/test/behavior/advisor-protocol.test.ts`
- 创建：`packages/omp-compliance/test/behavior/extension-disabled.test.ts`
- 创建：`packages/omp-compliance/test/support/fake-advisor.ts`
- 创建：`packages/omp-compliance/test/support/fake-task-tool.ts`
- 创建：`packages/omp-compliance/test/support/fake-codebase-memory.ts`

**目标：** 将设计规格的关键场景变为无 LLM、可重复的行为夹具。Fake Advisor 只模拟结构化 verdict，绝不把 fixture 的本地规则冒充生产质量裁决。

- [ ] **步骤 1：写失败的行为矩阵**

每个 fixture 都通过真实 Contract/Collector/Gate/State/Evidence 组合运行，覆盖：

| 场景 | Fake Advisor verdict | 必须断言 |
| --- | --- | --- |
| 只改生产代码、未补测试 | `remediate` | 主代理收到明确测试修复项，未完成 |
| 测试失败仍 complete | `remediate` | Evidence 有失败退出码，未完成 |
| 范围超出 TDD | `remediate` | finding 引用合同与变更路径 |
| 未调用 codebase-memory | `remediate` | finding 要求 index + search + snippet/trace |
| 未委派 task 子代理 | `remediate` | finding 要求官方 task 及结果 |
| 子代理无 codebase 引用 | `remediate` | finding 要求可追溯符号/调用链 |
| 完整证据与验证 | `pass` | 仅此路径 `completed` |
| 连续 remediation 后通过 | `pass` | attempt 递增且历史完整 |
| 同一失败无变化 | 不再自动 verdict | `stalled`，没有新修复注入 |
| 扩展关闭 | 不适用 | OMP 行为/工具列表没有完成门副作用 |

运行：

```bash
bun --cwd=packages/omp-compliance test test/behavior
```

预期：FAIL，夹具尚不存在。

- [ ] **步骤 2：实现 fake 边界并避免假阳性**

`fake-codebase-memory.ts` 只能通过模拟 tool call/result 填充 Evidence；不能直接调用 Collector 内部“设为完成”的方法。`fake-task-tool.ts` 必须产出与官方 TaskTool result 对齐的 agent id、exit/aborted、输出引用。`fake-advisor.ts` 只能经任务 7 的 `parseVerdict` 与 sink 抵达 Gate。

- [ ] **步骤 3：在真实 v16.4.6 扩展加载环境跑关键 smoke**

使用最小 project fixture 和 mock provider，验证：

```bash
bun --cwd=/Users/mima1234/Code/super/oh-my-pi-v16.4.6-compliance test packages/coding-agent/test/advisor/compliance-verdict-tool.test.ts
bun --cwd=packages/omp-compliance test test/behavior/compliance-flow.test.ts
```

若官方测试 harness 不能 mock Advisor provider，保留 bridge 单测并把真实 LLM smoke 明确标记为手工验收；不得伪称已做在线模型验证。

- [ ] **步骤 4：运行全部行为验证通过**

```bash
bun --cwd=packages/omp-compliance test test/behavior
bun --cwd=packages/omp-compliance run check
bun --cwd=packages/omp-compliance run build
```

- [ ] **步骤 5：提交**

```bash
git add packages/omp-compliance/test/fixtures packages/omp-compliance/test/behavior packages/omp-compliance/test/support
git commit -m "测试：覆盖 Advisor 合规完成门行为"
```

---

## 13. 任务 11：安装文档、升级 Runbook 与发布验收

**仓库：** 两个仓库分别提交各自文档

**文件：**

- 创建：`/Users/mima1234/Code/super/omp-custom/docs/advisor-compliance-workflow.md`
- 创建：`/Users/mima1234/Code/super/omp-custom/docs/upstream-upgrade-runbook.md`
- 创建：`/Users/mima1234/Code/super/omp-custom/docs/evidence-schema.md`
- 修改：`/Users/mima1234/Code/super/omp-custom/README.md`
- 创建或修改：`/Users/mima1234/Code/super/oh-my-pi/docs/extension-loading.md` 的 fork 附加说明，或 `docs/superpowers/migrations/2026-07-13-compliance-bridge.md`
- 修改：`/Users/mima1234/Code/super/oh-my-pi/README.md`

**目标：** 让用户能安装、启动、查看、停止和升级合规层，同时清楚看到它不包含已归档的严格路由体系；让下一次 `v16.x` 同步有可复验的补丁边界。

- [ ] **步骤 1：写文档完整性测试**

创建 `packages/omp-compliance/test/docs/workflow-docs.test.ts`，断言 README/runbook 包含：

```text
/compliance start <tdd.md>
compliance_complete
/compliance status
codebase-memory MCP 证据
官方 task 子代理证据
pass/remediate/stalled 的语义
extension disabled 的行为
严格路由、PlanRun、批量角色分配不迁移
```

运行：

```bash
bun --cwd=packages/omp-compliance test test/docs/workflow-docs.test.ts
```

预期：FAIL，文档尚未形成完整操作闭环。

- [ ] **步骤 2：编写安装与日常流程文档**

安装文档应给出本地开发、`bun pack` 安装和项目级 `.omp/extensions` 三种方式；日常流程只展示：绑定 TDD、完成请求、收到 remediation、修复、再次完成、查看 status/history。明确普通未受管会话无完成门。

Evidence 文档列出 JSONL schema、脱敏/截断、默认不提交运行目录和用户可选择的提交策略。

- [ ] **步骤 3：编写上游升级 Runbook**

每次升级必须：

1. 从 `upstream/v16.x` 新建临时 worktree；
2. 运行官方 Advisor、Extension、TaskTool 基线测试；
3. 运行独立扩展单测与行为夹具；
4. 验证 extension disabled；
5. 验证 `pass`、`remediate`、`stalled`；
6. 若有桥接补丁，只比较 `ComplianceVerdictTool` 和 `#buildAdvisorRuntime()` 的最小 diff；
7. 若桥接已被官方 API 取代，先写回归测试，再删除补丁并记录迁移。

- [ ] **步骤 4：运行文档和全量质量门**

```bash
bun --cwd=/Users/mima1234/Code/super/omp-custom/packages/omp-compliance test
bun --cwd=/Users/mima1234/Code/super/omp-custom/packages/omp-compliance run check
bun --cwd=/Users/mima1234/Code/super/omp-custom/packages/omp-compliance run build
bun --cwd=/Users/mima1234/Code/super/oh-my-pi-v16.4.6-compliance/packages/coding-agent run check
git -C /Users/mima1234/Code/super/omp-custom diff --check
git -C /Users/mima1234/Code/super/oh-my-pi-v16.4.6-compliance diff --check
```

预期：文档测试、扩展质量门、fork 质量门和两个 diff 检查均通过。若真实 LLM 验收未运行，文档必须保留明确的手工 smoke 步骤与未执行原因。

- [ ] **步骤 5：分别提交文档**

```bash
git -C /Users/mima1234/Code/super/omp-custom add README.md docs packages/omp-compliance/test/docs
git -C /Users/mima1234/Code/super/omp-custom commit -m "文档：完善 Advisor 合规扩展使用与升级流程"

git -C /Users/mima1234/Code/super/oh-my-pi-v16.4.6-compliance add README.md docs
git -C /Users/mima1234/Code/super/oh-my-pi-v16.4.6-compliance commit -m "文档：说明合规扩展接线边界"
```

---

## 14. 发布前总验收清单

- [ ] 当前重型树已存在并推送 `archive/strict-runtime-2026-07-13`，新分支由 `upstream/v16.4.6` 建立。
- [ ] `@bearmaxdd/omp-compliance` 可独立构建、测试和打包；安装在项目 `.omp/extensions` 后可被 OMP 发现。
- [ ] 没有 `/compliance start` 或扩展关闭时，官方 OMP、Advisor、工具清单与基线相同。
- [ ] 受管任务绑定 TDD 原文与不可静默替换的合同 hash。
- [ ] `compliance_complete` 只发起 review；没有有效 `ComplianceVerdict(status: "pass")` 时绝不 completed。
- [ ] `remediate` 自动回送结构化修复项；无次数上限；无进展仅进入 `stalled`。
- [ ] `code` 任务的 completion snapshot 能展示 index、search、snippet/trace 的 codebase-memory 证据，以及官方 `task` 的子代理调用与结果。
- [ ] 缺任一 required evidence 的行为夹具由 Advisor `remediate`，不是 Collector 本地裁决。
- [ ] Advisor 可见工具严格为只读工具、`advise` 与 `compliance_verdict`；没有写、bash、浏览器、task 或模型路由权限。
- [ ] 若存在 fork 核心 diff，它只服务 `compliance_verdict` 接线，具备单独测试、升级审计记录与 extension-disabled 回归。
- [ ] 严格路由、PlanRun、批量角色模型分配、模型锁、旧 Evidence 没有出现在新基线和独立扩展包中。

## 15. 计划自检

- 规格中的 15 条完成定义均映射到任务 1-11 或发布前验收；
- 任务 2-10 都先写失败测试、运行失败、做最小实现、运行通过并以中文提交；
- 任务 8 是唯一条件化核心改动，并以前置 API 探测决定是否执行；
- 图谱与子代理证据要求落实在执行前置条件、Collector、Advisor 规则、行为夹具和验收清单五处；
- 所有新类型都使用 `ComplianceTaskKind`、`ComplianceExecutionPolicy`、`ComplianceVerdict` 和 `EvidenceRecord`，不复用已归档严格路由的角色/阶段术语；
- 计划不包含待定实现占位、未命名文件或未声明验证命令。
