import { describe, expect, it } from "bun:test";
import type { AdvisorRunTrigger, AdvisorReviewRequest } from "../src/extensibility/extensions/types";

describe("AdvisorRunTrigger extended", () => {
	it("accepts new trigger values", () => {
		const t: AdvisorRunTrigger = "git_pre_push";
		expect(t).toBe("git_pre_push");
	});
	it("all trigger values compile", () => {
		const values: AdvisorRunTrigger[] = [
			"turn_end",
			"compliance_review",
			"impact_analysis",
			"git_pre_push",
			"file_change",
			"scheduled",
			"manual_review",
		];
		expect(values).toHaveLength(7);
	});
	it("AdvisorReviewRequest has optional trigger field", () => {
		const req: AdvisorReviewRequest = { reviewId: "x", trigger: "compliance_review" };
		expect(req.trigger).toBe("compliance_review");
	});
});
