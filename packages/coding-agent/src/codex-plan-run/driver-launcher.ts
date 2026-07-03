import type { PlanRunDriverDeps, PlanRunDriverInput, PlanRunDriverResult } from "./driver";
import { runPlanRunDriver } from "./driver";
import type { PlanExecutionBook } from "./execution-book";
import type { ExecutionLoopSettingsReader } from "./execution-loop-settings";
import { resolveExecutionLoopSettings } from "./execution-loop-settings";
import type { GateFailureSummary } from "./gate-failure-summary";
import { writeGateFailureSummaryArtifacts } from "./gate-failure-summary";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlanRunDriverLauncherInput {
	acceptingDir: string;
	executionBook: PlanExecutionBook;
	repoPath: string;
	project: string;
	settings: ExecutionLoopSettingsReader;
	deps: PlanRunDriverDeps;
	overrides?: Partial<
		Pick<
			PlanRunDriverInput,
			| "enableRoleBoundExecution"
			| "enableAdvisorGate"
			| "enableGlobalImpactGate"
			| "enableRealBusinessSimulationGate"
			| "superpowersGateMode"
			| "runtimeCommandTimeoutMs"
			| "runtimeScenario"
			| "classification"
		>
	>;
	runDriver?: (input: PlanRunDriverInput, deps: PlanRunDriverDeps) => Promise<PlanRunDriverResult>;
}

// ---------------------------------------------------------------------------
// Launcher
// ---------------------------------------------------------------------------

/**
 * Launch a PlanRun driver with preflight checks.
 *
 * Orchestrates three steps:
 * 1. Resolve execution loop settings (with optional overrides).
 * 2. Preflight: reject blocked settings or missing role-bound deps.
 * 3. Call the runDriver (defaulting to runPlanRunDriver).
 *
 * If the driver returns a non-ready state with a decision, a gate-failure
 * summary artifact is written to acceptingDir.
 */
export async function launchPlanRunDriver(input: PlanRunDriverLauncherInput): Promise<PlanRunDriverResult> {
	const { acceptingDir, executionBook, repoPath, project, settings, deps, overrides } = input;
	const {
		runtimeCommandTimeoutMs,
		runtimeScenario: runtimeScenarioOverride,
		classification: classificationOverride,
		...settingsOverrides
	} = overrides ?? {};
	const runDriver = input.runDriver ?? runPlanRunDriver;

	// 1. Resolve settings from reader + optional overrides.
	const resolved = resolveExecutionLoopSettings({ settings, overrides: settingsOverrides });
	// 2a. Settings-level blockers — e.g. invalid environment/gate mode.
	if (resolved.blockers.length > 0) {
		const summary: GateFailureSummary = {
			schema_version: "superpowers.gate_failure_summary.v1",
			run_id: executionBook.run_id,
			gate: "advisor_gate",
			status: "blocked",
			title_zh: "PlanRun 启动前检查未通过",
			reason_zh: resolved.blockers.map(b => b.message).join("; "),
			owner_role_id: "superpowers:advisor",
			owner_role_label_zh: "Advisor",
			retest_role_id: "superpowers:advisor",
			retest_role_label_zh: "Advisor",
			evidence_paths: [],
			next_action_zh: "请修复配置后重新触发",
		};
		await writeGateFailureSummaryArtifacts({ acceptingDir, summary });
		return { state: "main_acceptance_fix_required" };
	}

	// 2b. Role-bound execution requires spawnStage dependency.
	if (resolved.driverDefaults.enableRoleBoundExecution && !deps.spawnStage) {
		const summary: GateFailureSummary = {
			schema_version: "superpowers.gate_failure_summary.v1",
			run_id: executionBook.run_id,
			gate: "advisor_gate",
			status: "blocked",
			title_zh: "PlanRun 启动前检查未通过",
			reason_zh: "role-bound execution requires spawnStage dependency",
			owner_role_id: "superpowers:advisor",
			owner_role_label_zh: "Advisor",
			retest_role_id: "superpowers:advisor",
			retest_role_label_zh: "Advisor",
			evidence_paths: [],
			next_action_zh: "请检查依赖配置后重新触发",
		};
		await writeGateFailureSummaryArtifacts({ acceptingDir, summary });
		return { state: "main_acceptance_fix_required" };
	}

	// 3. Build driver input and run.
	const driverInput: PlanRunDriverInput = {
		acceptingDir,
		executionBook,
		repoPath,
		project,
		reindexProvider: null,
		...resolved.driverDefaults,
		runtimeScenario: runtimeScenarioOverride ?? resolved.runtimeScenario,
		classification: classificationOverride ?? resolved.classification,
		...(runtimeCommandTimeoutMs !== undefined ? { runtimeCommandTimeoutMs } : {}),
	};

	const result = await runDriver(driverInput, deps);

	// 4. Non-ready result with decision -> write gate-failure summary.
	if (result.state !== "ready_for_user" && result.decision) {
		const summary: GateFailureSummary = {
			schema_version: "superpowers.gate_failure_summary.v1",
			run_id: executionBook.run_id,
			gate: "main_acceptance",
			status: "repair_required",
			title_zh: "PlanRun 需要修复",
			reason_zh: result.decision.reason,
			owner_role_id: "superpowers:advisor",
			owner_role_label_zh: "Advisor",
			retest_role_id: "superpowers:acceptance",
			retest_role_label_zh: "Acceptance",
			evidence_paths: [],
			next_action_zh: "请修复后重新提交",
		};
		await writeGateFailureSummaryArtifacts({ acceptingDir, summary });
	}

	return result;
}
