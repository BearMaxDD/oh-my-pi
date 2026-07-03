import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { AgentTool, AgentToolContext, AgentToolResult, AgentToolUpdateCallback } from "@oh-my-pi/pi-agent-core";
import { zodToWireSchema } from "@oh-my-pi/pi-ai/utils/schema";
import { z } from "zod/v4";
import { createAdvisorSummary } from "../codex-plan-run/advisor-summary";
import {
	type AutonomousProjectRecon,
	createAutonomousPlanExecutionBookInput,
} from "../codex-plan-run/autonomous-planner";
import {
	type CreatePlanExecutionBookOptions,
	createPlanExecutionBook,
	renderPlanExecutionBook,
} from "../codex-plan-run/execution-book";
import { createSkillEvidenceMatrix } from "../codex-plan-run/skill-evidence";
import { createEmptyTddEvidenceMatrix } from "../codex-plan-run/tdd-evidence";
import type { ToolSession } from ".";

const autonomousReconSchema = z.object({
	summary: z.string(),
	relevant_files: z.array(z.string()),
	test_commands: z.array(z.string()),
	build_commands: z.array(z.string()),
	risks: z.array(z.string()),
});

const taskSchema = z.object({
	id: z.string(),
	title: z.string(),
	source: z.string().optional(),
	todo: z.string().optional(),
	goal: z.string().optional(),
	executionSkills: z.array(z.string()).optional(),
	reviewSkills: z.array(z.string()).optional(),
	finalTailSkills: z.array(z.string()).optional(),
	acceptance: z.array(z.string()).optional(),
	smokeCommands: z.array(z.string()).optional(),
	requiredEvidence: z.array(z.string()).optional(),
	mustFixConditions: z.array(z.string()).optional(),
	allowedFiles: z.array(z.string()).optional(),
	forbiddenFiles: z.array(z.string()).optional(),
	likelyFiles: z.array(z.string()).optional(),
	existingPatterns: z.array(z.string()).optional(),
	outOfScope: z.array(z.string()).optional(),
	implementationSteps: z.array(z.string()).optional(),
});

const projectReconSchema = z.object({
	summary: z.string().optional(),
	relevant_files: z.array(z.string()).optional(),
	risks: z.array(z.string()).optional(),
	repo_path: z.string().optional(),
	relevant_modules: z.array(z.string()).optional(),
	likely_files: z.array(z.string()).optional(),
	existing_patterns: z.array(z.string()).optional(),
	test_commands: z.array(z.string()),
	build_commands: z.array(z.string()),
	style_conventions: z.array(z.string()).optional(),
	risk_areas: z.array(z.string()).optional(),
	forbidden_changes: z.array(z.string()).optional(),
	task_file_map: z.record(z.string(), z.array(z.string())).optional(),
});

const planExecutionBookInputSchema = z.union([
	z.object({
		mode: z.literal("autonomous"),
		runId: z.string(),
		userRequest: z.string(),
		repoPath: z.string(),
		recon: autonomousReconSchema,
	}),
	z.object({
		mode: z.literal("manual").optional(),
		runId: z.string(),
		planPath: z.string(),
		planSha256: z.string(),
		repoPath: z.string(),
		acceptingDir: z.string(),
		projectRecon: projectReconSchema,
		requiredExecutionSkills: z.array(z.string()),
		requiredReviewSkills: z.array(z.string()),
		finalTailSkills: z.array(z.string()),
		finalAcceptanceCommands: z.array(z.string()).optional(),
		tasks: z.array(taskSchema).min(1),
	}),
]);

const planExecutionBookSchema = {
	...zodToWireSchema(planExecutionBookInputSchema),
	type: "object",
} satisfies Record<string, unknown>;

export type PlanExecutionBookToolInput =
	| {
			mode: "autonomous";
			runId: string;
			userRequest: string;
			repoPath: string;
			artifactDir?: string;
			recon: AutonomousProjectRecon;
	  }
	| (CreatePlanExecutionBookOptions & { mode?: "manual"; artifactDir?: string });

export interface PlanExecutionBookArtifact {
	path: string;
	content: string;
	written_path?: string;
}

export interface PlanExecutionBookToolResult {
	run_id: string;
	artifacts: PlanExecutionBookArtifact[];
}

function toExecutionBookInput(input: PlanExecutionBookToolInput): CreatePlanExecutionBookOptions {
	if (input.mode === "autonomous") {
		return createAutonomousPlanExecutionBookInput(input);
	}
	return input;
}

export async function buildPlanExecutionBookToolResult(
	input: PlanExecutionBookToolInput,
): Promise<PlanExecutionBookToolResult> {
	const book = createPlanExecutionBook(toExecutionBookInput(input));
	const taskIds = book.tasks.map(task => task.id);
	const artifacts: PlanExecutionBookArtifact[] = [
		{ path: "plan-execution-book.md", content: renderPlanExecutionBook(book) },
		{ path: "task-cards.json", content: `${JSON.stringify(book.tasks, null, 2)}\n` },
		{
			path: "tdd-evidence-matrix.json",
			content: `${JSON.stringify(createEmptyTddEvidenceMatrix(taskIds), null, 2)}\n`,
		},
		{
			path: "skill-evidence-matrix.json",
			content: `${JSON.stringify(createSkillEvidenceMatrix(taskIds), null, 2)}\n`,
		},
		{ path: "advisor-summary.json", content: `${JSON.stringify(createAdvisorSummary([]), null, 2)}\n` },
	];
	if (input.artifactDir) {
		await mkdir(input.artifactDir, { recursive: true });
		await Promise.all(
			artifacts.map(async artifact => {
				const writtenPath = join(input.artifactDir ?? "", artifact.path);
				await writeFile(writtenPath, artifact.content, "utf8");
				artifact.written_path = writtenPath;
			}),
		);
	}
	return {
		run_id: book.run_id,
		artifacts,
	};
}

export class PlanExecutionBookTool implements AgentTool<typeof planExecutionBookSchema, PlanExecutionBookToolResult> {
	readonly name = "plan_execution_book";
	readonly approval = "exec" as const;
	readonly label = "Plan Execution Book";
	readonly summary = "Create an OMP Plan Execution Book artifact set";
	readonly description = [
		"Create a Plan Execution Book input from either an autonomous user request or a manual Codex plan.",
		"Use this before launching plan-run subagents.",
	].join("\n");
	readonly parameters = planExecutionBookSchema;
	readonly strict = true;
	readonly loadMode = "discoverable";

	constructor(private readonly session: ToolSession) {}

	async execute(
		_toolCallId: string,
		params: unknown,
		_signal?: AbortSignal,
		onUpdate?: AgentToolUpdateCallback<PlanExecutionBookToolResult>,
		_context?: AgentToolContext,
	): Promise<AgentToolResult<PlanExecutionBookToolResult>> {
		onUpdate?.({ content: [{ type: "text", text: "Creating Plan Execution Book..." }] });
		const input = planExecutionBookInputSchema.parse(params) as PlanExecutionBookToolInput;
		const result = await buildPlanExecutionBookToolResult({
			...input,
			repoPath: input.repoPath || this.session.cwd,
		} as PlanExecutionBookToolInput);
		return {
			content: [{ type: "text", text: `Plan Execution Book ready for ${result.run_id}` }],
			details: result,
		};
	}
}
