# OMP 自定义能力独立仓库化 PRD

## 1. 文档信息

| 项目 | 内容 |
| --- | --- |
| 文档名称 | OMP 自定义能力独立仓库化 PRD |
| 所属仓库 | `BearMaxDD/oh-my-pi` |
| 长期分支 | `mima/omp-custom` |
| 当前官方基线 | `upstream/main` / `v16.3.3` |
| 文档日期 | 2026-07-03 |
| 文档类型 | 产品需求文档 |
| 目标读者 | 个人维护者、后续实现代理、代码审查者 |

## 2. 背景

当前 `mima/omp-custom` 分支是在官方 OMP 基础上的个人增强版本。分支已经引入了围绕计划执行、Superpowers 技能门禁、codebase-memory 上下文、任务模型路由、审查证据、执行闭环等能力的大量改造。

这些改造目前主要散落在 `packages/coding-agent` 内部：

- `src/codex-plan-run/**`
- `src/superpowers/**`
- `src/plan-gate/**`
- `src/codebase-memory-autocontext.ts`
- `src/task/model-routing.ts`
- `src/task/single-subagent-runner.ts`
- `src/tools/plan-execution-book.ts`
- `src/tools/plan-repair-loop.ts`
- `src/tools/code-write-policy.ts`
- CLI、斜杠命令、模型角色、设置结构、任务执行器、工具注册和 UI 状态等接线补丁点

这种形态可以快速迭代，但会带来长期维护压力：

- 跟随官方更新时，冲突分散在大量核心文件中。
- 个人增强能力和官方核心运行时边界不清。
- 新增功能时难以判断应该继续改核心，还是通过扩展机制接入。
- 测试散布在 `packages/coding-agent/test`，难以区分官方行为回归和个人增强回归。
- README 已经说明了自定义版能力，但代码结构还没有形成对应的产品边界。

官方仓库本身已经是单体仓库结构：

- TypeScript/Bun 工作区通过 `packages/*` 纳入子包。
- Rust 工作区通过 `crates/pi-*` 纳入原生能力包。
- 现有 `packages/swarm-extension` 已经展示了扩展包通过 `omp.extensions` 注册斜杠命令和能力的模式。

因此，自定义能力应从“核心补丁集合”升级为“独立仓库实现 + `oh-my-pi` fork 少量接线补丁”的长期维护形态。实现主体迁出到 `BearMaxDD/omp-custom`，`BearMaxDD/oh-my-pi` 只负责加载、注册和适配官方核心接口。

## 3. 产品目标

### 3.1 核心目标

将 BearMaxDD 的 OMP 自定义能力迁出到独立仓库 `BearMaxDD/omp-custom`，使个人增强能力具备独立版本、独立测试、独立发布/引用能力，并让 `BearMaxDD/oh-my-pi` fork 只保留少量接线补丁，从而降低 upstream 合并成本。

### 3.2 具体目标

1. 新建独立仓库 `BearMaxDD/omp-custom`，作为个人魔改能力主体。
2. 将计划执行、Superpowers、codebase-memory、任务模型路由、自定义工具等能力从 `packages/coding-agent` 核心目录迁移到独立仓库。
3. 将 `BearMaxDD/oh-my-pi` fork 中的改动压缩为薄接线补丁。
4. 保持当前用户可见行为不变，包括 CLI、斜杠命令、模型角色、任务执行和配置项。
5. 建立独立仓库的测试边界，让自定义能力单元测试跟随独立仓库迁移。
6. 为后续同步官方 OMP 提供稳定流程：官方核心更新时优先适配接线补丁，而不是重新处理大量散落逻辑。

## 4. 非目标

本 PRD 不包含以下事项：

- 不重写 OMP 官方插件系统。
- 不改变官方包名、官方发布流程或官方 npm 包语义。
- 不把所有个人功能拆成多个独立 npm 包；首轮只建设一个独立仓库和一个主包。
- 不在首轮迁移中改动 Rust 原生包结构。
- 不改变当前 `mima/omp-custom` 分支作为长期个人分支的定位。
- 不要求独立包产物立刻发布到 npm；首轮可以通过 Git 依赖或本地 link 接入。
- 不要求兼容官方 main 分支之外的旧版本。

## 5. 用户与使用场景

### 5.1 主要用户

**个人维护者**

维护自己的 OMP 魔改版，同时希望持续跟随官方更新。

**实现代理**

后续执行迁移任务时，需要知道哪些代码应迁入独立仓库，哪些代码应留在 `oh-my-pi` fork 的接线补丁层。

**代码审查者**

审查未来迁移 PR 时，需要判断变更是否降低了合并冲突、是否保持行为一致。

### 5.2 核心场景

**场景一：同步官方更新**

维护者执行：

```sh
git fetch upstream --tags
git merge upstream/main
```

期望大多数冲突集中在少数接线补丁文件中，而不是散落在 `codex-plan-run`、`superpowers`、`task`、`tools` 等大量实现文件里。

**场景二：继续开发 PlanRun**

维护者新增计划执行能力时，主要修改独立仓库：

```text
BearMaxDD/omp-custom/src/plan-run/**
```

只有在需要暴露新入口或适配官方接口变化时，才改动 `BearMaxDD/oh-my-pi` fork 的注册点。

**场景三：增强 codebase-memory 门禁**

维护者调整 codebase-memory 策略时，主要修改独立仓库：

```text
BearMaxDD/omp-custom/src/codebase-memory/**
BearMaxDD/omp-custom/src/superpowers/**
```

核心代理只消费独立仓库产物导出的注册函数或策略对象。

**场景四：验证个人增强能力**

维护者运行独立仓库测试：

```sh
cd /Users/mima1234/Code/super/omp-custom
bun run check
bun test
```

再回到 `oh-my-pi` fork 运行整仓检查：

```sh
cd /Users/mima1234/Code/super/oh-my-pi
bun run check
```

## 6. 产品范围

### 6.1 第一阶段范围

建立独立仓库：

```text
BearMaxDD/omp-custom
```

该独立仓库承载当前自定义能力主体：

- PlanRun 执行闭环
- Superpowers 技能桥接与门禁
- codebase-memory 自动上下文与重建索引逻辑
- 任务模型路由
- 单子代理执行器
- 自定义计划执行工具
- 写代码策略工具
- 计划门禁和冒烟能力
- 对外 extension 入口

### 6.2 第二阶段范围

减少 `BearMaxDD/oh-my-pi` fork 中的实现型代码：

- 保留命令注册。
- 保留模型角色注册。
- 保留设置结构接线。
- 保留工具注册接线。
- 保留任务执行器接线。
- 保留 UI 状态消费接线。

### 6.3 第三阶段范围

建立长期维护规范：

- README 增加“自定义能力独立仓库架构”说明。
- 新增独立仓库 README。
- 增加 upstream 同步后的检查清单。
- 增加测试分层说明。

## 7. 推荐架构

### 7.1 目标目录

```text
BearMaxDD/omp-custom/
  package.json
  README.md
  src/
    index.ts
    extension.ts

    plan-run/
      index.ts
      advisor-findings.ts
      advisor-gate.ts
      advisor-summary.ts
      artifact-graph.ts
      autonomous-planner.ts
      default-runtime-runner.ts
      driver.ts
      driver-launcher.ts
      events.ts
      execution-book.ts
      execution-loop-settings.ts
      gate-failure-summary.ts
      git-state.ts
      global-impact.ts
      lifecycle-events.ts
      main-acceptance-review.ts
      manifest.ts
      materialize.ts
      model-routing-evidence.ts
      packet-guard.ts
      plan-run-entry.ts
      plan-run-panel-model.ts
      plan-run-spawn-adapter.ts
      plan-run-status-sink.ts
      prompt-pack.ts
      real-runtime-simulation.ts
      repair-loop.ts
      role-bound-stage-scheduler.ts
      role-bound-todo-snapshot.ts
      runtime-executors.ts
      runtime-scenarios.ts
      skill-evidence.ts
      skill-gate.ts
      spec-task-framework.ts
      stage-ledger.ts
      state-machine.ts
      task-review.ts
      tdd-evidence.ts
      todo-snapshot.ts
      types.ts
      segmented-write/

    superpowers/
      agent-bridge.ts
      codebase-memory-gate.ts

    codebase-memory/
      autocontext.ts
      recon.ts
      reindex.ts
      execution-gate.ts

    plan-gate/
      execution-book.ts
      smoke.ts

    task-routing/
      model-routing.ts
      single-subagent-runner.ts

    tools/
      code-write-policy.ts
      plan-execution-book.ts
      plan-repair-loop.ts

    commands/
      plan-run.ts
      superpowers.ts

  test/
    plan-run/
    superpowers/
    codebase-memory/
    plan-gate/
    task-routing/
    tools/

BearMaxDD/oh-my-pi/
  packages/coding-agent/
    src/
      commands/
      config/
      task/
      tools/
      modes/
```

### 7.2 包命名

推荐包名：

```json
{
  "name": "@bearmaxdd/omp-custom"
}
```

原因：

- 与官方 `@oh-my-pi/*` 命名空间区分。
- 明确属于 BearMaxDD 自定义能力。
- 后续如果发布到私有 npm 或 GitHub Packages，命名空间清晰。

### 7.3 独立仓库与包职责

`@bearmaxdd/omp-custom` 负责：

- 提供个人增强能力的实现。
- 提供自定义 extension 入口。
- 提供 `oh-my-pi` fork 接线需要的注册函数。
- 提供可单独运行的测试。
- 提供自定义能力文档。
- 通过独立仓库维护版本、变更记录和发布节奏。

`@oh-my-pi/pi-coding-agent` 负责：

- 维持官方核心代理运行时。
- 加载扩展和插件。
- 暴露必要接口。
- 在少数位置调用 `@bearmaxdd/omp-custom` 的注册函数。

`BearMaxDD/oh-my-pi` fork 负责：

- 跟随官方 OMP 更新。
- 引入 `@bearmaxdd/omp-custom`。
- 保留最小接线补丁。
- 执行整合验证和发布。

## 8. 功能需求

### PRD-001：新增独立仓库

**需求描述**

必须新增独立仓库 `BearMaxDD/omp-custom`，并将其作为 BearMaxDD 自定义能力主体。`BearMaxDD/oh-my-pi` fork 通过 Git 依赖、本地 link 或后续 npm 包引用该仓库产物。

**验收标准**

- 存在独立仓库 `BearMaxDD/omp-custom`。
- 存在 `package.json`。
- 包名为 `@bearmaxdd/omp-custom`。
- 包含 `check`、`lint`、`fmt`、`test` 脚本。
- `bun install` 后，该仓库可独立安装依赖。
- `bun run check` 可在独立仓库内执行。
- `BearMaxDD/oh-my-pi` fork 可通过依赖声明解析 `@bearmaxdd/omp-custom`。

### PRD-002：提供统一导出入口

**需求描述**

独立仓库必须通过 `src/index.ts` 提供稳定导出，供 `oh-my-pi` fork 接线层和测试使用。

**验收标准**

- `src/index.ts` 导出 PlanRun、Superpowers、codebase-memory、task-routing、tools 的公共 API。
- 不从外部直接依赖深层文件路径作为长期接口。
- 深层路径仅允许独立仓库内部测试使用。

### PRD-003：提供 extension 入口

**需求描述**

独立仓库必须支持 OMP 扩展机制，通过 `src/extension.ts` 注册自定义斜杠命令。

**验收标准**

- `package.json` 包含：

```json
{
  "omp": {
    "extensions": ["./src/extension.ts"]
  }
}
```

- `extension.ts` 至少注册 `/plan-run` 和 `/superpowers`。
- 注册逻辑不依赖全局副作用。
- 禁用扩展时，核心代理仍可正常启动。

### PRD-004：迁移 PlanRun 能力

**需求描述**

`packages/coding-agent/src/codex-plan-run/**` 中的实现逻辑应迁移到：

```text
BearMaxDD/omp-custom/src/plan-run/**
```

**验收标准**

- 原 PlanRun 单元测试迁移到独立仓库测试目录。
- `packages/coding-agent` 中不再保留 PlanRun 的大块实现。
- 如需兼容旧 import，原路径只能保留 re-export 适配层。
- `/plan-run` 用户行为保持不变。
- `plan-run` CLI 行为保持不变。

### PRD-005：迁移 Superpowers 能力

**需求描述**

Superpowers 相关桥接、技能门禁、codebase-memory 强制检查能力应迁移到独立仓库。

**验收标准**

- `agent-bridge.ts` 迁移到 `src/superpowers/agent-bridge.ts`。
- `codebase-memory-gate.ts` 迁移到 `src/superpowers/codebase-memory-gate.ts`。
- PlanRun 使用的 Superpowers 执行门禁迁移到 `src/codebase-memory/execution-gate.ts` 或 `src/superpowers/` 下的清晰位置。
- 原有测试迁移并通过。

### PRD-006：迁移 codebase-memory 自动上下文

**需求描述**

codebase-memory 自动上下文注入、侦察和重建索引逻辑应独立成模块。

**验收标准**

- `codebase-memory-autocontext.ts` 迁移到 `src/codebase-memory/autocontext.ts`。
- `codebase-memory-recon.ts` 迁移到 `src/codebase-memory/recon.ts`。
- `codebase-memory-reindex.ts` 迁移到 `src/codebase-memory/reindex.ts`。
- 设置项仍能控制 `off`、`advisory`、`required` 等模式。
- 当 codebase-memory 不可用时，错误提示和降级策略保持当前行为。

### PRD-007：迁移自定义工具

**需求描述**

计划执行相关工具和写代码策略工具应迁移到独立仓库，并通过 `oh-my-pi` fork 的核心工具注册点接入。

**验收标准**

- `plan-execution-book.ts` 迁移到 `src/tools/plan-execution-book.ts`。
- `plan-repair-loop.ts` 迁移到 `src/tools/plan-repair-loop.ts`。
- `code-write-policy.ts` 迁移到 `src/tools/code-write-policy.ts`。
- `packages/coding-agent/src/tools/index.ts` 中只保留注册适配。
- 工具 schema 和原有工具名保持兼容。

### PRD-008：迁移任务路由能力

**需求描述**

任务模型路由、单子代理执行器等个人增强能力应进入独立仓库。

**验收标准**

- `task/model-routing.ts` 迁移到 `src/task-routing/model-routing.ts`。
- `task/single-subagent-runner.ts` 迁移到 `src/task-routing/single-subagent-runner.ts`。
- `task/executor.ts` 中只保留调用适配。
- 原有 task 相关测试继续通过。
- 子代理模型路由证据仍可渲染或输出。

### PRD-009：fork 薄接线

**需求描述**

`BearMaxDD/oh-my-pi` fork 中保留的自定义改动必须尽量变成薄接线补丁。

**验收标准**

fork 允许保留改动的文件类型：

- CLI 命令注册
- 斜杠命令注册
- 设置 schema 注册
- 模型角色注册
- 工具注册
- task executor 接入点
- UI 状态消费点

fork 不应继续承载大块自定义业务逻辑。

### PRD-010：测试迁移和分层

**需求描述**

测试应跟随能力边界迁移。

**验收标准**

独立仓库内保留：

- PlanRun 单元测试
- Superpowers 单元测试
- codebase-memory 策略测试
- task-routing 单元测试
- custom tools 单元测试

`oh-my-pi` fork 内保留：

- CLI 到独立仓库产物的集成测试
- 斜杠命令注册集成测试
- 工具注册集成测试
- task executor 接线集成测试
- 设置 schema 集成测试

### PRD-011：文档更新

**需求描述**

README 和独立仓库 README 必须说明独立仓库化架构。

**验收标准**

- `oh-my-pi` fork 根 README 增加“自定义能力独立仓库架构”小节。
- `BearMaxDD/omp-custom/README.md` 说明仓库职责、入口、测试命令和维护边界。
- 文档必须全中文。
- 文档必须说明后续同步官方时优先检查哪些接线补丁。

## 9. 配置需求

### 9.1 fork 依赖

`BearMaxDD/oh-my-pi` fork 的 `packages/coding-agent/package.json` 应新增对独立仓库产物的依赖。首选 Git 依赖或本地开发 link；后续如果发布 npm，可切换为版本号依赖。

Git 依赖示例：

```json
{
  "dependencies": {
    "@bearmaxdd/omp-custom": "github:BearMaxDD/omp-custom"
  }
}
```

本地开发可使用：

```sh
cd /Users/mima1234/Code/super/omp-custom
bun link

cd /Users/mima1234/Code/super/oh-my-pi/packages/coding-agent
bun link @bearmaxdd/omp-custom
```

### 9.2 独立仓库依赖

独立仓库应尽量减少对 `oh-my-pi` 内部源码路径的直接依赖。需要类型或运行时能力时，优先依赖可公开解析的包；如果暂时只能依赖 fork 中的内部类型，应通过 adapter 隔离。

```json
{
  "dependencies": {
    "@oh-my-pi/pi-agent-core": "16.3.3",
    "@oh-my-pi/pi-utils": "16.3.3"
  }
}
```

如果必须使用 `pi-coding-agent` 的扩展类型，可优先通过 `peerDependencies` 表达宿主约束：

```json
{
  "peerDependencies": {
    "@oh-my-pi/pi-coding-agent": ">=16.3.3"
  }
}
```

如果出现循环依赖，应优先抽象类型接口，避免让 `pi-coding-agent` 与 `@bearmaxdd/omp-custom` 互相强依赖。

### 9.3 循环依赖控制

若独立仓库需要使用 `pi-coding-agent` 的类型，同时 `pi-coding-agent` 又需要导入独立仓库实现，必须选择以下方案之一：

1. 将共享类型提到更底层包，例如 `pi-agent-core` 或 `pi-utils`。
2. 独立仓库只导出纯函数，`oh-my-pi` fork 传入运行时适配器。
3. 对 extension 入口使用运行时加载，避免静态循环。

推荐优先使用第二种：fork 传入适配器，独立仓库不直接掌控核心运行时。

## 10. 用户体验要求

### 10.1 命令体验保持不变

迁移后，下列入口行为必须保持兼容：

- `omp plan-run`
- `/plan-run`
- `/superpowers`
- 相关 RPC 调用
- 相关 ACP 映射
- 任务执行中的模型路由提示
- todo 阶段渲染
- advisor / acceptance / task 等自定义模型角色显示

### 10.2 错误提示保持清晰

当独立仓库产物未加载、配置缺失或 codebase-memory 不可用时，错误提示必须说明：

- 哪个能力不可用。
- 当前是阻塞还是降级。
- 用户可以如何修复。

### 10.3 默认行为不增加负担

迁移不应让普通 `omp` 启动变慢、输出变吵或配置更复杂。

## 11. 数据和状态

本项目不新增持久业务数据库。

涉及的状态包括：

- OMP 设置文件中的自定义配置项。
- PlanRun 执行过程中的状态文件或产物。
- codebase-memory 索引状态。
- 会话内 todo、advisor、task、acceptance 等运行时状态。

迁移原则：

- 状态格式保持兼容。
- 旧状态可继续读取。
- 如必须变更格式，需要提供迁移或兼容读取逻辑。

## 12. 技术边界

### 12.1 可以迁入独立仓库

- 纯 TypeScript 业务逻辑
- 命令 handler
- extension 注册逻辑
- 工具定义和工具 handler
- 策略计算
- prompt pack
- 状态机
- 计划执行报告和证据模型
- 测试辅助函数

### 12.2 暂不迁入独立仓库

- OMP 核心 CLI bootstrap
- 官方 plugin loader 本身
- 官方 extension runner 本身
- 官方 model registry 底层实现
- 官方 TUI 基础组件
- 官方 session 核心生命周期

这些能力只通过接线补丁消费独立仓库产物。

## 13. 迁移策略

### 13.1 总体策略

采用“先迁出到独立仓库，再在 fork 中接线替换，再删除旧实现”的方式。

不建议一次性大爆炸迁移。每一组能力迁移后都必须运行对应测试。

### 13.2 建议顺序

1. 创建独立仓库 `BearMaxDD/omp-custom`。
2. 迁移 PlanRun 纯逻辑。
3. 迁移 PlanRun 测试。
4. 通过 re-export 保持旧路径兼容。
5. 迁移 Superpowers 和 codebase-memory。
6. 迁移自定义 tools。
7. 迁移 task-routing。
8. 压缩 `oh-my-pi` fork 接线补丁。
9. 更新 README。
10. 全量检查并提交。

### 13.3 每步验证

每完成一个迁移单元，至少运行：

```sh
cd /Users/mima1234/Code/super/omp-custom
bun run check

cd /Users/mima1234/Code/super/oh-my-pi
bun run check
```

涉及 PlanRun 时额外运行：

```sh
cd /Users/mima1234/Code/super/omp-custom
bun test test/plan-run
```

涉及核心 CLI 时额外运行：

```sh
bun test packages/coding-agent/test/cli-argv-routing.test.ts
bun test packages/coding-agent/test/codex-plan-run/plan-run-cli-e2e.test.ts
```

具体测试路径可在迁移后按实际位置调整。

## 14. 验收标准

### 14.1 功能验收

- `/plan-run` 可正常执行。
- `omp plan-run` 可正常执行。
- Superpowers 门禁仍在需要时触发。
- codebase-memory 自动上下文行为保持一致。
- task 模型路由行为保持一致。
- 自定义工具仍能被发现并调用。
- 现有 README 描述的自定义功能仍成立。

### 14.2 结构验收

- 存在 `BearMaxDD/omp-custom` 独立仓库。
- 自定义能力主体位于该独立仓库内。
- `packages/coding-agent` 中的自定义实现代码明显减少。
- fork 接线补丁有清晰注释或导入边界。
- 测试按独立仓库和 fork 集成层分层。

### 14.3 同步官方验收

模拟一次 upstream 合并或至少执行冲突影响评估：

```sh
git fetch upstream --tags
git merge --no-commit --no-ff upstream/main
```

若不实际合并，也必须通过 diff 评估说明：

- 哪些文件仍是高冲突接线补丁。
- 哪些原本散落的自定义逻辑已经不再直接冲突。

### 14.4 检查验收

必须通过：

```sh
git diff --check
bun run check
```

如果存在仓库既有 warning，必须在最终说明中标明与本次迁移无关。

## 15. 风险与应对

### 15.1 循环依赖风险

**风险**

`pi-coding-agent` 依赖 `@bearmaxdd/omp-custom`，而独立仓库又依赖 `pi-coding-agent` 类型，可能形成循环。

**应对**

- 优先将独立仓库设计为纯逻辑包。
- `oh-my-pi` fork 向独立仓库传入 adapter。
- 共享类型尽量上移到更底层包。

### 15.2 插件能力不足风险

**风险**

部分能力无法完全通过 extension 注册，例如模型角色、settings schema、task executor 深层行为。

**应对**

- 保留 fork 薄接线补丁。
- 标记不可插件化的接入点。
- 后续逐步抽注册接口。

### 15.3 一次迁移过大风险

**风险**

一次性移动大量文件会导致 import、测试、路径、快照同时失效。

**应对**

- 按能力分批迁移。
- 每批保持 re-export 兼容。
- 每批独立提交。

### 15.4 行为回归风险

**风险**

迁移后 CLI、斜杠命令或 RPC 路径行为不一致。

**应对**

- 保留核心集成测试。
- 增加迁移前后行为等价测试。
- 对用户可见入口优先做冒烟测试。

### 15.5 upstream 冲突仍然存在

**风险**

模型角色、settings schema、task executor、UI 状态等深接线点仍会和官方冲突。

**应对**

- 接受少量冲突点存在。
- 用文档列出固定检查点。
- 后续有机会再把这些核心点抽象成 registry。

## 16. 开放问题

1. 独立仓库是否需要将来发布到 npm，还是长期通过 Git 依赖接入？
2. `@bearmaxdd/omp-custom` 是否应该被默认启用，还是通过配置显式启用？
3. PlanRun 是否最终应作为 extension 命令存在，还是继续保留顶层 CLI 命令？
4. 自定义模型角色是否需要形成独立 registry，避免继续修改核心 role 定义？
5. codebase-memory 的强制门禁是否应该只在 Superpowers 模式启用，还是对所有代码任务启用？

## 17. 推荐决策

本 PRD 推荐：

1. 首轮只做一个独立仓库和一个主包：`BearMaxDD/omp-custom` / `@bearmaxdd/omp-custom`。
2. 默认在 `mima/omp-custom` 分支启用该包。
3. PlanRun 同时保留顶层 CLI 和 slash command。
4. 独立包产物先不发布 npm，优先通过 Git 依赖或本地 link 接入。
5. `oh-my-pi` fork 接线补丁允许存在，但必须薄、集中、可审查。
6. 后续如果某类能力稳定，再考虑拆成更细的包。

## 18. 成功指标

迁移完成后，应达到以下效果：

- 自定义能力主体不再散落在 `packages/coding-agent/src` 根层级。
- 官方同步时，冲突文件数量下降。
- 新增个人增强能力时，默认落在 `BearMaxDD/omp-custom`。
- 独立仓库可以单独运行检查和测试。
- README 和独立仓库 README 能让后续代理快速理解维护边界。
- 用户使用体验不发生破坏性变化。

## 19. 后续交付物

本 PRD 之后建议继续产出：

1. 详细技术设计文档。
2. 可执行迁移计划。
3. 分批提交清单。
4. 迁移验收清单。
5. README 架构说明更新。
