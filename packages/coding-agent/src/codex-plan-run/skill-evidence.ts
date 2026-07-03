export type SkillEvidenceSource = "skill_loaded" | "skill_declared_by_task_card" | "skill_claimed_by_subagent_output";

export interface SkillEvidenceRecord {
	task_id: string;
	skill: string;
	source: SkillEvidenceSource;
	evidence: string;
	created_at: string;
}

export interface SkillEvidenceMatrix {
	tasks: Record<string, SkillEvidenceRecord[]>;
}

export interface MissingSkillEvidence {
	task_id: string;
	skill: string;
	missing_source: SkillEvidenceSource;
}

const REQUIRED_SKILL_EVIDENCE_SOURCES: readonly SkillEvidenceSource[] = [
	"skill_loaded",
	"skill_declared_by_task_card",
	"skill_claimed_by_subagent_output",
];
const SKILL_EVIDENCE_SOURCE_SET: ReadonlySet<string> = new Set(REQUIRED_SKILL_EVIDENCE_SOURCES);

export function isSkillEvidenceSource(value: unknown): value is SkillEvidenceSource {
	return typeof value === "string" && SKILL_EVIDENCE_SOURCE_SET.has(value);
}

export function createSkillEvidenceMatrix(taskIds: string[]): SkillEvidenceMatrix {
	return {
		tasks: Object.fromEntries(taskIds.map(taskId => [taskId, []])),
	};
}

export function appendSkillEvidence(matrix: SkillEvidenceMatrix, record: SkillEvidenceRecord): SkillEvidenceMatrix {
	const normalizedRecord = normalizeSkillEvidenceRecord(record);

	return {
		tasks: {
			...matrix.tasks,
			[normalizedRecord.task_id]: [...(matrix.tasks[normalizedRecord.task_id] ?? []), normalizedRecord],
		},
	};
}

export function validateRequiredSkillEvidence(
	matrix: SkillEvidenceMatrix,
	taskId: string,
	requiredSkills: string[],
): MissingSkillEvidence[] {
	const normalizedTaskId = taskId.trim();
	const records = (matrix.tasks[normalizedTaskId] ?? []).flatMap(record => {
		const normalizedRecord = tryNormalizeSkillEvidenceRecord(record);
		return normalizedRecord === undefined ? [] : [normalizedRecord];
	});
	const normalizedRequiredSkills = dedupeTrimmed(requiredSkills);
	const missing: MissingSkillEvidence[] = [];

	for (const skill of normalizedRequiredSkills) {
		for (const source of REQUIRED_SKILL_EVIDENCE_SOURCES) {
			if (!records.some(record => record.skill === skill && record.source === source)) {
				missing.push({ task_id: normalizedTaskId, skill, missing_source: source });
			}
		}
	}

	return missing;
}

function normalizeSkillEvidenceRecord(record: SkillEvidenceRecord): SkillEvidenceRecord {
	const taskId = normalizeNonEmptyString(record.task_id, "task_id");
	const skill = normalizeNonEmptyString(record.skill, "skill");
	const source = normalizeNonEmptyString(record.source, "source");
	const evidence = normalizeNonEmptyString(record.evidence, "evidence");
	const createdAt = normalizeNonEmptyString(record.created_at, "created_at");

	if (!isSkillEvidenceSource(source)) {
		throw new Error("Invalid SkillEvidenceRecord: source");
	}
	if (!Number.isFinite(Date.parse(createdAt))) {
		throw new Error("Invalid SkillEvidenceRecord: created_at");
	}

	return {
		task_id: taskId,
		skill,
		source,
		evidence,
		created_at: createdAt,
	};
}

function tryNormalizeSkillEvidenceRecord(record: SkillEvidenceRecord): SkillEvidenceRecord | undefined {
	try {
		return normalizeSkillEvidenceRecord(record);
	} catch {
		return undefined;
	}
}

function normalizeNonEmptyString(value: unknown, field: keyof SkillEvidenceRecord): string {
	if (typeof value !== "string") {
		throw new Error(`Invalid SkillEvidenceRecord: ${field}`);
	}
	const normalized = value.trim();
	if (normalized.length === 0) {
		throw new Error(`Invalid SkillEvidenceRecord: ${field}`);
	}
	return normalized;
}

function dedupeTrimmed(values: string[]): string[] {
	const deduped: string[] = [];
	const seen = new Set<string>();

	for (const value of values) {
		const normalized = value.trim();
		if (normalized.length === 0 || seen.has(normalized)) {
			continue;
		}
		deduped.push(normalized);
		seen.add(normalized);
	}

	return deduped;
}
