import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AdvisorFinding } from "../codex-plan-run/advisor-findings";

/**
 * Bridge types for running a single subagent task via a real runtime.
 *
 * These types are minimal and independent of the TaskTool internals.
 * They allow `createCommandSubagentRunner` to accept an optional bridge
 * function that replaces the structured-blocked fallback with a real
 * subprocess/session invocation.
 *
 * The bridge contract:
 * - Input is a subset of PlanRunTaskSpawnParams (the fields a runtime needs).
 * - Output has exitCode 0 → success, non-zero → failure.
 * - On success, outputPath is included in SpawnTaskOutput.evidence[].
 * - On failure, stderr (or exit code) is included in scope_notes.
 */

/**
 * Input parameters for the subagent bridge.
 * Minimal set of fields from PlanRunTaskSpawnParams that a real bridge needs.
 */
export interface SubagentBridgeParams {
	/** Stable identifier for this spawn, e.g. "T1-implementer". */
	id: string;
	/** Human-readable role label (zh_name), e.g. "实现者". */
	role: string;
	/** Model routing key from the execution book, e.g. "superpowers:implementer". */
	modelRole: string;
	/** Shared background context including run_id and previous stage outputs. */
	context: string;
	/** Stage-specific assignment including evidence path. */
	assignment: string;
	/** Human-readable description of this spawn task. */
	description: string;
	/** Required skill evidence paths that must be produced by this spawn. */
	required_skill_evidence?: string[];
}

/**
 * Result from a real subagent bridge invocation.
 * A bridge function resolves to this shape.
 */
export interface SubagentBridgeResult {
	/** Exit code: 0 for success, non-zero for failure. */
	exitCode: number;
	/** Path to the output artifact (only meaningful on success). */
	outputPath?: string;
	/** Evidence paths produced by the bridge (only meaningful on success). */
	evidence?: string[];
	/** Stderr text (only meaningful on failure). */
	stderr?: string;
	/** Agent identifier returned by the runtime. */
	id?: string;
	/** Model role used by the runtime. */
	modelRole?: string;
	/** Resolved model name. */
	resolvedModel?: string;
	/** Model override flags. */
	modelOverrides?: string[];
	/** Files changed by the subagent task (only meaningful on success). */
	changed_files?: string[];
	/** Tests run by the subagent task (only meaningful on success). */
	tests_run?: string[];
	/** Execution skills used by the subagent task (only meaningful on success). */
	execution_skills_used?: string[];
	/** Final tail skills used by the subagent task (only meaningful on success). */
	final_tail_skills_used?: string[];
	/** Advisor findings produced by the subagent task (only meaningful on success). */
	advisorFindings?: AdvisorFinding[];
}

/**
 * Bridge function type: executes a single subagent task via a real runtime.
 * Returns a SubagentBridgeResult with exitCode 0 on success.
 */

export type SubagentBridge = (params: SubagentBridgeParams) => Promise<SubagentBridgeResult>;
/**
 * Complete input for a SingleSubagentRuntime.
 * Extends SubagentBridgeParams with runtime wiring fields.
 */
export interface SingleSubagentRuntimeInput {
	/** Stable identifier for this spawn, e.g. "T1-implementer". */
	id: string;
	/** Human-readable role label (zh_name), e.g. "实现者". */
	role: string;
	/** Model routing key from the execution book, e.g. "superpowers:implementer". */
	modelRole: string;
	/** Shared background context including run_id and previous stage outputs. */
	context: string;
	/** Stage-specific assignment including evidence path. */
	assignment: string;
	/** Human-readable description of this spawn task. */
	description: string;
	/** Required skill evidence paths that must be produced by this spawn. */
	required_skill_evidence?: string[];
	/** Working directory for the runtime. */
	cwd: string;
	/** Directory for artifacts and output. */
	acceptingDir: string;
	/** Path to the written input JSON file. */
	inputPath: string;
	/** Default output path for the runtime result. */
	outputPath: string;
	/** Optional timeout in milliseconds. */
	timeoutMs?: number;
}

/**
 * Raw result from a SingleSubagentRuntime.
 * The bridge wraps this into a SubagentBridgeResult.
 */
export interface SingleSubagentRuntimeResult {
	/** Exit code: 0 for success, non-zero for failure. */
	exitCode: number;
	/** Stdout text, may be JSON with outputPath. */
	stdout?: string;
	/** Stderr text. */
	stderr?: string;
	/** Agent identifier returned by the runtime. */
	agentId?: string;
	/** Model role used by the runtime. */
	modelRole?: string;
	/** Resolved model name. */
	resolvedModel?: string;
	/** Model override flags. */
	modelOverrides?: string[];
}

/**
 * Runtime function type: executes a single subagent task.
 * Implementations must accept SingleSubagentRuntimeInput and return
 * SingleSubagentRuntimeResult.
 */
export type SingleSubagentRuntime = (input: SingleSubagentRuntimeInput) => Promise<SingleSubagentRuntimeResult>;

/**
 * Options for creating a SubagentBridge that wraps a SingleSubagentRuntime.
 */
export interface CreateSingleSubagentBridgeOptions {
	/** Working directory of the CLI process. */
	cwd: string;
	/** Directory for artifacts and output. */
	acceptingDir: string;
	/**
	 * Optional runtime function. When omitted, the bridge returns an error
	 * indicating the runtime is not configured.
	 */
	runSubagent?: SingleSubagentRuntime;
	/** Optional timeout in milliseconds passed through to the runtime. */
	timeoutMs?: number;
}

/**
 * Create a SubagentBridge that wraps a SingleSubagentRuntime.
 *
 * The bridge:
 * 1. Creates `${acceptingDir}/tasks/${params.id}/` and writes `input.json`.
 * 2. If no runtime is configured, returns a non-zero error.
 * 3. On runtime success, parses stdout as JSON for an optional outputPath;
 *    invalid JSON returns exitCode 65.
 * 4. Maps runtime metadata (agentId, modelRole, resolvedModel) into the bridge result.
 */
export function createSingleSubagentBridge(options: CreateSingleSubagentBridgeOptions): SubagentBridge {
	return async (params: SubagentBridgeParams): Promise<SubagentBridgeResult> => {
		const taskDir = join(options.acceptingDir, "tasks", params.id);
		const inputPath = join(taskDir, "input.json");
		const outputPath = join(taskDir, "output.json");

		// Ensure task directory exists and write auditable input
		let input: SingleSubagentRuntimeInput;
		try {
			await mkdir(taskDir, { recursive: true });
			input = {
				...params,
				cwd: options.cwd,
				acceptingDir: options.acceptingDir,
				inputPath,
				outputPath,
				timeoutMs: options.timeoutMs,
			};
			await writeFile(inputPath, JSON.stringify(input, null, 2), "utf8");
		} catch (error) {
			return {
				exitCode: 1,
				stderr: `Failed to prepare bridge environment${error instanceof Error ? `: ${error.message}` : ""}`,
				id: params.id,
				modelRole: params.modelRole,
			};
		}

		// No runtime configured — return unavailable error
		if (!options.runSubagent) {
			return {
				exitCode: 1,
				stderr: "single subagent runtime is not configured for this CLI environment",
				id: params.id,
				modelRole: params.modelRole,
			};
		}

		const runtimeResult = await options.runSubagent(input);

		// Non-zero exit — propagate error
		if (runtimeResult.exitCode !== 0) {
			return {
				exitCode: runtimeResult.exitCode,
				stderr: runtimeResult.stderr,
				id: runtimeResult.agentId ?? params.id,
				modelRole: runtimeResult.modelRole ?? params.modelRole,
				resolvedModel: runtimeResult.resolvedModel,
				modelOverrides: runtimeResult.modelOverrides,
			};
		}

		// Success — parse stdout for output path, evidence, and task output fields
		let parsedOutputPath: string | undefined;
		let parsedEvidence: string[] | undefined;
		let parsedChangedFiles: string[] | undefined;
		let parsedTestsRun: string[] | undefined;
		let parsedExecutionSkillsUsed: string[] | undefined;
		let parsedFinalTailSkillsUsed: string[] | undefined;
		let parsedAdvisorFindings: AdvisorFinding[] | undefined;
		if (runtimeResult.stdout) {
			try {
				const parsed = JSON.parse(runtimeResult.stdout);
				if (parsed && typeof parsed === "object" && "outputPath" in parsed) {
					parsedOutputPath = parsed.outputPath;
				}
				if (parsed && typeof parsed === "object" && "evidence" in parsed && Array.isArray(parsed.evidence)) {
					parsedEvidence = parsed.evidence;
				}
				if (
					parsed &&
					typeof parsed === "object" &&
					"changed_files" in parsed &&
					Array.isArray(parsed.changed_files)
				) {
					parsedChangedFiles = parsed.changed_files;
				}
				if (parsed && typeof parsed === "object" && "tests_run" in parsed && Array.isArray(parsed.tests_run)) {
					parsedTestsRun = parsed.tests_run;
				}
				if (
					parsed &&
					typeof parsed === "object" &&
					"execution_skills_used" in parsed &&
					Array.isArray(parsed.execution_skills_used)
				) {
					parsedExecutionSkillsUsed = parsed.execution_skills_used;
				}
				if (
					parsed &&
					typeof parsed === "object" &&
					"final_tail_skills_used" in parsed &&
					Array.isArray(parsed.final_tail_skills_used)
				) {
					parsedFinalTailSkillsUsed = parsed.final_tail_skills_used;
				}
				if (
					parsed &&
					typeof parsed === "object" &&
					"advisorFindings" in parsed &&
					Array.isArray(parsed.advisorFindings)
				) {
					parsedAdvisorFindings = parsed.advisorFindings;
				}
			} catch {
				return {
					exitCode: 65,
					stderr: "subagent bridge stdout was not valid JSON",
					id: runtimeResult.agentId ?? params.id,
					modelRole: runtimeResult.modelRole ?? params.modelRole,
					resolvedModel: runtimeResult.resolvedModel,
					modelOverrides: runtimeResult.modelOverrides,
				};
			}
		}

		return {
			exitCode: 0,
			outputPath: parsedOutputPath ?? outputPath,
			evidence: parsedEvidence,
			id: runtimeResult.agentId ?? params.id,
			modelRole: runtimeResult.modelRole ?? params.modelRole,
			resolvedModel: runtimeResult.resolvedModel,
			modelOverrides: runtimeResult.modelOverrides,
			changed_files: parsedChangedFiles,
			tests_run: parsedTestsRun,
			execution_skills_used: parsedExecutionSkillsUsed,
			final_tail_skills_used: parsedFinalTailSkillsUsed,
			advisorFindings: parsedAdvisorFindings,
		};
	};
}

/**
 * Options for creating a command-based SingleSubagentRuntime.
 */
export interface CreateCommandSingleSubagentRuntimeOptions {
	/** The command/executable to spawn (e.g. process.execPath). */
	command?: string;
	/** Arguments to pass to the command. Defaults to []. */
	args?: string[];
	/** Extra environment variables merged onto process.env. */
	env?: Record<string, string>;
	/** Default timeout in milliseconds; used when input.timeoutMs is absent. */
	timeoutMs?: number;
}

/**
 * Create a SingleSubagentRuntime that spawns a configured command.
 *
 * Sets four OMP_PLAN_RUN_* environment variables so the child process
 * can locate its input, write its output, and identify itself.
 *
 * Returns nonzero with stderr "single subagent runtime command is not configured"
 * when no command is provided in options.
 */
export function createCommandSingleSubagentRuntime(
	options?: CreateCommandSingleSubagentRuntimeOptions,
): SingleSubagentRuntime {
	return (input: SingleSubagentRuntimeInput): Promise<SingleSubagentRuntimeResult> => {
		if (!options?.command) {
			return Promise.resolve({
				exitCode: 1,
				stdout: "",
				stderr: "single subagent runtime command is not configured",
			});
		}

		return new Promise<SingleSubagentRuntimeResult>(resolve => {
			const env: Record<string, string> = {
				...process.env,
				...(options.env ?? {}),
				OMP_PLAN_RUN_SUBAGENT_ID: input.id,
				OMP_PLAN_RUN_SUBAGENT_INPUT_PATH: input.inputPath,
				OMP_PLAN_RUN_SUBAGENT_OUTPUT_PATH: input.outputPath,
				OMP_PLAN_RUN_ACCEPTING_DIR: input.acceptingDir,
			} as Record<string, string>;

			let timeoutId: ReturnType<typeof setTimeout> | undefined;
			let timedOut = false;

			const child = spawn(options.command!, options.args ?? [], {
				cwd: input.cwd,
				env,
				stdio: ["ignore", "pipe", "pipe"],
			});

			let stdout = "";
			let stderr = "";

			child.stdout.on("data", (chunk: Buffer) => {
				stdout += chunk.toString();
			});
			child.stderr.on("data", (chunk: Buffer) => {
				stderr += chunk.toString();
			});

			child.on("error", (error: Error) => {
				if (timeoutId) clearTimeout(timeoutId);
				resolve({
					exitCode: 1,
					stdout,
					stderr: error.message,
				});
			});

			child.on("close", (code: number | null) => {
				if (timeoutId) clearTimeout(timeoutId);
				if (timedOut) return;
				resolve({
					exitCode: code ?? 1,
					stdout,
					stderr,
				});
			});

			if ((input.timeoutMs ?? options?.timeoutMs) && (input.timeoutMs ?? options?.timeoutMs)! > 0) {
				const effectiveTimeout = (input.timeoutMs ?? options?.timeoutMs)!;
				timeoutId = setTimeout(() => {
					timedOut = true;
					child.kill();
					resolve({
						exitCode: 124,
						stdout,
						stderr: stderr || "single subagent runtime command timed out",
					});
				}, effectiveTimeout);
			}
		});
	};
}
