import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

export type AdvisorFindingSeverity = "info" | "warning" | "blocker";
export type AdvisorFindingCategory =
	| "scope"
	| "test"
	| "evidence"
	| "codebase_memory"
	| "over_implementation"
	| "model_routing";

export interface AdvisorFinding {
	schema_version: 1;
	run_id: string;
	task_id: string;
	severity: AdvisorFindingSeverity;
	category: AdvisorFindingCategory;
	finding: string;
	evidence: string;
	required_action?: string | null;
}

export interface AdvisorFindingsSummary {
	schema_version: 1;
	/** Preserve compatibility with existing advisor-summary consumers that read `{ items: [] }`. */
	items: [];
	tasks: Record<string, { info_count: number; warning_count: number; blocker_count: number }>;
}

export function filterAdvisorBlockers(findings: readonly AdvisorFinding[]): AdvisorFinding[] {
	return findings.filter(finding => finding.severity === "blocker");
}

export function collectAdvisorSummary(findings: readonly AdvisorFinding[]): AdvisorFindingsSummary {
	const tasks: AdvisorFindingsSummary["tasks"] = {};
	for (const finding of findings) {
		if (!tasks[finding.task_id]) {
			tasks[finding.task_id] = { info_count: 0, warning_count: 0, blocker_count: 0 };
		}
		const entry = tasks[finding.task_id];
		if (finding.severity === "info") entry.info_count += 1;
		if (finding.severity === "warning") entry.warning_count += 1;
		if (finding.severity === "blocker") entry.blocker_count += 1;
	}
	return { schema_version: 1, items: [], tasks };
}

async function writeText(path: string, content: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, content, "utf8");
}

export async function writeAdvisorFindings(input: {
	acceptingDir: string;
	taskId: string;
	findings: readonly AdvisorFinding[];
}): Promise<{ taskJsonlPath: string; summaryPath: string }> {
	const taskJsonlPath = join(input.acceptingDir, "tasks", input.taskId, "advisor-findings.jsonl");
	const summaryPath = join(input.acceptingDir, "advisor-summary.json");
	await writeText(taskJsonlPath, `${input.findings.map(finding => JSON.stringify(finding)).join("\n")}\n`);
	await writeText(summaryPath, `${JSON.stringify(collectAdvisorSummary(input.findings), null, 2)}\n`);
	return { taskJsonlPath, summaryPath };
}
