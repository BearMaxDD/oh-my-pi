/**
 * Task 7 RED phase — End-to-end productized fixture.
 *
 * Proves:  entry -> launcher -> role-bound stages -> global impact ->
 *          runtime simulation -> main acceptance -> ready_for_user
 *
 * TDD history — the driver did not originally pass classification_summary
 * or productized entry evidence through the acceptance request.  The RED
 * contract below documents the gaps the GREEN pass resolved.
 *
 * RED contract (historical):
 *   The driver must pass classification_summary and productized entry
 *   evidence through the acceptance request's manifestExtensions.
 *   Initially the driver omitted classification_summary on
 *   role_bound_execution, causing assertions to fail.
 *
 *   Expected failure: expect(classification_summary).toBeDefined()
 *   returned undefined because the driver omitted this field.
 *
 *   Now GREEN: classification_summary is productized evidence and
 *   the acceptance gate accepts the full request.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	PlanRunDriverDeps,
	PlanRunDriverInput,
	PlanRunDriverResult,
	RoleBoundStageRunInput,
	RoleBoundStageRunOutput,
} from "../../src/codex-plan-run/driver";
import { runPlanRunDriver } from "../../src/codex-plan-run/driver";
import type { PlanExecutionBook } from "../../src/codex-plan-run/execution-book";
import type {
	MainThreadAcceptanceReviewRequest,
	MainThreadAcceptanceReviewResult,
} from "../../src/codex-plan-run/main-acceptance-review";
import { runPlanRunEntry } from "../../src/codex-plan-run/plan-run-entry";
import type { RuntimeSimulationRunner } from "../../src/codex-plan-run/real-runtime-simulation";
import type { TaskReviewResult } from "../../src/codex-plan-run/task-review";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_RUN_ID = "e2e-happy-path";

/** Settings that enable all productized gates. */
const ENRICHED_SETTINGS: Record<string, unknown> = {
	"superpowers.executionLoop.mode": "role-bound",
	"superpowers.executionLoop.roleBoundExecution.enabled": true,
	"superpowers.executionLoop.roleBoundExecution.requireAdvisorGate": true,
	"superpowers.executionLoop.globalImpactGate.enabled": true,
	"superpowers.executionLoop.globalImpactGate.mode": "required",
	"superpowers.executionLoop.realBusinessSimulationGate.enabled": true,
	"superpowers.executionLoop.realBusinessSimulationGate.allowedEnvironments": ["local"],
};

function makeBook(acceptingDir: string): PlanExecutionBook {
	return {
		schema_version: 1,
		run_id: TEST_RUN_ID,
		created_at: "2026-07-01T00:00:00.000Z",
		plan: { path: "/repo/plan.md", sha256: "abc123def456", repo_path: "/repo" },
		accepting_dir: acceptingDir,
		intake_gate: [],
		project_recon: {
			repo_path: "/repo",
			relevant_modules: [],
			likely_files: [],
			existing_patterns: [],
			test_commands: ["bun test"],
			build_commands: ["bun run check:types"],
			style_conventions: [],
			risk_areas: [],
			forbidden_changes: [],
			task_file_map: {},
		},
		required_execution_skills: [],
		required_review_skills: [],
		final_tail_skills: [],
		final_acceptance_commands: ["bun test"],
		tasks: [
			{
				id: "T01",
				title: "E2E test task",
				source: "plan-section-1",
				todo: "Implement the E2E fixture contract",
				execution_skills: [],
				review_skills: [],
				final_tail_skills: [],
				allowed_files: ["src/index.ts"],
				forbidden_files: [],
				smoke_commands: ["bun test"],
				tdd_gates: {
					red: { command: "bun test", expected: "FAIL", evidence_required: "RED_EVIDENCE" },
					green: { command: "bun test", expected: "PASS", evidence_required: "GREEN_EVIDENCE" },
					regression: { command: "bun test", expected: "PASS", evidence_required: "REGRESSION_EVIDENCE" },
				},
				advisor_watch_points: [],
				required_skill_evidence: [],
				skill_evidence: { execution: [], review: [], final_tail: [] },
				implementation_analysis: "",
				execution_scope: {
					goal: "Prove the productized E2E fixture contract",
					allowed_files: [],
					forbidden_files: [],
					likely_files: [],
					existing_patterns: [],
					out_of_scope: [],
				},
				implementation_steps: [],
				review_gate: {
					acceptance_criteria: [],
					smoke_commands: [],
					required_evidence: [],
					must_fix_conditions: [],
				},
			},
		],
	};
}

const ACCEPTED_REVIEW: TaskReviewResult = {
	task_id: "T01",
	review_skills_used: ["superpowers:test-driven-development"],
	final_tail_skills_used: ["superpowers:verification-before-completion"],
	plan_compliance: "PASS",
	scope_control: "PASS",
	smoke_tests: "PASS",
	evidence_quality: "PASS",
	over_implementation_check: "PASS",
	result: "TASK_ACCEPTED",
	must_fix_items: [],
};

/** Mock runner that never touches the real filesystem or spawns processes. */
const MOCK_RUNTIME_RUNNER: RuntimeSimulationRunner = {
	start: async () => ({ status: "passed" as const, logs: [] }),
	executeScenario: async scenario => ({
		scenario_id: scenario.id,
		status: "passed" as const,
		executed_steps: [],
		evidence_paths: [],
	}),
	cleanup: async () => ({
		status: "passed" as const,
		report_path: "runtime-cleanup-report.md",
		residuals: [],
	}),
};

const STAGE_ARTIFACT_PATHS: Record<string, string[]> = {
	"tdd-writer": ["tasks/T01/red-evidence.md"],
	implementer: ["tasks/T01/implementation-summary.md"],
	"test-runner": ["tasks/T01/green-evidence.md"],
	"spec-reviewer": ["tasks/T01/spec-review.md"],
	"quality-reviewer": ["tasks/T01/quality-review.md"],
	acceptance: ["tasks/T01/task-acceptance.md"],
};

function makeStageOutput(stageId: string): RoleBoundStageRunOutput {
	const frameworkPaths = STAGE_ARTIFACT_PATHS[stageId] ?? [];
	return {
		task_id: "T01",
		stage_id: stageId,
		role_id: stageId,
		output_path: `/tmp/e2e-stage-${stageId}`,
		evidence_paths: [`/tmp/e2e-${stageId}-evidence.json`, ...frameworkPaths],
		agentId: "test-agent",
		modelRole: `superpowers:${stageId}`,
		resolvedModel: "deepseek/deepseek-v4-flash",
		modelOverrides: [],
		advisorFindings: [],
		changed_files: ["src/index.ts"],
		tests_run: ["bun test"],
		evidence: ["TDD evidence executed"],
		execution_skills_used: ["superpowers:test-driven-development"],
		final_tail_skills_used: ["superpowers:verification-before-completion"],
		scope_notes: [],
		result: "completed",
	};
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "omp-e2e-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) {
		await rm(dir, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("runPlanRunEntry E2E", () => {
	it("happy path: runs full productized flow and captures acceptance request with classification_summary + productized entry evidence", async () => {
		const acceptingDir = await makeTempDir();
		const bookPath = join(acceptingDir, "execution-book.json");
		await writeFile(bookPath, JSON.stringify(makeBook(acceptingDir)), "utf8");

		// Capture the acceptance request so we can inspect the evidence the
		// driver passes through manifestExtensions.role_bound_execution.
		const capturedRequest: { current?: MainThreadAcceptanceReviewRequest } = {};

		const deps: PlanRunDriverDeps = {
			spawnTask: async () => {
				throw new Error("spawnTask should not be called — role-bound execution uses spawnStage");
			},
			spawnStage: async (input: RoleBoundStageRunInput): Promise<RoleBoundStageRunOutput> =>
				makeStageOutput(input.stageId),
			reviewTask: async (): Promise<TaskReviewResult> => ACCEPTED_REVIEW,
			// Wrap the real acceptance gate to capture the request before
			// validation runs.  The real gate now accepts the full
			// productized request.
			runMainAcceptance: async (
				request: MainThreadAcceptanceReviewRequest,
			): Promise<MainThreadAcceptanceReviewResult> => {
				capturedRequest.current = request;
				const { runMainThreadAcceptanceReview } = await import("../../src/codex-plan-run/main-acceptance-review");
				return runMainThreadAcceptanceReview(request);
			},
			createRepairDecision: () => {
				throw new Error("createRepairDecision should not be called on happy path");
			},
		};

		const result = await runPlanRunEntry({
			bookPath,
			acceptingDir,
			repoPath: "/repo",
			project: "e2e-test",
			settings: { get: (key: string) => ENRICHED_SETTINGS[key] },
			deps,
			runDriver: async (input: PlanRunDriverInput, driverDeps: PlanRunDriverDeps): Promise<PlanRunDriverResult> => {
				// Enrich the driver input with fields the entry/launcher
				// currently does not pass through.  The real driver runs with
				// a mock runtime runner and explicit artifact paths so the
				// flow reaches the acceptance gate.
				return runPlanRunDriver(
					{
						...input,
						// Advisor gates are disabled in this fixture because the
						// stages are synthetic with no real advisor records.
						enableAdvisorGate: false,
						enableGlobalImpactGate: true,
						enableRealBusinessSimulationGate: true,
						superpowersGateMode: "advisory",
						// Command evidence for final acceptance verification and
						// global-impact gate matching against allowed_paths.
						commands: [
							{ command: "bun test T01", exit_code: 0, evidence: "PASS" },
							{ command: "bun test", exit_code: 0, evidence: "PASS" },
						],
						// TDD evidence matrix matching the task T01 RED/GREEN/REGRESSION gates.
						tddEvidenceMatrix: {
							tasks: {
								T01: [
									{
										kind: "RED_EVIDENCE",
										task_id: "T01",
										command: "bun test",
										cwd: "/repo",
										exit_code: 1,
										started_at: "2026-07-01T00:00:01.000Z",
										completed_at: "2026-07-01T00:00:02.000Z",
										output_excerpt: "RED phase — expected failure",
										evidence_file_path: "tasks/T01/red-evidence.md",
									},
									{
										kind: "GREEN_EVIDENCE",
										task_id: "T01",
										command: "bun test",
										cwd: "/repo",
										exit_code: 0,
										started_at: "2026-07-01T00:00:03.000Z",
										completed_at: "2026-07-01T00:00:04.000Z",
										output_excerpt: "GREEN phase — all tests pass",
										evidence_file_path: "tasks/T01/green-evidence.md",
									},
									{
										kind: "REGRESSION_EVIDENCE",
										task_id: "T01",
										command: "bun test",
										cwd: "/repo",
										exit_code: 0,
										started_at: "2026-07-01T00:00:05.000Z",
										completed_at: "2026-07-01T00:00:06.000Z",
										output_excerpt: "REGRESSION phase — all tests pass",
										evidence_file_path: "tasks/T01/green-evidence.md",
									},
								],
							},
						},
						// No required skills for the fixture task, so empty matrix passes.
						skillEvidenceMatrix: { tasks: { T01: [] } },
						// No advisor blockers — empty summary passes.
						advisorSummary: { items: [] },
						// The acceptance gate requires these paths to be non-empty.
						manifestPath: join(acceptingDir, "manifest.json"),
						completionDocPath: join(acceptingDir, "omp-completion.md"),
						// Deterministic simulation — no real process execution.
						runtimeSimulationRunner: MOCK_RUNTIME_RUNNER,
					},
					driverDeps,
				);
			},
		});

		// ---- Phase 1: acceptance gate result ----
		// The real runMainThreadAcceptanceReview now accepts the full
		// productized request with all required evidence.
		expect(result.state).toBe("ready_for_user");

		// ---- Phase 2: captured request contract inspection ----
		expect(capturedRequest.current).toBeDefined();
		const ext = capturedRequest.current!.manifestExtensions;
		expect(ext).toBeDefined();

		// ---- Phase 3: role_bound_execution evidence ----
		const roleBound = ext!.role_bound_execution;
		expect(roleBound).toBeDefined();
		expect(roleBound!.enabled).toBe(true);

		// Productized entry evidence — the driver DOES set these:
		expect(roleBound!.role_registry_snapshot_path).toBeDefined();
		expect(roleBound!.role_registry_snapshot_sha256).toBeDefined();
		expect(roleBound!.spec_task_framework_path).toBeDefined();
		expect(roleBound!.spec_task_framework_sha256).toBeDefined();
		expect(roleBound!.actual_spec_task_framework_sha256).toBeDefined();

		/**
		 * RED CONTRACT (historical — now GREEN):
		 *
		 * The driver MUST pass classification_summary through the acceptance
		 * request so the main acceptance gate can validate specialized
		 * review routing (requires_frontend_design, requires_security_review,
		 * requires_payment_review, etc.).
		 *
		 * GREEN resolution: the driver now extracts SpecTaskFramework task
		 * classifications into a classification_summary structure and attaches
		 * it to role_bound_execution in driver.ts.
		 */
		expect(roleBound!.classification_summary).toBeDefined();

		// ---- Phase 4: disk artifacts ----
		if (result.state === "ready_for_user") {
			const diskFiles = await readdir(acceptingDir);

			for (const artifact of [
				"spec-task-framework.json",
				"global-impact-report.json",
				"real-runtime-simulation-report.json",
				"runtime-cleanup-report.md",
				"codex-review-request.md",
			]) {
				expect(diskFiles).toContain(artifact);
				const artStat = await stat(join(acceptingDir, artifact));
				expect(artStat.isFile()).toBe(true);
			}
		}
	});

	it("failure variant: missing spawnStage writes gate-failure-summary.json with owner/retest info", async () => {
		const acceptingDir = await makeTempDir();
		const bookPath = join(acceptingDir, "execution-book.json");
		await writeFile(bookPath, JSON.stringify(makeBook(acceptingDir)), "utf8");

		// Omit spawnStage — the launcher's preflight check blocks before
		// reaching the real driver.
		const deps: PlanRunDriverDeps = {
			spawnTask: async () => {
				throw new Error("spawnTask should not be reached — preflight blocks first");
			},
			reviewTask: async () => {
				throw new Error("reviewTask should not be reached");
			},
			runMainAcceptance: async () => {
				throw new Error("runMainAcceptance should not be reached");
			},
			createRepairDecision: () => {
				throw new Error("createRepairDecision should not be reached");
			},
		};

		const result = await runPlanRunEntry({
			bookPath,
			acceptingDir,
			repoPath: "/repo",
			project: "e2e-test",
			// Same enriched settings — spawnStage is still required because
			// role-bound execution is enabled.
			settings: { get: (key: string) => ENRICHED_SETTINGS[key] },
			deps,
		});

		expect(result.state).toBe("main_acceptance_fix_required");

		const summaryPath = join(acceptingDir, "gate-failure-summary.json");
		const summaryContent = await readFile(summaryPath, "utf8");
		const summary = JSON.parse(summaryContent);

		expect(summary.owner_role_id).toBe("superpowers:advisor");
		expect(summary.owner_role_label_zh).toBeTruthy();
		expect(summary.retest_role_id).toBe("superpowers:advisor");
		expect(summary.retest_role_label_zh).toBeTruthy();
		expect(summary.reason_zh).toContain("spawnStage");
		expect(summary.gate).toBe("advisor_gate");
	});
});
