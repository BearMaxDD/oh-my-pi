import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MODEL_ROLES, type ModelRoleInfo } from "../config/model-roles";
import type { SourceDocumentRef, SpecTask, SpecTaskFramework, SpecTaskStage } from "./spec-task-framework";

export interface PromptPack {
	schema_version: "superpowers.prompt_pack.v1";
	run_id: string;
	task_id: string;
	stage_id: string;
	role_id: string;
	role_contract: RoleContract;
	context_bundle: ContextBundle;
	allowed_operations: AllowedOperation[];
	forbidden_operations: ForbiddenOperation[];
	required_outputs: RequiredOutput[];
	return_schema: JsonSchemaRef;
	advisor_checkpoints: AdvisorCheckpoint[];
}

export interface RoleContract {
	zh_name: string;
	zh_description: string;
	may_edit_production_code: boolean;
	may_edit_test_code: boolean;
	read_only: boolean;
	success_definition: string[];
	failure_definition: string[];
}

export interface ContextBundle {
	source_documents: SourceDocumentRef[];
	relevant_code_snippets: CodeSnippetRef[];
	codebase_memory_summary?: string;
	task?: SpecTask;
	previous_stage_outputs: ArtifactRef[];
	known_constraints: string[];
}

export interface CodeSnippetRef {
	path: string;
	symbol?: string;
	start_line?: number;
	end_line?: number;
}
export interface ArtifactRef {
	path: string;
	description: string;
}
export interface AllowedOperation {
	id: string;
	title_zh: string;
}
export interface ForbiddenOperation {
	id: string;
	title_zh: string;
}
export interface RequiredOutput {
	id: string;
	title_zh: string;
	artifact_path: string;
	required: boolean;
}
export interface JsonSchemaRef {
	id: string;
}
export interface AdvisorCheckpoint {
	gate:
		| "before_stage"
		| "after_stage"
		| "after_task"
		| "before_global_impact"
		| "before_real_runtime"
		| "before_final_acceptance";
	title_zh: string;
}

export interface CompilePromptPacksOptions {
	framework: SpecTaskFramework;
	codebaseMemorySummary?: string;
	relevantCodeSnippets?: CodeSnippetRef[];
	/** Previous outputs keyed by `${task_id}:${stage_id}` for resumable/recompiled prompt packs. */
	previousStageOutputsByStage?: Record<string, readonly ArtifactRef[]>;
}

const ROLE_SUCCESS: Record<string, string[]> = {
	"superpowers:tdd-writer": ["写入失败测试", "记录 red command 和 red output", "不修改生产代码"],
	"superpowers:implementer": ["只改生产代码", "让 red 测试变 green", "不扩大需求范围"],
	"superpowers:test-runner": ["独立运行测试和 smoke", "记录 green evidence 或 failure evidence", "不修改代码"],
	"superpowers:spec-reviewer": ["引用 PRD/TRD/plan/framework 审查", "输出 must_fix/should_fix/note", "不直接修复代码"],
	"superpowers:quality-reviewer": ["审查代码质量和测试质量", "指出可维护性风险", "不替代功能验收"],
	"superpowers:acceptance": ["只处理 must-fix 和最终通过/拒绝", "检查 evidence 完整性", "不补实现"],
};

const ROLE_FAILURE: Record<string, string[]> = {
	"superpowers:tdd-writer": ["修改生产代码", "没有 red evidence", "测试不能真实失败"],
	"superpowers:implementer": ["修改测试以放松断言", "实现超出 acceptance criteria", "未让 Test Runner 复测"],
	"superpowers:test-runner": ["未运行命令", "修改代码", "复用旧输出"],
	"superpowers:spec-reviewer": ["没有引用规格证据", "只给泛泛结论", "直接改代码"],
	"superpowers:quality-reviewer": ["没有引用代码证据", "跳过测试质量审查", "直接改代码"],
	"superpowers:acceptance": ["证据缺失时放行", "覆盖 reviewer must-fix", "补实现"],
};

function roleInfo(roleId: string): ModelRoleInfo {
	return MODEL_ROLES[roleId as keyof typeof MODEL_ROLES] ?? { name: roleId, zhDescription: roleId };
}

function roleContract(roleId: string): RoleContract {
	const info = roleInfo(roleId);
	return {
		zh_name: info.name,
		zh_description: info.zhDescription ?? info.description ?? info.name,
		may_edit_production_code: info.canEditProductionCode === true,
		may_edit_test_code: info.canEditTestCode === true,
		read_only: info.readOnly === true,
		success_definition: ROLE_SUCCESS[roleId] ?? ["完成角色职责并写入证据"],
		failure_definition: ROLE_FAILURE[roleId] ?? ["缺少证据或越权操作"],
	};
}

function allowedOperations(roleId: string, contract: RoleContract): AllowedOperation[] {
	if (contract.read_only) {
		if (roleId === "superpowers:test-runner") {
			return [
				{ id: "read-files", title_zh: "读取授权文件" },
				{ id: "run-tests", title_zh: "运行测试和 smoke" },
				{ id: "write-stage-evidence", title_zh: "写入阶段证据" },
			];
		}
		return [
			{ id: "read-files", title_zh: "读取授权文件" },
			{ id: "write-review-evidence", title_zh: "写入审查证据" },
		];
	}
	const ops: AllowedOperation[] = [{ id: "read-files", title_zh: "读取授权文件" }];
	if (contract.may_edit_test_code) ops.push({ id: "modify-test-code", title_zh: "修改测试文件" });
	if (contract.may_edit_production_code) ops.push({ id: "modify-production-code", title_zh: "修改生产代码" });
	ops.push({ id: "write-stage-evidence", title_zh: "写入阶段证据" });
	return ops;
}

function forbiddenOperations(roleId: string, contract: RoleContract): ForbiddenOperation[] {
	const ops: ForbiddenOperation[] = [];
	if (!contract.may_edit_production_code) ops.push({ id: "modify-production-code", title_zh: "修改生产代码" });
	if (!contract.may_edit_test_code) ops.push({ id: "modify-test-code", title_zh: "修改测试文件" });
	if (roleId === "superpowers:implementer") ops.push({ id: "expand-requirements", title_zh: "扩大需求范围" });
	if (contract.read_only) ops.push({ id: "apply-code-fix", title_zh: "直接修复代码" });
	return ops;
}

const PROMPT_PACK_SAFE_ID_RE = /^[A-Za-z0-9._:-]+$/;

function validatePromptPackPathSegment(value: string, label: string): void {
	if (!value || value.includes("..") || !PROMPT_PACK_SAFE_ID_RE.test(value)) {
		throw new Error(`Invalid prompt pack path segment: ${label}=${value}`);
	}
}

function constraintsForTask(task: SpecTask): string[] {
	return [
		`Allowed paths: ${task.allowed_paths.join(", ")}`,
		`Forbidden paths: ${task.forbidden_paths.join(", ") || "none"}`,
		`Acceptance criteria: ${task.acceptance_criteria.join("; ")}`,
		"Subagents do not run project-wide commands unless the prompt pack explicitly lists them.",
	];
}
function compilePromptPack(params: {
	framework: SpecTaskFramework;
	task: SpecTask;
	stage: SpecTaskStage;
	codebaseMemorySummary?: string;
	relevantCodeSnippets: CodeSnippetRef[];
	previousStageOutputs?: ArtifactRef[];
}): PromptPack {
	const contract = roleContract(params.stage.role_id);
	const baseOutputs = params.stage.required_evidence.map(evidence => ({
		id: evidence.id,
		title_zh: evidence.title_zh,
		artifact_path: evidence.artifact_path,
		required: evidence.required,
	}));

	// Add classification-based specialized required outputs for reviewer/acceptance stages
	const REVIEW_ACCEPTANCE_ROLES = [
		"superpowers:spec-reviewer",
		"superpowers:quality-reviewer",
		"superpowers:acceptance",
	];
	const extraOutputs: RequiredOutput[] = [];
	if (REVIEW_ACCEPTANCE_ROLES.includes(params.stage.role_id)) {
		const c = params.task.classification;
		if (c.requires_frontend_design) {
			extraOutputs.push({
				id: "frontend_design_review_evidence",
				title_zh: "前端设计审查证据",
				artifact_path: `tasks/${params.task.id}/frontend-design-review.json`,
				required: true,
			});
		}
		if (c.requires_security_review) {
			extraOutputs.push({
				id: "security_review_evidence",
				title_zh: "安全审查证据",
				artifact_path: `tasks/${params.task.id}/security-review.json`,
				required: true,
			});
		}
		if (c.requires_payment_review) {
			extraOutputs.push({
				id: "payment_review_evidence",
				title_zh: "支付审查证据",
				artifact_path: `tasks/${params.task.id}/payment-review.json`,
				required: true,
			});
		}
		if (c.requires_data_migration_review) {
			extraOutputs.push({
				id: "data_migration_review_evidence",
				title_zh: "数据迁移审查证据",
				artifact_path: `tasks/${params.task.id}/data-migration-review.json`,
				required: true,
			});
		}
		if (c.requires_destructive_operation_review) {
			extraOutputs.push({
				id: "destructive_operation_review_evidence",
				title_zh: "破坏性操作审查证据",
				artifact_path: `tasks/${params.task.id}/destructive-operation-review.json`,
				required: true,
			});
		}
	}

	return {
		schema_version: "superpowers.prompt_pack.v1",
		run_id: params.framework.run_id,
		task_id: params.task.id,
		stage_id: params.stage.id,
		role_id: params.stage.role_id,
		role_contract: contract,
		context_bundle: {
			source_documents: params.framework.source_documents,
			relevant_code_snippets: params.relevantCodeSnippets,
			codebase_memory_summary: params.codebaseMemorySummary,
			task: params.task,
			previous_stage_outputs: params.previousStageOutputs ?? [],
			known_constraints: constraintsForTask(params.task),
		},
		allowed_operations: allowedOperations(params.stage.role_id, contract),
		forbidden_operations: forbiddenOperations(params.stage.role_id, contract),
		required_outputs: [...baseOutputs, ...extraOutputs],
		return_schema: { id: params.stage.output_schema_ref },
		advisor_checkpoints: [
			{ gate: "before_stage", title_zh: "阶段前 Advisor 检查" },
			{ gate: "after_stage", title_zh: "阶段后 Advisor 检查" },
		],
	};
}

export function compilePromptPacksForFramework(options: CompilePromptPacksOptions): PromptPack[] {
	const snippets = options.relevantCodeSnippets ?? [];
	return options.framework.tasks.flatMap(task =>
		task.stages.map(stage =>
			compilePromptPack({
				framework: options.framework,
				task,
				stage,
				codebaseMemorySummary: options.codebaseMemorySummary,
				relevantCodeSnippets: snippets,
				previousStageOutputs: [...(options.previousStageOutputsByStage?.[`${task.id}:${stage.id}`] ?? [])],
			}),
		),
	);
}

export function withPromptPackPreviousStageOutputs(
	pack: PromptPack,
	previousStageOutputs: readonly ArtifactRef[],
): PromptPack {
	return {
		...pack,
		context_bundle: {
			...pack.context_bundle,
			previous_stage_outputs: [...previousStageOutputs],
		},
	};
}

function renderPromptPackMarkdown(pack: PromptPack): string {
	return [
		`# Prompt Pack ${pack.task_id}/${pack.stage_id}`,
		"",
		`role: ${pack.role_id}`,
		`description: ${pack.role_contract.zh_description}`,
		"",
		"## Allowed Operations",
		...pack.allowed_operations.map(op => `- ${op.id}: ${op.title_zh}`),
		"",
		"## Forbidden Operations",
		...pack.forbidden_operations.map(op => `- ${op.id}: ${op.title_zh}`),
		"",
		"## Required Outputs",
		...pack.required_outputs.map(output => `- ${output.id}: ${output.artifact_path}`),
		"",
	].join("\n");
}

export async function writePromptPackArtifacts(options: {
	acceptingDir: string;
	packs: readonly PromptPack[];
}): Promise<string[]> {
	const paths: string[] = [];
	for (const pack of options.packs) {
		validatePromptPackPathSegment(pack.task_id, "task_id");
		validatePromptPackPathSegment(pack.stage_id, "stage_id");
		const dir = join(options.acceptingDir, "tasks", pack.task_id, "prompt-packs");
		await mkdir(dir, { recursive: true });
		const jsonPath = join(dir, `${pack.stage_id}.json`);
		const markdownPath = join(dir, `${pack.stage_id}.md`);
		await writeFile(jsonPath, `${JSON.stringify(pack, null, 2)}\n`, "utf8");
		await writeFile(markdownPath, renderPromptPackMarkdown(pack), "utf8");
		paths.push(jsonPath, markdownPath);
	}
	return paths;
}
