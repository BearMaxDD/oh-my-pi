import { describe, expect, it } from "bun:test";
import {
	appendTddEvidence,
	createEmptyTddEvidenceMatrix,
	type TddEvidenceMatrix,
	validateTddEvidenceMatrix,
} from "../../src/codex-plan-run/tdd-evidence";

const command = {
	command: "bun test test/demo.test.ts",
	cwd: "/repo",
	exit_code: 1,
	started_at: "2026-06-27T00:00:00.000Z",
	completed_at: "2026-06-27T00:00:01.000Z",
	output_excerpt: "expected failure",
	evidence_file_path: ".omp/plan-runs/run-1/events.jsonl",
};

const greenCommand = {
	...command,
	exit_code: 0,
	started_at: "2026-06-27T00:00:02.000Z",
	completed_at: "2026-06-27T00:00:03.000Z",
};

const regressionCommand = {
	...command,
	exit_code: 0,
	started_at: "2026-06-27T00:00:04.000Z",
	completed_at: "2026-06-27T00:00:05.000Z",
};

describe("TDD evidence matrix", () => {
	it("blocks when green evidence appears before red evidence", () => {
		let matrix = createEmptyTddEvidenceMatrix(["T1"]);
		matrix = appendTddEvidence(matrix, "T1", "GREEN_EVIDENCE", greenCommand);
		matrix = appendTddEvidence(matrix, "T1", "RED_EVIDENCE", command);
		matrix = appendTddEvidence(matrix, "T1", "REGRESSION_EVIDENCE", regressionCommand);

		expect(validateTddEvidenceMatrix(matrix)).toContainEqual(
			expect.objectContaining({ reason: "blocked_tdd_order_violation", task_id: "T1" }),
		);
	});

	it("allows complete red, green, regression evidence in order", () => {
		let matrix = createEmptyTddEvidenceMatrix(["T1"]);
		matrix = appendTddEvidence(matrix, "T1", "RED_EVIDENCE", command);
		matrix = appendTddEvidence(matrix, "T1", "GREEN_EVIDENCE", greenCommand);
		matrix = appendTddEvidence(matrix, "T1", "REGRESSION_EVIDENCE", regressionCommand);

		expect(validateTddEvidenceMatrix(matrix)).toEqual([]);
	});

	it("rejects stale, copied, old, placeholder, inherited, and fake output excerpts", () => {
		const staleExcerpts = [
			"inherited from setup",
			"stale command output",
			"placeholder PASS",
			"placeholder evidence",
			"copied command output",
			"copied from previous round",
			"old PASS copied from previous round",
			"fake verification",
			"cached result",
			"prior run",
			"not rerun",
			"previous attempt",
		];

		for (const output_excerpt of staleExcerpts) {
			let matrix = createEmptyTddEvidenceMatrix(["T1"]);
			matrix = appendTddEvidence(matrix, "T1", "RED_EVIDENCE", { ...command, output_excerpt });
			matrix = appendTddEvidence(matrix, "T1", "GREEN_EVIDENCE", greenCommand);
			matrix = appendTddEvidence(matrix, "T1", "REGRESSION_EVIDENCE", regressionCommand);

			expect(validateTddEvidenceMatrix(matrix)).toContainEqual(
				expect.objectContaining({ reason: "blocked_stale_evidence", task_id: "T1" }),
			);
		}
	});

	it("does not reject legitimate output that contains stale-looking words", () => {
		const legitimateExcerpts = ["uses fake timers", "copies fixture file", "placeholder text rendered by app"];

		for (const output_excerpt of legitimateExcerpts) {
			let matrix = createEmptyTddEvidenceMatrix(["T1"]);
			matrix = appendTddEvidence(matrix, "T1", "RED_EVIDENCE", { ...command, output_excerpt });
			matrix = appendTddEvidence(matrix, "T1", "GREEN_EVIDENCE", greenCommand);
			matrix = appendTddEvidence(matrix, "T1", "REGRESSION_EVIDENCE", regressionCommand);

			expect(validateTddEvidenceMatrix(matrix)).toEqual([]);
		}
	});

	it("requires red to fail and green and regression to pass", () => {
		let matrix = createEmptyTddEvidenceMatrix(["T1"]);
		matrix = appendTddEvidence(matrix, "T1", "RED_EVIDENCE", { ...command, exit_code: 0 });
		matrix = appendTddEvidence(matrix, "T1", "GREEN_EVIDENCE", { ...greenCommand, exit_code: 1 });
		matrix = appendTddEvidence(matrix, "T1", "REGRESSION_EVIDENCE", { ...regressionCommand, exit_code: 1 });

		expect(validateTddEvidenceMatrix(matrix)).toEqual([
			expect.objectContaining({
				reason: "blocked_missing_red_evidence",
				task_id: "T1",
				message: expect.stringContaining("RED evidence must fail"),
			}),
			expect.objectContaining({
				reason: "blocked_missing_green_evidence",
				task_id: "T1",
				message: expect.stringContaining("GREEN evidence must pass"),
			}),
			expect.objectContaining({
				reason: "blocked_missing_regression_evidence",
				task_id: "T1",
				message: expect.stringContaining("REGRESSION evidence must pass"),
			}),
		]);
	});

	it("reports unknown runtime evidence kinds explicitly", () => {
		const matrix = {
			tasks: {
				T1: [{ ...command, kind: "BLUE_EVIDENCE", task_id: "T1" }],
			},
		} as unknown as TddEvidenceMatrix;

		expect(validateTddEvidenceMatrix(matrix)).toContainEqual(
			expect.objectContaining({
				reason: "blocked_tdd_order_violation",
				task_id: "T1",
				message: expect.stringContaining("unknown TDD evidence kind"),
			}),
		);
	});

	it("blocks timestamp evidence that runs out of TDD order", () => {
		let matrix = createEmptyTddEvidenceMatrix(["T1"]);
		matrix = appendTddEvidence(matrix, "T1", "RED_EVIDENCE", {
			...command,
			started_at: "2026-06-27T00:00:00.000Z",
			completed_at: "2026-06-27T00:00:10.000Z",
		});
		matrix = appendTddEvidence(matrix, "T1", "GREEN_EVIDENCE", {
			...command,
			exit_code: 0,
			started_at: "2026-06-27T00:00:05.000Z",
			completed_at: "2026-06-27T00:00:15.000Z",
		});
		matrix = appendTddEvidence(matrix, "T1", "REGRESSION_EVIDENCE", {
			...command,
			exit_code: 0,
			started_at: "2026-06-27T00:00:16.000Z",
			completed_at: "2026-06-27T00:00:17.000Z",
		});

		expect(validateTddEvidenceMatrix(matrix)).toContainEqual(
			expect.objectContaining({
				reason: "blocked_tdd_order_violation",
				task_id: "T1",
				message: expect.stringContaining("started before RED_EVIDENCE completed"),
			}),
		);

		matrix = createEmptyTddEvidenceMatrix(["T1"]);
		matrix = appendTddEvidence(matrix, "T1", "RED_EVIDENCE", command);
		matrix = appendTddEvidence(matrix, "T1", "GREEN_EVIDENCE", {
			...command,
			exit_code: 0,
			started_at: "2026-06-27T00:00:02.000Z",
			completed_at: "2026-06-27T00:00:10.000Z",
		});
		matrix = appendTddEvidence(matrix, "T1", "REGRESSION_EVIDENCE", {
			...command,
			exit_code: 0,
			started_at: "2026-06-27T00:00:05.000Z",
			completed_at: "2026-06-27T00:00:11.000Z",
		});

		expect(validateTddEvidenceMatrix(matrix)).toContainEqual(
			expect.objectContaining({
				reason: "blocked_tdd_order_violation",
				task_id: "T1",
				message: expect.stringContaining("started before GREEN_EVIDENCE completed"),
			}),
		);
	});

	it("blocks invalid evidence timestamps", () => {
		let matrix = createEmptyTddEvidenceMatrix(["T1"]);
		matrix = appendTddEvidence(matrix, "T1", "RED_EVIDENCE", { ...command, started_at: "not-a-date" });
		matrix = appendTddEvidence(matrix, "T1", "GREEN_EVIDENCE", greenCommand);
		matrix = appendTddEvidence(matrix, "T1", "REGRESSION_EVIDENCE", regressionCommand);

		expect(validateTddEvidenceMatrix(matrix)).toContainEqual(
			expect.objectContaining({
				reason: "blocked_tdd_order_violation",
				task_id: "T1",
				message: expect.stringContaining("invalid timestamp"),
			}),
		);
	});

	it("reports missing red, green, and regression evidence separately", () => {
		expect(validateTddEvidenceMatrix(createEmptyTddEvidenceMatrix(["T1"]))).toEqual([
			expect.objectContaining({ reason: "blocked_missing_red_evidence", task_id: "T1" }),
			expect.objectContaining({ reason: "blocked_missing_green_evidence", task_id: "T1" }),
			expect.objectContaining({ reason: "blocked_missing_regression_evidence", task_id: "T1" }),
		]);
	});

	it("does not mutate the original matrix when appending evidence", () => {
		const matrix = createEmptyTddEvidenceMatrix(["T1"]);
		const appended = appendTddEvidence(matrix, "T1", "RED_EVIDENCE", command);

		expect(matrix.tasks.T1).toEqual([]);
		expect(appended.tasks.T1).toHaveLength(1);
		expect(appended).not.toBe(matrix);
		expect(appended.tasks).not.toBe(matrix.tasks);
	});

	it("creates a task bucket when appending evidence for an unknown task", () => {
		const matrix: TddEvidenceMatrix = { tasks: {} };
		const appended = appendTddEvidence(matrix, "T2", "RED_EVIDENCE", command);

		expect(appended.tasks.T2).toEqual([
			expect.objectContaining({
				kind: "RED_EVIDENCE",
				task_id: "T2",
			}),
		]);
		expect(matrix.tasks.T2).toBeUndefined();
	});
});
