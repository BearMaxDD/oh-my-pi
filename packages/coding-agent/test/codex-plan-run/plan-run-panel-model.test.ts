import { describe, expect, it } from "bun:test";
import type { GateFailureSummary } from "../../src/codex-plan-run/gate-failure-summary";
import {
	type BuildPlanRunPanelViewModelInput,
	buildPlanRunPanelViewModel,
	type PlanRunPanelGate,
	type PlanRunPanelViewModel,
	type ReadPlanRunPanelArtifactsInput,
	readPlanRunPanelArtifacts,
	renderPlanRunPanelText,
} from "../../src/codex-plan-run/plan-run-panel-model";
import type { RealRuntimeSimulationReport } from "../../src/codex-plan-run/real-runtime-simulation";
import type { TodoSnapshot } from "../../src/codex-plan-run/types";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function minimalTodoSnapshot(overrides: Partial<TodoSnapshot> = {}): TodoSnapshot {
	return {
		runId: "run-abc",
		version: 1,
		state: "main_acceptance_fix_required",
		updatedAt: "2026-07-02T00:00:00.000Z",
		source: "state-machine",
		phases: [
			{
				name: "Codex Plan Protocol",
				tasks: [
					{ content: "Project recon", status: "completed" },
					{ content: "Main plan ready", status: "completed" },
				],
			},
			{
				name: "Plan Execution Book Tasks",
				tasks: [
					{ content: "Task 7: panel model", status: "in_progress" },
					{ content: "Task 8: settings", status: "pending" },
				],
			},
		],
		...overrides,
	};
}

function gateFailureSummary(overrides: Partial<GateFailureSummary> = {}): GateFailureSummary {
	return {
		schema_version: "superpowers.gate_failure_summary.v1",
		run_id: "run-abc",
		gate: "advisor_gate",
		status: "repair_required",
		title_zh: "顾问门未通过",
		reason_zh: "发现阻塞性发现",
		owner_role_id: "tdd-writer",
		owner_role_label_zh: "TDD 编写者",
		retest_role_id: "code-reviewer",
		retest_role_label_zh: "代码审查者",
		evidence_paths: [".omp/plan-runs/run-abc/advisor-gate.json"],
		next_action_zh: "修复阻塞性发现并重新运行",
		...overrides,
	};
}

function runtimeReport(overrides: Partial<RealRuntimeSimulationReport> = {}): RealRuntimeSimulationReport {
	return {
		schema_version: "superpowers.real_runtime_simulation.v1",
		run_id: "run-abc",
		started_at: "2026-07-02T00:00:00.000Z",
		finished_at: "2026-07-02T01:00:00.000Z",
		environment: { environment_type: "node", startup_status: "passed" },
		scenarios: [
			{ scenario_id: "S1", status: "passed", executed_steps: [], evidence_paths: [] },
			{
				scenario_id: "S2",
				status: "failed",
				executed_steps: [],
				evidence_paths: [],
				failure_summary_zh: "断言失败",
			},
			{ scenario_id: "S3", status: "blocked", executed_steps: [], evidence_paths: [] },
		],
		logs: [],
		screenshots: [],
		status: "repair_required",
		...overrides,
	};
}

// ─── Snapshot-driven panel model ───────────────────────────────────────────

describe("buildPlanRunPanelViewModel — snapshot-driven panel model", () => {
	it("derives runId from todoSnapshot", () => {
		const input: BuildPlanRunPanelViewModelInput = { todoSnapshot: minimalTodoSnapshot() };
		const vm = buildPlanRunPanelViewModel(input);
		expect(vm.runId).toBe("run-abc");
	});

	it("falls back to gateSummary run_id when todoSnapshot is missing", () => {
		const input: BuildPlanRunPanelViewModelInput = { gateSummary: gateFailureSummary({ run_id: "run-gate" }) };
		const vm = buildPlanRunPanelViewModel(input);
		expect(vm.runId).toBe("run-gate");
	});

	it("falls back to runtimeReport run_id when both todoSnapshot and gateSummary are missing", () => {
		const input: BuildPlanRunPanelViewModelInput = { runtimeReport: runtimeReport({ run_id: "run-runtime" }) };
		const vm = buildPlanRunPanelViewModel(input);
		expect(vm.runId).toBe("run-runtime");
	});

	it("uses 'unknown' when no source provides a runId", () => {
		const input: BuildPlanRunPanelViewModelInput = {};
		const vm = buildPlanRunPanelViewModel(input);
		expect(vm.runId).toBe("unknown");
	});

	it("derives state from todoSnapshot", () => {
		const input: BuildPlanRunPanelViewModelInput = { todoSnapshot: minimalTodoSnapshot() };
		const vm = buildPlanRunPanelViewModel(input);
		expect(vm.state).toBe("main_acceptance_fix_required");
	});

	it("falls back to 'unknown' state when todoSnapshot is absent", () => {
		const input: BuildPlanRunPanelViewModelInput = { gateSummary: gateFailureSummary() };
		const vm = buildPlanRunPanelViewModel(input);
		expect(vm.state).toBe("unknown");
	});

	it("maps advisor_gate to PlanRunPanelGate.kind 'advisor'", () => {
		const input: BuildPlanRunPanelViewModelInput = {
			gateSummary: gateFailureSummary({ gate: "advisor_gate", status: "repair_required" }),
		};
		const vm = buildPlanRunPanelViewModel(input);
		expect(vm.activeGate).not.toBeNull();
		expect(vm.activeGate!.kind).toBe("advisor");
		expect(vm.activeGate!.status).toBe("repair_required");
	});

	it("maps global_impact gate with Chinese fields", () => {
		const input: BuildPlanRunPanelViewModelInput = {
			gateSummary: gateFailureSummary({
				gate: "global_impact",
				title_zh: "全局影响不通过",
				reason_zh: "有破坏性变更",
				next_action_zh: "回滚",
			}),
		};
		const vm = buildPlanRunPanelViewModel(input);
		expect(vm.activeGate).not.toBeNull();
		expect(vm.activeGate!.kind).toBe("global_impact");
		expect(vm.activeGate!.title_zh).toBe("全局影响不通过");
		expect(vm.activeGate!.reason_zh).toBe("有破坏性变更");
		expect(vm.activeGate!.next_action_zh).toBe("回滚");
	});

	it("maps real_business_simulation gate", () => {
		const input: BuildPlanRunPanelViewModelInput = {
			gateSummary: gateFailureSummary({ gate: "real_business_simulation" }),
		};
		const vm = buildPlanRunPanelViewModel(input);
		expect(vm.activeGate!.kind).toBe("real_business_simulation");
	});

	it("maps unknown gate kind to main_acceptance", () => {
		const input: BuildPlanRunPanelViewModelInput = {
			gateSummary: gateFailureSummary({ gate: "unknown_gate" as GateFailureSummary["gate"] }),
		};
		const vm = buildPlanRunPanelViewModel(input);
		expect(vm.activeGate!.kind).toBe("main_acceptance");
	});

	it("sets activeGate to null when no gateSummary is provided", () => {
		const input: BuildPlanRunPanelViewModelInput = { todoSnapshot: minimalTodoSnapshot() };
		const vm = buildPlanRunPanelViewModel(input);
		expect(vm.activeGate).toBeNull();
	});

	it("parses todoSnapshot phases into tasks", () => {
		const input: BuildPlanRunPanelViewModelInput = { todoSnapshot: minimalTodoSnapshot() };
		const vm = buildPlanRunPanelViewModel(input);
		expect(vm.tasks).toHaveLength(2);
		expect(vm.tasks[0].phase).toBe("Codex Plan Protocol");
		expect(vm.tasks[0].tasks).toHaveLength(2);
		expect(vm.tasks[0].tasks[0].content).toBe("Project recon");
		expect(vm.tasks[0].tasks[0].status).toBe("completed");
		expect(vm.tasks[1].phase).toBe("Plan Execution Book Tasks");
		expect(vm.tasks[1].tasks[1].content).toBe("Task 8: settings");
		expect(vm.tasks[1].tasks[1].status).toBe("pending");
	});

	it("provides empty tasks when todoSnapshot has no phases", () => {
		const input: BuildPlanRunPanelViewModelInput = { todoSnapshot: minimalTodoSnapshot({ phases: [] }) };
		const vm = buildPlanRunPanelViewModel(input);
		expect(vm.tasks).toEqual([]);
	});

	it("provides empty tasks when todoSnapshot is absent", () => {
		const input: BuildPlanRunPanelViewModelInput = { gateSummary: gateFailureSummary() };
		const vm = buildPlanRunPanelViewModel(input);
		expect(vm.tasks).toEqual([]);
	});

	it("does not throw on phases with unfamiliar structure", () => {
		const snapshot = minimalTodoSnapshot({
			phases: [
				{
					name: "Unknown Phase",
					tasks: [{ content: "weird task", status: "pending", unknownField: true } as never],
				},
			],
		});
		const input: BuildPlanRunPanelViewModelInput = { todoSnapshot: snapshot };
		expect(() => buildPlanRunPanelViewModel(input)).not.toThrow();
		const vm = buildPlanRunPanelViewModel(input);
		expect(vm.tasks[0].tasks[0].content).toBe("weird task");
	});
	it("populates blockers with gate failure details when gateSummary is provided", () => {
		const input: BuildPlanRunPanelViewModelInput = {
			gateSummary: gateFailureSummary({
				gate: "global_impact",
				reason_zh: "有破坏性变更",
				owner_role_id: "tdd-writer",
				retest_role_id: "code-reviewer",
				evidence_paths: [".omp/plan-runs/run-abc/global-impact.json"],
				next_action_zh: "回滚并重新运行",
			}),
		};
		const vm = buildPlanRunPanelViewModel(input);
		expect(vm.blockers).toHaveLength(1);
		expect(vm.blockers[0].gate).toBe("global_impact");
		expect(vm.blockers[0].reasonZh).toBe("有破坏性变更");
		expect(vm.blockers[0].ownerRoleId).toBe("tdd-writer");
		expect(vm.blockers[0].retestRoleId).toBe("code-reviewer");
		expect(vm.blockers[0].evidencePaths).toEqual([".omp/plan-runs/run-abc/global-impact.json"]);
		expect(vm.blockers[0].nextActionZh).toBe("回滚并重新运行");
	});

	it("sets empty blockers when no gateSummary is provided", () => {
		const input: BuildPlanRunPanelViewModelInput = { todoSnapshot: minimalTodoSnapshot() };
		const vm = buildPlanRunPanelViewModel(input);
		expect(vm.blockers).toEqual([]);
	});
});
// ─── Runtime report scenario counts ────────────────────────────────────────

describe("buildPlanRunPanelViewModel — runtime report scenario counts", () => {
	it("passes through runtime status from report", () => {
		const input: BuildPlanRunPanelViewModelInput = {
			runtimeReport: runtimeReport({ status: "passed" }),
		};
		const vm = buildPlanRunPanelViewModel(input);
		expect(vm.runtime.status).toBe("passed");
	});

	it("counts total, passed, failed, and blocked scenarios", () => {
		const input: BuildPlanRunPanelViewModelInput = {
			runtimeReport: runtimeReport({
				scenarios: [
					{ scenario_id: "S1", status: "passed", executed_steps: [], evidence_paths: [] },
					{ scenario_id: "S2", status: "passed", executed_steps: [], evidence_paths: [] },
					{ scenario_id: "S3", status: "failed", executed_steps: [], evidence_paths: [] },
					{ scenario_id: "S4", status: "blocked", executed_steps: [], evidence_paths: [] },
				],
			}),
		};
		const vm = buildPlanRunPanelViewModel(input);
		expect(vm.runtime.totalScenarios).toBe(4);
		expect(vm.runtime.scenariosPassed).toBe(2);
		expect(vm.runtime.scenariosFailed).toBe(1);
		expect(vm.runtime.scenariosBlocked).toBe(1);
	});

	it("handles empty scenarios array", () => {
		const input: BuildPlanRunPanelViewModelInput = {
			runtimeReport: runtimeReport({ scenarios: [] }),
		};
		const vm = buildPlanRunPanelViewModel(input);
		expect(vm.runtime.totalScenarios).toBe(0);
		expect(vm.runtime.scenariosPassed).toBe(0);
		expect(vm.runtime.scenariosFailed).toBe(0);
		expect(vm.runtime.scenariosBlocked).toBe(0);
	});

	it("exposes scenario entries with id and status", () => {
		const input: BuildPlanRunPanelViewModelInput = {
			runtimeReport: runtimeReport({
				scenarios: [{ scenario_id: "S1", status: "passed", executed_steps: [], evidence_paths: [] }],
			}),
		};
		const vm = buildPlanRunPanelViewModel(input);
		expect(vm.runtime.scenarios).toHaveLength(1);
		expect(vm.runtime.scenarios[0].scenario_id).toBe("S1");
		expect(vm.runtime.scenarios[0].status).toBe("passed");
	});

	it("returns 'unknown' runtime status when report is absent", () => {
		const input: BuildPlanRunPanelViewModelInput = { todoSnapshot: minimalTodoSnapshot() };
		const vm = buildPlanRunPanelViewModel(input);
		expect(vm.runtime.status).toBe("unknown");
		expect(vm.runtime.totalScenarios).toBe(0);
		expect(vm.runtime.scenarios).toEqual([]);
	});

	it("treats unknown scenario status as unknown in scenario entries", () => {
		const input: BuildPlanRunPanelViewModelInput = {
			runtimeReport: runtimeReport({
				scenarios: [{ scenario_id: "S-x", status: "unknown", executed_steps: [], evidence_paths: [] } as never],
			}),
		};
		const vm = buildPlanRunPanelViewModel(input);
		expect(vm.runtime.scenarios[0].status as string).toBe("unknown");
		// The scenario still contributes to totalScenarios but not to any specific count bucket
		expect(vm.runtime.totalScenarios).toBe(1);
		expect(vm.runtime.scenariosPassed).toBe(0);
		expect(vm.runtime.scenariosFailed).toBe(0);
		expect(vm.runtime.scenariosBlocked).toBe(0);
	});

	it("propagates cleanupStatus from runtime report", () => {
		const input: BuildPlanRunPanelViewModelInput = {
			runtimeReport: runtimeReport({ cleanup_status: "failed" }),
		};
		const vm = buildPlanRunPanelViewModel(input);
		expect(vm.runtime.cleanupStatus).toBe("failed");
	});

	it("omits cleanupStatus when cleanup_status is absent from runtime report", () => {
		const input: BuildPlanRunPanelViewModelInput = {
			runtimeReport: runtimeReport({}),
		};
		const vm = buildPlanRunPanelViewModel(input);
		expect(vm.runtime.cleanupStatus).toBeUndefined();
	});
});

// ─── Artifact JSON parsing and degradation ────────────────────────────────

describe("readPlanRunPanelArtifacts — artifact JSON parsing and degradation", () => {
	it("returns a fully populated model when both artifacts exist", async () => {
		const readText = async (path: string): Promise<string> => {
			if (path.includes("gate-failure-summary")) {
				return JSON.stringify(gateFailureSummary());
			}
			if (path.includes("real-runtime-simulation-report")) {
				return JSON.stringify(runtimeReport());
			}
			throw new Error("File not found");
		};

		const input: ReadPlanRunPanelArtifactsInput = {
			readText,
			gateFailureSummaryPath: "/artifacts/gate-failure-summary.json",
			runtimeSimulationReportPath: "/artifacts/real-runtime-simulation-report.json",
		};

		const vm = await readPlanRunPanelArtifacts(input);
		expect(vm.runId).toBe("run-abc");
		expect(vm.activeGate).not.toBeNull();
		expect(vm.runtime.status).toBe("repair_required");
		expect(vm.degradedReasons).toEqual([]);
	});

	it("appends degradedReason when gate-failure-summary JSON is invalid", async () => {
		const readText = async (path: string): Promise<string> => {
			if (path.includes("gate-failure-summary")) {
				return "not json";
			}
			if (path.includes("real-runtime-simulation-report")) {
				return JSON.stringify(runtimeReport());
			}
			throw new Error("File not found");
		};

		const input: ReadPlanRunPanelArtifactsInput = {
			readText,
			gateFailureSummaryPath: "/artifacts/gate-failure-summary.json",
		};

		const vm = await readPlanRunPanelArtifacts(input);
		expect(vm.degradedReasons).toHaveLength(1);
		expect(vm.degradedReasons[0]).toContain("gate-failure-summary");
	});

	it("appends degradedReason when runtime report JSON is invalid", async () => {
		const readText = async (_path: string): Promise<string> => {
			return "bad json";
		};

		const input: ReadPlanRunPanelArtifactsInput = {
			readText,
			runtimeSimulationReportPath: "/artifacts/report.json",
		};

		const vm = await readPlanRunPanelArtifacts(input);
		expect(vm.degradedReasons).toHaveLength(1);
		expect(vm.degradedReasons[0]).toContain("runtime-simulation-report");
	});

	it("appends degradedReason when both files have invalid JSON", async () => {
		const readText = async (_path: string): Promise<string> => {
			return "{{{ broken";
		};

		const input: ReadPlanRunPanelArtifactsInput = {
			readText,
			gateFailureSummaryPath: "/a.json",
			runtimeSimulationReportPath: "/b.json",
		};

		const vm = await readPlanRunPanelArtifacts(input);
		expect(vm.degradedReasons).toHaveLength(2);
		expect(vm.degradedReasons[0]).toContain("gate-failure-summary");
		expect(vm.degradedReasons[1]).toContain("runtime-simulation-report");
	});

	it("does not throw when readText throws for an artifact path", async () => {
		const readText = async (_path: string): Promise<string> => {
			throw new Error("ENOENT");
		};

		const input: ReadPlanRunPanelArtifactsInput = {
			readText,
			gateFailureSummaryPath: "/does/not/exist.json",
		};

		const vm = await readPlanRunPanelArtifacts(input);
		expect(vm.degradedReasons).toHaveLength(1);
		expect(vm.degradedReasons[0]).toContain("gate-failure-summary");
	});

	it("returns a degraded-but-usable model when no paths are provided", async () => {
		const input: ReadPlanRunPanelArtifactsInput = {
			readText: async () => "",
		};

		const vm = await readPlanRunPanelArtifacts(input);
		expect(vm.runId).toBe("unknown");
		expect(vm.state).toBe("unknown");
		expect(vm.activeGate).toBeNull();
		expect(vm.degradedReasons).toEqual([]);
	});

	it("builds a valid model even when only one artifact is provided", async () => {
		const readText = async (path: string): Promise<string> => {
			if (path.includes("gate-failure-summary")) {
				return JSON.stringify(gateFailureSummary({ gate: "global_impact" }));
			}
			throw new Error("not found");
		};

		const input: ReadPlanRunPanelArtifactsInput = {
			readText,
			gateFailureSummaryPath: "/artifacts/gate-failure-summary.json",
		};

		const vm = await readPlanRunPanelArtifacts(input);
		expect(vm.activeGate!.kind).toBe("global_impact");
		expect(vm.runtime.status).toBe("unknown");
	});

	it("merges degradedReasons from buildPlanRunPanelViewModel input when present", async () => {
		const readText = async (path: string): Promise<string> => {
			if (path.includes("gate-failure-summary")) {
				return JSON.stringify(gateFailureSummary());
			}
			throw new Error("not found");
		};

		const input: ReadPlanRunPanelArtifactsInput = {
			readText,
			gateFailureSummaryPath: "/artifacts/gate-failure-summary.json",
		};

		const vm = await readPlanRunPanelArtifacts(input);
		expect(vm.degradedReasons).toHaveLength(0); // no degradation here
	});
});

// ─── Type-level smoke tests ───────────────────────────────────────────────────

describe("exported types", () => {
	it("PlanRunPanelGate is a well-typed interface", () => {
		const gate: PlanRunPanelGate = { kind: "advisor", status: "blocked" };
		expect(gate.kind).toBe("advisor");
	});

	it("PlanRunPanelViewModel has expected top-level keys", () => {
		const vm: PlanRunPanelViewModel = buildPlanRunPanelViewModel({});
		expect(vm).toHaveProperty("runId");
		expect(vm).toHaveProperty("state");
		expect(vm).toHaveProperty("activeGate");
		expect(vm).toHaveProperty("blockers");
		expect(vm).toHaveProperty("runtime");
		expect(vm).toHaveProperty("tasks");
		expect(vm).toHaveProperty("degradedReasons");
	});
});

// ─── renderPlanRunPanelText — panel text rendering ────────────────────────

describe("renderPlanRunPanelText — panel text rendering", () => {
	it("includes run id and state", () => {
		const vm: PlanRunPanelViewModel = {
			runId: "run-xyz",
			state: "executing",
			activeGate: null,
			blockers: [],
			runtime: {
				status: "unknown",
				scenarios: [],
				totalScenarios: 0,
				scenariosPassed: 0,
				scenariosFailed: 0,
				scenariosBlocked: 0,
			},
			tasks: [],
			degradedReasons: [],
		};
		const text = renderPlanRunPanelText(vm);
		expect(text).toContain("run-xyz");
		expect(text).toContain("executing");
	});

	it("includes active gate when present", () => {
		const vm: PlanRunPanelViewModel = {
			runId: "run-abc",
			state: "repair_required",
			activeGate: {
				kind: "advisor",
				status: "repair_required",
				reason_zh: "发现阻塞性发现",
				next_action_zh: "修复并重新运行",
			},
			blockers: [],
			runtime: {
				status: "repair_required",
				scenarios: [],
				totalScenarios: 0,
				scenariosPassed: 0,
				scenariosFailed: 0,
				scenariosBlocked: 0,
			},
			tasks: [],
			degradedReasons: [],
		};
		const text = renderPlanRunPanelText(vm);
		expect(text).toContain("advisor");
		expect(text).toContain("repair_required");
		expect(text).toContain("发现阻塞性发现");
		expect(text).toContain("修复并重新运行");
	});

	it("includes runtime counts", () => {
		const vm: PlanRunPanelViewModel = {
			runId: "run-abc",
			state: "executing",
			activeGate: null,
			blockers: [],
			runtime: {
				status: "repair_required",
				scenarios: [],
				totalScenarios: 3,
				scenariosPassed: 1,
				scenariosFailed: 1,
				scenariosBlocked: 1,
			},
			tasks: [],
			degradedReasons: [],
		};
		const text = renderPlanRunPanelText(vm);
		expect(text).toContain("3");
		expect(text).toContain("1");
	});

	it("omits empty runtime counts when no runtime report data is present", () => {
		const vm: PlanRunPanelViewModel = {
			runId: "run-abc",
			state: "executing",
			activeGate: null,
			blockers: [],
			runtime: {
				status: "unknown",
				scenarios: [],
				totalScenarios: 0,
				scenariosPassed: 0,
				scenariosFailed: 0,
				scenariosBlocked: 0,
			},
			tasks: [],
			degradedReasons: [],
		};
		const text = renderPlanRunPanelText(vm);
		expect(text).not.toContain("0p 0f 0b");
		expect(text).toContain("run-abc");
	});

	it("includes cleanup status when set", () => {
		const vm: PlanRunPanelViewModel = {
			runId: "run-abc",
			state: "executing",
			activeGate: null,
			blockers: [],
			runtime: {
				status: "blocked",
				scenarios: [],
				totalScenarios: 2,
				scenariosPassed: 1,
				scenariosFailed: 0,
				scenariosBlocked: 1,
				cleanupStatus: "blocked",
			},
			tasks: [],
			degradedReasons: [],
		};
		const text = renderPlanRunPanelText(vm);
		expect(text).toContain("cleanup");
		expect(text).toContain("blocked");
	});

	it("includes blockers with gate, reason, owner, retest, evidence, next action", () => {
		const vm: PlanRunPanelViewModel = {
			runId: "run-abc",
			state: "repair_required",
			activeGate: null,
			blockers: [
				{
					gate: "global_impact",
					reasonZh: "有破坏性变更",
					ownerRoleId: "tdd-writer",
					retestRoleId: "code-reviewer",
					evidencePaths: [".omp/plan-runs/run-abc/global-impact.json"],
					nextActionZh: "回滚并重新运行",
				},
			],
			runtime: {
				status: "repair_required",
				scenarios: [],
				totalScenarios: 0,
				scenariosPassed: 0,
				scenariosFailed: 0,
				scenariosBlocked: 0,
			},
			tasks: [],
			degradedReasons: [],
		};
		const text = renderPlanRunPanelText(vm);
		expect(text).toContain("global_impact");
		expect(text).toContain("有破坏性变更");
		expect(text).toContain("tdd-writer");
		expect(text).toContain("code-reviewer");
		expect(text).toContain(".omp/plan-runs/run-abc/global-impact.json");
		expect(text).toContain("回滚并重新运行");
	});

	it("includes degraded reasons", () => {
		const vm: PlanRunPanelViewModel = {
			runId: "run-abc",
			state: "degraded",
			activeGate: null,
			blockers: [],
			runtime: {
				status: "unknown",
				scenarios: [],
				totalScenarios: 0,
				scenariosPassed: 0,
				scenariosFailed: 0,
				scenariosBlocked: 0,
			},
			tasks: [],
			degradedReasons: ["gate-failure-summary JSON parse failed", "runtime-simulation-report JSON parse failed"],
		};
		const text = renderPlanRunPanelText(vm);
		expect(text).toContain("degraded");
		expect(text).toContain("gate-failure-summary");
		expect(text).toContain("runtime-simulation-report");
	});

	it("returns empty string for minimal empty model", () => {
		const vm: PlanRunPanelViewModel = {
			runId: "unknown",
			state: "unknown",
			activeGate: null,
			blockers: [],
			runtime: {
				status: "unknown",
				scenarios: [],
				totalScenarios: 0,
				scenariosPassed: 0,
				scenariosFailed: 0,
				scenariosBlocked: 0,
			},
			tasks: [],
			degradedReasons: [],
		};
		const text = renderPlanRunPanelText(vm);
		expect(text).toBe("");
	});

	it("renders a complete blocked panel with all fields", () => {
		const vm: PlanRunPanelViewModel = {
			runId: "run-blocked",
			state: "main_acceptance_fix_required",
			activeGate: { kind: "advisor", status: "blocked", reason_zh: "阻塞性发现", next_action_zh: "修复" },
			blockers: [
				{
					gate: "advisor_gate",
					reasonZh: "发现阻塞性发现",
					ownerRoleId: "tdd-writer",
					retestRoleId: "code-reviewer",
					evidencePaths: [".omp/plan-runs/run-blocked/advisor-gate.json"],
					nextActionZh: "修复阻塞性发现并重新运行",
				},
			],
			runtime: {
				status: "blocked",
				scenarios: [
					{ scenario_id: "S1", status: "passed" },
					{ scenario_id: "S2", status: "failed" },
					{ scenario_id: "S3", status: "blocked" },
				],
				totalScenarios: 3,
				scenariosPassed: 1,
				scenariosFailed: 1,
				scenariosBlocked: 1,
				cleanupStatus: "blocked",
			},
			tasks: [],
			degradedReasons: ["gate-failure-summary JSON parse error"],
		};
		const text = renderPlanRunPanelText(vm);
		expect(text).toContain("run-blocked");
		expect(text).toContain("main_acceptance_fix_required");
		expect(text).toContain("advisor");
		expect(text).toContain("阻塞性发现");
		expect(text).toContain("cleanup");
		expect(text).toContain("blocked");
		expect(text).toContain("tdd-writer");
		expect(text).toContain("code-reviewer");
		expect(text).toContain(".omp/plan-runs/run-blocked/advisor-gate.json");
		expect(text).toContain("修复阻塞性发现并重新运行");
		expect(text).toContain("degraded");
		expect(text).toContain("gate-failure-summary JSON parse error");
	});
});
