import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PlanExecutionBook, TaskReviewResult } from "../../src/codex-plan-run";
import { Settings } from "../../src/config/settings";
import { BUILTIN_TOOLS, type ToolSession } from "../../src/tools";
import { BUILTIN_TOOL_NAMES } from "../../src/tools/builtin-names";
import { buildPlanRepairLoopToolResult } from "../../src/tools/plan-repair-loop";

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

const taskReview: TaskReviewResult = {
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

function makeToolSession(): ToolSession {
	return {
		cwd: "/repo",
		hasUI: false,
		getSessionFile: () => null,
		getSessionSpawns: () => null,
		settings: Settings.isolated({}),
	};
}

function findLooseWireSchemaPaths(value: unknown, path = "$"): string[] {
	if (value === true) {
		return path.endsWith(".items") || path.endsWith(".additionalProperties") ? [path] : [];
	}
	if (!value || typeof value !== "object") {
		return [];
	}
	const loosePaths: string[] = [];
	for (const [key, child] of Object.entries(value)) {
		loosePaths.push(...findLooseWireSchemaPaths(child, `${path}.${key}`));
	}
	return loosePaths;
}

describe("plan_repair_loop tool", () => {
	it("is registered as a built-in discoverable tool", () => {
		expect(BUILTIN_TOOL_NAMES).toContain("plan_repair_loop");
		expect(BUILTIN_TOOLS.plan_repair_loop).toBeDefined();
	});

	it("does not expose loose any-object or any-array wire schema", async () => {
		const tool = await BUILTIN_TOOLS.plan_repair_loop(makeToolSession());

		expect(findLooseWireSchemaPaths(tool?.parameters)).toEqual([]);
	});

	it("writes repair-round-1.md and returns a task-local subagent action", async () => {
		const acceptingDir = await mkdtemp(join(tmpdir(), "plan-repair-loop-"));
		try {
			const result = await buildPlanRepairLoopToolResult({
				book: { ...book, accepting_dir: acceptingDir },
				taskReview,
				repairRound: 1,
				maxRepairRounds: 2,
			});

			expect(result.kind).toBe("TASK_LOCAL_REPAIR");
			expect(result.next_action).toBe("spawn_subagent");
			expect(result.subagent_assignment).toContain("OmpFixExecutionTask");
			expect(result.artifact.path).toBe("repair-round-1.md");
			expect(result.artifact.written_path).toBe(join(acceptingDir, "repair-round-1.md"));
			expect(await readFile(join(acceptingDir, "repair-round-1.md"), "utf8")).toContain("# PlanRun Repair Round 1");
		} finally {
			await rm(acceptingDir, { recursive: true, force: true });
		}
	});

	it("defaults max repair rounds to 3 for direct helper calls", async () => {
		const acceptingDir = await mkdtemp(join(tmpdir(), "plan-repair-loop-default-"));
		try {
			const result = await buildPlanRepairLoopToolResult({
				book: { ...book, accepting_dir: acceptingDir },
				taskReview,
				repairRound: 1,
			});

			expect(result.kind).toBe("TASK_LOCAL_REPAIR");
			expect(result.max_repair_rounds).toBe(3);
		} finally {
			await rm(acceptingDir, { recursive: true, force: true });
		}
	});

	it("defaults max repair rounds to 3 when invoked through the tool schema", async () => {
		const acceptingDir = await mkdtemp(join(tmpdir(), "plan-repair-loop-schema-default-"));
		try {
			const tool = await BUILTIN_TOOLS.plan_repair_loop(makeToolSession());
			const result = await tool?.execute("call-1", {
				book: { ...book, accepting_dir: acceptingDir },
				taskReview,
				repairRound: 1,
			});

			expect(result?.details?.max_repair_rounds).toBe(3);
			expect(result?.details?.next_action).toBe("spawn_subagent");
			expect(result?.details?.subagent_assignment).toContain("bun test packages/coding-agent/test/parser.test.ts");
		} finally {
			await rm(acceptingDir, { recursive: true, force: true });
		}
	});

	it("rejects null book at parameter parsing instead of throwing TypeError", async () => {
		const tool = await BUILTIN_TOOLS.plan_repair_loop(makeToolSession());
		let error: unknown;

		try {
			await tool?.execute("call-1", {
				book: null,
				taskReview,
				repairRound: 1,
			});
		} catch (caught) {
			error = caught;
		}

		expect(error).toBeDefined();
		expect(error).not.toBeInstanceOf(TypeError);
		expect((error as Error).name).toBe("ZodError");
	});

	it("constructs from the built-in registry", async () => {
		const tool = await BUILTIN_TOOLS.plan_repair_loop(makeToolSession());
		expect(tool?.name).toBe("plan_repair_loop");
	});
});
