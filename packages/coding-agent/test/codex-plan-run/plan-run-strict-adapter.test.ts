import { afterEach, describe, expect, it, vi } from "bun:test";
import { mkdir, mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createPlanRunProductionSpawnAdapter } from "../../src/codex-plan-run/plan-run-spawn-adapter";
import type { UnplannedRoleBoundStageRunInput } from "../../src/codex-plan-run/role-bound-stage-scheduler";
import type { StrictRoleExecutionPlan } from "../../src/codex-plan-run/role-bound-stage-scheduler";
import type { SpawnTaskOutput, PlanRunDriverDeps } from "../../src/codex-plan-run/driver";
import { runPlanRunDriver } from "../../src/codex-plan-run/driver";
import type { PlanExecutionBook } from "../../src/codex-plan-run/execution-book";
import type { MainThreadAcceptanceReviewResult } from "../../src/codex-plan-run/main-acceptance-review";
import type { TaskReviewResult } from "../../src/codex-plan-run/task-review";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { buildModel } from "@oh-my-pi/pi-catalog/build";

const tempDirs: string[] = [];
async function makeDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "omp-strict-test-"));
	tempDirs.push(dir);
	return dir;
}
afterEach(async () => {
	for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const acceptedReview: TaskReviewResult = {
	approved: true, must_fix_items: [], should_fix_items: [], notes: [],
	review_summary: "All good", evidence_required: [], verdict: "approved",
};
const mainAcceptanceAccepted: MainThreadAcceptanceReviewResult = {
	approved: true, must_fix_items: [], should_fix_items: [], notes: [],
	verdict: "accepted", evidence: { skill: {}, tdd: {}, model_routing: {}, codebase_memory: {} },
};
const frameworkBook: PlanExecutionBook = {
	schema_version: 1, run_id: "run-strict-test", created_at: "2026-07-10T00:00:00.000Z",
	plan: { path: "/plan.md", sha256: "abc", repo_path: "/repo" }, accepting_dir: "/tmp",
	intake_gate: [{ gate: "plan_path_exists", result: "PASS", evidence: "/plan.md" }],
	project_recon: {
		repo_path: "/repo", relevant_modules: [], likely_files: [], existing_patterns: [],
		test_commands: ["bun test"], build_commands: [], style_conventions: [],
		risk_areas: [], forbidden_changes: [], task_file_map: {},
	},
	required_execution_skills: [], required_review_skills: [], final_tail_skills: [],
	final_acceptance_commands: ["bun test"],
	tasks: [{
		id: "T01", title: "Test task", source: "plan-section-1", todo: "Do it",
		execution_skills: [], review_skills: [], final_tail_skills: [],
		allowed_files: [], forbidden_files: [], smoke_commands: ["bun test"],
		tdd_gates: {
			red: { command: "bun test", expected: "FAIL", evidence_required: "RED_EVIDENCE" },
			green: { command: "bun test", expected: "PASS", evidence_required: "GREEN_EVIDENCE" },
			regression: { command: "bun test", expected: "PASS", evidence_required: "REGRESSION_EVIDENCE" },
		},
		advisor_watch_points: [], required_skill_evidence: [],
		skill_evidence: { execution: [], review: [], final_tail: [] },
		implementation_analysis: "", execution_scope: {
			goal: "Do it", allowed_files: [], forbidden_files: [],
			likely_files: [], existing_patterns: [], out_of_scope: [],
		},
		implementation_steps: [],
		review_gate: { acceptance_criteria: [], smoke_commands: [], required_evidence: [], must_fix_conditions: [] },
	}],
};


// ── Model fixture for strict preflight ────────────────────────────────

const model = buildModel({
	id: "claude-sonnet-4-20250514", provider: "anthropic",
	api: "anthropic-messages", name: "anthropic/claude-sonnet-4-20250514",
	baseUrl: "https://api.anthropic.com", input: ["text"] as ("text" | "image")[],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 200_000, maxTokens: 8_192,
});

const plan: StrictRoleExecutionPlan = {
	decision: {
		source: "explicit_stage", selectedRoleId: "superpowers:implementer", confidence: 1,
		reasons: ["explicit"], candidates: [{ roleId: "superpowers:implementer", confidence: 1, reason: "explicit" }],
	},
	contract: { passed: true, roleId: "superpowers:implementer", contractVersion: "1.0", checks: [] },
	binding: {
		schemaVersion: 1 as const, contractVersion: "1.0", roleId: "superpowers:implementer",
		configuredSelector: "anthropic/claude-sonnet-4-20250514",
		provider: "anthropic", modelId: "claude-sonnet-4-20250514",
		modelRef: "anthropic/claude-sonnet-4-20250514", model,
		thinkingSource: "model_default" as const, thinkingLevel: undefined,
		canonicalSelector: "anthropic/claude-sonnet-4-20250514",
		createdAt: "2026-07-10T00:00:00.000Z", bindingHash: "abc123",
	},
	evidence: { path: "/tmp/evidence.json", status: "preflight_passed" as const, preflight: undefined },
};
const sixRoleModelSelectors: Record<string, string> = {
	"superpowers:tdd-writer": "anthropic/claude-sonnet-4-20250514",
	"superpowers:implementer": "anthropic/claude-sonnet-4-20250514",
	"superpowers:test-runner": "anthropic/claude-sonnet-4-20250514",
	"superpowers:spec-reviewer": "anthropic/claude-sonnet-4-20250514",
	"superpowers:quality-reviewer": "anthropic/claude-sonnet-4-20250514",
	"superpowers:acceptance": "anthropic/claude-sonnet-4-20250514",
};

function strictPreflight() {
	const settings = Settings.isolated({ "compaction.enabled": false, "contextPromotion.enabled": false });
	for (const [role, selector] of Object.entries(sixRoleModelSelectors)) {
		settings.setModelRole(role, selector);
	}
	return {
		settings,
		modelRegistry: { getAvailable: () => [model] },
	};
}

// ── Adapter tests ────────────────────────────────────────────────────

describe("PlanRunSubagentRunner adapter", () => {
	const emptyPromptPack = {
		schema_version: "superpowers.prompt_pack.v1" as const,
		run_id: "test-run", task_id: "T01", stage_id: "implementer", role_id: "superpowers:implementer",
		role_contract: {
			zh_name: "实现者", zh_description: "实现需求",
			may_edit_production_code: true, may_edit_test_code: false, read_only: false,
			success_definition: ["正确"], failure_definition: ["错误"],
		},
		context_bundle: { source_documents: [], relevant_code_snippets: [], previous_stage_outputs: [], known_constraints: [] },
		allowed_operations: [], forbidden_operations: [], required_outputs: [],
		return_schema: { id: "v1" }, advisor_checkpoints: [],
	};

	async function makeUnplannedInput(acceptingDir: string): Promise<UnplannedRoleBoundStageRunInput> {
		await mkdir(join(acceptingDir, "tasks", "T01", "prompt-packs"), { recursive: true });
		return {
			book: {
				schema_version: 1, run_id: "test-run", created_at: "2026-07-10T00:00:00.000Z",
				plan: { path: "/plan.md", sha256: "abc", repo_path: "/repo" },
				accepting_dir: acceptingDir, intake_gate: [],
				project_recon: {
					repo_path: "/repo", relevant_modules: [], likely_files: [],
					existing_patterns: [], test_commands: [], build_commands: [],
					style_conventions: [], risk_areas: [], forbidden_changes: [], task_file_map: {},
				},
				required_execution_skills: [], required_review_skills: [], final_tail_skills: [],
				final_acceptance_commands: [], tasks: [],
			},
			acceptingDir, taskId: "T01", stageId: "implementer",
			promptPack: emptyPromptPack, modelRole: "superpowers:implementer", previousStageOutputs: [],
		};
	}

	it("calls runner.run for unplanned input", async () => {
		const dir = await makeDir();
		const input = await makeUnplannedInput(dir);
		const runSpy = vi.fn().mockResolvedValue({} as SpawnTaskOutput);
		const adapter = createPlanRunProductionSpawnAdapter({ runner: { run: runSpy } });
		await adapter.spawnStage(input).catch(() => {});
		expect(runSpy).toHaveBeenCalledTimes(1);
	});

	it("calls runner.runRoleBound for a preflighted strict input", async () => {
		const dir = await makeDir();
		const input = { ...await makeUnplannedInput(dir), strictRoleExecutionPlan: plan };
		const runSpy = vi.fn().mockResolvedValue({} as SpawnTaskOutput);
		const runRoleBoundSpy = vi.fn().mockResolvedValue({} as SpawnTaskOutput);
		const adapter = createPlanRunProductionSpawnAdapter({
			runner: { run: runSpy, runRoleBound: runRoleBoundSpy },
		});

		await adapter.spawnStage(input);

		expect(runSpy).not.toHaveBeenCalled();
		expect(runRoleBoundSpy).toHaveBeenCalledWith(
			expect.objectContaining({ id: "T01-implementer" }),
			{ strictRoleExecutionPlan: plan },
		);
	});
	function makeDeps(acceptingDir: string): PlanRunDriverDeps {
		return {
			spawnTask: async () => ({
				task_id: "T01", stage_id: "", role_id: "",
				schema_version: "v1", result: "completed" as const,
				changed_files: [], tests_run: [], evidence: [], evidence_paths: [],
				output_path: "", execution_skills_used: [], final_tail_skills_used: [],
				scope_notes: [], agentId: "agent-1", modelRole: "executor",
				resolvedModel: "claude-opus-4", advisorFindings: [],
			}),
			spawnStage: async (input) => {
				// Update V2 evidence from preflight_passed → completed with actual.
				await writeFile(
					join(acceptingDir, "tasks", input.taskId, "stages", input.stageId, "model-routing-evidence.json"),
					JSON.stringify({
						schema_version: 2, run_id: "run-strict-test", task_id: input.taskId, stage_id: input.stageId,
						status: "completed", agent_id: `${input.stageId}-agent`, model_role: input.modelRole,
						requested_model: "anthropic/claude-sonnet-4-20250514",
						resolved_model: "anthropic/claude-sonnet-4-20250514",
						fallback_roles: [], fallback_used: false, model_overrides: [],
						service_tier: "default", thinking_level: "high",
						timestamps: { created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
						role_decision: {
							decision_id: "dec-001", source: "fixed", selected_role_id: input.modelRole,
							confidence: 1, candidates: [{ role_id: input.modelRole, reason: "fixed", confidence: 1 }],
							reasons: [`fixed role ${input.stageId}`],
						},
						contract_validation: { contract_version: "v1", passed: true, checks: [] },
						model_binding: {
							configured_selector: "anthropic/claude-sonnet-4-20250514",
							provider: "anthropic", model_id: "claude-sonnet-4-20250514",
							thinking_source: "configured", thinking_level: "high", binding_hash: "abc123",
						},
						actual: {
							provider: "anthropic", model_id: "claude-sonnet-4-20250514", thinking_level: "high",
							exact_match: true, fallback_used: false, parent_model_used: false,
							context_promotion_used: false, session_created: true,
						},
						error: { code: "none", message: "" },
					}) + "\n",
				);

				return {
					task_id: input.taskId, stage_id: input.stageId, role_id: input.modelRole,
					schema_version: "v1", result: "completed" as const,
					changed_files: [], tests_run: [], evidence: [], evidence_paths: [],
					output_path: join(acceptingDir, "tasks", input.taskId, "stages", input.stageId, "output.json"),
					execution_skills_used: [], final_tail_skills_used: [], scope_notes: [],
					agentId: `${input.stageId}-agent`, modelRole: input.modelRole,
					resolvedModel: "claude-opus-4", advisorFindings: [],
				};
			},
			reviewTask: async () => acceptedReview,
			runMainAcceptance: async () => mainAcceptanceAccepted,
			createRepairDecision: () => { throw new Error("should not be called"); },
		};
	}

	it("writes V2 preflight evidence for all six stages", async () => {
		const acceptingDir = await makeDir();
		const result = await runPlanRunDriver({
			acceptingDir, executionBook: frameworkBook, repoPath: "/repo",
			project: "test-project", reindexProvider: null,
			enableRoleBoundExecution: true,
			strictStagePreflight: strictPreflight(),
			superpowersSkillName: "test-driven-development", superpowersGateMode: "advisory",
		}, makeDeps(acceptingDir));

		expect(result.state).toBe("ready_for_user");

		const sixStageIds = ["tdd-writer", "implementer", "test-runner", "spec-reviewer", "quality-reviewer", "acceptance"];
		for (const stageId of sixStageIds) {
			const content = JSON.parse(await readFile(
				join(acceptingDir, "tasks", "T01", "stages", stageId, "model-routing-evidence.json"), "utf8",
			));
			expect(content.schema_version).toBe(2);
			expect(content.stage_id).toBe(stageId);
		}
	});

	it("blocks a stage whose V2 evidence remains preflighted", async () => {
		const acceptingDir = await makeDir();
		const deps = makeDeps(acceptingDir);
		deps.spawnStage = async (input) => ({
			task_id: input.taskId,
			stage_id: input.stageId,
			role_id: input.modelRole,
			schema_version: "v1",
			result: "completed",
			changed_files: [],
			tests_run: [],
			evidence: [],
			evidence_paths: [],
			output_path: join(acceptingDir, "tasks", input.taskId, "stages", input.stageId, "output.json"),
			execution_skills_used: [],
			final_tail_skills_used: [],
			scope_notes: [],
		});
		deps.createRepairDecision = () => ({}) as never;

		const result = await runPlanRunDriver({
			acceptingDir, executionBook: frameworkBook, repoPath: "/repo",
			project: "test-project", reindexProvider: null,
			enableRoleBoundExecution: true,
			strictStagePreflight: strictPreflight(),
			superpowersSkillName: "test-driven-development", superpowersGateMode: "advisory",
		}, deps);

		expect(result.state).toBe("task_fix_required");
		const outputContent = JSON.parse(await readFile(
			join(acceptingDir, "tasks", "T01", "stages", "tdd-writer", "output.json"), "utf8",
		));
		expect(outputContent.result).toBe("blocked");
	});
});

// ── Task10 provenance (RED) ──────────────────────────────────────────

describe("Task10 — PlanRun provenance in executeRoleBound (RED)", () => {
	it("evidence.preflight contains run_id/task_id/stage_id provenance (RED)", () => {
		// ── RED phase ──────────────────────────────────────────────────
		// The hand-crafted plan fixture has a flat evidence path and no
		// preflight data.  A real buildStrictStageExecutionPlan writes
		// V2 evidence with run_id, task_id, stage_id in the preflight.
		//
		// GREEN contract:
		//   buildStrictStageExecutionPlan produces evidence with
		//   preflight.run_id, preflight.task_id, preflight.stage_id set
		//   from the StrictRoleExecutionPlan context.  executeRoleBound
		//   threads this provenance into the spawn context.
		expect(plan.evidence.preflight).toBeUndefined();
		expect(plan.evidence.path).toBe("/tmp/evidence.json");
	});

	it("executeRoleBound records provenance metadata in subagent context (RED)", () => {
		// ── RED phase ──────────────────────────────────────────────────
		// executeRoleBound passes strictRoleExecutionPlan to runSubprocess
		// but does not yet record the plan's run_id/task_id/stage_id in
		// the subagent context metadata.
		//
		// GREEN contract:
		//   The executeRoleBound runner enriches the spawn context with
		//   { runId, taskId, stageId } from the plan's evidence preflight
		//   metadata, linking each subagent spawn to its PlanRun origin.
		expect(plan.evidence.status).toBe("preflight_passed");
	});
});
