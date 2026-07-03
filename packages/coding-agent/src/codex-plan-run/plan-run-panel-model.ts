import type { GateFailureSummary } from "./gate-failure-summary";
import type { RealRuntimeSimulationReport, ScenarioExecutionResult } from "./real-runtime-simulation";
import type { TodoSnapshot } from "./types";

// ---------------------------------------------------------------------------
// Exported types
// ---------------------------------------------------------------------------

export interface PlanRunPanelGate {
	kind: "advisor" | "global_impact" | "real_business_simulation" | "main_acceptance";
	status: "passed" | "repair_required" | "blocked" | "pending" | "running";
	title_zh?: string;
	reason_zh?: string;
	next_action_zh?: string;
}

export interface PlanRunPanelViewModel {
	runId: string;
	state: string;
	activeGate: PlanRunPanelGate | null;
	blockers: Array<{
		gate: string;
		reasonZh: string;
		ownerRoleId: string;
		retestRoleId: string;
		evidencePaths: string[];
		nextActionZh: string;
	}>;
	runtime: {
		status: "passed" | "repair_required" | "blocked" | "unknown";
		scenarios: Array<Pick<ScenarioExecutionResult, "scenario_id" | "status">>;
		totalScenarios: number;
		scenariosPassed: number;
		scenariosFailed: number;
		scenariosBlocked: number;
		cleanupStatus?: "passed" | "failed" | "blocked";
	};
	tasks: Array<{
		phase: string;
		tasks: Array<{ content: string; status: string }>;
	}>;
	degradedReasons: string[];
}

export interface BuildPlanRunPanelViewModelInput {
	todoSnapshot?: TodoSnapshot;
	gateSummary?: GateFailureSummary;
	runtimeReport?: RealRuntimeSimulationReport;
	degradedReasons?: string[];
}

export interface ReadPlanRunPanelArtifactsInput {
	readText: (path: string) => Promise<string>;
	gateFailureSummaryPath?: string;
	runtimeSimulationReportPath?: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const GATE_KIND_MAP: Record<string, PlanRunPanelGate["kind"]> = {
	advisor_gate: "advisor",
	global_impact: "global_impact",
	real_business_simulation: "real_business_simulation",
};

function mapGateKind(kind: string): PlanRunPanelGate["kind"] {
	return GATE_KIND_MAP[kind] ?? "main_acceptance";
}

function mapRuntimeStatus(raw: string): PlanRunPanelViewModel["runtime"]["status"] {
	if (raw === "passed" || raw === "blocked") return raw;
	return "repair_required";
}

interface TasksEntry {
	phase: string;
	tasks: Array<{ content: string; status: string }>;
}

function parseTasks(phases: TodoSnapshot["phases"] | undefined): TasksEntry[] {
	if (!phases) return [];

	return phases.map(phase => ({
		phase: phase.name ?? "",
		tasks: (phase.tasks ?? []).map(task => ({
			content: task.content ?? "",
			status: task.status ?? "pending",
		})),
	}));
}

function computeRuntime(report: RealRuntimeSimulationReport | undefined): PlanRunPanelViewModel["runtime"] {
	if (!report) {
		return {
			status: "unknown",
			scenarios: [],
			totalScenarios: 0,
			scenariosPassed: 0,
			scenariosFailed: 0,
			scenariosBlocked: 0,
		};
	}

	const scenarios =
		report.scenarios?.map(s => ({
			scenario_id: s.scenario_id,
			status: s.status,
		})) ?? [];

	const totalScenarios = scenarios.length;
	const scenariosPassed = scenarios.filter(s => s.status === "passed").length;
	const scenariosFailed = scenarios.filter(s => s.status === "failed").length;
	const scenariosBlocked = scenarios.filter(s => s.status === "blocked").length;

	return {
		status: mapRuntimeStatus(report.status ?? "passed"),
		scenarios,
		totalScenarios,
		scenariosPassed,
		scenariosFailed,
		scenariosBlocked,
		...(report.cleanup_status ? { cleanupStatus: report.cleanup_status } : {}),
	};
}

function computeActiveGate(gateSummary: GateFailureSummary | undefined): PlanRunPanelGate | null {
	if (!gateSummary) return null;

	return {
		kind: mapGateKind(gateSummary.gate),
		status: gateSummary.status === "blocked" ? "blocked" : "repair_required",
		title_zh: gateSummary.title_zh,
		reason_zh: gateSummary.reason_zh,
		next_action_zh: gateSummary.next_action_zh,
	};
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

export function buildPlanRunPanelViewModel(input: BuildPlanRunPanelViewModelInput): PlanRunPanelViewModel {
	const { todoSnapshot, gateSummary, runtimeReport, degradedReasons = [] } = input;

	const runId = todoSnapshot?.runId ?? gateSummary?.run_id ?? runtimeReport?.run_id ?? "unknown";

	const state = todoSnapshot?.state ?? "unknown";

	const activeGate = computeActiveGate(gateSummary);

	const blockers: PlanRunPanelViewModel["blockers"] = gateSummary
		? [
				{
					gate: gateSummary.gate,
					reasonZh: gateSummary.reason_zh,
					ownerRoleId: gateSummary.owner_role_id,
					retestRoleId: gateSummary.retest_role_id,
					evidencePaths: gateSummary.evidence_paths,
					nextActionZh: gateSummary.next_action_zh,
				},
			]
		: [];

	const runtime = computeRuntime(runtimeReport);

	const tasks = parseTasks(todoSnapshot?.phases);

	return {
		runId,
		state,
		activeGate,
		blockers,
		runtime,
		tasks,
		degradedReasons,
	};
}

export async function readPlanRunPanelArtifacts(input: ReadPlanRunPanelArtifactsInput): Promise<PlanRunPanelViewModel> {
	const { readText, gateFailureSummaryPath, runtimeSimulationReportPath } = input;
	const degradedReasons: string[] = [];

	let gateSummary: GateFailureSummary | undefined;
	if (gateFailureSummaryPath) {
		try {
			const text = await readText(gateFailureSummaryPath);
			gateSummary = JSON.parse(text) as GateFailureSummary;
		} catch {
			degradedReasons.push(`Failed to read or parse gate-failure-summary at ${gateFailureSummaryPath}`);
		}
	}

	let runtimeReport: RealRuntimeSimulationReport | undefined;
	if (runtimeSimulationReportPath) {
		try {
			const text = await readText(runtimeSimulationReportPath);
			runtimeReport = JSON.parse(text) as RealRuntimeSimulationReport;
		} catch {
			degradedReasons.push(`Failed to read or parse runtime-simulation-report at ${runtimeSimulationReportPath}`);
		}
	}

	return buildPlanRunPanelViewModel({ gateSummary, runtimeReport, degradedReasons });
}

/**
 * Render PlanRun panel status text for TUI display.
 * Returns a multi-line string; each line is suitable for truncation.
 * Returns empty string for a minimal/empty model (unknown runId + state).
 */
export function renderPlanRunPanelText(model: PlanRunPanelViewModel): string {
	const lines: string[] = [];

	// Skip rendering when the model has no meaningful data
	if (
		model.runId === "unknown" &&
		model.state === "unknown" &&
		!model.activeGate &&
		model.blockers.length === 0 &&
		model.degradedReasons.length === 0
	) {
		return "";
	}

	// Line 1: run id and state
	lines.push(`${model.runId} | ${model.state}`);

	// Line 2: active gate
	if (model.activeGate) {
		let gateStr = `${model.activeGate.kind} (${model.activeGate.status})`;
		if (model.activeGate.reason_zh) gateStr += ` — ${model.activeGate.reason_zh}`;
		if (model.activeGate.next_action_zh) gateStr += ` → ${model.activeGate.next_action_zh}`;
		lines.push(gateStr);
	}

	// Runtime counts
	const { totalScenarios, scenariosPassed, scenariosFailed, scenariosBlocked, cleanupStatus } = model.runtime;
	if (totalScenarios > 0 || cleanupStatus) {
		let runtimeStr = `${scenariosPassed}p ${scenariosFailed}f ${scenariosBlocked}b (${totalScenarios} total)`;
		if (cleanupStatus) {
			runtimeStr += ` | cleanup: ${cleanupStatus}`;
		}
		lines.push(runtimeStr);
	}

	// Blockers
	for (const b of model.blockers) {
		const evidence = b.evidencePaths.length > 0 ? ` ${b.evidencePaths.join(", ")}` : "";
		lines.push(
			`blocked: ${b.gate} — ${b.reasonZh} [${b.ownerRoleId}→${b.retestRoleId}]${evidence} → ${b.nextActionZh}`,
		);
	}

	// Degraded reasons
	if (model.degradedReasons.length > 0) {
		lines.push(`degraded: ${model.degradedReasons.join("; ")}`);
	}

	return lines.join("\n");
}
