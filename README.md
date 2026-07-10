<p align="center">
  <img src="https://github.com/can1357/oh-my-pi/blob/main/assets/hero.png?raw=true" alt="omp">
</p>

<p align="center">
  <strong>一个把 IDE 能力接进来的编码代理。</strong>
  <strong><a href="https://omp.sh">omp.sh</a></strong>
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@oh-my-pi/pi-coding-agent"><img src="https://img.shields.io/npm/v/@oh-my-pi/pi-coding-agent?style=flat&colorA=222222&colorB=CB3837" alt="npm 版本"></a>
  <a href="https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/CHANGELOG.md"><img src="https://img.shields.io/badge/changelog-keep-E05735?style=flat&colorA=222222" alt="更新日志"></a>
  <a href="https://github.com/can1357/oh-my-pi/actions"><img src="https://img.shields.io/github/actions/workflow/status/can1357/oh-my-pi/ci.yml?style=flat&colorA=222222&colorB=3FB950" alt="持续集成"></a>
  <a href="https://github.com/can1357/oh-my-pi/blob/main/LICENSE"><img src="https://img.shields.io/github/license/can1357/oh-my-pi?style=flat&colorA=222222&colorB=58A6FF" alt="许可证"></a>
  <a href="https://www.typescriptlang.org"><img src="https://img.shields.io/badge/TypeScript-3178C6?style=flat&colorA=222222&logo=typescript&logoColor=white" alt="TypeScript"></a>
  <a href="https://www.rust-lang.org"><img src="https://img.shields.io/badge/Rust-DEA584?style=flat&colorA=222222&logo=rust&logoColor=white" alt="Rust"></a>
  <a href="https://bun.sh"><img src="https://img.shields.io/badge/runtime-Bun-f472b6?style=flat&colorA=222222" alt="Bun"></a>
  <a href="https://discord.gg/4NMW9cdXZa"><img src="https://img.shields.io/badge/Discord-5865F2?style=flat&colorA=222222&logo=discord&logoColor=white" alt="Discord"></a>
</p>

<p align="center">
  基于 <a href="https://github.com/mariozechner">@mariozechner</a> 的 <a href="https://github.com/badlogic/pi-mono">Pi</a> 派生而来。
</p>

## BearMaxDD / OMP 自定义版说明

这是 BearMaxDD 维护的个人魔改版 OMP 分支，长期分支为 `mima/omp-custom`。

本分支的维护目标是：**保留个人工作流增强，同时持续跟随官方 `can1357/oh-my-pi` 更新**。官方代码通过 `upstream` 同步，个人派生仓库通过 `origin` 推送。

当前状态：

- 派生仓库：`https://github.com/BearMaxDD/oh-my-pi`
- 长期魔改分支：`mima/omp-custom`
- 当前官方基线：`upstream/main` / `v16.3.3`
- 本地魔改导入点：`4772b1573`，用于沉淀旧版个人定制内容
- 当前官方合并点：`edda6f526`，已合并官方 `v16.3.3`

### 这个版本实现的主要功能

本分支在官方 OMP 基础上，重点增加和强化以下能力：

- **自主计划执行工作流**
  - 增加 `/plan-run <request>` 自主执行入口。
  - 引入计划执行记录、计划运行清单、阶段台账、完成证据、最终验收审查、修复循环等执行闭环。
  - 让主会话负责规划、门禁、最终验收，子代理负责具体实现任务。

- **增强技能角色化执行体系**
  - 增加 `acceptance`、`task`、`advisor` 以及多组 `superpowers:*` 模型角色。
  - 支持测试驱动编写者、实现者、测试执行者、规格审查者、质量审查者、验收者、运行时模拟者、安全审查者、发布审计者等角色。
  - 模型选择器和状态展示会显示角色说明、模型分配和执行职责。
  - 严格角色阶段会在执行前冻结角色、模型和思考级别绑定；运行时拒绝父模型、重试降级与上下文提升替换。
  - PlanRun 对每个固定阶段保存并验收 V2 路由证据，要求任务完成、模型精确匹配且未使用降级、父模型或上下文提升。

- **codebase-memory 图谱优先上下文**
  - 增加 codebase-memory 自动上下文注入。
  - 对代码理解、计划、调试、实现、审查类请求，优先提示使用 `search_graph`、`trace_path`、`get_code_snippet`、`query_graph` 等图谱工具。
  - 增加增强技能的 codebase-memory 门禁，可配置为 `off`、`advisory` 或 `required`。

- **子代理执行与审查门禁**
  - 增强 `task` 执行器，支持模型路由证据、任务进度渲染、产出结果聚合、结构校验和子代理提醒。
  - 增加顾问门禁、任务审查、主会话最终验收审查、质量审查等多层审查材料。
  - 支持把实现、测试、审查、验收拆成不同角色的可追踪执行包。

- **TDD、验收与真实运行证据**
  - 增加测试驱动证据、运行场景、真实运行模拟、全局影响分析、门禁失败摘要等执行证据模块。
  - 支持在计划执行中记录红灯/绿灯状态、验证命令、失败原因、修复循环和最终验收结论。

- **待办事项与计划执行状态面板**
  - 扩展待办事项阶段、角色绑定待办快照、阻塞状态、模型/角色绑定展示。
  - 增加计划执行面板模型和状态汇入能力，让长任务执行状态更容易在终端界面和远程过程调用中展示。

- **智能压缩与上下文保护**
  - 增加智能压缩路由、快照压缩降级、硬上限、进度保护等上下文维护能力。
  - 目标是在长任务、子代理、多轮验收场景中减少上下文溢出和无效循环。

- **个人开发流程支持**
  - 增加增强技能代理桥接、增强技能代理命令行工具、计划执行记录工具、修复循环工具等本地工作流组件。
  - 补充分段计划写作、执行计划、codebase-memory 侦察/重建索引等围绕 AI 开发闭环的工具链。

### 分支与同步约定

推荐保持两个远端：

```sh
origin   https://github.com/BearMaxDD/oh-my-pi.git
upstream https://github.com/can1357/oh-my-pi.git
```

日常开发：

```sh
git switch mima/omp-custom
git pull
# 修改代码
bun install
bun run check
git push
```

同步官方更新：

```sh
git switch mima/omp-custom
git fetch upstream --tags
git merge upstream/main
bun install
bun run check
git push
```

提交信息约定：

```sh
git commit -m "文档：说明自定义分支能力"
git commit -m "修复：处理计划执行状态同步"
git commit -m "功能：增强 codebase-memory 自动上下文"
```

提交信息优先使用中文，格式建议为：`类型：简短说明`。常用类型包括：`功能`、`修复`、`文档`、`测试`、`重构`、`构建`、`维护`。

### 验证命令

本分支修改后至少运行：

```sh
bun run check
```

计划执行、增强技能、待办事项、顾问模型相关变更，建议额外运行对应测试：

```sh
bun test packages/coding-agent/test/skills-codebase-memory-gate.test.ts \
  packages/coding-agent/test/rpc-skill-command.test.ts \
  packages/coding-agent/test/tools/todo.test.ts \
  packages/coding-agent/test/advisor-toggle.test.ts \
  packages/coding-agent/test/model-selector-role-badge-thinking.test.ts
```

最能打的代理界面，就在这里。它被真实开发工作持续打磨，开箱即用，也完全开放。

**40+** 模型提供方 · **32** 个内置工具 · **14** 类 LSP 操作 · **28** 类 DAP 操作 · **约 55,000** 行 Rust 核心代码。

## 安装

**macOS · Linux**

```sh
curl -fsSL https://omp.sh/install | sh
```

**Homebrew**

```sh
brew install can1357/tap/omp
```

**Bun（推荐）**

```sh
bun install -g @oh-my-pi/pi-coding-agent
```

**Windows（PowerShell）**

```powershell
irm https://omp.sh/install.ps1 | iex
```

**固定版本（mise）**

```sh
mise use -g github:can1357/oh-my-pi
```

支持 macOS、Linux、Windows；需要 bun ≥ 1.3.14。

### Shell 补全

`omp` 会根据实时命令和参数元数据，为 **bash**、**zsh**、**fish** 生成补全脚本，因此补全内容不会和实际 CLI 漂移。子命令、参数、枚举值会静态补全；模型名（`--model`、`--smol`、`--slow`、`--plan`）会从内置模型目录解析，`--resume` 会从本机磁盘会话解析。

```sh
# zsh：加入 ~/.zshrc，也可以把输出写入 $fpath 中的文件
eval "$(omp completions zsh)"

# bash：加入 ~/.bashrc
eval "$(omp completions bash)"

# fish
omp completions fish > ~/.config/fish/completions/omp.fish
```

## 每个工具都被压榨到极限

编辑第一次就能落地。读取文件时会摘要，而不是把整份内容倒进上下文。搜索结果即时返回。你可以选择任何模型，`omp` 会尽量把工具形状调到适合它。

| 模型             | 指标         | 含义                                                                 |
| ---------------- | ------------ | -------------------------------------------------------------------- |
| Grok Code Fast 1 | 6.7% → 68.3% | 当编辑格式不再拖垮模型时，通过率直接十倍提升。                       |
| Gemini 3 Flash   | +5 pp        | 相比 `str_replace` 更强，甚至超过 Google 自己给这个格式的最佳尝试。  |
| Grok 4 Fast      | -61% 词元    | 坏差异的重试循环消失后，输出词元大幅下降。                           |
| MiniMax          | 2.1x         | 通过率翻倍还多。权重相同，提示词相同，只是工具格式更合适。           |

- `read`：摘要片段、合理默认值、选择器命中率
- `search`：飞快搜索
- `lsp`：IDE 知道的内容，代理也知道
- `prompts`：持续按模型调校

[阅读完整文章](https://blog.can.ac/2026/02/12/the-harness-problem/)

## 你喜欢的 Pi，加上全套电池

OMP 最初基于 [Mario Zechner](https://github.com/mariozechner) 的优秀项目 [Pi](https://github.com/badlogic/pi-mono) 构建，并补上了真实编码工作中缺失的能力。

### 01 · 带工具调用的代码执行

很多代理只给一个 Python 沙箱就算完事。OMP 运行持久化 Python 内核和 Bun 工作线程，并且两个内核都能通过回环桥接调用代理自己的工具，如 `read`、`search`、`task`。代理可以在 Python 内部用 `tool.read` 读取 CSV，再用 JavaScript 画图，全程不离开同一个单元。

![omp 终端界面：单个 eval 会话中，`[1/2] pandas describe`（Python）打印真实的 DataFrame.describe() 表格，随后 `[2/2] top scorer`（JavaScript）运行 reduce。底部提示两个内核在同一会话中运行。](https://omp.sh/captures/eval.webp)

### 02 · 每次写入都接入 LSP

你要求重命名，就得到真正的重命名。调用会经过 `workspace/willRenameFiles`，因此重新导出、桶文件、别名导入都会在文件移动前更新。IDE 知道的一切，代理也知道。

![omp 终端界面：`LSP references` 返回 `formatBytes` 符号在三个文件中的五处引用，随后 `LSP rename` 对 format.ts/report.ts/cli.ts 应用编辑，再通过 `Search formatBytes 0 matches` 确认。最后一行显示重命名完成，三个文件共五处编辑。](https://omp.sh/captures/lsp.webp)

### 03 · 驱动真正的调试器

C 二进制崩溃时，代理会附加 `lldb`，单步到坏指针，读取栈帧。Go 服务卡住时，它可以附加 `dlv` 并查看 goroutine。Python 进程挂住时，也能用 `debugpy` 暂停、检查、求值。大多数代理还在到处加打印语句。

![omp 终端界面：针对 `/tmp/omp-native/demo` 中的原生二进制启动实时 lldb-dap 会话。适配器为 lldb-dap，状态为 stopped，当前帧为 xorshift32，指令指针为 0x10000055C，位置为 demo.c:6:10。调试作用域和变量卡片显示局部变量 x = 57351，代理确认数学过程：x 从 7 变为 57351。](https://omp.sh/clips/dap-poster.webp)

_[观看录屏](https://omp.sh/clips/dap.mp4)_

### 04 · 可回溯的流式规则

你的规则平时保持静默，直到模型跑偏。正则命中会在词元流中途中止请求，把规则作为系统提醒注入，然后从同一点重试。你能获得即时纠偏，又不用每轮都支付上下文成本。注入内容会穿过压缩继续保留，因此修正能持续生效。

![omp 终端界面：代理正在读取 src.rs 并即将写入 Box::leak，请求随后中止并显示红色错误；琥珀色规则注入卡片注入 box-leak 规则，提示不要在生产路径使用 Box::leak；随后代理改用 Arc<str> 并请求用户确认。](https://omp.sh/clips/ttsr-poster.webp)

_[观看录屏](https://omp.sh/clips/ttsr.mp4)_

### 05 · 一等公民级子代理

把任务拆给多个工作者，并拿回类型化结果。`task` 会把任务分发到隔离工作树，每个工作者都有自己的工具面，最终产出是父代理可直接读取的、经过结构校验的对象。不需要解析散文，不会让兄弟任务互相制造合并冲突，也不留下孤儿编辑。

![omp 终端界面：`task` 生成两个子代理 `ComponentsExports` 和 `RoutesExports`，约束块要求同伴之间通过 IRC 发送私信，每个子代理状态卡显示成本和耗时，最终发现项区列出两个导出项，并诚实说明 IRC 协调只完成了单向握手。](https://omp.sh/clips/irc-poster.webp)

_[观看录屏](https://omp.sh/clips/irc.mp4)_

### 06 · 第二个模型，观看每一轮

把审查模型绑定到 `advisor` 角色，它会阅读主代理的每一轮操作，并以内联方式注入提示：可以是轻量旁注、风险提醒，也可以是强阻断。它有自己的上下文和模型，因此能抓住执行者匆忙略过的问题。主代理会看到提示并纠偏，或说明为什么不采纳。

![omp 终端界面：`/advisor status` 显示顾问运行在 openai-codex/gpt-5.5；主代理把 catch 缩小到 ENOENT 而不是吞掉所有错误后，琥珀色的“Advisor 1 note (concern)”卡片提醒该修复不再匹配用户字面验收标准。](https://omp.sh/clips/advisor-poster.webp)

_[观看录屏](https://omp.sh/clips/advisor.mp4)_

### 07 · 把链接发出去，对方就能进来

`/collab` 会把你的实时会话挂到中继上，并返回链接和二维码。队友可以从另一个终端用 `omp join` 加入，也可以直接在浏览器打开。你可以共享读写权限来共同操作同一个代理，也可以用 `/collab view` 发只读链接，让任何人旁观但不能控制。帧在客户端密封，中继看不到你的密钥。

![omp 终端界面：`/collab view` 打印“Collab session started!”、`omp join` 命令、my.omp.sh 浏览器链接、提示任何持有链接的人都能观看但不能提示代理，并显示一个可扫描的大二维码。](https://omp.sh/clips/collab-poster.webp)

_[观看录屏](https://omp.sh/clips/collab.mp4)_

### 08 · 读取 arXiv PDF，当然可以

`web_search` 串联十八个排序提供方，并把找到的 URL 直接交给 `read`。arXiv PDF、GitHub 页面、Stack Overflow 讨论都会变成带锚点的结构化 Markdown。引用、跟随、摘录，都不会丢掉来源。

![omp 终端界面：`web_search` 针对推理时计算扩展返回 10 个 Perplexity 排序来源，代理选择一篇 arXiv 论文，调用 `read https://arxiv.org/pdf/2604.10739v1`，并用真实数字总结论文核心结果。](https://omp.sh/clips/web-poster.webp)

_[观看录屏](https://omp.sh/clips/web.mp4)_

### 09 · 原生到底，Windows 也一样

其他代理会 shell 到 `rg`、`grep`、`find`、`bash`。很多机器没有这些二进制；即使有，每次调用也要付出 fork/exec 往返成本。OMP 把真实实现链接进进程内：ripgrep、glob、find 都在进程内运行。`brush` 就是 bash，并且会话可以跨调用存活。同一个 OMP 二进制可运行在 macOS、Linux 和 Windows 上，不需要 WSL 桥。

### 10 · 带优先级和结论的代码审查

你会得到清晰结论：这个变更能不能发。每个问题都会按 P0 到 P3 排序，并给出置信度。`/review` 会生成专用审查子代理，并行扫描分支、单个提交或未提交工作。你先处理阻塞发布的问题，重要内容不会埋在长篇散文里。

### 11 · Hashline：按内容哈希编辑

编辑更准，词元更少。模型指向锚点，而不是重打一遍要修改的行，因此空白差异和字符串找不到的循环会消失。编辑过期文件时，锚点会分叉，补丁会在破坏内容前被拒绝。Grok 4 Fast 在同一任务上少花 61% 输出词元。

### 12 · GitHub 就是另一个文件系统

其他代理框架会额外拼上 `gh_issue_view`、`gh_pr_view`、`gh_search`，每个都有模型要学习、用户要调试的参数。OMP 没走这条路。`read` 已经能处理路径，PR 也是路径。一个接口教给模型，一个表面保持正确。

### 13 · Hindsight：由代理维护的记忆

代理会在会话之间记住你的代码库。它可以在运行中用 `retain` 写入事实，用 `recall` 取回记忆，并把每个会话压缩成下一轮第一回合就能加载的心智模型。默认按项目隔离，因此它从这个仓库学到的内容仍留在这个仓库。

### 14 · ACP：可由编辑器驱动的代理

在 Zed 里运行 OMP，你得到的是同一个终端代理：它读取你正在看的缓冲区，通过编辑器保存路径写入，在编辑器终端里生成 shell。破坏性工具会暂停并弹出权限提示，你可以允许一次然后忘掉它。没有桥接心智负担，没有插件和另一套状态要同步。

### 15 · 继承其他工具已经写好的配置

其他代理通常会提供导入器，然后要求你转换配置。OMP 直接读取磁盘上已有的八种原生格式：Cursor MDC、Cline `.clinerules`、Codex `AGENTS.md`、Copilot `applyTo` 等等。不需要迁移脚本，不需要 YAML 转 TOML，也没有“只支持子集”的脚注。团队上个季度写好的配置，今晚仍然能用。

### 16 · `omp commit`：原子拆分和校验过的提交信息

`omp` 通过 `git_overview`、`git_file_diff`、`git_hunk` 读取工作树，然后把无关变更拆成按依赖排序的原子提交。循环依赖会在写入前被拒绝。源文件优先级高于测试、文档和配置，因此标题提交就是最重要的那个。锁文件会完全排除在分析之外。

### 17 · 读 PR，遍历技能，从子代理拉 JSON

十二种内部路径协议（`pr://`、`issue://`、`agent://`、`skill://`、`rule://` 等）会在每个文件系统形状的工具中透明解析。`read pr://1428` 返回的形状和 `read src/foo.ts` 一样。`search` 可以像遍历目录一样遍历差异。`agent://<id>/findings.0.path` 能按路径从子代理输出里取字段。

![omp 终端界面：读取 `pr://can1357/oh-my-pi/1063` 及其 `/diff/1`，展示差异块头、添加行，以及 `[MODIFIED] (+12 -0)` 摘要。](https://omp.sh/captures/pr.webp)

### 18 · 轻松解决冲突

每个合并冲突都会变成一个 URL。代理向 `conflict://N` 写入 `@theirs`、`@ours` 或 `@base`，文件就能干净解析。批量形式是 `conflict://*`。

![omp 终端界面：读取 src/session.ts 并发现 1 个冲突，随后向 conflict://1 写入 1 行 `@theirs`，最后确认已解决。](https://omp.sh/clips/conflict-poster.webp)

_[观看录屏](https://omp.sh/clips/conflict.mp4)_

### 19 · 先预览，再接受

`ast_edit` 会返回一张“待应用”卡片，显示替换数量。变更先暂存。代理调用 `resolve` 并给出理由后，终端界面会把它变成 **接受** 卡片，磁盘变更才真正发生；整个过程原子化，要么全成，要么全不动。

![omp 终端界面：AST Edit 针对 `console.log($X)` 提出 3 处替换、1 个文件；随后接受卡片应用 1 个文件中的 3 处替换，并显示已应用到 src/auth.ts。](https://omp.sh/clips/codemod-poster.webp)

_[观看录屏](https://omp.sh/clips/codemod.mp4)_

### 20 · 驱动真正的浏览器，甚至你的 Slack

默认启用伪装，因此页面看到的是正常用户，而不是无头机器人。同一套 API 也能就地驱动任何 Electron 应用：指向 Slack，代理就能像读网页一样读你的私信。

![omp 终端界面：使用 browser 工具驱动 DuckDuckGo。](https://omp.sh/captures/browser.webp)

## 任务需要什么，工具箱里已经有了

32 个工具和 `read`、`bash` 位于同一个命名空间。可以用 `--tools read,edit,bash,...` 固定活动工具集；其余工具保持隐藏但仍会被索引。当 `tools.discoveryMode` 允许时，`search_tool_bm25` 会在会话中途把它们找回来并激活。

**文件与搜索**

- `read`：用一个路径读取文件、目录、压缩包、SQLite、PDF、notebook、URL 和内部 `://` scheme。
- `write`：创建或覆盖文件、压缩包条目或 SQLite 行。
- `edit`：带内容哈希锚点和过期锚点恢复的 hashline 补丁。
- `ast_edit`：通过 ast-grep 进行结构化重写，应用前先预览。
- `ast_grep`：基于 50+ tree-sitter 语法的结构化代码查询。
- `search`：在文件、glob 和内部 URL 上执行正则搜索。
- `find`：基于 glob 的路径查找；需要内容匹配时用 `search`。

**运行时**

- `bash`：工作区 shell，支持可选 PTY 或后台任务派发。
- `eval`：持久化 Python 和 JavaScript 单元，带共享预加载和工具重入。
- `ssh`：对已配置主机执行一次远程命令。

**代码智能**

- `lsp`：诊断、导航、符号、重命名、代码动作、原始请求。
- `debug`：驱动 DAP 会话，包括断点、单步、线程、调用栈、变量。

**协作**

- `task`：并行分发子代理，可选择工作区隔离。
- `irc`：当前进程内多个实时代理之间的短消息。
- `todo`：对会话待办列表进行有序变更，并跟踪阶段。
- `job`：等待或取消后台任务。
- `ask`：交互运行中的结构化追问。

**外部世界**

- `browser`：通过无头 Chromium 或 CDP 附加应用驱动 Puppeteer 标签页。
- `web_search`：跨已配置提供方查询，返回答案和引用。
- `github`：GitHub CLI 操作，包括仓库、PR、议题、代码搜索、工作流运行监控。
- `generate_image`：通过 Gemini、GPT 或 xAI Grok 图像模型生成或编辑位图。
- `inspect_image`：使用视觉模型分析本地图像文件。
- `tts`：通过 xAI Grok Voice 做文本转语音，内置五种声音，支持 WAV 或 MP3。

**记忆与状态**

- `checkpoint`：标记会话状态，稍后折叠并报告。
- `rewind`：修剪探索性上下文，保留简明报告。
- `retain`：把持久事实排入当前 Hindsight 记忆库。
- `recall`：搜索 Hindsight 记忆库中的原始记忆。
- `reflect`：让 Hindsight 基于记忆库综合回答。

**其他**

- `resolve`：应用或丢弃排队中的预览动作。
- `search_tool_bm25`：在隐藏工具索引上执行 BM25 搜索，并在会话中途激活最匹配的工具。

默认关闭、受设置控制的工具：`github`、`inspect_image`、`tts`、`checkpoint`、`rewind`、`search_tool_bm25`、`retain`、`recall`、`reflect`。按项目作用域打开一次即可。

[完整工具参考](https://omp.sh/docs/tools)

## 四十多个提供方，数百个模型，一个 `/model` 就能切换

角色按意图路由工作。`default` 处理普通回合，`smol` 处理便宜的子代理分发，`slow` 处理深度推理，`plan` 处理计划模式，`commit` 处理更新日志。启动时可用 `--smol`、`--slow` 或 `--plan` 覆盖；也可以用 `Ctrl+P` 在当前角色配置的模型间循环。会话中途可用 `/model` 斜杠命令切换活动模型。

下面的认证标签含义：`oauth` 表示使用提供方账号登录，`plan` 表示通过编码计划订阅路由，`local` 表示走本地服务器且密钥可选。

### 前沿 API

直接 API 和网关。不同角色可以混用不同提供方。

Anthropic `oauth` · OpenAI · OpenAI Codex `oauth` · Google Gemini · Google Antigravity `oauth` · xAI · Mistral · Groq · Cerebras · Fireworks · Together · Hugging Face · NVIDIA · OpenRouter · Synthetic · Vercel AI Gateway · Cloudflare AI Gateway · Wafer Serverless · Perplexity `oauth`

### 编码计划

通过订阅路由。`/login` 会把订阅绑定到当前会话。

Cursor `oauth` · GitHub Copilot `oauth` · GitLab Duo · Kimi Code `plan` · Moonshot · MiniMax Coding Plan `plan` · MiniMax Coding Plan CN `plan` · Alibaba Coding Plan `plan` · Qwen Portal · Z.AI / GLM Coding Plan `plan` · Xiaomi MiMo · Qianfan · NanoGPT · Venice · Kilo · ZenMux · OpenCode Go · OpenCode Zen

### 自己运行

兼容 OpenAI 的 `/v1/models`。本地实例可以不提供密钥。

Ollama `local` · Ollama Cloud · LM Studio `local` · llama.cpp `local` · vLLM `local` · LiteLLM

### 让路由真正有用的四个旋钮

- **自定义提供方**：在 `~/.omp/agent/models.yml` 中声明任何支持 `openai-completions`、`openai-responses`、`openai-codex-responses`、`azure-openai-responses`、`anthropic-messages`、`google-generative-ai` 或 `google-vertex` 的服务。
- **降级链**：在 `retry.fallbackChains` 下为每个角色配置链路。主模型遇到 429 或配额墙时，下一个模型接手本回合剩余部分，并在冷却后恢复。
- **按路径限定模型**：把 `enabledModels` 和 `disabledProviders` 条目限定到 `path:` 前缀，从而只在某个仓库固定不同模型集，不影响全局配置。作用域覆盖该路径及其下方所有内容。
- **凭据轮转**：同一提供方可堆叠多个 API key，运行时会按会话亲和和每个凭据的退避策略轮转。适合单个 key 中午前就会耗尽配额的场景。

完整提供方与路由参考见 [omp.sh/docs/providers](https://omp.sh/docs/providers)。

## 十八个后端，一个代理已经熟悉的工具

`web_search` 是内置能力，不是外挂。`auto` 会按顺序遍历十八个提供方；如果你已经为某个提供方付费，也可以直接指定。每个结果背后都有站点感知抽取，把 GitHub、包注册表、arXiv、Stack Overflow 和文档转成结构化 Markdown，锚点和链接目标都会保留。

### 搜索提供方

十八个后端。你可以固定一个，也可以让 `auto` 按顺序遍历。

| 提供方       | 认证方式                 |
| ------------ | ------------------------ |
| `auto`       | 链式调用                 |
| `perplexity` | `PERPLEXITY_API_KEY`     |
| `gemini`     | oauth                    |
| `anthropic`  | oauth                    |
| `codex`      | oauth                    |
| `xai`        | `XAI_API_KEY`            |
| `zai`        | `ZAI_API_KEY`            |
| `exa`        | `EXA_API_KEY` 或 MCP     |
| `tinyfish`   | `TINYFISH_API_KEY`       |
| `jina`       | `JINA_API_KEY`           |
| `kagi`       | `KAGI_API_KEY`           |
| `tavily`     | `TAVILY_API_KEY`         |
| `firecrawl`  | `FIRECRAWL_API_KEY`      |
| `brave`      | `BRAVE_API_KEY`          |
| `kimi`       | `MOONSHOT_API_KEY`       |
| `parallel`   | `PARALLEL_API_KEY`       |
| `synthetic`  | `SYNTHETIC_API_KEY`      |
| `searxng`    | 自托管                   |
| `duckduckgo` | 无需密钥                 |

### 专用处理器

代理拿到的是结构化内容，而不是被剥离后的 HTML。

- **代码托管**：GitHub、GitLab
- **包注册表**：npm、PyPI、crates.io、Hex、Hackage、NuGet、Maven、RubyGems、Packagist、pub.dev、Go packages
- **研究来源**：arXiv、Semantic Scholar
- **论坛**：Stack Overflow、Reddit、Hacker News
- **文档**：MDN、Read the Docs、docs.rs

页面会转成保留链接结构的 Markdown。代理可以引用、跟随和摘录，而不会丢失锚点。

### 安全数据库

漏洞查询返回供应商数据，而不是博客摘要。

- **NVD**：国家漏洞数据库
- **OSV**：开源漏洞信息源
- **CISA KEV**：已知被利用漏洞目录

[`web_search` 参考](https://omp.sh/docs/tools#web_search)

## 大约 **55,000** 行 Rust，负责其他代理框架需要调用外部 shell 才能做的工作

四个 Rust 包，一个带平台标签的 N-API 原生扩展。搜索、shell、AST、高亮、PTY、图像解码、BPE 计数都在进程内的 libuv 线程池执行。热路径上没有 fork/exec。

- Rust 包：`pi-natives`、`pi-shell`、`pi-ast`、`pi-iso`
- 平台：`linux-x64`、`linux-arm64`、`darwin-x64`、`darwin-arm64`、`win32-x64`

下表是按模块统计的拆分，刻意省略了胶水代码和测试。

| 模块       | 作用                                                               | 依赖/实现                                  | 约行数 |
| ---------- | ------------------------------------------------------------------ | ------------------------------------------ | -----: |
| shell      | 嵌入式 bash、持久会话、超时/中止、自定义内建命令                   | brush-shell（随仓库内置）                  |  3700 |
| grep       | 正则搜索、并行/顺序执行、glob 与类型过滤、模糊查找                 | grep-regex、grep-searcher                  |  1900 |
| keys       | Kitty 键盘协议，带 xterm 回退和 PHF 完美哈希查找                   | phf                                        |  1490 |
| text       | ANSI 感知宽度、截断、列切片、保留 SGR 的换行                       | unicode-width、segmentation                |  1450 |
| summary    | 基于 tree-sitter 的源码结构摘要和省略控制                          | tree-sitter、ast-grep-core                 |  1040 |
| ast        | ast-grep 模式匹配和结构化重写                                      | ast-grep-core                              |  1000 |
| fs_cache   | 基于 mtime 的文件缓存，供 read、grep、lsp 共享                     | 仓库内实现                                 |   840 |
| highlight  | 语法高亮、11 个语义分类、30+ 别名                                  | syntect                                    |   470 |
| pty        | 为 sudo、ssh 交互提示分配原生 PTY                                  | portable-pty                               |   455 |
| glob       | 带 glob、类型过滤、mtime 排序、尊重 gitignore 的发现               | ignore、globset                            |   410 |
| workspace  | 一次遍历完成工作区 walker 和 AGENTS.md 发现                        | ignore                                     |   385 |
| appearance | 模式 2031，以及通过 CoreFoundation FFI 获取 macOS 深/浅色模式      | core-foundation                            |   270 |
| power      | macOS 电源断言 API，防止空闲、系统或显示器睡眠                     | IOKit FFI                                  |   270 |
| task       | 在线程池执行阻塞工作、取消、超时、分析                             | tokio、napi                                |   260 |
| fd         | 替代 find 工具的文件系统 walker                                    | ignore                                     |   250 |
| iso        | 工作区隔离 shim，支持 apfs、btrfs、zfs、reflink、overlayfs 等      | pi-iso（PAL）                              |   245 |
| prof       | 环形缓冲区 profiler，输出 folded stack 和 SVG 火焰图               | inferno                                    |   240 |
| ps         | 跨平台进程树 kill 和后代进程列举                                   | libc、libproc、CreateToolhelp32Snapshot    |   195 |
| clipboard  | 从系统剪贴板复制文本和读取图片，不依赖 xclip/pbcopy                | arboard                                    |    80 |
| 词元       | O200k / Cl100k BPE 词元计数，两张表内嵌                            | tiktoken-rs                                |    65 |
| sixel      | 终端图片渲染，解码 PNG/JPEG/WebP/GIF，resize 后编码 SIXEL          | icy_sixel、image                           |    55 |
| html       | HTML 转 Markdown，可选内容清理                                     | html-to-markdown-rs                        |    50 |

## 四种入口：交互式、一次性、RPC 和 ACP

同一个引擎，四层包装。`omp` 运行终端界面。`omp -p` 回答单个提示后退出。Node SDK 可以把会话嵌进你的进程。`omp --mode rpc` 和 `omp acp` 通过 stdio 把方向盘交给另一个程序。

### 交互式：不确定时，代理会问

终端界面是默认入口。工具调用会渲染成卡片，编辑会先预览再落地，模糊需求会通过 `ask` 工具变成结构化选项选择器，让代理能在回合中途发起追问。键盘负责其余操作。

同样的提示卡片也会通过 ACP 呈现，因此编辑器可以获得选择器，而不需要自己实现一套。

![omp 终端界面：ask 工具渲染出一个包含三个选项的选择器，第一个选项带“推荐”标记，底部显示上下导航、回车选择、Esc 取消。](https://omp.sh/captures/ask.webp)

### SDK：嵌入 Node

`@oh-my-pi/pi-coding-agent`

Node 和 TypeScript 宿主可以直接引入引擎。这个包暴露 `ModelRegistry`、`SessionManager`、`createAgentSession` 和 `discoverAuthStorage`；会话会发出可订阅的类型化事件。

```ts
import {
  ModelRegistry,
  SessionManager,
  createAgentSession,
  discoverAuthStorage,
} from "@oh-my-pi/pi-coding-agent";

const auth = await discoverAuthStorage();
const models = new ModelRegistry(auth);
await models.refresh();

const { session } = await createAgentSession({
  sessionManager: SessionManager.inMemory(),
  authStorage: auth,
  modelRegistry: models,
});
await session.prompt("列出 .ts 文件");
```

### RPC：通过 stdio 驱动

`omp --mode rpc`

适合非 Node 嵌入方，或需要进程隔离的场景。NDJSON 命令输入，响应和事件帧输出。`--mode rpc-ui` 会把工具卡片、选择器和对话框作为 `extension_ui_request` 帧发给宿主，由宿主负责响应。

```text
$ omp --mode rpc --no-session
> {"id":"r1","type":"prompt","message":"列出 .ts 文件"}
< {"id":"r1","type":"response", ...}
> {"id":"r2","type":"set_model","provider":"anthropic","modelId":"sonnet-4.5"}
> {"id":"r3","type":"abort"}
```

### ACP：面向编辑器

`omp acp`

通过 JSON-RPC 实现 [Agent Client Protocol](https://github.com/zed-industries/agent-client-protocol)。当编辑器声明能力时，工具输入输出会通过编辑器路由，写入则由 `session/request_permission` 门控。

| OMP 工具     | ACP 路由                            |
| ------------ | ----------------------------------- |
| `bash`       | `terminal/create + terminal/output` |
| `read`       | `fs/read_text_file`                 |
| `write`      | `fs/write_text_file`                |
| `edit, bash` | `session/request_permission`        |

完整参考：[omp.sh/docs/sdk](https://omp.sh/docs/sdk)。

## 值得长期使用的代理框架，是不会被你用到嫌弃的代理框架

从 **[omp.sh](https://omp.sh)** 开始。

OMP 是 [Mario Zechner](https://github.com/mariozechner) 的 [Pi](https://github.com/badlogic/pi-mono) 派生版，重写成面向编码的一等界面：会话、子代理、斜杠命令、扩展，全 TypeScript，全 MIT，代码都在 [GitHub](https://github.com/can1357/oh-my-pi) 上。你可以通过配置塑形，接入外部钩子，或者在需要时直接读源码。

### 原语

扩展就是一个 TypeScript 模块。它使用同一套工具 API、同一套斜杠命令注册表、同一张热键表，以及内置功能使用的同一组终端界面原语。没有保留区。

### 发现

首次运行时，OMP 会继承磁盘上已有的内容：来自 `.claude`、`.cursor`、`.windsurf`、`.gemini`、`.codex`、`.cline`、`.github/copilot` 和 `.vscode` 的规则、技能和 MCP 服务器。不需要迁移脚本。

### 可扩展性

让 OMP 写出你缺的那块能力，然后运行 `/reload-plugins`。你可以只保留在本机，也可以放进 `marketplace`，或者发布到 npm。

## 设计理念

OMP 是 [Mario Zechner](https://github.com/mariozechner) 的 [pi-mono](https://github.com/badlogic/pi-mono) 派生版，并扩展为一个内置电池的编码工作流。

核心想法：

- 保留适合真实编码工作的、终端优先的交互体验。
- 内置实用能力，包括工具、会话、分支、子代理和扩展机制。
- 让高级行为可配置，而不是隐藏起来。

---

## 开发

### 从源码开始

新克隆的仓库需要先安装工作区依赖，并构建本地 Rust/N-API 原生扩展，然后源码 CLI 才能启动。

```sh
bun setup
bun dev
```

`bun setup` 会安装 Bun 工作区依赖，并构建 `@oh-my-pi/pi-natives`。修改 Rust 包或 `packages/natives` 后，请重新运行 `bun run build:native`。

非交互式冒烟检查：

```sh
bun dev -- --version
```

### 调试命令

`/debug` 会打开用于调试、报告和性能分析的工具。

架构和贡献指南见 [packages/coding-agent/DEVELOPMENT.md](packages/coding-agent/DEVELOPMENT.md)。

---

## 单体仓库包

| 包                                                        | 说明                                                         |
| --------------------------------------------------------- | ------------------------------------------------------------ |
| **[@oh-my-pi/collab-web](packages/collab-web)**           | 浏览器访客端、模拟宿主和协作实时会话的本地中继               |
| **[@oh-my-pi/pi-ai](packages/ai)**                        | 多提供方 LLM 客户端，支持流式输出和模型/提供方集成           |
| **[@oh-my-pi/pi-catalog](packages/catalog)**              | 模型目录，包括内置模型数据库、提供方描述符和身份识别         |
| **[@oh-my-pi/pi-agent-core](packages/agent)**             | 支持工具调用和状态管理的代理运行时                           |
| **[@oh-my-pi/pi-coding-agent](packages/coding-agent)**    | 交互式编码代理 CLI 和 SDK                                    |
| **[@oh-my-pi/pi-tui](packages/tui)**                      | 带差量渲染的终端界面库                                       |
| **[@oh-my-pi/pi-natives](packages/natives)**              | grep、shell、图像、文本、语法高亮等能力的 N-API 绑定         |
| **[@oh-my-pi/omp-stats](packages/stats)**                 | AI 使用统计的本地可观测性面板                                |
| **[@oh-my-pi/pi-utils](packages/utils)**                  | 共享工具，包括日志、流、目录/环境/进程辅助函数               |
| **[@oh-my-pi/pi-wire](packages/wire)**                    | 协作实时会话协议类型和中继常量                               |
| **[@oh-my-pi/hashline](packages/hashline)**               | `edit` 工具背后的行锚定补丁语言和应用器                      |
| **[@oh-my-pi/pi-mnemopi](packages/mnemopi)**              | 面向 Oh My Pi 代理的本地 SQLite 记忆引擎                     |
| **[@oh-my-pi/snapcompact](packages/snapcompact)**         | 位图帧上下文压缩包和 SQuAD 评测套件                          |
| **[@oh-my-pi/swarm-extension](packages/swarm-extension)** | Swarm 编排扩展包                                             |

### Rust 包

| Rust 包                                            | 说明                                                                              |
| -------------------------------------------------- | --------------------------------------------------------------------------------- |
| **[pi-natives](crates/pi-natives)**                | 核心 Rust 原生扩展（N-API `cdylib`），供 `@oh-my-pi/pi-natives` 使用并聚合下列 Rust 包 |
| **[pi-shell](crates/pi-shell)**                    | 从 `pi-natives` 拆出的嵌入式 shell、PTY、进程管理，包装 `brush-*`                 |
| **[pi-ast](crates/pi-ast)**                        | 基于 tree-sitter 的代码摘要器和 AST 工具，支持 50+ 语言语法                       |
| **[pi-iso](crates/pi-iso)**                        | 任务隔离后端解析器：APFS 克隆、btrfs/zfs reflink、overlayfs、projfs、rcopy        |
| **[brush-core](crates/vendor/brush-core)**         | 内嵌 bash 执行所用的 [brush-shell](https://github.com/reubeno/brush) 随仓库内置派生 |
| **[brush-builtins](crates/vendor/brush-builtins)** | 随仓库内置的 bash 内建命令，包括 cd、echo、test、printf、read、export 等          |

## 贡献

议题对所有人开放。**拉取请求需要担保**：来自未担保或被否定作者的 PR 会自动关闭。如果你还没有被担保，请先打开 [讨论区](https://github.com/can1357/oh-my-pi/discussions)，请求维护者对你执行 `!vouch`，而不是直接开 PR（那样会被直接关闭）。完整政策见 **[CONTRIBUTING.md](CONTRIBUTING.md)** 和 [`.github/VOUCHED.td`](.github/VOUCHED.td)。

---

## 许可证

MIT。见 [LICENSE](LICENSE)。

© 2025 Mario Zechner  
© 2025-2026 Can Bölük

_献给那些一直开着的终端_

- [omp.sh](https://omp.sh)
- [GitHub](https://github.com/can1357/oh-my-pi)
- [更新日志](https://github.com/can1357/oh-my-pi/blob/main/packages/coding-agent/CHANGELOG.md)
- [npm](https://www.npmjs.com/package/@oh-my-pi/pi-coding-agent)
- [Discord](https://discord.gg/4NMW9cdXZa)
- [MIT](https://github.com/can1357/oh-my-pi/blob/main/LICENSE)
