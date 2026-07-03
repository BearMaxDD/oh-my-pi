import type { AdvisorSummary } from "./advisor-summary";
import { collectUnresolvedAdvisorBlockers } from "./advisor-summary";
import type { PlanExecutionBook } from "./execution-book";
import type { SkillEvidenceMatrix } from "./skill-evidence";
import { validateRequiredSkillEvidence } from "./skill-evidence";
import type { StageManifestEntry } from "./stage-ledger";
import type { TaskReviewResult } from "./task-review";
import type { TddEvidenceMatrix } from "./tdd-evidence";
import { validateTddEvidenceMatrix } from "./tdd-evidence";

export type MainThreadAcceptanceMustFixCategory =
	| "protocol"
	| "task_status"
	| "verification"
	| "evidence"
	| "scope"
	| "skill"
	| "packet";

export interface VerificationCommandResult {
	command: string;
	exit_code: number;
	cwd: string;
	started_at: string;
	completed_at: string;
	output_excerpt: string;
	evidence_path?: string;
}

export interface TaskExecutionOutput {
	task_id: string;
	result: "completed" | "failed" | "aborted";
	subagent_id: string;
	summary: string;
	files_changed: string[];
	commands_run: VerificationCommandResult[];
	evidence_files: string[];
	review_skills_used: string[];
	final_tail_skills_used: string[];
}

export interface GitDiffSummary {
	changed_files: string[];
	forbidden_files_changed: string[];
}

export interface TodoSnapshot {
	runId: string;
	version: number;
	state: string;
	updatedAt: string;
	source: string;
	phases: Array<{
		name: string;
		tasks: Array<{
			content: string;
			status: "pending" | "in_progress" | "completed" | "abandoned" | "blocked";
		}>;
	}>;
}

export interface CodexReviewRequestPacket {
	main_thread_acceptance?: {
		result?: string;
	};
}

export interface CodebaseMemoryProjectStatus {
	indexed: boolean;
	project: string;
	rootPath: string;
	nodeCount?: number;
	edgeCount?: number;
	stale?: boolean;
}

export interface CodebaseMemoryArchitecture {
	relevantModules?: string[];
	existingPatterns?: string[];
	riskAreas?: string[];
	summary?: string;
}

export interface CodebaseMemorySymbolHit {
	name: string;
	qualifiedName?: string;
	file?: string;
}

export interface CodebaseMemoryGraphNode {
	id?: string;
	label: string;
	name: string;
	qualified_name?: string;
	file_path?: string;
	start_line?: number;
	end_line?: number;
	is_test?: boolean;
}

export interface CodebaseMemoryGraphEdge {
	type: string;
	source: string;
	target: string;
	confidence?: number;
	via?: string;
	url_path?: string;
}

export interface CodebaseMemoryTracePath {
	mode?: "calls" | "data_flow" | "cross_service";
	direction?: "inbound" | "outbound" | "both";
	start: string;
	end?: string;
	edge_types?: string[];
	risk?: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
}

export interface CodebaseMemoryGraphSlice {
	seed_files: string[];
	seed_symbols: string[];
	nodes: CodebaseMemoryGraphNode[];
	edges: CodebaseMemoryGraphEdge[];
	trace_paths: CodebaseMemoryTracePath[];
	edge_types: string[];
	risk_nodes: string[];
}

export interface CodebaseMemoryTaskContext {
	taskId: string;
	files: string[];
	symbols: CodebaseMemorySymbolHit[];
	patterns: string[];
	risks: string[];
	graph?: Partial<CodebaseMemoryGraphSlice>;
}

export interface CodebaseMemoryAcceptanceFinding {
	id: string;
	severity: "must_fix" | "advisory" | "info";
	category?: string;
	description: string;
	evidence: string;
	requiredFix: string;
	affectedTasks?: string[];
	authorizedFiles?: string[];
	requiredCommands?: string[];
}

export interface CodebaseMemoryAcceptanceRecon {
	findings: CodebaseMemoryAcceptanceFinding[];
	evidencePath?: string;
}

export interface CodebaseMemoryReconProvider {
	getProjectStatus(input: { repoPath: string }): Promise<CodebaseMemoryProjectStatus>;
	getArchitecture(input: { project: string; repoPath: string }): Promise<CodebaseMemoryArchitecture>;
	searchTaskContext(input: {
		project: string;
		repoPath: string;
		task: PlanExecutionBook["tasks"][number];
	}): Promise<CodebaseMemoryTaskContext>;
	reviewAcceptance?(input: {
		project: string;
		repoPath: string;
		executionBook: PlanExecutionBook;
		changedFiles: string[];
		taskOutputs: TaskExecutionOutput[];
		taskReviewRecords: TaskReviewResult[];
	}): Promise<CodebaseMemoryAcceptanceRecon>;
}

export interface CodebaseMemoryReconOptions {
	enabled: boolean;
	provider?: CodebaseMemoryReconProvider;
}

export interface MainThreadAcceptanceReviewRequest {
	runId: string;
	reviewRound: number;
	repoPath: string;
	worktreePath: string;
	planPath: string;
	planSha256: string;
	acceptingDir: string;
	executionBookPath: string;
	manifestPath: string;
	completionDocPath: string;
	todoSnapshot: TodoSnapshot;
	executionBook: PlanExecutionBook;
	taskOutputs: TaskExecutionOutput[];
	taskReviewRecords: TaskReviewResult[];
	verificationCommands: VerificationCommandResult[];
	finalAcceptanceCommands: string[];
	packetDraft?: CodexReviewRequestPacket;
	gitDiffSummary?: GitDiffSummary;
	codebaseMemory?: CodebaseMemoryReconOptions;
	tddEvidenceMatrix?: TddEvidenceMatrix;
	skillEvidenceMatrix?: SkillEvidenceMatrix;
	advisorSummary?: AdvisorSummary;
	manifestExtensions?: {
		codebase_memory?: {
			execution_recon?: string;
			reindex_summary?: string;
			tasks?: Record<string, { status?: string; jsonPath?: string; degraded_reason?: string | null }>;
		};
		advisor?: { subagents_enabled: boolean; summary?: string };
		model_routing?: {
			tasks?: Record<string, { resolved_model?: string | null; model_role?: string | null; evidence_path?: string }>;
		};
		superpowers?: { codebase_memory_gate_mode?: "off" | "advisory" | "required" };
		settings?: {
			execution_loop: {
				runtimeScenario?: {
					browser: { enabled: boolean };
					api: { enabled: boolean };
					database: { enabled: boolean };
				};
				classification?: {
					enabled: boolean;
					requireReviewerEvidence: boolean;
				};
			};
		};
		role_bound_execution?: {
			enabled: boolean;
			role_registry_snapshot_path?: string;
			role_registry_snapshot_sha256?: string;
			spec_task_framework_path?: string;
			spec_task_framework_sha256?: string;
			actual_spec_task_framework_sha256?: string;
			stages?: Record<string, StageManifestEntry>;
			classification_summary?: {
				tasks: Record<
					string,
					{
						runtime_surface: string;
						requires_frontend_design: boolean;
						requires_security_review: boolean;
						requires_payment_review: boolean;
						requires_data_migration_review: boolean;
						requires_destructive_operation_review: boolean;
						evidence_paths: string[];
					}
				>;
				specialized_reviews?: Array<{ type?: string; evidence_paths?: string[] }>;
			};
			classification_summary_json?: string;
		};
		prompt_packs?: {
			generated: boolean;
			prompt_pack_paths: string[];
		};
		advisor_gate?: {
			enabled: boolean;
			records_path?: string;
			blocking_findings?: number;
		};
		global_impact?: {
			enabled: boolean;
			report_path?: string;
			status?: "accepted" | "repair_required" | "blocked";
		};
		real_business_simulation?: {
			enabled: boolean;
			environment_plan_path?: string;
			scenario_plan_path?: string;
			report_path?: string;
			cleanup_report_path?: string;
			status?: "passed" | "repair_required" | "blocked";
			runtimeScenario?: {
				browser: { enabled: boolean };
				api: { enabled: boolean };
				database: { enabled: boolean };
			};
		};
	};
}

export interface MainThreadAcceptanceMustFixItem {
	id: string;
	category: MainThreadAcceptanceMustFixCategory;
	severity: "must_fix";
	description: string;
	evidence: string;
	required_fix: string;
	affected_tasks: string[];
	required_commands: string[];
	authorized_files: string[];
}

export interface MainThreadAcceptanceAcceptedResult {
	result: "MAIN_ACCEPTANCE_ACCEPTED";
	review_round: number;
	must_fix_items: [];
	accepted_at: string;
	evidence: string[];
	next_allowed: "CodexReviewRequestPacket";
}

export interface MainThreadAcceptanceFixRequiredResult {
	result: "MAIN_ACCEPTANCE_FIX_REQUIRED";
	review_round: number;
	must_fix_items: MainThreadAcceptanceMustFixItem[];
	next_task: "OmpFixExecutionTask";
}

export type MainThreadAcceptanceReviewResult =
	| MainThreadAcceptanceAcceptedResult
	| MainThreadAcceptanceFixRequiredResult;

export interface MainAcceptanceOmpFixExecutionTask {
	packet_type: "OmpFixExecutionTask";
	packet_version: 1;
	source: "MainThreadAcceptanceReview";
	original_plan_path: string;
	original_plan_sha256: string;
	repo_path: string;
	omp_worktree: string;
	accepting_dir: string;
	feedback_round: number;
	main_review_round: number;
	must_fix_items: MainThreadAcceptanceMustFixItem[];
	authorized_scope: {
		allowed_files: string[];
		forbidden_files: string[];
	};
	fix_tasks: Array<{
		id: string;
		source_must_fix_id: string;
		title: string;
		red_command: string;
		red_expected: string;
		green_command: string;
		regression_command: string;
		evidence_required: string[];
	}>;
}

export interface MainAcceptanceCompletionCommand {
	command: string;
	exit_code: number;
}

export interface MainAcceptanceCompletionFixRound {
	round: number;
	result: "FIX_REQUIRED" | "ACCEPTED";
	must_fix_count: number;
	fix_task: string;
	regression: "PASS" | "FAIL" | "-";
}

export interface RenderMainThreadAcceptanceCompletionOptions {
	result: MainThreadAcceptanceReviewResult;
	evidencePath: string;
	finalAcceptanceCommands: readonly MainAcceptanceCompletionCommand[];
	fixRounds: readonly MainAcceptanceCompletionFixRound[];
}

const STALE_FINAL_EVIDENCE_PATTERN =
	/\b(copied from|copied command output|placeholder pass|placeholder evidence|fake verification|cached result|prior run|not rerun|previous attempt|previous round|old PASS|inherited from|stale command output)\b/i;

function unique(values: readonly string[]): string[] {
	return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function allAllowedFiles(book: PlanExecutionBook): string[] {
	return unique(book.tasks.flatMap(task => task.execution_scope.allowed_files));
}

function allForbiddenFiles(book: PlanExecutionBook): string[] {
	return unique([
		...book.project_recon.forbidden_changes,
		...book.tasks.flatMap(task => task.execution_scope.forbidden_files),
	]);
}

function finalCommands(request: MainThreadAcceptanceReviewRequest): string[] {
	return unique(
		request.finalAcceptanceCommands.length > 0
			? request.finalAcceptanceCommands
			: request.executionBook.final_acceptance_commands,
	);
}

function addMustFix(
	items: MainThreadAcceptanceMustFixItem[],
	request: MainThreadAcceptanceReviewRequest,
	input: {
		id: string;
		category: MainThreadAcceptanceMustFixCategory;
		description: string;
		evidence: string;
		required_fix: string;
		affected_tasks?: string[];
		required_commands?: string[];
		authorized_files?: string[];
	},
): void {
	const duplicateCount = items.filter(
		candidate => candidate.id === input.id || candidate.id.startsWith(`${input.id}_`),
	).length;
	items.push({
		id: duplicateCount === 0 ? input.id : `${input.id}_${duplicateCount + 1}`,
		category: input.category,
		severity: "must_fix",
		description: input.description,
		evidence: input.evidence,
		required_fix: input.required_fix,
		affected_tasks: input.affected_tasks ?? request.executionBook.tasks.map(task => task.id),
		required_commands: input.required_commands ?? finalCommands(request),
		authorized_files: input.authorized_files ?? allAllowedFiles(request.executionBook),
	});
}

function commandEvidenceByCommand(
	commands: readonly VerificationCommandResult[],
): Map<string, VerificationCommandResult> {
	return new Map(commands.map(command => [command.command, command]));
}

function hasStaleEvidence(command: VerificationCommandResult): boolean {
	return STALE_FINAL_EVIDENCE_PATTERN.test(command.output_excerpt);
}

function todoHasPendingRequired(snapshot: TodoSnapshot): boolean {
	return snapshot.phases.some(phase =>
		phase.tasks.some(task => task.status === "pending" || task.status === "in_progress"),
	);
}

function mainAcceptanceCategory(category: string | undefined): MainThreadAcceptanceMustFixCategory {
	const allowed: readonly MainThreadAcceptanceMustFixCategory[] = [
		"protocol",
		"task_status",
		"verification",
		"evidence",
		"scope",
		"skill",
		"packet",
	];
	return allowed.includes(category as MainThreadAcceptanceMustFixCategory)
		? (category as MainThreadAcceptanceMustFixCategory)
		: "scope";
}

function changedFilesForAcceptance(request: MainThreadAcceptanceReviewRequest): string[] {
	return unique([
		...(request.gitDiffSummary?.changed_files ?? []),
		...request.taskOutputs.flatMap(output => output.files_changed),
	]);
}

async function runCodebaseMemoryAcceptanceRecon(
	request: MainThreadAcceptanceReviewRequest,
	provider: CodebaseMemoryReconProvider,
	now: Date,
): Promise<CodebaseMemoryAcceptanceRecon> {
	const projectStatus = await provider.getProjectStatus({ repoPath: request.repoPath });
	const architecture = await provider.getArchitecture({ project: projectStatus.project, repoPath: request.repoPath });
	const taskContexts = await Promise.all(
		request.executionBook.tasks.map(task =>
			provider.searchTaskContext({ project: projectStatus.project, repoPath: request.repoPath, task }),
		),
	);
	void taskContexts;
	void architecture;
	void now;
	return provider.reviewAcceptance
		? provider.reviewAcceptance({
				project: projectStatus.project,
				repoPath: request.repoPath,
				executionBook: request.executionBook,
				changedFiles: changedFilesForAcceptance(request),
				taskOutputs: request.taskOutputs,
				taskReviewRecords: request.taskReviewRecords,
			})
		: { findings: [] };
}

function addMissingArtifact(
	mustFixItems: MainThreadAcceptanceMustFixItem[],
	request: MainThreadAcceptanceReviewRequest,
	input: { id: string; description: string; evidence: string; required_fix: string },
): void {
	addMustFix(mustFixItems, request, {
		id: input.id,
		category: "evidence",
		description: input.description,
		evidence: input.evidence,
		required_fix: input.required_fix,
	});
}

function taskForFinding(
	request: MainThreadAcceptanceReviewRequest,
	taskId: string,
): PlanExecutionBook["tasks"][number] | undefined {
	return request.executionBook.tasks.find(task => task.id === taskId);
}

function skillFindingId(taskId: string, skill: string, source: string): string {
	return `skill_evidence_missing_${slugId(taskId)}_${slugId(skill)}_${slugId(source)}`;
}

function slugId(value: string): string {
	return (
		value
			.trim()
			.replace(/[^A-Za-z0-9]+/g, "_")
			.replace(/^_+|_+$/g, "")
			.toLowerCase() || "unknown"
	);
}

function addTddEvidenceFindings(
	mustFixItems: MainThreadAcceptanceMustFixItem[],
	request: MainThreadAcceptanceReviewRequest,
): void {
	if (!request.tddEvidenceMatrix) {
		addMissingArtifact(mustFixItems, request, {
			id: "tdd_evidence_matrix_missing",
			description: "Main acceptance requires a TDD evidence matrix artifact.",
			evidence: "tddEvidenceMatrix: <missing>",
			required_fix: "Attach the task RED, GREEN, and REGRESSION evidence matrix before final acceptance.",
		});
		return;
	}
	const matrix = {
		tasks: Object.fromEntries(
			request.executionBook.tasks.map(task => [task.id, request.tddEvidenceMatrix?.tasks[task.id] ?? []]),
		),
	};
	for (const finding of validateTddEvidenceMatrix(matrix)) {
		const task = taskForFinding(request, finding.task_id);
		addMustFix(mustFixItems, request, {
			id: finding.reason.replace("blocked_", ""),
			category: "evidence",
			description: finding.message,
			evidence: finding.task_id,
			required_fix: "Re-run the task with fresh RED, GREEN, and REGRESSION TDD evidence.",
			affected_tasks: [finding.task_id],
			required_commands: task?.review_gate.smoke_commands ?? finalCommands(request),
			authorized_files: task?.execution_scope.allowed_files ?? allAllowedFiles(request.executionBook),
		});
	}
}

function addSkillEvidenceFindings(
	mustFixItems: MainThreadAcceptanceMustFixItem[],
	request: MainThreadAcceptanceReviewRequest,
): void {
	if (!request.skillEvidenceMatrix) {
		addMissingArtifact(mustFixItems, request, {
			id: "skill_evidence_matrix_missing",
			description: "Main acceptance requires a skill evidence matrix artifact.",
			evidence: "skillEvidenceMatrix: <missing>",
			required_fix:
				"Attach skill load, task-card declaration, and subagent-output evidence before final acceptance.",
		});
		return;
	}
	for (const task of request.executionBook.tasks) {
		for (const missing of validateRequiredSkillEvidence(
			request.skillEvidenceMatrix,
			task.id,
			task.required_skill_evidence,
		)) {
			addMustFix(mustFixItems, request, {
				id: skillFindingId(task.id, missing.skill, missing.missing_source),
				category: "skill",
				description: `Missing ${missing.missing_source} for ${missing.skill}`,
				evidence: JSON.stringify(missing),
				required_fix:
					"Attach skill load, task-card declaration, and subagent-output skill evidence before acceptance.",
				affected_tasks: [task.id],
				required_commands: task.review_gate.smoke_commands,
				authorized_files: task.execution_scope.allowed_files,
			});
		}
	}
}

function addAdvisorBlockerFindings(
	mustFixItems: MainThreadAcceptanceMustFixItem[],
	request: MainThreadAcceptanceReviewRequest,
): void {
	if (!request.advisorSummary) {
		addMissingArtifact(mustFixItems, request, {
			id: "advisor_summary_missing",
			description: "Main acceptance requires an advisor summary artifact.",
			evidence: "advisorSummary: <missing>",
			required_fix: "Attach advisor summary evidence proving blockers are resolved or suppressed.",
		});
		return;
	}
	for (const blocker of collectUnresolvedAdvisorBlockers(request.advisorSummary)) {
		addMustFix(mustFixItems, request, {
			id: "advisor_blocker_unresolved",
			category: "evidence",
			description: "Advisor blocker must be resolved before main-thread acceptance.",
			evidence: blocker.message,
			required_fix: "Resolve or explicitly suppress the advisor blocker with review evidence.",
		});
	}
}

/*
 * Acceptance evidence gates are intentionally separate from the migrated 16.1.7
 * protocol gates. They make missing autonomous-run artifacts fail closed.
 */
export async function runMainThreadAcceptanceReview(
	request: MainThreadAcceptanceReviewRequest,
	now = new Date(),
): Promise<MainThreadAcceptanceReviewResult> {
	const mustFixItems: MainThreadAcceptanceMustFixItem[] = [];
	const allowedFiles = allAllowedFiles(request.executionBook);
	let codebaseMemoryAcceptanceRecon: CodebaseMemoryAcceptanceRecon | undefined;

	if (request.codebaseMemory?.enabled) {
		if (!request.codebaseMemory.provider) {
			addMustFix(mustFixItems, request, {
				id: "MF-CODEBASE-MEMORY-PROVIDER",
				category: "evidence",
				description: "Codebase Memory acceptance recon is enabled but no provider was supplied.",
				evidence: "codebaseMemory.provider: <missing>",
				required_fix: "Bind the Codebase Memory provider before main-thread acceptance.",
			});
		} else {
			try {
				codebaseMemoryAcceptanceRecon = await runCodebaseMemoryAcceptanceRecon(
					request,
					request.codebaseMemory.provider,
					now,
				);
				for (const finding of codebaseMemoryAcceptanceRecon.findings.filter(
					candidate => candidate.severity === "must_fix",
				)) {
					addMustFix(mustFixItems, request, {
						id: `MF-${finding.id}`,
						category: mainAcceptanceCategory(finding.category),
						description: finding.description,
						evidence: finding.evidence,
						required_fix: finding.requiredFix,
						affected_tasks: finding.affectedTasks,
						required_commands: finding.requiredCommands,
						authorized_files: finding.authorizedFiles,
					});
				}
			} catch (error) {
				addMustFix(mustFixItems, request, {
					id: "MF-CODEBASE-MEMORY-RECON",
					category: "evidence",
					description: "Codebase Memory acceptance recon could not be completed.",
					evidence: error instanceof Error ? error.message : String(error),
					required_fix: "Refresh or bind the Codebase Memory index before terminal acceptance.",
				});
			}
		}
	}

	if (request.planSha256 !== request.executionBook.plan.sha256) {
		addMustFix(mustFixItems, request, {
			id: "MF-PROTOCOL-PLAN-SHA",
			category: "protocol",
			description: "Plan SHA-256 does not match the Plan Execution Book.",
			evidence: JSON.stringify({ request: request.planSha256, book: request.executionBook.plan.sha256 }),
			required_fix: "Use the exact original plan and SHA-256 before generating packet evidence.",
		});
	}

	if (!request.executionBookPath || !request.manifestPath || !request.completionDocPath) {
		addMustFix(mustFixItems, request, {
			id: "MF-PROTOCOL-PATHS",
			category: "protocol",
			description: "Execution book, manifest, and completion doc paths are required.",
			evidence: JSON.stringify({
				executionBookPath: request.executionBookPath,
				manifestPath: request.manifestPath,
				completionDocPath: request.completionDocPath,
			}),
			required_fix: "Write all required acceptance artifacts before main-thread acceptance.",
		});
	}

	if (request.executionBook.tasks.length === 0) {
		addMustFix(mustFixItems, request, {
			id: "MF-PROTOCOL-NO-TASKS",
			category: "protocol",
			description: "Plan Execution Book must contain at least one task.",
			evidence: "tasks: []",
			required_fix: "Compile the Codex plan into task cards before terminal acceptance.",
			affected_tasks: [],
		});
	}

	if (todoHasPendingRequired(request.todoSnapshot)) {
		addMustFix(mustFixItems, request, {
			id: "MF-TASK-TODOS-PENDING",
			category: "task_status",
			description: "Todo snapshot still has pending or in-progress required work.",
			evidence: JSON.stringify(request.todoSnapshot.phases),
			required_fix: "Complete all execution tasks before terminal acceptance.",
		});
	}

	if (
		request.todoSnapshot.phases.some(phase =>
			phase.tasks.some(task => task.status === "blocked" || task.status === "abandoned"),
		)
	) {
		addMustFix(mustFixItems, request, {
			id: "MF-TASKLIST-NONTERMINAL-ROLE-BOUND",
			category: "task_status",
			description: "Todo snapshot has blocked or abandoned tasks preventing final acceptance.",
			evidence: JSON.stringify(request.todoSnapshot.phases),
			required_fix: "Resolve blocked or abandoned tasks before terminal acceptance.",
		});
	}

	for (const task of request.executionBook.tasks) {
		const output = request.taskOutputs.find(candidate => candidate.task_id === task.id);
		if (output?.result !== "completed") {
			addMustFix(mustFixItems, request, {
				id: `MF-TASK-OUTPUT-${task.id}`,
				category: "task_status",
				description: "Every task must have a completed subagent output.",
				evidence: JSON.stringify(output ?? null),
				required_fix: "Produce completed TaskExecutionOutput evidence for the task.",
				affected_tasks: [task.id],
				required_commands: task.review_gate.smoke_commands,
				authorized_files: task.execution_scope.allowed_files,
			});
			continue;
		}
		if (output.review_skills_used.length === 0 || output.final_tail_skills_used.length === 0) {
			addMustFix(mustFixItems, request, {
				id: `MF-SKILL-${task.id}`,
				category: "skill",
				description: "Task output must prove review and final-tail skills were used.",
				evidence: JSON.stringify({
					review_skills_used: output.review_skills_used,
					final_tail_skills_used: output.final_tail_skills_used,
				}),
				required_fix: "Re-run the task review with required skill evidence.",
				affected_tasks: [task.id],
				required_commands: task.review_gate.smoke_commands,
				authorized_files: task.execution_scope.allowed_files,
			});
		}
	}

	for (const task of request.executionBook.tasks) {
		const review = request.taskReviewRecords.find(candidate => candidate.task_id === task.id);
		if (review?.result !== "TASK_ACCEPTED") {
			addMustFix(mustFixItems, request, {
				id: `MF-EVIDENCE-TASK-REVIEW-${task.id}`,
				category: "evidence",
				description: "Every task requires a TASK_ACCEPTED review record or fix history.",
				evidence: JSON.stringify(review ?? null),
				required_fix: "Create accepted task review evidence before terminal acceptance.",
				affected_tasks: [task.id],
				required_commands: task.review_gate.smoke_commands,
				authorized_files: task.execution_scope.allowed_files,
			});
		}
	}

	const reindexTasks = request.manifestExtensions?.codebase_memory?.tasks ?? {};
	const modelRoutingTasks = request.manifestExtensions?.model_routing?.tasks ?? {};
	for (const task of request.executionBook.tasks) {
		const reindex = reindexTasks[task.id];
		if (!reindex?.jsonPath || (reindex.status !== "ready" && reindex.status !== "degraded")) {
			addMustFix(mustFixItems, request, {
				id: `MF-CODEBASE-MEMORY-REINDEX-${task.id}`,
				category: "evidence",
				description: "Every completed task must include ready or degraded Codebase Memory reindex evidence.",
				evidence: JSON.stringify(reindex ?? null),
				required_fix:
					"Write task codebase-memory-reindex.json and refresh codebase-memory-reindex-summary.json before terminal acceptance.",
				affected_tasks: [task.id],
				required_commands: task.review_gate.smoke_commands,
				authorized_files: task.execution_scope.allowed_files,
			});
		}

		const modelRouting = modelRoutingTasks[task.id];
		if (!modelRouting?.resolved_model || !modelRouting.evidence_path) {
			addMustFix(mustFixItems, request, {
				id: `MF-MODEL-ROUTING-${task.id}`,
				category: "evidence",
				description: "Every role-bound task must include resolved model routing evidence.",
				evidence: JSON.stringify(modelRouting ?? null),
				required_fix:
					"Write task model-routing-evidence.json and manifest model_routing.tasks before terminal acceptance.",
				affected_tasks: [task.id],
				required_commands: task.review_gate.smoke_commands,
				authorized_files: task.execution_scope.allowed_files,
			});
		}
	}

	if (!request.manifestExtensions?.advisor?.summary) {
		addMustFix(mustFixItems, request, {
			id: "MF-ADVISOR-SUMMARY",
			category: "evidence",
			description: "PlanRun advisor summary evidence is required before terminal acceptance.",
			evidence: JSON.stringify(request.manifestExtensions?.advisor ?? null),
			required_fix: "Write advisor-summary.json before terminal acceptance.",
		});
	}

	if (!request.manifestExtensions?.superpowers?.codebase_memory_gate_mode) {
		addMustFix(mustFixItems, request, {
			id: "MF-SUPERPOWERS-CODEBASE-MEMORY-GATE",
			category: "evidence",
			description: "Superpowers Codebase Memory gate mode must be recorded before terminal acceptance.",
			evidence: JSON.stringify(request.manifestExtensions?.superpowers ?? null),
			required_fix: "Record superpowers.codebase_memory_gate_mode in manifest evidence.",
		});
	}

	// --- Task 9 evidence hard gates (role-bound execution subsystem) ---

	const roleBoundExec = request.manifestExtensions?.role_bound_execution;
	if (roleBoundExec?.enabled && !roleBoundExec.spec_task_framework_path) {
		addMustFix(mustFixItems, request, {
			id: "MF-MISSING-SPEC-TASK-FRAMEWORK",
			category: "evidence",
			description: "Role-bound execution is enabled but spec task framework path is missing.",
			evidence: JSON.stringify(roleBoundExec),
			required_fix: "Write spec-task-framework.json before terminal acceptance.",
		});
	}

	const roleBound = request.manifestExtensions?.role_bound_execution;
	if (roleBound?.enabled) {
		if (!roleBound.spec_task_framework_sha256) {
			addMustFix(mustFixItems, request, {
				id: "MF-MISSING-SPEC-TASK-FRAMEWORK-SHA",
				category: "evidence",
				description: "Role-bound framework sha256 is required.",
				evidence: JSON.stringify(roleBound),
				required_fix: "Record spec_task_framework_sha256 beside spec_task_framework_path.",
			});
		}

		if (
			roleBound.spec_task_framework_path &&
			roleBound.spec_task_framework_sha256 &&
			!roleBound.actual_spec_task_framework_sha256
		) {
			addMustFix(mustFixItems, request, {
				id: "MF-MISSING-SPEC-TASK-FRAMEWORK-ACTUAL-SHA",
				category: "evidence",
				description: "Actual role-bound framework sha256 is required for acceptance.",
				evidence: JSON.stringify(roleBound),
				required_fix: "Record actual_spec_task_framework_sha256 from the persisted spec-task-framework artifact.",
			});
		}

		if (
			roleBound.actual_spec_task_framework_sha256 &&
			roleBound.actual_spec_task_framework_sha256 !== roleBound.spec_task_framework_sha256
		) {
			addMustFix(mustFixItems, request, {
				id: "MF-SPEC-TASK-FRAMEWORK-SHA-MISMATCH",
				category: "evidence",
				description: "Role-bound framework sha256 does not match the recorded manifest value.",
				evidence: JSON.stringify({
					expected: roleBound.spec_task_framework_sha256,
					actual: roleBound.actual_spec_task_framework_sha256,
				}),
				required_fix: "Regenerate spec-task-framework evidence and manifest hash in the same run.",
			});
		}

		for (const task of request.executionBook.tasks) {
			for (const stageId of [
				"tdd-writer",
				"implementer",
				"test-runner",
				"spec-reviewer",
				"quality-reviewer",
				"acceptance",
			]) {
				const key = `${task.id}:${stageId}`;
				const stage = roleBound.stages?.[key];
				const advisorGatePaths = stage?.advisor_gate_paths;
				const advisorGateEnabled = request.manifestExtensions?.advisor_gate?.enabled === true;
				let missingAdvisorPaths = false;
				if (advisorGateEnabled) {
					missingAdvisorPaths = !Array.isArray(advisorGatePaths) || advisorGatePaths.length === 0;
				}
				if (
					!stage?.output_path ||
					!stage.model_routing_path ||
					missingAdvisorPaths ||
					stage.status !== "accepted"
				) {
					addMustFix(mustFixItems, request, {
						id: "MF-MISSING-ROLE-BOUND-STAGE",
						category: "evidence",
						description: `Role-bound stage ${key} is missing accepted evidence.`,
						evidence: JSON.stringify(stage === undefined ? null : stage),
						required_fix: `Rerun role-bound stage ${key} and record output, model routing, advisor gates, and accepted status.`,
					});
				}
			}
		}

		// Check for missing productized entry evidence (e.g. role_registry_snapshot_path)
		if (!roleBound.role_registry_snapshot_path) {
			addMustFix(mustFixItems, request, {
				id: "MF-MISSING-PLAN-RUN-ENTRY-EVIDENCE",
				category: "evidence",
				description:
					"Role-bound execution is enabled but productized entry evidence is missing (role_registry_snapshot_path).",
				evidence: JSON.stringify(roleBound),
				required_fix: "Write role-registry-snapshot.json before terminal acceptance.",
			});
		}

		// Check for specialized review items with missing evidence paths
		if (roleBound.classification_summary) {
			try {
				const parsed =
					typeof roleBound.classification_summary === "string"
						? JSON.parse(roleBound.classification_summary)
						: roleBound.classification_summary;
				if (
					parsed &&
					Array.isArray(parsed.specialized_reviews) &&
					parsed.specialized_reviews.some(
						(item: { type?: string; evidence_paths?: string[] }) =>
							Array.isArray(item.evidence_paths) && item.evidence_paths.length === 0,
					)
				) {
					addMustFix(mustFixItems, request, {
						id: "MF-MISSING-SPECIALIZED-REVIEW-EVIDENCE",
						category: "evidence",
						description: "Classification summary specifies specialized reviews with empty evidence paths.",
						evidence: JSON.stringify(parsed),
						required_fix: "Populate evidence_paths for all specialized review items.",
					});
				}
			} catch {
				// If classification_summary can't be parsed, skip the check silently.
			}
		}
	}

	const promptPacks = request.manifestExtensions?.prompt_packs;
	if (roleBoundExec?.enabled && (!promptPacks?.generated || promptPacks.prompt_pack_paths.length === 0)) {
		addMustFix(mustFixItems, request, {
			id: "MF-MISSING-PROMPT-PACK",
			category: "evidence",
			description: "Every role-bound stage requires prompt pack evidence.",
			evidence: JSON.stringify(promptPacks),
			required_fix: "Generate prompt-packs/<stage>.json for each task stage.",
		});
	}

	const advisorGate = request.manifestExtensions?.advisor_gate;
	if (
		advisorGate?.enabled &&
		(!advisorGate.records_path ||
			typeof advisorGate.blocking_findings !== "number" ||
			advisorGate.blocking_findings > 0)
	) {
		addMustFix(mustFixItems, request, {
			id: "MF-MISSING-ADVISOR-GATE",
			category: "evidence",
			description: "Advisor gate records must exist and contain no blocking findings.",
			evidence: JSON.stringify(advisorGate),
			required_fix: "Resolve advisor gate must-fix findings and write advisor gate records.",
		});
	}

	const globalImpact = request.manifestExtensions?.global_impact;
	if (globalImpact?.enabled && !globalImpact.report_path) {
		addMustFix(mustFixItems, request, {
			id: "MF-MISSING-GLOBAL-IMPACT-REPORT",
			category: "evidence",
			description: "Global Impact Report is required before runtime simulation.",
			evidence: JSON.stringify(globalImpact),
			required_fix: "Write global-impact-report.json and .md.",
		});
	}
	if (globalImpact?.enabled && globalImpact.status !== "accepted") {
		addMustFix(mustFixItems, request, {
			id: "MF-GLOBAL-IMPACT-REPAIR-REQUIRED",
			category: "evidence",
			description: "Global Impact Gate must be accepted before final acceptance.",
			evidence: JSON.stringify(globalImpact),
			required_fix: "Fix global impact findings and rerun linked tests.",
		});
	}

	const realBizSim = request.manifestExtensions?.real_business_simulation;
	if (
		realBizSim?.enabled &&
		(!realBizSim.environment_plan_path || !realBizSim.scenario_plan_path || !realBizSim.report_path)
	) {
		addMustFix(mustFixItems, request, {
			id: "MF-MISSING-REAL-RUNTIME-SIMULATION-REPORT",
			category: "evidence",
			description: "Runtime environment plan, scenarios, and real runtime simulation report are required.",
			evidence: JSON.stringify(realBizSim),
			required_fix: "Run real business simulation and write all runtime artifacts.",
		});
	}
	if (realBizSim?.enabled && realBizSim.status !== "passed") {
		addMustFix(mustFixItems, request, {
			id: "MF-REAL-RUNTIME-SIMULATION-FAILED",
			category: "verification",
			description: "Real Runtime Simulation must pass before final acceptance.",
			evidence: JSON.stringify(realBizSim),
			required_fix: "Fix runtime simulation failures and rerun the scenario.",
		});
	}
	if (realBizSim?.enabled && !realBizSim.cleanup_report_path) {
		addMustFix(mustFixItems, request, {
			id: "MF-MISSING-RUNTIME-CLEANUP-REPORT",
			category: "evidence",
			description: "Runtime cleanup report is required before final acceptance.",
			evidence: JSON.stringify(realBizSim),
			required_fix: "Write runtime-cleanup-report.md with cleanup status and residual resources.",
		});
	}

	const requiredFinalCommands = finalCommands(request);
	if (requiredFinalCommands.length === 0) {
		addMustFix(mustFixItems, request, {
			id: "MF-VERIFY-NO-FINAL-COMMANDS",
			category: "verification",
			description: "Final acceptance commands are required and cannot be inferred as empty.",
			evidence: "finalAcceptanceCommands: []",
			required_fix: "Provide final acceptance commands or explicit exemption evidence.",
			required_commands: [],
		});
	} else {
		const byCommand = commandEvidenceByCommand(request.verificationCommands);
		for (const command of requiredFinalCommands) {
			const evidence = byCommand.get(command);
			if (evidence?.exit_code !== 0 || !evidence.output_excerpt.trim()) {
				addMustFix(mustFixItems, request, {
					id: `MF-VERIFY-${command.replace(/\W+/g, "-").replace(/^-|-$/g, "").toUpperCase()}`,
					category: "verification",
					description: "Final acceptance command is missing, failed, or lacks output evidence.",
					evidence: JSON.stringify(evidence ?? { command, exit_code: null }),
					required_fix: "Run the final acceptance command successfully before packet generation.",
					required_commands: [command],
				});
			} else if (hasStaleEvidence(evidence)) {
				addMustFix(mustFixItems, request, {
					id: `MF-EVIDENCE-STALE-${command.replace(/\W+/g, "-").replace(/^-|-$/g, "").toUpperCase()}`,
					category: "evidence",
					description: "Final acceptance command evidence appears stale or placeholder-like.",
					evidence: evidence.output_excerpt,
					required_fix: "Replace stale evidence with fresh command output and exit code.",
					required_commands: [command],
				});
			}
		}
	}

	const forbiddenFilesChanged = unique(request.gitDiffSummary?.forbidden_files_changed ?? []);
	if (forbiddenFilesChanged.length > 0) {
		addMustFix(mustFixItems, request, {
			id: "MF-SCOPE-FORBIDDEN-FILES",
			category: "scope",
			description: "Git diff includes files outside the authorized task scope.",
			evidence: forbiddenFilesChanged.join(", "),
			required_fix: "Remove or justify forbidden file changes before terminal acceptance.",
			authorized_files: allowedFiles,
		});
	}

	addTddEvidenceFindings(mustFixItems, request);
	addSkillEvidenceFindings(mustFixItems, request);
	addAdvisorBlockerFindings(mustFixItems, request);

	if (request.packetDraft) {
		const acceptance = request.packetDraft.main_thread_acceptance;
		if (acceptance?.result !== "MAIN_ACCEPTANCE_ACCEPTED") {
			addMustFix(mustFixItems, request, {
				id: "MF-PACKET-MAIN-ACCEPTANCE",
				category: "packet",
				description: "Packet draft must reference MAIN_ACCEPTANCE_ACCEPTED evidence.",
				evidence: JSON.stringify(acceptance ?? null),
				required_fix: "Regenerate packet after main-thread acceptance is accepted.",
			});
		}
	}

	if (mustFixItems.length > 0) {
		return {
			result: "MAIN_ACCEPTANCE_FIX_REQUIRED",
			review_round: request.reviewRound,
			must_fix_items: mustFixItems,
			next_task: "OmpFixExecutionTask",
		};
	}

	return {
		result: "MAIN_ACCEPTANCE_ACCEPTED",
		review_round: request.reviewRound,
		must_fix_items: [],
		accepted_at: now.toISOString(),
		evidence: [
			"Plan SHA-256 matched",
			"All task outputs completed",
			"Task review records accepted",
			"Final acceptance commands passed",
			...(codebaseMemoryAcceptanceRecon?.evidencePath
				? [`Codebase Memory acceptance recon: ${codebaseMemoryAcceptanceRecon.evidencePath}`]
				: []),
		],
		next_allowed: "CodexReviewRequestPacket",
	};
}

export function createOmpFixExecutionTaskFromMainAcceptance(
	review: MainThreadAcceptanceReviewResult,
	request: MainThreadAcceptanceReviewRequest,
): MainAcceptanceOmpFixExecutionTask {
	if (review.result !== "MAIN_ACCEPTANCE_FIX_REQUIRED" || review.must_fix_items.length === 0) {
		throw new Error("OmpFixExecutionTask requires MAIN_ACCEPTANCE_FIX_REQUIRED with must-fix items");
	}
	const defaultCommand = finalCommands(request)[0] ?? "bun test";
	return {
		packet_type: "OmpFixExecutionTask",
		packet_version: 1,
		source: "MainThreadAcceptanceReview",
		original_plan_path: request.planPath,
		original_plan_sha256: request.planSha256,
		repo_path: request.repoPath,
		omp_worktree: request.worktreePath,
		accepting_dir: request.acceptingDir,
		feedback_round: request.reviewRound,
		main_review_round: review.review_round,
		must_fix_items: review.must_fix_items,
		authorized_scope: {
			allowed_files: allAllowedFiles(request.executionBook),
			forbidden_files: allForbiddenFiles(request.executionBook),
		},
		fix_tasks: review.must_fix_items.map(item => {
			const command = item.required_commands[0] ?? defaultCommand;
			return {
				id: `FIX-${item.id}`,
				source_must_fix_id: item.id,
				title: item.required_fix,
				red_command: command,
				red_expected: item.evidence,
				green_command: command,
				regression_command: finalCommands(request).find(candidate => candidate !== command) ?? command,
				evidence_required: ["FIX_RED_EVIDENCE", "FIX_GREEN_EVIDENCE", "REGRESSION_EVIDENCE"],
			};
		}),
	};
}

export function renderMainThreadAcceptanceCompletionSections({
	result,
	evidencePath,
	finalAcceptanceCommands,
	fixRounds,
}: RenderMainThreadAcceptanceCompletionOptions): string {
	const commandLines =
		finalAcceptanceCommands.length > 0
			? finalAcceptanceCommands.map(command => {
					const status = command.exit_code === 0 ? "PASS" : "FAIL";
					return `  - ${command.command} -> ${status}`;
				})
			: ["  - <missing> -> FAIL"];
	const rows =
		fixRounds.length > 0
			? fixRounds.map(round =>
					[
						String(round.round),
						round.result,
						String(round.must_fix_count),
						round.fix_task || "-",
						round.regression,
					].join(" | "),
				)
			: ["1 | ACCEPTED | 0 | - | PASS"];
	return [
		"## MainThreadAcceptanceReview",
		"",
		`- result: ${result.result}`,
		`- review_round: ${result.review_round}`,
		`- evidence: ${evidencePath}`,
		"- final_acceptance_commands:",
		...commandLines,
		"",
		"## MainThreadAcceptance Fix Rounds",
		"",
		`must_fix_count: ${result.must_fix_items.length}`,
		"",
		"| round | result | must_fix_count | fix_task | regression |",
		"| --- | --- | ---: | --- | --- |",
		...rows.map(row => `| ${row} |`),
		"",
	].join("\n");
}
