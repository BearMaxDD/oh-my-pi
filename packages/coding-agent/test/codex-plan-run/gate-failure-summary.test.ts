import { afterEach, describe, expect, it } from "bun:test";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---- Existing production types used as builder inputs ----
import type { AdvisorGateRecord } from "../../src/codex-plan-run/advisor-gate";
// ---- Future module (RED evidence — will fail to resolve until implemented) ----
import {
	buildGateFailureSummaryFromAdvisorGate,
	buildGateFailureSummaryFromGlobalImpact,
	buildGateFailureSummaryFromMainAcceptance,
	buildGateFailureSummaryFromRuntime,
	type GateFailureSummary,
	renderGateFailureSummaryMarkdown,
	writeGateFailureSummaryArtifacts,
} from "../../src/codex-plan-run/gate-failure-summary";
import type { GlobalImpactReport } from "../../src/codex-plan-run/global-impact";
import type {
	MainThreadAcceptanceFixRequiredResult,
	MainThreadAcceptanceMustFixItem,
} from "../../src/codex-plan-run/main-acceptance-review";
import type {
	RealRuntimeSimulationReport,
	ScenarioExecutionResult,
} from "../../src/codex-plan-run/real-runtime-simulation";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_RUN_ID = "test-run-001";

const ADVISOR_RECORD: AdvisorGateRecord = {
	schema_version: "superpowers.advisor_gate.v1",
	run_id: "test-run-001",
	gate: "before_global_impact",
	status: "repair_required",
	findings: [
		{
			severity: "must_fix",
			title_zh: "缺少测试覆盖",
			detail_zh: "核心模块缺少单元测试",
			suggested_owner_role_id: "superpowers:test-writer",
		},
	],
	evidence_checked: ["src/core.rs", "src/lib.rs"],
};

const GLOBAL_IMPACT_REPORT: GlobalImpactReport = {
	schema_version: "superpowers.global_impact.v1",
	run_id: "test-run-001",
	changed_files: ["src/api.ts", "src/db.ts"],
	affected_capabilities: [
		{
			id: "api_endpoints",
			title_zh: "API 端点变更",
			reason: "修改了路由注册",
			related_files: ["src/api.ts"],
			confidence: "high",
		},
	],
	required_linked_tests: [
		{
			id: "api_endpoints",
			title_zh: "API 端点变更",
			command: "bun test test/api.test.ts",
			business_path_id: "bp-api",
			required: true,
		},
	],
	runtime_business_paths: [],
	status: "repair_required",
	findings: [
		{
			severity: "must_fix",
			description: "No passing test evidence for task T01",
			evidence: "未找到关联的 passing test evidence",
		},
	],
};

const SCENARIO_EXECUTED: ScenarioExecutionResult = {
	scenario_id: "scenario-01",
	status: "failed",
	executed_steps: [
		{ index: 1, status: "passed", evidence: "step-1-pass.log" },
		{ index: 2, status: "failed", evidence: "step-2-fail.log" },
	],
	evidence_paths: ["logs/scenario-01/run.log"],
	failure_summary_zh: "第二步执行失败：数据库连接超时",
};

const RUNTIME_REPORT: RealRuntimeSimulationReport = {
	schema_version: "superpowers.real_runtime_simulation.v1",
	run_id: "test-run-001",
	started_at: "2026-06-30T10:00:00Z",
	finished_at: "2026-06-30T10:05:00Z",
	environment: {
		environment_type: "local",
		startup_status: "passed",
	},
	scenarios: [SCENARIO_EXECUTED],
	logs: [
		{ path: "logs/runtime/startup.log", summary: "启动日志" },
		{ path: "logs/runtime/app.log", summary: "应用日志" },
	],
	screenshots: [],
	status: "repair_required",
	cleanup_report_path: "logs/runtime/cleanup-report.json",
	cleanup_status: "passed",
	cleanup_residuals: ["/tmp/test-residual.lock"],
};

const MUST_FIX_ITEMS: MainThreadAcceptanceMustFixItem[] = [
	{
		id: "evidence_missing_001",
		category: "evidence",
		severity: "must_fix",
		description: "缺少必要的最终验证证据",
		evidence: "未找到通过的命令输出",
		required_fix: "提供通过的命令输出作为证据",
		affected_tasks: ["task-01"],
		required_commands: ["bun test"],
		authorized_files: ["src/"],
	},
];

const ACCEPTANCE_FIX_RESULT: MainThreadAcceptanceFixRequiredResult = {
	result: "MAIN_ACCEPTANCE_FIX_REQUIRED",
	review_round: 1,
	must_fix_items: MUST_FIX_ITEMS,
	next_task: "OmpFixExecutionTask",
};

// ---------------------------------------------------------------------------
// Helper: tmp dir lifecycle
// ---------------------------------------------------------------------------

let currentTmpDir: string | undefined;

afterEach(async () => {
	if (currentTmpDir) {
		await rm(currentTmpDir, { recursive: true, force: true });
		currentTmpDir = undefined;
	}
});

// ===========================================================================
// RED evidence — tests that define the expected contract
// ===========================================================================

describe("buildGateFailureSummaryFromAdvisorGate", () => {
	it("maps advisor gate record to GateFailureSummary with all expected fields", () => {
		const s: GateFailureSummary = buildGateFailureSummaryFromAdvisorGate({
			runId: TEST_RUN_ID,
			record: ADVISOR_RECORD,
		});
		expect(s.gate).toBe("advisor_gate");
		expect(s.reason_zh).toBe("缺少测试覆盖：核心模块缺少单元测试");
		expect(s.owner_role_id).toBe("superpowers:test-writer");
		expect(s.retest_role_id).toBe("superpowers:advisor");
		expect(s.evidence_paths).toEqual(["src/core.rs", "src/lib.rs"]);
	});

	it("prefers first must_fix finding when findings have mixed severity", () => {
		const recordWithMixed: AdvisorGateRecord = {
			...ADVISOR_RECORD,
			findings: [
				{
					severity: "note",
					title_zh: "次要问题",
					detail_zh: "代码风格可优化",
				},
				{
					severity: "must_fix",
					title_zh: "缺少测试覆盖",
					detail_zh: "核心模块缺少单元测试",
					suggested_owner_role_id: "superpowers:test-writer",
				},
			],
		};
		const s = buildGateFailureSummaryFromAdvisorGate({
			runId: TEST_RUN_ID,
			record: recordWithMixed,
		});
		expect(s.reason_zh).toBe("缺少测试覆盖：核心模块缺少单元测试");
		expect(s.owner_role_id).toBe("superpowers:test-writer");
	});

	it("normalizes non-blocked status to repair_required and preserves blocked", () => {
		const acceptedRecord: AdvisorGateRecord = {
			...ADVISOR_RECORD,
			status: "accepted",
		};
		const s1 = buildGateFailureSummaryFromAdvisorGate({
			runId: TEST_RUN_ID,
			record: acceptedRecord,
		});
		expect(s1.status).toBe("repair_required");

		const blockedRecord: AdvisorGateRecord = {
			...ADVISOR_RECORD,
			status: "blocked",
		};
		const s2 = buildGateFailureSummaryFromAdvisorGate({
			runId: TEST_RUN_ID,
			record: blockedRecord,
		});
		expect(s2.status).toBe("blocked");
	});

	it("uses fallback reason when no findings exist", () => {
		const emptyRecord: AdvisorGateRecord = {
			...ADVISOR_RECORD,
			findings: [],
		};
		const s = buildGateFailureSummaryFromAdvisorGate({
			runId: TEST_RUN_ID,
			record: emptyRecord,
		});
		expect(s.reason_zh).toBe("Advisor Gate 返回非 accepted 状态");
	});
});

describe("buildGateFailureSummaryFromGlobalImpact", () => {
	it("maps global impact report to GateFailureSummary with all expected fields", () => {
		const s: GateFailureSummary = buildGateFailureSummaryFromGlobalImpact({
			runId: TEST_RUN_ID,
			report: GLOBAL_IMPACT_REPORT,
			reportPath: "global-impact-report.json",
		});
		expect(s.gate).toBe("global_impact");
		expect(s.owner_role_id).toBe("superpowers:test-runner");
		expect(s.retest_role_id).toBe("superpowers:test-runner");
		expect(s.evidence_paths).toEqual(["global-impact-report.json"]);
		expect(s.reason_zh).toBe("No passing test evidence for task T01");
	});
});

describe("buildGateFailureSummaryFromRuntime", () => {
	it("maps runtime simulation report to GateFailureSummary including reportPath and cleanupPath in evidence_paths", () => {
		const s: GateFailureSummary = buildGateFailureSummaryFromRuntime({
			runId: TEST_RUN_ID,
			report: RUNTIME_REPORT,
			reportPath: "real-runtime-simulation-report.json",
			cleanupPath: "runtime-cleanup-report.md",
		});
		expect(s.gate).toBe("real_business_simulation");
		expect(s.owner_role_id).toBe("superpowers:implementer");
		expect(s.retest_role_id).toBe("superpowers:runtime-simulator");
		expect(s.evidence_paths).toContain("real-runtime-simulation-report.json");
		expect(s.evidence_paths).toContain("runtime-cleanup-report.md");
	});

	it("uses blocked startup fallback when runtime is blocked with no scenario failure", () => {
		const blockedReport: RealRuntimeSimulationReport = {
			...RUNTIME_REPORT,
			status: "blocked",
			scenarios: [],
		};
		const s = buildGateFailureSummaryFromRuntime({
			runId: TEST_RUN_ID,
			report: blockedReport,
			reportPath: "report.json",
		});
		expect(s.status).toBe("blocked");
		expect(s.reason_zh).toBe("运行环境无法启动");
		expect(s.owner_role_id).toBe("superpowers:runtime-simulator");
	});

	it("uses non-blocked fallback reason when runtime is not blocked and no scenario failed", () => {
		const noFailureReport: RealRuntimeSimulationReport = {
			...RUNTIME_REPORT,
			scenarios: [],
		};
		const s = buildGateFailureSummaryFromRuntime({
			runId: TEST_RUN_ID,
			report: noFailureReport,
			reportPath: "report.json",
		});
		expect(s.status).toBe("repair_required");
		expect(s.reason_zh).toBe("真实业务环境模拟未通过");
	});

	it("normalizes runtime non-blocked status to repair_required", () => {
		const passedReport: RealRuntimeSimulationReport = {
			...RUNTIME_REPORT,
			status: "passed",
		};
		const s = buildGateFailureSummaryFromRuntime({
			runId: TEST_RUN_ID,
			report: passedReport,
			reportPath: "report.json",
		});
		expect(s.status).toBe("repair_required");
	});
});

describe("buildGateFailureSummaryFromMainAcceptance", () => {
	it("maps main acceptance fix-required result to GateFailureSummary with all expected fields", () => {
		const s: GateFailureSummary = buildGateFailureSummaryFromMainAcceptance({
			runId: TEST_RUN_ID,
			result: ACCEPTANCE_FIX_RESULT,
		});
		expect(s.gate).toBe("main_acceptance");
		expect(s.owner_role_id).toBe("superpowers:acceptance");
		expect(s.retest_role_id).toBe("superpowers:acceptance");
		expect(s.reason_zh).toBe("缺少必要的最终验证证据");
		expect(s.evidence_paths).toEqual(["未找到通过的命令输出"]);
		expect(s.next_action_zh).toBe("提供通过的命令输出作为证据");
	});
});

describe("renderGateFailureSummaryMarkdown and writeGateFailureSummaryArtifacts", () => {
	it("renders markdown and writes json/md artifacts for a single GateFailureSummary", async () => {
		const summary: GateFailureSummary = buildGateFailureSummaryFromAdvisorGate({
			runId: TEST_RUN_ID,
			record: ADVISOR_RECORD,
		});

		// Render
		const md = renderGateFailureSummaryMarkdown(summary);
		expect(md.length).toBeGreaterThan(0);
		expect(md).toContain("原因：");
		expect(md).toContain("打回角色：");
		expect(md).toContain("复测角色：");
		expect(md).toContain("证据：");
		expect(md).toContain("下一步：");

		// Write
		const tmp = await mkdtemp(join(tmpdir(), "gfs-test-"));
		currentTmpDir = tmp;
		const result = await writeGateFailureSummaryArtifacts({
			acceptingDir: tmp,
			summary,
		});
		await access(result.jsonPath);
		await access(result.markdownPath);
		expect(result.jsonPath).toMatch(/gate-failure-summary\.json$/);
		expect(result.markdownPath).toMatch(/gate-failure-summary\.md$/);
		const parsed = JSON.parse(await readFile(result.jsonPath, "utf8"));
		expect(parsed.gate).toBe("advisor_gate");
	});
});

// ---------------------------------------------------------------------------
// Additional must-fix evidence tests
// ---------------------------------------------------------------------------

describe("buildGateFailureSummaryFromGlobalImpact — must-fix behaviors", () => {
	it("uses finding.description as reason_zh", () => {
		const s = buildGateFailureSummaryFromGlobalImpact({
			runId: TEST_RUN_ID,
			report: GLOBAL_IMPACT_REPORT,
			reportPath: "global-impact-report.json",
		});
		expect(s.reason_zh).toBe("No passing test evidence for task T01");
	});

	it("normalizes non-blocked status to repair_required", () => {
		const acceptedReport: GlobalImpactReport = {
			...GLOBAL_IMPACT_REPORT,
			status: "accepted",
		};
		const s = buildGateFailureSummaryFromGlobalImpact({
			runId: TEST_RUN_ID,
			report: acceptedReport,
			reportPath: "global-impact-report.json",
		});
		expect(s.status).toBe("repair_required");
	});

	it("preserves blocked status", () => {
		const blockedReport: GlobalImpactReport = {
			...GLOBAL_IMPACT_REPORT,
			status: "blocked",
		};
		const s = buildGateFailureSummaryFromGlobalImpact({
			runId: TEST_RUN_ID,
			report: blockedReport,
			reportPath: "global-impact-report.json",
		});
		expect(s.status).toBe("blocked");
	});

	it("uses fallback reason when no findings exist and owner falls back to impact-reviewer", () => {
		const emptyReport: GlobalImpactReport = {
			...GLOBAL_IMPACT_REPORT,
			findings: [],
		};
		const s = buildGateFailureSummaryFromGlobalImpact({
			runId: TEST_RUN_ID,
			report: emptyReport,
			reportPath: "global-impact-report.json",
		});
		expect(s.reason_zh).toBe("Global Impact Gate 返回非 accepted 状态");
		expect(s.owner_role_id).toBe("superpowers:impact-reviewer");
	});
});

describe("buildGateFailureSummaryFromMainAcceptance — must-fix behaviors", () => {
	it("maps verification category to test-runner owner with test-runner retest", () => {
		const verResult: MainThreadAcceptanceFixRequiredResult = {
			...ACCEPTANCE_FIX_RESULT,
			must_fix_items: [{ ...MUST_FIX_ITEMS[0], category: "verification" }],
		};
		const s = buildGateFailureSummaryFromMainAcceptance({
			runId: TEST_RUN_ID,
			result: verResult,
		});
		expect(s.owner_role_id).toBe("superpowers:test-runner");
		expect(s.retest_role_id).toBe("superpowers:test-runner");
	});

	it("maps scope category to spec-reviewer owner with acceptance retest", () => {
		const scopeResult: MainThreadAcceptanceFixRequiredResult = {
			...ACCEPTANCE_FIX_RESULT,
			must_fix_items: [{ ...MUST_FIX_ITEMS[0], category: "scope" }],
		};
		const s = buildGateFailureSummaryFromMainAcceptance({
			runId: TEST_RUN_ID,
			result: scopeResult,
		});
		expect(s.owner_role_id).toBe("superpowers:spec-reviewer");
		expect(s.retest_role_id).toBe("superpowers:acceptance");
	});

	it("maps default unknown category to advisor owner with acceptance retest", () => {
		const defaultResult: MainThreadAcceptanceFixRequiredResult = {
			...ACCEPTANCE_FIX_RESULT,
			must_fix_items: [{ ...MUST_FIX_ITEMS[0], category: "packet" }],
		};
		const s = buildGateFailureSummaryFromMainAcceptance({
			runId: TEST_RUN_ID,
			result: defaultResult,
		});
		expect(s.owner_role_id).toBe("superpowers:advisor");
		expect(s.retest_role_id).toBe("superpowers:acceptance");
	});

	it("uses fallback values when must_fix_items is empty", () => {
		const emptyResult: MainThreadAcceptanceFixRequiredResult = {
			result: "MAIN_ACCEPTANCE_FIX_REQUIRED",
			review_round: 1,
			must_fix_items: [],
			next_task: "OmpFixExecutionTask",
		};
		const s = buildGateFailureSummaryFromMainAcceptance({
			runId: TEST_RUN_ID,
			result: emptyResult,
		});
		expect(s.reason_zh).toBe("Main Acceptance 返回修复要求");
		expect(s.owner_role_id).toBe("superpowers:advisor");
		expect(s.evidence_paths).toEqual([]);
		expect(s.next_action_zh).toBe("Main Acceptance 返回修复要求");
	});
});

describe("renderGateFailureSummaryMarkdown — flat format verification", () => {
	it("renders markdown in plan flat format with title_zh and ✘ prefix", () => {
		const summary = buildGateFailureSummaryFromAdvisorGate({
			runId: TEST_RUN_ID,
			record: ADVISOR_RECORD,
		});
		const md = renderGateFailureSummaryMarkdown(summary);
		expect(md).toMatch(
			/^# Advisor Gate 未通过\n\n✘ Advisor Gate 未通过\n原因：缺少测试覆盖：核心模块缺少单元测试\n打回角色：superpowers:test-writer（\S+）\n复测角色：superpowers:advisor（\S+）\n证据：src\/core\.rs\n证据：src\/lib\.rs\n下一步：请修复后重新提交$/,
		);
	});
});
