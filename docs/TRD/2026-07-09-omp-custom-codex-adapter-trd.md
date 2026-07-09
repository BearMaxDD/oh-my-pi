# OMP Custom Codex Adapter TRD

## 1. 文档信息

| 项目 | 内容 |
| --- | --- |
| 文档名称 | OMP Custom Codex Adapter TRD |
| 对应 PRD | `docs/PRD/2026-07-09-omp-custom-codex-adapter.md` |
| 所属能力 | `BearMaxDD/omp-custom` |
| 目标宿主 | OpenAI Codex CLI / Codex Desktop |
| 当前 OMP 分支 | `BearMaxDD/oh-my-pi` / `mima/omp-custom` |
| 文档日期 | 2026-07-09 |
| 文档类型 | 技术需求文档 |
| 目标读者 | 实现代理、代码审查者、后续维护者 |

## 2. 技术结论

Codex Adapter 首版应实现为 `omp-custom` 的宿主适配层，而不是 Codex core fork。

技术路线：

```text
omp-custom/core
  提供意图分类、项目绑定、工具参数规范化、evidence schema、降级策略

omp-custom/adapters/codex
  提供 Codex 插件、hooks 脚本、MCP proxy、tool_search metadata

codebase-memory-mcp
  保持全局安装，由 Adapter 在会话层强制绑定当前项目
```

首版只完成四条闭环：

1. `user_prompt_submit` 自动判断是否需要 codebase-memory。
2. `pre_tool_use` 在调用 codebase-memory MCP 前强制项目隔离。
3. `tool_search` 提升 codebase-memory 工具发现率。
4. `post_tool_use` 记录工具调用、拦截、降级和越权 evidence。

## 3. 图谱分析依据

本 TRD 基于 codebase-memory 对以下项目的图谱分析：

| 项目 | 图谱状态 | 节点 | 边 | 用途 |
| --- | --- | ---: | ---: | --- |
| `Users-mima1234-Code-super-oh-my-pi` | ready | 67380 | 243493 | 分析 OMP 当前代码架构 |
| `tmp-openai-codex-src` | ready | 83304 | 434274 | 分析 Codex 宿主接入面 |

OMP 当前仓库的主要代码重心：

- `packages/coding-agent`：核心 CLI、会话、MCP、扩展、任务执行和自定义能力接线。
- `packages/ai`：多提供方模型客户端。
- `packages/tui`：终端 UI。
- `packages/agent`：代理运行时基础能力。
- `packages/utils`：共享工具。
- `crates/*`：原生能力和 shell / AST / ISO 等 Rust 包。

与本 TRD 直接相关的 OMP 代码节点：

- `packages/coding-agent/src/codebase-memory-autocontext.ts`
- `packages/coding-agent/src/mcp/loader.ts`
- `packages/coding-agent/src/mcp/tool-bridge.ts`
- `packages/coding-agent/src/tool-discovery/tool-index.ts`
- `packages/coding-agent/src/sdk.ts`
- `packages/coding-agent/src/extensibility/extensions/types.ts`
- `packages/coding-agent/src/extensibility/hooks/types.ts`
- `packages/coding-agent/src/codex-plan-run/*evidence*`

与本 TRD 直接相关的 Codex 代码节点：

- `codex-rs/hooks/src/engine/mod.rs`
- `codex-rs/core/src/hook_runtime.rs`
- `codex-rs/core/src/tools/registry.rs`
- `codex-rs/core/src/tools/spec_plan.rs`
- `codex-rs/core/src/tools/handlers/tool_search.rs`
- `codex-rs/core/src/session/mcp.rs`

## 4. 当前 OMP 架构分析

### 4.1 codebase-memory 自动上下文现状

OMP 当前已有 `codebase-memory-autocontext.ts`，核心函数包括：

- `classifyCodebaseMemoryIntent`
- `buildCodebaseMemoryContextMessages`
- `ensureCodebaseMemoryMCPServer`
- `readCodebaseMemoryMCPServer`
- `getCodebaseMemoryStatus`
- `configureCodebaseMemoryDiscovery`
- `hasCodebaseMemoryContextMarker`

当前行为特征：

1. `classifyCodebaseMemoryIntent` 主要通过正则识别代码任务、堆栈、符号形态和代码仓库 cwd 信号。
2. `code_repository_cwd` 只作为辅助 reason，不单独触发注入。
3. `buildCodebaseMemoryContextMessages` 只有在 status 为 `ready`、没有 marker、最后一条用户消息命中分类器时，才追加 synthetic user message。
4. 当前能力更偏“提示注入”，不是完整的工具调用前后生命周期控制。

对 Codex Adapter 的启示：

- `classifyCodebaseMemoryIntent` 应抽成 `omp-custom/core/intent`，供 OMP 和 Codex 共同使用。
- Codex Adapter 不应复制一份正则；应调用同一个分类策略。
- Codex 的 `user_prompt_submit` 应比 OMP 当前 synthetic message 更早介入，并能写入 evidence。

### 4.2 MCP 工具加载现状

OMP 当前通过 `discoverAndLoadMCPTools` 接入 MCP：

```text
discoverAndLoadMCPTools(cwd, options)
  -> resolveToolCache
  -> new MCPManager(cwd, toolCache)
  -> manager.discoverAndConnect(...)
  -> result.tools.map(...) 转为 LoadedCustomTool
  -> 返回 manager、tools、errors、connectedServers、exaApiKeys
```

`packages/coding-agent/src/sdk.ts` 中的会话创建路径会在 MCP 工具加载后重新计算 tool discovery 模式。如果真实 MCP 工具数量触发 auto discovery，会启用 `search_tool_bm25`，避免把所有 MCP 工具直接倒进 active tools。

对 Codex Adapter 的启示：

- OMP 已经证明“全局 MCP + discovery-aware activation”是可行路径。
- Codex Adapter 不需要重新发明 MCP manager；Codex 宿主侧已有 MCP runtime。
- `omp-custom` core 只需要提供“哪些 codebase-memory 工具需要增强 metadata、如何补 projectId、如何拦截越权”的策略。

### 4.3 工具发现现状

OMP 当前有 `tool-discovery/tool-index.ts`：

- `buildSearchDocument`
- `buildDiscoverableToolSearchIndex`
- `searchDiscoverableTools`
- `getDiscoverableTool`
- `isMCPToolName`

该模块基于文档 token、term frequency、document frequency 构建搜索索引。`searchDiscoverableTools` 支持从 query 检索工具。

对 Codex Adapter 的启示：

- 工具发现增强可以抽成 host-neutral metadata builder。
- OMP 可继续使用 `search_tool_bm25`。
- Codex 可通过 `tool_search` 和 MCP 工具描述承载同一套 metadata。

### 4.4 扩展与 hook 现状

OMP 当前扩展系统支持 `session_start`，并在 runtime init、task subagent、ACP agent、UI controller 等路径发出 session start 事件。

当前 OMP hooks / extensions 主要是 OMP 内部扩展机制，不等价于 Codex 的 `user_prompt_submit`、`pre_tool_use`、`post_tool_use` hook 链路。

对 Codex Adapter 的启示：

- Codex Adapter 不应试图把 OMP extension API 原样塞进 Codex。
- 应在 `omp-custom/core` 保持通用策略，在 `adapters/codex` 使用 Codex 原生 hook contract。
- OMP Adapter 和 Codex Adapter 的共同点是策略，不是 hook 事件名。

### 4.5 Evidence 现状

OMP 当前 PlanRun 相关 evidence 节点包括：

- `appendSkillEvidence`
- `validateRequiredSkillEvidence`
- `writeSuperpowersCodebaseMemoryGateEvidence`
- `runCodebaseMemoryAcceptanceRecon`
- `addSkillEvidenceFindings`
- `addTddEvidenceFindings`
- `runMainThreadAcceptanceReview`

这些模块说明 OMP 已经有“执行证据影响验收”的产品逻辑。

对 Codex Adapter 的启示：

- Codex Adapter evidence 不应只是日志，而应可被后续 PlanRun / acceptance review 消费。
- 首版 evidence schema 应独立、稳定、JSONL 追加写入。
- OMP 的 evidence 经验应迁入 `omp-custom/core/evidence`。

## 5. Codex 宿主接入面分析

### 5.1 Hooks

Codex 代码中存在 hooks engine，支持预览和执行：

- `session_start`
- `pre_tool_use`
- `post_tool_use`
- `user_prompt_submit`
- `stop`
- compact 相关 hook
- permission request 相关 hook

`run_pre_tool_use_hooks` 的输入包含：

- session
- turn context
- tool use id
- hook-facing tool name
- tool input

输出可表达：

- 继续执行。
- 阻断工具调用。
- 更新工具输入。
- 追加上下文。

`run_post_tool_use` 可在工具执行后处理 additional contexts 和 feedback message。

技术判断：

- `pre_tool_use` 是项目隔离和参数补全的最佳位置。
- `post_tool_use` 是 evidence 写入和输出摘要的最佳位置。
- `user_prompt_submit` 是 codebase-memory 自动触发的最佳位置。

### 5.2 MCP Runtime

Codex `Session.runtime_mcp_config` 和相关 runtime config 方法会按当前配置、thread extension data 和 available environment 生成运行时 MCP 配置。

技术判断：

- Codex 已有运行时 MCP 投影，不需要 Adapter 自己管理 MCP 子进程。
- Adapter 首版应把 `codebase-memory-mcp` 视为已配置的全局 MCP server。
- 项目绑定应在 tool input 层完成，而不是在 MCP server 安装层完成。

### 5.3 Tool Search

Codex `tool_search` 机制会把 deferred tools 的 search info 聚合为可检索工具。工具搜索 handler 使用 search info 构建搜索索引，并返回可加载 tool spec。

技术判断：

- codebase-memory 工具应尽量进入 deferred / discoverable tool 集合。
- metadata 应包含中文、英文、代码任务、图谱、调用链、符号搜索、项目索引等关键词。
- 工具 schema 和描述是 tool_search 命中的关键输入。

### 5.4 Tool Registry

Codex 工具注册和执行路径会在实际工具执行前后调用 pre/post hook。pre hook 可以阻断或改写输入，post hook 可以替换反馈给模型的结果。

技术判断：

- Adapter 的强绑定应实现为 pre hook 输入改写或阻断。
- Adapter 的 evidence 应实现为 post hook 的副作用。
- Adapter 不应修改 Codex tool registry 本身。

## 6. 目标技术架构

### 6.1 分层架构

```text
BearMaxDD/omp-custom
  packages/
    core/
      intent/
      project-binding/
      codebase-memory/
      evidence/
      policy/
      diagnostics/

    adapter-omp/
      extension-entry.ts
      prompt-injection.ts
      mcp-discovery.ts
      evidence-bridge.ts

    adapter-codex/
      plugin/
      hooks/
      mcp-proxy/
      tool-search/
      diagnostics/
```

首版可以先不拆成多个 npm 包，但目录边界必须按上述职责组织。

### 6.2 核心模块职责

| 模块 | 职责 | 是否宿主无关 |
| --- | --- | --- |
| `core/intent` | 识别是否为代码任务、输出 confidence 和 reasons | 是 |
| `core/project-binding` | 解析项目身份、绑定当前会话、校验跨项目 | 是 |
| `core/codebase-memory` | 维护工具名、参数规范化、上下文片段、metadata | 是 |
| `core/evidence` | 定义 schema、写入 JSONL、摘要化工具输出 | 是 |
| `core/policy` | 默认强绑定、显式越权、降级策略 | 是 |
| `adapter-codex/hooks` | 适配 Codex hook 输入输出 | 否 |
| `adapter-codex/tool-search` | 生成 Codex tool_search 可消费 metadata | 部分 |
| `adapter-codex/mcp-proxy` | 对 codebase-memory MCP 调用做 projectId 注入和拦截 | 否 |
| `adapter-codex/diagnostics` | 输出 Codex 侧诊断信息 | 否 |

### 6.3 数据流

```mermaid
sequenceDiagram
  participant U as 用户
  participant C as Codex
  participant H as Codex Adapter Hooks
  participant Core as omp-custom/core
  participant MCP as codebase-memory-mcp
  participant E as Evidence Store

  U->>C: 输入 prompt
  C->>H: user_prompt_submit
  H->>Core: classifyCodebaseTask(prompt, cwd)
  Core-->>H: intent result
  H->>Core: resolveProjectBinding(cwd)
  Core-->>H: binding or degraded
  H-->>C: additional context / no-op

  C->>H: tool_search 或 MCP tool call
  H->>Core: buildToolSearchMetadata / normalizeToolCall
  C->>H: pre_tool_use
  H->>Core: enforceProjectScope(toolInput, binding)
  Core-->>H: allow / rewrite / block
  H-->>C: hook result
  C->>MCP: call tool
  MCP-->>C: result
  C->>H: post_tool_use
  H->>Core: summarizeToolOutput(result)
  Core->>E: append evidence
```

## 7. Codex Adapter 目录设计

推荐目录：

```text
adapters/codex/
  package.json
  README.md
  .codex-plugin/
    plugin.json

  src/
    index.ts
    config.ts
    diagnostics.ts

    hooks/
      session-start.ts
      user-prompt-submit.ts
      pre-tool-use.ts
      post-tool-use.ts
      hook-io.ts

    mcp/
      codebase-memory-tools.ts
      normalize-tool-name.ts
      normalize-tool-input.ts
      project-scope-guard.ts

    tool-search/
      metadata.ts
      keywords.ts
      rank-hints.ts

    evidence/
      codex-event-mapper.ts
      codex-evidence-writer.ts

  test/
    user-prompt-submit.test.ts
    pre-tool-use.test.ts
    post-tool-use.test.ts
    tool-search-metadata.test.ts
    degraded-mode.test.ts
```

首版 hook 脚本可以是 TypeScript 编译产物，也可以是 Node/Bun 可执行脚本。TRD 推荐先使用 Bun/Node 脚本，降低和 Codex Rust core 的耦合。

## 8. 核心接口设计

### 8.1 意图分类接口

```ts
export type CodebaseTaskConfidence = "none" | "low" | "medium" | "high";

export interface CodebaseTaskIntentInput {
  prompt: string;
  cwd?: string;
  hasCodeRepositorySignals?: boolean;
  explicitOptOut?: boolean;
  host: "omp" | "codex";
}

export interface CodebaseTaskIntent {
  shouldInject: boolean;
  confidence: CodebaseTaskConfidence;
  reasons: string[];
  matchedSignals: string[];
}

export function classifyCodebaseTask(input: CodebaseTaskIntentInput): CodebaseTaskIntent;
```

迁移要求：

- 复用 OMP 当前 `classifyCodebaseMemoryIntent` 的正则语义。
- 增加 `host` 字段，但分类结果不依赖宿主私有 API。
- 保留 explicit opt-out 规则。
- `code_repository_cwd` 仍只作为辅助信号，避免普通聊天误触发。

### 8.2 项目绑定接口

```ts
export interface ProjectBinding {
  schemaVersion: 1;
  projectId: string;
  root: string;
  bindingMode: "strict" | "permissive";
  allowCrossProject: boolean;
  source:
    | "codebase-memory-project-file"
    | "omp-binding-file"
    | "mcp-project-list"
    | "git-root-derived";
  createdAt?: string;
  updatedAt: string;
}

export interface ResolveProjectBindingInput {
  cwd: string;
  host: "omp" | "codex";
  readFile: (path: string) => Promise<string | undefined>;
  listCodebaseMemoryProjects?: () => Promise<CodebaseMemoryProjectRef[]>;
}

export interface ResolveProjectBindingResult {
  binding?: ProjectBinding;
  degraded?: DegradedState;
}

export function resolveProjectBinding(
  input: ResolveProjectBindingInput,
): Promise<ResolveProjectBindingResult>;
```

读取顺序：

1. `.codebase-memory/project.json`
2. `.omp/codebase-memory-binding.json`
3. `codebase-memory-mcp list_projects`
4. Git root 派生候选 projectId

首版默认：

- 能读到明确身份才绑定。
- 不能绑定时进入 degraded mode。
- 不从历史项目列表里随便挑一个默认项目。

### 8.3 工具调用规范化接口

```ts
export interface CodebaseMemoryToolCall {
  toolName: string;
  input: Record<string, unknown>;
  callId?: string;
}

export interface NormalizeToolCallResult {
  normalizedInput: Record<string, unknown>;
  changed: boolean;
  reasons: string[];
}

export function normalizeCodebaseMemoryToolCall(
  call: CodebaseMemoryToolCall,
  binding: ProjectBinding,
): NormalizeToolCallResult;
```

规则：

- 支持 `project`、`projectId`、`repo` 等可能字段归一到内部 projectId。
- 缺少 projectId 时自动补当前绑定项目。
- 不改变非 codebase-memory 工具。
- 不吞掉原始参数；必要时把原始参数记录到 evidence 的 safe summary。

### 8.4 项目隔离接口

```ts
export interface ScopeDecision {
  action: "allow" | "rewrite" | "block";
  rewrittenInput?: Record<string, unknown>;
  reason: string;
  crossProjectOverride: boolean;
  requestedProjectId?: string;
}

export function enforceProjectScope(input: {
  toolName: string;
  toolInput: Record<string, unknown>;
  binding?: ProjectBinding;
  explicitOverride?: ExplicitOverride;
}): ScopeDecision;
```

决策表：

| 情况 | action | 说明 |
| --- | --- | --- |
| 非 codebase-memory 工具 | `allow` | 不处理 |
| 当前无 binding | `block` | 禁止静默访问未知项目 |
| 缺少 projectId | `rewrite` | 注入当前 projectId |
| projectId 等于当前项目 | `allow` | 放行 |
| projectId 不同且无越权 | `block` | 默认强隔离 |
| projectId 不同但有越权 | `allow` | 写入越权 evidence |

### 8.5 Tool Search Metadata 接口

```ts
export interface ToolSearchMetadata {
  toolName: string;
  title: string;
  description: string;
  keywords: string[];
  useWhen: string[];
  avoidWhen: string[];
  inputHints: string[];
  priority: "low" | "normal" | "high";
}

export function buildCodebaseMemoryToolSearchMetadata(): ToolSearchMetadata[];
```

必须覆盖工具：

- `search_graph`
- `search_code`
- `trace_path`
- `get_code_snippet`
- `query_graph`
- `get_architecture`
- `index_status`
- `index_repository`

关键词必须中英双语：

```text
codebase memory, code graph, source search, call graph, symbol,
architecture, project index, 代码图谱, 源码搜索, 调用链, 函数定位,
项目索引, 架构分析, 当前仓库
```

### 8.6 Evidence 接口

```ts
export type CodexAdapterEvidenceType =
  | "session_start"
  | "prompt_submit"
  | "tool_search_metadata"
  | "tool_use_rewrite"
  | "tool_use_blocked"
  | "codebase_memory_tool_use"
  | "degraded";

export interface CodexAdapterEvidence {
  schemaVersion: 1;
  eventType: CodexAdapterEvidenceType;
  host: "codex";
  sessionId?: string;
  turnId?: string;
  cwd?: string;
  projectId?: string;
  toolName?: string;
  toolInputSummary?: Record<string, unknown>;
  toolOutputSummary?: string;
  success?: boolean;
  durationMs?: number;
  bindingMode?: "strict" | "permissive";
  crossProjectOverride?: boolean;
  degraded?: boolean;
  reason?: string;
  createdAt: string;
}

export interface EvidenceWriter {
  append(event: CodexAdapterEvidence): Promise<void>;
}
```

默认写入路径：

```text
.omp/evidence/codex-adapter/YYYY-MM-DD.jsonl
```

写入要求：

- 追加写入。
- 单行 JSON。
- 失败不阻断 Codex 主流程。
- 不保存完整源码大段输出。
- 对 token、key、secret、private key 等字段脱敏。

## 9. Hook 技术设计

### 9.1 `session_start`

职责：

1. 解析 Adapter 配置。
2. 解析当前 cwd。
3. 尝试解析项目绑定。
4. 检测 `codebase-memory-mcp` 可用性。
5. 写入 `session_start` evidence。
6. 返回最小 additional context，说明当前绑定或降级状态。

输入：

```json
{
  "session_id": "string",
  "cwd": "/path/to/project",
  "transcript_path": "...",
  "model": "..."
}
```

输出：

```json
{
  "additional_contexts": [
    {
      "content": "当前 Codex Adapter 已绑定项目 ...",
      "metadata": {
        "source": "omp-custom-codex-adapter"
      }
    }
  ]
}
```

失败策略：

- 配置读取失败：进入 degraded mode。
- 项目绑定失败：不绑定任何项目，提示需要初始化。
- evidence 写入失败：返回短诊断，不中断会话。

### 9.2 `user_prompt_submit`

职责：

1. 读取用户最新 prompt。
2. 调用 `classifyCodebaseTask`。
3. 解析项目绑定。
4. 根据分类结果决定是否注入 codebase-memory 上下文。
5. 写入 `prompt_submit` evidence。

注入内容结构：

```text
CODEBASE_MEMORY_AUTOCONTEXT
- 当前项目: <projectId>
- 根目录: <root>
- 当前状态: ready/degraded
- 优先工具:
  1. search_graph: 查符号、函数、类、路由
  2. trace_path: 查调用链和影响范围
  3. get_code_snippet: 读取具体实现
  4. search_code: 查错误信息、配置值、文本
- 规则:
  - 默认只访问当前项目
  - 跨项目必须显式说明
  - 未读取图谱时不得声称已读取
```

不注入条件：

- prompt 为空。
- 命中 explicit opt-out。
- 分类为 non-code task。
- 当前项目无法绑定且配置为 `degradedMode: "silent"`。

### 9.3 `pre_tool_use`

职责：

1. 判断工具是否属于 codebase-memory 工具。
2. 读取当前项目绑定。
3. 规范化工具参数。
4. 执行项目隔离策略。
5. 返回 allow / rewritten input / block。
6. 写入 `tool_use_rewrite` 或 `tool_use_blocked` evidence。

Hook 输出：

```json
{
  "decision": "continue",
  "updated_input": {
    "project": "Users-mima1234-Code-super-oh-my-pi",
    "name_pattern": ".*Foo.*"
  }
}
```

阻断输出：

```json
{
  "decision": "block",
  "reason": "codebase-memory 跨项目调用被阻断：当前会话绑定 Users-mima1234-Code-super-oh-my-pi，但工具请求 Users-mima1234-Code-other。"
}
```

### 9.4 `post_tool_use`

职责：

1. 判断工具是否属于 codebase-memory 工具。
2. 摘要化 tool response。
3. 判断成功、失败、空结果、降级。
4. 写入 `codebase_memory_tool_use` evidence。
5. 必要时返回 feedback message，提醒模型不要夸大读取结果。

输出摘要规则：

- 保留命中数量、符号名、文件路径、错误类型。
- 不保留完整源码块。
- 超过字符限制时截断并记录 `truncated: true`。
- 对疑似敏感字段脱敏。

## 10. MCP 工具识别

### 10.1 工具名匹配

Adapter 必须支持以下命名形态：

```text
search_graph
mcp__codebase_memory_mcp__search_graph
codebase_memory.search_graph
codebase-memory.search_graph
```

内部归一化：

```ts
export function normalizeCodebaseMemoryToolName(toolName: string): string | undefined;
```

返回值为 canonical name：

```text
search_graph
search_code
trace_path
get_code_snippet
query_graph
get_architecture
index_status
index_repository
```

### 10.2 参数字段映射

支持以下 project 字段：

```text
project
projectId
project_id
repo
repository
```

内部统一为：

```ts
canonicalProjectField = "project"
```

原因：当前 codebase-memory MCP 工具以 `project` 参数为主。

## 11. 配置设计

### 11.1 默认配置

```json
{
  "enabled": true,
  "bindingMode": "strict",
  "autoInjectOnCodeTask": true,
  "allowCrossProjectByDefault": false,
  "toolSearchBoost": true,
  "recordEvidence": true,
  "evidenceDir": ".omp/evidence/codex-adapter",
  "maxInjectedContextChars": 6000,
  "maxToolOutputSummaryChars": 4000,
  "degradedMode": "warn",
  "redactSecrets": true
}
```

### 11.2 配置来源

读取优先级：

1. 项目级 `.omp/codex-adapter.json`
2. 项目级 `omp-custom.config.json`
3. 用户级 `~/.omp-custom/codex-adapter.json`
4. 默认配置

首版不直接修改 Codex 官方配置。安装说明可以指导用户把 hook 注册到 Codex 配置，但 Adapter 自身只读取自己的配置。

## 12. 存储设计

### 12.1 项目绑定文件

路径：

```text
.omp/codebase-memory-binding.json
```

结构：

```json
{
  "schemaVersion": 1,
  "host": "codex",
  "projectId": "Users-mima1234-Code-super-oh-my-pi",
  "root": "/Users/mima1234/Code/super/oh-my-pi",
  "bindingMode": "strict",
  "allowCrossProject": false,
  "lastSessionId": "codex-session-id",
  "updatedAt": "2026-07-09T00:00:00+08:00"
}
```

写入策略：

- 首版默认不自动创建，除非用户执行初始化命令。
- `session_start` 只读取。
- 初始化命令另行在实现计划中定义。

### 12.2 Evidence 文件

路径：

```text
.omp/evidence/codex-adapter/YYYY-MM-DD.jsonl
```

写入策略：

- append-only。
- 每行一个 JSON object。
- 写入前确保目录存在。
- 写入失败时返回 degraded evidence 到 hook 输出，但不阻断主流程。

### 12.3 临时状态

Codex hook 脚本之间可能是独立进程，因此不能依赖进程内内存共享。

首版状态读取策略：

- 项目绑定从文件和 cwd 重算。
- 配置从文件重读。
- evidence 追加到文件。
- 不依赖长期 daemon。

后续可引入 broker / daemon，但不属于首版。

## 13. 降级模式设计

降级原因：

| 原因 | code | 行为 |
| --- | --- | --- |
| 未找到项目身份 | `project_binding_missing` | 不注入或注入警告 |
| 当前项目未索引 | `project_not_indexed` | 建议运行索引 |
| MCP transport 断开 | `mcp_transport_closed` | 标记不可用，不声称读取图谱 |
| evidence 写入失败 | `evidence_write_failed` | 返回诊断，不阻断 |
| 配置解析失败 | `config_parse_failed` | 使用默认安全配置 |
| 工具参数异常 | `invalid_tool_input` | 阻断该工具调用 |

降级状态结构：

```ts
export interface DegradedState {
  code:
    | "project_binding_missing"
    | "project_not_indexed"
    | "mcp_transport_closed"
    | "evidence_write_failed"
    | "config_parse_failed"
    | "invalid_tool_input";
  message: string;
  recoverable: boolean;
  suggestedAction?: string;
}
```

## 14. 安全设计

### 14.1 跨项目访问

默认策略：

- 当前会话绑定一个项目。
- codebase-memory 工具只能访问当前项目。
- 跨项目必须显式越权。
- 越权必须写 evidence。

显式越权识别：

```text
对比 A 和 B 两个项目
跨项目分析
允许访问 <projectId>
显式越权读取 <projectId>
```

首版建议：

- prompt 识别可以作为候选越权信号。
- 真正执行跨项目工具调用时仍要 evidence 记录。
- 如果 Codex hook 支持交互确认，后续可加确认；首版不强依赖。

### 14.2 敏感信息脱敏

Evidence 写入前需要执行 redaction：

```ts
export function redactSensitiveValue(value: unknown): unknown;
```

默认脱敏字段：

```text
token
api_key
apikey
secret
password
private_key
authorization
cookie
```

默认脱敏模式：

```text
sk-...
gho_...
ghp_...
-----BEGIN PRIVATE KEY-----
Bearer ...
```

### 14.3 输出摘要

`post_tool_use` 不保存完整源码输出，只保存：

- 文件路径。
- 符号名。
- 命中数量。
- 错误摘要。
- 片段哈希或首尾短摘要。

## 15. 测试设计

### 15.1 单元测试

`core/intent`：

- 代码任务触发。
- 非代码任务不触发。
- explicit opt-out 不触发。
- cwd repo signal 只提升 confidence，不单独触发。

`core/project-binding`：

- 读取 `.codebase-memory/project.json`。
- 读取 `.omp/codebase-memory-binding.json`。
- 子目录向上解析 root。
- 找不到绑定时返回 degraded。

`core/codebase-memory`：

- 工具名归一化。
- project 字段归一化。
- 缺少 project 自动补参。
- 非 codebase-memory 工具不处理。

`core/policy`：

- 当前项目放行。
- 缺 project rewrite。
- 跨项目 block。
- 显式越权 allow。

`core/evidence`：

- JSONL 追加。
- 敏感字段脱敏。
- 大输出截断。
- 写入失败不抛到主流程。

### 15.2 Adapter 测试

`user-prompt-submit.test.ts`：

- 输入代码任务，输出 additional context。
- 输入普通聊天，不输出 context。
- 项目未绑定，输出 degraded context。

`pre-tool-use.test.ts`：

- `search_graph` 缺 project，返回 updated input。
- `search_graph` 跨项目，返回 block。
- 非 codebase-memory 工具，返回 continue。

`post-tool-use.test.ts`：

- 成功结果写 evidence。
- 错误结果写 evidence。
- 大结果摘要化。
- 敏感结果脱敏。

`tool-search-metadata.test.ts`：

- 中文 query 能命中 codebase-memory 工具。
- 英文 query 能命中 codebase-memory 工具。
- 每个目标工具都有 metadata。

### 15.3 集成测试

推荐用 fixture 模拟 Codex hook stdin/stdout：

```text
fixtures/codex-hooks/
  session-start.ready.json
  user-prompt-submit.code-task.json
  user-prompt-submit.non-code.json
  pre-tool-use.search-graph-missing-project.json
  pre-tool-use.cross-project.json
  post-tool-use.search-graph-success.json
```

集成测试验收：

- hook 输入输出 JSON 可被 Codex 接受。
- evidence 文件写入符合 schema。
- 降级模式不导致非零退出。

### 15.4 手工验收

在一个已索引项目中：

```text
用户输入：分析这个项目的 MCP 工具加载流程
期望：user_prompt_submit 注入 codebase-memory 上下文
```

模型调用：

```json
{
  "tool": "search_graph",
  "arguments": {
    "query": "MCP 工具加载"
  }
}
```

期望：

- `pre_tool_use` 自动补入当前 project。
- 工具正常执行。
- `post_tool_use` 写 evidence。

跨项目调用：

```json
{
  "tool": "search_graph",
  "arguments": {
    "project": "Users-mima1234-Code-other",
    "query": "MCP 工具加载"
  }
}
```

期望：

- 默认阻断。
- 写入 `tool_use_blocked` evidence。

## 16. 可观测性

### 16.1 Evidence 查询

首版可以用本地命令检查：

```sh
tail -n 20 .omp/evidence/codex-adapter/2026-07-09.jsonl
```

后续可加诊断命令：

```sh
omp-custom codex-adapter doctor
omp-custom codex-adapter evidence --today
omp-custom codex-adapter binding
```

### 16.2 关键指标

| 指标 | 来源 | 目标 |
| --- | --- | --- |
| 代码任务自动注入次数 | `prompt_submit` evidence | 持续上升 |
| 非代码任务误触发次数 | skipped / manual audit | 低于 10% |
| 工具参数 rewrite 次数 | `tool_use_rewrite` evidence | 可解释 |
| 跨项目 block 次数 | `tool_use_blocked` evidence | 100% 可追踪 |
| 降级次数 | `degraded` evidence | 可恢复 |
| evidence 写入失败次数 | hook diagnostics | 接近 0 |

## 17. 与 OMP 自定义能力的关系

### 17.1 不迁移 PlanRun 首版运行时

Codex Adapter 首版不实现完整 PlanRun。它只沉淀 evidence，使未来 PlanRun 能消费 Codex 工具调用事实。

### 17.2 共享策略，不共享宿主接线

共享：

- 意图分类。
- 项目绑定。
- 工具名和参数归一化。
- evidence schema。
- 安全和降级策略。

不共享：

- OMP extension runner。
- OMP synthetic message 注入方式。
- Codex hook stdin/stdout contract。
- Codex tool_search spec。

### 17.3 后续迁移边界

当 `omp-custom/core` 稳定后，可以逐步让 OMP 当前实现调用同一套 core：

```text
packages/coding-agent/src/codebase-memory-autocontext.ts
  -> adapter-omp/prompt-injection
  -> core/intent
  -> core/codebase-memory
```

这样 OMP 和 Codex 的 codebase 自动触发策略会逐步一致。

## 18. 实施分解建议

虽然本 TRD 不是实现计划，但建议后续计划按以下顺序拆分：

1. 抽象 `omp-custom/core` 接口和测试。
2. 实现项目绑定与 evidence 写入。
3. 实现 Codex hook IO 适配。
4. 实现 `user_prompt_submit` 自动注入。
5. 实现 `pre_tool_use` scope guard。
6. 实现 `post_tool_use` evidence writer。
7. 实现 tool_search metadata builder。
8. 做 fixture 集成测试。
9. 写安装说明和 doctor 诊断。

## 19. 验收清单

首版完成时必须满足：

- [ ] `user_prompt_submit` 能识别代码任务并注入 codebase-memory 上下文。
- [ ] 普通聊天不会注入 codebase-memory。
- [ ] `pre_tool_use` 能给缺少 project 的 codebase-memory 调用补参。
- [ ] `pre_tool_use` 默认阻断跨项目 codebase-memory 调用。
- [ ] `tool_search` 中文和英文查询都能发现 codebase-memory 工具。
- [ ] `post_tool_use` 能写入 JSONL evidence。
- [ ] evidence 脱敏并摘要化，不保存完整敏感输出。
- [ ] MCP 不可用时进入 degraded mode，不阻断普通 Codex 对话。
- [ ] Adapter 不修改 Codex core。
- [ ] OMP 现有功能不因 Adapter 设计发生行为变化。

## 20. 代码落点建议

首版在 `BearMaxDD/omp-custom` 独立仓库实现，`BearMaxDD/oh-my-pi` 只保留文档和后续接线说明。

如果需要在 `oh-my-pi` fork 中预留接线点，建议只新增：

```text
packages/coding-agent/src/omp-custom/
  adapter-loader.ts
  types.ts
```

不建议在 `packages/coding-agent/src/codebase-memory-autocontext.ts` 继续堆叠 Codex 特有逻辑。

## 21. 风险控制

| 风险 | 技术影响 | 控制措施 |
| --- | --- | --- |
| Codex hook contract 变化 | Adapter 输入输出失效 | hook IO 单独封装，fixture 测试覆盖 |
| 分类器误触发 | 普通聊天污染 | opt-out、non-code pattern、项目级开关 |
| MCP 工具名变化 | pre/post hook 无法识别 | 工具名归一化支持多种命名 |
| 多进程 hook 无共享内存 | 状态丢失 | 所有状态文件化或每次重算 |
| evidence 太大 | 磁盘和隐私风险 | 摘要、截断、脱敏 |
| 跨项目误读 | 安全和上下文污染 | 默认 block，越权 evidence |
| 直接改 Codex core | 维护成本升高 | Adapter-only 原则 |

## 22. 结论

Codex Adapter 的技术核心是把 OMP 已有的 codebase-memory 经验从“单宿主 prompt 注入”升级为“跨宿主策略核心 + Codex 生命周期适配”。

首版不追求完整复制 OMP PlanRun，而是先让 Codex 在代码任务中形成稳定闭环：

```text
自动识别代码任务
  -> 绑定当前项目
  -> 提升 codebase-memory 工具发现率
  -> 工具调用前强隔离
  -> 工具调用后写 evidence
```

这条闭环完成后，`BearMaxDD/omp-custom` 就具备同时服务 OMP 和 Codex 的基础架构，后续再逐步接入 PlanRun、Superpowers 和验收审查能力。
