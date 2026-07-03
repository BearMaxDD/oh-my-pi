import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BusinessPathRef, SpecTaskFramework } from "./spec-task-framework";

export interface GlobalImpactReport {
	schema_version: "superpowers.global_impact.v1";
	run_id: string;
	changed_files: string[];
	affected_capabilities: AffectedCapability[];
	required_linked_tests: LinkedTestRequirement[];
	runtime_business_paths: BusinessPathRef[];
	status: "accepted" | "repair_required" | "blocked";
	findings: ImpactFinding[];
}

export interface AffectedCapability {
	id: string;
	title_zh: string;
	reason: string;
	related_files: string[];
	confidence: "low" | "medium" | "high";
}

export interface LinkedTestRequirement {
	id: string;
	title_zh: string;
	command?: string;
	business_path_id?: string;
	required: boolean;
}

export interface ImpactFinding {
	severity: "must_fix" | "should_fix" | "note";
	description: string;
	evidence: string;
}

export interface CodebaseMemoryImpactEvidence {
	reindex_summary_path?: string;
	trace_paths: Array<{
		changed_file: string;
		symbol?: string;
		callers: string[];
		callees: string[];
		risk: "low" | "medium" | "high";
		evidence_path?: string;
	}>;
	unavailable_reason?: string;
}

export type GlobalImpactGateMode = "off" | "advisory" | "required";

export interface BuildGlobalImpactReportOptions {
	runId: string;
	framework: SpecTaskFramework;
	changedFiles: string[];
	testEvidence: Array<{ command: string; exit_code?: number }>;
	reviewFindings: Array<{ severity: "must_fix" | "should_fix" | "note"; description: string; evidence: string }>;
	codebaseMemory?: CodebaseMemoryImpactEvidence;
	codebaseMemoryMode?: GlobalImpactGateMode;
}

function isRelated(file: string, taskFile: string): boolean {
	if (file === taskFile) return true;
	const basename = taskFile.split("/").pop() ?? taskFile;
	const isDirectory = taskFile.endsWith("/") || !basename.includes(".");
	if (isDirectory && file.startsWith(taskFile.replace(/\/?$/, "/"))) return true;
	return false;
}

function unique<T>(values: T[]): T[] {
	return Array.from(new Set(values));
}

export function buildGlobalImpactReport(options: BuildGlobalImpactReportOptions): GlobalImpactReport {
	const affected: AffectedCapability[] = [];
	const linkedTests: LinkedTestRequirement[] = [];
	const runtimeBusinessPaths: BusinessPathRef[] = [];
	const findings: ImpactFinding[] = [...options.reviewFindings];
	const mappedFiles = new Set<string>();
	const graphRiskByFile = new Map(
		(options.codebaseMemory?.trace_paths ?? []).map(trace => [trace.changed_file, trace.risk]),
	);

	for (const task of options.framework.tasks) {
		const relatedFiles = options.changedFiles.filter(file =>
			[...(task.expected_changed_paths ?? []), ...task.allowed_paths].some(taskFile => isRelated(file, taskFile)),
		);
		if (relatedFiles.length === 0) continue;
		for (const file of relatedFiles) mappedFiles.add(file);
		for (const capability of task.affected_capabilities) {
			affected.push({
				id: capability,
				title_zh: capability,
				reason: `${task.id} ${task.title_zh} touched ${relatedFiles.join(", ")}`,
				related_files: relatedFiles,
				confidence: options.codebaseMemory
					? relatedFiles.some(file => graphRiskByFile.get(file) === "high")
						? "high"
						: "medium"
					: "high",
			});
		}
		const relatedPaths = [...(task.expected_changed_paths ?? []), ...task.allowed_paths];
		const relatedBasenames = relatedPaths
			.map(p => {
				const parts = p.split("/");
				return parts[parts.length - 1];
			})
			.filter(bn => bn.length > 0);
		const graphLinkedTests = (options.codebaseMemory?.trace_paths ?? [])
			.filter(trace => relatedFiles.includes(trace.changed_file))
			.flatMap(trace => trace.callers.filter(caller => /(^|\/)test(s)?\/|\.(test|spec)\./.test(caller)));
		const matchingEvidence = options.testEvidence.find(
			e =>
				e.exit_code === 0 &&
				(e.command.includes(task.id) ||
					relatedBasenames.some(bn => e.command.includes(bn)) ||
					relatedPaths.some(p => e.command.includes(p)) ||
					graphLinkedTests.some(testPath => e.command.includes(testPath))),
		);
		if (!matchingEvidence) {
			findings.push({
				severity: "must_fix",
				description: `No passing test evidence for task ${task.id} ${task.title_zh}`,
				evidence: `Required linked test is missing passing evidence for task ${task.id}`,
			});
		}
		for (const criterion of task.acceptance_criteria) {
			linkedTests.push({
				id: `${task.id}-linked-test-${linkedTests.length + 1}`,
				title_zh: criterion,
				command: matchingEvidence?.command,
				required: true,
			});
		}
		runtimeBusinessPaths.push(...task.business_paths.filter(path => path.runtime_required));
	}

	const unmapped = options.changedFiles.filter(file => !mappedFiles.has(file));
	if (unmapped.length > 0) {
		findings.push({
			severity: "must_fix",
			description: `Changed files are not covered by spec/task framework: ${unmapped.join(", ")}`,
			evidence: unmapped.join(", "),
		});
	}

	const codeSensitiveFiles = options.changedFiles.filter(
		file => file.startsWith("src/") || file.startsWith("packages/"),
	);
	const missingTraceFiles = options.codebaseMemory
		? codeSensitiveFiles.filter(
				file => !options.codebaseMemory!.trace_paths.some(trace => trace.changed_file === file),
			)
		: codeSensitiveFiles;
	const codebaseMemoryUnavailableReason = !options.codebaseMemory
		? "Codebase Memory impact evidence is missing"
		: (options.codebaseMemory.unavailable_reason ??
			(missingTraceFiles.length > 0
				? `Codebase Memory impact evidence missing for: ${missingTraceFiles.join(", ")}`
				: undefined));
	const codebaseMemoryBlocked = !!(
		options.codebaseMemoryMode === "required" &&
		codeSensitiveFiles.length > 0 &&
		codebaseMemoryUnavailableReason
	);
	if (codebaseMemoryBlocked) {
		findings.push({
			severity: "must_fix",
			description: "Codebase Memory impact evidence is required for code-sensitive changes.",
			evidence: codebaseMemoryUnavailableReason,
		});
	}

	const status = findings.some(finding => finding.severity === "must_fix")
		? unmapped.length > 0 || codebaseMemoryBlocked
			? "blocked"
			: "repair_required"
		: "accepted";

	return {
		schema_version: "superpowers.global_impact.v1",
		run_id: options.runId,
		changed_files: options.changedFiles,
		affected_capabilities: unique(affected.map(item => JSON.stringify(item))).map(
			item => JSON.parse(item) as AffectedCapability,
		),
		required_linked_tests: linkedTests,
		runtime_business_paths: runtimeBusinessPaths,
		status,
		findings,
	};
}

function renderGlobalImpactMarkdown(report: GlobalImpactReport): string {
	return [
		"# Global Impact Report",
		"",
		`run_id: ${report.run_id}`,
		`status: ${report.status}`,
		"",
		"## Changed Files",
		...report.changed_files.map(file => `- ${file}`),
		"",
		"## Affected Capabilities",
		...report.affected_capabilities.map(capability => `- ${capability.id}: ${capability.reason}`),
		"",
		"## Required Linked Tests",
		...report.required_linked_tests.map(test => `- ${test.id}: ${test.command ?? test.business_path_id ?? "manual"}`),
		"",
		"## Findings",
		...report.findings.map(finding => `- ${finding.severity}: ${finding.description} (${finding.evidence})`),
		"",
	].join("\n");
}

export async function writeGlobalImpactReport(options: {
	acceptingDir: string;
	report: GlobalImpactReport;
}): Promise<{ jsonPath: string; markdownPath: string }> {
	await mkdir(options.acceptingDir, { recursive: true });
	const jsonPath = join(options.acceptingDir, "global-impact-report.json");
	const markdownPath = join(options.acceptingDir, "global-impact-report.md");
	await writeFile(jsonPath, `${JSON.stringify(options.report, null, 2)}\n`, "utf8");
	await writeFile(markdownPath, renderGlobalImpactMarkdown(options.report), "utf8");
	return { jsonPath, markdownPath };
}
