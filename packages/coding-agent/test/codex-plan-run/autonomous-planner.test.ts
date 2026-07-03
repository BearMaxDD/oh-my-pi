import { describe, expect, it } from "bun:test";
import { createAutonomousPlanExecutionBookInput } from "../../src/codex-plan-run/autonomous-planner";

describe("autonomous planner", () => {
	it("turns a user request and recon into execution book input", () => {
		const input = createAutonomousPlanExecutionBookInput({
			runId: "run-1",
			userRequest: "Add billing export",
			repoPath: "/repo",
			recon: {
				summary: "TypeScript service",
				relevant_files: ["src/billing/export.ts"],
				test_commands: ["bun test test/billing-export.test.ts"],
				build_commands: ["bun run check:types"],
				risks: ["export format regression"],
			},
		});

		expect(input.mode).toBe("autonomous");
		expect(input.requiredExecutionSkills).toContain("test-driven-development");
		expect(input.requiredReviewSkills).toContain("requesting-code-review");
		expect(input.finalTailSkills).toContain("verification-before-completion");
		expect(input.tasks[0]?.smokeCommands).toEqual(["bun test test/billing-export.test.ts"]);
	});
});
