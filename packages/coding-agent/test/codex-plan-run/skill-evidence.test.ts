import { describe, expect, it } from "bun:test";
import {
	appendSkillEvidence,
	createSkillEvidenceMatrix,
	isSkillEvidenceSource,
	type SkillEvidenceMatrix,
	type SkillEvidenceRecord,
	validateRequiredSkillEvidence,
} from "../../src/codex-plan-run/skill-evidence";

const baseRecord: SkillEvidenceRecord = {
	task_id: "T1",
	skill: "test-driven-development",
	source: "skill_loaded",
	evidence: "Loaded from skill://test-driven-development",
	created_at: "2026-06-27T00:00:00.000Z",
};

describe("skill evidence matrix", () => {
	it("requires loaded, declared, and claimed evidence for required task skills", () => {
		let matrix = createSkillEvidenceMatrix(["T1"]);
		matrix = appendSkillEvidence(matrix, {
			task_id: "T1",
			skill: "test-driven-development",
			source: "skill_declared_by_task_card",
			evidence: "Task card requires TDD",
			created_at: "2026-06-27T00:00:00.000Z",
		});

		expect(validateRequiredSkillEvidence(matrix, "T1", ["test-driven-development"])).toContainEqual(
			expect.objectContaining({ skill: "test-driven-development", missing_source: "skill_loaded" }),
		);

		matrix = appendSkillEvidence(matrix, {
			task_id: "T1",
			skill: "test-driven-development",
			source: "skill_loaded",
			evidence: "Loaded from skill://test-driven-development",
			created_at: "2026-06-27T00:00:01.000Z",
		});
		matrix = appendSkillEvidence(matrix, {
			task_id: "T1",
			skill: "test-driven-development",
			source: "skill_claimed_by_subagent_output",
			evidence: "Subagent reported RED/GREEN/REGRESSION cycle",
			created_at: "2026-06-27T00:00:02.000Z",
		});

		expect(validateRequiredSkillEvidence(matrix, "T1", ["test-driven-development"])).toEqual([]);
	});

	it("does not mutate the original matrix when appending evidence", () => {
		const matrix = createSkillEvidenceMatrix(["T1"]);
		const appended = appendSkillEvidence(matrix, {
			task_id: "T1",
			skill: "test-driven-development",
			source: "skill_loaded",
			evidence: "Loaded from skill://test-driven-development",
			created_at: "2026-06-27T00:00:00.000Z",
		});

		expect(matrix.tasks.T1).toEqual([]);
		expect(appended.tasks.T1).toHaveLength(1);
		expect(appended).not.toBe(matrix);
		expect(appended.tasks).not.toBe(matrix.tasks);
	});

	it("reports each missing source for each required skill", () => {
		const matrix = appendSkillEvidence(createSkillEvidenceMatrix(["T1"]), {
			task_id: "T1",
			skill: "test-driven-development",
			source: "skill_loaded",
			evidence: "Loaded from skill://test-driven-development",
			created_at: "2026-06-27T00:00:00.000Z",
		});

		expect(
			validateRequiredSkillEvidence(matrix, "T1", ["test-driven-development", "verification-before-completion"]),
		).toEqual([
			expect.objectContaining({
				task_id: "T1",
				skill: "test-driven-development",
				missing_source: "skill_declared_by_task_card",
			}),
			expect.objectContaining({
				task_id: "T1",
				skill: "test-driven-development",
				missing_source: "skill_claimed_by_subagent_output",
			}),
			expect.objectContaining({
				task_id: "T1",
				skill: "verification-before-completion",
				missing_source: "skill_loaded",
			}),
			expect.objectContaining({
				task_id: "T1",
				skill: "verification-before-completion",
				missing_source: "skill_declared_by_task_card",
			}),
			expect.objectContaining({
				task_id: "T1",
				skill: "verification-before-completion",
				missing_source: "skill_claimed_by_subagent_output",
			}),
		]);
	});

	it("exports a runtime guard for allowed skill evidence sources", () => {
		expect(isSkillEvidenceSource("skill_loaded")).toBe(true);
		expect(isSkillEvidenceSource("skill_declared_by_task_card")).toBe(true);
		expect(isSkillEvidenceSource("skill_claimed_by_subagent_output")).toBe(true);
		expect(isSkillEvidenceSource("unknown_source")).toBe(false);
	});

	it("rejects unknown runtime sources without polluting the matrix", () => {
		const matrix = createSkillEvidenceMatrix(["T1"]);
		const record = { ...baseRecord, source: "unknown_source" } as unknown as SkillEvidenceRecord;

		expect(() => appendSkillEvidence(matrix, record)).toThrow(/Invalid SkillEvidenceRecord: source/);
		expect(matrix.tasks.T1).toEqual([]);
	});

	it("rejects invalid skill evidence record fields", () => {
		const invalidRecords: Array<{ label: string; record: SkillEvidenceRecord }> = [
			{ label: "task_id", record: { ...baseRecord, task_id: " " } },
			{ label: "skill", record: { ...baseRecord, skill: " " } },
			{ label: "evidence", record: { ...baseRecord, evidence: " " } },
			{ label: "created_at", record: { ...baseRecord, created_at: "not-a-date" } },
		];

		for (const { label, record } of invalidRecords) {
			expect(() => appendSkillEvidence(createSkillEvidenceMatrix(["T1"]), record)).toThrow(
				new RegExp(`Invalid SkillEvidenceRecord: ${label}`),
			);
		}
	});

	it("normalizes valid skill evidence record fields before appending", () => {
		const matrix = appendSkillEvidence(createSkillEvidenceMatrix(["T1"]), {
			task_id: " T1 ",
			skill: " test-driven-development ",
			source: " skill_loaded " as unknown as SkillEvidenceRecord["source"],
			evidence: " Loaded from skill://test-driven-development ",
			created_at: " 2026-06-27T00:00:00.000Z ",
		});

		expect(matrix.tasks.T1).toEqual([
			{
				task_id: "T1",
				skill: "test-driven-development",
				source: "skill_loaded",
				evidence: "Loaded from skill://test-driven-development",
				created_at: "2026-06-27T00:00:00.000Z",
			},
		]);
	});

	it("does not count invalid existing records as required source evidence", () => {
		const matrix: SkillEvidenceMatrix = {
			tasks: {
				T1: [
					{ ...baseRecord, source: "skill_loaded", evidence: "" },
					{ ...baseRecord, source: "skill_declared_by_task_card", created_at: "not-a-date" },
					{ ...baseRecord, source: "skill_claimed_by_subagent_output" },
				],
			},
		};

		expect(validateRequiredSkillEvidence(matrix, "T1", [" test-driven-development ", ""])).toEqual([
			expect.objectContaining({
				task_id: "T1",
				skill: "test-driven-development",
				missing_source: "skill_loaded",
			}),
			expect.objectContaining({
				task_id: "T1",
				skill: "test-driven-development",
				missing_source: "skill_declared_by_task_card",
			}),
		]);
	});
});
