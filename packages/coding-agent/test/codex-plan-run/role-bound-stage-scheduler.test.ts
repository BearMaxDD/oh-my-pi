import { describe, expect, it } from "bun:test";
import type { PromptPack } from "../../src/codex-plan-run/prompt-pack";
import { buildRoleBoundStageRunInputs } from "../../src/codex-plan-run/role-bound-stage-scheduler";

function pack(stageId: string, roleId: string): PromptPack {
	return {
		schema_version: "superpowers.prompt_pack.v1",
		run_id: "run-stage-test",
		task_id: "T01",
		stage_id: stageId,
		role_id: roleId,
		role_contract: {
			zh_name: roleId,
			zh_description: roleId,
			may_edit_production_code: roleId === "superpowers:implementer",
			may_edit_test_code: roleId === "superpowers:tdd-writer",
			read_only: roleId.includes("reviewer") || roleId.endsWith("acceptance"),
			success_definition: ["produce required evidence"],
			failure_definition: ["missing required evidence"],
		},
		context_bundle: {
			source_documents: [],
			relevant_code_snippets: [],
			previous_stage_outputs: [],
			known_constraints: [],
		},
		allowed_operations: [{ id: "read-files", title_zh: "读取文件" }],
		forbidden_operations: [],
		required_outputs: [
			{ id: `${stageId}-output`, title_zh: stageId, artifact_path: `${stageId}.md`, required: true },
		],
		return_schema: { id: `schema.${stageId}` },
		advisor_checkpoints: [],
	};
}

describe("role-bound stage scheduler", () => {
	it("builds one stage run input per prompt pack in framework order", () => {
		const packs = [
			pack("tdd-writer", "superpowers:tdd-writer"),
			pack("implementer", "superpowers:implementer"),
			pack("test-runner", "superpowers:test-runner"),
			pack("spec-reviewer", "superpowers:spec-reviewer"),
			pack("quality-reviewer", "superpowers:quality-reviewer"),
			pack("acceptance", "superpowers:acceptance"),
		];

		const inputs = buildRoleBoundStageRunInputs({
			book: { run_id: "run-stage-test", tasks: [{ id: "T01" }] } as never,
			acceptingDir: "/tmp/accepting",
			taskId: "T01",
			promptPacks: packs,
			previousStageOutputs: [],
		});

		expect(inputs.map(input => input.stageId)).toEqual([
			"tdd-writer",
			"implementer",
			"test-runner",
			"spec-reviewer",
			"quality-reviewer",
			"acceptance",
		]);
		expect(inputs[0]?.modelRole).toBe("superpowers:tdd-writer");
		expect(inputs[5]?.promptPack.return_schema.id).toBe("schema.acceptance");
	});

	it("passes previous accepted stage outputs into later stages", () => {
		const inputs = buildRoleBoundStageRunInputs({
			book: { run_id: "run-stage-test", tasks: [{ id: "T01" }] } as never,
			acceptingDir: "/tmp/accepting",
			taskId: "T01",
			promptPacks: [pack("tdd-writer", "superpowers:tdd-writer"), pack("implementer", "superpowers:implementer")],
			previousStageOutputs: [
				{
					taskId: "T01",
					stageId: "tdd-writer",
					outputPath: "/tmp/accepting/tasks/T01/stages/tdd-writer/output.json",
				},
			],
		});

		expect(inputs[1]?.previousStageOutputs).toEqual([
			{ taskId: "T01", stageId: "tdd-writer", outputPath: "/tmp/accepting/tasks/T01/stages/tdd-writer/output.json" },
		]);
	});

	it("sorts out-of-order input into framework stage order", () => {
		const packs = [
			pack("quality-reviewer", "superpowers:quality-reviewer"),
			pack("tdd-writer", "superpowers:tdd-writer"),
			pack("acceptance", "superpowers:acceptance"),
			pack("spec-reviewer", "superpowers:spec-reviewer"),
			pack("test-runner", "superpowers:test-runner"),
			pack("implementer", "superpowers:implementer"),
		];

		const inputs = buildRoleBoundStageRunInputs({
			book: { run_id: "run-stage-test", tasks: [{ id: "T01" }] } as never,
			acceptingDir: "/tmp/accepting",
			taskId: "T01",
			promptPacks: packs,
			previousStageOutputs: [],
		});

		expect(inputs.map(input => input.stageId)).toEqual([
			"tdd-writer",
			"implementer",
			"test-runner",
			"spec-reviewer",
			"quality-reviewer",
			"acceptance",
		]);
	});
});
