/**
 * RED — v2 model routing evidence stage-safe atomic writer.
 *
 * Tests that fail because `ModelRoutingEvidenceV2` and
 * `writeModelRoutingEvidenceV2` do not yet exist.  The contract:
 *
 *   - V2 evidence paths: `<dir>/tasks/<taskId>/stages/<stageId>/model-routing-evidence.json`
 *   - Atomic same-dir write (temp + rename)
 *   - Identity guard: no cross-run overwrite (same path, different run_id);
 *     cross-task and cross-stage overwrites are rejected when the
 *     existing artifact at the path claims a different task_id/stage_id
 *     than the incoming evidence expects
 *   - State transitions: `preflight_passed→started|blocked`,
 *     `started→completed|acceptance_failed`; illegal jumps are rejected
 *     and leave the original artifact intact
 *   - Acceptance extends `validateModelRoutingEvidenceForAcceptance` to handle v2:
 *     requires `actual.exact_match === true`, rejects actual.fallback_used,
 *     actual.parent_model_used, actual.context_promotion_used, missing actual,
 *     and missing resolved_model
 *   - v1 read compatibility preserved (same acceptance function validates both)
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

// v1 import — exists, will resolve
import { validateModelRoutingEvidenceForAcceptance } from "../../src/codex-plan-run/model-routing-evidence";

// v2 imports — do NOT exist yet → RED evidence
import {
	type ModelRoutingEvidenceV2,
	writeModelRoutingEvidenceV2,
} from "../../src/codex-plan-run/model-routing-evidence";

// ── Fixture helpers ─────────────────────────────────────────────────────

function makeEvidence(overrides: Omit<Partial<ModelRoutingEvidenceV2>, "run_id" | "task_id" | "stage_id"> & { run_id: string; task_id: string; stage_id: string }): ModelRoutingEvidenceV2 {
	const { run_id, task_id, stage_id, ...rest } = overrides;
	return {
		schema_version: 2,
		run_id,
		task_id,
		stage_id,
		status: "completed",
		agent_id: "agent-007",
		model_role: "superpowers:tdd-writer",
		requested_model: "anthropic/claude-sonnet-4",
		resolved_model: "anthropic/claude-sonnet-4-20250514",
		fallback_roles: [],
		fallback_used: false,
		model_overrides: [],
		service_tier: "default",
		thinking_level: "high",
		timestamps: {
			created_at: "2026-07-10T00:00:00.000Z",
			updated_at: "2026-07-10T00:01:00.000Z",
			started_at: "2026-07-10T00:00:00.000Z",
			completed_at: "2026-07-10T00:01:00.000Z",
		},
		role_decision: {
			decision_id: "dec-001",
			source: "explicit_stage",
			selected_role_id: "superpowers:tdd-writer",
			confidence: 0.95,
			candidates: [
				{ role_id: "superpowers:tdd-writer", confidence: 0.95, reason: "Matching skill evidence" },
				{ role_id: "superpowers:task", confidence: 0.7, reason: "Fallback role" },
			],
			reasons: ["Matching skill evidence for task T02"],
			advisor: { model: "anthropic/claude-sonnet-4-20250514", result: "approved" },
		},
		contract_validation: {
			contract_version: "v2",
			passed: true,
			checks: [
				{ code: "role_exists", passed: true, message: "Required role is defined" },
				{ code: "contract_complete", passed: true, message: "All contract clauses satisfied" },
				{ code: "capabilities_satisfied", passed: true, message: "Model meets capability requirements" },
			],
		},
		model_binding: {
			configured_selector: "default",
			provider: "anthropic",
			model_id: "claude-sonnet-4-20250514",
			thinking_source: "explicit",
			thinking_level: "high",
			binding_hash: "abc123def456",
		},
		actual: {
			exact_match: true,
			fallback_used: false,
			parent_model_used: false,
			context_promotion_used: false,
			provider: "anthropic",
			model_id: "claude-sonnet-4-20250514",
			thinking_level: "high",
			session_created: true,
			first_dispatch: true,
		},
		error: { code: "none", message: "" },
		...rest,
	};
}

// ── Suite ───────────────────────────────────────────────────────────────

describe("Model routing evidence v2", () => {
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "model-routing-evidence-v2-test-"));
	});

	afterEach(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	// -----------------------------------------------------------------------
	// Path uniqueness
	// -----------------------------------------------------------------------

	it("writes evidence to unique paths for different stages", async () => {
		const a = makeEvidence({ run_id: "R1", task_id: "T02", stage_id: "stageA" });
		const b = makeEvidence({ run_id: "R1", task_id: "T02", stage_id: "stageB" });

		const pathA = await writeModelRoutingEvidenceV2(a, tmpDir);
		const pathB = await writeModelRoutingEvidenceV2(b, tmpDir);

		expect(pathA).toBe(join(tmpDir, "tasks", "T02", "stages", "stageA", "model-routing-evidence.json"));
		expect(pathB).toBe(join(tmpDir, "tasks", "T02", "stages", "stageB", "model-routing-evidence.json"));
		expect(pathA).not.toBe(pathB);

		const contentA = JSON.parse(await readFile(pathA, "utf-8"));
		expect(contentA.stage_id).toBe("stageA");

		const contentB = JSON.parse(await readFile(pathB, "utf-8"));
		expect(contentB.stage_id).toBe("stageB");
	});

	// -----------------------------------------------------------------------
	// Identity guard — cross-run
	//
	// Same task+stage → same path.  The writer reads the existing artifact,
	// notices run_id differs from the incoming evidence, and rejects.
	// -----------------------------------------------------------------------

	it("rejects cross-run overwrite at the same stage path", async () => {
		const first = makeEvidence({ run_id: "R1", task_id: "T02", stage_id: "S1" });
		const path = await writeModelRoutingEvidenceV2(first, tmpDir);

		const rawBefore = await readFile(path, "utf-8");

		const second = makeEvidence({ run_id: "R2", task_id: "T02", stage_id: "S1" });
		await expect(writeModelRoutingEvidenceV2(second, tmpDir)).rejects.toThrow();

		// Artifact byte-for-byte unchanged
		const rawAfter = await readFile(path, "utf-8");
		expect(rawAfter).toBe(rawBefore);
	});

	// -----------------------------------------------------------------------
	// Identity guard — cross-task
	//
	// Manually seed a file at the writer's target path (T99/S1) with a JSON
	// body claiming task_id: "T02".  The writer reads the existing artifact,
	// detects the task_id mismatch, and rejects.
	// -----------------------------------------------------------------------

	it("rejects cross-task overwrite: seeded artifact claims different task_id", async () => {
		const seedDir = join(tmpDir, "tasks", "T99", "stages", "S1");
		await mkdir(seedDir, { recursive: true });
		const seedPath = join(seedDir, "model-routing-evidence.json");
		await writeFile(
			seedPath,
			`${JSON.stringify({ schema_version: 2, run_id: "R1", task_id: "T02", stage_id: "S1", status: "preflight_passed", resolved_model: "seeded-model" }, null, 2)}\n`,
		);

		const rawBefore = await readFile(seedPath, "utf-8");

		// Writer derives tasks/T99/stages/S1/ — same path as the seeded file
		const incoming = makeEvidence({ run_id: "R1", task_id: "T99", stage_id: "S1" });
		await expect(writeModelRoutingEvidenceV2(incoming, tmpDir)).rejects.toThrow();

		// Seeded artifact byte-for-byte unchanged
		const rawAfter = await readFile(seedPath, "utf-8");
		expect(rawAfter).toBe(rawBefore);
	});

	// -----------------------------------------------------------------------
	// Identity guard — cross-stage
	//
	// Seed a file at T02/S2 path with a body claiming stage_id: "S1".
	// Writer for T02/S2 detects stage_id mismatch and rejects.
	// -----------------------------------------------------------------------

	it("rejects cross-stage overwrite: seeded artifact claims different stage_id", async () => {
		const seedDir = join(tmpDir, "tasks", "T02", "stages", "S2");
		await mkdir(seedDir, { recursive: true });
		const seedPath = join(seedDir, "model-routing-evidence.json");
		await writeFile(
			seedPath,
			`${JSON.stringify({ schema_version: 2, run_id: "R1", task_id: "T02", stage_id: "S1", status: "preflight_passed", resolved_model: "seeded-model" }, null, 2)}\n`,
		);

		const rawBefore = await readFile(seedPath, "utf-8");

		// Writer derives tasks/T02/stages/S2/ — same path as the seeded file
		const incoming = makeEvidence({ run_id: "R1", task_id: "T02", stage_id: "S2" });
		await expect(writeModelRoutingEvidenceV2(incoming, tmpDir)).rejects.toThrow();

		const rawAfter = await readFile(seedPath, "utf-8");
		expect(rawAfter).toBe(rawBefore);
	});

	it("allows same-identity overwrite (same run+task+stage)", async () => {
		const first = makeEvidence({ run_id: "R1", task_id: "T02", stage_id: "S1", status: "preflight_passed" });
		await writeModelRoutingEvidenceV2(first, tmpDir);

		const second = makeEvidence({ run_id: "R1", task_id: "T02", stage_id: "S1", status: "started" });
		await expect(writeModelRoutingEvidenceV2(second, tmpDir)).resolves.toBeString();
	});

	// -----------------------------------------------------------------------
	// State transitions
	// -----------------------------------------------------------------------

	it("allows valid transition: preflight_passed → started", async () => {
		const first = makeEvidence({ run_id: "R1", task_id: "T02", stage_id: "S1", status: "preflight_passed" });
		await writeModelRoutingEvidenceV2(first, tmpDir);

		const next = makeEvidence({ run_id: "R1", task_id: "T02", stage_id: "S1", status: "started" });
		await expect(writeModelRoutingEvidenceV2(next, tmpDir)).resolves.toBeString();
	});

	it("allows valid transition: preflight_passed → blocked", async () => {
		const first = makeEvidence({ run_id: "R1", task_id: "T02", stage_id: "S1", status: "preflight_passed" });
		await writeModelRoutingEvidenceV2(first, tmpDir);

		const next = makeEvidence({ run_id: "R1", task_id: "T02", stage_id: "S1", status: "blocked" });
		await expect(writeModelRoutingEvidenceV2(next, tmpDir)).resolves.toBeString();
	});

	it("allows valid transition: started → completed", async () => {
		const first = makeEvidence({ run_id: "R1", task_id: "T02", stage_id: "S1", status: "started" });
		await writeModelRoutingEvidenceV2(first, tmpDir);

		const next = makeEvidence({ run_id: "R1", task_id: "T02", stage_id: "S1", status: "completed" });
		await expect(writeModelRoutingEvidenceV2(next, tmpDir)).resolves.toBeString();
	});

	it("allows valid transition: started → acceptance_failed", async () => {
		const first = makeEvidence({ run_id: "R1", task_id: "T02", stage_id: "S1", status: "started" });
		await writeModelRoutingEvidenceV2(first, tmpDir);

		const next = makeEvidence({ run_id: "R1", task_id: "T02", stage_id: "S1", status: "acceptance_failed" });
		await expect(writeModelRoutingEvidenceV2(next, tmpDir)).resolves.toBeString();
	});

	it("rejects illegal transition: preflight_passed → completed (skipped started)", async () => {
		const first = makeEvidence({ run_id: "R1", task_id: "T02", stage_id: "S1", status: "preflight_passed" });
		await writeModelRoutingEvidenceV2(first, tmpDir);

		const illegal = makeEvidence({ run_id: "R1", task_id: "T02", stage_id: "S1", status: "completed" });
		await expect(writeModelRoutingEvidenceV2(illegal, tmpDir)).rejects.toThrow();
	});

	it("rejects illegal transition: preflight_passed → acceptance_failed (skipped started)", async () => {
		const first = makeEvidence({ run_id: "R1", task_id: "T02", stage_id: "S1", status: "preflight_passed" });
		await writeModelRoutingEvidenceV2(first, tmpDir);

		const illegal = makeEvidence({ run_id: "R1", task_id: "T02", stage_id: "S1", status: "acceptance_failed" });
		await expect(writeModelRoutingEvidenceV2(illegal, tmpDir)).rejects.toThrow();
	});

	it("rejects illegal transition: started → preflight_passed (regression)", async () => {
		const first = makeEvidence({ run_id: "R1", task_id: "T02", stage_id: "S1", status: "started" });
		await writeModelRoutingEvidenceV2(first, tmpDir);

		const illegal = makeEvidence({ run_id: "R1", task_id: "T02", stage_id: "S1", status: "preflight_passed" });
		await expect(writeModelRoutingEvidenceV2(illegal, tmpDir)).rejects.toThrow();
	});

	it("leaves artifact unchanged on illegal state transition attempt", async () => {
		const original = makeEvidence({ run_id: "R1", task_id: "T02", stage_id: "S1", status: "preflight_passed", resolved_model: "should-stay" });
		const path = await writeModelRoutingEvidenceV2(original, tmpDir);

		const rawBefore = await readFile(path, "utf-8");

		const illegal = makeEvidence({ run_id: "R1", task_id: "T02", stage_id: "S1", status: "acceptance_failed", resolved_model: "should-never-appear" });
		await expect(writeModelRoutingEvidenceV2(illegal, tmpDir)).rejects.toThrow();

		// Byte-for-byte unchanged
		const rawAfter = await readFile(path, "utf-8");
		expect(rawAfter).toBe(rawBefore);
	});

	// -----------------------------------------------------------------------
	// Acceptance validation — v2 extended checks
	// -----------------------------------------------------------------------

	it("validates acceptance when actual.exact_match is true and all flags clean", () => {
		const evidence = makeEvidence({
			run_id: "R1", task_id: "T02", stage_id: "S1",
			actual: { exact_match: true, fallback_used: false, parent_model_used: false, context_promotion_used: false, provider: "anthropic", model_id: "claude-sonnet-4-20250514", thinking_level: "high", session_created: true, first_dispatch: true },
		});
		const errors = validateModelRoutingEvidenceForAcceptance(evidence);
		expect(errors).toEqual([]);
	});

	it("rejects acceptance when actual.exact_match is false", () => {
		const evidence = makeEvidence({
			run_id: "R2", task_id: "T02", stage_id: "S1",
			actual: { exact_match: false, fallback_used: false, parent_model_used: false, context_promotion_used: false, provider: "anthropic", model_id: "claude-sonnet-4-20250514", thinking_level: "high", session_created: true, first_dispatch: true },
		});
		const errors = validateModelRoutingEvidenceForAcceptance(evidence);
		expect(errors).not.toEqual([]);
		expect(errors.join(" ")).toMatch(/exact/i);
	});

	it("rejects acceptance when actual.fallback_used is true", () => {
		const evidence = makeEvidence({
			run_id: "R1", task_id: "T02", stage_id: "S1",
			actual: { exact_match: true, fallback_used: true, parent_model_used: false, context_promotion_used: false, provider: "anthropic", model_id: "claude-sonnet-4-20250514", thinking_level: "high", session_created: true, first_dispatch: true },
		});
		const errors = validateModelRoutingEvidenceForAcceptance(evidence);
		expect(errors).not.toEqual([]);
		expect(errors.join(" ")).toMatch(/fallback/i);
	});

	it("rejects acceptance when actual.parent_model_used is true", () => {
		const evidence = makeEvidence({
			run_id: "R1", task_id: "T02", stage_id: "S1",
			actual: { exact_match: true, fallback_used: false, parent_model_used: true, context_promotion_used: false, provider: "anthropic", model_id: "claude-sonnet-4-20250514", thinking_level: "high", session_created: true, first_dispatch: true },
		});
		const errors = validateModelRoutingEvidenceForAcceptance(evidence);
		expect(errors).not.toEqual([]);
		expect(errors.join(" ")).toMatch(/parent/i);
	});

	it("rejects acceptance when actual.context_promotion_used is true", () => {
		const evidence = makeEvidence({
			run_id: "R1", task_id: "T02", stage_id: "S1",
			actual: { exact_match: true, fallback_used: false, parent_model_used: false, context_promotion_used: true, provider: "anthropic", model_id: "claude-sonnet-4-20250514", thinking_level: "high", session_created: true, first_dispatch: true },
		});
		const errors = validateModelRoutingEvidenceForAcceptance(evidence);
		expect(errors).not.toEqual([]);
		expect(errors.join(" ")).toMatch(/promotion/i);
	});

	it("rejects acceptance when actual is missing for completed v2 evidence", () => {
		const evidence = JSON.parse(JSON.stringify({
			schema_version: 2,
			run_id: "R1",
			task_id: "T02",
			stage_id: "S1",
			status: "completed",
			resolved_model: "anthropic/claude-sonnet-4-20250514",
		}));
		const errors = validateModelRoutingEvidenceForAcceptance(evidence);
		expect(errors).not.toEqual([]);
		expect(errors.join(" ")).toMatch(/actual/i);
	});

	it("rejects acceptance when resolved_model is null for role-bound v2 evidence", () => {
		const evidence = makeEvidence({
			run_id: "R1", task_id: "T02", stage_id: "S1",
			resolved_model: null,
			actual: { exact_match: true, fallback_used: false, parent_model_used: false, context_promotion_used: false, provider: "anthropic", model_id: "claude-sonnet-4-20250514", thinking_level: "high", session_created: true, first_dispatch: true },
		});
		const errors = validateModelRoutingEvidenceForAcceptance(evidence);
		expect(errors).not.toEqual([]);
		expect(errors.join(" ")).toMatch(/resolved/i);
	});

	it("rejects acceptance when resolved_model is undefined for role-bound v2 evidence", () => {
		const evidence = makeEvidence({
			run_id: "R1", task_id: "T02", stage_id: "S1",
			resolved_model: undefined,
			actual: { exact_match: true, fallback_used: false, parent_model_used: false, context_promotion_used: false, provider: "anthropic", model_id: "claude-sonnet-4-20250514", thinking_level: "high", session_created: true, first_dispatch: true },
		});
		const errors = validateModelRoutingEvidenceForAcceptance(evidence);
		expect(errors).not.toEqual([]);
		expect(errors.join(" ")).toMatch(/resolved/i);
	});

	// -----------------------------------------------------------------------
	// v1 read compatibility — same acceptance function validates v1 schema
	// -----------------------------------------------------------------------

	it("validates v1 schema evidence with the same acceptance function (compatibility)", () => {
		const v1Evidence = {
			schema_version: 1,
			run_id: "R1",
			task_id: "T02",
			model_role: "superpowers:tdd-writer",
			resolved_model: "anthropic/claude-sonnet-4-20250514",
		};
		const errors = validateModelRoutingEvidenceForAcceptance(v1Evidence);
		expect(errors).toEqual([]);
	});

	it("validates v1 evidence with role and null resolved_model via same function", () => {
		const v1Evidence = {
			schema_version: 1,
			run_id: "R1",
			task_id: "T02",
			model_role: "superpowers:tdd-writer",
			resolved_model: null,
		};
		const errors = validateModelRoutingEvidenceForAcceptance(v1Evidence);
		expect(errors).not.toEqual([]);
		expect(errors.join(" ")).toMatch(/resolved/i);
	});

	// =======================================================================
	// RED — Spec P1: required structured fields, timestamps, acceptance gates
	//
	// Uses a canonical valid fixture; each case removes/corrupts exactly one
	// field via safe destructuring so failure isolates to that check.
	//
	// Optional fields (started_at, completed_at, advisor, first_dispatch,
	// error) are tested for round-trip preservation rather than rejection.
	//
	// These tests FAIL because `validateModelRoutingEvidenceForAcceptance`
	// does not yet enforce:
	//   - timestamps.{created_at,updated_at}
	//   - role_decision.{decision_id,source,selected_role_id,confidence,candidates,reasons}
	//   - contract_validation.{contract_version,passed,checks}
	//   - model_binding.{configured_selector,provider,model_id,thinking_source,binding_hash}
	//   - actual.{provider,model_id,thinking_level,session_created}
	//   - status === "completed" required for acceptance
	//   - contract_validation.passed === true
	//   - model_binding fields equal to actual fields
	//   - thinking consistency
	//   - writer falls back to task-level path when stage_id is absent
	//   - actual is optional for non-completed evidence
	// =======================================================================

	/** Omit one key from an object using safe destructuring. */
	function omitField<T, K extends keyof T>(obj: T, key: K): Omit<T, K> {
		const { [key]: _omit, ...rest } = obj;
		return rest;
	}

	/** Canonical fully-valid v2 evidence with all Spec P1 structured fields. */
	function fullV2Evidence(): ModelRoutingEvidenceV2 {
		return {
			schema_version: 2,
			run_id: "R1",
			task_id: "T02",
			stage_id: "S1",
			status: "completed",
			agent_id: "agent-007",
			model_role: "superpowers:tdd-writer",
			requested_model: "anthropic/claude-sonnet-4",
			resolved_model: "anthropic/claude-sonnet-4-20250514",
			fallback_roles: [],
			fallback_used: false,
			model_overrides: [],
			service_tier: "default",
			thinking_level: "high",
			timestamps: {
				created_at: "2026-07-10T00:00:00.000Z",
				updated_at: "2026-07-10T00:01:00.000Z",
				started_at: "2026-07-10T00:00:00.000Z",
				completed_at: "2026-07-10T00:01:00.000Z",
			},
			role_decision: {
				decision_id: "dec-001",
				source: "explicit_stage",
				selected_role_id: "superpowers:tdd-writer",
				confidence: 0.95,
				candidates: [
					{ role_id: "superpowers:tdd-writer", confidence: 0.95, reason: "Matching skill evidence" },
					{ role_id: "superpowers:task", confidence: 0.7, reason: "Fallback role" },
				],
				reasons: ["Matching skill evidence for task T02"],
				advisor: { model: "anthropic/claude-sonnet-4-20250514", result: "approved" },
			},
			contract_validation: {
				contract_version: "v2",
				passed: true,
				checks: [
					{ code: "role_exists", passed: true, message: "Required role is defined" },
					{ code: "contract_complete", passed: true, message: "All contract clauses satisfied" },
					{ code: "capabilities_satisfied", passed: true, message: "Model meets capability requirements" },
				],
			},
			model_binding: {
				configured_selector: "default",
				provider: "anthropic",
				model_id: "claude-sonnet-4-20250514",
				thinking_source: "explicit",
				thinking_level: "high",
				binding_hash: "abc123def456",
			},
			actual: {
				exact_match: true,
				fallback_used: false,
				parent_model_used: false,
				context_promotion_used: false,
				provider: "anthropic",
				model_id: "claude-sonnet-4-20250514",
				thinking_level: "high",
				session_created: true,
				first_dispatch: true,
			},
			error: { code: "none", message: "" },
		};
	}

	describe("RED — Spec P1 structured fields and acceptance gates", () => {
		// ── stage_id optional ─────────────────────────────────────────

		it("writer falls back to task-level path when stage_id is absent", async () => {
			const { stage_id: _s, ...evidence } = fullV2Evidence();
			const path = await writeModelRoutingEvidenceV2(evidence, tmpDir);
			expect(path).toBe(join(tmpDir, "tasks", "T02", "model-routing-evidence.json"));
		});

		it("writer uses stage-scoped path when stage_id is present", async () => {
			const evidence = fullV2Evidence();
			const path = await writeModelRoutingEvidenceV2(evidence, tmpDir);
			expect(path).toBe(join(tmpDir, "tasks", "T02", "stages", "S1", "model-routing-evidence.json"));
		});

		// ── actual optional for non-completed ─────────────────────────

		it("accepts non-completed evidence without actual field", () => {
			const { actual: _a, ...evidence } = fullV2Evidence();
			evidence.status = "preflight_passed";
			const errors = validateModelRoutingEvidenceForAcceptance(evidence);
			expect(errors).toEqual([]);
		});

		it("rejects completed evidence without actual field", () => {
			const { actual: _a, ...evidence } = fullV2Evidence();
			const errors = validateModelRoutingEvidenceForAcceptance(evidence);
			expect(errors).not.toEqual([]);
			expect(errors.join(" ")).toMatch(/actual/i);
		});

		// ── root timestamps ───────────────────────────────────────────

		it("rejects acceptance when timestamps is missing", () => {
			const evidence = JSON.parse(JSON.stringify(omitField(fullV2Evidence(), "timestamps")));
			const errors = validateModelRoutingEvidenceForAcceptance(evidence);
			expect(errors).not.toEqual([]);
			expect(errors.join(" ")).toMatch(/created_at/i);
		});

		it("rejects acceptance when timestamps.updated_at is missing", () => {
			const evidence = fullV2Evidence();
			evidence.timestamps = omitField(evidence.timestamps!, "updated_at");
			const errors = validateModelRoutingEvidenceForAcceptance(evidence);
			expect(errors).not.toEqual([]);
			expect(errors.join(" ")).toMatch(/updated_at/i);
		});

		// ── optional timestamps round-trip ────────────────────────────

		it("preserves started_at and completed_at through write/read round-trip", async () => {
			const evidence = fullV2Evidence();
			const path = await writeModelRoutingEvidenceV2(evidence, tmpDir);
			const saved = JSON.parse(await readFile(path, "utf-8"));
			expect(saved.timestamps.started_at).toBe("2026-07-10T00:00:00.000Z");
			expect(saved.timestamps.completed_at).toBe("2026-07-10T00:01:00.000Z");
		});

		// ── role_decision fields ──────────────────────────────────────

		it("rejects acceptance when role_decision is missing", () => {
			const evidence = JSON.parse(JSON.stringify(omitField(fullV2Evidence(), "role_decision")));
			const errors = validateModelRoutingEvidenceForAcceptance(evidence);
			expect(errors).not.toEqual([]);
			expect(errors.join(" ")).toMatch(/role_decision|decision_id|selected_role_id/i);
		});

		it("rejects acceptance when role_decision.decision_id is missing", () => {
			const evidence = fullV2Evidence();
			evidence.role_decision = omitField(evidence.role_decision!, "decision_id");
			const errors = validateModelRoutingEvidenceForAcceptance(evidence);
			expect(errors).not.toEqual([]);
			expect(errors.join(" ")).toMatch(/decision_id/i);
		});

		it("rejects acceptance when role_decision.selected_role_id is missing", () => {
			const evidence = fullV2Evidence();
			evidence.role_decision = omitField(evidence.role_decision!, "selected_role_id");
			const errors = validateModelRoutingEvidenceForAcceptance(evidence);
			expect(errors).not.toEqual([]);
			expect(errors.join(" ")).toMatch(/selected_role_id/i);
		});

		// ── optional advisor round-trip ───────────────────────────────

		it("preserves role_decision.advisor through write/read round-trip", async () => {
			const evidence = fullV2Evidence();
			const path = await writeModelRoutingEvidenceV2(evidence, tmpDir);
			const saved = JSON.parse(await readFile(path, "utf-8"));
			expect(saved.role_decision.advisor).toEqual({ model: "anthropic/claude-sonnet-4-20250514", result: "approved" });
		});

		// ── contract_validation fields ────────────────────────────────

		it("rejects acceptance when contract_validation is missing", () => {
			const evidence = JSON.parse(JSON.stringify(omitField(fullV2Evidence(), "contract_validation")));
			const errors = validateModelRoutingEvidenceForAcceptance(evidence);
			expect(errors).not.toEqual([]);
			expect(errors.join(" ")).toMatch(/contract_validation|contract_version|passed/i);
		});

		it("rejects acceptance when contract_validation.contract_version is missing", () => {
			const evidence = fullV2Evidence();
			evidence.contract_validation = omitField(evidence.contract_validation!, "contract_version");
			const errors = validateModelRoutingEvidenceForAcceptance(evidence);
			expect(errors).not.toEqual([]);
			expect(errors.join(" ")).toMatch(/contract_version/i);
		});

		it("rejects acceptance when contract_validation.checks is missing", () => {
			const evidence = fullV2Evidence();
			evidence.contract_validation = omitField(evidence.contract_validation!, "checks");
			const errors = validateModelRoutingEvidenceForAcceptance(evidence);
			expect(errors).not.toEqual([]);
			expect(errors.join(" ")).toMatch(/checks/i);
		});

		// ── model_binding fields ──────────────────────────────────────

		it("rejects acceptance when model_binding is missing", () => {
			const evidence = JSON.parse(JSON.stringify(omitField(fullV2Evidence(), "model_binding")));
			const errors = validateModelRoutingEvidenceForAcceptance(evidence);
			expect(errors).not.toEqual([]);
			expect(errors.join(" ")).toMatch(/model_binding|configured_selector|model_id|binding_hash/i);
		});

		it("rejects acceptance when model_binding.binding_hash is missing", () => {
			const evidence = fullV2Evidence();
			evidence.model_binding = omitField(evidence.model_binding!, "binding_hash");
			const errors = validateModelRoutingEvidenceForAcceptance(evidence);
			expect(errors).not.toEqual([]);
			expect(errors.join(" ")).toMatch(/binding_hash/i);
		});

		it("rejects acceptance when model_binding.configured_selector is missing", () => {
			const evidence = fullV2Evidence();
			evidence.model_binding = omitField(evidence.model_binding!, "configured_selector");
			const errors = validateModelRoutingEvidenceForAcceptance(evidence);
			expect(errors).not.toEqual([]);
			expect(errors.join(" ")).toMatch(/configured_selector/i);
		});

		// ── actual extended fields ────────────────────────────────────

		it("rejects acceptance when actual.provider is missing", () => {
			const evidence = fullV2Evidence();
			evidence.actual = omitField(evidence.actual!, "provider");
			const errors = validateModelRoutingEvidenceForAcceptance(evidence);
			expect(errors).not.toEqual([]);
			expect(errors.join(" ")).toMatch(/provider/i);
		});

		it("rejects acceptance when actual.model_id is missing", () => {
			const evidence = fullV2Evidence();
			evidence.actual = omitField(evidence.actual!, "model_id");
			const errors = validateModelRoutingEvidenceForAcceptance(evidence);
			expect(errors).not.toEqual([]);
			expect(errors.join(" ")).toMatch(/model_id/i);
		});

		it("rejects acceptance when actual.thinking_level is missing", () => {
			const evidence = fullV2Evidence();
			evidence.actual = omitField(evidence.actual!, "thinking_level");
			const errors = validateModelRoutingEvidenceForAcceptance(evidence);
			expect(errors).not.toEqual([]);
			expect(errors.join(" ")).toMatch(/thinking_level/i);
		});

		it("rejects acceptance when actual.session_created is missing", () => {
			const evidence = fullV2Evidence();
			evidence.actual = omitField(evidence.actual!, "session_created");
			const errors = validateModelRoutingEvidenceForAcceptance(evidence);
			expect(errors).not.toEqual([]);
			expect(errors.join(" ")).toMatch(/session_created/i);
		});

		// ── optional first_dispatch round-trip ────────────────────────

		it("preserves actual.first_dispatch through write/read round-trip", async () => {
			const evidence = fullV2Evidence();
			const path = await writeModelRoutingEvidenceV2(evidence, tmpDir);
			const saved = JSON.parse(await readFile(path, "utf-8"));
			expect(saved.actual.first_dispatch).toBe(true);
		});

		// ── optional error field round-trip ───────────────────────────

		it("preserves top-level error through write/read round-trip", async () => {
			const evidence = fullV2Evidence();
			const path = await writeModelRoutingEvidenceV2(evidence, tmpDir);
			const saved = JSON.parse(await readFile(path, "utf-8"));
			expect(saved.error).toEqual({ code: "none", message: "" });
		});

		// ── Acceptance gates ──────────────────────────────────────────

		it("rejects acceptance when status is not 'completed'", () => {
			const evidence = fullV2Evidence();
			evidence.status = "preflight_passed";
			const errors = validateModelRoutingEvidenceForAcceptance(evidence);
			expect(errors).not.toEqual([]);
			expect(errors.join(" ")).toMatch(/completed|status/i);
		});

		it("rejects acceptance when contract_validation.passed is false", () => {
			const evidence = fullV2Evidence();
			evidence.contract_validation!.passed = false;
			const errors = validateModelRoutingEvidenceForAcceptance(evidence);
			expect(errors).not.toEqual([]);
			expect(errors.join(" ")).toMatch(/passed/i);
		});

		it("rejects acceptance when model_binding provider does not match actual provider", () => {
			const evidence = fullV2Evidence();
			evidence.model_binding!.provider = "openai";
			const errors = validateModelRoutingEvidenceForAcceptance(evidence);
			expect(errors).not.toEqual([]);
			expect(errors.join(" ")).toMatch(/provider|mismatch/i);
		});

		it("rejects acceptance when model_binding model_id does not match actual model_id", () => {
			const evidence = fullV2Evidence();
			evidence.model_binding!.model_id = "gpt-4";
			const errors = validateModelRoutingEvidenceForAcceptance(evidence);
			expect(errors).not.toEqual([]);
			expect(errors.join(" ")).toMatch(/model_id|mismatch/i);
		});

		it("rejects acceptance when thinking_level is inconsistent between model_binding and actual", () => {
			const evidence = fullV2Evidence();
			evidence.model_binding!.thinking_level = "low";
			const errors = validateModelRoutingEvidenceForAcceptance(evidence);
			expect(errors).not.toEqual([]);
			expect(errors.join(" ")).toMatch(/thinking/i);
		});

		// ── RED: optional field acceptance (validator must not reject) ─

		it("accepts completed evidence without optional first_dispatch", () => {
			const evidence = JSON.parse(JSON.stringify(fullV2Evidence()));
			delete evidence.actual.first_dispatch;
			const errors = validateModelRoutingEvidenceForAcceptance(evidence);
			expect(errors).toEqual([]);
		});

		it("accepts completed evidence without optional error field", () => {
			const evidence = JSON.parse(JSON.stringify(fullV2Evidence()));
			delete evidence.error;
			const errors = validateModelRoutingEvidenceForAcceptance(evidence);
			expect(errors).toEqual([]);
		});

		it("accepts completed evidence without optional timestamps.started_at and completed_at", () => {
			const evidence = JSON.parse(JSON.stringify(fullV2Evidence()));
			delete evidence.timestamps.started_at;
			delete evidence.timestamps.completed_at;
			const errors = validateModelRoutingEvidenceForAcceptance(evidence);
			expect(errors).toEqual([]);
		});

		it("accepts completed evidence without optional role_decision.advisor", () => {
			const evidence = JSON.parse(JSON.stringify(fullV2Evidence()));
			delete evidence.role_decision.advisor;
			const errors = validateModelRoutingEvidenceForAcceptance(evidence);
			expect(errors).toEqual([]);
		});

		// ── RED: task-level v2 over pre-existing v1 ───────────────────

		it("writing task-level v2 over pre-existing v1 does not TypeError", async () => {
			// Seed a v1 evidence file at the task-level path
			const v1Dir = join(tmpDir, "tasks", "T02");
			await mkdir(v1Dir, { recursive: true });
			const v1Path = join(v1Dir, "model-routing-evidence.json");
			await writeFile(v1Path, `${JSON.stringify({ schema_version: 1, run_id: "R1", task_id: "T02", resolved_model: "anthropic/claude-sonnet-4-20250514" }, null, 2)}\n`);

			// Write v2 evidence without stage_id to the same task-level path.
			// Must not throw TypeError; should follow explicit migration behavior.
			const { stage_id: _s, ...evidence } = fullV2Evidence();
			const path = await writeModelRoutingEvidenceV2(evidence, tmpDir);
			expect(path).toBe(v1Path);

			// The written file should be parseable and have schema_version 2
			const saved = JSON.parse(await readFile(path, "utf-8"));
			expect(saved.schema_version).toBe(2);
		});
	});
});
