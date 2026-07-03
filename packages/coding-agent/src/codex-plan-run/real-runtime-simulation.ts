import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BusinessSimulationScenario, RuntimeEnvironmentPlan } from "./runtime-scenarios";

export interface RuntimeEnvironmentSummary {
	environment_type: string;
	startup_status: "passed" | "failed" | "blocked";
}
export interface RuntimeLogRef {
	path: string;
	summary: string;
}
export interface RuntimeArtifactRef {
	path: string;
	description: string;
}
export interface ExecutedStep {
	index: number;
	status: "passed" | "failed" | "blocked";
	evidence: string;
}

export interface ScenarioExecutionResult {
	scenario_id: string;
	status: "passed" | "failed" | "blocked";
	executed_steps: ExecutedStep[];
	evidence_paths: string[];
	failure_summary_zh?: string;
}

export interface RealRuntimeSimulationReport {
	schema_version: "superpowers.real_runtime_simulation.v1";
	run_id: string;
	started_at: string;
	finished_at: string;
	environment: RuntimeEnvironmentSummary;
	scenarios: ScenarioExecutionResult[];
	logs: RuntimeLogRef[];
	/** @deprecated reserved for future use */

	screenshots: RuntimeArtifactRef[];
	status: "passed" | "repair_required" | "blocked";
	cleanup_report_path?: string;
	cleanup_status?: "passed" | "failed" | "blocked";
	cleanup_residuals?: string[];
}

export interface RuntimeStartResult {
	status: "passed" | "failed" | "blocked";
	logs: RuntimeLogRef[];
	failure_summary_zh?: string;
}
export interface RuntimeCleanupResult {
	status: "passed" | "failed" | "blocked";
	report_path: string;
	residuals?: string[];
}
export interface RuntimeSimulationRunner {
	start(environment: RuntimeEnvironmentPlan): Promise<RuntimeStartResult>;
	executeScenario(scenario: BusinessSimulationScenario): Promise<ScenarioExecutionResult>;
	cleanup(environment: RuntimeEnvironmentPlan): Promise<RuntimeCleanupResult>;
}

export async function runRealRuntimeSimulation(options: {
	runId: string;
	environment: RuntimeEnvironmentPlan;
	scenarios: readonly BusinessSimulationScenario[];
	runner: RuntimeSimulationRunner;
	now?: Date;
}): Promise<RealRuntimeSimulationReport> {
	const startedAt = (options.now ?? new Date()).toISOString();

	let start: RuntimeStartResult;
	try {
		start = await options.runner.start(options.environment);
	} catch (err: unknown) {
		start = {
			status: "failed",
			logs: [{ path: "runtime/start.log", summary: "Runner start threw" }],
			failure_summary_zh: `start exception: ${(err as Error).message ?? String(err)}`,
		};
	}

	const results: ScenarioExecutionResult[] = [];

	if (start.status === "passed") {
		for (const scenario of options.scenarios) {
			let result: ScenarioExecutionResult;
			try {
				result = await options.runner.executeScenario(scenario);
			} catch (err: unknown) {
				result = {
					scenario_id: scenario.id,
					status: "failed",
					executed_steps: [],
					evidence_paths: [],
					failure_summary_zh: `scenario exception: ${(err as Error).message ?? String(err)}`,
				};
			}
			results.push(result);
		}
	}

	let cleanup: RuntimeCleanupResult;
	try {
		cleanup = await options.runner.cleanup(options.environment);
	} catch (err: unknown) {
		cleanup = {
			status: "failed",
			report_path: "",
			residuals: [`cleanup exception: ${(err as Error).message ?? String(err)}`],
		};
	}

	const failedScenario = results.some(result => result.status === "failed");
	const blockedScenario = results.some(result => result.status === "blocked");
	const status =
		start.status === "blocked" || blockedScenario || cleanup.status === "blocked"
			? "blocked"
			: start.status === "failed" || failedScenario || cleanup.status === "failed"
				? "repair_required"
				: "passed";

	return {
		schema_version: "superpowers.real_runtime_simulation.v1",
		run_id: options.runId,
		started_at: startedAt,
		finished_at: (options.now ?? new Date()).toISOString(),
		environment: { environment_type: options.environment.environment_type, startup_status: start.status },
		scenarios: results,
		logs: start.logs,
		screenshots: [],
		status,
		cleanup_report_path: cleanup.report_path,
		cleanup_status: cleanup.status,
		cleanup_residuals: cleanup.residuals,
	};
}

function renderRuntimeReport(report: RealRuntimeSimulationReport): string {
	const lines = [
		"# Real Runtime Simulation Report",
		"",
		`run_id: ${report.run_id}`,
		`status: ${report.status}`,
		"",
		"## Scenarios",
	];
	for (const scenario of report.scenarios) {
		lines.push(
			`- ${scenario.scenario_id}: ${scenario.status}${scenario.failure_summary_zh ? ` — ${scenario.failure_summary_zh}` : ""}`,
		);
	}
	lines.push("", "## Logs", ...report.logs.map(log => `- ${log.path}: ${log.summary}`), "");
	return lines.join("\n");
}

export async function writeRealRuntimeSimulationArtifacts(options: {
	acceptingDir: string;
	report: RealRuntimeSimulationReport;
}): Promise<{ jsonPath: string; markdownPath: string; cleanupPath: string }> {
	await mkdir(options.acceptingDir, { recursive: true });
	const jsonPath = join(options.acceptingDir, "real-runtime-simulation-report.json");
	const markdownPath = join(options.acceptingDir, "real-runtime-simulation-report.md");
	const cleanupPath = join(options.acceptingDir, "runtime-cleanup-report.md");
	await writeFile(jsonPath, `${JSON.stringify(options.report, null, 2)}\n`, "utf8");
	await writeFile(markdownPath, renderRuntimeReport(options.report), "utf8");
	const cleanupReportParts = [
		"# Runtime Cleanup Report",
		"",
		`cleanup_status: ${options.report.cleanup_status ?? "not_run"}`,
	];
	if (options.report.cleanup_residuals && options.report.cleanup_residuals.length > 0) {
		cleanupReportParts.push("cleanup_residuals:", ...options.report.cleanup_residuals.map(r => `- ${r}`));
	}
	await writeFile(cleanupPath, `${cleanupReportParts.join("\n")}\n`, "utf8");
	return { jsonPath, markdownPath, cleanupPath };
}
