import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import { zodToWireSchema } from "@oh-my-pi/pi-ai/utils/schema";
import { z } from "zod/v4";
import {
	createPlanRunRepairDecision,
	type MainThreadAcceptanceReviewRequest,
	type MainThreadAcceptanceReviewResult,
	type PlanExecutionBook,
	type PlanRunRepairDecision,
	renderRepairRoundMarkdown,
	type TaskReviewResult,
} from "../codex-plan-run";
import type { ToolSession } from ".";

const stringArraySchema = z.array(z.string()).default([]);

function emptyTaskExecutionScope() {
	return {
		goal: "",
		allowed_files: [],
		forbidden_files: [],
		likely_files: [],
		existing_patterns: [],
		out_of_scope: [],
	};
}

function emptyTaskReviewGate() {
	return {
		acceptance_criteria: [],
		smoke_commands: [],
		required_evidence: [],
		must_fix_conditions: [],
	};
}

function emptyProjectRecon() {
	return {
		repo_path: "",
		relevant_modules: [],
		likely_files: [],
		existing_patterns: [],
		test_commands: [],
		build_commands: [],
		style_conventions: [],
		risk_areas: [],
		forbidden_changes: [],
	};
}

function emptyTodoSnapshot() {
	return {
		runId: "",
		version: 1,
		state: "",
		updatedAt: "",
		source: "",
		phases: [],
	};
}

const taskExecutionScopeToolSchema = z.object({
	goal: z.string().default(""),
	allowed_files: stringArraySchema,
	forbidden_files: stringArraySchema,
	likely_files: stringArraySchema,
	existing_patterns: stringArraySchema,
	out_of_scope: stringArraySchema,
});

const taskReviewGateToolSchema = z.object({
	acceptance_criteria: stringArraySchema,
	smoke_commands: stringArraySchema,
	required_evidence: stringArraySchema,
	must_fix_conditions: stringArraySchema,
});

const taskToolSchema = z.object({
	id: z.string(),
	title: z.string().default(""),
	source: z.string().default(""),
	todo: z.string().default(""),
	execution_skills: stringArraySchema,
	review_skills: stringArraySchema,
	final_tail_skills: stringArraySchema,
	allowed_files: stringArraySchema,
	forbidden_files: stringArraySchema,
	smoke_commands: stringArraySchema,
	required_skill_evidence: stringArraySchema,
	advisor_watch_points: stringArraySchema,
	implementation_analysis: z.string().default(""),
	implementation_steps: stringArraySchema,
	execution_scope: taskExecutionScopeToolSchema.default(emptyTaskExecutionScope),
	review_gate: taskReviewGateToolSchema.default(emptyTaskReviewGate),
});

const projectReconToolSchema = z.object({
	repo_path: z.string().default(""),
	relevant_modules: stringArraySchema,
	likely_files: stringArraySchema,
	existing_patterns: stringArraySchema,
	test_commands: stringArraySchema,
	build_commands: stringArraySchema,
	style_conventions: stringArraySchema,
	risk_areas: stringArraySchema,
	forbidden_changes: stringArraySchema,
});

const planExecutionBookToolSchema = z.object({
	run_id: z.string(),
	plan: z.object({
		path: z.string(),
		sha256: z.string(),
		repo_path: z.string(),
	}),
	accepting_dir: z.string(),
	project_recon: projectReconToolSchema.default(emptyProjectRecon),
	final_acceptance_commands: stringArraySchema,
	tasks: z.array(taskToolSchema).default([]),
});

const taskReviewMustFixItemToolSchema = z.object({
	id: z.string(),
	description: z.string(),
	evidence: z.string(),
});

const taskReviewToolSchema = z.object({
	task_id: z.string(),
	result: z.enum(["TASK_ACCEPTED", "TASK_FIX_REQUIRED"]),
	must_fix_items: z.array(taskReviewMustFixItemToolSchema).default([]),
});

const mainAcceptanceMustFixItemToolSchema = z.object({
	id: z.string(),
	category: z
		.enum(["protocol", "task_status", "verification", "evidence", "scope", "skill", "packet"])
		.default("verification"),
	severity: z.literal("must_fix").default("must_fix"),
	description: z.string().default(""),
	evidence: z.string(),
	required_fix: z.string(),
	affected_tasks: stringArraySchema,
	required_commands: stringArraySchema,
	authorized_files: stringArraySchema,
});

const mainAcceptanceToolSchema = z.object({
	result: z.enum(["MAIN_ACCEPTANCE_ACCEPTED", "MAIN_ACCEPTANCE_FIX_REQUIRED"]),
	review_round: z.number().int().nonnegative(),
	must_fix_items: z.array(mainAcceptanceMustFixItemToolSchema).default([]),
});

const mainAcceptanceRequestToolSchema = z.object({
	runId: z.string(),
	reviewRound: z.number().int().nonnegative(),
	repoPath: z.string(),
	worktreePath: z.string(),
	planPath: z.string(),
	planSha256: z.string(),
	acceptingDir: z.string(),
	executionBookPath: z.string().default(""),
	manifestPath: z.string().default(""),
	completionDocPath: z.string().default(""),
	todoSnapshot: z
		.object({
			runId: z.string().default(""),
			version: z.number().int().nonnegative().default(1),
			state: z.string().default(""),
			updatedAt: z.string().default(""),
			source: z.string().default(""),
			phases: z
				.array(
					z.object({
						name: z.string().default(""),
						tasks: z
							.array(
								z.object({
									content: z.string().default(""),
									status: z.enum(["pending", "in_progress", "completed"]).default("pending"),
								}),
							)
							.default([]),
					}),
				)
				.default([]),
		})
		.default(emptyTodoSnapshot),
	executionBook: planExecutionBookToolSchema,
	taskOutputs: z
		.array(
			z.object({
				task_id: z.string().default(""),
				result: z.enum(["completed", "failed", "aborted"]).default("failed"),
				subagent_id: z.string().default(""),
				summary: z.string().default(""),
				files_changed: stringArraySchema,
				commands_run: z
					.array(
						z.object({
							command: z.string().default(""),
							exit_code: z.number().int().default(1),
							cwd: z.string().default(""),
							started_at: z.string().default(""),
							completed_at: z.string().default(""),
							output_excerpt: z.string().default(""),
							evidence_path: z.string().optional(),
						}),
					)
					.default([]),
				evidence_files: stringArraySchema,
				review_skills_used: stringArraySchema,
				final_tail_skills_used: stringArraySchema,
			}),
		)
		.default([]),
	taskReviewRecords: z.array(taskReviewToolSchema).default([]),
	verificationCommands: z
		.array(
			z.object({
				command: z.string(),
				exit_code: z.number().int(),
				cwd: z.string().default(""),
				started_at: z.string().default(""),
				completed_at: z.string().default(""),
				output_excerpt: z.string().default(""),
				evidence_path: z.string().optional(),
			}),
		)
		.default([]),
	finalAcceptanceCommands: stringArraySchema,
});

const planRepairLoopInputSchema = z.object({
	book: planExecutionBookToolSchema,
	taskReview: taskReviewToolSchema.optional(),
	mainAcceptance: mainAcceptanceToolSchema.optional(),
	mainAcceptanceRequest: mainAcceptanceRequestToolSchema.optional(),
	repairRound: z.number().int().nonnegative(),
	maxRepairRounds: z.number().int().positive().default(3),
	repoPath: z.string().optional(),
	worktreePath: z.string().optional(),
	acceptingDir: z.string().optional(),
	planPath: z.string().optional(),
	planSha256: z.string().optional(),
});

const planRepairLoopSchema = {
	...zodToWireSchema(planRepairLoopInputSchema),
	type: "object",
} satisfies Record<string, unknown>;

export type PlanRepairLoopNextAction = "spawn_subagent" | "run_writing_plans_repair" | "blocked";

export interface PlanRepairLoopToolInput {
	book: PlanExecutionBook;
	taskReview?: TaskReviewResult;
	mainAcceptance?: MainThreadAcceptanceReviewResult;
	mainAcceptanceRequest?: MainThreadAcceptanceReviewRequest;
	repairRound: number;
	maxRepairRounds?: number;
	repoPath?: string;
	worktreePath?: string;
	acceptingDir?: string;
	planPath?: string;
	planSha256?: string;
}

export interface PlanRepairLoopArtifact {
	path: string;
	content: string;
	written_path: string;
}

export interface PlanRepairLoopToolResult {
	kind: PlanRunRepairDecision["kind"];
	next_state: PlanRunRepairDecision["nextState"];
	next_action: PlanRepairLoopNextAction;
	requires_writing_plans: boolean;
	reason: string;
	repair_round: number;
	max_repair_rounds: number;
	original_plan_path: string;
	original_plan_sha256: string;
	repo_path: string;
	worktree_path: string;
	accepting_dir: string;
	subagent_assignment: string;
	fix_task?: PlanRunRepairDecision["fixTask"];
	artifact: PlanRepairLoopArtifact;
}

function nextActionForDecision(decision: PlanRunRepairDecision): PlanRepairLoopNextAction {
	if (decision.kind === "REPAIR_LOOP_BLOCKED") {
		return "blocked";
	}
	if (decision.requiresWritingPlans || decision.kind === "PLAN_DEFECT_REPLAN_REQUIRED") {
		return "run_writing_plans_repair";
	}
	if (decision.subagentAssignment) {
		return "spawn_subagent";
	}
	return "blocked";
}

export async function buildPlanRepairLoopToolResult(input: PlanRepairLoopToolInput): Promise<PlanRepairLoopToolResult> {
	const maxRepairRounds = input.maxRepairRounds ?? 3;
	const decision = createPlanRunRepairDecision({
		book: input.book,
		taskReview: input.taskReview,
		mainAcceptanceReview: input.mainAcceptance,
		mainAcceptanceRequest: input.mainAcceptanceRequest,
		repairRound: input.repairRound,
		maxRepairRounds,
		repoPath: input.repoPath,
		worktreePath: input.worktreePath,
		acceptingDir: input.acceptingDir,
		planPath: input.planPath,
		planSha256: input.planSha256,
	});
	const artifactPath = `repair-round-${decision.repairRound}.md`;
	const content = renderRepairRoundMarkdown({ book: input.book, decision });
	const writtenPath = join(decision.acceptingDir, artifactPath);
	await mkdir(decision.acceptingDir, { recursive: true });
	await writeFile(writtenPath, content, "utf8");

	return {
		kind: decision.kind,
		next_state: decision.nextState,
		next_action: nextActionForDecision(decision),
		requires_writing_plans: decision.requiresWritingPlans,
		reason: decision.reason,
		repair_round: decision.repairRound,
		max_repair_rounds: decision.maxRepairRounds,
		original_plan_path: decision.originalPlanPath,
		original_plan_sha256: decision.originalPlanSha256,
		repo_path: decision.repoPath,
		worktree_path: decision.worktreePath,
		accepting_dir: decision.acceptingDir,
		subagent_assignment: decision.subagentAssignment,
		fix_task: decision.fixTask,
		artifact: {
			path: artifactPath,
			content,
			written_path: writtenPath,
		},
	};
}

export class PlanRepairLoopTool implements AgentTool<typeof planRepairLoopSchema, PlanRepairLoopToolResult> {
	readonly name = "plan_repair_loop";
	readonly approval = "exec" as const;
	readonly label = "Plan Repair Loop";
	readonly summary = "Classify a PlanRun repair round and write the repair-round artifact";
	readonly description = [
		"Accept a task review or main-thread acceptance failure for an OMP PlanRun.",
		"Return the next repair-loop action and write repair-round-N.md to the accepting directory.",
	].join("\n");
	readonly parameters = planRepairLoopSchema;
	readonly strict = true;
	readonly loadMode = "discoverable";

	constructor(private readonly session: ToolSession) {}

	async execute(
		_toolCallId: string,
		params: unknown,
		_signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<PlanRepairLoopToolResult>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<PlanRepairLoopToolResult>> {
		onUpdate?.({ content: [{ type: "text", text: "Creating PlanRun repair-loop decision..." }] });
		const input = planRepairLoopInputSchema.parse(params) as unknown as PlanRepairLoopToolInput;
		const result = await buildPlanRepairLoopToolResult({
			...input,
			repoPath: input.repoPath || input.book.plan.repo_path || this.session.cwd,
		});
		return {
			content: [{ type: "text", text: `PlanRun repair loop next action: ${result.next_action}` }],
			details: result,
		};
	}
}
