import { MODEL_ROLES } from "../config/model-roles";
import type { SpecTask, SpecTaskFramework, SpecTaskStage } from "./spec-task-framework";
import type { PlanRunState, TodoSnapshot } from "./types";

type TodoStatus = TodoSnapshot["phases"][number]["tasks"][number]["status"];

export type RoleBoundStage =
	| "tdd-writer"
	| "implementer"
	| "test-runner"
	| "spec-reviewer"
	| "quality-reviewer"
	| "acceptance";

export type RoleBoundStageStatus =
	| "pending"
	| "assigned"
	| "running"
	| "waiting_evidence"
	| "completed"
	| "failed"
	| "blocked"
	| "needs_context";

export type RoleBoundEvidenceStatus = "missing" | "pending_review" | "accepted" | "rejected";

export interface RoleBoundStageSnapshot {
	taskId: string;
	title: string;
	stage: RoleBoundStage;
	todoStatus: TodoStatus;
	stageStatus: RoleBoundStageStatus;
	agentRole: string;
	modelRole: string;
	assignedAgentId?: string;
	modelOverride?: string | string[];
	resolvedModel?: string;
	fallbackUsed?: boolean;
	evidenceStatus: RoleBoundEvidenceStatus;
	statusLabel: string;
}

const STAGE_DEFS: ReadonlyArray<{
	stage: RoleBoundStage;
	title: string;
	agentRole: string;
	modelRole: string;
	weight: number;
}> = [
	{
		stage: "tdd-writer",
		title: "编写失败测试",
		agentRole: "TDD Writer",
		modelRole: "superpowers:tdd-writer",
		weight: 15,
	},
	{
		stage: "implementer",
		title: "实现最小生产代码",
		agentRole: "Implementer",
		modelRole: "superpowers:implementer",
		weight: 25,
	},
	{
		stage: "test-runner",
		title: "独立运行测试与 smoke",
		agentRole: "Test Runner",
		modelRole: "superpowers:test-runner",
		weight: 20,
	},
	{
		stage: "spec-reviewer",
		title: "规格合规审查",
		agentRole: "Spec Reviewer",
		modelRole: "superpowers:spec-reviewer",
		weight: 15,
	},
	{
		stage: "quality-reviewer",
		title: "代码质量审查",
		agentRole: "Quality Reviewer",
		modelRole: "superpowers:quality-reviewer",
		weight: 15,
	},
	{ stage: "acceptance", title: "最终验收", agentRole: "Acceptance", modelRole: "superpowers:acceptance", weight: 10 },
];

const STATUS_LABELS: Record<RoleBoundStageStatus | string, string> = {
	pending: "未分配",
	assigned: "已安排",
	running: "运行中",
	waiting_evidence: "等待证据",
	completed: "已完成",
	failed: "失败",
	blocked: "已阻塞",
	needs_context: "需要补充上下文",
	RED_READY: "红灯已就绪",
	IMPLEMENTED: "实现完成",
	GREEN_VERIFIED: "绿灯已验证",
	SPEC_PASS: "规格审查通过",
	SPEC_FAIL: "规格审查未通过",
	QUALITY_PASS: "质量审查通过",
	QUALITY_FAIL: "质量审查未通过",
	ACCEPTED: "验收通过",
	REJECTED: "验收拒绝",
	NEEDS_REPAIR: "需要修复",
	BLOCKED: "已阻塞",
	NEEDS_CONTEXT: "需要补充上下文",
};

export function toRoleBoundStatusLabel(status: RoleBoundStageStatus | string): string {
	return STATUS_LABELS[status] ?? status;
}

export function createRoleBoundStageSnapshots(options: {
	taskId: string;
	taskTitle: string;
}): RoleBoundStageSnapshot[] {
	return STAGE_DEFS.map(def => ({
		taskId: options.taskId,
		title: `任务 ${options.taskId}：${def.title}`,
		stage: def.stage,
		todoStatus: "pending",
		stageStatus: "pending",
		agentRole: def.agentRole,
		modelRole: def.modelRole,
		evidenceStatus: "missing",
		statusLabel: "未分配",
	}));
}

function formatModel(snapshot: RoleBoundStageSnapshot): string {
	if (snapshot.resolvedModel) {
		return snapshot.fallbackUsed
			? `模型：${snapshot.resolvedModel}（由 ${snapshot.modelRole} 回退）`
			: `模型：${snapshot.resolvedModel}`;
	}
	return snapshot.assignedAgentId ? `模型：待解析（${snapshot.modelRole}）` : `模型：待解析（${snapshot.modelRole}）`;
}

export function projectRoleBoundStagesToTodoTasks(
	stages: readonly RoleBoundStageSnapshot[],
): TodoSnapshot["phases"][number]["tasks"] {
	return stages.map(stage => ({
		id: `${stage.taskId}:${stage.stage}`,
		content: `${stage.title} — ${stage.agentRole} — ${formatModel(stage)} — ${stage.statusLabel}`,
		status: stage.todoStatus,
	}));
}

export function calculateRoleBoundTaskProgress(stages: readonly RoleBoundStageSnapshot[]): number {
	const completed = new Set(stages.filter(stage => stage.stageStatus === "completed").map(stage => stage.stage));
	let total = 0;
	for (const def of STAGE_DEFS) {
		if (completed.has(def.stage)) total += def.weight;
	}
	return completed.has("acceptance") ? total : Math.min(total, 90);
}

export interface ProjectFrameworkStagesToRoleBoundTodoSnapshotOptions {
	runId: string;
	state: PlanRunState;
	framework: SpecTaskFramework;
	promptPackPaths: ReadonlySet<string>;
	submittedStageOutputs: ReadonlySet<string>;
	acceptedAdvisorGates: ReadonlySet<string>;
	repairRequiredStages: ReadonlySet<string>;
	abandonedStages?: ReadonlySet<string>;
	blockedStages?: ReadonlySet<string>;
	existingEvidencePaths: ReadonlySet<string>;
	assignedModels?: Record<string, string>;
	now?: Date;
}
const FRAMEWORK_STATUS_LABELS: Record<string, string> = {
	pending: "未启动",
	running: "运行中",
	submitted: "已提交待审查",
	accepted: "已接受",
	repair_required: "需要修复",
	blocked: "已阻塞",
	abandoned: "已放弃",
};

function stageKey(taskId: string, stageId: string): string {
	return `${taskId}:${stageId}`;
}

function promptPackPath(taskId: string, stageId: string): string {
	return `tasks/${taskId}/prompt-packs/${stageId}.json`;
}
function deriveFrameworkStageStatus(options: {
	taskId: string;
	stage: SpecTaskStage;
	promptPackPaths: ReadonlySet<string>;
	submittedStageOutputs: ReadonlySet<string>;
	acceptedAdvisorGates: ReadonlySet<string>;
	repairRequiredStages: ReadonlySet<string>;
	abandonedStages?: ReadonlySet<string>;
	blockedStages?: ReadonlySet<string>;
	existingEvidencePaths: ReadonlySet<string>;
}): "pending" | "running" | "submitted" | "accepted" | "repair_required" | "blocked" | "abandoned" {
	const key = stageKey(options.taskId, options.stage.id);
	if (options.abandonedStages?.has(key)) return "abandoned";
	if (options.blockedStages?.has(key)) return "blocked";
	if (options.repairRequiredStages.has(key)) return "repair_required";
	if (
		options.acceptedAdvisorGates.has(key) &&
		options.stage.required_evidence
			.filter(evidence => evidence.required)
			.every(evidence => options.existingEvidencePaths.has(evidence.artifact_path))
	) {
		return "accepted";
	}
	if (options.stage.status === "blocked") return "blocked";
	if (options.submittedStageOutputs.has(key)) return "submitted";
	if (options.promptPackPaths.has(promptPackPath(options.taskId, options.stage.id))) return "running";
	return "pending";
}

export function todoStatusForFrameworkStage(status: string): TodoStatus {
	if (status === "accepted") return "completed";
	if (
		status === "repair_required" ||
		status === "running" ||
		status === "submitted" ||
		status === "abandoned" ||
		status === "blocked"
	) {
		return "in_progress";
	}
	return "pending";
}

function modelLabel(roleId: string, assignedModel?: string): string {
	return assignedModel ? `模型：${assignedModel}` : `模型：待解析（${roleId}）`;
}

function evidenceLabel(stage: SpecTaskStage): string {
	const paths = stage.required_evidence.filter(evidence => evidence.required).map(evidence => evidence.artifact_path);
	return paths.length > 0 ? paths.join("、") : "无必需 evidence";
}

function classificationDetails(c: SpecTask["classification"]): string {
	const parts: string[] = [`runtime_surface=${c.runtime_surface}`];
	if (c.requires_frontend_design) parts.push("前端设计");
	if (c.requires_security_review) parts.push("安全审查");
	if (c.requires_payment_review) parts.push("支付审查");
	if (c.requires_data_migration_review) parts.push("数据迁移");
	if (c.requires_destructive_operation_review) parts.push("破坏性操作");
	return parts.join(", ");
}
function hasClassificationInfo(c: SpecTask["classification"]): boolean {
	return (
		c.runtime_surface !== "none" ||
		c.requires_frontend_design ||
		c.requires_security_review ||
		c.requires_payment_review ||
		c.requires_data_migration_review ||
		c.requires_destructive_operation_review
	);
}

export function projectFrameworkStagesToRoleBoundTodoSnapshot(
	options: ProjectFrameworkStagesToRoleBoundTodoSnapshotOptions,
): TodoSnapshot {
	const tasks: TodoSnapshot["phases"][number]["tasks"] = [];
	for (const task of options.framework.tasks) {
		for (const stage of task.stages) {
			const key = stageKey(task.id, stage.id);
			const status = deriveFrameworkStageStatus({
				taskId: task.id,
				stage,
				promptPackPaths: options.promptPackPaths,
				submittedStageOutputs: options.submittedStageOutputs,
				acceptedAdvisorGates: options.acceptedAdvisorGates,
				repairRequiredStages: options.repairRequiredStages,
				abandonedStages: options.abandonedStages,
				blockedStages: options.blockedStages,
				existingEvidencePaths: options.existingEvidencePaths,
			});
			const roleInfo = MODEL_ROLES[stage.role_id as keyof typeof MODEL_ROLES];
			const roleName = roleInfo?.name ?? stage.role_id;
			const roleDescription = roleInfo?.zhDescription ?? roleInfo?.description ?? stage.role_id;
			const clsStr = hasClassificationInfo(task.classification)
				? ` ｜ ${classificationDetails(task.classification)}`
				: "";
			tasks.push({
				id: key,
				content: `任务 ${task.id}：${stage.title_zh} ｜ 角色：${roleName}（${roleDescription}）｜ ${modelLabel(stage.role_id, options.assignedModels?.[key])} ｜ 状态：${FRAMEWORK_STATUS_LABELS[status]} ｜ evidence：${evidenceLabel(stage)}${clsStr}`,
				status: todoStatusForFrameworkStage(status),
			});
		}
	}
	return {
		runId: options.runId,
		version: 1,
		state: options.state,
		updatedAt: (options.now ?? new Date()).toISOString(),
		source: "state-machine",
		phases: [{ name: "Role-Bound Execution", tasks }],
	};
}
