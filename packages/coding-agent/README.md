# @oh-my-pi/pi-coding-agent

Core implementation package for the `omp` coding agent in the `oh-my-pi` monorepo.

For installation, setup, provider configuration, model roles, slash commands, and full CLI reference, see:
- [Monorepo README (local)](../../README.md)
- [Monorepo README (GitHub)](https://github.com/can1357/oh-my-pi#readme)

Package-specific references:
- [CHANGELOG](./CHANGELOG.md)
- [MCP configuration guide](../../docs/mcp-config.md)
- [MCP runtime lifecycle](../../docs/mcp-runtime-lifecycle.md)
- [MCP server/tool authoring](../../docs/mcp-server-tool-authoring.md)
- [DEVELOPMENT](./DEVELOPMENT.md)

## Autonomous Plan Run

Use `/plan-run <request>` when OMP should turn a high-level request into an autonomous implementation run.

The main session owns planning, packet gating, final acceptance review, and verification. Code-writing tasks should be delegated to subagents from the generated Task Execution Cards, with the main session accepting or rejecting their evidence. Final readiness requires the Plan Execution Book, todo snapshot, task review records, TDD evidence matrix, Superpowers skill evidence, advisor summary, packet/workspace-state gate, and completion packet to agree.

Recommended model-role shape:

```json
{
  "modelRoles": {
    "plan": "openai/gpt-5.5",
    "acceptance": "openai/gpt-5.5",
    "task": "deepseek/deepseek-coder",
    "advisor": "openai/gpt-5.5"
  },
  "advisor.enabled": true,
  "advisor.subagents": true
}
```

This preserves the 16.1.7 target behavior at the workflow layer: GPT-class models plan and accept, DeepSeek-class subagents implement, and an advisor reviews both the main session and subagents. The dedicated 16.1.7 `task.codeWrites=subagent-only` runtime switch is not present in this package yet; until that switch is migrated, enforce subagent-only code writing through Task Execution Card policy and acceptance gates.

## Memory backends

The agent supports three mutually-exclusive memory backends, selected via the `memory.backend` setting (Settings → Memory tab, or `~/.omp/config.yml`):

- `off` (default) — no memory subsystem runs.
- `local` — existing rollout-summarisation pipeline; writes `memory_summary.md` and consolidated artifacts under the agent dir.
- `hindsight` — talks to a [Hindsight](https://hindsight.vectorize.io) server (Cloud or self-hosted Docker), retains transcripts every Nth user turn, recalls memories on the first turn of a session, and exposes `retain`, `recall`, and `reflect`.

### Hindsight quickstart

1. Run a Hindsight server (Cloud or `docker run -p 8888:8888 ghcr.io/vectorize-io/hindsight:latest`).
2. Set `memory.backend = "hindsight"` and `hindsight.apiUrl = "http://localhost:8888"` (or your Cloud URL).
3. Optional environment overrides (env wins over settings):
   - `HINDSIGHT_API_URL`, `HINDSIGHT_API_TOKEN` — connection
   - `HINDSIGHT_BANK_ID`, `HINDSIGHT_DYNAMIC_BANK_ID`, `HINDSIGHT_AGENT_NAME` — bank addressing
   - `HINDSIGHT_AUTO_RECALL`, `HINDSIGHT_AUTO_RETAIN`, `HINDSIGHT_RETAIN_MODE` — lifecycle
   - `HINDSIGHT_RECALL_BUDGET`, `HINDSIGHT_RECALL_MAX_TOKENS` — recall sizing
   - `HINDSIGHT_BANK_MISSION`, `HINDSIGHT_DEBUG`

Switching backends mid-session is honoured on the next system-prompt rebuild and the next `/memory` slash command. Existing users with `memories.enabled = true|false` are migrated to `memory.backend = "local"|"off"` exactly once on first launch.
