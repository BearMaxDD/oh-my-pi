import type { AdvisorFinding } from "./advisor-findings";
import { filterAdvisorBlockers } from "./advisor-findings";
import {
	type CodebaseMemoryTaskReindexEvidence,
	validateCodebaseMemoryReindexForTaskReview,
} from "./codebase-memory-reindex";
import type { PlanExecutionBook, TaskExecutionCard } from "./execution-book";
import { type SkillEvidenceMatrix, validateRequiredSkillEvidence } from "./skill-evidence";
import { type TddEvidenceMatrix, validateTddEvidenceMatrix } from "./tdd-evidence";

export interface TaskCommandEvidence {
	command: string;
	exit_code: number | null;
	evidence: string;
}

export interface SubagentTaskOutput {
	task_id: string;
	changed_files: string[];
	tests_run: string[];
	evidence: string[];
	execution_skills_used: string[];
	final_tail_skills_used: string[];
	scope_notes: string[];
	result: "completed" | "blocked";
}

export interface TaskReviewRequest {
	book: PlanExecutionBook;
	taskId: string;
	tddEvidenceMatrix?: TddEvidenceMatrix;
	skillEvidenceMatrix?: SkillEvidenceMatrix;
	changedFiles: string[];
	advisorFindings?: AdvisorFinding[];
	codebaseMemoryReindex?: CodebaseMemoryTaskReindexEvidence;
	commands: TaskCommandEvidence[];
	subagentOutput: SubagentTaskOutput;
}

export interface TaskReviewMustFixItem {
	id: string;
	description: string;
	evidence: string;
}

export interface TaskReviewResult {
	task_id: string;
	review_skills_used: string[];
	final_tail_skills_used: string[];
	plan_compliance: "PASS" | "FAIL";
	scope_control: "PASS" | "FAIL";
	smoke_tests: "PASS" | "FAIL";
	evidence_quality: "PASS" | "FAIL";
	over_implementation_check: "PASS" | "FAIL";
	result: "TASK_ACCEPTED" | "TASK_FIX_REQUIRED";
	must_fix_items: TaskReviewMustFixItem[];
}

export interface OmpFixExecutionTask {
	source_task_id: string;
	failure_reason: string;
	must_fix_items: TaskReviewMustFixItem[];
	required_execution_skills: string[];
	required_review_skills: string[];
	final_tail_skills: string[];
	required_commands: string[];
	evidence_required: string[];
}

function findTask(book: PlanExecutionBook, taskId: string): TaskExecutionCard {
	const task = book.tasks.find(candidate => candidate.id === taskId);
	if (!task) throw new Error(`Task ${taskId} not found in PlanExecutionBook`);
	return task;
}

function includesAll(required: readonly string[], actual: readonly string[]): boolean {
	const actualSet = new Set(actual);
	return required.every(item => actualSet.has(item));
}

function changedForbiddenFile(task: TaskExecutionCard, changedFiles: readonly string[]): string | undefined {
	const forbidden = new Set(task.execution_scope.forbidden_files);
	return changedFiles.find(file => forbidden.has(file));
}

function failedRequiredCommand(task: TaskExecutionCard, commands: readonly TaskCommandEvidence[]): string | undefined {
	const commandByText = new Map(commands.map(command => [command.command, command]));
	return task.review_gate.smoke_commands.find(command => {
		const evidence = commandByText.get(command);
		return evidence === undefined || evidence.exit_code !== 0 || !evidence.evidence.trim();
	});
}

function addMustFix(items: TaskReviewMustFixItem[], item: TaskReviewMustFixItem): void {
	const duplicateCount = items.filter(
		candidate => candidate.id === item.id || candidate.id.startsWith(`${item.id}_`),
	).length;
	items.push({
		...item,
		id: duplicateCount === 0 ? item.id : `${item.id}_${duplicateCount + 1}`,
	});
}

function addTaskTddFindings(
	mustFixItems: TaskReviewMustFixItem[],
	request: TaskReviewRequest,
	tddEvidenceMatrix: TddEvidenceMatrix | undefined,
): void {
	if (!tddEvidenceMatrix) {
		addMustFix(mustFixItems, {
			id: "tdd_evidence_matrix_missing",
			description: "Task review requires a TDD evidence matrix.",
			evidence: request.taskId,
		});
		return;
	}

	const matrix = {
		tasks: {
			...tddEvidenceMatrix.tasks,
			[request.taskId]: tddEvidenceMatrix.tasks[request.taskId] ?? [],
		},
	};
	for (const finding of validateTddEvidenceMatrix(matrix).filter(item => item.task_id === request.taskId)) {
		addMustFix(mustFixItems, {
			id: finding.reason.replace("blocked_", ""),
			description: finding.message,
			evidence: request.taskId,
		});
	}
}

function addTaskSkillFindings(
	mustFixItems: TaskReviewMustFixItem[],
	request: TaskReviewRequest,
	task: TaskExecutionCard,
	skillEvidenceMatrix: SkillEvidenceMatrix | undefined,
): void {
	if (!skillEvidenceMatrix) {
		addMustFix(mustFixItems, {
			id: "skill_evidence_matrix_missing",
			description: "Task review requires a skill evidence matrix.",
			evidence: request.taskId,
		});
		return;
	}

	for (const missing of validateRequiredSkillEvidence(
		skillEvidenceMatrix,
		request.taskId,
		task.required_skill_evidence,
	)) {
		addMustFix(mustFixItems, {
			id: "skill_evidence_missing",
			description: `Missing ${missing.missing_source} for ${missing.skill}`,
			evidence: JSON.stringify(missing),
		});
	}
}
function addAdvisorBlockerFindings(mustFixItems: TaskReviewMustFixItem[], request: TaskReviewRequest): void {
	if (!request.advisorFindings || request.advisorFindings.length === 0) return;

	for (const finding of filterAdvisorBlockers(request.advisorFindings)) {
		if (finding.task_id === request.taskId) {
			addMustFix(mustFixItems, {
				id: `advisor_blocker_${finding.category}`,
				description: finding.required_action ?? finding.finding,
				evidence: finding.evidence,
			});
		}
	}
}

export function reviewTaskExecution(request: TaskReviewRequest): TaskReviewResult {
	const task = findTask(request.book, request.taskId);
	const mustFixItems: TaskReviewMustFixItem[] = [];

	addTaskTddFindings(mustFixItems, request, request.tddEvidenceMatrix);
	addTaskSkillFindings(mustFixItems, request, task, request.skillEvidenceMatrix);
	const reindexError = request.codebaseMemoryReindex
		? request.codebaseMemoryReindex.task_id !== request.taskId
			? `Codebase Memory reindex evidence task_id ${request.codebaseMemoryReindex.task_id} does not match reviewed task ${request.taskId}`
			: validateCodebaseMemoryReindexForTaskReview(request.codebaseMemoryReindex)
		: "Codebase Memory reindex evidence is required for task review";
	if (reindexError) {
		addMustFix(mustFixItems, {
			id: request.codebaseMemoryReindex ? "codebase_memory_reindex_failed" : "codebase_memory_reindex_missing",
			description: "Codebase Memory reindex evidence is failed or invalid.",
			evidence: reindexError,
		});
	}
	addAdvisorBlockerFindings(mustFixItems, request);

	if (request.subagentOutput.task_id !== request.taskId || request.subagentOutput.result !== "completed") {
		addMustFix(mustFixItems, {
			id: "subagent_result_invalid",
			description: "Subagent output must identify the task and finish as completed.",
			evidence: JSON.stringify({ task_id: request.subagentOutput.task_id, result: request.subagentOutput.result }),
		});
	}

	const forbiddenFile = changedForbiddenFile(task, request.changedFiles);
	if (forbiddenFile) {
		addMustFix(mustFixItems, {
			id: "forbidden_files_changed",
			description: "Changed files include a forbidden file from the task card.",
			evidence: forbiddenFile,
		});
	}

	const failedCommand = failedRequiredCommand(task, request.commands);
	if (failedCommand) {
		addMustFix(mustFixItems, {
			id: "required_command_failed",
			description: "A required smoke command is missing, failed, or has no evidence.",
			evidence: failedCommand,
		});
	}

	if (!includesAll(task.execution_skills, request.subagentOutput.execution_skills_used)) {
		addMustFix(mustFixItems, {
			id: "execution_skills_missing",
			description: "Subagent output does not prove all execution skills were used.",
			evidence: task.execution_skills.join(", "),
		});
	}

	if (!includesAll(task.final_tail_skills, request.subagentOutput.final_tail_skills_used)) {
		addMustFix(mustFixItems, {
			id: "final_tail_skills_missing",
			description: "Subagent output does not prove all final tail skills were used.",
			evidence: task.final_tail_skills.join(", "),
		});
	}

	if (request.subagentOutput.evidence.length === 0 || request.subagentOutput.tests_run.length === 0) {
		addMustFix(mustFixItems, {
			id: "evidence_missing",
			description: "Subagent output must include tests_run and evidence.",
			evidence: JSON.stringify({
				tests_run: request.subagentOutput.tests_run,
				evidence: request.subagentOutput.evidence,
			}),
		});
	}

	if (request.subagentOutput.changed_files.length === 0) {
		addMustFix(mustFixItems, {
			id: "changed_files_missing",
			description: "Subagent output must include changed_files for the task evidence contract.",
			evidence: JSON.stringify(request.subagentOutput.changed_files),
		});
	}

	if (request.subagentOutput.scope_notes.length === 0) {
		addMustFix(mustFixItems, {
			id: "scope_notes_missing",
			description: "Subagent output must include scope_notes that explain boundary control.",
			evidence: JSON.stringify(request.subagentOutput.scope_notes),
		});
	}

	const scopeControl = forbiddenFile ? "FAIL" : "PASS";
	const smokeTests = failedCommand ? "FAIL" : "PASS";
	const evidenceQuality = mustFixItems.some(
		item =>
			item.id.endsWith("_missing") ||
			item.id === "evidence_missing" ||
			item.id.endsWith("_evidence") ||
			item.id === "stale_evidence" ||
			item.id === "tdd_order_violation" ||
			item.id.startsWith("advisor_blocker_") ||
			item.id.startsWith("codebase_memory_reindex_"),
	)
		? "FAIL"
		: "PASS";
	const planCompliance = request.subagentOutput.task_id === request.taskId ? "PASS" : "FAIL";
	const overImplementationCheck = forbiddenFile ? "FAIL" : "PASS";

	return {
		task_id: request.taskId,
		review_skills_used: task.review_skills,
		final_tail_skills_used: task.final_tail_skills,
		plan_compliance: planCompliance,
		scope_control: scopeControl,
		smoke_tests: smokeTests,
		evidence_quality: evidenceQuality,
		over_implementation_check: overImplementationCheck,
		result:
			planCompliance === "PASS" &&
			scopeControl === "PASS" &&
			smokeTests === "PASS" &&
			evidenceQuality === "PASS" &&
			overImplementationCheck === "PASS" &&
			mustFixItems.length === 0
				? "TASK_ACCEPTED"
				: "TASK_FIX_REQUIRED",
		must_fix_items: mustFixItems,
	};
}

export function createOmpFixExecutionTask(review: TaskReviewResult, book: PlanExecutionBook): OmpFixExecutionTask {
	const task = findTask(book, review.task_id);
	if (review.must_fix_items.length === 0) {
		throw new Error("OmpFixExecutionTask requires at least one must-fix item");
	}
	return {
		source_task_id: review.task_id,
		failure_reason: review.must_fix_items.map(item => item.description).join("; "),
		must_fix_items: review.must_fix_items,
		required_execution_skills: task.execution_skills,
		required_review_skills: task.review_skills,
		final_tail_skills: task.final_tail_skills,
		required_commands: task.review_gate.smoke_commands,
		evidence_required: task.review_gate.required_evidence,
	};
}
