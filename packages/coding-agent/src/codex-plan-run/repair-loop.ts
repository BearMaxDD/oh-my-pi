import type { PlanExecutionBook } from "./execution-book";
import {
	createOmpFixExecutionTaskFromMainAcceptance,
	type MainAcceptanceOmpFixExecutionTask,
	type MainThreadAcceptanceReviewRequest,
	type MainThreadAcceptanceReviewResult,
} from "./main-acceptance-review";
import { createOmpFixExecutionTask, type OmpFixExecutionTask, type TaskReviewResult } from "./task-review";
import type { PlanRunState } from "./types";

export type PlanRunRepairDecisionKind =
	| "TASK_LOCAL_REPAIR"
	| "MAIN_ACCEPTANCE_REPAIR"
	| "PLAN_DEFECT_REPLAN_REQUIRED"
	| "REPAIR_LOOP_BLOCKED";

export interface PlanRunFailureClassification {
	kind: PlanRunRepairDecisionKind;
	nextState: PlanRunState;
	requiresWritingPlans: boolean;
	reason: string;
}

export interface PlanRunRepairMetadataInput {
	repoPath?: string;
	worktreePath?: string;
	acceptingDir?: string;
	planPath?: string;
	planSha256?: string;
}

export interface ClassifyPlanRunFailureInput {
	book: PlanExecutionBook;
	taskReview?: TaskReviewResult;
	mainAcceptanceReview?: MainThreadAcceptanceReviewResult;
	repairRound: number;
	maxRepairRounds: number;
}

export interface CreatePlanRunRepairDecisionInput extends ClassifyPlanRunFailureInput, PlanRunRepairMetadataInput {
	mainAcceptanceRequest?: MainThreadAcceptanceReviewRequest;
}

export interface PlanRunRepairDecision extends PlanRunFailureClassification {
	book: PlanExecutionBook;
	originalPlanPath: string;
	originalPlanSha256: string;
	repoPath: string;
	worktreePath: string;
	acceptingDir: string;
	repairRound: number;
	maxRepairRounds: number;
	fixTask?: OmpFixExecutionTask | MainAcceptanceOmpFixExecutionTask;
	subagentAssignment: string;
}

export interface RenderRepairRoundMarkdownInput {
	book: PlanExecutionBook;
	decision: PlanRunRepairDecision;
}

function exhaustedRepairRounds(repairRound: number, maxRepairRounds: number): boolean {
	return repairRound >= maxRepairRounds;
}

export function classifyPlanRunFailure(input: ClassifyPlanRunFailureInput): PlanRunFailureClassification {
	if (exhaustedRepairRounds(input.repairRound, input.maxRepairRounds)) {
		return {
			kind: "PLAN_DEFECT_REPLAN_REQUIRED",
			nextState: "main_acceptance_fix_required",
			requiresWritingPlans: true,
			reason: `Reached max repair rounds (${input.repairRound}/${input.maxRepairRounds}); max repair rounds require replanning.`,
		};
	}

	if (input.taskReview?.result === "TASK_FIX_REQUIRED") {
		return {
			kind: "TASK_LOCAL_REPAIR",
			nextState: "fix_tasks_running",
			requiresWritingPlans: false,
			reason: `Task ${input.taskReview.task_id} requires local repair.`,
		};
	}

	if (input.mainAcceptanceReview?.result === "MAIN_ACCEPTANCE_FIX_REQUIRED") {
		return {
			kind: "MAIN_ACCEPTANCE_REPAIR",
			nextState: "fix_tasks_running",
			requiresWritingPlans: false,
			reason: "Main-thread acceptance requires a repair task.",
		};
	}

	return {
		kind: "REPAIR_LOOP_BLOCKED",
		nextState: "main_acceptance_fix_required",
		requiresWritingPlans: false,
		reason: "No repairable PlanRun failure was provided.",
	};
}

function renderTaskLocalAssignment(
	book: PlanExecutionBook,
	review: TaskReviewResult,
	fixTask: OmpFixExecutionTask,
): string {
	const failedCommands = review.must_fix_items.map(item => item.evidence).filter(Boolean);
	return [
		"Sub-Agent Assignment: OmpFixExecutionTask",
		`Run ID: ${book.run_id}`,
		`Task ID: ${review.task_id}`,
		`Failed commands: ${failedCommands.length > 0 ? failedCommands.join("; ") : fixTask.required_commands.join("; ")}`,
		"",
		"```json",
		JSON.stringify(fixTask, null, 2),
		"```",
	].join("\n");
}

function renderMainAcceptanceAssignment(fixTask: MainAcceptanceOmpFixExecutionTask): string {
	const failedCommands = fixTask.fix_tasks.map(task => task.red_command);
	return [
		"Sub-Agent Assignment: OmpFixExecutionTask",
		"Source: MainThreadAcceptanceReview",
		`Failed commands: ${failedCommands.join("; ")}`,
		"",
		"```json",
		JSON.stringify(fixTask, null, 2),
		"```",
	].join("\n");
}

export function createPlanRunRepairDecision(input: CreatePlanRunRepairDecisionInput): PlanRunRepairDecision {
	let classification = classifyPlanRunFailure(input);
	let fixTask: PlanRunRepairDecision["fixTask"];
	let subagentAssignment = classification.reason;
	const originalPlanPath = input.planPath ?? input.book.plan.path;
	const originalPlanSha256 = input.planSha256 ?? input.book.plan.sha256;
	const repoPath = input.repoPath ?? input.book.plan.repo_path;
	const worktreePath = input.worktreePath ?? repoPath;
	const acceptingDir = input.acceptingDir ?? input.book.accepting_dir;

	if (classification.kind === "MAIN_ACCEPTANCE_REPAIR" && !input.mainAcceptanceRequest) {
		classification = {
			kind: "REPAIR_LOOP_BLOCKED",
			nextState: "main_acceptance_fix_required",
			requiresWritingPlans: false,
			reason: "mainAcceptanceRequest is required to create a MainThreadAcceptanceReview OmpFixExecutionTask.",
		};
		subagentAssignment = classification.reason;
	}

	if (classification.kind === "TASK_LOCAL_REPAIR" && input.taskReview) {
		fixTask = createOmpFixExecutionTask(input.taskReview, input.book);
		subagentAssignment = renderTaskLocalAssignment(input.book, input.taskReview, fixTask);
	}

	if (classification.kind === "MAIN_ACCEPTANCE_REPAIR" && input.mainAcceptanceReview && input.mainAcceptanceRequest) {
		fixTask = createOmpFixExecutionTaskFromMainAcceptance(input.mainAcceptanceReview, input.mainAcceptanceRequest);
		subagentAssignment = renderMainAcceptanceAssignment(fixTask);
	}

	return {
		...classification,
		book: input.book,
		originalPlanPath,
		originalPlanSha256,
		repoPath,
		worktreePath,
		acceptingDir,
		repairRound: input.repairRound,
		maxRepairRounds: input.maxRepairRounds,
		fixTask,
		subagentAssignment,
	};
}

export function renderRepairRoundMarkdown({ decision }: RenderRepairRoundMarkdownInput): string {
	return [
		`# PlanRun Repair Round ${decision.repairRound}`,
		"",
		"## Original Plan",
		`original_plan_path: ${decision.originalPlanPath}`,
		`original_plan_sha256: ${decision.originalPlanSha256}`,
		`repo_path: ${decision.repoPath}`,
		`worktree_path: ${decision.worktreePath}`,
		`accepting_dir: ${decision.acceptingDir}`,
		"",
		"## Classification",
		`- Kind: ${decision.kind}`,
		`- Next state: ${decision.nextState}`,
		`- Requires writing-plans: ${decision.requiresWritingPlans ? "true" : "false"}`,
		`- Reason: ${decision.reason}`,
		"",
		"## Sub-Agent Assignment",
		decision.subagentAssignment,
		"",
	].join("\n");
}
