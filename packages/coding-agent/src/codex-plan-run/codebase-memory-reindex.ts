import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, resolve, sep } from "node:path";

export interface CodebaseMemoryReindexProvider {
	indexRepository(options: {
		repoPath: string;
		project: string;
		changedFiles: string[];
	}): Promise<{ exitCode: number; outputExcerpt: string }>;
	getIndexStatus(options: {
		repoPath: string;
	}): Promise<{ status: string; project: string; nodes: number; edges: number }>;
}

export interface CodebaseMemoryTaskReindexEvidence {
	schema_version: number;
	run_id: string;
	task_id: string;
	repo_path: string;
	project: string;
	mode: "fast";
	started_at: string;
	completed_at: string;
	status: "ready" | "degraded" | "failed";
	index_repository: {
		attempted: boolean;
		exit_code: number | null;
		output_excerpt: string;
	};
	index_status: {
		status: string;
		project: string;
		nodes: number;
		edges: number;
	};
	changed_files: string[];
	degraded_reason: string | null;
	jsonPath: string;
	markdownPath: string;
}

export interface CodebaseMemoryReindexSummary {
	[taskId: string]: CodebaseMemoryTaskReindexEvidence;
}

async function writeEvidence(path: string, content: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, content, "utf-8");
}

function renderReindexMarkdown(evidence: CodebaseMemoryTaskReindexEvidence): string {
	const lines: string[] = [];
	lines.push("# Codebase Memory Reindex Evidence");
	lines.push("");
	lines.push(`- **Task**: ${evidence.task_id}`);
	lines.push(`- **Run**: ${evidence.run_id}`);
	lines.push(`- **Status**: ${evidence.status}`);
	lines.push(`- **Project**: ${evidence.project}`);
	lines.push(`- **Mode**: ${evidence.mode}`);
	lines.push(
		`- **Changed files**: ${evidence.changed_files.length > 0 ? evidence.changed_files.join(", ") : "(none)"}`,
	);
	lines.push(`- **Started**: ${evidence.started_at}`);
	lines.push(`- **Completed**: ${evidence.completed_at}`);
	lines.push("");
	lines.push("## Index Repository");
	lines.push("");
	lines.push(`- **Attempted**: ${String(evidence.index_repository.attempted)}`);
	lines.push(
		"- **Exit Code**: " +
			(evidence.index_repository.exit_code !== null ? String(evidence.index_repository.exit_code) : "N/A"),
	);
	lines.push(`- **Output**: ${evidence.index_repository.output_excerpt || "(none)"}`);
	lines.push("");
	lines.push("## Index Status");
	lines.push("");
	lines.push(`- **Status**: ${evidence.index_status.status}`);
	lines.push(`- **Nodes**: ${String(evidence.index_status.nodes)}`);
	lines.push(`- **Edges**: ${String(evidence.index_status.edges)}`);
	if (evidence.degraded_reason) {
		lines.push("");
		lines.push("## Degradation");
		lines.push("");
		lines.push(`- **Reason**: ${evidence.degraded_reason}`);
	}
	lines.push("");
	return lines.join("\n");
}

export async function runCodebaseMemoryTaskReindex(input: {
	runId: string;
	taskId: string;
	repoPath: string;
	project: string;
	acceptingDir: string;
	changedFiles: string[];
	provider: CodebaseMemoryReindexProvider | null;
	now?: Date;
}): Promise<CodebaseMemoryTaskReindexEvidence> {
	const repoPath = resolve(input.repoPath);
	const timestamp = (input.now ?? new Date()).toISOString();
	const tasksRoot = resolve(input.acceptingDir, "tasks");
	const taskDir = resolve(tasksRoot, input.taskId);
	const jsonPath = join(taskDir, "codebase-memory-reindex.json");
	const markdownPath = join(taskDir, "codebase-memory-reindex.md");
	// Guard against taskId path traversal. `startsWith(tasksRoot)` is insufficient
	// because `/tmp/tasks-evil` also starts with `/tmp/tasks`; require a path boundary.
	if (taskDir !== tasksRoot && !taskDir.startsWith(`${tasksRoot}${sep}`)) {
		throw new Error(`taskId "${input.taskId}" would write outside accepting directory`);
	}

	// Missing provider → degraded evidence
	if (!input.provider) {
		const evidence: CodebaseMemoryTaskReindexEvidence = {
			schema_version: 1,
			run_id: input.runId,
			task_id: input.taskId,
			repo_path: repoPath,
			project: input.project,
			mode: "fast",
			started_at: timestamp,
			completed_at: timestamp,
			status: "degraded",
			index_repository: {
				attempted: false,
				exit_code: null,
				output_excerpt: "",
			},
			index_status: {
				status: "unknown",
				project: input.project,
				nodes: 0,
				edges: 0,
			},
			changed_files: input.changedFiles,
			degraded_reason: "provider_missing",
			jsonPath,
			markdownPath,
		};
		await writeEvidence(jsonPath, `${JSON.stringify(evidence, null, 2)}\n`);
		await writeEvidence(markdownPath, renderReindexMarkdown(evidence));
		return evidence;
	}

	// Decide whether to run indexRepository
	const hasChangedFiles = input.changedFiles.length > 0;
	let indexAttempted = false;
	let indexExitCode: number | null = null;
	let indexOutputExcerpt = "";
	let indexStatusFailed = false;

	if (hasChangedFiles) {
		indexAttempted = true;
		try {
			const result = await input.provider.indexRepository({
				repoPath,
				project: input.project,
				changedFiles: input.changedFiles,
			});
			indexExitCode = result.exitCode;
			indexOutputExcerpt = result.outputExcerpt;
		} catch (err: unknown) {
			indexExitCode = -1;
			indexOutputExcerpt = err instanceof Error ? err.message : String(err);
		}
	}

	// Always query index status
	let indexStatus: { status: string; project: string; nodes: number; edges: number };
	try {
		indexStatus = await input.provider.getIndexStatus({ repoPath });
	} catch {
		indexStatus = { status: "unknown", project: input.project, nodes: 0, edges: 0 };
		indexStatusFailed = true;
	}

	// Determine overall status
	const repoFailed = indexAttempted && indexExitCode !== 0;
	const status: "ready" | "degraded" | "failed" = repoFailed ? "failed" : indexStatusFailed ? "degraded" : "ready";
	let degradedReason: string | null = null;
	if (indexStatusFailed && !repoFailed) {
		degradedReason = "index_status_unavailable";
	}

	const evidence: CodebaseMemoryTaskReindexEvidence = {
		schema_version: 1,
		run_id: input.runId,
		task_id: input.taskId,
		repo_path: repoPath,
		project: input.project,
		mode: "fast",
		started_at: timestamp,
		completed_at: timestamp,
		status,
		index_repository: {
			attempted: indexAttempted,
			exit_code: indexExitCode,
			output_excerpt: indexOutputExcerpt,
		},
		index_status: {
			status: indexStatus.status,
			project: indexStatus.project,
			nodes: indexStatus.nodes,
			edges: indexStatus.edges,
		},
		changed_files: input.changedFiles,
		degraded_reason: degradedReason,
		jsonPath,
		markdownPath,
	};

	await writeEvidence(jsonPath, `${JSON.stringify(evidence, null, 2)}\n`);
	await writeEvidence(markdownPath, renderReindexMarkdown(evidence));
	return evidence;
}

export function validateCodebaseMemoryReindexForTaskReview(evidence: CodebaseMemoryTaskReindexEvidence): string | null {
	if (evidence.status === "failed") {
		return `Codebase Memory reindex status failed for task ${evidence.task_id}`;
	}
	return null;
}

export async function mergeCodebaseMemoryReindexSummary(input: {
	acceptingDir: string;
	evidence: CodebaseMemoryTaskReindexEvidence[];
}): Promise<CodebaseMemoryReindexSummary> {
	const summary: CodebaseMemoryReindexSummary = {};
	for (const ev of input.evidence) {
		summary[ev.task_id] = ev;
	}
	const summaryPath = join(input.acceptingDir, "codebase-memory-reindex-summary.json");
	await mkdir(dirname(summaryPath), { recursive: true });
	await writeFile(summaryPath, `${JSON.stringify(summary, null, 2)}\n`, "utf-8");
	return summary;
}
