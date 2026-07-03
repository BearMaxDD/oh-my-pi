import { describe, expect, it } from "bun:test";
import {
	checkFenceBalance,
	checkHeadingPresence,
	checkNoPlaceholders,
	checkTaskNumbering,
	runAllChecks,
	type SelfCheckResult,
} from "../../../src/codex-plan-run/segmented-write/checker";

describe("PlanSelfChecker", () => {
	it("detects TODO placeholders", () => {
		const content = "# Plan\n\nTODO: implement this\n";
		const result: SelfCheckResult = checkNoPlaceholders(content);
		expect(result.passed).toBe(false);
		expect(result.violations.length).toBeGreaterThan(0);
		expect(result.violations[0]?.pattern).toBe("TODO");
	});

	it("detects TBD placeholders", () => {
		const content = "Some TBD detail";
		const result = checkNoPlaceholders(content);
		expect(result.passed).toBe(false);
	});

	it("detects FIXME placeholders", () => {
		const content = "Fix FIXME later";
		const result = checkNoPlaceholders(content);
		expect(result.passed).toBe(false);
	});

	it("detects 待补充 placeholders", () => {
		const content = "细节待补充";
		const result = checkNoPlaceholders(content);
		expect(result.passed).toBe(false);
	});

	it("detects placeholder keyword", () => {
		const content = "This is a placeholder";
		const result = checkNoPlaceholders(content);
		expect(result.passed).toBe(false);
	});

	it("passes clean content", () => {
		const content = "# Clean Plan\n\nAll done.\n";
		const result = checkNoPlaceholders(content);
		expect(result.passed).toBe(true);
		expect(result.violations).toHaveLength(0);
	});

	it("finds broken task numbering (gaps)", () => {
		const content = "### Task 1: A\n### Task 2: B\n### Task 4: D\n";
		const result = checkTaskNumbering(content);
		expect(result.passed).toBe(false);
		expect(result.violations.length).toBeGreaterThan(0);
		expect(result.violations.some(v => v.message.includes("Task 3"))).toBe(true);
	});

	it("passes consecutive task numbering", () => {
		const content = "### Task 1: A\n### Task 2: B\n### Task 3: C\n";
		const result = checkTaskNumbering(content);
		expect(result.passed).toBe(true);
	});

	it("passes with no tasks", () => {
		const content = "# Just a heading\n\nNo tasks here.\n";
		const result = checkTaskNumbering(content);
		expect(result.passed).toBe(true);
	});

	it("detects unbalanced code fences", () => {
		const content = "# Plan\n```js\ncode\n```\n```unclosed\n";
		const result = checkFenceBalance(content);
		expect(result.passed).toBe(false);
	});

	it("passes balanced code fences", () => {
		const content = "# Plan\n```js\ncode\n```\n```bash\necho hi\n```\n";
		const result = checkFenceBalance(content);
		expect(result.passed).toBe(true);
	});

	it("passes content with no fences", () => {
		const content = "# Plan\nNo fences here.\n";
		const result = checkFenceBalance(content);
		expect(result.passed).toBe(true);
	});

	it("detects missing H1 heading", () => {
		const content = "## Subsection\n";
		const result = checkHeadingPresence(content);
		expect(result.passed).toBe(false);
		expect(result.violations[0]?.message).toContain("H1");
	});

	it("passes with H1 heading", () => {
		const content = "# Title\n## Subsection\n";
		const result = checkHeadingPresence(content);
		expect(result.passed).toBe(true);
	});

	it("runAllChecks passes clean content", () => {
		const content =
			"# Valid Plan\n\n### Task 1: Setup\n### Task 2: Implement\n\nSome content.\n```bash\necho done\n```\n";
		const result = runAllChecks(content);
		expect(result.passed).toBe(true);
		expect(result.checks).toHaveLength(4);
	});

	it("runAllChecks fails when a check fails", () => {
		const content = "# Plan with issue\n\nTODO: finish this\n### Task 1: A\n### Task 3: C\n```unclosed\n";
		const result = runAllChecks(content);
		expect(result.passed).toBe(false);
		// At least placeholder and task numbering should fail
		const failed = result.checks.filter(c => !c.passed);
		expect(failed.length).toBeGreaterThanOrEqual(2);
	});
});
