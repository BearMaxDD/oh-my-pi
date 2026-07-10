import { afterEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { rm } from "node:fs/promises";
import type { PlanExecutionBook } from "../../src/codex-plan-run/execution-book";
import type { PromptPack } from "../../src/codex-plan-run/prompt-pack";
import type { BuildUnplannedRoleBoundStageRunInputsOptions } from "../../src/codex-plan-run/role-bound-stage-scheduler";
import {
	buildRoleBoundStageRunInputs,
	buildUnplannedRoleBoundStageRunInputs,
} from "../../src/codex-plan-run/role-bound-stage-scheduler";

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

describe("buildUnplannedRoleBoundStageRunInputs — compatibility mapper", () => {
	const COMPAT_BOOK = { run_id: "run-stage-test", tasks: [{ id: "T01" }] } as unknown as PlanExecutionBook;

	it("builds one stage run input per prompt pack in framework order", () => {
		const packs = [
			pack("tdd-writer", "superpowers:tdd-writer"),
			pack("implementer", "superpowers:implementer"),
			pack("test-runner", "superpowers:test-runner"),
			pack("spec-reviewer", "superpowers:spec-reviewer"),
			pack("quality-reviewer", "superpowers:quality-reviewer"),
			pack("acceptance", "superpowers:acceptance"),
		];

		const inputs = buildUnplannedRoleBoundStageRunInputs({
			book: COMPAT_BOOK,
			acceptingDir: "/tmp/accepting",
			taskId: "T01",
			promptPacks: packs,
			previousStageOutputs: [],
		} satisfies BuildUnplannedRoleBoundStageRunInputsOptions as BuildUnplannedRoleBoundStageRunInputsOptions);

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
		const inputs = buildUnplannedRoleBoundStageRunInputs({
			book: COMPAT_BOOK,
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
		} satisfies BuildUnplannedRoleBoundStageRunInputsOptions as BuildUnplannedRoleBoundStageRunInputsOptions);

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

		const inputs = buildUnplannedRoleBoundStageRunInputs({
			book: COMPAT_BOOK,
			acceptingDir: "/tmp/accepting",
			taskId: "T01",
			promptPacks: packs,
			previousStageOutputs: [],
		} satisfies BuildUnplannedRoleBoundStageRunInputsOptions as BuildUnplannedRoleBoundStageRunInputsOptions);

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

import type { Model } from "@oh-my-pi/pi-ai";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
// strict plan contract imports.
import type { StrictRoleExecutionPlan } from "../../src/codex-plan-run/role-bound-stage-scheduler";
import { Settings } from "../../src/config/settings";

describe("role-bound stage scheduler — strict plan contract", () => {
	const FIXTURE_MODEL: Model = buildModel({
		id: "gpt-5.3-codex",
		provider: "openai",
		api: "openai-responses",
		name: "openai/gpt-5.3-codex",
		baseUrl: "https://api.openai.com",
		reasoning: true,
		input: ["text"] as ("text" | "image")[],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 128_000,
		maxTokens: 8_192,
	});

	const modelRegistry = { getAvailable: () => [FIXTURE_MODEL] } as never;

	const settings = Settings.isolated({
		modelRoles: {
			"superpowers:tdd-writer": "openai/gpt-5.3-codex:high",
			"superpowers:implementer": "openai/gpt-5.3-codex:high",
			"superpowers:test-runner": "openai/gpt-5.3-codex:high",
			"superpowers:spec-reviewer": "openai/gpt-5.3-codex:high",
			"superpowers:quality-reviewer": "openai/gpt-5.3-codex:high",
			"superpowers:acceptance": "openai/gpt-5.3-codex:high",
		},
	});

	// ---- Per-test temp directory management ----

	const tempDirs = new Set<string>();
	afterEach(async () => {
		for (const d of tempDirs) {
			await rm(d, { recursive: true, force: true }).catch(() => {});
		}
		tempDirs.clear();
	});

	function freshDir(): { dir: string; book: Record<string, unknown> } {
		const dir = `/tmp/omp-scheduler-red-${randomUUID()}`;
		tempDirs.add(dir);
		return {
			dir,
			book: {
				schema_version: 1 as const,
				run_id: `run-scheduler-red-${randomUUID()}`,
				created_at: new Date().toISOString(),
				plan: { path: "/dev/null/plan.md", sha256: "0".repeat(64), repo_path: "/dev/null/repo" },
				accepting_dir: dir,
				intake_gate: [],
				project_recon: {
					repo_path: "/dev/null/repo",
					relevant_modules: [],
					likely_files: [],
					existing_patterns: [],
					test_commands: [],
					build_commands: [],
					style_conventions: [],
					risk_areas: [],
					forbidden_changes: [],
					task_file_map: {},
				},
				required_execution_skills: [],
				required_review_skills: [],
				final_tail_skills: [],
				final_acceptance_commands: ["bun test"],
				tasks: [],
			},
		};
	}

	it("each run input carries a strictRoleExecutionPlan derived from the pack role_id", async () => {
		const { dir, book } = freshDir();
		const packs = [pack("tdd-writer", "superpowers:tdd-writer"), pack("implementer", "superpowers:implementer")];

		const inputs = await buildRoleBoundStageRunInputs({
			book: book as never,
			acceptingDir: dir,
			taskId: "T01",
			promptPacks: packs,
			previousStageOutputs: [],
			settings,
			modelRegistry,
		});

		expect(inputs).toHaveLength(2);
		for (const input of inputs) {
			const plan: StrictRoleExecutionPlan = input.strictRoleExecutionPlan as StrictRoleExecutionPlan;
			expect(plan).toBeDefined();
			expect(plan.decision.source).toBe("explicit_stage");
			expect(plan.decision.selectedRoleId).toBe(input.modelRole);
			expect(plan.decision.confidence).toBe(1);
		}
	});

	it("each stage gets a distinct stage-scoped evidence path", async () => {
		const { dir, book } = freshDir();
		const packs = [pack("tdd-writer", "superpowers:tdd-writer"), pack("implementer", "superpowers:implementer")];

		const inputs = await buildRoleBoundStageRunInputs({
			book: book as never,
			acceptingDir: dir,
			taskId: "T01",
			promptPacks: packs,
			previousStageOutputs: [],
			settings,
			modelRegistry,
		});

		const paths = inputs.map(input => {
			const plan: StrictRoleExecutionPlan = input.strictRoleExecutionPlan as StrictRoleExecutionPlan;
			return plan.evidence.path;
		});

		expect(paths[0]).toContain("tdd-writer");
		expect(paths[1]).toContain("implementer");
		expect(new Set(paths).size).toBe(2);
	});

	it("strictRoleExecutionPlan is present for all six stages when fully configured", async () => {
		const { dir, book } = freshDir();
		const stages: Array<{ stageId: string; roleId: string }> = [
			{ stageId: "tdd-writer", roleId: "superpowers:tdd-writer" },
			{ stageId: "implementer", roleId: "superpowers:implementer" },
			{ stageId: "test-runner", roleId: "superpowers:test-runner" },
			{ stageId: "spec-reviewer", roleId: "superpowers:spec-reviewer" },
			{ stageId: "quality-reviewer", roleId: "superpowers:quality-reviewer" },
			{ stageId: "acceptance", roleId: "superpowers:acceptance" },
		];

		const packs = stages.map(s => pack(s.stageId, s.roleId));
		const inputs = await buildRoleBoundStageRunInputs({
			book: book as never,
			acceptingDir: dir,
			taskId: "T01",
			promptPacks: packs,
			previousStageOutputs: [],
			settings,
			modelRegistry,
		});

		expect(inputs).toHaveLength(6);
		for (const input of inputs) {
			const plan: StrictRoleExecutionPlan = input.strictRoleExecutionPlan as StrictRoleExecutionPlan;
			expect(plan).toBeDefined();
			expect(plan.decision.source).toBe("explicit_stage");
			expect(plan.evidence.status).toBe("preflight_passed");
		}
	});

	it("rejects when called without settings/modelRegistry for fixed PlanRun stages", async () => {
		const { dir, book } = freshDir();
		const packs = [pack("implementer", "superpowers:implementer")];

		await expect(
			Promise.resolve().then(() =>
				buildRoleBoundStageRunInputs({
					book: book as never,
					acceptingDir: dir,
					taskId: "T01",
					promptPacks: packs,
					previousStageOutputs: [],
				} as unknown as Parameters<typeof buildRoleBoundStageRunInputs>[0]),
			),
		).rejects.toThrow();
	});
});
