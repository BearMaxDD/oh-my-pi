import { describe, expect, it } from "bun:test";
import {
	classifyPlanRunFailure,
	createPlanRunRepairDecision,
	type MainThreadAcceptanceReviewRequest,
	type MainThreadAcceptanceReviewResult,
	PLAN_RUN_STATES,
	type PlanExecutionBook,
	renderRepairRoundMarkdown,
	type TaskReviewResult,
} from "../../src/codex-plan-run";

const book: PlanExecutionBook = {
	schema_version: 1,
	run_id: "run-1",
	created_at: "2026-06-27T00:00:00.000Z",
	plan: { path: "/repo/docs/superpowers/plans/demo.md", sha256: "sha", repo_path: "/repo" },
	accepting_dir: "/repo/docs/superpowers/accepting/run-1",
	intake_gate: [{ gate: "plan_sha256_matches", result: "PASS", evidence: "sha" }],
	project_recon: {
		repo_path: "/repo",
		relevant_modules: ["packages/coding-agent/src/parser.ts"],
		likely_files: ["packages/coding-agent/src/parser.ts"],
		existing_patterns: ["small pure functions"],
		test_commands: ["bun test packages/coding-agent/test/parser.test.ts"],
		build_commands: ["bun run check:types"],
		style_conventions: ["keep changes local"],
		risk_areas: ["parser behavior"],
		forbidden_changes: ["docs/forbidden.md"],
		task_file_map: { T01: ["packages/coding-agent/src/parser.ts"] },
	},
	required_execution_skills: [],
	required_review_skills: [],
	final_tail_skills: [],
	final_acceptance_commands: ["bun test packages/coding-agent/test/parser.test.ts"],
	tasks: [
		{
			id: "T01",
			title: "Implement parser",
			source: "Plan section 1",
			todo: "Implement parser.",
			execution_skills: ["test-driven-development"],
			review_skills: ["requesting-code-review"],
			final_tail_skills: ["verification-before-completion"],
			allowed_files: ["packages/coding-agent/src/parser.ts"],
			forbidden_files: ["docs/forbidden.md"],
			smoke_commands: ["bun test packages/coding-agent/test/parser.test.ts"],
			tdd_gates: {
				red: {
					command: "bun test packages/coding-agent/test/parser.test.ts",
					expected: "FAIL",
					evidence_required: "RED_EVIDENCE",
				},
				green: {
					command: "bun test packages/coding-agent/test/parser.test.ts",
					expected: "PASS",
					evidence_required: "GREEN_EVIDENCE",
				},
				regression: {
					command: "bun test packages/coding-agent/test/parser.test.ts",
					expected: "PASS",
					evidence_required: "REGRESSION_EVIDENCE",
				},
			},
			advisor_watch_points: ["No parser scope expansion"],
			required_skill_evidence: ["test-driven-development"],
			skill_evidence: { execution: [], review: [], final_tail: [] },
			implementation_analysis: "Repair the parser task locally.",
			execution_scope: {
				goal: "Implement parser",
				allowed_files: ["packages/coding-agent/src/parser.ts"],
				forbidden_files: ["docs/forbidden.md"],
				likely_files: ["packages/coding-agent/src/parser.ts"],
				existing_patterns: ["pure parser tests"],
				out_of_scope: ["docs changes"],
			},
			implementation_steps: ["Write failing test", "Fix parser", "Run smoke"],
			review_gate: {
				acceptance_criteria: ["Parser test passes"],
				smoke_commands: ["bun test packages/coding-agent/test/parser.test.ts"],
				required_evidence: ["GREEN_EVIDENCE"],
				must_fix_conditions: ["Required command fails"],
			},
		},
	],
};

const taskFix: TaskReviewResult = {
	task_id: "T01",
	review_skills_used: ["requesting-code-review"],
	final_tail_skills_used: ["verification-before-completion"],
	plan_compliance: "PASS",
	scope_control: "PASS",
	smoke_tests: "FAIL",
	evidence_quality: "PASS",
	over_implementation_check: "PASS",
	result: "TASK_FIX_REQUIRED",
	must_fix_items: [
		{
			id: "required_command_failed",
			description: "A required smoke command failed.",
			evidence: "bun test packages/coding-agent/test/parser.test.ts",
		},
	],
};

const mainAcceptanceFix: MainThreadAcceptanceReviewResult = {
	result: "MAIN_ACCEPTANCE_FIX_REQUIRED",
	review_round: 1,
	next_task: "OmpFixExecutionTask",
	must_fix_items: [
		{
			id: "MF-FINAL-COMMAND",
			category: "verification",
			severity: "must_fix",
			description: "Final acceptance command failed.",
			evidence: "bun test packages/coding-agent/test/parser.test.ts",
			required_fix: "Repair final acceptance failure.",
			affected_tasks: ["T01"],
			required_commands: ["bun test packages/coding-agent/test/parser.test.ts"],
			authorized_files: ["packages/coding-agent/src/parser.ts"],
		},
	],
};

const mainAcceptanceRequest: MainThreadAcceptanceReviewRequest = {
	runId: "run-1",
	reviewRound: 1,
	repoPath: "/repo",
	worktreePath: "/repo/.worktrees/repair",
	planPath: "/repo/docs/superpowers/plans/demo.md",
	planSha256: "sha",
	acceptingDir: "/repo/docs/superpowers/accepting/run-1",
	executionBookPath: "/repo/docs/superpowers/accepting/run-1/plan-execution-book.md",
	manifestPath: "/repo/docs/superpowers/accepting/run-1/manifest.json",
	completionDocPath: "/repo/docs/superpowers/accepting/run-1/omp-completion.md",
	todoSnapshot: {
		runId: "run-1",
		version: 1,
		state: "main_acceptance_fix_required",
		updatedAt: "2026-06-27T00:00:00.000Z",
		source: "state-machine",
		phases: [],
	},
	executionBook: book,
	taskOutputs: [],
	taskReviewRecords: [],
	verificationCommands: [
		{
			command: "bun test packages/coding-agent/test/parser.test.ts",
			exit_code: 1,
			cwd: "/repo",
			started_at: "2026-06-27T00:00:00.000Z",
			completed_at: "2026-06-27T00:00:01.000Z",
			output_excerpt: "fail",
		},
	],
	finalAcceptanceCommands: ["bun test packages/coding-agent/test/parser.test.ts"],
};

describe("PlanRun repair loop", () => {
	it("classifies TASK_FIX_REQUIRED as task-local repair without writing plans", () => {
		const classification = classifyPlanRunFailure({
			book,
			taskReview: taskFix,
			repairRound: 0,
			maxRepairRounds: 2,
		});

		expect(classification.kind).toBe("TASK_LOCAL_REPAIR");
		expect(classification.nextState).toBe("fix_tasks_running");
		expect(classification.requiresWritingPlans).toBe(false);
	});

	it("escalates to replan when repair rounds are exhausted", () => {
		const classification = classifyPlanRunFailure({
			book,
			taskReview: taskFix,
			repairRound: 2,
			maxRepairRounds: 2,
		});

		expect(classification.kind).toBe("PLAN_DEFECT_REPLAN_REQUIRED");
		expect(PLAN_RUN_STATES).toContain(classification.nextState);
		expect(classification.nextState).toBe("main_acceptance_fix_required");
		expect(classification.requiresWritingPlans).toBe(true);
		expect(classification.reason).toContain("max repair rounds");
	});

	it("keeps blocked repair loop nextState inside PLAN_RUN_STATES", () => {
		const classification = classifyPlanRunFailure({
			book,
			repairRound: 0,
			maxRepairRounds: 2,
		});

		expect(classification.kind).toBe("REPAIR_LOOP_BLOCKED");
		expect(PLAN_RUN_STATES).toContain(classification.nextState);
		expect(classification.nextState).toBe("main_acceptance_fix_required");
	});

	it("creates task-level fix execution task and subagent assignment with failed command", () => {
		const decision = createPlanRunRepairDecision({
			book,
			taskReview: taskFix,
			repairRound: 1,
			maxRepairRounds: 2,
		});

		expect(decision.kind).toBe("TASK_LOCAL_REPAIR");
		expect(decision.fixTask).toMatchObject({ source_task_id: "T01" });
		expect(decision.subagentAssignment).toContain("OmpFixExecutionTask");
		expect(decision.subagentAssignment).toContain("T01");
		expect(decision.subagentAssignment).toContain("bun test packages/coding-agent/test/parser.test.ts");
	});

	it("blocks main acceptance repair when request context is missing", () => {
		const decision = createPlanRunRepairDecision({
			book,
			mainAcceptanceReview: mainAcceptanceFix,
			repairRound: 1,
			maxRepairRounds: 2,
		});

		expect(decision.kind).toBe("REPAIR_LOOP_BLOCKED");
		expect(decision.nextState).toBe("main_acceptance_fix_required");
		expect(decision.requiresWritingPlans).toBe(false);
		expect(decision.reason).toContain("mainAcceptanceRequest");
		expect(decision.fixTask).toBeUndefined();
	});

	it("creates main acceptance fix task when request context is present", () => {
		const decision = createPlanRunRepairDecision({
			book,
			mainAcceptanceReview: mainAcceptanceFix,
			mainAcceptanceRequest,
			repairRound: 1,
			maxRepairRounds: 2,
		});

		expect(decision.kind).toBe("MAIN_ACCEPTANCE_REPAIR");
		expect(decision.fixTask).toMatchObject({ packet_type: "OmpFixExecutionTask" });
		expect(decision.subagentAssignment).toContain("MainThreadAcceptanceReview");
	});

	it("preserves explicit PlanRun repair metadata on the decision", () => {
		const decision = createPlanRunRepairDecision({
			book,
			taskReview: taskFix,
			repoPath: "/explicit/repo",
			worktreePath: "/explicit/repo/.worktrees/repair",
			acceptingDir: "/explicit/repo/docs/superpowers/accepting/run-1",
			planPath: "/explicit/repo/docs/superpowers/plans/demo.md",
			planSha256: "explicit-sha",
			repairRound: 1,
			maxRepairRounds: 2,
		});

		expect(decision.originalPlanPath).toBe("/explicit/repo/docs/superpowers/plans/demo.md");
		expect(decision.originalPlanSha256).toBe("explicit-sha");
		expect(decision.repoPath).toBe("/explicit/repo");
		expect(decision.worktreePath).toBe("/explicit/repo/.worktrees/repair");
		expect(decision.acceptingDir).toBe("/explicit/repo/docs/superpowers/accepting/run-1");
		expect(decision.repairRound).toBe(1);
	});

	it("renders repair round Markdown with original plan identity and subagent assignment", () => {
		const decision = createPlanRunRepairDecision({
			book,
			taskReview: taskFix,
			repoPath: "/explicit/repo",
			worktreePath: "/explicit/repo/.worktrees/repair",
			acceptingDir: "/explicit/repo/docs/superpowers/accepting/run-1",
			planPath: "/explicit/repo/docs/superpowers/plans/demo.md",
			planSha256: "explicit-sha",
			repairRound: 1,
			maxRepairRounds: 2,
		});
		const markdown = renderRepairRoundMarkdown({ book, decision });

		expect(markdown).toContain("# PlanRun Repair Round 1");
		expect(markdown).toContain("original_plan_path: /explicit/repo/docs/superpowers/plans/demo.md");
		expect(markdown).toContain("original_plan_sha256: explicit-sha");
		expect(markdown).toContain("repo_path: /explicit/repo");
		expect(markdown).toContain("worktree_path: /explicit/repo/.worktrees/repair");
		expect(markdown).toContain("## Sub-Agent Assignment");
		expect(markdown).toContain("OmpFixExecutionTask");
	});
});
