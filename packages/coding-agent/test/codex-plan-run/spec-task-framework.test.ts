import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PlanExecutionBook } from "../../src/codex-plan-run/execution-book";
import type { SpecTaskClassificationSignal } from "../../src/codex-plan-run/spec-task-framework";
import {
	buildSpecTaskFramework,
	renderSpecTaskFrameworkMarkdown,
	writeSpecTaskFrameworkArtifacts,
} from "../../src/codex-plan-run/spec-task-framework";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "omp-spec-framework-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const book: PlanExecutionBook = {
	schema_version: 1,
	run_id: "run-framework",
	created_at: "2026-06-30T00:00:00.000Z",
	plan: { path: "/repo/docs/superpowers/plans/demo.md", sha256: "plan-sha", repo_path: "/repo" },
	accepting_dir: "/tmp/accept",
	intake_gate: [],
	project_recon: {
		repo_path: "/repo",
		relevant_modules: ["src/codex-plan-run"],
		likely_files: ["src/codex-plan-run/driver.ts"],
		existing_patterns: ["pure gate modules"],
		test_commands: ["bun test test/codex-plan-run/driver.test.ts"],
		build_commands: ["bun run check:types"],
		style_conventions: [],
		risk_areas: ["acceptance bypass"],
		forbidden_changes: ["src/unrelated.ts"],
		task_file_map: { T01: ["src/codex-plan-run/driver.ts"] },
	},
	required_execution_skills: [],
	required_review_skills: [],
	final_tail_skills: [],
	final_acceptance_commands: ["bun test test/codex-plan-run/driver.test.ts"],
	tasks: [
		{
			id: "T01",
			title: "Wire role-bound execution",
			source: "Plan task 1",
			todo: "Wire role-bound execution into PlanRun driver",
			execution_skills: ["test-driven-development"],
			review_skills: ["requesting-code-review"],
			final_tail_skills: ["verification-before-completion"],
			allowed_files: ["src/codex-plan-run/driver.ts", "test/codex-plan-run/driver.test.ts"],
			forbidden_files: ["src/unrelated.ts"],
			smoke_commands: ["bun test test/codex-plan-run/driver.test.ts"],
			tdd_gates: {
				red: {
					command: "bun test test/codex-plan-run/driver.test.ts",
					expected: "FAIL",
					evidence_required: "RED_EVIDENCE",
				},
				green: {
					command: "bun test test/codex-plan-run/driver.test.ts",
					expected: "PASS",
					evidence_required: "GREEN_EVIDENCE",
				},
				regression: {
					command: "bun test test/codex-plan-run/driver.test.ts",
					expected: "PASS",
					evidence_required: "REGRESSION_EVIDENCE",
				},
			},
			advisor_watch_points: ["driver must not skip advisor gate"],
			required_skill_evidence: ["test-driven-development"],
			skill_evidence: { execution: [], review: [], final_tail: [] },
			implementation_analysis: "role-bound execution analysis",
			execution_scope: {
				goal: "Wire role-bound execution into PlanRun driver",
				allowed_files: ["src/codex-plan-run/driver.ts", "test/codex-plan-run/driver.test.ts"],
				forbidden_files: ["src/unrelated.ts"],
				likely_files: ["src/codex-plan-run/driver.ts"],
				existing_patterns: ["dependency-injected driver deps"],
				out_of_scope: ["replace task tool"],
			},
			implementation_steps: ["write red driver test", "implement driver wiring"],
			review_gate: {
				acceptance_criteria: ["driver writes prompt pack artifacts"],
				smoke_commands: ["bun test test/codex-plan-run/driver.test.ts"],
				required_evidence: ["prompt pack json"],
				must_fix_conditions: ["missing prompt pack"],
			},
		},
	],
};

describe("spec task framework", () => {
	it("builds six role-bound stages for each execution book task", () => {
		const framework = buildSpecTaskFramework({
			executionBook: book,
			sourceDocuments: [{ type: "plan", path: book.plan.path, sha256: book.plan.sha256 }],
			now: new Date("2026-06-30T00:00:00.000Z"),
		});

		expect(framework.schema_version).toBe("superpowers.spec_task_framework.v1");
		expect(framework.run_id).toBe("run-framework");
		expect(framework.tasks).toHaveLength(1);
		expect(framework.tasks[0].stages.map(stage => stage.id)).toEqual([
			"tdd-writer",
			"implementer",
			"test-runner",
			"spec-reviewer",
			"quality-reviewer",
			"acceptance",
		]);
		expect(framework.tasks[0].stages.map(stage => stage.title_zh)).toEqual([
			"编写失败测试",
			"实现最小生产代码",
			"独立运行测试与 smoke",
			"规格合规审查",
			"代码质量审查",
			"任务级验收",
		]);
		expect(framework.tasks[0].stages[0]).toMatchObject({
			role_id: "superpowers:tdd-writer",
			status: "pending",
			output_schema_ref: "superpowers.stage_output.tdd_writer.v1",
		});
		expect(framework.tasks[0].stages[0].required_evidence).toContainEqual(
			expect.objectContaining({ artifact_path: "tasks/T01/red-evidence.md", required: true }),
		);
		expect(framework.tasks[0].allowed_paths).toEqual(book.tasks[0].allowed_files);
		expect(framework.tasks[0].business_paths[0]).toMatchObject({
			id: "T01-primary",
			runtime_required: true,
			suggested_environment: "local",
		});
		expect(framework.global_gates.map(gate => gate.id)).toEqual(["global-impact", "real-business-simulation"]);
	});

	it("writes json and markdown artifacts", async () => {
		const acceptingDir = await makeTempDir();
		const framework = buildSpecTaskFramework({
			executionBook: book,
			sourceDocuments: [{ type: "plan", path: book.plan.path, sha256: book.plan.sha256 }],
			now: new Date("2026-06-30T00:00:00.000Z"),
		});

		const paths = await writeSpecTaskFrameworkArtifacts({ acceptingDir, framework });

		expect((await stat(paths.jsonPath)).isFile()).toBe(true);
		expect((await stat(paths.markdownPath)).isFile()).toBe(true);
		const parsed = JSON.parse(await readFile(paths.jsonPath, "utf8"));
		expect(parsed.tasks[0].id).toBe("T01");
		const markdown = await readFile(paths.markdownPath, "utf8");
		expect(markdown).toContain("# Spec Task Framework");
		expect(markdown).toContain("TDD Writer");
	});
});

describe("classification", () => {
	it("classifies frontend/security task with designer/security flags and browser/mixed surface", () => {
		const taskBook: PlanExecutionBook = {
			...book,
			tasks: [
				{
					...book.tasks[0],
					id: "T01",
					title: "Implement browser login with auth token",
					allowed_files: ["src/modes/components/login.tsx", "src/server/auth.ts"],
					execution_scope: {
						...book.tasks[0].execution_scope,
						goal: "Build browser-based login page with JWT token auth",
						allowed_files: ["src/modes/components/login.tsx", "src/server/auth.ts"],
						likely_files: ["src/modes/components/login.tsx", "src/server/auth.ts"],
					},
					review_gate: {
						...book.tasks[0].review_gate,
						acceptance_criteria: ["Login page works in browser", "Auth tokens are validated"],
					},
				},
			],
		};
		const framework = buildSpecTaskFramework({
			executionBook: taskBook,
			sourceDocuments: [{ type: "plan", path: book.plan.path, sha256: book.plan.sha256 }],
			now: new Date("2026-06-30T00:00:00.000Z"),
		});

		const classification = framework.tasks[0].classification;
		expect(classification.requires_frontend_design).toBe(true);
		expect(classification.requires_security_review).toBe(true);
		expect(["browser", "mixed"]).toContain(classification.runtime_surface);
		expect(Array.isArray(classification.signals)).toBe(true);
		expect(classification.signals.length).toBeGreaterThanOrEqual(1);
		const signalClassNames = classification.signals.map((s: SpecTaskClassificationSignal) => s.classification);
		expect(signalClassNames).toContain("requires_frontend_design");
		expect(signalClassNames).toContain("requires_security_review");
	});

	it("classifies payment task with requires_payment_review and text/acceptance signal", () => {
		const taskBook: PlanExecutionBook = {
			...book,
			tasks: [
				{
					...book.tasks[0],
					id: "T01",
					title: "Integrate stripe billing invoice checkout",
					execution_scope: {
						...book.tasks[0].execution_scope,
						goal: "Add stripe billing invoice checkout flow",
					},
					review_gate: {
						...book.tasks[0].review_gate,
						acceptance_criteria: ["Stripe billing invoice checkout works"],
					},
				},
			],
		};
		const framework = buildSpecTaskFramework({
			executionBook: taskBook,
			sourceDocuments: [{ type: "plan", path: book.plan.path, sha256: book.plan.sha256 }],
			now: new Date("2026-06-30T00:00:00.000Z"),
		});
		const classification = framework.tasks[0].classification;
		expect(classification.requires_payment_review).toBe(true);
		expect(
			classification.signals.some(
				(s: SpecTaskClassificationSignal) => s.classification === "requires_payment_review",
			),
		).toBe(true);
	});

	it("classifies database migration task with requires_data_migration_review and database surface", () => {
		const taskBook: PlanExecutionBook = {
			...book,
			tasks: [
				{
					...book.tasks[0],
					id: "T01",
					title: "Run database schema migration",
					execution_scope: {
						...book.tasks[0].execution_scope,
						goal: "Add SQL migration for new schema",
					},
					review_gate: {
						...book.tasks[0].review_gate,
						acceptance_criteria: ["Database schema migration sql runs cleanly"],
					},
				},
			],
		};
		const framework = buildSpecTaskFramework({
			executionBook: taskBook,
			sourceDocuments: [{ type: "plan", path: book.plan.path, sha256: book.plan.sha256 }],
			now: new Date("2026-06-30T00:00:00.000Z"),
		});

		const classification = framework.tasks[0].classification;
		expect(classification.requires_data_migration_review).toBe(true);
		expect(["database", "mixed"]).toContain(classification.runtime_surface);
	});

	it("classifies destructive task with requires_destructive_operation_review", () => {
		const taskBook: PlanExecutionBook = {
			...book,
			tasks: [
				{
					...book.tasks[0],
					id: "T01",
					title: "Force delete stale records",
					execution_scope: {
						...book.tasks[0].execution_scope,
						goal: "Drop and truncate old data",
					},
					review_gate: {
						...book.tasks[0].review_gate,
						acceptance_criteria: ["Delete all stale records", "Force cleanup of temp tables"],
					},
				},
			],
		};
		const framework = buildSpecTaskFramework({
			executionBook: taskBook,
			sourceDocuments: [{ type: "plan", path: book.plan.path, sha256: book.plan.sha256 }],
			now: new Date("2026-06-30T00:00:00.000Z"),
		});

		const classification = framework.tasks[0].classification;
		expect(classification.requires_destructive_operation_review).toBe(true);
	});

	it("classifies plain backend helper with no special flags and runtime_surface === none", () => {
		const taskBook: PlanExecutionBook = {
			...book,
			tasks: [
				{
					...book.tasks[0],
					id: "T01",
					title: "Fix name formatting util",
					allowed_files: ["src/utils/name.ts"],
					execution_scope: {
						...book.tasks[0].execution_scope,
						goal: "Update name formatting",
						allowed_files: ["src/utils/name.ts"],
						likely_files: ["src/utils/name.ts"],
					},
					review_gate: {
						...book.tasks[0].review_gate,
						acceptance_criteria: ["Name formatting works"],
					},
				},
			],
		};
		const framework = buildSpecTaskFramework({
			executionBook: taskBook,
			sourceDocuments: [{ type: "plan", path: book.plan.path, sha256: book.plan.sha256 }],
			now: new Date("2026-06-30T00:00:00.000Z"),
		});

		const classification = framework.tasks[0].classification;
		expect(classification.requires_frontend_design).toBe(false);
		expect(classification.requires_security_review).toBe(false);
		expect(classification.requires_payment_review).toBe(false);
		expect(classification.requires_data_migration_review).toBe(false);
		expect(classification.requires_destructive_operation_review).toBe(false);
		expect(classification.runtime_surface).toBe("none");
	});

	it("renderSpecTaskFrameworkMarkdown includes runtime_surface and specialized boolean lines", () => {
		const taskBook: PlanExecutionBook = {
			...book,
			tasks: [
				{
					...book.tasks[0],
					id: "T01",
					title: "Implement browser login with auth token",
					allowed_files: ["src/modes/components/login.tsx"],
					execution_scope: {
						...book.tasks[0].execution_scope,
						goal: "Build browser-based login page",
						allowed_files: ["src/modes/components/login.tsx"],
					},
				},
			],
		};
		const framework = buildSpecTaskFramework({
			executionBook: taskBook,
			sourceDocuments: [{ type: "plan", path: book.plan.path, sha256: book.plan.sha256 }],
			now: new Date("2026-06-30T00:00:00.000Z"),
		});

		const markdown = renderSpecTaskFrameworkMarkdown(framework);
		expect(markdown).toContain("runtime_surface:");
		expect(markdown).toContain("requires_frontend_design:");
		expect(markdown).toContain("requires_security_review:");
		expect(markdown).toContain("requires_payment_review:");
		expect(markdown).toContain("requires_data_migration_review:");
		expect(markdown).toContain("requires_destructive_operation_review:");
	});
	it("uses empty classification for every task when classification.enabled is false", () => {
		const framework = buildSpecTaskFramework({
			executionBook: book,
			sourceDocuments: [{ type: "plan", path: book.plan.path, sha256: book.plan.sha256 }],
			now: new Date("2026-06-30T00:00:00.000Z"),
			classification: { enabled: false },
		});

		for (const task of framework.tasks) {
			expect(task.classification).toEqual({
				requires_frontend_design: false,
				requires_security_review: false,
				requires_payment_review: false,
				requires_data_migration_review: false,
				requires_destructive_operation_review: false,
				runtime_surface: "none",
				signals: [],
			});
		}
	});
});
