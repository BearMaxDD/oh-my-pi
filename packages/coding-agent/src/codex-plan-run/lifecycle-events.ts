import { appendFile, mkdir, readFile } from "node:fs/promises";
import { dirname } from "node:path";

/**
 * Known lifecycle event names for a Codex plan run.
 */
export const EVENT_NAMES = [
	"plan_received",
	"worktree_ready",
	"plan_materialized",
	"required_skill_loaded",
	"execution_book_ready",
	"todos_initialized",
	"execution_started",
	"implementation_verified",
	"completion_doc_written",
	"main_acceptance_review_running",
	"main_acceptance_fix_required",
	"fix_tasks_running",
	"main_acceptance_accepted",
	"review_packet_validated",
	"ready_for_codex_review",
	"blocked_gate",
	"after_codebase_memory_execution_recon",
	"before_execution_book_write",
	"after_execution_book_write",
	"before_main_acceptance",
	"after_main_acceptance",
	"before_codebase_memory_acceptance_recon",
	"after_codebase_memory_acceptance_recon",
	"before_packet_emit",
	"after_packet_emit",
] as const;

export type EventName = (typeof EVENT_NAMES)[number];

/**
 * Schema for evidence paths recorded during a lifecycle event.
 */
export interface EvidenceEntry {
	path: string;
	description?: string;
}

/**
 * Summary of stdout/stderr output from a lifecycle step.
 * Both fields are truncated to TRUNCATION_LIMIT characters.
 */
export interface ExecutionSummary {
	stdout?: string;
	stderr?: string;
}

/**
 * A single lifecycle event for a Codex plan run.
 *
 * Fields:
 * - run_id: Identifies the plan run
 * - event: The lifecycle event name
 * - state: The plan run state at this point
 * - at: Timestamp when the event occurred
 * - acceptingDir: The accepting directory path for evidence
 * - evidence: Optional array of evidence file paths
 * - summary: Optional stdout/stderr summary (truncated)
 */
export interface PlanRunLifecycleEvent {
	run_id: string;
	event: string;
	state: string;
	at: Date;
	acceptingDir: string;
	evidence?: string[];
	summary?: ExecutionSummary;
}

/** Maximum length for stdout/stderr summary fields. */
const TRUNCATION_LIMIT = 4096;

/**
 * Truncate a string to the given maximum length.
 */
function truncate(value: string | undefined, max: number): string | undefined {
	if (value === undefined) return undefined;
	return value.length > max ? value.slice(0, max) : value;
}

/**
 * Append a lifecycle event to a JSONL file.
 * Creates the parent directory if it does not exist.
 *
 * Throws if run_id, event, or acceptingDir are missing/empty.
 */
export async function appendPlanRunLifecycleEvent(filePath: string, event: PlanRunLifecycleEvent): Promise<void> {
	if (!event.run_id) {
		throw new Error("PlanRunLifecycleEvent requires a non-empty run_id");
	}
	if (!event.event) {
		throw new Error("PlanRunLifecycleEvent requires a non-empty event");
	}
	if (!event.acceptingDir) {
		throw new Error("PlanRunLifecycleEvent requires a non-empty acceptingDir");
	}

	// Ensure parent directory exists
	await mkdir(dirname(filePath), { recursive: true });

	// Serialize with Date as ISO string and truncate summaries
	const serialized: Record<string, unknown> = {
		run_id: event.run_id,
		event: event.event,
		state: event.state,
		at: event.at.toISOString(),
		acceptingDir: event.acceptingDir,
	};

	if (event.evidence && event.evidence.length > 0) {
		serialized.evidence = event.evidence;
	}

	if (event.summary) {
		serialized.summary = {
			stdout: truncate(event.summary.stdout, TRUNCATION_LIMIT),
			stderr: truncate(event.summary.stderr, TRUNCATION_LIMIT),
		};
	}

	const line = `${JSON.stringify(serialized)}\n`;
	await appendFile(filePath, line, "utf-8");
}

/**
 * Read all lifecycle events from a JSONL file.
 * Returns an empty array if the file does not exist.
 */
export async function readPlanRunLifecycleEvents(filePath: string): Promise<PlanRunLifecycleEvent[]> {
	try {
		const content = await readFile(filePath, "utf-8");
		const lines = content.trim().split("\n");
		return lines
			.filter(line => line.length > 0)
			.map(line => {
				const parsed = JSON.parse(line) as Record<string, unknown>;
				return {
					run_id: String(parsed.run_id ?? ""),
					event: String(parsed.event ?? ""),
					state: String(parsed.state ?? ""),
					at: typeof parsed.at === "string" || typeof parsed.at === "number" ? new Date(parsed.at) : new Date(),
					acceptingDir: String(parsed.acceptingDir ?? ""),
					...(parsed.evidence ? { evidence: parsed.evidence as string[] } : {}),
					...(parsed.summary ? { summary: parsed.summary as ExecutionSummary } : {}),
				} satisfies PlanRunLifecycleEvent;
			});
	} catch (err: unknown) {
		// If file doesn't exist, return empty array
		const nodeErr = err as NodeJS.ErrnoException;
		if (nodeErr.code === "ENOENT") {
			return [];
		}
		throw err;
	}
}
