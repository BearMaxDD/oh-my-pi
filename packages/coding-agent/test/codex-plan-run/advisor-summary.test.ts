import { describe, expect, it } from "bun:test";
import { collectUnresolvedAdvisorBlockers, createAdvisorSummary } from "../../src/codex-plan-run/advisor-summary";

describe("advisor summary", () => {
	it("collects unresolved blockers for final acceptance", () => {
		const summary = createAdvisorSummary([
			{ severity: "concern", status: "open", message: "thin regression command", turn_id: 3 },
			{ severity: "blocker", status: "open", message: "missing RED_EVIDENCE", turn_id: 4 },
			{ severity: "blocker", status: "resolved", message: "forbidden file fixed", turn_id: 5 },
			{ severity: "blocker", status: "suppressed", message: "accepted risk", turn_id: 6 },
		]);

		expect(collectUnresolvedAdvisorBlockers(summary)).toEqual([
			{ severity: "blocker", status: "open", message: "missing RED_EVIDENCE", turn_id: 4 },
		]);
	});
});
