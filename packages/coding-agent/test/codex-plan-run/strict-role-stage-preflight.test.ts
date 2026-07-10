/**
 * Strict role stage preflight — buildStrictStageExecutionPlan.
 *
 * Contract:
 * 1. Fixed PlanRun stages produce explicit_stage decisions with confidence 1.
 * 2. Stage-scoped model-routing evidence path is isolated per stage.
 * 3. Unconfigured roles (no modelRoles entry) → "role_model_unconfigured".
 * 4. Incomplete role contracts → "role_contract_missing".
 * 5. Unavailable configured model → "role_model_unavailable".
 * 6. Each stage writes to its own evidence path.
 * 7. All six standard stages produce valid plans when fully configured.
 * 8. Preflight evidence is atomically written to acceptingDir before returning.
 */

import { afterEach, describe, expect, it } from "bun:test";
import { randomUUID } from "node:crypto";
import { readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import type { Model } from "@oh-my-pi/pi-ai";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import type { PlanExecutionBook } from "../../src/codex-plan-run/execution-book";
import { writeModelRoutingEvidenceV2 } from "../../src/codex-plan-run/model-routing-evidence";
import type { PromptPack, RoleContract } from "../../src/codex-plan-run/prompt-pack";
import {
	buildStrictStageExecutionPlan,
	type StagePreflightInput,
	type StrictRoleExecutionPlan,
} from "../../src/codex-plan-run/role-bound-stage-scheduler";
import { writeStageLedgerEntry } from "../../src/codex-plan-run/stage-ledger";
import { Settings } from "../../src/config/settings";
import type { TaskOperationRequirements } from "../../src/task/role-contract-validator";

const tempDirs = new Set<string>();
afterEach(async () => {
	for (const d of tempDirs) {
		await rm(d, { recursive: true, force: true }).catch(() => {});
	}
	tempDirs.clear();
});

function freshDir(): string {
	const dir = `/tmp/omp-preflight-red-${randomUUID()}`;
	tempDirs.add(dir);
	return dir;
}

// ---- Helpers ----

function makeBook(acceptingDir: string): PlanExecutionBook {
	return {
		schema_version: 1,
		run_id: "run-red-preflight",
		created_at: new Date().toISOString(),
		plan: { path: "/dev/null/plan.md", sha256: "0".repeat(64), repo_path: "/dev/null/repo" },
		accepting_dir: acceptingDir,
		intake_gate: [],
		project_recon: {
			repo_path: "/dev/null/repo",
			relevant_modules: ["src"],
			likely_files: ["src/index.ts"],
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
	} as PlanExecutionBook;
}

function makePack(stageId: string, roleId: string): PromptPack {
	return {
		schema_version: "superpowers.prompt_pack.v1",
		run_id: "run-red-preflight",
		task_id: "T01",
		stage_id: stageId,
		role_id: roleId,
		role_contract: {
			zh_name: roleId,
			zh_description: `Stage ${stageId}`,
			may_edit_production_code: true,
			may_edit_test_code: true,
			read_only: false,
			success_definition: [`${stageId} success`],
			failure_definition: [`${stageId} failure`],
		} satisfies RoleContract as RoleContract,
		context_bundle: {
			source_documents: [],
			relevant_code_snippets: [],
			task: { id: "T01", title: "Test task" } as never,
			previous_stage_outputs: [],
			known_constraints: [],
		},
		allowed_operations: [{ id: "read-files", title_zh: "Read files" }],
		forbidden_operations: [],
		required_outputs: [
			{ id: `${stageId}-output`, title_zh: stageId, artifact_path: `${stageId}.md`, required: true },
		],
		return_schema: { id: `schema.${stageId}` },
		advisor_checkpoints: [],
	};
}

function defaultRequirements(): TaskOperationRequirements {
	return { needsProductionWrite: false, needsTestWrite: false, readOnly: false };
}

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

function makeInput(overrides?: Partial<StagePreflightInput>): StagePreflightInput {
	const acceptingDir = freshDir();
	const runId = `run-red-preflight-${randomUUID()}`;
	// Derive stage/role from override or default so promptPack stays in sync.
	const effectiveStageId = overrides?.stageId ?? "implementer";
	const effectiveRoleId = overrides?.modelRole ?? "superpowers:implementer";
	return {
		book: { ...makeBook(acceptingDir), run_id: runId } satisfies PlanExecutionBook as PlanExecutionBook,
		acceptingDir,
		taskId: "T01",
		stageId: effectiveStageId,
		modelRole: effectiveRoleId,
		promptPack: overrides?.promptPack ?? makePack(effectiveStageId, effectiveRoleId),
		settings: Settings.isolated({ modelRoles: { [effectiveRoleId]: "openai/gpt-5.3-codex:high" } }),
		modelRegistry: { getAvailable: () => [FIXTURE_MODEL] } as never,
		requirements: defaultRequirements(),
		...overrides,
	} satisfies StagePreflightInput as StagePreflightInput;
}

// ---- Tests ----

describe("buildStrictStageExecutionPlan", () => {
	it("returns StrictRoleExecutionPlan with explicit_stage decision matching the stage role", async () => {
		const input = makeInput({ stageId: "implementer", modelRole: "superpowers:implementer" });
		const plan: StrictRoleExecutionPlan = await buildStrictStageExecutionPlan(input);

		expect(plan.decision.source).toBe("explicit_stage");
		expect(plan.decision.selectedRoleId).toBe("superpowers:implementer");
		expect(plan.decision.confidence).toBe(1);
		expect(plan.decision.reasons).toEqual(
			expect.arrayContaining([expect.stringContaining("plan_run_stage:implementer")]),
		);
	});

	it("returns stage-scoped evidence path containing task and stage path", async () => {
		const input = makeInput({ taskId: "T01", stageId: "implementer" });
		const plan = await buildStrictStageExecutionPlan(input);

		expect(plan.evidence.path).toContain("tasks/T01/stages/implementer/model-routing-evidence.json");
	});

	it("returns plan with resolved contract and binding for the stage role", async () => {
		const input = makeInput({ stageId: "implementer", modelRole: "superpowers:implementer" });
		const plan = await buildStrictStageExecutionPlan(input);

		expect(plan.contract).toBeDefined();
		expect(plan.contract.roleId).toBe("superpowers:implementer");
		expect(plan.contract.passed).toBe(true);

		expect(plan.binding).toBeDefined();
		expect(plan.binding.roleId).toBe("superpowers:implementer");
		expect(plan.binding.provider).toBe("openai");
		expect(plan.binding.modelId).toBe("gpt-5.3-codex");
		expect(plan.binding.canonicalSelector).toBe("openai/gpt-5.3-codex");
		expect(plan.binding.configuredSelector).toBe("openai/gpt-5.3-codex:high");
	});

	// ---- Block conditions (before runner) ----

	it("blocks with role_model_unconfigured when role has no modelRoles entry", async () => {
		const input = makeInput({
			modelRole: "superpowers:implementer",
			settings: Settings.isolated({ modelRoles: {} }),
		});

		await expect(buildStrictStageExecutionPlan(input)).rejects.toMatchObject({
			code: "role_model_unconfigured",
		});
	});

	it("blocks with role_contract_missing when role contract lacks subagent permission", async () => {
		// MODEL_ROLES.default is a registered built-in with canRunAsSubagent=false
		// and no contractVersion/capabilities — the contract validator rejects it.
		const input = makeInput({
			stageId: "default-stage",
			modelRole: "default",
			promptPack: makePack("default-stage", "default"),
			settings: Settings.isolated({
				modelRoles: { default: "openai/gpt-5.3-codex:high" },
			}),
		});

		await expect(buildStrictStageExecutionPlan(input)).rejects.toMatchObject({
			code: "role_contract_missing",
		});
	});

	it("blocks with role_model_unavailable when configured model is not in available models", async () => {
		const input = makeInput({
			settings: Settings.isolated({
				modelRoles: { "superpowers:implementer": "openai/gpt-5.3-codex:high" },
			}),
			modelRegistry: { getAvailable: () => [] } as never,
		});

		await expect(buildStrictStageExecutionPlan(input)).rejects.toMatchObject({
			code: "role_model_unavailable",
		});
	});

	it("blocks with role_model_unavailable when configured model id does not match available models", async () => {
		const input = makeInput({
			settings: Settings.isolated({
				modelRoles: { "superpowers:implementer": "openai/gpt-4" },
			}),
		});

		await expect(buildStrictStageExecutionPlan(input)).rejects.toMatchObject({
			code: "role_model_unavailable",
		});
	});

	// ---- Isolation ----

	it("each stage has an isolated evidence path", async () => {
		const stages: Array<{ stageId: string; roleId: string }> = [
			{ stageId: "tdd-writer", roleId: "superpowers:tdd-writer" },
			{ stageId: "implementer", roleId: "superpowers:implementer" },
			{ stageId: "test-runner", roleId: "superpowers:test-runner" },
			{ stageId: "spec-reviewer", roleId: "superpowers:spec-reviewer" },
			{ stageId: "quality-reviewer", roleId: "superpowers:quality-reviewer" },
			{ stageId: "acceptance", roleId: "superpowers:acceptance" },
		];

		const paths = await Promise.all(
			stages.map(async s => {
				const plan = await buildStrictStageExecutionPlan(
					makeInput({
						taskId: "T01",
						stageId: s.stageId,
						modelRole: s.roleId,
						settings: Settings.isolated({
							modelRoles: { [s.roleId]: "openai/gpt-5.3-codex:high" },
						}),
					}),
				);
				return plan.evidence.path;
			}),
		);

		const uniquePaths = new Set(paths);
		expect(uniquePaths.size).toBe(stages.length);
		for (const p of uniquePaths) {
			expect(p).toMatch(/tasks\/T01\/stages\/[^/]+\/model-routing-evidence\.json$/);
		}
	});

	it("all six standard stages produce valid plans when fully configured", async () => {
		const stages: Array<{ stageId: string; roleId: string }> = [
			{ stageId: "tdd-writer", roleId: "superpowers:tdd-writer" },
			{ stageId: "implementer", roleId: "superpowers:implementer" },
			{ stageId: "test-runner", roleId: "superpowers:test-runner" },
			{ stageId: "spec-reviewer", roleId: "superpowers:spec-reviewer" },
			{ stageId: "quality-reviewer", roleId: "superpowers:quality-reviewer" },
			{ stageId: "acceptance", roleId: "superpowers:acceptance" },
		];

		const plans = await Promise.all(
			stages.map(s =>
				buildStrictStageExecutionPlan(
					makeInput({
						taskId: "T01",
						stageId: s.stageId,
						modelRole: s.roleId,
						settings: Settings.isolated({
							modelRoles: { [s.roleId]: "openai/gpt-5.3-codex:high" },
						}),
					}),
				),
			),
		);

		expect(plans).toHaveLength(stages.length);
		for (const plan of plans) {
			expect(plan.decision.source).toBe("explicit_stage");
			expect(plan.contract).toBeDefined();
			expect(plan.contract.passed).toBe(true);
			expect(plan.binding).toBeDefined();
			expect(plan.evidence.path).toBeTruthy();
			expect(plan.evidence.status).toBe("preflight_passed");
		}
	});

	// ---- Evidence persistence ----

	it("writes preflight evidence to the accepting directory", async () => {
		const input = makeInput({ taskId: "T01", stageId: "tdd-writer", modelRole: "superpowers:tdd-writer" });
		const plan = await buildStrictStageExecutionPlan(input);

		expect(plan.evidence.path).toContain(input.acceptingDir);
		expect(plan.evidence.path).toContain("tasks/T01/stages/tdd-writer/model-routing-evidence.json");
	});

	// ---- Path validation ----

	it("rejects with role_contract_missing when stage and role are mismatched (tdd-writer + implementer)", async () => {
		const input = makeInput({
			stageId: "tdd-writer",
			modelRole: "superpowers:implementer",
			// promptPack auto-derived from these overrides — stage says tdd-writer
			// but role says implementer; the contract/identity check should catch this.
		});

		await expect(buildStrictStageExecutionPlan(input)).rejects.toMatchObject({
			code: "role_contract_missing",
		});
	});

	it("rejects with stage_identity_invalid when taskId contains traversal (../)", async () => {
		const unsafeTaskId = "T01/../etc";
		const input = makeInput({
			taskId: unsafeTaskId,
			stageId: "implementer",
			// Match promptPack identity so identity-checks pass; the evidence
			// writer is what must be gated.
			promptPack: { ...makePack("implementer", "superpowers:implementer"), task_id: unsafeTaskId },
		});
		// Register the escaped sibling path so /tmp stays clean if the gate is absent.
		const escapePath = join(input.acceptingDir, "tasks", "etc", "stages", "implementer");
		tempDirs.add(escapePath);

		await expect(buildStrictStageExecutionPlan(input)).rejects.toMatchObject({
			code: "stage_identity_invalid",
		});
	});

	it("rejects with stage_identity_invalid when stageId contains traversal (../)", async () => {
		const unsafeStageId = "implementer/../../../tmp";
		const input = makeInput({
			taskId: "T01",
			stageId: unsafeStageId,
		});
		// makeInput derives promptPack from the effective stageId so pack identity matches.
		// The writer normalizes into acceptingDir/tasks/tmp which is inside the accepting
		// directory, so afterEach cleanup of the accepting dir covers it.

		await expect(buildStrictStageExecutionPlan(input)).rejects.toMatchObject({
			code: "stage_identity_invalid",
		});
	});

	it("rejects with stage_identity_invalid when taskId contains path separators", async () => {
		const unsafeTaskId = "T01/sub";
		const input = makeInput({
			taskId: unsafeTaskId,
			stageId: "implementer",
			promptPack: { ...makePack("implementer", "superpowers:implementer"), task_id: unsafeTaskId },
		});
		const escapePath = join(input.acceptingDir, "tasks", "T01", "sub", "stages", "implementer");
		tempDirs.add(escapePath);

		await expect(buildStrictStageExecutionPlan(input)).rejects.toMatchObject({
			code: "stage_identity_invalid",
		});
	});

	it("rejects with stage_identity_invalid when taskId is dot-only (.)", async () => {
		const input = makeInput({
			taskId: ".",
			stageId: "implementer",
			promptPack: { ...makePack("implementer", "superpowers:implementer"), task_id: "." },
		});

		await expect(buildStrictStageExecutionPlan(input)).rejects.toMatchObject({
			code: "stage_identity_invalid",
		});
	});

	it("rejects with stage_identity_invalid when stageId is dot-only (.)", async () => {
		const input = makeInput({
			taskId: "T01",
			stageId: ".",
		});

		await expect(buildStrictStageExecutionPlan(input)).rejects.toMatchObject({
			code: "stage_identity_invalid",
		});
	});

	it("rejects with stage_identity_invalid when stage is not in fixed STAGE_ORDER", async () => {
		const input = makeInput({
			taskId: "T01",
			stageId: "custom-stage",
			modelRole: "superpowers:implementer",
		});

		await expect(buildStrictStageExecutionPlan(input)).rejects.toMatchObject({
			code: "stage_identity_invalid",
		});
	});
	// ---- Quality P1: evidence integrity ----
	it("rejects stage-ledger V1 write when V2 evidence already exists at same stage path", async () => {
		const acceptingDir = freshDir();
		const taskId = "T01";
		const stageId = "implementer";
		const runId = `run-${randomUUID()}`;

		// Write V2 evidence to the stage path.
		await writeModelRoutingEvidenceV2(
			{
				schema_version: 2,
				run_id: runId,
				task_id: taskId,
				stage_id: stageId,
				status: "preflight_passed",
				timestamps: { created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
				role_decision: { source: "explicit_stage", selected_role_id: "superpowers:implementer", confidence: 1 },
				contract_validation: { passed: true },
				model_binding: {
					configured_selector: "openai/gpt-5.3-codex:high",
					provider: "openai",
					model_id: "gpt-5.3-codex",
					binding_hash: "hash-v2",
				},
			},
			acceptingDir,
		);

		// writeStageLedgerEntry writes modelRouting to exactly the V2 stage path
		// (stage-ledger.ts:50–57). It should not silently overwrite V2 evidence.
		await expect(
			writeStageLedgerEntry({
				acceptingDir,
				runId,
				taskId,
				stageId,
				status: "accepted",
				output: { result: "done" },
				modelRouting: { schema_version: 1, run_id: runId, task_id: taskId, resolved_model: "openai/gpt-5.3-codex" },
				advisorGates: [],
			}),
		).rejects.toThrow(/(v2|evidence|overwrite|conflict)/i);

		// Assert V2 evidence was NOT replaced.
		const evidencePath = join(acceptingDir, "tasks", taskId, "stages", stageId, "model-routing-evidence.json");
		const content = JSON.parse(await readFile(evidencePath, "utf-8"));
		expect(content.schema_version).toBe(2);
		expect(content.status).toBe("preflight_passed");
		expect(content.model_binding.binding_hash).toBe("hash-v2");
	});
	it("rejects V2 transition when binding hash changes (immutable across transitions)", async () => {
		const acceptingDir = freshDir();
		const taskId = "T01";
		const stageId = "implementer";
		const runId = `run-${randomUUID()}`;

		// Write preflight_passed with a consistent identity.
		await writeModelRoutingEvidenceV2(
			{
				schema_version: 2,
				run_id: runId,
				task_id: taskId,
				stage_id: stageId,
				status: "preflight_passed",
				timestamps: { created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
				role_decision: { source: "explicit_stage", selected_role_id: "superpowers:implementer", confidence: 1 },
				contract_validation: { passed: true },
				model_binding: {
					configured_selector: "openai/gpt-5.3-codex:high",
					provider: "openai",
					model_id: "gpt-5.3-codex",
					binding_hash: "hash-a",
				},
			},
			acceptingDir,
		);

		// Transition with the same identity but different binding hash → reject.
		await expect(
			writeModelRoutingEvidenceV2(
				{
					schema_version: 2,
					run_id: runId,
					task_id: taskId,
					stage_id: stageId,
					status: "started",
					timestamps: {
						created_at: new Date().toISOString(),
						updated_at: new Date().toISOString(),
						started_at: new Date().toISOString(),
					},
					role_decision: { source: "explicit_stage", selected_role_id: "superpowers:implementer", confidence: 1 },
					contract_validation: { passed: true },
					model_binding: {
						configured_selector: "openai/gpt-5.3-codex:high",
						provider: "openai",
						model_id: "gpt-5.3-codex",
						binding_hash: "hash-b",
					},
					actual: { exact_match: true },
				},
				acceptingDir,
			),
		).rejects.toThrow(/(binding|hash|immutable)/i);

		// Assert on-disk evidence was NOT mutated by the rejected transition.
		const evidencePath = join(acceptingDir, "tasks", taskId, "stages", stageId, "model-routing-evidence.json");
		const content = JSON.parse(await readFile(evidencePath, "utf-8"));
		expect(content.status).toBe("preflight_passed");
		expect(content.model_binding.binding_hash).toBe("hash-a");
	});

	it("writes V2 blocked evidence before throwing on preflight failure", async () => {
		const acceptingDir = freshDir();
		const input = makeInput({
			modelRole: "superpowers:implementer",
			settings: Settings.isolated({ modelRoles: {} }),
			acceptingDir,
			taskId: "T01",
			stageId: "implementer",
		});

		await expect(buildStrictStageExecutionPlan(input)).rejects.toMatchObject({
			code: "role_model_unconfigured",
		});

		// V2 blocked evidence should exist on disk.
		const evidencePath = join(acceptingDir, "tasks", "T01", "stages", "implementer", "model-routing-evidence.json");
		const content = JSON.parse(await readFile(evidencePath, "utf-8"));
		expect(content.status).toBe("blocked");
		expect(content.schema_version).toBe(2);
	});
});
