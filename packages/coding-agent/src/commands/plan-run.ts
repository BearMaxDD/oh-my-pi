/**
 * CLI command for running a PlanRun from an execution book JSON file.
 *
 * Parses CLI flags and delegates to `runPlanRunEntry`, which reads the
 * execution book from disk and calls `launchPlanRunDriver` with real settings
 * and dependency-injected wiring.
 *
 * Production deps (spawnTask, spawnStage) are wired via `createPlanRunDeps`,
 * which builds `createPlanRunProductionSpawnAdapter` over a real subagent bridge
 * (`createCommandSubagentRunner` with a default `createSingleSubagentBridge`).
 * Callers can pass a custom bridge for testing or alternative runtimes.
 */
import { Command, Flags } from "@oh-my-pi/pi-utils/cli";
import type { PlanRunDriverDeps, SpawnTaskOutput } from "../codex-plan-run/driver";
import { runMainThreadAcceptanceReview } from "../codex-plan-run/main-acceptance-review";
import { runPlanRunEntry } from "../codex-plan-run/plan-run-entry";
import type { PlanRunSubagentRunner, PlanRunTaskSpawnParams } from "../codex-plan-run/plan-run-spawn-adapter";
import { createPlanRunProductionSpawnAdapter } from "../codex-plan-run/plan-run-spawn-adapter";
import type { StrictRoleExecutionPlan } from "../codex-plan-run/role-bound-stage-scheduler";
import { createPlanRunRepairDecision } from "../codex-plan-run/repair-loop";
import { reviewTaskExecution } from "../codex-plan-run/task-review";
import { Settings, settings } from "../config/settings";
import {
	createCommandSingleSubagentRuntime,
	createSingleSubagentBridge,
	type SingleSubagentRuntime,
	type SubagentBridge,
	type SubagentBridgeParams,
	type SubagentBridgeResult,
} from "../task/single-subagent-runner";

/**
 * Trusted bridge for strict PlanRun stages. The caller must route this into
 * TaskTool.executeRoleBound with the supplied immutable execution plan.
 */
export type StrictRoleBoundSubagentBridge = (
	params: PlanRunTaskSpawnParams,
	context: { readonly strictRoleExecutionPlan: StrictRoleExecutionPlan },
) => Promise<SubagentBridgeResult>;

/**
 * Create a subagent runner that either:
 * - Calls a real bridge function (when provided) to execute the subagent task
 *   via a session runtime, mapping the result to SpawnTaskOutput.
 * - Returns a structured "blocked" fallback (when no bridge is provided) with
 *   metadata about the parameters for debugging and diagnostic purposes.
 *
 * The bridge is an optional typed injection point for a real subprocess/session
 * runtime. Without a bridge, the runner serves as a diagnostic placeholder that
 * records the cwd, acceptingDir, agent id, and model role in the output.
 */
export function createCommandSubagentRunner(options: {
	cwd: string;
	acceptingDir: string;
	/** Optional bridge function that replaces the structured-blocked fallback with a real subagent run. */
	bridge?: SubagentBridge;
	/** Trusted strict bridge that must invoke TaskTool.executeRoleBound. */
	strictRoleBoundBridge?: StrictRoleBoundSubagentBridge;
}): PlanRunSubagentRunner {
	const toBridgeParams = (params: PlanRunTaskSpawnParams): SubagentBridgeParams => ({
		id: params.id,
		role: params.role,
		modelRole: params.modelRole,
		context: params.context,
		assignment: params.assignment,
		description: params.description,
		required_skill_evidence: params.required_skill_evidence,
	});
	const mapBridgeResult = (params: PlanRunTaskSpawnParams, bridgeResult: SubagentBridgeResult): SpawnTaskOutput => {
		if (bridgeResult.exitCode === 0) {
			return {
				task_id: params.id,
				changed_files: bridgeResult.changed_files ?? [],
				tests_run: bridgeResult.tests_run ?? [],
				evidence: bridgeResult.evidence ?? (bridgeResult.outputPath ? [bridgeResult.outputPath] : []),
				execution_skills_used: bridgeResult.execution_skills_used ?? [],
				final_tail_skills_used: bridgeResult.final_tail_skills_used ?? [],
				scope_notes: [options.cwd, options.acceptingDir],
				result: "completed",
				agentId: bridgeResult.id ?? params.id,
				modelRole: bridgeResult.modelRole ?? params.modelRole,
				resolvedModel: bridgeResult.resolvedModel,
				modelOverrides: bridgeResult.modelOverrides,
				advisorFindings: bridgeResult.advisorFindings,
			};
		}

		return {
			task_id: params.id,
			changed_files: [],
			tests_run: [],
			evidence: [],
			execution_skills_used: [],
			final_tail_skills_used: [],
			scope_notes: [options.cwd, options.acceptingDir, bridgeResult.stderr ?? `exit code ${bridgeResult.exitCode}`],
			result: "blocked",
			agentId: bridgeResult.id ?? params.id,
			modelRole: bridgeResult.modelRole ?? params.modelRole,
			advisorFindings: [
				{
					schema_version: 1,
					run_id: "",
					task_id: params.id,
					severity: "blocker",
					category: "evidence",
					finding: "Subagent bridge 返回非零退出码",
					evidence: bridgeResult.stderr ?? `exit code ${bridgeResult.exitCode}`,
					required_action: "检查子代理运行时错误",
				},
			],
		};
	};
	const blockedWithoutBridge = (params: PlanRunTaskSpawnParams): SpawnTaskOutput => ({
		task_id: params.id,
		changed_files: [],
		tests_run: [],
		evidence: [],
		execution_skills_used: [],
		final_tail_skills_used: [],
		scope_notes: [options.cwd, options.acceptingDir],
		result: "blocked",
		agentId: params.id,
		modelRole: params.modelRole,
		advisorFindings: [
			{
				schema_version: 1,
				run_id: "",
				task_id: params.id,
				severity: "blocker",
				category: "evidence",
				finding: "Subagent runner 未接入",
				evidence: "subagent runner 未接入，未提供 bridge 配置",
				required_action: "提供 bridge 配置",
			},
		],
	});

	return {
		run: async (params: PlanRunTaskSpawnParams): Promise<SpawnTaskOutput> =>
			options.bridge ? mapBridgeResult(params, await options.bridge(toBridgeParams(params))) : blockedWithoutBridge(params),
		runRoleBound: async (
			params: PlanRunTaskSpawnParams,
			context: { strictRoleExecutionPlan: StrictRoleExecutionPlan },
		): Promise<SpawnTaskOutput> => {
			if (!options.strictRoleBoundBridge) {
				return {
					...blockedWithoutBridge(params),
					advisorFindings: [
						{
							schema_version: 1,
							run_id: "",
							task_id: params.id,
							severity: "blocker",
							category: "evidence",
							finding: "严格 PlanRun 阶段未接入 role-bound bridge",
							evidence: "strict role-bound bridge is not configured",
							required_action: "注入调用 TaskTool.executeRoleBound 的 strictRoleBoundBridge",
						},
					],
				};
			}
			return mapBridgeResult(params, await options.strictRoleBoundBridge(params, context));
		},
	};
}

/**
 * Build the full PlanRunDriverDeps from production implementations.
 *
 * Constructs a `createCommandSubagentRunner` wired through
 * `createPlanRunProductionSpawnAdapter` to get spawnTask and spawnStage.
 * The subagent runner defaults to a real `createSingleSubagentBridge`
 * but accepts an optional custom bridge for testing or alternative runtimes.
 */
export async function createPlanRunDeps(options: {
	cwd: string;
	acceptingDir: string;
	/** Optional bridge function; takes priority over runSubagent/runtimeCommand. */
	bridge?: SubagentBridge;
	/** Optional strict bridge that must dispatch to TaskTool.executeRoleBound. */
	strictRoleBoundBridge?: StrictRoleBoundSubagentBridge;
	/** Optional runtime function injected into the default bridge. */
	runSubagent?: SingleSubagentRuntime;
	/** Optional command for creating a command-based runtime (env: OMP_PLAN_RUN_SUBAGENT_RUNTIME_COMMAND). */
	runtimeCommand?: string;
	/** Optional args for the command-based runtime (env: OMP_PLAN_RUN_SUBAGENT_RUNTIME_ARGS_JSON). */
	runtimeArgs?: string[];
	/** Optional timeout in milliseconds for the command-based runtime. */
	runtimeTimeoutMs?: number;
}): Promise<PlanRunDriverDeps> {
	// When no explicit bridge is provided, build a default bridge from
	// the injected runSubagent or a command-based runtime.
	let bridge = options.bridge;
	if (!bridge) {
		const runtime =
			options.runSubagent ??
			(options.runtimeCommand
				? createCommandSingleSubagentRuntime({
						command: options.runtimeCommand,
						args: options.runtimeArgs,
						timeoutMs: options.runtimeTimeoutMs,
					})
				: undefined);
		bridge = createSingleSubagentBridge({
			cwd: options.cwd,
			acceptingDir: options.acceptingDir,
			runSubagent: runtime,
			timeoutMs: options.runtimeTimeoutMs,
		});
	}

	const runner = createCommandSubagentRunner({
		cwd: options.cwd,
		acceptingDir: options.acceptingDir,
		bridge,
		strictRoleBoundBridge: options.strictRoleBoundBridge,
	});

	const { spawnTask, spawnStage } = createPlanRunProductionSpawnAdapter({ runner });

	return {
		spawnTask,
		spawnStage,
		reviewTask: async request => reviewTaskExecution(request),
		runMainAcceptance: async input => runMainThreadAcceptanceReview(input),
		createRepairDecision: input => createPlanRunRepairDecision(input),
	};
}

/**
 * Parse the `OMP_PLAN_RUN_SUBAGENT_RUNTIME_ARGS_JSON` environment variable.
 *
 * Returns a validated `string[]` when the value is a JSON array whose every
 * element is a string.  Returns `undefined` for missing input, malformed JSON,
 * non-array JSON, or arrays containing non-string items.
 */
export function parsePlanRunRuntimeArgsEnv(argsJson: string | undefined): string[] | undefined {
	if (!argsJson) return undefined;
	try {
		const parsed: unknown = JSON.parse(argsJson);
		if (!Array.isArray(parsed)) return undefined;
		if (!parsed.every((item): item is string => typeof item === "string")) return undefined;
		return parsed;
	} catch {
		return undefined;
	}
}

export default class PlanRunCommand extends Command {
	static description = "Execute a PlanRun from a plan execution book JSON file";

	static flags = {
		book: Flags.string({ description: "Path to execution book JSON", required: true }),
		acceptingDir: Flags.string({ description: "Directory for artifacts and output", required: true }),
		repoPath: Flags.string({ description: "Repository root path", required: true }),
		project: Flags.string({ description: "Project identifier", required: true }),
		runtimeCommandTimeoutMs: Flags.integer({
			description: "Runtime command timeout in milliseconds",
			required: false,
		}),
	};

	static examples = [
		"# Run a PlanRun from an execution book JSON file\n" +
			"  omp plan-run \\\n" +
			"    --book ./execution-book.json \\\n" +
			"    --acceptingDir /tmp/my-run \\\n" +
			"    --repoPath /path/to/repo \\\n" +
			"    --project my-project",
	];

	async run(): Promise<void> {
		const { flags } = await this.parse(PlanRunCommand);

		// Narrow required string flags — oclif Command types even required:true
		// flags as string|undefined.  We validate defensively then use them as string.
		const reqFlag = (v: string | undefined, name: string): string => {
			if (v === undefined) {
				throw new Error(`Required flag --${name} is missing`);
			}
			return v;
		};
		const book = reqFlag(flags.book, "book");
		const acceptingDir = reqFlag(flags.acceptingDir, "acceptingDir");
		const repoPath = reqFlag(flags.repoPath, "repoPath");
		const project = reqFlag(flags.project, "project");

		// Initialize settings with the repository project directory.
		await Settings.init({ cwd: repoPath });

		// Read runtime config from environment variables.
		const runtimeCommand = process.env.OMP_PLAN_RUN_SUBAGENT_RUNTIME_COMMAND;
		const runtimeArgs = parsePlanRunRuntimeArgsEnv(process.env.OMP_PLAN_RUN_SUBAGENT_RUNTIME_ARGS_JSON);
		const runtimeTimeoutMs = flags.runtimeCommandTimeoutMs;

		// Wire deps from production implementations via createPlanRunDeps.
		const deps = await createPlanRunDeps({
			cwd: repoPath,
			acceptingDir,
			runtimeCommand,
			runtimeArgs,
			runtimeTimeoutMs,
		});
		const overrides =
			flags.runtimeCommandTimeoutMs !== undefined
				? { runtimeCommandTimeoutMs: flags.runtimeCommandTimeoutMs }
				: undefined;

		const result = await runPlanRunEntry({
			bookPath: book,
			acceptingDir,
			repoPath,
			project,
			settings,
			deps,
			overrides,
		});

		// Map result state to exit code.
		if (result.state !== "ready_for_user" && result.state !== "accepted") {
			console.error(`PlanRun failed with state: ${result.state}. See gate-failure-summary in ${acceptingDir}`);
			process.exit(1);
		}
	}
}
