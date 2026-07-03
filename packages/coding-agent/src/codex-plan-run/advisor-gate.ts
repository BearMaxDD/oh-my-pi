import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { PromptPack } from "./prompt-pack";

export type AdvisorGateName =
	| "before_stage"
	| "after_stage"
	| "after_task"
	| "before_global_impact"
	| "before_real_runtime"
	| "before_final_acceptance";

export interface AdvisorGateRecord {
	schema_version: "superpowers.advisor_gate.v1";
	run_id: string;
	task_id?: string;
	stage_id?: string;
	gate: AdvisorGateName;
	status: "accepted" | "repair_required" | "blocked";
	findings: AdvisorFinding[];
	evidence_checked: string[];
}

export interface AdvisorFinding {
	severity: "must_fix" | "should_fix" | "note";
	title_zh: string;
	detail_zh: string;
	related_artifact?: string;
	suggested_owner_role_id?: string;
}

export interface AdvisorGateCommandEvidence {
	command: string;
	exit_code?: number;
	output_excerpt?: string;
}

export interface EvaluateAdvisorGateOptions {
	runId: string;
	promptPack: PromptPack;
	gate: AdvisorGateName;
	stageOutput: {
		schema_version?: string;
		evidence_paths?: string[];
		findings?: Array<{ severity?: string; evidence?: string }>;
	};
	changedFiles: string[];
	commandsRun: AdvisorGateCommandEvidence[];
	existingEvidencePaths: ReadonlySet<string>;
	todoStageStatus?: string;
}

function isTestPath(path: string): boolean {
	return (
		path.startsWith("test/") ||
		path.includes("/test/") ||
		path.includes("/tests/") ||
		path.includes("/__tests__/") ||
		path.includes("_test.") ||
		path.includes("_spec.") ||
		path.endsWith(".test.ts") ||
		path.endsWith(".spec.ts")
	);
}

function isProductionPath(path: string): boolean {
	return (path.startsWith("src/") || /^packages\/[^/]+\/src\//.test(path)) && !isTestPath(path);
}

function isSafeSegment(value: string): boolean {
	return value.length > 0 && !value.includes("..") && /^[A-Za-z0-9._:-]+$/.test(value);
}

function hasEvidencePath(paths: Iterable<string>, requiredName: string): boolean {
	for (const p of paths) {
		if (p === requiredName || p.endsWith(`/${requiredName}`)) {
			return true;
		}
	}
	return false;
}

export function evaluateAdvisorGate(options: EvaluateAdvisorGateOptions): AdvisorGateRecord {
	const findings: AdvisorFinding[] = [];
	const outputEvidence = new Set(options.stageOutput.evidence_paths ?? []);

	// ---- Gate-specific checks ----

	if (options.gate === "before_stage") {
		const hasRequiredOutputs = options.promptPack.required_outputs.some(output => output.required);
		if (!hasRequiredOutputs) {
			findings.push({
				severity: "must_fix",
				title_zh: "缺少阶段输出定义",
				detail_zh: `${options.promptPack.task_id}/${options.promptPack.stage_id} 没有 required output`,
				suggested_owner_role_id: "superpowers:prompt-engineer",
			});
		}
	}

	if (options.gate === "before_global_impact") {
		if ((options.stageOutput.findings ?? []).some(finding => finding.severity === "must_fix")) {
			findings.push({
				severity: "must_fix",
				title_zh: "任务阶段仍有 must-fix",
				detail_zh: "全局影响审查前必须清空所有阶段 must-fix",
				suggested_owner_role_id: "superpowers:advisor",
			});
		}
		if (options.changedFiles.length === 0) {
			findings.push({
				severity: "note",
				title_zh: "无文件变更用于全局影响评估",
				detail_zh: "changedFiles 为空，全局影响评估可能缺少输入",
				suggested_owner_role_id: "superpowers:advisor",
			});
		}
	}

	if (options.gate === "before_final_acceptance") {
		const evidence = Array.isArray(options.stageOutput.evidence_paths) ? options.stageOutput.evidence_paths : [];
		for (const required of ["real-runtime-simulation-report.json", "runtime-cleanup-report.md"]) {
			if (!hasEvidencePath(evidence, required) && !hasEvidencePath(options.existingEvidencePaths, required)) {
				findings.push({
					severity: "must_fix",
					title_zh: "最终验收证据缺失",
					detail_zh: required,
					suggested_owner_role_id: "superpowers:acceptance",
				});
			}
		}
		if (options.todoStageStatus !== "accepted") {
			findings.push({
				severity: "must_fix",
				title_zh: "Final acceptance 前任务状态未就绪",
				detail_zh: `todoStageStatus=${options.todoStageStatus ?? "missing"}，需要 accepted`,
				suggested_owner_role_id: "superpowers:advisor",
			});
		}
	}

	// ---- Common checks (after_stage / after_task) ----

	if (options.gate === "after_stage") {
		if (options.stageOutput.schema_version !== options.promptPack.return_schema.id) {
			findings.push({
				severity: "must_fix",
				title_zh: "子代理输出 schema 不匹配",
				detail_zh: `expected ${options.promptPack.return_schema.id}, received ${options.stageOutput.schema_version ?? "missing"}`,
				suggested_owner_role_id: options.promptPack.role_id,
			});
		}

		for (const output of options.promptPack.required_outputs.filter(output => output.required)) {
			if (!outputEvidence.has(output.artifact_path) || !options.existingEvidencePaths.has(output.artifact_path)) {
				findings.push({
					severity: "must_fix",
					title_zh: "缺少必需 evidence",
					detail_zh: `${output.title_zh}: ${output.artifact_path}`,
					related_artifact: output.artifact_path,
					suggested_owner_role_id: options.promptPack.role_id,
				});
			}
		}
	}

	// ---- Role scope checks (after_stage / after_task only) ----

	if (options.gate === "after_stage") {
		if (!options.promptPack.role_contract.may_edit_production_code) {
			const prodChanges = options.changedFiles.filter(isProductionPath);
			if (prodChanges.length > 0) {
				findings.push({
					severity: "must_fix",
					title_zh: "角色越权修改生产代码",
					detail_zh: prodChanges.join(", "),
					suggested_owner_role_id: options.promptPack.role_id,
				});
			}
		}

		if (!options.promptPack.role_contract.may_edit_test_code) {
			const testChanges = options.changedFiles.filter(isTestPath);
			if (testChanges.length > 0) {
				findings.push({
					severity: "must_fix",
					title_zh: "角色越权修改测试代码",
					detail_zh: testChanges.join(", "),
					suggested_owner_role_id: options.promptPack.role_id,
				});
			}
		}
	}

	// ---- Stage-specific checks ----

	if (options.gate === "after_stage") {
		if (options.promptPack.role_id === "superpowers:test-runner" && options.commandsRun.length === 0) {
			findings.push({
				severity: "must_fix",
				title_zh: "Test Runner 未运行命令",
				detail_zh: "Test Runner 必须产出真实 command evidence。",
				suggested_owner_role_id: "superpowers:test-runner",
			});
		}

		if (
			(options.promptPack.role_id === "superpowers:spec-reviewer" ||
				options.promptPack.role_id === "superpowers:quality-reviewer") &&
			(options.stageOutput.findings ?? []).some(
				finding =>
					(finding.severity === "must_fix" || finding.severity === "should_fix") &&
					!(typeof finding.evidence === "string" && finding.evidence.length > 0),
			)
		) {
			findings.push({
				severity: "must_fix",
				title_zh: "Reviewer 缺少证据引用",
				detail_zh: "Reviewer findings 必须引用规格、代码或测试证据。",
				suggested_owner_role_id: options.promptPack.role_id,
			});
		}
	}

	// ---- Classification-based evidence checks ----
	if (options.gate === "after_stage") {
		const task = options.promptPack.context_bundle.task;
		if (task?.classification) {
			const c = task.classification;
			const tid = task.id;
			const checks: Array<[boolean, string, string]> = [
				[c.requires_frontend_design, `tasks/${tid}/frontend-design-review.json`, "superpowers:frontend-designer"],
				[c.requires_security_review, `tasks/${tid}/security-review.json`, "superpowers:security-reviewer"],
				[c.requires_payment_review, `tasks/${tid}/payment-review.json`, "superpowers:payment-reviewer"],
				[
					c.requires_data_migration_review,
					`tasks/${tid}/data-migration-review.json`,
					"superpowers:data-migration-reviewer",
				],
				[
					c.requires_destructive_operation_review,
					`tasks/${tid}/destructive-operation-review.json`,
					"superpowers:release-auditor",
				],
			];
			for (const [flag, artifactPath, owner] of checks) {
				if (flag && !outputEvidence.has(artifactPath) && !options.existingEvidencePaths.has(artifactPath)) {
					findings.push({
						severity: "must_fix",
						title_zh: "缺少分类要求证据",
						detail_zh: artifactPath,
						related_artifact: artifactPath,
						suggested_owner_role_id: owner,
					});
				}
			}
		}
	}
	// ---- Cross-cutting consistency ----

	if (options.todoStageStatus === "accepted" && findings.some(finding => finding.severity === "must_fix")) {
		findings.push({
			severity: "must_fix",
			title_zh: "Todo 状态和 evidence 状态不一致",
			detail_zh: "存在 must-fix finding 时 Todo 不得为 accepted。",
			suggested_owner_role_id: "superpowers:advisor",
		});
	}

	return {
		schema_version: "superpowers.advisor_gate.v1",
		run_id: options.runId,
		task_id: options.promptPack.task_id,
		stage_id: options.promptPack.stage_id,
		gate: options.gate,
		status: findings.some(finding => finding.severity === "must_fix") ? "repair_required" : "accepted",
		findings,
		evidence_checked: [...options.existingEvidencePaths],
	};
}

export async function writeAdvisorGateRecord(options: {
	acceptingDir: string;
	record: AdvisorGateRecord;
}): Promise<string> {
	const taskId = options.record.task_id ?? "global";
	if (taskId !== "global" && !isSafeSegment(taskId)) {
		throw new Error("Invalid advisor gate path segment");
	}
	const rawStageId = options.record.stage_id;
	if (rawStageId !== undefined && !isSafeSegment(rawStageId)) {
		throw new Error("Invalid advisor gate path segment");
	}
	const stageSuffix = rawStageId ? `-${rawStageId}` : "";
	const dir =
		taskId === "global"
			? join(options.acceptingDir, "advisor-gates")
			: join(options.acceptingDir, "tasks", taskId, "advisor-gates");
	await mkdir(dir, { recursive: true });
	const path = join(dir, `${options.record.gate}${stageSuffix}.json`);
	await writeFile(path, `${JSON.stringify(options.record, null, 2)}\n`, "utf8");
	return path;
}
