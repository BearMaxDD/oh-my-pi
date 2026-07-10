import { describe, expect, it } from "bun:test";
import type { ModelRoutingEvidenceV2 } from "../../src/codex-plan-run/model-routing-evidence";
import { validateModelRoutingEvidenceForAcceptance } from "../../src/codex-plan-run/model-routing-evidence";

const SIX_STAGES = [
	"tdd-writer",
	"implementer",
	"test-runner",
	"spec-reviewer",
	"quality-reviewer",
	"acceptance",
] as const;

function makeV2Evidence(stageId: string): ModelRoutingEvidenceV2 {
	const now = new Date().toISOString();
	return {
		schema_version: 2,
		run_id: "test-run-001",
		task_id: "T01",
		stage_id: stageId,
		status: "completed",
		agent_id: `agent-${stageId}`,
		model_role: `superpowers:${stageId}`,
		requested_model: "anthropic/claude-sonnet-4",
		resolved_model: "anthropic/claude-sonnet-4-20250514",
		fallback_roles: [],
		fallback_used: false,
		model_overrides: [],
		service_tier: "default",
		thinking_level: "high",
		timestamps: { created_at: now, updated_at: now },
		role_decision: {
			decision_id: "dec-001",
			source: "fixed",
			selected_role_id: `superpowers:${stageId}`,
			confidence: 1.0,
			candidates: [{ role_id: `superpowers:${stageId}`, reason: "fixed", confidence: 1.0 }],
			reasons: [`fixed role ${stageId}`],
		},
		contract_validation: {
			contract_version: "v1",
			passed: true,
			checks: [{ code: "ROLE_CONTRACT", message: "pass", passed: true }],
		},
		model_binding: {
			configured_selector: "anthropic/claude-sonnet-4",
			provider: "anthropic",
			model_id: "claude-sonnet-4-20250514",
			thinking_source: "configured",
			thinking_level: "high",
			binding_hash: "abc123",
		},
		actual: {
			provider: "anthropic",
			model_id: "claude-sonnet-4-20250514",
			thinking_level: "high",
			exact_match: true,
			fallback_used: false,
			parent_model_used: false,
			context_promotion_used: false,
			session_created: true,
		},
		error: { code: "none", message: "" },
	};
}

// ── All six stages ───────────────────────────────────────────────────

describe("validateModelRoutingEvidenceForAcceptance — single V2 evidence", () => {
	for (const stageId of SIX_STAGES) {
		it(`accepts valid completed V2 evidence for "${stageId}"`, () => {
			expect(validateModelRoutingEvidenceForAcceptance(makeV2Evidence(stageId))).toEqual([]);
		});
	}

	it("rejects where actual is missing", () => {
		const ev = makeV2Evidence("implementer");
		delete (ev as unknown as Record<string, unknown>).actual;
		const errors = validateModelRoutingEvidenceForAcceptance(ev);
		expect(errors.length).toBeGreaterThan(0);
		expect(errors.some(e => e.includes("actual"))).toBe(true);
	});

	it("rejects where actual.exact_match is false", () => {
		const ev = makeV2Evidence("implementer");
		ev.actual = { ...ev.actual, exact_match: false };
		const errors = validateModelRoutingEvidenceForAcceptance(ev);
		expect(errors.length).toBeGreaterThan(0);
		expect(errors.some(e => e.includes("exact model match"))).toBe(true);
	});

	it("rejects where actual.fallback_used is true", () => {
		const ev = makeV2Evidence("test-runner");
		ev.actual = { ...ev.actual, fallback_used: true };
		const errors = validateModelRoutingEvidenceForAcceptance(ev);
		expect(errors.length).toBeGreaterThan(0);
		expect(errors.some(e => e.includes("fallback"))).toBe(true);
	});

	it("rejects where actual.parent_model_used is true", () => {
		const ev = makeV2Evidence("spec-reviewer");
		ev.actual = { ...ev.actual, parent_model_used: true };
		expect(validateModelRoutingEvidenceForAcceptance(ev).some(e => e.includes("parent model"))).toBe(true);
	});

	it("rejects where actual.context_promotion_used is true", () => {
		const ev = makeV2Evidence("quality-reviewer");
		ev.actual = { ...ev.actual, context_promotion_used: true };
		expect(validateModelRoutingEvidenceForAcceptance(ev).some(e => e.includes("context promotion"))).toBe(true);
	});

	it("rejects where actual.session_created is false", () => {
		const ev = makeV2Evidence("tdd-writer");
		ev.actual = { ...ev.actual, session_created: false };
		expect(validateModelRoutingEvidenceForAcceptance(ev).some(e => e.includes("session_created"))).toBe(true);
	});

	it("rejects where model_binding.provider mismatches actual.provider", () => {
		const ev = makeV2Evidence("implementer");
		ev.model_binding = { ...ev.model_binding, provider: "openai" };
		expect(validateModelRoutingEvidenceForAcceptance(ev).some(e => e.includes("provider"))).toBe(true);
	});

	it("rejects where model_binding.model_id mismatches actual.model_id", () => {
		const ev = makeV2Evidence("tdd-writer");
		ev.model_binding = { ...ev.model_binding, model_id: "gpt-4" };
		expect(validateModelRoutingEvidenceForAcceptance(ev).some(e => e.includes("model_id"))).toBe(true);
	});

	it("rejects with status !== completed", () => {
		const ev = makeV2Evidence("test-runner");
		ev.status = "started";
		const errors = validateModelRoutingEvidenceForAcceptance(ev);
		expect(errors.some(e => e.includes("status") || e.includes("completed"))).toBe(true);
	});

	it("rejects with missing role_decision", () => {
		const ev = makeV2Evidence("spec-reviewer");
		delete (ev as unknown as Record<string, unknown>).role_decision;
		expect(validateModelRoutingEvidenceForAcceptance(ev).some(e => e.includes("role_decision"))).toBe(true);
	});

	it("rejects with missing contract_validation", () => {
		const ev = makeV2Evidence("quality-reviewer");
		delete (ev as unknown as Record<string, unknown>).contract_validation;
		expect(validateModelRoutingEvidenceForAcceptance(ev).some(e => e.includes("contract_validation"))).toBe(true);
	});

	it("rejects with missing model_binding", () => {
		const ev = makeV2Evidence("acceptance");
		delete (ev as unknown as Record<string, unknown>).model_binding;
		expect(validateModelRoutingEvidenceForAcceptance(ev).some(e => e.includes("model_binding"))).toBe(true);
	});
});
