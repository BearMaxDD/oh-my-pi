import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---- Existing production types ----
import type {
	PlanRunDriverDeps,
	PlanRunDriverInput,
	PlanRunDriverResult,
	RoleBoundStageRunOutput,
	SpawnTaskOutput,
} from "../../src/codex-plan-run/driver";
// ---- Future module (RED evidence — will fail to resolve until implemented) ----
import { launchPlanRunDriver } from "../../src/codex-plan-run/driver-launcher";
import type { PlanExecutionBook } from "../../src/codex-plan-run/execution-book";
import type { ExecutionLoopSettingsReader } from "../../src/codex-plan-run/execution-loop-settings";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const TEST_RUN_ID = "launcher-test-001";

/** Minimal role-bound settings that enable all gates. */
const ROLE_BOUND_SETTINGS: Record<string, unknown> = {
	"superpowers.executionLoop.mode": "role-bound",
	"superpowers.executionLoop.roleBoundExecution.enabled": true,
	"superpowers.executionLoop.roleBoundExecution.requireAdvisorGate": true,
	"superpowers.executionLoop.globalImpactGate.enabled": true,
	"superpowers.executionLoop.globalImpactGate.mode": "required",
	"superpowers.executionLoop.realBusinessSimulationGate.enabled": true,
	"superpowers.executionLoop.realBusinessSimulationGate.mode": "required",
	"superpowers.executionLoop.realBusinessSimulationGate.allowedEnvironments": ["local"],
	"superpowers.executionLoop.realBusinessSimulationGate.requireCleanupReport": true,
};

function makeSettingsReader(values: Record<string, unknown>): ExecutionLoopSettingsReader {
	return { get: key => values[key] };
}

function makeMinimalBook(acceptingDir: string): PlanExecutionBook {
	return {
		schema_version: 1,
		run_id: TEST_RUN_ID,
		created_at: "2026-06-30T00:00:00.000Z",
		plan: {
			path: "/repo/plan.md",
			sha256: "abc123",
			repo_path: "/repo",
		},
		accepting_dir: acceptingDir,
		intake_gate: [
			{
				gate: "plan_path_exists",
				result: "PASS" as const,
				evidence: "/repo/plan.md",
			},
		],
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
		final_acceptance_commands: [],
		tasks: [],
	};
}

const MINIMAL_SPAWN_OUTPUT: SpawnTaskOutput = {
	task_id: "T01",
	result: "completed",
	changed_files: [],
	tests_run: [],
	evidence: [],
	execution_skills_used: [],
	final_tail_skills_used: [],
	scope_notes: [],
};

const MINIMAL_STAGE_OUTPUT: RoleBoundStageRunOutput = {
	stage_id: "S01",
	role_id: "implementer",
	output_path: "/tmp/output",
	evidence_paths: [],
	...MINIMAL_SPAWN_OUTPUT,
};

// ---------------------------------------------------------------------------
// Helper: tmp dir lifecycle
// ---------------------------------------------------------------------------

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "omp-launcher-test-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) {
		await rm(dir, { recursive: true, force: true });
	}
});

// ---------------------------------------------------------------------------
// RED evidence — tests that define the expected contract before implementation
// ---------------------------------------------------------------------------

describe("launchPlanRunDriver", () => {
	it("calls injected runDriver with settings-derived defaults from role-bound settings", async () => {
		const acceptingDir = await makeTempDir();
		const book = makeMinimalBook(acceptingDir);
		const settings = makeSettingsReader(ROLE_BOUND_SETTINGS);

		// deps includes spawnStage to avoid preflight block
		const deps: PlanRunDriverDeps = {
			spawnTask: async () => MINIMAL_SPAWN_OUTPUT,
			reviewTask: async () => ({
				task_id: "T01",
				result: "TASK_ACCEPTED" as const,
				plan_compliance: "PASS" as const,
				scope_control: "PASS" as const,
				smoke_tests: "PASS" as const,
				evidence_quality: "PASS" as const,
				over_implementation_check: "PASS" as const,
				must_fix_items: [],
				review_skills_used: [],
				final_tail_skills_used: [],
			}),
			runMainAcceptance: async () => ({
				result: "MAIN_ACCEPTANCE_ACCEPTED" as const,
				review_round: 0,
				must_fix_items: [],
				accepted_at: "2026-06-30T00:00:00.000Z",
				evidence: [],
				next_allowed: "CodexReviewRequestPacket" as const,
			}),
			createRepairDecision: () => {
				throw new Error("should not be called");
			},
			spawnStage: async () => MINIMAL_STAGE_OUTPUT,
		};

		let capturedInput: PlanRunDriverInput | undefined;
		const mockRunDriver = async (
			input: PlanRunDriverInput,
			_deps: PlanRunDriverDeps,
		): Promise<PlanRunDriverResult> => {
			capturedInput = input;
			return { state: "ready_for_user" as const };
		};

		const result = await launchPlanRunDriver({
			acceptingDir,
			executionBook: book,
			repoPath: "/repo",
			project: "test-project",
			settings,
			deps,
			runDriver: mockRunDriver,
		});

		expect(result.state).toBe("ready_for_user");
		expect(capturedInput).toBeDefined();
		expect(capturedInput!.enableRoleBoundExecution).toBe(true);
		expect(capturedInput!.enableAdvisorGate).toBe(true);
		expect(capturedInput!.enableGlobalImpactGate).toBe(true);
		expect(capturedInput!.enableRealBusinessSimulationGate).toBe(true);
		expect(capturedInput!.superpowersGateMode).toBe("required");
	});

	it("lets explicit overrides win over settings defaults", async () => {
		const acceptingDir = await makeTempDir();
		const book = makeMinimalBook(acceptingDir);
		const settings = makeSettingsReader(ROLE_BOUND_SETTINGS);

		const deps: PlanRunDriverDeps = {
			spawnTask: async () => MINIMAL_SPAWN_OUTPUT,
			reviewTask: async () => ({
				task_id: "T01",
				result: "TASK_ACCEPTED" as const,
				plan_compliance: "PASS" as const,
				scope_control: "PASS" as const,
				smoke_tests: "PASS" as const,
				evidence_quality: "PASS" as const,
				over_implementation_check: "PASS" as const,
				must_fix_items: [],
				review_skills_used: [],
				final_tail_skills_used: [],
			}),
			runMainAcceptance: async () => ({
				result: "MAIN_ACCEPTANCE_ACCEPTED" as const,
				review_round: 0,
				must_fix_items: [],
				accepted_at: "2026-06-30T00:00:00.000Z",
				evidence: [],
				next_allowed: "CodexReviewRequestPacket" as const,
			}),
			createRepairDecision: () => {
				throw new Error("should not be called");
			},
			spawnStage: async () => MINIMAL_STAGE_OUTPUT,
		};

		let capturedInput: PlanRunDriverInput | undefined;
		const mockRunDriver = async (
			input: PlanRunDriverInput,
			_deps: PlanRunDriverDeps,
		): Promise<PlanRunDriverResult> => {
			capturedInput = input;
			return { state: "ready_for_user" as const };
		};

		// Explicitly override enableRealBusinessSimulationGate to false
		const overrides = { enableRealBusinessSimulationGate: false as const };

		const result = await launchPlanRunDriver({
			acceptingDir,
			executionBook: book,
			repoPath: "/repo",
			project: "test-project",
			settings,
			deps,
			overrides,
			runDriver: mockRunDriver,
		});

		expect(result.state).toBe("ready_for_user");
		expect(capturedInput).toBeDefined();
		// Settings default was true, but explicit override wins
		expect(capturedInput!.enableRealBusinessSimulationGate).toBe(false);
		// Other fields should still come from settings
		expect(capturedInput!.enableRoleBoundExecution).toBe(true);
		expect(capturedInput!.enableAdvisorGate).toBe(true);
		expect(capturedInput!.enableGlobalImpactGate).toBe(true);
	});

	it("passes runtimeCommandTimeoutMs from overrides into driverInput", async () => {
		const acceptingDir = await makeTempDir();
		const book = makeMinimalBook(acceptingDir);
		const settings = makeSettingsReader(ROLE_BOUND_SETTINGS);

		const deps: PlanRunDriverDeps = {
			spawnTask: async () => MINIMAL_SPAWN_OUTPUT,
			reviewTask: async () => ({
				task_id: "T01",
				result: "TASK_ACCEPTED" as const,
				plan_compliance: "PASS" as const,
				scope_control: "PASS" as const,
				smoke_tests: "PASS" as const,
				evidence_quality: "PASS" as const,
				over_implementation_check: "PASS" as const,
				must_fix_items: [],
				review_skills_used: [],
				final_tail_skills_used: [],
			}),
			runMainAcceptance: async () => ({
				result: "MAIN_ACCEPTANCE_ACCEPTED" as const,
				review_round: 0,
				must_fix_items: [],
				accepted_at: "2026-06-30T00:00:00.000Z",
				evidence: [],
				next_allowed: "CodexReviewRequestPacket" as const,
			}),
			createRepairDecision: () => {
				throw new Error("should not be called");
			},
			spawnStage: async () => MINIMAL_STAGE_OUTPUT,
		};

		let capturedInput: PlanRunDriverInput | undefined;
		const mockRunDriver = async (
			input: PlanRunDriverInput,
			_deps: PlanRunDriverDeps,
		): Promise<PlanRunDriverResult> => {
			capturedInput = input;
			return { state: "ready_for_user" as const };
		};

		const result = await launchPlanRunDriver({
			acceptingDir,
			executionBook: book,
			repoPath: "/repo",
			project: "test-project",
			settings,
			deps,
			overrides: { runtimeCommandTimeoutMs: 12345 },
			runDriver: mockRunDriver,
		});

		expect(result.state).toBe("ready_for_user");
		expect(capturedInput).toBeDefined();
		expect(capturedInput!.runtimeCommandTimeoutMs).toBe(12345);
		// Gate defaults from settings should still be present
		expect(capturedInput!.enableRoleBoundExecution).toBe(true);
		expect(capturedInput!.enableAdvisorGate).toBe(true);
		expect(capturedInput!.enableGlobalImpactGate).toBe(true);
	});

	it("lets overrides.runtimeScenario win over settings-derived values", async () => {
		const acceptingDir = await makeTempDir();
		const book = makeMinimalBook(acceptingDir);
		// Settings that default all three runtimeScenario kinds to disabled
		const settings = makeSettingsReader({
			...ROLE_BOUND_SETTINGS,
			"superpowers.executionLoop.runtimeScenario.browser.enabled": false,
			"superpowers.executionLoop.runtimeScenario.api.enabled": false,
			"superpowers.executionLoop.runtimeScenario.database.enabled": false,
		});

		const deps: PlanRunDriverDeps = {
			spawnTask: async () => MINIMAL_SPAWN_OUTPUT,
			reviewTask: async () => ({
				task_id: "T01",
				result: "TASK_ACCEPTED" as const,
				plan_compliance: "PASS" as const,
				scope_control: "PASS" as const,
				smoke_tests: "PASS" as const,
				evidence_quality: "PASS" as const,
				over_implementation_check: "PASS" as const,
				must_fix_items: [],
				review_skills_used: [],
				final_tail_skills_used: [],
			}),
			runMainAcceptance: async () => ({
				result: "MAIN_ACCEPTANCE_ACCEPTED" as const,
				review_round: 0,
				must_fix_items: [],
				accepted_at: "2026-06-30T00:00:00.000Z",
				evidence: [],
				next_allowed: "CodexReviewRequestPacket" as const,
			}),
			createRepairDecision: () => {
				throw new Error("should not be called");
			},
			spawnStage: async () => MINIMAL_STAGE_OUTPUT,
		};

		let capturedInput: PlanRunDriverInput | undefined;
		const mockRunDriver = async (
			input: PlanRunDriverInput,
			_deps: PlanRunDriverDeps,
		): Promise<PlanRunDriverResult> => {
			capturedInput = input;
			return { state: "ready_for_user" as const };
		};

		const overrideRuntimeScenario = {
			browser: { enabled: true },
			api: { enabled: true },
			database: { enabled: false },
		};

		const result = await launchPlanRunDriver({
			acceptingDir,
			executionBook: book,
			repoPath: "/repo",
			project: "test-project",
			settings,
			deps,
			overrides: { runtimeScenario: overrideRuntimeScenario },
			runDriver: mockRunDriver,
		});

		expect(result.state).toBe("ready_for_user");
		expect(capturedInput).toBeDefined();
		// Override wins — browser and api are enabled even though settings said false
		expect(capturedInput!.runtimeScenario).toEqual(overrideRuntimeScenario);
		// Other gate defaults from settings still present
		expect(capturedInput!.enableRoleBoundExecution).toBe(true);
	});

	it("lets overrides.classification win over settings-derived values", async () => {
		const acceptingDir = await makeTempDir();
		const book = makeMinimalBook(acceptingDir);
		// Settings that enable classification
		const settings = makeSettingsReader(ROLE_BOUND_SETTINGS);

		const deps: PlanRunDriverDeps = {
			spawnTask: async () => MINIMAL_SPAWN_OUTPUT,
			reviewTask: async () => ({
				task_id: "T01",
				result: "TASK_ACCEPTED" as const,
				plan_compliance: "PASS" as const,
				scope_control: "PASS" as const,
				smoke_tests: "PASS" as const,
				evidence_quality: "PASS" as const,
				over_implementation_check: "PASS" as const,
				must_fix_items: [],
				review_skills_used: [],
				final_tail_skills_used: [],
			}),
			runMainAcceptance: async () => ({
				result: "MAIN_ACCEPTANCE_ACCEPTED" as const,
				review_round: 0,
				must_fix_items: [],
				accepted_at: "2026-06-30T00:00:00.000Z",
				evidence: [],
				next_allowed: "CodexReviewRequestPacket" as const,
			}),
			createRepairDecision: () => {
				throw new Error("should not be called");
			},
			spawnStage: async () => MINIMAL_STAGE_OUTPUT,
		};

		let capturedInput: PlanRunDriverInput | undefined;
		const mockRunDriver = async (
			input: PlanRunDriverInput,
			_deps: PlanRunDriverDeps,
		): Promise<PlanRunDriverResult> => {
			capturedInput = input;
			return { state: "ready_for_user" as const };
		};

		// Override classification to disabled, even though default is enabled
		const overrideClassification = {
			enabled: false,
			requireReviewerEvidence: false,
		};

		const result = await launchPlanRunDriver({
			acceptingDir,
			executionBook: book,
			repoPath: "/repo",
			project: "test-project",
			settings,
			deps,
			overrides: { classification: overrideClassification },
			runDriver: mockRunDriver,
		});

		expect(result.state).toBe("ready_for_user");
		expect(capturedInput).toBeDefined();
		// Override wins — classification is disabled even though settings default to enabled
		expect(capturedInput!.classification).toEqual(overrideClassification);
		// Other gate defaults from settings still present
		expect(capturedInput!.enableRoleBoundExecution).toBe(true);
	});

	it("blocks when role-bound execution enabled but deps.spawnStage is missing", async () => {
		const acceptingDir = await makeTempDir();
		const book = makeMinimalBook(acceptingDir);
		const settings = makeSettingsReader(ROLE_BOUND_SETTINGS);

		// deps without spawnStage
		const depsNoStage: PlanRunDriverDeps = {
			spawnTask: async () => MINIMAL_SPAWN_OUTPUT,
			reviewTask: async () => ({
				task_id: "T01",
				result: "TASK_ACCEPTED" as const,
				plan_compliance: "PASS" as const,
				scope_control: "PASS" as const,
				smoke_tests: "PASS" as const,
				evidence_quality: "PASS" as const,
				over_implementation_check: "PASS" as const,
				must_fix_items: [],
				review_skills_used: [],
				final_tail_skills_used: [],
			}),
			runMainAcceptance: async () => ({
				result: "MAIN_ACCEPTANCE_ACCEPTED" as const,
				review_round: 0,
				must_fix_items: [],
				accepted_at: "2026-06-30T00:00:00.000Z",
				evidence: [],
				next_allowed: "CodexReviewRequestPacket" as const,
			}),
			createRepairDecision: () => {
				throw new Error("should not be called");
			},
			// spawnStage intentionally omitted
		};

		let runDriverCalled = false;
		const mockRunDriver = async (
			_input: PlanRunDriverInput,
			_deps: PlanRunDriverDeps,
		): Promise<PlanRunDriverResult> => {
			runDriverCalled = true;
			return { state: "ready_for_user" as const };
		};

		const result = await launchPlanRunDriver({
			acceptingDir,
			executionBook: book,
			repoPath: "/repo",
			project: "test-project",
			settings,
			deps: depsNoStage,
			runDriver: mockRunDriver,
		});

		// runDriver must NOT be called
		expect(runDriverCalled).toBe(false);

		// Result state is fix-required
		expect(result.state).toBe("main_acceptance_fix_required");

		// Gate-failure-summary.md must be written with the expected Chinese reason
		const md = await readFile(join(acceptingDir, "gate-failure-summary.md"), "utf8");
		expect(md).toContain("原因：role-bound execution requires spawnStage dependency");
	});

	it("writes gate-failure-summary when runDriver returns fix-required", async () => {
		const acceptingDir = await makeTempDir();
		const book = makeMinimalBook(acceptingDir);
		const settings = makeSettingsReader(ROLE_BOUND_SETTINGS);

		const deps: PlanRunDriverDeps = {
			spawnTask: async () => MINIMAL_SPAWN_OUTPUT,
			reviewTask: async () => ({
				task_id: "T01",
				result: "TASK_ACCEPTED" as const,
				plan_compliance: "PASS" as const,
				scope_control: "PASS" as const,
				smoke_tests: "PASS" as const,
				evidence_quality: "PASS" as const,
				over_implementation_check: "PASS" as const,
				must_fix_items: [],
				review_skills_used: [],
				final_tail_skills_used: [],
			}),
			runMainAcceptance: async () => ({
				result: "MAIN_ACCEPTANCE_ACCEPTED" as const,
				review_round: 0,
				must_fix_items: [],
				accepted_at: "2026-06-30T00:00:00.000Z",
				evidence: [],
				next_allowed: "CodexReviewRequestPacket" as const,
			}),
			createRepairDecision: () => {
				throw new Error("should not be called");
			},
			spawnStage: async () => MINIMAL_STAGE_OUTPUT,
		};

		// Inject a runDriver that returns fix-required with the target reason
		const fixRequiredResult: PlanRunDriverResult = {
			state: "main_acceptance_fix_required",
			decision: {
				kind: "MAIN_ACCEPTANCE_REPAIR",
				nextState: "main_acceptance_fix_required",
				requiresWritingPlans: false,
				reason: "No repairable PlanRun failure was provided.",
				book,
				originalPlanPath: book.plan.path,
				originalPlanSha256: book.plan.sha256,
				repoPath: "/repo",
				worktreePath: "",
				acceptingDir,
				repairRound: 0,
				maxRepairRounds: 3,
				subagentAssignment: "driver-launcher-test",
			},
		};
		const failingRunDriver = async (
			_input: PlanRunDriverInput,
			_deps: PlanRunDriverDeps,
		): Promise<PlanRunDriverResult> => fixRequiredResult;

		const result = await launchPlanRunDriver({
			acceptingDir,
			executionBook: book,
			repoPath: "/repo",
			project: "test-project",
			settings,
			deps,
			runDriver: failingRunDriver,
		});

		expect(result.state).toBe("main_acceptance_fix_required");

		// JSON artifact must exist and contain the reason
		const jsonPath = join(acceptingDir, "gate-failure-summary.json");
		const jsonContent = JSON.parse(await readFile(jsonPath, "utf8"));
		expect(jsonContent.reason_zh).toContain("No repairable PlanRun failure was provided.");

		// Markdown artifact must exist and contain the reason in flat format
		const mdPath = join(acceptingDir, "gate-failure-summary.md");
		const md = await readFile(mdPath, "utf8");
		expect(md).toContain("原因：No repairable PlanRun failure was provided.");
	});
});
