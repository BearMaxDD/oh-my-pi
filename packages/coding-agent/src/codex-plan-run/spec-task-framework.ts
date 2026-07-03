import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PlanExecutionBook, TaskExecutionCard } from "./execution-book";

export type SpecTaskStageStatus = "pending" | "running" | "submitted" | "accepted" | "repair_required" | "blocked";
export type SourceDocumentType = "prd" | "trd" | "plan" | "tdd" | "manual";

export type RuntimeSurface = "none" | "cli" | "browser" | "api" | "database" | "mixed";

export type SpecTaskClassificationName =
	| "requires_frontend_design"
	| "requires_security_review"
	| "requires_payment_review"
	| "requires_data_migration_review"
	| "requires_destructive_operation_review"
	| "runtime_surface";

export interface SpecTaskClassificationSignal {
	source: "path" | "text" | "acceptance" | "codebase-memory";
	value: string;
	classification: SpecTaskClassificationName;
}

export interface SpecTaskClassification {
	requires_frontend_design: boolean;
	requires_security_review: boolean;
	requires_payment_review: boolean;
	requires_data_migration_review: boolean;
	requires_destructive_operation_review: boolean;
	runtime_surface: RuntimeSurface;
	signals: SpecTaskClassificationSignal[];
}

export function emptySpecTaskClassification(): SpecTaskClassification {
	return {
		requires_frontend_design: false,
		requires_security_review: false,
		requires_payment_review: false,
		requires_data_migration_review: false,
		requires_destructive_operation_review: false,
		runtime_surface: "none",
		signals: [],
	};
}

export interface SpecTaskFramework {
	schema_version: "superpowers.spec_task_framework.v1";
	run_id: string;
	generated_at: string;
	source_documents: SourceDocumentRef[];
	role_registry_version: string;
	tasks: SpecTask[];
	global_gates: GlobalGateSpec[];
}

export interface SourceDocumentRef {
	type: SourceDocumentType;
	path: string;
	sha256: string;
}

export interface SpecTask {
	id: string;
	title_zh: string;
	intent: string;
	acceptance_criteria: string[];
	allowed_paths: string[];
	forbidden_paths: string[];
	expected_changed_paths?: string[];
	dependency_task_ids: string[];
	affected_capabilities: string[];
	business_paths: BusinessPathRef[];
	classification: SpecTaskClassification;
	stages: SpecTaskStage[];
}

export interface BusinessPathRef {
	id: string;
	title_zh: string;
	user_story: string;
	runtime_required: boolean;
	suggested_environment: "local" | "docker" | "sandbox" | "staging";
}

export interface SpecTaskStage {
	id: string;
	role_id: string;
	title_zh: string;
	status: SpecTaskStageStatus;
	assigned_model?: string;
	required_evidence: EvidenceRequirement[];
	output_schema_ref: string;
}

export interface EvidenceRequirement {
	id: string;
	title_zh: string;
	artifact_path: string;
	required: boolean;
}

export interface GlobalGateSpec {
	id: "global-impact" | "real-business-simulation";
	title_zh: string;
	role_id: string;
	required_evidence: EvidenceRequirement[];
	status: SpecTaskStageStatus;
}

export interface BuildSpecTaskFrameworkOptions {
	executionBook: PlanExecutionBook;
	sourceDocuments: SourceDocumentRef[];
	roleRegistryVersion?: string;
	now?: Date;
	classification?: {
		enabled?: boolean;
		requireReviewerEvidence?: boolean;
	};
}

const ROLE_REGISTRY_VERSION = "superpowers.role_registry.v1";

const STAGE_TEMPLATES: ReadonlyArray<Omit<SpecTaskStage, "status">> = [
	{
		id: "tdd-writer",
		role_id: "superpowers:tdd-writer",
		title_zh: "编写失败测试",
		output_schema_ref: "superpowers.stage_output.tdd_writer.v1",
		required_evidence: [
			{ id: "red-evidence", title_zh: "Red 测试证据", artifact_path: "red-evidence.md", required: true },
		],
	},
	{
		id: "implementer",
		role_id: "superpowers:implementer",
		title_zh: "实现最小生产代码",
		output_schema_ref: "superpowers.stage_output.implementer.v1",
		required_evidence: [
			{
				id: "implementation-summary",
				title_zh: "实现摘要",
				artifact_path: "implementation-summary.md",
				required: true,
			},
		],
	},
	{
		id: "test-runner",
		role_id: "superpowers:test-runner",
		title_zh: "独立运行测试与 smoke",
		output_schema_ref: "superpowers.stage_output.test_runner.v1",
		required_evidence: [
			{ id: "green-evidence", title_zh: "Green 测试证据", artifact_path: "green-evidence.md", required: true },
		],
	},
	{
		id: "spec-reviewer",
		role_id: "superpowers:spec-reviewer",
		title_zh: "规格合规审查",
		output_schema_ref: "superpowers.stage_output.spec_reviewer.v1",
		required_evidence: [
			{ id: "spec-review", title_zh: "规格审查记录", artifact_path: "spec-review.md", required: true },
		],
	},
	{
		id: "quality-reviewer",
		role_id: "superpowers:quality-reviewer",
		title_zh: "代码质量审查",
		output_schema_ref: "superpowers.stage_output.quality_reviewer.v1",
		required_evidence: [
			{ id: "quality-review", title_zh: "质量审查记录", artifact_path: "quality-review.md", required: true },
		],
	},
	{
		id: "acceptance",
		role_id: "superpowers:acceptance",
		title_zh: "任务级验收",
		output_schema_ref: "superpowers.stage_output.acceptance.v1",
		required_evidence: [
			{ id: "task-acceptance", title_zh: "任务验收记录", artifact_path: "task-acceptance.md", required: true },
		],
	},
];

function stageForTask(taskId: string, template: Omit<SpecTaskStage, "status">): SpecTaskStage {
	return {
		...template,
		status: "pending",
		required_evidence: template.required_evidence.map(evidence => ({
			...evidence,
			artifact_path: `tasks/${taskId}/${evidence.artifact_path}`,
		})),
	};
}

function businessPathForTask(task: PlanExecutionBook["tasks"][number]): BusinessPathRef {
	return {
		id: `${task.id}-primary`,
		title_zh: `${task.id} 真实业务路径`,
		user_story: task.execution_scope.goal || task.title,
		runtime_required: true,
		suggested_environment: "local",
	};
}

const ROLE_DISPLAY_LABELS: Record<string, string> = {
	"superpowers:tdd-writer": "TDD Writer",
	"superpowers:implementer": "Implementer",
	"superpowers:test-runner": "Test Runner",
	"superpowers:spec-reviewer": "Spec Reviewer",
	"superpowers:quality-reviewer": "Quality Reviewer",
	"superpowers:acceptance": "Acceptance",
};

function roleDisplayLabel(roleId: string): string {
	return ROLE_DISPLAY_LABELS[roleId] ?? roleId;
}

function affectedCapabilities(task: PlanExecutionBook["tasks"][number]): string[] {
	const fromScope = task.execution_scope.likely_files
		.map(file => file.replace(/^src\//, "").split("/")[0])
		.filter(Boolean);
	return Array.from(new Set([task.id, ...fromScope]));
}

const CLASSIFICATION_CHECKS: Array<{
	classification:
		| "requires_frontend_design"
		| "requires_security_review"
		| "requires_payment_review"
		| "requires_data_migration_review"
		| "requires_destructive_operation_review";
	pattern: RegExp;
}> = [
	{
		classification: "requires_frontend_design",
		pattern: /src\/modes\/components|frontend|ui|browser|react|vue|css|tailwind/i,
	},
	{ classification: "requires_security_review", pattern: /auth|token|secret|permission|sandbox|credential|headers/i },
	{ classification: "requires_payment_review", pattern: /stripe|billing|invoice|payment|checkout/i },
	{ classification: "requires_data_migration_review", pattern: /migration|schema|database|sql|prisma/i },
	{ classification: "requires_destructive_operation_review", pattern: /delete|remove|drop|truncate|force/i },
];

const RUNTIME_SURFACE_CHECKS: Array<{
	surface: RuntimeSurface;
	pattern: RegExp;
}> = [
	{ surface: "browser", pattern: /src\/modes\/components|frontend|ui|browser|react|vue|tailwind|css|login|page/i },
	{ surface: "api", pattern: /api|endpoint|rest|graphql|server/i },
	{ surface: "database", pattern: /database|sql|schema|prisma|migration/i },
	{ surface: "cli", pattern: /cli|command|terminal|shell/i },
];

export function classifySpecTask(task: TaskExecutionCard): SpecTaskClassification {
	// Collect all text sources for classification
	const sources: Array<{ source: "path" | "text" | "acceptance"; value: string }> = [];
	const pathSet = new Set<string>();
	const textSet = new Set<string>();

	// Paths (allow dedup)
	for (const p of task.allowed_files) {
		if (p && !pathSet.has(p)) {
			pathSet.add(p);
			sources.push({ source: "path", value: p });
		}
	}
	for (const p of task.execution_scope.allowed_files) {
		if (p && !pathSet.has(p)) {
			pathSet.add(p);
			sources.push({ source: "path", value: p });
		}
	}
	for (const p of task.execution_scope.likely_files) {
		if (p && !pathSet.has(p)) {
			pathSet.add(p);
			sources.push({ source: "path", value: p });
		}
	}

	// Text fields (allow dedup)
	const textFields = [
		task.title,
		task.todo,
		task.execution_scope.goal,
		task.implementation_analysis,
		...task.implementation_steps,
	];
	for (const t of textFields) {
		if (t && !textSet.has(t)) {
			textSet.add(t);
			sources.push({ source: "text", value: t });
		}
	}

	// Acceptance criteria
	for (const a of task.review_gate.acceptance_criteria) {
		if (a) sources.push({ source: "acceptance", value: a });
	}

	const flags = {
		requires_frontend_design: false as boolean,
		requires_security_review: false as boolean,
		requires_payment_review: false as boolean,
		requires_data_migration_review: false as boolean,
		requires_destructive_operation_review: false as boolean,
	};
	const signals: SpecTaskClassificationSignal[] = [];
	const seen = new Set<string>();
	const matchedSurfaces = new Set<RuntimeSurface>();

	for (const src of sources) {
		// Check boolean classification flags
		for (const check of CLASSIFICATION_CHECKS) {
			if (check.pattern.test(src.value)) {
				flags[check.classification] = true;
				const key = `${check.classification}|${src.source}|${src.value}`;
				if (!seen.has(key)) {
					seen.add(key);
					signals.push({
						source: src.source,
						value: src.value,
						classification: check.classification,
					});
				}
			}
		}

		// Check runtime surface
		for (const check of RUNTIME_SURFACE_CHECKS) {
			if (check.pattern.test(src.value)) {
				matchedSurfaces.add(check.surface);
			}
		}
	}

	// Determine runtime surface
	let runtime_surface: RuntimeSurface;
	if (matchedSurfaces.size === 0) {
		runtime_surface = "none";
	} else if (matchedSurfaces.size === 1) {
		runtime_surface = matchedSurfaces.values().next().value!;
	} else {
		runtime_surface = "mixed";
	}

	// Add runtime_surface signal
	if (runtime_surface !== "none") {
		signals.push({
			source: "codebase-memory",
			value: runtime_surface,
			classification: "runtime_surface",
		});
	}

	return {
		...flags,
		runtime_surface,
		signals,
	};
}

export function buildSpecTaskFramework(options: BuildSpecTaskFrameworkOptions): SpecTaskFramework {
	const generatedAt = (options.now ?? new Date()).toISOString();
	return {
		schema_version: "superpowers.spec_task_framework.v1",
		run_id: options.executionBook.run_id,
		generated_at: generatedAt,
		source_documents: options.sourceDocuments,
		role_registry_version: options.roleRegistryVersion ?? ROLE_REGISTRY_VERSION,
		tasks: options.executionBook.tasks.map(task => ({
			id: task.id,
			title_zh: task.todo || task.title,
			intent: task.execution_scope.goal || task.implementation_analysis || task.title,
			acceptance_criteria:
				task.review_gate.acceptance_criteria.length > 0 ? task.review_gate.acceptance_criteria : [task.title],
			allowed_paths: task.allowed_files.length > 0 ? task.allowed_files : task.execution_scope.allowed_files,
			forbidden_paths: task.forbidden_files,
			expected_changed_paths: task.execution_scope.likely_files,
			dependency_task_ids: [],
			affected_capabilities: affectedCapabilities(task),
			classification:
				options.classification?.enabled === false ? emptySpecTaskClassification() : classifySpecTask(task),
			business_paths: [businessPathForTask(task)],
			stages: STAGE_TEMPLATES.map(template => stageForTask(task.id, template)),
		})),
		global_gates: [
			{
				id: "global-impact",
				title_zh: "全局影响审查",
				role_id: "superpowers:impact-reviewer",
				status: "pending",
				required_evidence: [
					{
						id: "global-impact-json",
						title_zh: "全局影响 JSON",
						artifact_path: "global-impact-report.json",
						required: true,
					},
					{
						id: "global-impact-md",
						title_zh: "全局影响 Markdown",
						artifact_path: "global-impact-report.md",
						required: true,
					},
				],
			},
			{
				id: "real-business-simulation",
				title_zh: "真实业务环境模拟",
				role_id: "superpowers:runtime-simulator",
				status: "pending",
				required_evidence: [
					{
						id: "runtime-plan",
						title_zh: "运行环境计划",
						artifact_path: "runtime-environment-plan.md",
						required: true,
					},
					{
						id: "runtime-scenarios",
						title_zh: "业务模拟场景",
						artifact_path: "business-simulation-scenarios.md",
						required: true,
					},
					{
						id: "runtime-report",
						title_zh: "真实运行报告",
						artifact_path: "real-runtime-simulation-report.md",
						required: true,
					},
					{
						id: "runtime-cleanup",
						title_zh: "运行环境清理报告",
						artifact_path: "runtime-cleanup-report.md",
						required: true,
					},
				],
			},
		],
	};
}

export function renderSpecTaskFrameworkMarkdown(framework: SpecTaskFramework): string {
	const lines = [
		"# Spec Task Framework",
		"",
		`run_id: ${framework.run_id}`,
		`generated_at: ${framework.generated_at}`,
		"",
	];
	for (const task of framework.tasks) {
		lines.push(`## ${task.id} ${task.title_zh}`, "", `intent: ${task.intent}`, "", "### Classification");
		const c = task.classification;
		lines.push(`runtime_surface: ${c.runtime_surface}`);
		lines.push(`requires_frontend_design: ${c.requires_frontend_design}`);
		lines.push(`requires_security_review: ${c.requires_security_review}`);
		lines.push(`requires_payment_review: ${c.requires_payment_review}`);
		lines.push(`requires_data_migration_review: ${c.requires_data_migration_review}`);
		lines.push(`requires_destructive_operation_review: ${c.requires_destructive_operation_review}`);
		for (const signal of c.signals) {
			lines.push(`- signal: [${signal.classification}] source=${signal.source} value="${signal.value}"`);
		}
		lines.push("", "### Stages");
		for (const stage of task.stages) {
			lines.push(
				`- ${stage.id}: ${stage.title_zh} | role: ${stage.role_id} (${roleDisplayLabel(stage.role_id)}) | status: ${stage.status}`,
			);
		}
		lines.push("", "### Evidence");
		for (const stage of task.stages) {
			for (const evidence of stage.required_evidence) {
				lines.push(`- ${stage.id}/${evidence.id}: ${evidence.artifact_path}`);
			}
		}
		lines.push("");
	}
	lines.push("## Global Gates");
	for (const gate of framework.global_gates) lines.push(`- ${gate.id}: ${gate.title_zh} | role: ${gate.role_id}`);
	return `${lines.join("\n")}\n`;
}

export async function writeSpecTaskFrameworkArtifacts(options: {
	acceptingDir: string;
	framework: SpecTaskFramework;
}): Promise<{ jsonPath: string; markdownPath: string }> {
	await mkdir(options.acceptingDir, { recursive: true });
	const jsonPath = join(options.acceptingDir, "spec-task-framework.json");
	const markdownPath = join(options.acceptingDir, "spec-task-framework.md");
	await writeFile(jsonPath, `${JSON.stringify(options.framework, null, 2)}\n`, "utf8");
	await writeFile(markdownPath, renderSpecTaskFrameworkMarkdown(options.framework), "utf8");
	return { jsonPath, markdownPath };
}
