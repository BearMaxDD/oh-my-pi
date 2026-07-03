import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { writeSegmentedMarkdownIfNeeded } from "./segmented-write/integration";

export interface SkillLike {
	name: string;
	content?: string;
	filePath?: string;
	path?: string;
}

export interface PlanExecutionBookTaskInput {
	id: string;
	title: string;
	source?: string;
	todo?: string;
	goal?: string;
	executionSkills?: string[];
	reviewSkills?: string[];
	finalTailSkills?: string[];
	acceptance?: string[];
	smokeCommands?: string[];
	requiredEvidence?: string[];
	mustFixConditions?: string[];
	allowedFiles?: string[];
	forbiddenFiles?: string[];
	likelyFiles?: string[];
	existingPatterns?: string[];
	outOfScope?: string[];
	implementationSteps?: string[];
}

export interface PlanExecutionBookIntakeGate {
	gate: string;
	result: "PASS" | "FAIL";
	evidence: string;
}

export interface ProjectReconInput {
	summary?: string;
	relevant_files?: string[];
	risks?: string[];
	repo_path?: string;
	relevant_modules?: string[];
	likely_files?: string[];
	existing_patterns?: string[];
	test_commands: string[];
	build_commands: string[];
	style_conventions?: string[];
	risk_areas?: string[];
	forbidden_changes?: string[];
	task_file_map?: Record<string, string[]>;
}

export interface ProjectRecon {
	repo_path: string;
	relevant_modules: string[];
	likely_files: string[];
	existing_patterns: string[];
	test_commands: string[];
	build_commands: string[];
	style_conventions: string[];
	risk_areas: string[];
	forbidden_changes: string[];
	task_file_map: Record<string, string[]>;
}

export interface CreatePlanExecutionBookOptions {
	runId: string;
	planPath: string;
	planSha256: string;
	repoPath: string;
	acceptingDir: string;
	intakeGate?: PlanExecutionBookIntakeGate[];
	projectRecon?: ProjectReconInput;
	requiredExecutionSkills: string[];
	requiredReviewSkills: string[];
	finalTailSkills: string[];
	finalAcceptanceCommands?: string[];
	tasks: PlanExecutionBookTaskInput[];
	skills?: readonly SkillLike[];
	mode?: "manual" | "autonomous";
	now?: Date;
}

export interface PlanExecutionSkillEvidence {
	name: string;
	source_path: string;
	content_sha256: string;
	loaded_at: string;
	guidance: string;
}

export interface TaskExecutionTddGates {
	red: { command: string; expected: "FAIL"; evidence_required: "RED_EVIDENCE" };
	green: { command: string; expected: "PASS"; evidence_required: "GREEN_EVIDENCE" };
	regression: { command: string; expected: "PASS"; evidence_required: "REGRESSION_EVIDENCE" };
}

export interface TaskExecutionCard {
	id: string;
	title: string;
	source: string;
	todo: string;
	execution_skills: string[];
	review_skills: string[];
	final_tail_skills: string[];
	allowed_files: string[];
	forbidden_files: string[];
	smoke_commands: string[];
	tdd_gates: TaskExecutionTddGates;
	advisor_watch_points: string[];
	required_skill_evidence: string[];
	skill_evidence: {
		execution: PlanExecutionSkillEvidence[];
		review: PlanExecutionSkillEvidence[];
		final_tail: PlanExecutionSkillEvidence[];
	};
	implementation_analysis: string;
	execution_scope: {
		goal: string;
		allowed_files: string[];
		forbidden_files: string[];
		likely_files: string[];
		existing_patterns: string[];
		out_of_scope: string[];
	};
	implementation_steps: string[];
	review_gate: {
		acceptance_criteria: string[];
		smoke_commands: string[];
		required_evidence: string[];
		must_fix_conditions: string[];
	};
}

export interface PlanExecutionBook {
	schema_version: 1;
	run_id: string;
	created_at: string;
	plan: {
		path: string;
		sha256: string;
		repo_path: string;
	};
	accepting_dir: string;
	intake_gate: PlanExecutionBookIntakeGate[];
	project_recon: ProjectRecon;
	required_execution_skills: PlanExecutionSkillEvidence[];
	required_review_skills: PlanExecutionSkillEvidence[];
	final_tail_skills: PlanExecutionSkillEvidence[];
	final_acceptance_commands: string[];
	tasks: TaskExecutionCard[];
}

const DEFAULT_ACCEPTANCE = [
	"Implementation satisfies this task card without expanding scope beyond the Codex plan.",
	"Relevant tests and type checks pass with command evidence.",
];

const DEFAULT_SMOKE_COMMANDS = ["bun test", "bun run check:types"];
const DEFAULT_FINAL_ACCEPTANCE_COMMANDS = ["bun test", "bun run check:types"];

const DEFAULT_REQUIRED_EVIDENCE = [
	"Changed file list for this task",
	"Verification command, exit code, and relevant output summary",
];

const DEFAULT_MUST_FIX_CONDITIONS = [
	"Required execution or review skill evidence is missing.",
	"Acceptance criteria or smoke command evidence is missing.",
	"Implementation changes behavior outside the task card without explicit plan evidence.",
];

const DEFAULT_INTAKE_GATES: readonly PlanExecutionBookIntakeGate[] = [
	{ gate: "plan_path_exists", result: "PASS", evidence: "provided by caller" },
	{ gate: "plan_sha256_matches", result: "PASS", evidence: "provided by caller" },
	{ gate: "repo_path_valid", result: "PASS", evidence: "provided by caller" },
	{ gate: "skills_resolved", result: "PASS", evidence: "all required skills resolved" },
	{ gate: "project_recon_done", result: "PASS", evidence: "project_recon present" },
];

function sha256Text(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

function resolveSkillGate(
	requiredSkillName: string,
	skills: readonly SkillLike[],
	loadedAt: Date,
	allowSyntheticEvidence: boolean,
): Omit<PlanExecutionSkillEvidence, "guidance"> {
	const skill = skills.find(candidate => candidate.name === requiredSkillName);
	if (!skill) {
		if (!allowSyntheticEvidence) {
			throw new Error(`Required skill "${requiredSkillName}" was not loaded`);
		}
		return {
			name: requiredSkillName,
			source_path: `autonomous://skills/${requiredSkillName}`,
			content_sha256: sha256Text(requiredSkillName),
			loaded_at: loadedAt.toISOString(),
		};
	}
	const sourcePath = skill.filePath ?? skill.path;
	if (!skill.content || skill.content.trim().length === 0 || !sourcePath) {
		throw new Error(`Required skill "${requiredSkillName}" is missing load evidence`);
	}
	return {
		name: requiredSkillName,
		source_path: sourcePath,
		content_sha256: sha256Text(skill.content),
		loaded_at: loadedAt.toISOString(),
	};
}

function uniqueNonEmpty(values: readonly string[]): string[] {
	const seen = new Set<string>();
	const result: string[] = [];
	for (const value of values) {
		const trimmed = value.trim();
		if (!trimmed || seen.has(trimmed)) continue;
		seen.add(trimmed);
		result.push(trimmed);
	}
	return result;
}

function flattenMarkdownInline(value: string): string {
	return value
		.replace(/\r\n|\r|\n/g, " ")
		.replace(/\s+/g, " ")
		.trim();
}

function escapeMarkdownInline(value: string): string {
	return flattenMarkdownInline(value).replace(/\|/g, "\\|");
}

function escapeMarkdownTableCell(value: string): string {
	return escapeMarkdownInline(value);
}

function firstUsefulLine(content: string): string {
	const body = content.replace(/^---\n[\s\S]*?\n---\n/, "");
	const line = body
		.split("\n")
		.map(part => part.trim())
		.find(part => part && !part.startsWith("#") && !part.startsWith("---"));
	return line ?? "Use this skill as required evidence for the task.";
}

function resolveSkillEvidence(
	name: string,
	skills: readonly SkillLike[],
	loadedAt: Date,
	allowSyntheticEvidence: boolean,
): PlanExecutionSkillEvidence {
	const gate = resolveSkillGate(name, skills, loadedAt, allowSyntheticEvidence);
	const skill = skills.find(candidate => candidate.name === name);
	return {
		name,
		source_path: gate.source_path,
		content_sha256: gate.content_sha256,
		loaded_at: gate.loaded_at,
		guidance: skill?.content
			? firstUsefulLine(skill.content)
			: "Capture required skill evidence before autonomous task completion.",
	};
}

function resolveManySkills(
	names: readonly string[],
	skills: readonly SkillLike[],
	loadedAt: Date,
	allowSyntheticEvidence: boolean,
): PlanExecutionSkillEvidence[] {
	return uniqueNonEmpty(names).map(name => resolveSkillEvidence(name, skills, loadedAt, allowSyntheticEvidence));
}

function validateTaskInputContracts(
	tasks: readonly PlanExecutionBookTaskInput[],
	mode: CreatePlanExecutionBookOptions["mode"],
): string[] {
	const errors: string[] = [];
	const seenTaskIds = new Set<string>();
	const autonomous = mode === "autonomous";
	for (const task of tasks) {
		const label = task.id?.trim() || "<missing>";
		if (!task.id?.trim()) errors.push("task id is required");
		else if (seenTaskIds.has(task.id)) errors.push(`duplicate task id: ${task.id}`);
		else seenTaskIds.add(task.id);
		if (!task.title?.trim()) errors.push(`task ${label} title is required`);
		if (!autonomous && !task.source?.trim()) errors.push(`task ${label} source is required`);
		if (!autonomous && !task.todo?.trim() && !task.goal?.trim()) errors.push(`task ${label} todo is required`);
		if (!autonomous && (!task.acceptance || uniqueNonEmpty(task.acceptance).length === 0)) {
			errors.push(`task ${label} acceptance is required`);
		}
	}
	return errors;
}

function normalizeProjectRecon(
	input: ProjectReconInput,
	repoPath: string,
	tasks: readonly PlanExecutionBookTaskInput[],
): ProjectRecon {
	const taskFileMap: Record<string, string[]> = { ...(input.task_file_map ?? {}) };
	for (const task of tasks) {
		if (!taskFileMap[task.id]) {
			taskFileMap[task.id] = uniqueNonEmpty(task.allowedFiles ?? task.likelyFiles ?? input.relevant_files ?? []);
		}
	}
	const likelyFiles = uniqueNonEmpty(input.likely_files ?? input.relevant_files ?? Object.values(taskFileMap).flat());
	return {
		repo_path: input.repo_path ?? repoPath,
		relevant_modules: uniqueNonEmpty(input.relevant_modules ?? (input.summary ? [input.summary] : ["project"])),
		likely_files: likelyFiles,
		existing_patterns: uniqueNonEmpty(input.existing_patterns ?? []),
		test_commands: uniqueNonEmpty(input.test_commands),
		build_commands: uniqueNonEmpty(input.build_commands),
		style_conventions: uniqueNonEmpty(input.style_conventions ?? []),
		risk_areas: uniqueNonEmpty(input.risk_areas ?? input.risks ?? []),
		forbidden_changes: uniqueNonEmpty(input.forbidden_changes ?? []),
		task_file_map: taskFileMap,
	};
}

function buildImplementationAnalysis(
	task: PlanExecutionBookTaskInput,
	executionEvidence: readonly PlanExecutionSkillEvidence[],
): string {
	const taskSource = escapeMarkdownInline(task.source ?? task.id);
	const taskObjective = escapeMarkdownInline(task.todo ?? task.goal ?? task.title);
	const skillLines = executionEvidence.map(
		skill => `  - ${escapeMarkdownInline(skill.name)}: ${escapeMarkdownInline(skill.guidance)}`,
	);
	return [
		"- execution skills read:",
		...executionEvidence.map(
			skill => `  - ${escapeMarkdownInline(skill.name)}: ${escapeMarkdownInline(skill.source_path)}`,
		),
		"- relevant guidance extracted:",
		...skillLines,
		"- implementation approach:",
		`  - Start from the Codex plan source "${taskSource}" and satisfy only this task objective: ${taskObjective}`,
		"  - Apply the listed execution skills before changing production code.",
		"  - Keep command evidence traceable for the review packet.",
		"- risks:",
		"  - Scope drift if the task card is treated as a new plan instead of a bounded work order.",
		"  - Weak evidence if required commands are summarized without exit codes and output notes.",
		"- smallest acceptable change:",
		"  - Make the narrowest change that satisfies the original TODO, acceptance criteria, and smoke commands.",
	].join("\n");
}

function createTaskExecutionCard(
	task: PlanExecutionBookTaskInput,
	options: CreatePlanExecutionBookOptions,
	loadedAt: Date,
	projectRecon: ProjectRecon,
): TaskExecutionCard {
	const executionSkills = uniqueNonEmpty(task.executionSkills ?? options.requiredExecutionSkills);
	const reviewSkills = uniqueNonEmpty(task.reviewSkills ?? options.requiredReviewSkills);
	const finalTailSkills = uniqueNonEmpty(task.finalTailSkills ?? options.finalTailSkills);
	const allowSyntheticEvidence = options.mode === "autonomous" && !options.skills;
	const skills = options.skills ?? [];
	const executionEvidence = resolveManySkills(executionSkills, skills, loadedAt, allowSyntheticEvidence);
	const reviewEvidence = resolveManySkills(reviewSkills, skills, loadedAt, allowSyntheticEvidence);
	const finalTailEvidence = resolveManySkills(finalTailSkills, skills, loadedAt, allowSyntheticEvidence);
	const likelyFiles = uniqueNonEmpty(task.likelyFiles ?? projectRecon.task_file_map[task.id] ?? []);
	const allowedFiles = uniqueNonEmpty(task.allowedFiles ?? likelyFiles);
	const forbiddenFiles = uniqueNonEmpty(task.forbiddenFiles ?? projectRecon.forbidden_changes);
	const smokeCommands = uniqueNonEmpty(task.smokeCommands ?? DEFAULT_SMOKE_COMMANDS);
	const existingPatterns = uniqueNonEmpty(task.existingPatterns ?? projectRecon.existing_patterns);
	const firstSmokeCommand = smokeCommands[0] ?? "bun test";
	const tdd_gates: TaskExecutionTddGates = {
		red: { command: firstSmokeCommand, expected: "FAIL", evidence_required: "RED_EVIDENCE" },
		green: { command: firstSmokeCommand, expected: "PASS", evidence_required: "GREEN_EVIDENCE" },
		regression: { command: firstSmokeCommand, expected: "PASS", evidence_required: "REGRESSION_EVIDENCE" },
	};
	const advisorWatchPoints = uniqueNonEmpty([
		"missing_red_evidence",
		"missing_green_evidence",
		"missing_regression_evidence",
		"tdd_order_violation",
		"unresolved_advisor_blocker",
		...projectRecon.risk_areas,
	]);
	const requiredSkillEvidence = uniqueNonEmpty([...executionSkills, ...reviewSkills, ...finalTailSkills]);
	const source = task.source ?? `Autonomous task ${task.id}`;
	const todo = task.todo ?? task.goal ?? task.title;

	return {
		id: task.id,
		title: task.title,
		source,
		todo,
		execution_skills: executionSkills,
		review_skills: reviewSkills,
		final_tail_skills: finalTailSkills,
		allowed_files: allowedFiles,
		forbidden_files: forbiddenFiles,
		smoke_commands: smokeCommands,
		tdd_gates,
		advisor_watch_points: advisorWatchPoints,
		required_skill_evidence: requiredSkillEvidence,
		skill_evidence: {
			execution: executionEvidence,
			review: reviewEvidence,
			final_tail: finalTailEvidence,
		},
		implementation_analysis: buildImplementationAnalysis(task, executionEvidence),
		execution_scope: {
			goal: todo,
			allowed_files: allowedFiles,
			forbidden_files: forbiddenFiles,
			likely_files: likelyFiles,
			existing_patterns: existingPatterns,
			out_of_scope: uniqueNonEmpty(task.outOfScope ?? DEFAULT_MUST_FIX_CONDITIONS.slice(2)),
		},
		implementation_steps: uniqueNonEmpty(
			task.implementationSteps ?? [
				"Read the source plan section and this task card before changing files.",
				"Apply the listed execution skills to make the smallest scoped change.",
				"Run every smoke command and record command evidence before reporting completion.",
			],
		),
		review_gate: {
			acceptance_criteria: uniqueNonEmpty(task.acceptance ?? DEFAULT_ACCEPTANCE),
			smoke_commands: smokeCommands,
			required_evidence: uniqueNonEmpty(task.requiredEvidence ?? DEFAULT_REQUIRED_EVIDENCE),
			must_fix_conditions: uniqueNonEmpty(task.mustFixConditions ?? DEFAULT_MUST_FIX_CONDITIONS),
		},
	};
}

export function createPlanExecutionBook(options: CreatePlanExecutionBookOptions): PlanExecutionBook {
	const now = options.now ?? new Date();
	if (!options.projectRecon) {
		throw new Error("project_recon is required");
	}
	const taskContractErrors = validateTaskInputContracts(options.tasks, options.mode);
	if (taskContractErrors.length > 0) {
		throw new Error(`Invalid PlanExecutionBook task contract: ${taskContractErrors.join("; ")}`);
	}
	const allowSyntheticEvidence = options.mode === "autonomous" && !options.skills;
	const skills = options.skills ?? [];
	const projectRecon = normalizeProjectRecon(options.projectRecon, options.repoPath, options.tasks);
	const requiredExecutionSkills = resolveManySkills(
		options.requiredExecutionSkills,
		skills,
		now,
		allowSyntheticEvidence,
	);
	const requiredReviewSkills = resolveManySkills(options.requiredReviewSkills, skills, now, allowSyntheticEvidence);
	const finalTailSkills = resolveManySkills(options.finalTailSkills, skills, now, allowSyntheticEvidence);
	const finalAcceptanceCommands = uniqueNonEmpty(
		options.finalAcceptanceCommands ?? projectRecon.test_commands.concat(projectRecon.build_commands).slice(0, 3),
	);
	const tasks = options.tasks.map(task => createTaskExecutionCard(task, options, now, projectRecon));
	const book: PlanExecutionBook = {
		schema_version: 1,
		run_id: options.runId,
		created_at: now.toISOString(),
		plan: {
			path: options.planPath,
			sha256: options.planSha256,
			repo_path: options.repoPath,
		},
		accepting_dir: options.acceptingDir,
		intake_gate: [...(options.intakeGate ?? DEFAULT_INTAKE_GATES)],
		project_recon: projectRecon,
		required_execution_skills: requiredExecutionSkills,
		required_review_skills: requiredReviewSkills,
		final_tail_skills: finalTailSkills,
		final_acceptance_commands:
			finalAcceptanceCommands.length > 0 ? finalAcceptanceCommands : [...DEFAULT_FINAL_ACCEPTANCE_COMMANDS],
		tasks,
	};
	const errors = validatePlanExecutionBookGate(book);
	if (errors.length > 0) {
		throw new Error(`Invalid PlanExecutionBook: ${errors.join("; ")}`);
	}
	return book;
}

function pushSkillEvidence(lines: string[], title: string, skills: readonly PlanExecutionSkillEvidence[]): void {
	lines.push(`### ${title}`);
	for (const skill of skills) {
		lines.push(
			`- ${escapeMarkdownInline(skill.name)}: ${escapeMarkdownInline(skill.source_path)} (${escapeMarkdownInline(
				skill.content_sha256,
			)})`,
		);
		lines.push(`  - Guidance: ${escapeMarkdownInline(skill.guidance)}`);
	}
	lines.push("");
}

function pushList(lines: string[], title: string, values: readonly string[]): void {
	lines.push(`#### ${title}`);
	for (const value of values) lines.push(`- ${escapeMarkdownInline(value)}`);
	lines.push("");
}

function pushIndentedList(lines: string[], values: readonly string[], indent = "  "): void {
	for (const value of values) lines.push(`${indent}- ${escapeMarkdownInline(value)}`);
}

function pushTable(lines: string[], headers: readonly string[], rows: readonly string[][]): void {
	lines.push(`| ${headers.map(escapeMarkdownTableCell).join(" | ")} |`);
	lines.push(`| ${headers.map(() => "---").join(" | ")} |`);
	for (const row of rows) lines.push(`| ${row.map(escapeMarkdownTableCell).join(" | ")} |`);
	lines.push("");
}

export function renderPlanExecutionBook(book: PlanExecutionBook): string {
	const lines: string[] = [
		"# OMP Plan Execution Book",
		"",
		"## Source Plan Contract",
		"",
		`- Run ID: ${escapeMarkdownInline(book.run_id)}`,
		`- Created At: ${escapeMarkdownInline(book.created_at)}`,
		`- Plan Path: ${escapeMarkdownInline(book.plan.path)}`,
		`- Plan SHA-256: ${escapeMarkdownInline(book.plan.sha256)}`,
		`- Repo Path: ${escapeMarkdownInline(book.plan.repo_path)}`,
		`- Accepting Dir: ${escapeMarkdownInline(book.accepting_dir)}`,
		"",
		"## Intake Gate Result",
		"",
	];
	pushTable(
		lines,
		["Gate", "Result", "Evidence"],
		book.intake_gate.map(gate => [gate.gate, gate.result, gate.evidence.replace(/\|/g, "\\|")]),
	);
	lines.push("## Skill Binding Matrix", "");
	pushTable(
		lines,
		["Task", "Execution Skills", "Review Skills", "Final Tail Skills"],
		book.tasks.map(task => [
			task.id,
			task.execution_skills.join(", "),
			task.review_skills.join(", "),
			task.final_tail_skills.join(", "),
		]),
	);
	lines.push(
		"## Project Recon",
		"",
		`- repo_path: ${escapeMarkdownInline(book.project_recon.repo_path)}`,
		`- relevant_modules: ${escapeMarkdownInline(book.project_recon.relevant_modules.join(", "))}`,
		`- likely_files: ${escapeMarkdownInline(book.project_recon.likely_files.join(", "))}`,
		`- existing_patterns: ${escapeMarkdownInline(book.project_recon.existing_patterns.join("; "))}`,
		`- test_commands: ${escapeMarkdownInline(book.project_recon.test_commands.join("; "))}`,
		`- build_commands: ${escapeMarkdownInline(book.project_recon.build_commands.join("; "))}`,
		`- style_conventions: ${escapeMarkdownInline(book.project_recon.style_conventions.join("; "))}`,
		`- risk_areas: ${escapeMarkdownInline(book.project_recon.risk_areas.join("; "))}`,
		`- forbidden_changes: ${escapeMarkdownInline(book.project_recon.forbidden_changes.join("; "))}`,
		"",
		"## Skill Evidence",
		"",
	);

	pushSkillEvidence(lines, "Required Execution Skills", book.required_execution_skills);
	pushSkillEvidence(lines, "Required Review Skills", book.required_review_skills);
	pushSkillEvidence(lines, "Final Tail Skills", book.final_tail_skills);

	lines.push("## Final Acceptance Commands", "");
	pushIndentedList(lines, book.final_acceptance_commands, "");
	lines.push("");

	lines.push("## Task Execution Cards", "");
	for (const task of book.tasks) {
		lines.push(`### Task Card: ${escapeMarkdownInline(task.id)} - ${escapeMarkdownInline(task.title)}`);
		lines.push("");
		lines.push("#### Source");
		lines.push(`- Codex plan section: ${escapeMarkdownInline(task.source)}`);
		lines.push(`- Original TODO: ${escapeMarkdownInline(task.todo)}`);
		lines.push(
			`- Original acceptance criteria: ${escapeMarkdownInline(task.review_gate.acceptance_criteria.join("; "))}`,
		);
		lines.push(`- Source lines or anchors: ${escapeMarkdownInline(task.source)}`);
		lines.push("");
		lines.push("#### Skill-Guided Implementation Analysis");
		lines.push(task.implementation_analysis);
		lines.push("");
		lines.push("#### Execution Scope");
		lines.push(`- goal: ${escapeMarkdownInline(task.execution_scope.goal)}`);
		lines.push(`- allowed_files: ${escapeMarkdownInline(task.execution_scope.allowed_files.join(", "))}`);
		lines.push(`- forbidden_files: ${escapeMarkdownInline(task.execution_scope.forbidden_files.join(", "))}`);
		lines.push(`- likely_files: ${escapeMarkdownInline(task.execution_scope.likely_files.join(", "))}`);
		lines.push(`- existing_patterns: ${escapeMarkdownInline(task.execution_scope.existing_patterns.join("; "))}`);
		lines.push(`- out_of_scope: ${escapeMarkdownInline(task.execution_scope.out_of_scope.join("; "))}`);
		lines.push("");
		lines.push("#### TDD Gates");
		pushTable(
			lines,
			["Gate", "Command", "Expected", "Evidence Required"],
			[
				["red", task.tdd_gates.red.command, task.tdd_gates.red.expected, task.tdd_gates.red.evidence_required],
				[
					"green",
					task.tdd_gates.green.command,
					task.tdd_gates.green.expected,
					task.tdd_gates.green.evidence_required,
				],
				[
					"regression",
					task.tdd_gates.regression.command,
					task.tdd_gates.regression.expected,
					task.tdd_gates.regression.evidence_required,
				],
			],
		);
		pushList(lines, "Advisor Watch Points", task.advisor_watch_points);
		pushList(lines, "Required Skill Evidence", task.required_skill_evidence);
		pushList(lines, "Implementation Steps", task.implementation_steps);
		lines.push("#### Skill-Guided Acceptance Criteria");
		lines.push("- review skills read:");
		for (const skill of task.skill_evidence.review) {
			lines.push(`  - ${escapeMarkdownInline(skill.name)}: ${escapeMarkdownInline(skill.source_path)}`);
			lines.push(`    - Guidance: ${escapeMarkdownInline(skill.guidance)}`);
		}
		lines.push("- acceptance checks:");
		pushIndentedList(lines, task.review_gate.acceptance_criteria);
		lines.push("- smoke tests:");
		pushIndentedList(lines, task.review_gate.smoke_commands);
		lines.push("- required commands:");
		pushIndentedList(lines, task.review_gate.smoke_commands);
		lines.push("- evidence format:");
		pushIndentedList(lines, task.review_gate.required_evidence);
		lines.push("- must-fix conditions:");
		pushIndentedList(lines, task.review_gate.must_fix_conditions);
		lines.push("");
		lines.push("#### Evidence Required");
		lines.push("- changed files:");
		lines.push("  - List every changed file for this task.");
		lines.push("- tests run:");
		pushIndentedList(lines, task.review_gate.smoke_commands);
		lines.push("- command outputs:");
		lines.push("  - Record command, exit code, and key output summary.");
		lines.push("- screenshots or artifacts:");
		lines.push("  - Attach task-specific artifacts when applicable; otherwise state none.");
		lines.push("- completion note:");
		lines.push("  - Explain how the result maps back to this task card.");
		lines.push("");
		lines.push("#### Main Thread Review Gate");
		lines.push(`- compare against Codex plan: ${escapeMarkdownInline(task.source)}`);
		lines.push(`- compare against this task card: ${escapeMarkdownInline(task.id)}`);
		lines.push(`- verify command evidence: ${escapeMarkdownInline(task.review_gate.smoke_commands.join("; "))}`);
		lines.push("- verify scope control: no forbidden files and no out-of-scope changes.");
		lines.push("- verify no over-implementation: no unrequested abstraction or unrelated refactor.");
		lines.push("- result: TASK_ACCEPTED or TASK_FIX_REQUIRED");
		lines.push("");
	}

	lines.push(
		"## Review Protocol",
		"",
		"- Compare each task result against the Codex source plan, this task card, review skills, and final tail skills.",
		"- Emit TASK_ACCEPTED only when scope, smoke commands, evidence quality, and over-implementation checks pass.",
		"- Emit TASK_FIX_REQUIRED with OmpFixExecutionTask when any must-fix condition is present.",
		"- Use plan_repair_loop after TASK_FIX_REQUIRED to create a bounded sub-agent repair assignment.",
		"- Start a repair sub-agent only after plan_repair_loop returns next_action=spawn_subagent.",
		"",
		"## MainThreadAcceptanceReview Gate",
		"",
		"- Run main-thread acceptance review after completion doc is written.",
		"- Generate OmpFixExecutionTask for any MAIN_ACCEPTANCE_FIX_REQUIRED result.",
		"- Use plan_repair_loop after MAIN_ACCEPTANCE_FIX_REQUIRED.",
		"- Start a repair sub-agent only after plan_repair_loop returns next_action=spawn_subagent.",
		"- Only re-enter writing-plans when plan_repair_loop returns PLAN_DEFECT_REPLAN_REQUIRED.",
		"- Generate CodexReviewRequestPacket only after MAIN_ACCEPTANCE_ACCEPTED.",
		"",
		"## Completion Evidence Contract",
		"",
		"- omp-completion.md must include MainThreadAcceptanceReview and MainThreadAcceptance Fix Rounds sections.",
		"- Final CodexReviewRequestPacket must include plan_execution_book, task cards, command evidence, main_thread_acceptance, and final_status READY_FOR_CODEX_REVIEW.",
		"- The packet must reference this execution book path and preserve the original plan SHA-256.",
		"",
	);

	return `${lines.join("\n").trimEnd()}\n`;
}

function hasModelRoleLeak(value: string): boolean {
	return /execution_model|review_model|用哪个执行模型|用哪个验收模型/i.test(value);
}

function missingImplementationAnalysisSections(value: string): string[] {
	const required = [
		"execution skills read",
		"relevant guidance extracted",
		"implementation approach",
		"risks",
		"smallest acceptable change",
	];
	return required.filter(section => !value.includes(section));
}

function validateTddGate(
	errors: string[],
	taskId: string,
	name: keyof TaskExecutionTddGates,
	gate: TaskExecutionTddGates[keyof TaskExecutionTddGates] | undefined,
	expected: "FAIL" | "PASS",
	evidenceRequired: "RED_EVIDENCE" | "GREEN_EVIDENCE" | "REGRESSION_EVIDENCE",
): void {
	if (!gate) {
		errors.push(`task ${taskId} tdd_gates.${name} is required`);
		return;
	}
	if (!gate.command?.trim()) errors.push(`task ${taskId} tdd_gates.${name}.command is required`);
	if (gate.expected !== expected) errors.push(`task ${taskId} tdd_gates.${name}.expected must be ${expected}`);
	if (gate.evidence_required !== evidenceRequired) {
		errors.push(`task ${taskId} tdd_gates.${name}.evidence_required must be ${evidenceRequired}`);
	}
}

export function validatePlanExecutionBookGate(book: PlanExecutionBook): string[] {
	const errors: string[] = [];
	if (book.schema_version !== 1) errors.push("schema_version must be 1");
	if (!book.run_id) errors.push("run_id is required");
	if (!book.plan.path) errors.push("plan.path is required");
	if (!book.plan.sha256) errors.push("plan.sha256 is required");
	if (!book.plan.repo_path) errors.push("plan.repo_path is required");
	if (!book.accepting_dir) errors.push("accepting_dir is required");
	if (book.intake_gate.length === 0) errors.push("intake_gate must not be empty");
	if (!book.project_recon) errors.push("project_recon is required");
	else {
		if (!book.project_recon.repo_path) errors.push("project_recon.repo_path is required");
		if (book.project_recon.relevant_modules.length === 0)
			errors.push("project_recon.relevant_modules must not be empty");
		if (book.project_recon.test_commands.length === 0) errors.push("project_recon.test_commands must not be empty");
	}
	if (book.required_execution_skills.length === 0) errors.push("required_execution_skills must not be empty");
	if (book.required_review_skills.length === 0) errors.push("required_review_skills must not be empty");
	if (book.final_tail_skills.length === 0) errors.push("final_tail_skills must not be empty");
	if (book.final_acceptance_commands.length === 0) errors.push("final_acceptance_commands must not be empty");
	if (book.tasks.length === 0) errors.push("tasks must not be empty");

	const seenTaskIds = new Set<string>();
	for (const task of book.tasks) {
		if (seenTaskIds.has(task.id)) errors.push(`duplicate task id: ${task.id}`);
		seenTaskIds.add(task.id);
		if (!task.id) errors.push("task id is required");
		if (!task.title) errors.push(`task ${task.id || "<missing>"} title is required`);
		if (!task.source) errors.push(`task ${task.id || "<missing>"} source is required`);
		if (!task.todo) errors.push(`task ${task.id || "<missing>"} todo is required`);
		if (task.execution_skills.length === 0) errors.push(`task ${task.id} execution_skills must not be empty`);
		if (task.review_skills.length === 0) errors.push(`task ${task.id} review_skills must not be empty`);
		if (task.final_tail_skills.length === 0) errors.push(`task ${task.id} final_tail_skills must not be empty`);
		validateTddGate(errors, task.id, "red", task.tdd_gates?.red, "FAIL", "RED_EVIDENCE");
		validateTddGate(errors, task.id, "green", task.tdd_gates?.green, "PASS", "GREEN_EVIDENCE");
		validateTddGate(errors, task.id, "regression", task.tdd_gates?.regression, "PASS", "REGRESSION_EVIDENCE");
		if (!Array.isArray(task.advisor_watch_points) || task.advisor_watch_points.length === 0) {
			errors.push(`task ${task.id} advisor_watch_points must not be empty`);
		}
		if (!Array.isArray(task.required_skill_evidence) || task.required_skill_evidence.length === 0) {
			errors.push(`task ${task.id} required_skill_evidence must not be empty`);
		} else {
			const requiredSkillEvidence = new Set(uniqueNonEmpty(task.required_skill_evidence));
			for (const skill of uniqueNonEmpty([
				...task.execution_skills,
				...task.review_skills,
				...task.final_tail_skills,
			])) {
				if (!requiredSkillEvidence.has(skill)) {
					errors.push(`task ${task.id} required_skill_evidence must include ${skill}`);
				}
			}
		}
		if (task.skill_evidence.execution.length !== task.execution_skills.length) {
			errors.push(`task ${task.id} execution skill evidence must match execution_skills`);
		}
		if (task.skill_evidence.review.length !== task.review_skills.length) {
			errors.push(`task ${task.id} review skill evidence must match review_skills`);
		}
		if (task.skill_evidence.final_tail.length !== task.final_tail_skills.length) {
			errors.push(`task ${task.id} final tail skill evidence must match final_tail_skills`);
		}
		if (!task.implementation_analysis.trim()) errors.push(`task ${task.id} implementation_analysis is required`);
		else {
			for (const missingSection of missingImplementationAnalysisSections(task.implementation_analysis)) {
				errors.push(`task ${task.id} implementation_analysis must include ${missingSection}`);
			}
		}
		if (task.implementation_steps.length === 0) errors.push(`task ${task.id} implementation_steps must not be empty`);
		if (!task.execution_scope.goal) errors.push(`task ${task.id} execution_scope.goal is required`);
		if (task.review_gate.acceptance_criteria.length === 0) {
			errors.push(`task ${task.id} review_gate.acceptance_criteria must not be empty`);
		}
		if (task.review_gate.smoke_commands.length === 0) {
			errors.push(`task ${task.id} review_gate.smoke_commands must not be empty`);
		}
		if (task.review_gate.required_evidence.length === 0) {
			errors.push(`task ${task.id} review_gate.required_evidence must not be empty`);
		}
		if (task.review_gate.must_fix_conditions.length === 0) {
			errors.push(`task ${task.id} review_gate.must_fix_conditions must not be empty`);
		}
		if (hasModelRoleLeak(JSON.stringify(task))) {
			errors.push(`task ${task.id} must not include execution/review model fields`);
		}
	}

	return errors;
}

export async function writePlanExecutionBook(path: string, book: PlanExecutionBook): Promise<void> {
	const errors = validatePlanExecutionBookGate(book);
	if (errors.length > 0) {
		throw new Error(`Invalid PlanExecutionBook: ${errors.join("; ")}`);
	}
	const content = renderPlanExecutionBook(book);
	await writeSegmentedMarkdownIfNeeded(path, content, { writerRole: "PlanExecutionBookWriter" });
}

export async function readPlanExecutionBookMarkdown(path: string): Promise<{
	content: string;
	sha256: string;
}> {
	const content = await readFile(path, "utf8");
	return {
		content,
		sha256: sha256Text(content),
	};
}
