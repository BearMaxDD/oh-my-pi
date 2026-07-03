import { describe, expect, it } from "bun:test";
import type { SpawnTaskOutput } from "../../src/codex-plan-run/driver";
import type { PlanRunSubagentRunner, PlanRunTaskSpawnParams } from "../../src/codex-plan-run/plan-run-spawn-adapter";
import {
	buildPlanRunStageSpawnParams,
	createPlanRunProductionSpawnAdapter,
} from "../../src/codex-plan-run/plan-run-spawn-adapter";
import type { PromptPack } from "../../src/codex-plan-run/prompt-pack";
import type { RoleBoundStageRunInput } from "../../src/codex-plan-run/role-bound-stage-scheduler";

function fixtureStageRunInput(overrides?: Partial<RoleBoundStageRunInput>): RoleBoundStageRunInput {
	const promptPack: PromptPack = {
		schema_version: "superpowers.prompt_pack.v1",
		run_id: "run-impl-test-42",
		task_id: "T1",
		stage_id: "implementer",
		role_id: "superpowers:implementer",
		role_contract: {
			zh_name: "实现者",
			zh_description: "负责编写实现代码",
			may_edit_production_code: true,
			may_edit_test_code: true,
			read_only: false,
			success_definition: ["完成角色职责并写入证据"],
			failure_definition: ["缺少证据或越权操作"],
		},
		context_bundle: {
			source_documents: [],
			relevant_code_snippets: [],
			previous_stage_outputs: [],
			known_constraints: [],
		},
		allowed_operations: [
			{ id: "read-files", title_zh: "读取授权文件" },
			{ id: "modify-test-code", title_zh: "修改测试文件" },
			{ id: "modify-production-code", title_zh: "修改生产代码" },
			{ id: "write-stage-evidence", title_zh: "写入阶段证据" },
		],
		forbidden_operations: [{ id: "expand-requirements", title_zh: "扩大需求范围" }],
		required_outputs: [
			{ id: "implementer-output", title_zh: "实现者", artifact_path: "implementer.md", required: true },
		],
		return_schema: { id: "schema.implementer" },
		advisor_checkpoints: [{ gate: "before_stage", title_zh: "实现前检查" }],
	};

	return {
		book: {
			schema_version: 1,
			run_id: "run-impl-test-42",
			created_at: "2026-07-02T00:00:00.000Z",
			plan: {
				path: "/tmp/plans/impl-plan.md",
				sha256: "abcd1234",
				repo_path: "/home/user/project",
			},
			accepting_dir: "/tmp/accepting",
			intake_gate: [],
			project_recon: {
				repo_path: "/home/user/project",
				relevant_modules: [],
				likely_files: [],
				existing_patterns: [],
				test_commands: ["bun test"],
				build_commands: ["bun run build"],
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
		},
		acceptingDir: "/tmp/accepting",
		taskId: "T1",
		stageId: "implementer",
		promptPack,
		modelRole: "superpowers:implementer",
		previousStageOutputs: [
			{ taskId: "T1", stageId: "tdd-writer", outputPath: "/tmp/accepting/tasks/T1/stages/tdd-writer/output.json" },
		],
		...overrides,
	};
}

describe("buildPlanRunStageSpawnParams", () => {
	it("returns agent 'task' and id '{taskId}-{stageId}'", () => {
		const input = fixtureStageRunInput();
		const params = buildPlanRunStageSpawnParams(input);

		expect(params.agent).toBe("task");
		expect(params.id).toBe("T1-implementer");
	});

	it("uses the role_contract zh_name from the prompt pack as role", () => {
		const input = fixtureStageRunInput();
		const params = buildPlanRunStageSpawnParams(input);

		expect(params.role).toBe("实现者");
	});

	it("passes modelRole from the stage run input", () => {
		const input = fixtureStageRunInput();
		const params = buildPlanRunStageSpawnParams(input);

		expect(params.modelRole).toBe("superpowers:implementer");
	});

	it("builds context containing run_id and previous stage outputs", () => {
		const input = fixtureStageRunInput();
		const params = buildPlanRunStageSpawnParams(input);

		expect(params.context).toContain("run-impl-test-42");
		expect(params.context).toContain("tdd-writer");
		expect(params.context).toContain("/tmp/accepting/tasks/T1/stages/tdd-writer/output.json");
	});

	it("builds assignment containing current stage, evidence path, and prohibition on project-level build/test/lint", () => {
		const input = fixtureStageRunInput();
		const params = buildPlanRunStageSpawnParams(input);

		expect(params.assignment).toContain("实现者");
		expect(params.assignment).toContain("T1");
		expect(params.assignment).toContain("implementer");
		expect(params.assignment).toContain("/tmp/accepting/tasks/T1/evidence");
		expect(params.assignment).toMatch(/do not run project-level (build|test|lint)/i);
	});

	it("populates required_skill_evidence from required output artifact paths", () => {
		const input = fixtureStageRunInput();
		const params = buildPlanRunStageSpawnParams(input);

		expect(params.required_skill_evidence).toEqual(["implementer.md"]);
	});

	it("allows empty previousStageOutputs gracefully", () => {
		const input = fixtureStageRunInput({ previousStageOutputs: [] });
		const params = buildPlanRunStageSpawnParams(input);

		expect(params.context).toContain("run-impl-test-42");
		expect(params.context).not.toContain("Previous stage outputs");
	});
});

describe("createPlanRunProductionSpawnAdapter", () => {
	const defaultBook = fixtureStageRunInput().book;

	it("spawnTask delegates to runner.run", async () => {
		let receivedParams: PlanRunTaskSpawnParams | undefined;
		const runner: PlanRunSubagentRunner = {
			run: async (params: PlanRunTaskSpawnParams): Promise<SpawnTaskOutput> => {
				receivedParams = params;
				return {
					task_id: "T1",
					changed_files: [],
					tests_run: [],
					evidence: [],
					execution_skills_used: [],
					final_tail_skills_used: [],
					scope_notes: [],
					result: "completed",
				};
			},
		};
		const adapter = createPlanRunProductionSpawnAdapter({ runner });
		const output = await adapter.spawnTask({ book: defaultBook, acceptingDir: "/tmp/accepting", taskId: "T1" });
		expect(output.task_id).toBe("T1");
		expect(receivedParams).toBeDefined();
		expect(receivedParams!.id).toBe("T1");
	});

	it("spawnStage returns task/stage/role metadata", async () => {
		const runner: PlanRunSubagentRunner = {
			run: async (): Promise<SpawnTaskOutput> => ({
				task_id: "T1",
				changed_files: [],
				tests_run: [],
				evidence: [],
				execution_skills_used: [],
				final_tail_skills_used: [],
				scope_notes: [],
				result: "completed",
			}),
		};
		const adapter = createPlanRunProductionSpawnAdapter({ runner });
		const output = await adapter.spawnStage(fixtureStageRunInput());
		expect(output.task_id).toBe("T1");
		expect(output.stage_id).toBe("implementer");
		expect(output.role_id).toBe("superpowers:implementer");
	});

	it("preserves runner metadata (agentId, resolvedModel, modelOverrides, advisorFindings)", async () => {
		const runner: PlanRunSubagentRunner = {
			run: async (): Promise<SpawnTaskOutput> => ({
				task_id: "T1",
				changed_files: [],
				tests_run: [],
				evidence: [],
				execution_skills_used: [],
				final_tail_skills_used: [],
				scope_notes: [],
				result: "completed",
				agentId: "agent-impl-42",
				resolvedModel: "deepseek/deepseek-v4-flash",
				modelOverrides: ["temperature:0.3"],
				advisorFindings: [
					{
						schema_version: 1,
						run_id: "run-impl-test-42",
						task_id: "T1",
						severity: "info",
						category: "test",
						finding: "Pre-check passed",
						evidence: "ok",
					},
				],
			}),
		};
		const adapter = createPlanRunProductionSpawnAdapter({ runner });
		const output = await adapter.spawnStage(fixtureStageRunInput());
		expect(output.agentId).toBe("agent-impl-42");
		expect(output.resolvedModel).toBe("deepseek/deepseek-v4-flash");
		expect(output.modelOverrides).toEqual(["temperature:0.3"]);
		expect(output.advisorFindings).toBeDefined();
		expect(output.advisorFindings![0].finding).toBe("Pre-check passed");
	});

	it("uses return_schema.id for schema_version", async () => {
		const runner: PlanRunSubagentRunner = {
			run: async (): Promise<SpawnTaskOutput> => ({
				task_id: "T1",
				changed_files: [],
				tests_run: [],
				evidence: [],
				execution_skills_used: [],
				final_tail_skills_used: [],
				scope_notes: [],
				result: "completed",
			}),
		};
		const adapter = createPlanRunProductionSpawnAdapter({ runner });
		const output = await adapter.spawnStage(fixtureStageRunInput());
		expect(output.schema_version).toBe("schema.implementer");
	});

	it("maps evidence_paths from runner output", async () => {
		const runner: PlanRunSubagentRunner = {
			run: async (): Promise<SpawnTaskOutput> => ({
				task_id: "T1",
				changed_files: [],
				tests_run: [],
				evidence: ["path-a.md", "path-b.md"],
				execution_skills_used: [],
				final_tail_skills_used: [],
				scope_notes: [],
				result: "completed",
			}),
		};
		const adapter = createPlanRunProductionSpawnAdapter({ runner });
		const output = await adapter.spawnStage(fixtureStageRunInput());
		expect(output.evidence_paths).toEqual(["path-a.md", "path-b.md"]);
	});

	it("blocks when runner returns completed but required evidence is missing", async () => {
		const runner: PlanRunSubagentRunner = {
			run: async (): Promise<SpawnTaskOutput> => ({
				task_id: "T1",
				changed_files: ["src/foo.ts"],
				tests_run: [],
				evidence: ["some-other.md"],
				execution_skills_used: [],
				final_tail_skills_used: [],
				scope_notes: [],
				result: "completed",
			}),
		};
		const adapter = createPlanRunProductionSpawnAdapter({ runner });
		const output = await adapter.spawnStage(fixtureStageRunInput());
		expect(output.result).toBe("blocked");
		expect(output.advisorFindings).toBeDefined();
		expect(output.advisorFindings!.some(f => f.finding.includes("缺少 stage evidence"))).toBe(true);
	});

	it("does not throw on frozen runner output with missing evidence and returns blocked", async () => {
		const frozenOutput: SpawnTaskOutput = Object.freeze({
			task_id: "T1",
			changed_files: ["src/foo.ts"],
			tests_run: [],
			evidence: ["some-other.md"],
			execution_skills_used: [],
			final_tail_skills_used: [],
			scope_notes: [],
			result: "completed" as const,
		});
		const runner: PlanRunSubagentRunner = {
			run: async (): Promise<SpawnTaskOutput> => frozenOutput,
		};
		const adapter = createPlanRunProductionSpawnAdapter({ runner });
		const output = await adapter.spawnStage(fixtureStageRunInput());
		expect(output.result).toBe("blocked");
		expect(output.advisorFindings).toBeDefined();
		expect(output.advisorFindings!.some(f => f.finding.includes("缺少 stage evidence"))).toBe(true);
	});

	it("passes through when all required outputs are present in evidence", async () => {
		const runner: PlanRunSubagentRunner = {
			run: async (): Promise<SpawnTaskOutput> => ({
				task_id: "T1",
				changed_files: ["src/foo.ts"],
				tests_run: [],
				evidence: ["implementer.md"],
				execution_skills_used: [],
				final_tail_skills_used: [],
				scope_notes: [],
				result: "completed",
			}),
		};
		const adapter = createPlanRunProductionSpawnAdapter({ runner });
		const output = await adapter.spawnStage(fixtureStageRunInput());
		expect(output.result).toBe("completed");
	});

	it("does not block for missing optional outputs", async () => {
		const input = fixtureStageRunInput({
			promptPack: {
				...fixtureStageRunInput().promptPack,
				required_outputs: [
					{ id: "required-out", title_zh: "必需输出", artifact_path: "required.md", required: true },
					{ id: "optional-out", title_zh: "可选输出", artifact_path: "optional.md", required: false },
				],
			},
		});
		const runner: PlanRunSubagentRunner = {
			run: async (): Promise<SpawnTaskOutput> => ({
				task_id: "T1",
				changed_files: [],
				tests_run: [],
				evidence: ["required.md"],
				execution_skills_used: [],
				final_tail_skills_used: [],
				scope_notes: [],
				result: "completed",
			}),
		};
		const adapter = createPlanRunProductionSpawnAdapter({ runner });
		const output = await adapter.spawnStage(input);
		expect(output.result).toBe("completed");
	});
});
