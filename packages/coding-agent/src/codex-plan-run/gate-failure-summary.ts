/**
 * GateFailureSummary — structured failure report for any gate in the PlanRun loop.
 */
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MODEL_ROLES } from "../config/model-roles";
import type { AdvisorGateRecord } from "./advisor-gate";
import type { GlobalImpactReport } from "./global-impact";
import type { MainThreadAcceptanceFixRequiredResult } from "./main-acceptance-review";
import type { RealRuntimeSimulationReport } from "./real-runtime-simulation";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type GateFailureSummaryGateKind =
	| "advisor_gate"
	| "global_impact"
	| "real_business_simulation"
	| "main_acceptance";

export type GateFailureSummaryStatus = "repair_required" | "blocked";

export interface GateFailureSummary {
	schema_version: "superpowers.gate_failure_summary.v1";
	run_id: string;
	gate: GateFailureSummaryGateKind;
	status: GateFailureSummaryStatus;
	title_zh: string;
	reason_zh: string;
	owner_role_id: string;
	owner_role_label_zh: string;
	retest_role_id: string;
	retest_role_label_zh: string;
	evidence_paths: string[];
	next_action_zh: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Look up a Chinese label for a role id.
 * Uses MODEL_ROLES.zhDescription when available, falls back to .name, then to the id itself.
 */
function getRoleLabelZh(roleId: string): string {
	const role = MODEL_ROLES[roleId as keyof typeof MODEL_ROLES];
	if (!role) return roleId;
	return role.zhDescription ?? role.name ?? roleId;
}

/**
 * Normalize any non-"blocked" status to "repair_required".
 */
function normalizeStatus(raw: string): GateFailureSummaryStatus {
	return raw === "blocked" ? "blocked" : "repair_required";
}

// ---------------------------------------------------------------------------
// Builders
// ---------------------------------------------------------------------------

export function buildGateFailureSummaryFromAdvisorGate(options: {
	runId: string;
	record: AdvisorGateRecord;
}): GateFailureSummary {
	const { runId, record } = options;
	// Prefer first must_fix finding.
	const finding = record.findings.find(f => f.severity === "must_fix") ?? record.findings[0];
	const ownerRoleId = finding?.suggested_owner_role_id ?? "superpowers:advisor";
	const retestRoleId = "superpowers:advisor";

	return {
		schema_version: "superpowers.gate_failure_summary.v1",
		run_id: runId,
		gate: "advisor_gate",
		status: normalizeStatus(record.status),
		title_zh: "Advisor Gate 未通过",
		reason_zh: finding ? `${finding.title_zh}：${finding.detail_zh}` : "Advisor Gate 返回非 accepted 状态",
		owner_role_id: ownerRoleId,
		owner_role_label_zh: getRoleLabelZh(ownerRoleId),
		retest_role_id: retestRoleId,
		retest_role_label_zh: getRoleLabelZh(retestRoleId),
		evidence_paths: [...record.evidence_checked],
		next_action_zh: record.status === "blocked" ? "请检查后重新触发" : "请修复后重新提交",
	};
}

export function buildGateFailureSummaryFromGlobalImpact(options: {
	runId: string;
	report: GlobalImpactReport;
	reportPath: string;
}): GateFailureSummary {
	const { runId, report, reportPath } = options;

	const finding = report.findings.find(f => f.severity === "must_fix") ?? report.findings[0];
	const reason = finding?.description ?? "Global Impact Gate 返回非 accepted 状态";

	// Derive owner from reason text.
	const hasNoTestEvidence = reason.includes("No passing test evidence");
	const ownerRoleId = hasNoTestEvidence ? "superpowers:test-runner" : "superpowers:impact-reviewer";
	const retestRoleId = ownerRoleId;

	return {
		schema_version: "superpowers.gate_failure_summary.v1",
		run_id: runId,
		gate: "global_impact",
		status: normalizeStatus(report.status),
		title_zh: "全局影响审查未通过",
		reason_zh: reason,
		owner_role_id: ownerRoleId,
		owner_role_label_zh: getRoleLabelZh(ownerRoleId),
		retest_role_id: retestRoleId,
		retest_role_label_zh: getRoleLabelZh(retestRoleId),
		evidence_paths: [reportPath],
		next_action_zh: report.status === "blocked" ? "请检查后重新触发" : "请补充测试证据后重新提交",
	};
}

export function buildGateFailureSummaryFromRuntime(options: {
	runId: string;
	report: RealRuntimeSimulationReport;
	reportPath: string;
	cleanupPath?: string;
}): GateFailureSummary {
	const { runId, report, reportPath, cleanupPath } = options;
	const isBlocked = report.status === "blocked";
	const failedScenario = report.scenarios.find(s => s.status === "failed" || s.status === "blocked");

	// Map runtime failed scenarios to implementer; blocked runtime uses runtime-simulator.
	const ownerRoleId = isBlocked ? "superpowers:runtime-simulator" : "superpowers:implementer";
	const retestRoleId = "superpowers:runtime-simulator";

	const evidencePaths: string[] = [reportPath];
	if (cleanupPath) {
		evidencePaths.push(cleanupPath);
	}

	return {
		schema_version: "superpowers.gate_failure_summary.v1",
		run_id: runId,
		gate: "real_business_simulation",
		status: normalizeStatus(report.status),
		title_zh: "真实业务环境模拟未通过",
		reason_zh: failedScenario?.failure_summary_zh ?? (isBlocked ? "运行环境无法启动" : "真实业务环境模拟未通过"),
		owner_role_id: ownerRoleId,
		owner_role_label_zh: getRoleLabelZh(ownerRoleId),
		retest_role_id: retestRoleId,
		retest_role_label_zh: getRoleLabelZh(retestRoleId),
		evidence_paths: evidencePaths,
		next_action_zh: isBlocked ? "请检查环境后重新运行模拟" : "请修复后重新运行模拟",
	};
}

export function buildGateFailureSummaryFromMainAcceptance(options: {
	runId: string;
	result: MainThreadAcceptanceFixRequiredResult;
}): GateFailureSummary {
	const { runId, result } = options;
	const firstItem = result.must_fix_items.find(i => i.severity === "must_fix") ?? result.must_fix_items[0];

	// Map category to owner role.
	let ownerRoleId: string;
	const category = firstItem?.category;
	if (category === "verification") {
		ownerRoleId = "superpowers:test-runner";
	} else if (category === "scope") {
		ownerRoleId = "superpowers:spec-reviewer";
	} else if (category === "evidence") {
		ownerRoleId = "superpowers:acceptance";
	} else {
		ownerRoleId = "superpowers:advisor";
	}

	// Retest is test-runner when owner is test-runner, otherwise acceptance.
	const retestRoleId =
		ownerRoleId === "superpowers:test-runner" ? "superpowers:test-runner" : "superpowers:acceptance";

	return {
		schema_version: "superpowers.gate_failure_summary.v1",
		run_id: runId,
		gate: "main_acceptance",
		status: normalizeStatus("repair_required"),
		title_zh: "最终验收未通过",
		reason_zh: firstItem?.description ?? "Main Acceptance 返回修复要求",
		owner_role_id: ownerRoleId,
		owner_role_label_zh: getRoleLabelZh(ownerRoleId),
		retest_role_id: retestRoleId,
		retest_role_label_zh: getRoleLabelZh(retestRoleId),
		evidence_paths: firstItem?.evidence ? [firstItem.evidence] : [],
		next_action_zh: firstItem?.required_fix ?? "Main Acceptance 返回修复要求",
	};
}

// ---------------------------------------------------------------------------
// Render
// ---------------------------------------------------------------------------

export function renderGateFailureSummaryMarkdown(summary: GateFailureSummary): string {
	const lines: string[] = [
		`# ${summary.title_zh}`,
		"",
		`✘ ${summary.title_zh}`,
		`原因：${summary.reason_zh}`,
		`打回角色：${summary.owner_role_id}（${summary.owner_role_label_zh}）`,
		`复测角色：${summary.retest_role_id}（${summary.retest_role_label_zh}）`,
	];
	for (const path of summary.evidence_paths) {
		lines.push(`证据：${path}`);
	}
	lines.push(`下一步：${summary.next_action_zh}`);
	return lines.join("\n");
}

// ---------------------------------------------------------------------------
// Artifact writer
// ---------------------------------------------------------------------------

export async function writeGateFailureSummaryArtifacts(options: {
	acceptingDir: string;
	summary: GateFailureSummary;
}): Promise<{ jsonPath: string; markdownPath: string }> {
	const { acceptingDir, summary } = options;
	await mkdir(acceptingDir, { recursive: true });
	const jsonPath = join(acceptingDir, "gate-failure-summary.json");
	const markdownPath = join(acceptingDir, "gate-failure-summary.md");
	await writeFile(jsonPath, `${JSON.stringify(summary, null, 2)}\n`, "utf8");
	await writeFile(markdownPath, renderGateFailureSummaryMarkdown(summary), "utf8");
	return { jsonPath, markdownPath };
}
