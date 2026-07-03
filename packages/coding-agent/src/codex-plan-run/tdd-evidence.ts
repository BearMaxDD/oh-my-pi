import type { PlanRunBlockerReason } from "./types";

export type TddEvidenceKind = "RED_EVIDENCE" | "GREEN_EVIDENCE" | "REGRESSION_EVIDENCE";

export interface VerificationCommandResult {
	command: string;
	cwd: string;
	exit_code: number;
	started_at: string;
	completed_at: string;
	output_excerpt: string;
	evidence_file_path: string;
}

export interface TddEvidenceRecord extends VerificationCommandResult {
	kind: TddEvidenceKind;
	task_id: string;
}

export interface TddEvidenceMatrix {
	tasks: Record<string, TddEvidenceRecord[]>;
}

export interface TddEvidenceFinding {
	task_id: string;
	reason: PlanRunBlockerReason;
	message: string;
}

const TDD_EVIDENCE_ORDER: TddEvidenceKind[] = ["RED_EVIDENCE", "GREEN_EVIDENCE", "REGRESSION_EVIDENCE"];
const TDD_EVIDENCE_KIND_SET: ReadonlySet<string> = new Set(TDD_EVIDENCE_ORDER);
const STALE_EVIDENCE_PATTERN =
	/\b(copied from|copied command output|placeholder pass|placeholder evidence|fake verification|cached result|prior run|not rerun|previous attempt|previous round|old PASS|inherited from|stale command output)\b/i;

const MISSING_REASON_BY_KIND: Record<TddEvidenceKind, PlanRunBlockerReason> = {
	RED_EVIDENCE: "blocked_missing_red_evidence",
	GREEN_EVIDENCE: "blocked_missing_green_evidence",
	REGRESSION_EVIDENCE: "blocked_missing_regression_evidence",
};

export function isTddEvidenceKind(value: unknown): value is TddEvidenceKind {
	return typeof value === "string" && TDD_EVIDENCE_KIND_SET.has(value);
}

export function createEmptyTddEvidenceMatrix(taskIds: string[]): TddEvidenceMatrix {
	return {
		tasks: Object.fromEntries(taskIds.map(taskId => [taskId, []])),
	};
}

export function appendTddEvidence(
	matrix: TddEvidenceMatrix,
	taskId: string,
	kind: TddEvidenceKind,
	command: VerificationCommandResult,
): TddEvidenceMatrix {
	return {
		tasks: {
			...matrix.tasks,
			[taskId]: [...(matrix.tasks[taskId] ?? []), { ...command, kind, task_id: taskId }],
		},
	};
}

export function validateTddEvidenceMatrix(matrix: TddEvidenceMatrix): TddEvidenceFinding[] {
	const findings: TddEvidenceFinding[] = [];

	for (const [taskId, records] of Object.entries(matrix.tasks)) {
		const validRecords: TddEvidenceRecord[] = [];

		for (const record of records) {
			if (!isTddEvidenceKind(record.kind)) {
				findings.push({
					task_id: taskId,
					reason: "blocked_tdd_order_violation",
					message: `${taskId} has unknown TDD evidence kind: ${String(record.kind)}`,
				});
				continue;
			}
			validRecords.push(record);
		}

		for (const kind of TDD_EVIDENCE_ORDER) {
			const kindRecords = validRecords.filter(record => record.kind === kind);
			if (kindRecords.length === 0) {
				findings.push({
					task_id: taskId,
					reason: MISSING_REASON_BY_KIND[kind],
					message: `${taskId} is missing ${kind}`,
				});
			} else if (kindRecords.some(record => !hasValidExitCode(record))) {
				findings.push({
					task_id: taskId,
					reason: MISSING_REASON_BY_KIND[kind],
					message: invalidExitCodeMessage(taskId, kind),
				});
			}
		}

		const orderIndexes = validRecords.map(record => TDD_EVIDENCE_ORDER.indexOf(record.kind));
		if (orderIndexes.some((orderIndex, index) => index > 0 && orderIndex < orderIndexes[index - 1]!)) {
			findings.push({
				task_id: taskId,
				reason: "blocked_tdd_order_violation",
				message: `${taskId} has TDD evidence out of order`,
			});
		}

		findings.push(...validateTimestamps(taskId, validRecords));

		if (records.some(record => STALE_EVIDENCE_PATTERN.test(record.output_excerpt))) {
			findings.push({
				task_id: taskId,
				reason: "blocked_stale_evidence",
				message: `${taskId} contains stale evidence text`,
			});
		}
	}

	return findings;
}

function hasValidExitCode(record: TddEvidenceRecord): boolean {
	return record.kind === "RED_EVIDENCE" ? record.exit_code !== 0 : record.exit_code === 0;
}

function invalidExitCodeMessage(taskId: string, kind: TddEvidenceKind): string {
	if (kind === "RED_EVIDENCE") {
		return `${taskId} RED evidence must fail with a non-zero exit code`;
	}
	if (kind === "GREEN_EVIDENCE") {
		return `${taskId} GREEN evidence must pass with exit code 0`;
	}
	return `${taskId} REGRESSION evidence must pass with exit code 0`;
}

function validateTimestamps(taskId: string, records: TddEvidenceRecord[]): TddEvidenceFinding[] {
	const findings: TddEvidenceFinding[] = [];
	const timestampedRecords: Array<{
		record: TddEvidenceRecord;
		startedAt: number;
		completedAt: number;
	}> = [];

	for (const record of records) {
		const startedAt = parseTimestamp(record.started_at);
		const completedAt = parseTimestamp(record.completed_at);
		if (startedAt === undefined || completedAt === undefined) {
			findings.push({
				task_id: taskId,
				reason: "blocked_tdd_order_violation",
				message: `${taskId} ${record.kind} has invalid timestamp`,
			});
			continue;
		}
		if (completedAt < startedAt) {
			findings.push({
				task_id: taskId,
				reason: "blocked_tdd_order_violation",
				message: `${taskId} ${record.kind} completed before it started`,
			});
			continue;
		}
		timestampedRecords.push({ record, startedAt, completedAt });
	}

	for (let index = 1; index < timestampedRecords.length; index++) {
		const previous = timestampedRecords[index - 1]!;
		const current = timestampedRecords[index]!;
		if (current.startedAt < previous.completedAt) {
			findings.push({
				task_id: taskId,
				reason: "blocked_tdd_order_violation",
				message: `${taskId} ${current.record.kind} started before ${previous.record.kind} completed`,
			});
		}
	}

	return findings;
}

function parseTimestamp(value: string): number | undefined {
	const timestamp = Date.parse(value);
	return Number.isFinite(timestamp) ? timestamp : undefined;
}
