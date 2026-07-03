import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { compilePromptPacksForFramework, writePromptPackArtifacts } from "../../src/codex-plan-run/prompt-pack";
import { emptySpecTaskClassification, type SpecTaskFramework } from "../../src/codex-plan-run/spec-task-framework";

const tempDirs: string[] = [];
async function makeTempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "omp-prompt-pack-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const framework: SpecTaskFramework = {
	schema_version: "superpowers.spec_task_framework.v1",
	run_id: "run-pack",
	generated_at: "2026-06-30T00:00:00.000Z",
	source_documents: [{ type: "plan", path: "/repo/plan.md", sha256: "plan-sha" }],
	role_registry_version: "superpowers.role_registry.v1",
	tasks: [
		{
			id: "T01",
			title_zh: "驱动角色绑定执行",
			intent: "driver writes prompt pack artifacts",
			acceptance_criteria: ["prompt pack files exist"],
			allowed_paths: ["src/codex-plan-run/driver.ts", "test/codex-plan-run/driver.test.ts"],
			forbidden_paths: ["src/unrelated.ts"],
			expected_changed_paths: ["src/codex-plan-run/driver.ts"],
			dependency_task_ids: [],
			affected_capabilities: ["codex-plan-run"],
			business_paths: [
				{
					id: "T01-primary",
					title_zh: "执行 PlanRun",
					user_story: "用户运行 PlanRun 并看到 role-bound evidence",
					runtime_required: true,
					suggested_environment: "local",
				},
			],
			classification: emptySpecTaskClassification(),
			stages: [
				{
					id: "tdd-writer",
					role_id: "superpowers:tdd-writer",
					title_zh: "编写失败测试",
					status: "pending",
					required_evidence: [
						{
							id: "red-evidence",
							title_zh: "Red 测试证据",
							artifact_path: "tasks/T01/red-evidence.md",
							required: true,
						},
					],
					output_schema_ref: "superpowers.stage_output.tdd_writer.v1",
				},
				{
					id: "implementer",
					role_id: "superpowers:implementer",
					title_zh: "实现最小生产代码",
					status: "pending",
					required_evidence: [
						{
							id: "implementation-summary",
							title_zh: "实现摘要",
							artifact_path: "tasks/T01/implementation-summary.md",
							required: true,
						},
					],
					output_schema_ref: "superpowers.stage_output.implementer.v1",
				},
				{
					id: "spec-reviewer",
					role_id: "superpowers:spec-reviewer",
					title_zh: "规格合规审查",
					status: "pending",
					required_evidence: [
						{
							id: "spec-review",
							title_zh: "规格审查记录",
							artifact_path: "tasks/T01/spec-review.md",
							required: true,
						},
					],
					output_schema_ref: "superpowers.stage_output.spec_reviewer.v1",
				},
			],
		},
		{
			id: "T02",
			title_zh: "测试 runner 绑定",
			intent: "test runner runs tests",
			acceptance_criteria: ["test evidence exists"],
			allowed_paths: ["src/"],
			forbidden_paths: [],
			expected_changed_paths: [],
			dependency_task_ids: ["T01"],
			affected_capabilities: ["codex-plan-run"],
			business_paths: [
				{
					id: "T02-primary",
					title_zh: "运行测试",
					user_story: "用户运行测试 runner 并看到 evidence",
					runtime_required: true,
					suggested_environment: "local",
				},
			],
			classification: emptySpecTaskClassification(),
			stages: [
				{
					id: "test-runner",
					role_id: "superpowers:test-runner",
					title_zh: "运行测试",
					status: "pending",
					required_evidence: [
						{
							id: "test-evidence",
							title_zh: "测试证据",
							artifact_path: "tasks/T02/test-evidence.md",
							required: true,
						},
					],
					output_schema_ref: "superpowers.stage_output.test_runner.v1",
				},
			],
		},
	],
	global_gates: [],
};

describe("prompt pack compiler", () => {
	it("generates role contracts and operation boundaries", () => {
		const packs = compilePromptPacksForFramework({
			framework,
			codebaseMemorySummary: "driver.ts calls runMainThreadAcceptanceReview",
		});

		const tdd = packs.find(pack => pack.stage_id === "tdd-writer")!;
		expect(tdd.schema_version).toBe("superpowers.prompt_pack.v1");
		expect(tdd.role_contract.may_edit_test_code).toBe(true);
		expect(tdd.role_contract.may_edit_production_code).toBe(false);
		expect(tdd.forbidden_operations.map(op => op.id)).toContain("modify-production-code");
		expect(tdd.required_outputs.map(output => output.artifact_path)).toContain("tasks/T01/red-evidence.md");
		expect(tdd.context_bundle.codebase_memory_summary).toContain("driver.ts");
		expect(tdd.context_bundle.task).toBeDefined();
		expect(tdd.context_bundle.task!.id).toBe("T01");
		expect(tdd.context_bundle.task!.title_zh).toBe("驱动角色绑定执行");
		expect(tdd.context_bundle.previous_stage_outputs).toEqual([]);

		const implementer = packs.find(pack => pack.stage_id === "implementer")!;
		expect(implementer.role_contract.may_edit_production_code).toBe(true);
		expect(implementer.role_contract.may_edit_test_code).toBe(false);
		expect(implementer.forbidden_operations.map(op => op.id)).toContain("expand-requirements");

		const reviewer = packs.find(pack => pack.stage_id === "spec-reviewer")!;
		expect(reviewer.role_contract.read_only).toBe(true);
		expect(reviewer.allowed_operations.map(op => op.id)).toEqual(["read-files", "write-review-evidence"]);
	});

	it("threads previous stage outputs into targeted prompt packs", () => {
		const packs = compilePromptPacksForFramework({
			framework,
			previousStageOutputsByStage: {
				"T01:implementer": [{ path: "tasks/T01/stages/tdd-writer/output.json", description: "TDD stage output" }],
			},
		});

		const tdd = packs.find(pack => pack.stage_id === "tdd-writer")!;
		const implementer = packs.find(pack => pack.stage_id === "implementer")!;
		expect(tdd.context_bundle.previous_stage_outputs).toEqual([]);
		expect(implementer.context_bundle.previous_stage_outputs).toEqual([
			{ path: "tasks/T01/stages/tdd-writer/output.json", description: "TDD stage output" },
		]);
	});

	it("writes prompt pack json and markdown files under task directories", async () => {
		const acceptingDir = await makeTempDir();
		const packs = compilePromptPacksForFramework({ framework });
		const paths = await writePromptPackArtifacts({ acceptingDir, packs });

		expect(paths).toContain(join(acceptingDir, "tasks", "T01", "prompt-packs", "tdd-writer.json"));
		expect((await stat(join(acceptingDir, "tasks", "T01", "prompt-packs", "tdd-writer.md"))).isFile()).toBe(true);
		const parsed = JSON.parse(
			await readFile(join(acceptingDir, "tasks", "T01", "prompt-packs", "implementer.json"), "utf8"),
		);
		expect(parsed.role_id).toBe("superpowers:implementer");
	});

	it("adds run-tests operation for test-runner role even when read_only", () => {
		const packs = compilePromptPacksForFramework({ framework });
		const runner = packs.find(pack => pack.stage_id === "test-runner")!;
		expect(runner).toBeDefined();
		expect(runner.role_contract.read_only).toBe(true);
		expect(runner.role_contract.may_edit_production_code).toBe(false);
		expect(runner.role_contract.may_edit_test_code).toBe(false);
		expect(runner.allowed_operations.map(op => op.id)).toContain("run-tests");
		expect(runner.forbidden_operations.map(op => op.id)).toContain("modify-production-code");
		expect(runner.forbidden_operations.map(op => op.id)).toContain("modify-test-code");
		expect(runner.forbidden_operations.map(op => op.id)).toContain("apply-code-fix");
	});

	it("rejects path traversal in task_id in writePromptPackArtifacts", async () => {
		const acceptingDir = await makeTempDir();
		const packs = compilePromptPacksForFramework({ framework });
		const badPack = { ...packs[0], task_id: "../../outside" };
		await expect(writePromptPackArtifacts({ acceptingDir, packs: [badPack] })).rejects.toThrow(
			/Invalid prompt pack path segment/,
		);
	});

	it("rejects path traversal in stage_id in writePromptPackArtifacts", async () => {
		const acceptingDir = await makeTempDir();
		const packs = compilePromptPacksForFramework({ framework });
		const badPack = { ...packs[0], stage_id: "../bad" };
		await expect(writePromptPackArtifacts({ acceptingDir, packs: [badPack] })).rejects.toThrow(
			/Invalid prompt pack path segment/,
		);
	});

	it("includes classification context and required review outputs when task requires frontend/security with browser runtime surface", () => {
		const classifiedFramework: SpecTaskFramework = {
			...framework,
			tasks: [
				{
					...framework.tasks[0],
					classification: {
						requires_frontend_design: true,
						requires_security_review: true,
						requires_payment_review: false,
						requires_data_migration_review: false,
						requires_destructive_operation_review: false,
						runtime_surface: "browser",
						signals: [
							{ source: "text", value: "frontend UI", classification: "requires_frontend_design" },
							{ source: "text", value: "auth", classification: "requires_security_review" },
						],
					},
				},
				framework.tasks[1],
			],
		};
		const packs = compilePromptPacksForFramework({ framework: classifiedFramework });

		const reviewer = packs.find(pack => pack.stage_id === "spec-reviewer")!;
		expect(reviewer.context_bundle.task?.classification.requires_frontend_design).toBe(true);
		expect(reviewer.context_bundle.task?.classification.requires_security_review).toBe(true);
		expect(reviewer.context_bundle.task?.classification.runtime_surface).toBe("browser");

		expect(reviewer.required_outputs.map(o => o.id)).toContain("frontend_design_review_evidence");
		expect(reviewer.required_outputs.map(o => o.id)).toContain("security_review_evidence");
	});
});
