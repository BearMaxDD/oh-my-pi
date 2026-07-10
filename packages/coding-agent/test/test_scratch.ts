import { validateModelRoutingEvidenceForAcceptance } from "../src/codex-plan-run/model-routing-evidence";

const ev = {
	schema_version: 2,
	run_id: "R1",
	task_id: "T02",
	stage_id: "S1",
	status: "completed",
	resolved_model: "anthropic/claude-sonnet-4",
	timestamps: { created_at: "2026-07-10T00:00:00.000Z", updated_at: "2026-07-10T00:01:00.000Z" },
	role_decision: {
		decision_id: "dec-001",
		source: "explicit_stage",
		selected_role_id: "superpowers:tdd-writer",
		confidence: 0.95,
		candidates: [{ role_id: "superpowers:tdd-writer", confidence: 0.95, reason: "Matching" }],
		reasons: ["Matching skill evidence"],
	},
	contract_validation: {
		contract_version: "v2",
		passed: true,
		checks: [{ code: "role_exists", passed: true, message: "OK" }],
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
		exact_match: true as const,
		fallback_used: false,
		parent_model_used: false,
		context_promotion_used: false,
		provider: "anthropic",
		model_id: "claude-sonnet-4-20250514",
		thinking_level: "high",
		session_created: true,
		first_dispatch: true,
	},
};
const errs = validateModelRoutingEvidenceForAcceptance(ev);
console.log("Without advisor, errors:", JSON.stringify(errs));
console.log("BUG present (expect empty):", errs.length > 0);
