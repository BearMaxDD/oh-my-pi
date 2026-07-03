import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PlanRunDriverDeps } from "../../src/codex-plan-run/driver";
import type { PlanExecutionBook } from "../../src/codex-plan-run/execution-book";
import { runPlanRunEntry } from "../../src/codex-plan-run/plan-run-entry";
import { createPlanRunSessionStatusSink, createPlanRunStatusSink } from "../../src/codex-plan-run/plan-run-status-sink";
import type { PlanRunSessionSnapshot } from "../../src/codex-plan-run/types";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "plan-run-status-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

const gateJson = JSON.stringify({
	schema_version: "superpowers.gate_failure_summary.v1",
	run_id: "run-1",
	gate: "main_acceptance",
	status: "repair_required",
	title_zh: "PlanRun 阻塞",
	reason_zh: "需要修复",
	owner_role_id: "superpowers:implementer",
	owner_role_label_zh: "实现者",
	retest_role_id: "superpowers:reviewer",
	retest_role_label_zh: "审查者",
	evidence_paths: ["/accept/gate-failure-summary.json"],
	next_action_zh: "修复后重测",
});

describe("createPlanRunStatusSink", () => {
	it("builds panel input from artifacts and writes session snapshot", async () => {
		const writes: PlanRunSessionSnapshot[] = [];
		const sink = createPlanRunStatusSink({
			readText: async () => gateJson,
			writeSnapshot: snapshot => {
				writes.push(snapshot);
			},
			now: () => new Date("2026-07-02T00:00:00.000Z"),
		});

		await sink.update({
			todoSnapshot: {
				runId: "run-1",
				version: 1,
				state: "main_acceptance_fix_required",
				updatedAt: "2026-07-02T00:00:00.000Z",
				source: "state-machine",
				phases: [],
			},
			gateFailureSummaryPath: "/accept/gate-failure-summary.json",
		});

		expect(writes).toHaveLength(1);
		expect(writes[0]).toMatchObject({
			todoSnapshot: { runId: "run-1" },
			panel: {
				todoSnapshot: { runId: "run-1" },
				gateSummary: { run_id: "run-1", reason_zh: "需要修复" },
			},
			updatedAt: "2026-07-02T00:00:00.000Z",
		});
	});

	it("records degraded reasons for unreadable artifacts", async () => {
		const writes: PlanRunSessionSnapshot[] = [];
		const sink = createPlanRunStatusSink({
			readText: async () => {
				throw new Error("partial write");
			},
			writeSnapshot: snapshot => {
				writes.push(snapshot);
			},
		});

		await sink.update({ gateFailureSummaryPath: "/accept/gate-failure-summary.json" });

		expect(writes[0].degradedReasons?.[0]).toContain(
			"Failed to read or parse gate-failure-summary at /accept/gate-failure-summary.json: partial write",
		);
	});

	it("includes runtime simulation reports in the panel snapshot", async () => {
		const writes: PlanRunSessionSnapshot[] = [];
		const runtimeJson = JSON.stringify({
			schema_version: "superpowers.real_runtime_simulation_report.v1",
			run_id: "run-1",
			status: "passed",
			scenarios: [{ scenario_id: "scenario-1", status: "passed", executed_steps: [], evidence_paths: [] }],
			cleanup: { status: "passed", evidence: "clean" },
		});
		const sink = createPlanRunStatusSink({
			readText: async path => (path.endsWith("runtime.json") ? runtimeJson : gateJson),
			writeSnapshot: snapshot => {
				writes.push(snapshot);
			},
		});

		await sink.update({ runtimeSimulationReportPath: "/accept/runtime.json" });

		expect(writes[0].panel?.runtimeReport).toMatchObject({
			run_id: "run-1",
			status: "passed",
			scenarios: [{ scenario_id: "scenario-1", status: "passed" }],
		});
	});
});

describe("runPlanRunEntry status sink", () => {
	it("publishes PlanRun snapshot updates through status sink", async () => {
		const acceptingDir = await makeTempDir();
		const bookPath = join(acceptingDir, "book.json");
		const book: PlanExecutionBook = {
			schema_version: 1,
			run_id: "run-1",
			created_at: "2026-07-02T00:00:00.000Z",
			plan: { path: "/repo/plan.md", sha256: "abc", repo_path: "/repo" },
			accepting_dir: acceptingDir,
			intake_gate: [],
			project_recon: {
				repo_path: "/repo",
				relevant_modules: ["src"],
				likely_files: [],
				existing_patterns: [],
				test_commands: ["bun test"],
				build_commands: [],
				style_conventions: [],
				risk_areas: [],
				forbidden_changes: [],
				task_file_map: {},
			},
			required_execution_skills: [],
			required_review_skills: [],
			final_tail_skills: [],
			final_acceptance_commands: [],
			tasks: [],
		};
		await writeFile(bookPath, JSON.stringify(book), "utf8");

		const deps = {} as PlanRunDriverDeps;
		const snapshots: unknown[] = [];
		const result = await runPlanRunEntry({
			bookPath,
			acceptingDir,
			repoPath: "/repo",
			project: "test-project",
			settings: { get: (key: string) => (key === "superpowers.executionLoop.mode" ? "off" : undefined) },
			deps,
			runDriver: async () => ({
				state: "ready_for_user",
				roleBoundTodoSnapshots: [
					{
						runId: "run-1",
						version: 1,
						state: "ready_for_user",
						updatedAt: "2026-07-02T00:00:00.000Z",
						source: "state-machine",
						phases: [],
					},
				],
			}),
			statusSink: {
				update: async snapshot => {
					snapshots.push(snapshot);
				},
			},
		});

		expect(result.state).toBe("ready_for_user");
		expect(snapshots.length).toBeGreaterThan(0);
		const lastSnapshot = snapshots.at(-1) as Record<string, unknown>;
		expect(JSON.stringify(lastSnapshot)).toContain("run-1");
		expect(lastSnapshot.todoSnapshot).toMatchObject({ state: "ready_for_user" });
	});
});

describe("createPlanRunSessionStatusSink", () => {
	it("delegates to createPlanRunStatusSink and writes through session.setPlanRunSnapshot", async () => {
		const gatePath = "/accept/gate-failure-summary.json";
		let capturedSnapshot: PlanRunSessionSnapshot | undefined;

		const sink = createPlanRunSessionStatusSink({
			readText: async (path: string) => (path === gatePath ? gateJson : ""),
			session: {
				setPlanRunSnapshot: (snapshot: PlanRunSessionSnapshot) => {
					capturedSnapshot = snapshot;
				},
			},
			now: () => new Date("2026-07-02T00:00:00.000Z"),
		});

		await sink.update({ gateFailureSummaryPath: gatePath });

		expect(capturedSnapshot).toBeDefined();
		expect(capturedSnapshot!.panel?.gateSummary).toMatchObject({ run_id: "run-1" });
		expect(capturedSnapshot!.updatedAt).toBe("2026-07-02T00:00:00.000Z");
	});
});
