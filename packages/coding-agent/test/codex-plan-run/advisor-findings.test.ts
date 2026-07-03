import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type AdvisorFinding,
	collectAdvisorSummary,
	filterAdvisorBlockers,
	writeAdvisorFindings,
} from "../../src/codex-plan-run/advisor-findings";

const tempDirs: string[] = [];
async function makeTempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "omp-advisor-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

const blocker: AdvisorFinding = {
	schema_version: 1,
	run_id: "run-1",
	task_id: "T01",
	severity: "blocker",
	category: "evidence",
	finding: "Task skipped RED_EVIDENCE",
	evidence: "tests_run only contains PASS",
	required_action: "Re-run red test and capture failing output",
};

const blockerWithoutAction: AdvisorFinding = {
	schema_version: 1,
	run_id: "run-1",
	task_id: "T01",
	severity: "blocker",
	category: "test",
	finding: "Missing regression evidence",
	evidence: "tests_run omits regression command",
};

const warning: AdvisorFinding = {
	schema_version: 1,
	run_id: "run-1",
	task_id: "T01",
	severity: "warning",
	category: "over_implementation",
	finding: "Implementation added an extra abstraction",
	evidence: "created src/shared/framework.ts",
	required_action: "Reviewer decides whether scope is justified",
};

describe("advisor task card findings", () => {
	it("writes task JSONL and aggregate summary", async () => {
		const acceptingDir = await makeTempDir();
		const paths = await writeAdvisorFindings({ acceptingDir, taskId: "T01", findings: [blocker, warning] });

		expect(paths.taskJsonlPath).toBe(join(acceptingDir, "tasks", "T01", "advisor-findings.jsonl"));
		expect(await readFile(paths.taskJsonlPath, "utf8")).toContain("Task skipped RED_EVIDENCE");
		const summaryText = await readFile(paths.summaryPath, "utf8");
		expect(summaryText).toContain('"blocker_count": 1');
		expect(summaryText).toContain('"items": []');
	});

	it("collects blockers by task id", () => {
		expect(filterAdvisorBlockers([blocker, warning])).toEqual([blocker]);
		expect(filterAdvisorBlockers([blockerWithoutAction])[0]?.required_action ?? blockerWithoutAction.finding).toBe(
			"Missing regression evidence",
		);
		expect(collectAdvisorSummary([blocker, warning])).toEqual({
			schema_version: 1,
			items: [],
			tasks: {
				T01: { info_count: 0, warning_count: 1, blocker_count: 1 },
			},
		});
	});
});
