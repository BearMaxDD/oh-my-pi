import { join } from "node:path";
import type { RoleBoundStageRunOutput, SpawnTaskOutput } from "./driver";
import type { PlanExecutionBook } from "./execution-book";
import type { RoleBoundStageRunInput, StageOutputRef } from "./role-bound-stage-scheduler";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Parameter bag for spawning a single stage as a subagent via the task tool.
 * Designed to match the shape consumed by the harness's task() spawn.
 */
export interface PlanRunTaskSpawnParams {
	/** The agent type to spawn — always "task" for PlanRun stage execution. */
	agent: "task";
	/** Stable identifier for this spawn, e.g. "T1-implementer". */
	id: string;
	/** Human-readable role label (zh_name), e.g. "实现者". */
	role: string;
	/** Model routing key from the execution book, e.g. "superpowers:implementer". */
	modelRole: string;
	/** Shared background context including run_id and previous stage outputs. */
	context: string;
	/** Stage-specific assignment including evidence path and prohibition on project-wide commands. */
	assignment: string;
	/** Human-readable description of this spawn task. */
	description: string;
	/** Required skill evidence paths that must be produced by this spawn. */
	required_skill_evidence?: string[];
}

/**
 * Runner interface that executes a single stage spawn given its params.
 * Returns the extended SpawnTaskOutput produced by the subagent runner.
 */
export interface PlanRunSubagentRunner {
	run(params: PlanRunTaskSpawnParams): Promise<SpawnTaskOutput>;
}

/**
 * Options for creating a production spawn adapter.
 */
export interface CreatePlanRunProductionSpawnAdapterOptions {
	/** The runner that executes subagent spawns. */
	runner: PlanRunSubagentRunner;
}

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

/**
 * Build the shared context string for a stage spawn.
 * Includes the run identifier and a summary of previous stage outputs.
 */
function buildContext(runId: string, previousStageOutputs: readonly StageOutputRef[]): string {
	const lines: string[] = [`Run ID: ${runId}`];
	if (previousStageOutputs.length > 0) {
		lines.push("Previous stage outputs:");
		for (const output of previousStageOutputs) {
			lines.push(`  - Task ${output.taskId}, stage ${output.stageId}: ${output.outputPath}`);
		}
	}
	return lines.join("\n");
}

/**
 * Build the assignment string for a stage spawn.
 * Includes the role label, task/stage identifiers, evidence path,
 * required evidence artifact paths from the prompt pack, and
 * a prohibition against running project-level build/test/lint commands.
 */
function buildAssignment(
	taskId: string,
	stageId: string,
	role: string,
	acceptingDir: string,
	requiredArtifactPaths?: string[],
): string {
	const evidencePath = join(acceptingDir, "tasks", taskId, "evidence");
	const lines: string[] = [
		`You are the ${role} for task ${taskId}, stage ${stageId}.`,
		`Evidence path: ${evidencePath}`,
		"",
		"IMPORTANT: Do not run project-level build, test, lint, or format commands.",
		"Only run the specific tests or commands required for this stage.",
	];
	if (requiredArtifactPaths && requiredArtifactPaths.length > 0) {
		lines.push("", "Required evidence artifacts to produce:");
		for (const artifactPath of requiredArtifactPaths) {
			lines.push(`  - ${artifactPath}`);
		}
	}
	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Build PlanRunTaskSpawnParams from a RoleBoundStageRunInput.
 *
 * Extracts:
 * - agent — always "task"
 * - id — "${taskId}-${stageId}"
 * - role — from the prompt pack's role_contract.zh_name
 * - modelRole — from the stage run input
 * - context — run_id + previous stage output summary
 * - assignment — stage label, evidence path, required_output artifact paths,
 *   and prohibition on project-wide commands
 * - description — human-readable stage label
 * - required_skill_evidence — populated from prompt pack required_outputs
 */
export function buildPlanRunStageSpawnParams(input: RoleBoundStageRunInput): PlanRunTaskSpawnParams {
	const role = input.promptPack.role_contract.zh_name;
	const id = `${input.taskId}-${input.stageId}`;
	const requiredArtifactPaths = input.promptPack.required_outputs.filter(o => o.required).map(o => o.artifact_path);

	return {
		agent: "task",
		id,
		role,
		modelRole: input.modelRole,
		context: buildContext(input.book.run_id, input.previousStageOutputs),
		assignment: buildAssignment(input.taskId, input.stageId, role, input.acceptingDir, requiredArtifactPaths),
		description: `${role} — task ${input.taskId}, stage ${input.stageId}`,
		required_skill_evidence: requiredArtifactPaths,
	};
}

/**
 * Create a production spawn adapter that provides spawnTask and spawnStage
 * functions backed by a PlanRunSubagentRunner.
 *
 * - spawnTask: full-task-level spawn (placeholder — Task 2 owns the real execution).
 * - spawnStage: per-stage spawn that delegates to the runner and maps the
 *   SubagentTaskOutput into a RoleBoundStageRunOutput.
 *
 * For Task 1 the mapping is minimal: the runner's output fields are spread
 * into the stage output shape with the required metadata fields filled from
 * the input.
 */
export function createPlanRunProductionSpawnAdapter(options: CreatePlanRunProductionSpawnAdapterOptions): {
	spawnTask(input: { book: PlanExecutionBook; acceptingDir: string; taskId: string }): Promise<SpawnTaskOutput>;
	spawnStage(input: RoleBoundStageRunInput): Promise<RoleBoundStageRunOutput>;
} {
	const { runner } = options;

	const spawnTask = async (input: {
		book: PlanExecutionBook;
		acceptingDir: string;
		taskId: string;
	}): Promise<SpawnTaskOutput> => {
		const params: PlanRunTaskSpawnParams = {
			agent: "task",
			id: input.taskId,
			role: "task-executor",
			modelRole: "default",
			context: `Run ID: ${input.book.run_id}\nTask: ${input.taskId}`,
			assignment: `Execute task ${input.taskId}`,
			description: `Execute task ${input.taskId}`,
			required_skill_evidence: [],
		};
		return runner.run(params);
	};

	const spawnStage = async (input: RoleBoundStageRunInput): Promise<RoleBoundStageRunOutput> => {
		const params = buildPlanRunStageSpawnParams(input);
		const output = await runner.run(params);
		// Shallow-safe copy so we never mutate the runner-owned object.
		// advisorFindings is a nested array – copy it separately so .push
		// on the copy's array doesn't affect the runner's array.
		const stageOutput: SpawnTaskOutput = {
			...output,
			advisorFindings: output.advisorFindings ? [...output.advisorFindings] : undefined,
		};

		// Check for missing required evidence.
		// When the runner reports "completed" but a required output artifact path
		// is absent from the evidence list, we downgrade to "blocked" and record
		// an advisor finding. Optional outputs are not checked.
		if (stageOutput.result === "completed") {
			const requiredPaths = input.promptPack.required_outputs.filter(o => o.required).map(o => o.artifact_path);

			const missingPaths = requiredPaths.filter(path => !stageOutput.evidence.includes(path));

			if (missingPaths.length > 0) {
				stageOutput.result = "blocked";
				if (!stageOutput.advisorFindings) stageOutput.advisorFindings = [];
				stageOutput.advisorFindings.push({
					schema_version: 1,
					run_id: input.book.run_id,
					task_id: input.taskId,
					severity: "blocker",
					category: "evidence",
					finding: `缺少 stage evidence: ${missingPaths.join(", ")}`,
					evidence: `Required outputs not in stage evidence: ${missingPaths.join(", ")}`,
					required_action: `提交缺少的证据: ${missingPaths.join(", ")}`,
				});
			}
		}

		const outputPath = join(input.acceptingDir, "tasks", input.taskId, "stages", input.stageId, "output.json");

		return {
			...stageOutput,
			modelRole: input.modelRole,
			task_id: input.taskId,
			stage_id: input.stageId,
			role_id: input.promptPack.role_id,
			schema_version: input.promptPack.return_schema.id,
			output_path: outputPath,
			evidence_paths: [...stageOutput.evidence],
		};
	};

	return { spawnTask, spawnStage };
}
