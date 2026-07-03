/**
 * Task 9 — PlanRun CLI entry end-to-end fixture.
 *
 * Tests the full productized entry path through:
 * - `runPlanRunEntry()` → `launchPlanRunDriver()` → `runPlanRunDriver()`
 * - `createPlanRunProductionSpawnAdapter` with a controlled runner
 * - Real `reviewTaskExecution`, `runMainThreadAcceptanceReview`,
 *   and `createPlanRunRepairDecision` implementations
 *
 * The controlled runner returns evidence matching the required_outputs
 * from each stage's compiled prompt pack, ensuring the spawn adapter's
 * required-evidence check does NOT downgrade stages to "blocked".
 *
 * TDD order: RED_EVIDENCE (exit 1), GREEN_EVIDENCE (exit 0),
 * REGRESSION_EVIDENCE (exit 0) — enforced by both the real task-review
 * validation and the main-thread acceptance gate.
 *
 * Expected target state: ready_for_user.
 */
import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import type {
	PlanRunDriverDeps,
	PlanRunDriverInput,
	PlanRunDriverResult,
	SpawnTaskOutput,
} from "../../src/codex-plan-run/driver";
import { runPlanRunDriver } from "../../src/codex-plan-run/driver";
import type { PlanExecutionBook } from "../../src/codex-plan-run/execution-book";
import { runMainThreadAcceptanceReview } from "../../src/codex-plan-run/main-acceptance-review";
import { runPlanRunEntry } from "../../src/codex-plan-run/plan-run-entry";
import type { PlanRunSubagentRunner, PlanRunTaskSpawnParams } from "../../src/codex-plan-run/plan-run-spawn-adapter";
import { createPlanRunProductionSpawnAdapter } from "../../src/codex-plan-run/plan-run-spawn-adapter";
import type { RuntimeSimulationRunner } from "../../src/codex-plan-run/real-runtime-simulation";
import { createPlanRunRepairDecision } from "../../src/codex-plan-run/repair-loop";
import { reviewTaskExecution } from "../../src/codex-plan-run/task-review";
import { createPlanRunDeps } from "../../src/commands/plan-run";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_RUN_ID = "cli-e2e-happy-path";

function skillEvidence(name: string) {
	return {
		name,
		source_path: `skill://${name}`,
		content_sha256: `${name}-sha256`,
		loaded_at: "2026-07-01T00:00:00.000Z",
		guidance: `${name} guidance`,
	};
}

const STAGE_IDS = [
	"tdd-writer",
	"implementer",
	"test-runner",
	"spec-reviewer",
	"quality-reviewer",
	"acceptance",
] as const;

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
		plan: {
			path: "/repo/plan.md",
			sha256: "abc123def456",
			repo_path: "/repo",
		},
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
		required_review_skills: [skillEvidence("requesting-code-review")],
		final_tail_skills: [skillEvidence("verification-before-completion")],
		final_acceptance_commands: ["bun test"],
		tasks: [
			{
				id: "T01",
				title: "CLI E2E test task",
				source: "plan-section-1",
				todo: "Implement the CLI E2E fixture contract",
				execution_skills: [],
				review_skills: ["requesting-code-review"],
				final_tail_skills: ["verification-before-completion"],
				allowed_files: ["src/index.ts"],
				forbidden_files: [],
				smoke_commands: ["bun test"],
				tdd_gates: {
					red: {
						command: "bun test",
						expected: "FAIL",
						evidence_required: "RED_EVIDENCE",
					},
					green: {
						command: "bun test",
						expected: "PASS",
						evidence_required: "GREEN_EVIDENCE",
					},
					regression: {
						command: "bun test",
						expected: "PASS",
						evidence_required: "REGRESSION_EVIDENCE",
					},
				},
				advisor_watch_points: [],
				required_skill_evidence: [],
				skill_evidence: {
					execution: [],
					review: [skillEvidence("requesting-code-review")],
					final_tail: [skillEvidence("verification-before-completion")],
				},
				implementation_analysis: "",
				execution_scope: {
					goal: "Prove the productized CLI E2E fixture contract",
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

/**
 * Controlled runner that simulates a real subagent.
 *
 * Returns the required artifact paths (from params.required_skill_evidence)
 * in the `evidence` array so the spawn adapter's required-outputs check
 * passes.  Each stage appears completed with deterministic metadata.
 */
function createControlledRunner(): PlanRunSubagentRunner {
	return {
		run: async (params: PlanRunTaskSpawnParams): Promise<SpawnTaskOutput> => {
			// Extract task id from params.id like "T01-tdd-writer"
			const taskId = params.id.includes("-") ? params.id.split("-")[0] : params.id;
			const stageId = params.id.includes("-") ? params.id.split("-").slice(1).join("-") : params.id;

			return {
				task_id: taskId,
				changed_files: ["src/index.ts"],
				tests_run: ["bun test"],
				evidence: [...(params.required_skill_evidence ?? [])],
				execution_skills_used: [],
				final_tail_skills_used: ["verification-before-completion"],
				scope_notes: ["controlled-runner", stageId],
				result: "completed",
				agentId: "controlled-agent",
				modelRole: params.modelRole,
				resolvedModel: "deepseek/deepseek-v4-flash",
				modelOverrides: [],
				advisorFindings: [],
			};
		},
	};
}

/** Mock runtime runner that never touches real processes or I/O. */
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

/**
 * Build production deps through createPlanRunDeps with an explicit test bridge,
 * run the entry path, and return result + snapshots.
 */
async function runCliWithDefaultDepsFixture(): Promise<{
	result: PlanRunDriverResult;
	acceptingDir: string;
	snapshots: unknown[];
}> {
	const acceptingDir = await makeTempDir();
	const book = makeBook(acceptingDir);
	await writeFile(join(acceptingDir, "execution-book.json"), JSON.stringify(book), "utf8");

	const snapshots: unknown[] = [];

	// ---- Build production deps through createPlanRunDeps with an explicit test bridge ----

	const deps = await createPlanRunDeps({
		cwd: "/repo",
		acceptingDir,
		bridge: async params => {
			const requiredEvidencePaths = params.required_skill_evidence ?? [];
			const stageId = STAGE_IDS.find(id => params.id.endsWith(`-${id}`));
			const taskId = stageId ? params.id.slice(0, -(stageId.length + 1)) : params.id;
			const jsonOutputPath = stageId
				? join(acceptingDir, "tasks", taskId, "stages", stageId, "output.json")
				: join(acceptingDir, "tasks", taskId, "output.json");
			await mkdir(dirname(jsonOutputPath), { recursive: true });

			for (const evidencePath of requiredEvidencePaths) {
				const artifactPath = join(acceptingDir, evidencePath);
				await mkdir(dirname(artifactPath), { recursive: true });
				const artifact = {
					task_id: taskId,
					stage_id: stageId ?? null,
					artifact_path: evidencePath,
					result: "completed" as const,
				};
				const body = evidencePath.endsWith(".json")
					? `${JSON.stringify(artifact, null, 2)}\n`
					: [
							`PlanRun evidence for ${taskId}`,
							stageId ? `Stage: ${stageId}` : "Stage: task",
							`Artifact: ${evidencePath}`,
							"Result: completed",
							"",
						].join("\n");
				await writeFile(artifactPath, body, "utf8");
			}

			const output = {
				task_id: taskId,
				stage_id: stageId ?? null,
				result: "completed" as const,
				changed_files: ["src/index.ts"],
				tests_run: ["bun test"],
				evidence: requiredEvidencePaths,
				execution_skills_used: ["test-driven-development"],
				final_tail_skills_used: ["verification-before-completion"],
			};
			await writeFile(jsonOutputPath, JSON.stringify(output, null, 2), "utf8");
			return {
				exitCode: 0,
				outputPath: requiredEvidencePaths[0] ?? jsonOutputPath,
				evidence: requiredEvidencePaths.length > 0 ? requiredEvidencePaths : undefined,
				id: params.id,
				modelRole: params.modelRole,
				resolvedModel: "fixture-model",
				changed_files: output.changed_files,
				tests_run: output.tests_run,
				execution_skills_used: output.execution_skills_used,
				final_tail_skills_used: output.final_tail_skills_used,
			};
		},
	});
	// ---- Local deterministic runtime runner (no real processes) ----

	const localSimRunner = {
		start: async () => ({ status: "passed" as const, logs: [] }),
		executeScenario: async (scenario: { id: string }) => ({
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

	// ---- Run the full entry path ----

	const result = await runPlanRunEntry({
		bookPath: join(acceptingDir, "execution-book.json"),
		acceptingDir,
		repoPath: "/repo",
		project: "cli-e2e-test",
		settings: { get: (key: string) => ENRICHED_SETTINGS[key] },
		deps,
		runDriver: async (input: PlanRunDriverInput, driverDeps: PlanRunDriverDeps): Promise<PlanRunDriverResult> => {
			return runPlanRunDriver(
				{
					...input,
					enableAdvisorGate: false,
					enableGlobalImpactGate: true,
					enableRealBusinessSimulationGate: true,
					superpowersGateMode: "advisory",

					commands: [
						{
							command: "bun test T01",
							exit_code: 0,
							evidence: "PASS",
						},
						{
							command: "bun test",
							exit_code: 0,
							evidence: "PASS",
						},
					],

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

					skillEvidenceMatrix: { tasks: { T01: [] } },
					advisorSummary: { items: [] },
					manifestPath: join(acceptingDir, "manifest.json"),
					completionDocPath: join(acceptingDir, "omp-completion.md"),
					runtimeSimulationRunner: localSimRunner,
				},
				driverDeps,
			);
		},
		statusSink: {
			update: async snapshot => {
				snapshots.push(snapshot);
			},
		},
	});

	return { result, acceptingDir, snapshots };
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "omp-cli-e2e-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) {
		await rm(dir, { recursive: true, force: true });
	}
});

async function readAllTextFiles(dir: string): Promise<string> {
	let out = "";
	for (const entry of await readdir(dir)) {
		const path = join(dir, entry);
		const info = await stat(path);
		if (info.isDirectory()) out += await readAllTextFiles(path);
		else if (entry.endsWith(".json") || entry.endsWith(".md") || entry.endsWith(".txt"))
			out += await readFile(path, "utf8");
	}
	return out;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("PlanRun CLI entry E2E (createPlanRunProductionSpawnAdapter + real deps)", () => {
	it("regression-only: controlled runner still exercises production spawn adapter mapping, all role-bound stages, and reaches ready_for_user", async () => {
		const acceptingDir = await makeTempDir();
		const bookPath = join(acceptingDir, "execution-book.json");
		await writeFile(bookPath, JSON.stringify(makeBook(acceptingDir)), "utf8");

		// ---- Build deps using the production spawn adapter ----

		const runner = createControlledRunner();
		const { spawnTask, spawnStage } = createPlanRunProductionSpawnAdapter({ runner });

		const deps: PlanRunDriverDeps = {
			spawnTask,
			spawnStage,
			reviewTask: async request => reviewTaskExecution(request),
			runMainAcceptance: async request => runMainThreadAcceptanceReview(request),
			createRepairDecision: input => createPlanRunRepairDecision(input),
		};

		// ---- Run the full entry path ----

		const result = await runPlanRunEntry({
			bookPath,
			acceptingDir,
			repoPath: "/repo",
			project: "cli-e2e-test",
			settings: { get: (key: string) => ENRICHED_SETTINGS[key] },
			deps,
			runDriver: async (input: PlanRunDriverInput, driverDeps: PlanRunDriverDeps): Promise<PlanRunDriverResult> => {
				return runPlanRunDriver(
					{
						...input,
						// Disable the advisor gate in this fixture because the
						// controlled runner returns synthetic stage results with
						// no real advisor records.
						enableAdvisorGate: false,
						enableGlobalImpactGate: true,
						enableRealBusinessSimulationGate: true,
						superpowersGateMode: "advisory",

						// Command evidence for final acceptance verification
						// and global-impact / runtime simulation gates.
						commands: [
							{
								command: "bun test T01",
								exit_code: 0,
								evidence: "PASS",
							},
							{
								command: "bun test",
								exit_code: 0,
								evidence: "PASS",
							},
						],

						// TDD evidence matching the task T01 gates: RED (exit 1),
						// GREEN (exit 0), REGRESSION (exit 0) in chronological order.
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

						// No required skills for the fixture task.
						skillEvidenceMatrix: { tasks: { T01: [] } },

						// Empty advisor summary — passes because the advisor
						// gate is disabled at the driver level above.
						advisorSummary: { items: [] },

						// The acceptance gate requires non-empty paths.
						manifestPath: join(acceptingDir, "manifest.json"),
						completionDocPath: join(acceptingDir, "omp-completion.md"),

						// Deterministic simulation — no real processes.
						runtimeSimulationRunner: MOCK_RUNTIME_RUNNER,
					},
					driverDeps,
				);
			},
		});

		// ---- Phase 1: Result state ----
		// The full pipeline reached the acceptance gate and accepted.
		expect(result.state).toBe("ready_for_user");

		// ---- Phase 2: Task review records are accepted ----
		expect(result.specTaskFramework).toBeDefined();

		// ---- Phase 3: Disk artifacts ----
		const diskFiles = await readdir(acceptingDir);

		// Role-bound execution artifacts written by the driver.
		for (const artifact of [
			"spec-task-framework.json",
			"global-impact-report.json",
			"real-runtime-simulation-report.json",
			"runtime-cleanup-report.md",
		]) {
			expect(diskFiles).toContain(artifact);
			const artStat = await stat(join(acceptingDir, artifact));
			expect(artStat.isFile()).toBe(true);
		}

		// Role-bound stage ledger entries should exist per task stage.
		const tasksDir = await readdir(join(acceptingDir, "tasks"));
		expect(tasksDir).toContain("T01");

		const t01Dir = await readdir(join(acceptingDir, "tasks", "T01"));
		expect(t01Dir).toContain("stages");
		expect(t01Dir).toContain("prompt-packs");
		expect(t01Dir).toContain("codebase-memory-reindex.json");

		// Each stage should have a written output.json.
		const stagesDir = await readdir(join(acceptingDir, "tasks", "T01", "stages"));
		for (const stageId of STAGE_IDS) {
			expect(stagesDir).toContain(stageId);
			const stageFiles = await readdir(join(acceptingDir, "tasks", "T01", "stages", stageId));
			expect(stageFiles).toContain("output.json");
		}

		// Prompt packs should have been written for each stage.
		const promptPacksDir = await readdir(join(acceptingDir, "tasks", "T01", "prompt-packs"));
		for (const stageId of STAGE_IDS) {
			expect(promptPacksDir).toContain(`${stageId}.json`);
			expect(promptPacksDir).toContain(`${stageId}.md`);
		}

		// ---- Phase 4: No failure summary mentioning spawn dependency ----
		const failureSummaryPath = join(acceptingDir, "gate-failure-summary.json");
		let failureSummaryExists = false;
		try {
			await stat(failureSummaryPath);
			failureSummaryExists = true;
		} catch {
			// Not written on ready_for_user — that's the expected happy path.
		}
		if (failureSummaryExists) {
			const raw = await readFile(failureSummaryPath, "utf8");
			const summary = JSON.parse(raw);
			const serialized = JSON.stringify(summary);
			expect(serialized.toLowerCase()).not.toContain("spawnstage");
			expect(serialized.toLowerCase()).not.toContain("spawn deps");
			expect(serialized.toLowerCase()).not.toContain("missing spawn dependencies");
		}
	});

	it("default CLI deps path does not emit unwired or controlled-runner success artifacts", async () => {
		const { result, acceptingDir, snapshots } = await runCliWithDefaultDepsFixture();
		const allText = await readAllTextFiles(acceptingDir);

		expect(result.state).not.toBe("failed");
		expect(allText).not.toContain("dependency is not wired");
		expect(allText).not.toContain("Subagent runner 未接入");
		expect(allText).not.toContain("subagent_runner_unavailable_in_command_context");
		expect(allText).not.toContain("MOCK_RUNTIME_RUNNER");
		expect(allText).not.toContain("createControlledRunner");

		const artifactNames = await readdir(acceptingDir);
		expect(artifactNames).toContain("spec-task-framework.json");
		expect(artifactNames).toContain("global-impact-report.json");
		expect(artifactNames).toContain("real-runtime-simulation-report.json");

		const tasksDir = await readdir(join(acceptingDir, "tasks"));
		expect(tasksDir.length).toBeGreaterThan(0);
		expect(snapshots.length).toBeGreaterThan(0);
		expect(JSON.stringify(snapshots)).toContain(TEST_RUN_ID);
	});
});
