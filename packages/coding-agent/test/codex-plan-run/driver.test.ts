import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PlanRunDriverDeps, SpawnTaskOutput } from "../../src/codex-plan-run/driver";
import { runPlanRunDriver } from "../../src/codex-plan-run/driver";
import type { PlanExecutionBook } from "../../src/codex-plan-run/execution-book";
import {
	type MainThreadAcceptanceReviewResult,
	runMainThreadAcceptanceReview,
} from "../../src/codex-plan-run/main-acceptance-review";
import type { PlanRunRepairDecision } from "../../src/codex-plan-run/repair-loop";
import type { TaskReviewResult } from "../../src/codex-plan-run/task-review";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "omp-driver-test-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) {
		await rm(dir, { recursive: true, force: true });
	}
});

const book: PlanExecutionBook = {
	schema_version: 1,
	run_id: "run-driver-test",
	created_at: "2026-06-30T00:00:00.000Z",
	plan: {
		path: "/repo/plan.md",
		sha256: "abc123def456",
		repo_path: "/repo",
	},
	accepting_dir: "/tmp/accept",
	intake_gate: [{ gate: "plan_path_exists", result: "PASS", evidence: "/repo/plan.md" }],
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
			title: "Driver test task",
			source: "plan-section-1",
			todo: "Implement the thing",
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
				goal: "Do the thing",
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

const acceptedReview: TaskReviewResult = {
	task_id: "T01",
	review_skills_used: [],
	final_tail_skills_used: [],
	plan_compliance: "PASS",
	scope_control: "PASS",
	smoke_tests: "PASS",
	evidence_quality: "PASS",
	over_implementation_check: "PASS",
	result: "TASK_ACCEPTED",
	must_fix_items: [],
};

const fixRequiredReview: TaskReviewResult = {
	task_id: "T01",
	review_skills_used: [],
	final_tail_skills_used: [],
	plan_compliance: "FAIL",
	scope_control: "PASS",
	smoke_tests: "PASS",
	evidence_quality: "PASS",
	over_implementation_check: "PASS",
	result: "TASK_FIX_REQUIRED",
	must_fix_items: [
		{
			id: "reindex_failed",
			description: "Codebase memory reindex status failed",
			evidence: "reindex evidence shows failed status",
		},
	],
};

const mainAcceptanceAccepted: MainThreadAcceptanceReviewResult = {
	result: "MAIN_ACCEPTANCE_ACCEPTED",
	review_round: 0,
	must_fix_items: [],
	accepted_at: "2026-06-30T00:00:00.000Z",
	evidence: [],
	next_allowed: "CodexReviewRequestPacket",
};

const mainAcceptanceFixRequired: MainThreadAcceptanceReviewResult = {
	result: "MAIN_ACCEPTANCE_FIX_REQUIRED",
	review_round: 0,
	must_fix_items: [
		{
			id: "tdd_evidence_missing",
			category: "evidence",
			severity: "must_fix",
			description: "TDD evidence is missing",
			evidence: "red/green/regression evidence not found",
			required_fix: "Add missing evidence",
			affected_tasks: ["T01"],
			required_commands: [],
			authorized_files: [],
		},
	],
	next_task: "OmpFixExecutionTask",
};

function makeAcceptedDeps(): PlanRunDriverDeps {
	return {
		spawnTask: async (input): Promise<SpawnTaskOutput> => ({
			task_id: input.taskId,
			result: "completed",
			changed_files: ["src/index.ts"],
			tests_run: ["bun test"],
			evidence: ["test evidence"],
			execution_skills_used: [],
			final_tail_skills_used: [],
			scope_notes: [],
			agentId: "agent-1",
			modelRole: "executor",
			resolvedModel: "claude-opus-4",
			advisorFindings: [],
		}),
		reviewTask: async () => acceptedReview,
		runMainAcceptance: async () => mainAcceptanceAccepted,
		createRepairDecision: () => {
			throw new Error("createRepairDecision should not be called on happy path");
		},
	};
}

describe("PlanRun driver", () => {
	it("drives the full happy path and writes all artifacts", async () => {
		const acceptingDir = await makeTempDir();

		const deps = makeAcceptedDeps();

		const result = await runPlanRunDriver(
			{
				acceptingDir,
				executionBook: book,
				repoPath: "/repo",
				project: "test-project",
				reindexProvider: null,
				superpowersSkillName: "test-driven-development",
				superpowersGateMode: "advisory",
			},
			deps,
		);

		expect(result.state).toBe("ready_for_user");
		expect(result.decision).toBeUndefined();

		// Verify events.jsonl exists and contains expected events
		const eventsPath = join(acceptingDir, "events.jsonl");
		const eventsStat = await stat(eventsPath);
		expect(eventsStat.isFile()).toBe(true);

		const eventsContent = await readFile(eventsPath, "utf8");
		const lines = eventsContent.trim().split("\n");
		expect(lines.length).toBeGreaterThanOrEqual(1);

		const parsedEvents = lines.map(line => JSON.parse(line));
		const lastEvent = parsedEvents[parsedEvents.length - 1];
		expect(lastEvent.type).toBe("ready_for_codex_review");
		expect(lastEvent.run_id).toBe("run-driver-test");

		// Verify codebase-memory-reindex.json exists for T01
		const reindexPath = join(acceptingDir, "tasks", "T01", "codebase-memory-reindex.json");
		const reindexStat = await stat(reindexPath);
		expect(reindexStat.isFile()).toBe(true);

		const reindexContent = await readFile(reindexPath, "utf8");
		const reindexParsed = JSON.parse(reindexContent);
		expect(reindexParsed.task_id).toBe("T01");
		expect(reindexParsed.run_id).toBe("run-driver-test");

		// Verify model-routing-evidence.json exists for T01
		const modelEvidencePath = join(acceptingDir, "tasks", "T01", "model-routing-evidence.json");
		const modelStat = await stat(modelEvidencePath);
		expect(modelStat.isFile()).toBe(true);

		const modelContent = await readFile(modelEvidencePath, "utf8");
		const modelParsed = JSON.parse(modelContent);
		expect(modelParsed.task_id).toBe("T01");
		expect(modelParsed.resolved_model).toBe("claude-opus-4");

		// Verify codex-review-request.md exists
		const reviewRequestPath = join(acceptingDir, "codex-review-request.md");
		const reviewStat = await stat(reviewRequestPath);
		expect(reviewStat.isFile()).toBe(true);

		const reviewContent = await readFile(reviewRequestPath, "utf8");
		expect(reviewContent).toContain("Codex Review Request");
		expect(reviewContent).toContain("run-driver-test");
	});

	it("returns task_fix_required when task review rejects", async () => {
		const acceptingDir = await makeTempDir();

		let repairCalled = false;

		const deps: PlanRunDriverDeps = {
			spawnTask: async (input): Promise<SpawnTaskOutput> => ({
				task_id: input.taskId,
				result: "completed",
				changed_files: ["src/index.ts"],
				tests_run: [],
				evidence: [],
				execution_skills_used: [],
				final_tail_skills_used: [],
				scope_notes: [],
				agentId: "agent-1",
				modelRole: "executor",
				resolvedModel: "claude-opus-4",
				advisorFindings: [],
			}),
			reviewTask: async () => fixRequiredReview,
			runMainAcceptance: async () => {
				throw new Error("runMainAcceptance should not be called after review fails");
			},
			createRepairDecision: input => {
				repairCalled = true;
				const decision: PlanRunRepairDecision = {
					kind: "TASK_LOCAL_REPAIR",
					nextState: "task_fix_required",
					requiresWritingPlans: false,
					reason: "Task review found must-fix items",
					book: input.book,
					originalPlanPath: input.book.plan.path,
					originalPlanSha256: input.book.plan.sha256,
					repoPath: input.repoPath ?? "",
					worktreePath: input.worktreePath ?? "",
					acceptingDir: input.acceptingDir ?? "",
					repairRound: input.repairRound,
					maxRepairRounds: input.maxRepairRounds,
					subagentAssignment: "fix T01 based on review findings",
				};
				return decision;
			},
		};

		const result = await runPlanRunDriver(
			{
				acceptingDir,
				executionBook: book,
				repoPath: "/repo",
				project: "test-project",
				reindexProvider: null,
				superpowersSkillName: "test-driven-development",
				superpowersGateMode: "advisory",
			},
			deps,
		);

		expect(result.state).toBe("task_fix_required");
		expect(result.decision).toBeDefined();
		expect(result.decision!.kind).toBe("TASK_LOCAL_REPAIR");
		expect(repairCalled).toBe(true);

		// events.jsonl should include the task_fix_required event
		const eventsContent = await readFile(join(acceptingDir, "events.jsonl"), "utf8");
		const parsedEvents = eventsContent
			.trim()
			.split("\n")
			.map(line => JSON.parse(line));
		const fixRequiredEvent = parsedEvents.find(e => e.type === "task_fix_required");
		expect(fixRequiredEvent).toBeDefined();
		expect(fixRequiredEvent!.task_id).toBe("T01");
	});

	it("returns main_acceptance_fix_required when main acceptance fails", async () => {
		const acceptingDir = await makeTempDir();

		let repairCalled = false;

		const deps: PlanRunDriverDeps = {
			spawnTask: async (input): Promise<SpawnTaskOutput> => ({
				task_id: input.taskId,
				result: "completed",
				changed_files: ["src/index.ts"],
				tests_run: [],
				evidence: [],
				execution_skills_used: [],
				final_tail_skills_used: [],
				scope_notes: [],
				agentId: "agent-1",
				modelRole: "executor",
				resolvedModel: "claude-opus-4",
				advisorFindings: [],
			}),
			reviewTask: async () => acceptedReview,
			runMainAcceptance: async () => mainAcceptanceFixRequired,
			createRepairDecision: input => {
				repairCalled = true;
				const decision: PlanRunRepairDecision = {
					kind: "MAIN_ACCEPTANCE_REPAIR",
					nextState: "main_acceptance_fix_required",
					requiresWritingPlans: false,
					reason: "Main acceptance review found must-fix items",
					book: input.book,
					originalPlanPath: input.book.plan.path,
					originalPlanSha256: input.book.plan.sha256,
					repoPath: input.repoPath ?? "",
					worktreePath: input.worktreePath ?? "",
					acceptingDir: input.acceptingDir ?? "",
					repairRound: input.repairRound,
					maxRepairRounds: input.maxRepairRounds,
					subagentAssignment: "fix acceptance findings",
				};
				return decision;
			},
		};

		const result = await runPlanRunDriver(
			{
				acceptingDir,
				executionBook: book,
				repoPath: "/repo",
				project: "test-project",
				reindexProvider: null,
				superpowersSkillName: "test-driven-development",
				superpowersGateMode: "advisory",
			},
			deps,
		);

		expect(result.state).toBe("main_acceptance_fix_required");
		expect(result.decision).toBeDefined();
		expect(result.decision!.kind).toBe("MAIN_ACCEPTANCE_REPAIR");
		expect(repairCalled).toBe(true);

		// events.jsonl should include the main_acceptance_fix_required event
		const eventsContent = await readFile(join(acceptingDir, "events.jsonl"), "utf8");
		const parsedEvents = eventsContent
			.trim()
			.split("\n")
			.map(line => JSON.parse(line));
		const fixEvent = parsedEvents.find(e => e.type === "main_acceptance_fix_required");
		expect(fixEvent).toBeDefined();
	});

	it("passes aggregated PlanRun evidence into main acceptance", async () => {
		const acceptingDir = await makeTempDir();
		const multiTaskBook: PlanExecutionBook = {
			...book,
			tasks: [book.tasks[0], { ...book.tasks[0], id: "T02", title: "Second driver task" }],
		};
		let capturedRequest: Parameters<PlanRunDriverDeps["runMainAcceptance"]>[0] | undefined;
		const deps = makeAcceptedDeps();
		deps.runMainAcceptance = async request => {
			capturedRequest = request;
			return mainAcceptanceAccepted;
		};

		await runPlanRunDriver(
			{
				acceptingDir,
				executionBook: multiTaskBook,
				repoPath: "/repo",
				project: "test-project",
				reindexProvider: null,
				superpowersSkillName: "test-driven-development",
				superpowersGateMode: "advisory",
				commands: [{ command: "bun test", exit_code: 0, evidence: "pass" }],
			},
			deps,
		);

		expect(capturedRequest?.verificationCommands).toHaveLength(1);
		expect(capturedRequest?.verificationCommands[0].command).toBe("bun test");
		expect(capturedRequest?.manifestExtensions?.codebase_memory?.tasks?.T01?.jsonPath).toContain(
			"codebase-memory-reindex.json",
		);
		expect(capturedRequest?.manifestExtensions?.codebase_memory?.tasks?.T02?.jsonPath).toContain(
			"codebase-memory-reindex.json",
		);
		expect(capturedRequest?.manifestExtensions?.model_routing?.tasks?.T01?.resolved_model).toBe("claude-opus-4");
		expect(capturedRequest?.manifestExtensions?.model_routing?.tasks?.T02?.resolved_model).toBe("claude-opus-4");
		expect(capturedRequest?.manifestExtensions?.advisor?.summary).toContain("advisor-summary.json");

		const summary = JSON.parse(await readFile(join(acceptingDir, "codebase-memory-reindex-summary.json"), "utf8"));
		expect(Object.keys(summary).sort()).toEqual(["T01", "T02"]);
	});

	it("returns task_fix_required when a required superpowers gate blocks", async () => {
		const acceptingDir = await makeTempDir();
		let reviewCalled = false;
		let repairCalled = false;
		const deps: PlanRunDriverDeps = {
			...makeAcceptedDeps(),
			reviewTask: async () => {
				reviewCalled = true;
				return acceptedReview;
			},
			runMainAcceptance: async () => {
				throw new Error("runMainAcceptance should not run when gate blocks");
			},
			createRepairDecision: input => {
				repairCalled = true;
				expect(input.taskReview?.must_fix_items[0].id).toBe("superpowers_codebase_memory_gate_blocked");
				return {
					kind: "TASK_LOCAL_REPAIR",
					nextState: "task_fix_required",
					requiresWritingPlans: false,
					reason: "Required gate blocked",
					book: input.book,
					originalPlanPath: input.book.plan.path,
					originalPlanSha256: input.book.plan.sha256,
					repoPath: input.repoPath ?? "",
					worktreePath: input.worktreePath ?? "",
					acceptingDir: input.acceptingDir ?? "",
					repairRound: input.repairRound,
					maxRepairRounds: input.maxRepairRounds,
					subagentAssignment: "fix required gate",
				};
			},
		};

		const result = await runPlanRunDriver(
			{
				acceptingDir,
				executionBook: book,
				repoPath: "/repo",
				project: "test-project",
				reindexProvider: null,
				superpowersSkillName: "test-driven-development",
				superpowersGateMode: "required",
			},
			deps,
		);

		expect(result.state).toBe("task_fix_required");
		expect(repairCalled).toBe(true);
		expect(reviewCalled).toBe(false);
	});

	it("writes role-bound framework, prompt packs, advisor gates, global impact, and runtime reports", async () => {
		const acceptingDir = await makeTempDir();
		let capturedRequest: Parameters<PlanRunDriverDeps["runMainAcceptance"]>[0] | undefined;
		const deps = makeAcceptedDeps();
		deps.runMainAcceptance = async request => {
			capturedRequest = request;
			return mainAcceptanceAccepted;
		};
		deps.spawnStage = async input => {
			const changedFiles =
				input.stageId === "tdd-writer" ? [] : input.stageId === "implementer" ? ["src/index.ts"] : [];
			return {
				task_id: input.taskId,
				stage_id: input.stageId,
				schema_version: input.promptPack.return_schema.id,
				role_id: input.modelRole,
				result: "completed" as const,
				changed_files: changedFiles,
				tests_run: [],
				evidence: input.promptPack.required_outputs.map(o => o.artifact_path),
				evidence_paths: input.promptPack.required_outputs.map(o => o.artifact_path),
				output_path: `${acceptingDir}/tasks/${input.taskId}/stages/${input.stageId}/output.json`,
				execution_skills_used: [],
				final_tail_skills_used: [],
				scope_notes: [],
				agentId: `${input.stageId}-agent`,
				modelRole: input.modelRole,
				resolvedModel: "claude-opus-4",
				advisorFindings: [],
			};
		};

		const result = await runPlanRunDriver(
			{
				acceptingDir,
				executionBook: book,
				repoPath: "/repo",
				project: "test-project",
				reindexProvider: null,
				superpowersSkillName: "test-driven-development",
				superpowersGateMode: "advisory",
				commands: [{ command: "bun test src/index.ts", exit_code: 0, evidence: "pass" }],
				enableRoleBoundExecution: true,
				enableAdvisorGate: true,
				enableGlobalImpactGate: true,
				enableRealBusinessSimulationGate: true,
				runtimeScenario: {
					browser: { enabled: true },
					api: { enabled: false },
					database: { enabled: false },
				},
				classification: {
					enabled: true,
					requireReviewerEvidence: true,
				},
				runtimeSimulationRunner: {
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
			},
			deps,
		);

		expect(result.state).toBe("ready_for_user");
		expect(JSON.parse(await readFile(join(acceptingDir, "spec-task-framework.json"), "utf8")).schema_version).toBe(
			"superpowers.spec_task_framework.v1",
		);
		expect(
			JSON.parse(await readFile(join(acceptingDir, "tasks", "T01", "prompt-packs", "tdd-writer.json"), "utf8"))
				.role_id,
		).toBe("superpowers:tdd-writer");
		expect(JSON.parse(await readFile(join(acceptingDir, "global-impact-report.json"), "utf8")).status).toBe(
			"accepted",
		);
		// Verify todo-snapshot artifact was written
		await stat(join(acceptingDir, "todo-snapshots", "0001.json"));
		expect(JSON.parse(await readFile(join(acceptingDir, "real-runtime-simulation-report.json"), "utf8")).status).toBe(
			"passed",
		);
		expect(capturedRequest?.manifestExtensions?.role_bound_execution?.spec_task_framework_path).toContain(
			"spec-task-framework.json",
		);
		expect(capturedRequest?.manifestExtensions?.prompt_packs?.prompt_pack_paths.length).toBeGreaterThan(0);
		expect(capturedRequest?.manifestExtensions?.global_impact?.status).toBe("accepted");
		expect(capturedRequest?.manifestExtensions?.real_business_simulation?.status).toBe("passed");
		// Captured todoSnapshot is derived from role-bound stages
		const capturedTodoSnapshot = capturedRequest?.todoSnapshot;
		expect(capturedTodoSnapshot).toBeDefined();
		expect(capturedTodoSnapshot!.phases[0].name).toBe("Role-Bound Execution");
		expect(capturedTodoSnapshot!.phases[0].tasks.length).toBeGreaterThan(0);
		expect(result.roleBoundTodoSnapshots).toBeDefined();
		expect(result.roleBoundTodoSnapshots!.length).toBe(1);
		expect(result.roleBoundTodoSnapshots![0].phases[0].name).toBe("Role-Bound Execution");
		// Stage manifest entries remain accepted
		const tddStage = capturedRequest?.manifestExtensions?.role_bound_execution?.stages?.["T01:tdd-writer"];
		expect(tddStage?.status).toBe("accepted");
		const implementerStage = capturedRequest?.manifestExtensions?.role_bound_execution?.stages?.["T01:implementer"];
		expect(implementerStage?.status).toBe("accepted");

		// ---- Settings extension ----

		const settingsExt = capturedRequest?.manifestExtensions?.settings;
		expect(settingsExt).toBeDefined();
		expect(settingsExt?.execution_loop?.runtimeScenario).toEqual({
			browser: { enabled: true },
			api: { enabled: false },
			database: { enabled: false },
		});
		expect(settingsExt?.execution_loop?.classification).toEqual({
			enabled: true,
			requireReviewerEvidence: true,
		});

		// ---- Real business simulation runtimeScenario ----

		const runtimeExt = capturedRequest?.manifestExtensions?.real_business_simulation;
		expect(runtimeExt?.runtimeScenario).toEqual({
			browser: { enabled: true },
			api: { enabled: false },
			database: { enabled: false },
		});

		// ---- Classification summary structured object + JSON compatibility ----

		const roleBoundExt = capturedRequest?.manifestExtensions?.role_bound_execution;
		expect(roleBoundExt?.classification_summary).toBeDefined();
		expect(typeof roleBoundExt?.classification_summary).toBe("object");
		expect(roleBoundExt?.classification_summary?.tasks).toBeDefined();
		expect(roleBoundExt?.classification_summary?.tasks.T01).toBeDefined();
		expect(roleBoundExt?.classification_summary?.tasks.T01.runtime_surface).toBeDefined();
		expect(roleBoundExt?.classification_summary?.tasks.T01.requires_frontend_design).toBe(false);
		expect(Array.isArray(roleBoundExt?.classification_summary?.tasks.T01.evidence_paths)).toBe(true);
		expect(Array.isArray(roleBoundExt?.classification_summary?.specialized_reviews)).toBe(true);
		expect(roleBoundExt?.classification_summary_json).toBeDefined();
		expect(typeof roleBoundExt?.classification_summary_json).toBe("string");
		// compatibility JSON roundtrip matches structure
		const parsedCompat = JSON.parse(roleBoundExt!.classification_summary_json!);
		expect(parsedCompat.tasks).toBeDefined();
		expect(parsedCompat.tasks.T01).toBeDefined();
		expect(parsedCompat.tasks.T01.runtime_surface).toBe(
			roleBoundExt?.classification_summary?.tasks.T01.runtime_surface,
		);

		const advisorGateSequence = result.advisorGateRecords!.map(record => {
			if (!record.task_id) return `GLOBAL:${record.gate}`;
			return record.stage_id
				? `${record.task_id}:${record.stage_id}:${record.gate}`
				: `${record.task_id}:${record.gate}`;
		});
		expect(advisorGateSequence).toEqual([
			"T01:tdd-writer:before_stage",
			"T01:tdd-writer:after_stage",
			"T01:implementer:before_stage",
			"T01:implementer:after_stage",
			"T01:test-runner:before_stage",
			"T01:test-runner:after_stage",
			"T01:spec-reviewer:before_stage",
			"T01:spec-reviewer:after_stage",
			"T01:quality-reviewer:before_stage",
			"T01:quality-reviewer:after_stage",
			"T01:acceptance:before_stage",
			"T01:acceptance:after_stage",
			"T01:after_task",
			"GLOBAL:before_global_impact",
			"GLOBAL:before_real_runtime",
			"GLOBAL:before_final_acceptance",
		]);
	});

	it("returns main_acceptance_fix_required when global impact gate blocks", async () => {
		const acceptingDir = await makeTempDir();
		let repairCalled = false;
		const deps = makeAcceptedDeps();
		deps.spawnTask = async input => ({
			task_id: input.taskId,
			result: "completed",
			changed_files: ["src/unmapped/feature.ts"],
			tests_run: [],
			evidence: [],
			execution_skills_used: [],
			final_tail_skills_used: [],
			scope_notes: [],
			agentId: "agent-1",
			modelRole: "superpowers:implementer",
			resolvedModel: "claude-opus-4",
			advisorFindings: [],
		});
		deps.spawnStage = async input => ({
			task_id: input.taskId,
			stage_id: input.stageId,
			schema_version: input.promptPack.return_schema.id,
			role_id: input.modelRole,
			result: "completed" as const,
			changed_files: ["src/unmapped/feature.ts"],
			tests_run: [],
			evidence: [],
			evidence_paths: [],
			output_path: `${acceptingDir}/tasks/${input.taskId}/stages/${input.stageId}/output.json`,
			execution_skills_used: [],
			final_tail_skills_used: [],
			scope_notes: [],
			agentId: "agent-1",
			modelRole: "superpowers:implementer",
			resolvedModel: "claude-opus-4",
			advisorFindings: [],
		});
		deps.runMainAcceptance = async () => mainAcceptanceFixRequired;
		deps.createRepairDecision = input => {
			repairCalled = true;
			return {
				kind: "MAIN_ACCEPTANCE_REPAIR",
				nextState: "main_acceptance_fix_required",
				requiresWritingPlans: false,
				reason: "Global impact gate blocked",
				book: input.book,
				originalPlanPath: input.book.plan.path,
				originalPlanSha256: input.book.plan.sha256,
				repoPath: input.repoPath ?? "",
				worktreePath: input.worktreePath ?? "",
				acceptingDir: input.acceptingDir ?? "",
				repairRound: input.repairRound,
				maxRepairRounds: input.maxRepairRounds,
				subagentAssignment: "fix global impact findings",
			};
		};

		const result = await runPlanRunDriver(
			{
				acceptingDir,
				executionBook: book,
				repoPath: "/repo",
				project: "test-project",
				reindexProvider: null,
				enableRoleBoundExecution: true,
				enableGlobalImpactGate: true,
				enableRealBusinessSimulationGate: false,
			},
			deps,
		);

		expect(result.state).toBe("main_acceptance_fix_required");
		expect(repairCalled).toBe(true);
	});
	it("executes a role-bound PlanRun fixture through final acceptance evidence", async () => {
		const acceptingDir = await makeTempDir();
		const roleBoundBook: PlanExecutionBook = {
			...book,
			run_id: "run-role-bound-e2e",
			final_acceptance_commands: ["bun test test/codex-plan-run/driver.test.ts"],
			tasks: [
				{
					...book.tasks[0],
					id: "T01",
					title: "Role-bound fixture task",
					allowed_files: ["src/codex-plan-run/driver.ts", "test/codex-plan-run/driver.test.ts"],
					execution_scope: {
						...book.tasks[0].execution_scope,
						allowed_files: ["src/codex-plan-run/driver.ts", "test/codex-plan-run/driver.test.ts"],
						likely_files: ["src/codex-plan-run/driver.ts"],
					},
					review_gate: {
						...book.tasks[0].review_gate,
						acceptance_criteria: ["role-bound evidence exists"],
						smoke_commands: ["bun test test/codex-plan-run/driver.test.ts"],
					},
				},
			],
		};
		let capturedRequest: Parameters<PlanRunDriverDeps["runMainAcceptance"]>[0] | undefined;
		const deps = makeAcceptedDeps();
		deps.spawnTask = async input => {
			const taskDir = join(acceptingDir, "tasks", input.taskId);
			await mkdir(taskDir, { recursive: true });
			for (const [file, body] of [
				[
					"red-evidence.md",
					"# Red Evidence\n\ncommand: bun test test/codex-plan-run/driver.test.ts\nexit_code: 1\n",
				],
				["implementation-summary.md", "# Implementation Summary\n\nChanged driver role-bound gate wiring.\n"],
				[
					"green-evidence.md",
					"# Green Evidence\n\ncommand: bun test test/codex-plan-run/driver.test.ts\nexit_code: 0\n",
				],
				["spec-review.md", "# Spec Review\n\nfinding: note\nevidence: spec-task-framework.json\n"],
				["quality-review.md", "# Quality Review\n\nfinding: note\nevidence: src/codex-plan-run/driver.ts\n"],
				["task-acceptance.md", "# Task Acceptance\n\nresult: accepted\n"],
			] as const) {
				await writeFile(join(taskDir, file), body, "utf8");
			}
			return {
				task_id: input.taskId,
				result: "completed",
				changed_files: ["src/codex-plan-run/driver.ts"],
				tests_run: ["bun test test/codex-plan-run/driver.test.ts"],
				evidence: [
					"tasks/T01/red-evidence.md",
					"tasks/T01/implementation-summary.md",
					"tasks/T01/green-evidence.md",
					"tasks/T01/spec-review.md",
					"tasks/T01/quality-review.md",
					"tasks/T01/task-acceptance.md",
				],
				execution_skills_used: ["test-driven-development"],
				final_tail_skills_used: ["verification-before-completion"],
				scope_notes: [],
				agentId: "agent-role-bound",
				modelRole: "superpowers:implementer",
				resolvedModel: "anthropic/claude-sonnet-4",
				advisorFindings: [],
			};
		};
		deps.spawnStage = async input => {
			const taskDir = join(acceptingDir, "tasks", input.taskId);
			await mkdir(taskDir, { recursive: true });
			for (const [file, body] of [
				[
					"red-evidence.md",
					"# Red Evidence\n\ncommand: bun test test/codex-plan-run/driver.test.ts\nexit_code: 1\n",
				],
				["implementation-summary.md", "# Implementation Summary\n\nChanged driver role-bound gate wiring.\n"],
				[
					"green-evidence.md",
					"# Green Evidence\n\ncommand: bun test test/codex-plan-run/driver.test.ts\nexit_code: 0\n",
				],
				["spec-review.md", "# Spec Review\n\nfinding: note\nevidence: spec-task-framework.json\n"],
				["quality-review.md", "# Quality Review\n\nfinding: note\nevidence: src/codex-plan-run/driver.ts\n"],
				["task-acceptance.md", "# Task Acceptance\n\nresult: accepted\n"],
			] as const) {
				await writeFile(join(taskDir, file), body, "utf8");
			}
			const changedFiles =
				input.stageId === "tdd-writer"
					? ["test/codex-plan-run/driver.test.ts"]
					: input.stageId === "implementer"
						? ["src/codex-plan-run/driver.ts"]
						: [];
			return {
				task_id: input.taskId,
				stage_id: input.stageId,
				schema_version: input.promptPack.return_schema.id,
				role_id: input.modelRole,
				result: "completed" as const,
				changed_files: changedFiles,
				tests_run: ["bun test test/codex-plan-run/driver.test.ts"],
				evidence: [
					"tasks/T01/red-evidence.md",
					"tasks/T01/implementation-summary.md",
					"tasks/T01/green-evidence.md",
					"tasks/T01/spec-review.md",
					"tasks/T01/quality-review.md",
					"tasks/T01/task-acceptance.md",
				],
				evidence_paths: [
					"tasks/T01/red-evidence.md",
					"tasks/T01/implementation-summary.md",
					"tasks/T01/green-evidence.md",
					"tasks/T01/spec-review.md",
					"tasks/T01/quality-review.md",
					"tasks/T01/task-acceptance.md",
				],
				output_path: `${acceptingDir}/tasks/${input.taskId}/stages/${input.stageId}/output.json`,
				execution_skills_used: ["test-driven-development"],
				final_tail_skills_used: ["verification-before-completion"],
				scope_notes: [],
				agentId: "agent-role-bound",
				modelRole: "superpowers:implementer",
				resolvedModel: "anthropic/claude-sonnet-4",
				advisorFindings: [],
			};
		};
		deps.reviewTask = async () => ({
			...acceptedReview,
			review_skills_used: ["requesting-code-review"],
			final_tail_skills_used: ["verification-before-completion"],
		});
		deps.runMainAcceptance = async request => {
			capturedRequest = request;
			return runMainThreadAcceptanceReview(request);
		};

		const result = await runPlanRunDriver(
			{
				acceptingDir,
				executionBook: roleBoundBook,
				repoPath: "/repo",
				project: "test-project",
				reindexProvider: null,
				manifestPath: join(acceptingDir, "manifest.json"),
				completionDocPath: join(acceptingDir, "omp-completion.md"),
				commands: [{ command: "bun test test/codex-plan-run/driver.test.ts", exit_code: 0, evidence: "pass" }],
				tddEvidenceMatrix: {
					tasks: {
						T01: [
							{
								kind: "RED_EVIDENCE",
								task_id: "T01",
								command: "bun test test/codex-plan-run/driver.test.ts",
								cwd: "/repo",
								exit_code: 1,
								started_at: "2026-06-30T00:00:00.000Z",
								completed_at: "2026-06-30T00:00:01.000Z",
								output_excerpt: "red",
								evidence_file_path: "tasks/T01/red-evidence.md",
							},
							{
								kind: "GREEN_EVIDENCE",
								task_id: "T01",
								command: "bun test test/codex-plan-run/driver.test.ts",
								cwd: "/repo",
								exit_code: 0,
								started_at: "2026-06-30T00:00:02.000Z",
								completed_at: "2026-06-30T00:00:03.000Z",
								output_excerpt: "green",
								evidence_file_path: "tasks/T01/green-evidence.md",
							},
							{
								kind: "REGRESSION_EVIDENCE",
								task_id: "T01",
								command: "bun test test/codex-plan-run/driver.test.ts",
								cwd: "/repo",
								exit_code: 0,
								started_at: "2026-06-30T00:00:04.000Z",
								completed_at: "2026-06-30T00:00:05.000Z",
								output_excerpt: "regression",
								evidence_file_path: "tasks/T01/green-evidence.md",
							},
						],
					},
				},
				skillEvidenceMatrix: {
					tasks: {
						T01: [
							{
								task_id: "T01",
								skill: "test-driven-development",
								source: "skill_loaded",
								evidence: "skill://test-driven-development",
								created_at: "2026-06-30T00:00:00.000Z",
							},
							{
								task_id: "T01",
								skill: "test-driven-development",
								source: "skill_declared_by_task_card",
								evidence: "required_skill_evidence",
								created_at: "2026-06-30T00:00:01.000Z",
							},
							{
								task_id: "T01",
								skill: "test-driven-development",
								source: "skill_claimed_by_subagent_output",
								evidence: "task output",
								created_at: "2026-06-30T00:00:02.000Z",
							},
						],
					},
				},
				advisorSummary: { items: [] },
				enableRoleBoundExecution: true,
				enableAdvisorGate: true,
				enableGlobalImpactGate: true,
				enableRealBusinessSimulationGate: true,
				runtimeScenario: {
					browser: { enabled: true },
					api: { enabled: true },
					database: { enabled: true },
				},
				classification: {
					enabled: true,
					requireReviewerEvidence: true,
				},
				runtimeSimulationRunner: {
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
			},
			deps,
		);

		expect(result.state).toBe("ready_for_user");
		expect(capturedRequest?.manifestExtensions?.role_bound_execution?.enabled).toBe(true);
		expect(capturedRequest?.manifestExtensions?.global_impact?.status).toBe("accepted");
		expect(capturedRequest?.manifestExtensions?.real_business_simulation?.status).toBe("passed");
		expect(await readFile(join(acceptingDir, "runtime-cleanup-report.md"), "utf8")).toContain(
			"cleanup_status: passed",
		);

		// ---- Manifest extension path/sha verification ----

		const roleBoundExt = capturedRequest?.manifestExtensions?.role_bound_execution;
		expect(roleBoundExt?.role_registry_snapshot_path).toContain("role-registry-snapshot.json");
		expect(roleBoundExt?.role_registry_snapshot_sha256).toBeDefined();
		expect(roleBoundExt!.role_registry_snapshot_sha256!.length).toBeGreaterThan(0);
		expect(roleBoundExt?.spec_task_framework_path).toContain("spec-task-framework.json");
		expect(roleBoundExt?.spec_task_framework_sha256).toBeDefined();
		expect(roleBoundExt!.spec_task_framework_sha256!.length).toBeGreaterThan(0);

		// ---- Stage manifest entries (all 6 stages) ----

		const stages = roleBoundExt?.stages;
		expect(stages).toBeDefined();
		const stageKeys = [
			"T01:tdd-writer",
			"T01:implementer",
			"T01:test-runner",
			"T01:spec-reviewer",
			"T01:quality-reviewer",
			"T01:acceptance",
		];
		for (const key of stageKeys) {
			expect(stages![key]).toBeDefined();
			expect(stages![key].status).toBe("accepted");
			expect(stages![key].output_path).toContain("output.json");
			expect(stages![key].model_routing_path).toContain("model-routing-evidence.json");
			expect(stages![key].advisor_gate_paths.length).toBe(2);
		}

		// ---- Prompt packs ----

		const promptPacksExt = capturedRequest?.manifestExtensions?.prompt_packs;
		expect(promptPacksExt?.generated).toBe(true);
		expect(promptPacksExt?.prompt_pack_paths.length).toBeGreaterThanOrEqual(6);

		// ---- Advisor gate ----

		const advisorGateExt = capturedRequest?.manifestExtensions?.advisor_gate;
		expect(advisorGateExt?.enabled).toBe(true);
		expect(advisorGateExt?.records_path).toContain("tasks");

		// ---- Global impact ----

		const globalImpactExt = capturedRequest?.manifestExtensions?.global_impact;
		expect(globalImpactExt?.enabled).toBe(true);
		expect(globalImpactExt?.report_path).toContain("global-impact-report.json");
		expect(globalImpactExt?.status).toBe("accepted");

		// ---- Real business simulation ----

		const runtimeExt = capturedRequest?.manifestExtensions?.real_business_simulation;
		expect(runtimeExt?.enabled).toBe(true);
		expect(runtimeExt?.environment_plan_path).toContain("runtime-environment-plan.md");
		expect(runtimeExt?.scenario_plan_path).toContain("business-simulation-scenarios.md");
		expect(runtimeExt?.report_path).toContain("real-runtime-simulation-report.json");
		expect(runtimeExt?.cleanup_report_path).toContain("runtime-cleanup-report.md");
		expect(runtimeExt?.status).toBe("passed");

		// ---- Settings extension ----

		const settingsExt = capturedRequest?.manifestExtensions?.settings;
		expect(settingsExt).toBeDefined();
		expect(settingsExt?.execution_loop?.runtimeScenario).toEqual({
			browser: { enabled: true },
			api: { enabled: true },
			database: { enabled: true },
		});
		expect(settingsExt?.execution_loop?.classification).toEqual({
			enabled: true,
			requireReviewerEvidence: true,
		});

		// ---- Real business simulation runtimeScenario ----

		expect(runtimeExt?.runtimeScenario).toEqual({
			browser: { enabled: true },
			api: { enabled: true },
			database: { enabled: true },
		});

		// ---- Classification summary structured object + JSON compatibility ----

		expect(roleBoundExt?.classification_summary).toBeDefined();
		expect(typeof roleBoundExt?.classification_summary).toBe("object");
		expect(roleBoundExt?.classification_summary?.tasks).toBeDefined();
		expect(roleBoundExt?.classification_summary?.tasks.T01).toBeDefined();
		expect(roleBoundExt?.classification_summary?.tasks.T01.runtime_surface).toBeDefined();
		expect(Array.isArray(roleBoundExt?.classification_summary?.tasks.T01.evidence_paths)).toBe(true);
		expect(Array.isArray(roleBoundExt?.classification_summary?.specialized_reviews)).toBe(true);
		expect(roleBoundExt?.classification_summary_json).toBeDefined();
		expect(typeof roleBoundExt?.classification_summary_json).toBe("string");
		const parsedCompat2 = JSON.parse(roleBoundExt!.classification_summary_json!);
		expect(parsedCompat2.tasks).toBeDefined();
		expect(parsedCompat2.tasks.T01).toBeDefined();
	});

	it("spawns each role-bound framework stage with its prompt pack", async () => {
		const acceptingDir = await makeTempDir();
		const stageCalls: Array<{
			stageId: string;
			modelRole: string;
			previousCount: number;
			promptPreviousCount: number;
		}> = [];
		const deps = makeAcceptedDeps();
		deps.spawnStage = async input => {
			stageCalls.push({
				stageId: input.stageId,
				modelRole: input.modelRole,
				previousCount: input.previousStageOutputs.length,
				promptPreviousCount: input.promptPack.context_bundle.previous_stage_outputs.length,
			});
			return {
				task_id: input.taskId,
				stage_id: input.stageId,
				schema_version: input.promptPack.return_schema.id,
				role_id: input.promptPack.role_id,
				result: "completed",
				changed_files: ["src/index.ts"],
				tests_run: input.stageId === "test-runner" ? ["bun test src/index.ts"] : [],
				evidence: input.promptPack.required_outputs.map(output => output.artifact_path),
				evidence_paths: input.promptPack.required_outputs.map(output => output.artifact_path),
				output_path: `${acceptingDir}/tasks/${input.taskId}/stages/${input.stageId}/output.json`,
				execution_skills_used: [],
				final_tail_skills_used: [],
				scope_notes: [],
				agentId: `${input.stageId}-agent`,
				modelRole: input.modelRole,
				resolvedModel: "openai/gpt-5.5",
				advisorFindings: [],
			};
		};

		const result = await runPlanRunDriver(
			{
				acceptingDir,
				executionBook: book,
				repoPath: "/repo",
				project: "test-project",
				reindexProvider: null,
				superpowersGateMode: "advisory",
				enableRoleBoundExecution: true,
				commands: [{ command: "bun test src/index.ts", exit_code: 0, evidence: "pass" }],
			},
			deps,
		);

		expect(result.state).toBe("ready_for_user");
		expect(stageCalls.map(call => call.stageId)).toEqual([
			"tdd-writer",
			"implementer",
			"test-runner",
			"spec-reviewer",
			"quality-reviewer",
			"acceptance",
		]);
		expect(stageCalls.map(call => call.modelRole)).toEqual([
			"superpowers:tdd-writer",
			"superpowers:implementer",
			"superpowers:test-runner",
			"superpowers:spec-reviewer",
			"superpowers:quality-reviewer",
			"superpowers:acceptance",
		]);
		expect(stageCalls[0]?.previousCount).toBe(0);
		expect(stageCalls[5]?.previousCount).toBe(5);
		expect(stageCalls[0]?.promptPreviousCount).toBe(0);
		expect(stageCalls[5]?.promptPreviousCount).toBe(5);
		const acceptancePromptPack = JSON.parse(
			await readFile(join(acceptingDir, "tasks", "T01", "prompt-packs", "acceptance.json"), "utf8"),
		);
		expect(acceptancePromptPack.context_bundle.previous_stage_outputs).toHaveLength(5);
	});

	it("returns task_fix_required when a role-bound stage blocks and stops later stages", async () => {
		const acceptingDir = await makeTempDir();
		const stageCalls: Array<{ stageId: string }> = [];
		let repairCalled = false;
		const deps: PlanRunDriverDeps = {
			...makeAcceptedDeps(),
			spawnStage: async input => {
				stageCalls.push({ stageId: input.stageId });
				if (input.stageId === "tdd-writer") {
					return {
						task_id: input.taskId,
						stage_id: input.stageId,
						schema_version: input.promptPack.return_schema.id,
						role_id: input.modelRole,
						result: "blocked" as const,
						changed_files: [],
						tests_run: [],
						evidence: [],
						evidence_paths: [],
						output_path: `${acceptingDir}/tasks/${input.taskId}/stages/${input.stageId}/output.json`,
						execution_skills_used: [],
						final_tail_skills_used: [],
						scope_notes: ["Stage blocked: insufficient context"],
						agentId: "tdd-writer-agent",
						modelRole: input.modelRole,
						resolvedModel: "claude-sonnet-4",
						advisorFindings: [],
					};
				}
				return {
					task_id: input.taskId,
					stage_id: input.stageId,
					role_id: input.modelRole,
					result: "completed" as const,
					changed_files: ["src/feature.ts"],
					tests_run: [],
					evidence: [],
					evidence_paths: [],
					output_path: `${acceptingDir}/tasks/${input.taskId}/stages/${input.stageId}/output.json`,
					execution_skills_used: [],
					final_tail_skills_used: [],
					scope_notes: [],
					agentId: `${input.stageId}-agent`,
					modelRole: input.modelRole,
					resolvedModel: "claude-sonnet-4",
					advisorFindings: [],
				};
			},
			reviewTask: async () => {
				throw new Error("reviewTask should not be called when stage is blocked");
			},
			runMainAcceptance: async () => {
				throw new Error("runMainAcceptance should not be called when stage blocks");
			},
			createRepairDecision: input => {
				repairCalled = true;
				expect(input.taskReview?.must_fix_items[0].id).toBe("role_bound_stage_blocked");
				const decision: PlanRunRepairDecision = {
					kind: "TASK_LOCAL_REPAIR",
					nextState: "task_fix_required",
					requiresWritingPlans: false,
					reason: "tdd-writer stage blocked",
					book: input.book,
					originalPlanPath: input.book.plan.path,
					originalPlanSha256: input.book.plan.sha256,
					repoPath: input.repoPath ?? "",
					worktreePath: input.worktreePath ?? "",
					acceptingDir: input.acceptingDir ?? "",
					repairRound: input.repairRound,
					maxRepairRounds: input.maxRepairRounds,
					subagentAssignment: `fix blocked T01 tdd-writer stage`,
				};
				return decision;
			},
		};

		const result = await runPlanRunDriver(
			{
				acceptingDir,
				executionBook: book,
				repoPath: "/repo",
				project: "test-project",
				reindexProvider: null,
				superpowersSkillName: "test-driven-development",
				superpowersGateMode: "advisory",
				enableRoleBoundExecution: true,
			},
			deps,
		);

		// Only tdd-writer should have been called — later stages must stop
		expect(stageCalls.map(call => call.stageId)).toEqual(["tdd-writer"]);

		// The driver must return a non-success state via repair decision path
		expect(result.state).toBe("task_fix_required");
		expect(result.decision).toBeDefined();
		expect(result.decision!.kind).toBe("TASK_LOCAL_REPAIR");
		expect(repairCalled).toBe(true);

		// The blocked stage routes through synthetic review, NOT the real reviewTask
		// (reviewTask above throws if called)
		const blockedTodo = JSON.parse(await readFile(join(acceptingDir, "todo-snapshots", "0001.json"), "utf8"));
		expect(blockedTodo.phases[0].tasks[0].status).toBe("in_progress");
		expect(blockedTodo.phases[0].tasks[1].content).toContain("状态：已放弃");

		// events.jsonl should include the task_fix_required event
		const eventsContent = await readFile(join(acceptingDir, "events.jsonl"), "utf8");
		const parsedEvents = eventsContent
			.trim()
			.split("\n")
			.map(line => JSON.parse(line));
		const fixRequiredEvent = parsedEvents.find(e => e.type === "task_fix_required");
		expect(fixRequiredEvent).toBeDefined();
		expect(fixRequiredEvent!.task_id).toBe("T01");
	});
	it("marks role-bound stage ledger repair_required when advisor gate fails", async () => {
		const acceptingDir = await makeTempDir();
		let capturedRequest: Parameters<PlanRunDriverDeps["runMainAcceptance"]>[0] | undefined;
		const deps = makeAcceptedDeps();
		deps.spawnStage = async input => ({
			task_id: input.taskId,
			stage_id: input.stageId,
			schema_version: input.promptPack.return_schema.id,
			role_id: input.promptPack.role_id,
			result: "completed",
			changed_files: [],
			tests_run: [],
			evidence: [],
			evidence_paths: [],
			output_path: `${acceptingDir}/tasks/${input.taskId}/stages/${input.stageId}/output.json`,
			execution_skills_used: [],
			final_tail_skills_used: [],
			scope_notes: [],
			agentId: `${input.stageId}-agent`,
			modelRole: input.modelRole,
			resolvedModel: "openai/gpt-5.5",
			advisorFindings: [],
		});
		deps.runMainAcceptance = async request => {
			capturedRequest = request;
			return mainAcceptanceAccepted;
		};

		await runPlanRunDriver(
			{
				acceptingDir,
				executionBook: book,
				repoPath: "/repo",
				project: "test-project",
				reindexProvider: null,
				superpowersGateMode: "advisory",
				enableRoleBoundExecution: true,
				enableAdvisorGate: true,
				commands: [{ command: "bun test src/index.ts", exit_code: 0, evidence: "pass" }],
			},
			deps,
		);

		const tddStage = capturedRequest?.manifestExtensions?.role_bound_execution?.stages?.["T01:tdd-writer"];
		expect(tddStage?.status).toBe("repair_required");
		expect(tddStage?.advisor_gate_paths.length).toBe(2);
		const gateFileNames = tddStage!.advisor_gate_paths.map(p => p.split("/").pop() ?? "");
		expect(gateFileNames.sort()).toEqual(["after_stage.json", "before_stage.json"]);
	});

	it("preserves legacy explicit runPlanRunDriver behavior independent from settings resolver/launcher", async () => {
		const acceptingDir = await makeTempDir();

		const deps = makeAcceptedDeps();

		let capturedRequest: Parameters<PlanRunDriverDeps["runMainAcceptance"]>[0] | undefined;
		deps.runMainAcceptance = async request => {
			capturedRequest = request;
			return mainAcceptanceAccepted;
		};

		const result = await runPlanRunDriver(
			{
				acceptingDir,
				executionBook: book,
				repoPath: "/repo",
				project: "test-project",
				reindexProvider: null,
				superpowersSkillName: "test-driven-development",
				superpowersGateMode: "off",
			},
			deps,
		);

		expect(result.state).toBe("ready_for_user");
		expect(capturedRequest?.manifestExtensions?.role_bound_execution).toBeUndefined();
		expect(capturedRequest?.manifestExtensions?.real_business_simulation).toBeUndefined();
	});
});
