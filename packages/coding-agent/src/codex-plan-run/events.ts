import { appendFile, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { PlanRunState } from "./types";

export type PlanRunEventType =
	| "execution_book_ready"
	| "task_ready"
	| "task_running"
	| "task_green_evidence_passed"
	| "codebase_memory_reindex_started"
	| "codebase_memory_reindex_completed"
	| "codebase_memory_reindex_degraded"
	| "task_review_allowed"
	| "task_accepted"
	| "task_fix_required"
	| "main_acceptance_pending"
	| "main_acceptance_accepted"
	| "main_acceptance_fix_required"
	| "ready_for_codex_review";

export interface PlanRunEvent {
	schema_version: 1;
	run_id: string;
	state: PlanRunState;
	type: PlanRunEventType;
	task_id?: string;
	created_at: string;
}

export async function appendPlanRunEvent(input: { acceptingDir: string; event: PlanRunEvent }): Promise<string> {
	const { acceptingDir, event } = input;
	await mkdir(acceptingDir, { recursive: true });
	const path = join(acceptingDir, "events.jsonl");
	await appendFile(path, `${JSON.stringify(event)}\n`, "utf8");
	return path;
}
