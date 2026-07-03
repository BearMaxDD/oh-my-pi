import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDefaultRuntimeSimulationRunner } from "../../src/codex-plan-run/default-runtime-runner";
import {
	runRealRuntimeSimulation,
	writeRealRuntimeSimulationArtifacts,
} from "../../src/codex-plan-run/real-runtime-simulation";
import type { BusinessSimulationScenario, RuntimeEnvironmentPlan } from "../../src/codex-plan-run/runtime-scenarios";
import {
	buildBusinessSimulationScenarios,
	buildRuntimeEnvironmentPlan,
	writeRuntimeScenarioArtifacts,
} from "../../src/codex-plan-run/runtime-scenarios";
import type { BusinessPathRef } from "../../src/codex-plan-run/spec-task-framework";

const tempDirs: string[] = [];
async function makeTempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "omp-runtime-sim-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const businessPaths: BusinessPathRef[] = [
	{
		id: "planrun-primary",
		title_zh: "PlanRun 完整执行",
		user_story: "用户运行 PlanRun 并得到 role-bound evidence",
		runtime_required: true,
		suggested_environment: "local",
	},
];

describe("real runtime simulation gate", () => {
	it("builds safe local runtime plan and scenarios from business paths", () => {
		const plan = buildRuntimeEnvironmentPlan({ runId: "run-runtime", repoPath: "/repo", businessPaths });
		const scenarios = buildBusinessSimulationScenarios({ businessPaths });

		expect(plan.schema_version).toBe("superpowers.runtime_environment_plan.v1");
		expect(plan.environment_type).toBe("local");
		expect(plan.forbidden_targets).toContain("production");
		expect(plan.startup_commands[0]).toMatchObject({ cwd: "/repo", timeout_ms: 120000 });
		expect(scenarios[0]).toMatchObject({ id: "planrun-primary", actor: "developer" });
		expect(scenarios[0].steps[0]).toMatchObject({ kind: "cli", command: "printf 'runtime-evidence'" });
	});

	it("runs scenarios through injected runner and reports passed status", async () => {
		const report = await runRealRuntimeSimulation({
			runId: "run-runtime",
			environment: buildRuntimeEnvironmentPlan({ runId: "run-runtime", repoPath: "/repo", businessPaths }),
			scenarios: buildBusinessSimulationScenarios({ businessPaths }),
			now: new Date("2026-06-30T00:00:00.000Z"),
			runner: {
				async start() {
					return { status: "passed", logs: [{ path: "runtime/start.log", summary: "started" }] };
				},
				async executeScenario(scenario) {
					return {
						scenario_id: scenario.id,
						status: "passed",
						executed_steps: scenario.steps.map((step, index) => ({
							index,
							status: "passed",
							evidence: step.expected,
						})),
						evidence_paths: [`runtime/${scenario.id}.log`],
					};
				},
				async cleanup() {
					return { status: "passed", report_path: "runtime-cleanup-report.md" };
				},
			},
		});

		expect(report.status).toBe("passed");
		expect(report.cleanup_report_path).toBe("runtime-cleanup-report.md");
	});

	it("marks repair_required when a core scenario fails", async () => {
		const report = await runRealRuntimeSimulation({
			runId: "run-runtime",
			environment: buildRuntimeEnvironmentPlan({ runId: "run-runtime", repoPath: "/repo", businessPaths }),
			scenarios: buildBusinessSimulationScenarios({ businessPaths }),
			now: new Date("2026-06-30T00:00:00.000Z"),
			runner: {
				async start() {
					return { status: "passed", logs: [] };
				},
				async executeScenario(scenario) {
					return {
						scenario_id: scenario.id,
						status: "failed",
						executed_steps: [],
						evidence_paths: [],
						failure_summary_zh: "CLI failed",
					};
				},
				async cleanup() {
					return { status: "passed", report_path: "runtime-cleanup-report.md" };
				},
			},
		});

		expect(report.status).toBe("repair_required");
		expect(report.scenarios[0].failure_summary_zh).toBe("CLI failed");
	});

	it("writes environment, scenario, report, and cleanup artifacts", async () => {
		const acceptingDir = await makeTempDir();
		const environment = buildRuntimeEnvironmentPlan({ runId: "run-runtime", repoPath: "/repo", businessPaths });
		const scenarios = buildBusinessSimulationScenarios({ businessPaths });
		const scenarioPaths = await writeRuntimeScenarioArtifacts({ acceptingDir, environment, scenarios });
		const report = await runRealRuntimeSimulation({
			runId: "run-runtime",
			environment,
			scenarios,
			runner: {
				async start() {
					return { status: "passed", logs: [] };
				},
				async executeScenario(scenario) {
					return { scenario_id: scenario.id, status: "passed", executed_steps: [], evidence_paths: [] };
				},
				async cleanup() {
					return { status: "passed", report_path: "runtime-cleanup-report.md" };
				},
			},
		});
		const reportPaths = await writeRealRuntimeSimulationArtifacts({ acceptingDir, report });

		expect((await stat(scenarioPaths.environmentPlanPath)).isFile()).toBe(true);
		expect((await stat(scenarioPaths.scenariosPath)).isFile()).toBe(true);
		expect((await stat(reportPaths.jsonPath)).isFile()).toBe(true);
		expect((await stat(reportPaths.markdownPath)).isFile()).toBe(true);
		expect(await readFile(reportPaths.cleanupPath, "utf8")).toContain("cleanup_status: passed");
	});
	it("reports repair_required with cleanup failure details when runner.cleanup fails", async () => {
		const acceptingDir = await makeTempDir();
		const environment = buildRuntimeEnvironmentPlan({ runId: "run-runtime", repoPath: "/repo", businessPaths });
		const scenarios = buildBusinessSimulationScenarios({ businessPaths });
		const report = await runRealRuntimeSimulation({
			runId: "run-runtime",
			environment,
			scenarios,
			runner: {
				async start() {
					return { status: "passed", logs: [] };
				},
				async executeScenario(scenario) {
					return { scenario_id: scenario.id, status: "passed", executed_steps: [], evidence_paths: [] };
				},
				async cleanup() {
					return { status: "failed", report_path: "runtime-cleanup-report.md", residuals: ["port 3000"] };
				},
			},
		});

		expect(report.status).toBe("repair_required");
		expect(report.cleanup_status).toBe("failed");
		expect(report.cleanup_residuals).toEqual(["port 3000"]);

		const reportPaths = await writeRealRuntimeSimulationArtifacts({ acceptingDir, report });
		const cleanupContent = await readFile(reportPaths.cleanupPath, "utf8");
		expect(cleanupContent).toContain("cleanup_status: failed");
		expect(cleanupContent).toContain("port 3000");
	});
	it("attempts cleanup when startup reports failed", async () => {
		const environment = buildRuntimeEnvironmentPlan({ runId: "run-runtime", repoPath: "/repo", businessPaths });
		const scenarios = buildBusinessSimulationScenarios({ businessPaths });
		const report = await runRealRuntimeSimulation({
			runId: "run-runtime",
			environment,
			scenarios,
			now: new Date("2026-06-30T00:00:00.000Z"),
			runner: {
				async start() {
					return { status: "failed", logs: [] };
				},
				async executeScenario() {
					throw new Error("should not be called");
				},
				async cleanup() {
					return { status: "passed", report_path: "runtime-cleanup-report.md" };
				},
			},
		});

		expect(report.status).toBe("repair_required");
		expect(report.environment.startup_status).toBe("failed");
		expect(report.scenarios).toHaveLength(0);
		expect(report.cleanup_status).toBe("passed");
	});

	it("attempts cleanup when startup is blocked", async () => {
		const environment = buildRuntimeEnvironmentPlan({ runId: "run-runtime", repoPath: "/repo", businessPaths });
		const scenarios = buildBusinessSimulationScenarios({ businessPaths });
		const report = await runRealRuntimeSimulation({
			runId: "run-runtime",
			environment,
			scenarios,
			now: new Date("2026-06-30T00:00:00.000Z"),
			runner: {
				async start() {
					return { status: "blocked", logs: [] };
				},
				async executeScenario() {
					throw new Error("should not be called");
				},
				async cleanup() {
					return { status: "passed", report_path: "runtime-cleanup-report.md" };
				},
			},
		});

		expect(report.status).toBe("blocked");
		expect(report.environment.startup_status).toBe("blocked");
		expect(report.scenarios).toHaveLength(0);
		expect(report.cleanup_status).toBe("passed");
	});

	it("captures runner start rejection and attempts cleanup", async () => {
		const environment = buildRuntimeEnvironmentPlan({ runId: "run-runtime", repoPath: "/repo", businessPaths });
		const scenarios = buildBusinessSimulationScenarios({ businessPaths });
		const report = await runRealRuntimeSimulation({
			runId: "run-runtime",
			environment,
			scenarios,
			now: new Date("2026-06-30T00:00:00.000Z"),
			runner: {
				async start() {
					throw new Error("Failed to connect");
				},
				async executeScenario() {
					throw new Error("should not be called");
				},
				async cleanup() {
					return { status: "passed", report_path: "runtime-cleanup-report.md" };
				},
			},
		});

		expect(report.status).toBe("repair_required");
		expect(report.environment.startup_status).toBe("failed");
		expect(report.scenarios).toHaveLength(0);
		expect(report.cleanup_status).toBe("passed");
		expect(report.logs.some(l => l.summary.includes("threw"))).toBe(true);
	});

	it("captures scenario execution rejection and attempts cleanup", async () => {
		const environment = buildRuntimeEnvironmentPlan({ runId: "run-runtime", repoPath: "/repo", businessPaths });
		const scenarios = buildBusinessSimulationScenarios({ businessPaths });
		const report = await runRealRuntimeSimulation({
			runId: "run-runtime",
			environment,
			scenarios,
			now: new Date("2026-06-30T00:00:00.000Z"),
			runner: {
				async start() {
					return { status: "passed", logs: [] };
				},
				async executeScenario() {
					throw new Error("Script crashed");
				},
				async cleanup() {
					return { status: "passed", report_path: "runtime-cleanup-report.md" };
				},
			},
		});

		expect(report.status).toBe("repair_required");
		expect(report.scenarios[0].status).toBe("failed");
		expect(report.scenarios[0].failure_summary_zh).toContain("Script crashed");
		expect(report.cleanup_status).toBe("passed");
	});

	it("captures runner cleanup rejection", async () => {
		const environment = buildRuntimeEnvironmentPlan({ runId: "run-runtime", repoPath: "/repo", businessPaths });
		const scenarios = buildBusinessSimulationScenarios({ businessPaths });
		const report = await runRealRuntimeSimulation({
			runId: "run-runtime",
			environment,
			scenarios,
			now: new Date("2026-06-30T00:00:00.000Z"),
			runner: {
				async start() {
					return { status: "passed", logs: [] };
				},
				async executeScenario(scenario) {
					return { scenario_id: scenario.id, status: "passed", executed_steps: [], evidence_paths: [] };
				},
				async cleanup() {
					throw new Error("Cleanup failed");
				},
			},
		});

		expect(report.status).toBe("repair_required");
		expect(report.cleanup_status).toBe("failed");
		expect(report.cleanup_residuals).toBeDefined();
		expect(report.cleanup_residuals![0]).toContain("Cleanup failed");
	});
	it("reports blocked when real runner encounters unsupported browser step", async () => {
		const cwd = await makeTempDir();
		const runner = createDefaultRuntimeSimulationRunner({ cwd, timeoutMs: 2000 });
		const environment: RuntimeEnvironmentPlan = {
			schema_version: "superpowers.runtime_environment_plan.v1",
			run_id: "run-blocked-real",
			environment_type: "local",
			type: "local",
			startup_commands: [],
			health_checks: [],
			required_env_vars: [],
			forbidden_targets: [],
			cleanup_commands: [],
			safety_notes_zh: [],
		};
		const scenarios: BusinessSimulationScenario[] = [
			{
				id: "browser-blocked",
				title_zh: "Browser scenario",
				source_requirement: "",
				actor: "developer",
				preconditions: [],
				steps: [
					{
						id: "browse",
						kind: "browser",
						title_zh: "Open page",
						timeout_ms: 5000,
						expected: "page",
						required: true,
						url: "https://example.com",
						action: "navigate",
						text: "",
						selector: "",
						expected_url: "",
						expected_text: "",
					},
				],
				expected_results: [],
				evidence_required: [],
			},
		];
		const report = await runRealRuntimeSimulation({
			runId: "run-blocked-real",
			environment,
			scenarios,
			runner,
			now: new Date("2026-06-30T00:00:00.000Z"),
		});

		expect(report.status).toBe("blocked");
		expect(report.scenarios).toHaveLength(1);
		expect(report.scenarios[0].status).toBe("blocked");
		expect(report.cleanup_status).toBe("passed");
	});
});
