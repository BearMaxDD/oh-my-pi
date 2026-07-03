import { describe, expect, it } from "bun:test";
import {
	type CodebaseMemoryTaskReindexEvidence,
	createOmpFixExecutionTask,
	type PlanExecutionBook,
	reviewTaskExecution,
	type SkillEvidenceMatrix,
	type TddEvidenceMatrix,
} from "../../src/codex-plan-run";

const book: PlanExecutionBook = {
	schema_version: 1,
	run_id: "run-123",
	created_at: "2026-06-23T00:00:00.000Z",
	plan: {
		path: "/repo/docs/superpowers/plans/demo.md",
		sha256: "abc123",
		repo_path: "/repo",
	},
	accepting_dir: "/repo/docs/superpowers/accepting/demo",
	intake_gate: [
		{ gate: "plan_path_exists", result: "PASS", evidence: "/repo/docs/superpowers/plans/demo.md" },
		{ gate: "plan_sha256_matches", result: "PASS", evidence: "abc123" },
		{ gate: "repo_path_valid", result: "PASS", evidence: "/repo" },
		{ gate: "skills_resolved", result: "PASS", evidence: "skills loaded" },
		{ gate: "project_recon_done", result: "PASS", evidence: "project recon present" },
	],
	project_recon: {
		repo_path: "/repo",
		relevant_modules: ["src/parser"],
		likely_files: ["src/parser/index.ts", "test/parser.test.ts"],
		existing_patterns: ["tests cover parser behavior"],
		test_commands: ["bun test test/parser.test.ts"],
		build_commands: ["bun run check:types"],
		style_conventions: ["small local changes"],
		risk_areas: ["parser callers"],
		forbidden_changes: ["src/cli.ts"],
		task_file_map: { T01: ["src/parser/index.ts", "test/parser.test.ts"] },
	},
	required_execution_skills: [
		{
			name: "test-driven-development",
			source_path: "/skills/test-driven-development/SKILL.md",
			content_sha256: "sha-exec",
			loaded_at: "2026-06-23T00:00:00.000Z",
			guidance: "Write a failing test first.",
		},
	],
	required_review_skills: [
		{
			name: "verification-before-completion",
			source_path: "/skills/verification-before-completion/SKILL.md",
			content_sha256: "sha-review",
			loaded_at: "2026-06-23T00:00:00.000Z",
			guidance: "Run verification commands before claiming completion.",
		},
	],
	final_tail_skills: [
		{
			name: "ponytail",
			source_path: "/skills/ponytail/SKILL.md",
			content_sha256: "sha-tail",
			loaded_at: "2026-06-23T00:00:00.000Z",
			guidance: "Keep the smallest acceptable change.",
		},
	],
	final_acceptance_commands: ["bun test test/parser.test.ts", "bun run check:types"],
	tasks: [
		{
			id: "T01",
			title: "Implement parser",
			source: "Plan section 2",
			todo: "Add parser behavior with tests.",
			execution_skills: ["test-driven-development"],
			review_skills: ["verification-before-completion"],
			final_tail_skills: ["ponytail"],
			allowed_files: ["src/parser/index.ts", "test/parser.test.ts"],
			forbidden_files: ["src/cli.ts"],
			smoke_commands: ["bun test test/parser.test.ts", "bun run check:types"],
			tdd_gates: {
				red: { command: "bun test test/parser.test.ts", expected: "FAIL", evidence_required: "RED_EVIDENCE" },
				green: { command: "bun test test/parser.test.ts", expected: "PASS", evidence_required: "GREEN_EVIDENCE" },
				regression: {
					command: "bun test test/parser.test.ts",
					expected: "PASS",
					evidence_required: "REGRESSION_EVIDENCE",
				},
			},
			advisor_watch_points: ["scope stays in parser files"],
			required_skill_evidence: ["test-driven-development"],
			skill_evidence: {
				execution: [
					{
						name: "test-driven-development",
						source_path: "/skills/test-driven-development/SKILL.md",
						content_sha256: "sha-exec",
						loaded_at: "2026-06-23T00:00:00.000Z",
						guidance: "Write a failing test first.",
					},
				],
				review: [
					{
						name: "verification-before-completion",
						source_path: "/skills/verification-before-completion/SKILL.md",
						content_sha256: "sha-review",
						loaded_at: "2026-06-23T00:00:00.000Z",
						guidance: "Run verification commands before claiming completion.",
					},
				],
				final_tail: [
					{
						name: "ponytail",
						source_path: "/skills/ponytail/SKILL.md",
						content_sha256: "sha-tail",
						loaded_at: "2026-06-23T00:00:00.000Z",
						guidance: "Keep the smallest acceptable change.",
					},
				],
			},
			implementation_analysis: "Use TDD and keep the parser change local.",
			execution_scope: {
				goal: "Implement parser behavior",
				allowed_files: ["src/parser/index.ts", "test/parser.test.ts"],
				forbidden_files: ["src/cli.ts"],
				likely_files: ["src/parser/index.ts", "test/parser.test.ts"],
				existing_patterns: ["parser tests"],
				out_of_scope: ["CLI redesign"],
			},
			implementation_steps: ["Add failing parser test", "Implement parser", "Run smoke commands"],
			review_gate: {
				acceptance_criteria: ["Parser tests pass"],
				smoke_commands: ["bun test test/parser.test.ts", "bun run check:types"],
				required_evidence: ["changed_files", "tests_run"],
				must_fix_conditions: ["Any required command fails", "Forbidden files changed"],
			},
		},
	],
};

const passingTddEvidenceMatrix: TddEvidenceMatrix = {
	tasks: {
		T01: [
			{
				kind: "RED_EVIDENCE",
				task_id: "T01",
				command: "bun test test/parser.test.ts",
				cwd: "/repo",
				exit_code: 1,
				started_at: "2026-06-23T00:00:00.000Z",
				completed_at: "2026-06-23T00:00:01.000Z",
				output_excerpt: "expected parser failure",
				evidence_file_path: "/repo/evidence/red.txt",
			},
			{
				kind: "GREEN_EVIDENCE",
				task_id: "T01",
				command: "bun test test/parser.test.ts",
				cwd: "/repo",
				exit_code: 0,
				started_at: "2026-06-23T00:00:02.000Z",
				completed_at: "2026-06-23T00:00:03.000Z",
				output_excerpt: "2 pass",
				evidence_file_path: "/repo/evidence/green.txt",
			},
			{
				kind: "REGRESSION_EVIDENCE",
				task_id: "T01",
				command: "bun test test/parser.test.ts",
				cwd: "/repo",
				exit_code: 0,
				started_at: "2026-06-23T00:00:04.000Z",
				completed_at: "2026-06-23T00:00:05.000Z",
				output_excerpt: "2 pass",
				evidence_file_path: "/repo/evidence/regression.txt",
			},
		],
	},
};

const readyReindexEvidence: CodebaseMemoryTaskReindexEvidence = {
	schema_version: 1,
	run_id: "run-123",
	task_id: "T01",
	repo_path: "/repo",
	project: "repo-project",
	mode: "fast",
	started_at: "2026-06-30T00:00:00.000Z",
	completed_at: "2026-06-30T00:00:01.000Z",
	status: "ready",
	index_repository: { attempted: true, exit_code: 0, output_excerpt: "indexed" },
	index_status: { status: "ready", project: "repo-project", nodes: 10, edges: 20 },
	changed_files: ["src/parser/index.ts", "test/parser.test.ts"],
	degraded_reason: null,
	jsonPath: "/accept/tasks/T01/codebase-memory-reindex.json",
	markdownPath: "/accept/tasks/T01/codebase-memory-reindex.md",
};

const completeSkillEvidenceMatrix: SkillEvidenceMatrix = {
	tasks: {
		T01: [
			{
				task_id: "T01",
				skill: "test-driven-development",
				source: "skill_loaded",
				evidence: "/skills/test-driven-development/SKILL.md",
				created_at: "2026-06-23T00:00:00.000Z",
			},
			{
				task_id: "T01",
				skill: "test-driven-development",
				source: "skill_declared_by_task_card",
				evidence: "required_skill_evidence",
				created_at: "2026-06-23T00:00:01.000Z",
			},
			{
				task_id: "T01",
				skill: "test-driven-development",
				source: "skill_claimed_by_subagent_output",
				evidence: "execution_skills_used",
				created_at: "2026-06-23T00:00:02.000Z",
			},
		],
	},
};

describe("task review protocol", () => {
	it("accepts a task only when scope, smoke commands, and evidence pass", () => {
		const review = reviewTaskExecution({
			book,
			taskId: "T01",
			tddEvidenceMatrix: passingTddEvidenceMatrix,
			skillEvidenceMatrix: completeSkillEvidenceMatrix,
			codebaseMemoryReindex: readyReindexEvidence,
			changedFiles: ["src/parser/index.ts", "test/parser.test.ts"],
			commands: [
				{ command: "bun test test/parser.test.ts", exit_code: 0, evidence: "2 pass" },
				{ command: "bun run check:types", exit_code: 0, evidence: "no emit" },
			],
			subagentOutput: {
				task_id: "T01",
				result: "completed",
				changed_files: ["src/parser/index.ts", "test/parser.test.ts"],
				tests_run: ["bun test test/parser.test.ts", "bun run check:types"],
				evidence: ["2 pass", "no emit"],
				execution_skills_used: ["test-driven-development"],
				final_tail_skills_used: ["ponytail"],
				scope_notes: ["No forbidden files touched"],
			},
		});

		expect(review.result).toBe("TASK_ACCEPTED");
		expect(review.plan_compliance).toBe("PASS");
		expect(review.scope_control).toBe("PASS");
		expect(review.smoke_tests).toBe("PASS");
		expect(review.evidence_quality).toBe("PASS");
		expect(review.must_fix_items).toEqual([]);
	});

	it("generates OmpFixExecutionTask when task review fails", () => {
		const review = reviewTaskExecution({
			book,
			taskId: "T01",
			tddEvidenceMatrix: passingTddEvidenceMatrix,
			skillEvidenceMatrix: completeSkillEvidenceMatrix,
			codebaseMemoryReindex: readyReindexEvidence,
			changedFiles: ["src/parser/index.ts", "src/cli.ts"],
			commands: [{ command: "bun test test/parser.test.ts", exit_code: 1, evidence: "1 failed" }],
			subagentOutput: {
				task_id: "T01",
				result: "completed",
				changed_files: ["src/parser/index.ts", "src/cli.ts"],
				tests_run: ["bun test test/parser.test.ts"],
				evidence: ["1 failed"],
				execution_skills_used: ["test-driven-development"],
				final_tail_skills_used: [],
				scope_notes: ["Changed CLI too"],
			},
		});
		const fixTask = createOmpFixExecutionTask(review, book);

		expect(review.result).toBe("TASK_FIX_REQUIRED");
		expect(review.scope_control).toBe("FAIL");
		expect(review.smoke_tests).toBe("FAIL");
		expect(fixTask.source_task_id).toBe("T01");
		expect(fixTask.must_fix_items.map(item => item.id)).toContain("forbidden_files_changed");
		expect(fixTask.must_fix_items.map(item => item.id)).toContain("required_command_failed");
		expect(fixTask.required_execution_skills).toEqual(["test-driven-development"]);
		expect(fixTask.required_review_skills).toEqual(["verification-before-completion"]);
		expect(fixTask.final_tail_skills).toEqual(["ponytail"]);
		expect(fixTask.required_commands).toEqual(["bun test test/parser.test.ts", "bun run check:types"]);
	});

	it("requires subagent output to include changed files and scope notes", () => {
		const review = reviewTaskExecution({
			book,
			taskId: "T01",
			tddEvidenceMatrix: passingTddEvidenceMatrix,
			skillEvidenceMatrix: completeSkillEvidenceMatrix,
			codebaseMemoryReindex: readyReindexEvidence,
			changedFiles: ["src/parser/index.ts"],
			commands: [
				{ command: "bun test test/parser.test.ts", exit_code: 0, evidence: "2 pass" },
				{ command: "bun run check:types", exit_code: 0, evidence: "no emit" },
			],
			subagentOutput: {
				task_id: "T01",
				result: "completed",
				changed_files: [],
				tests_run: ["bun test test/parser.test.ts", "bun run check:types"],
				evidence: ["2 pass", "no emit"],
				execution_skills_used: ["test-driven-development"],
				final_tail_skills_used: ["ponytail"],
				scope_notes: [],
			},
		});

		expect(review.result).toBe("TASK_FIX_REQUIRED");
		expect(review.must_fix_items.map(item => item.id)).toContain("changed_files_missing");
		expect(review.must_fix_items.map(item => item.id)).toContain("scope_notes_missing");
	});

	it("requires TDD evidence for the current task", () => {
		const review = reviewTaskExecution({
			book,
			taskId: "T01",
			tddEvidenceMatrix: { tasks: { T01: [] } },
			skillEvidenceMatrix: completeSkillEvidenceMatrix,
			codebaseMemoryReindex: readyReindexEvidence,
			changedFiles: ["src/parser/index.ts"],
			commands: [
				{ command: "bun test test/parser.test.ts", exit_code: 0, evidence: "2 pass" },
				{ command: "bun run check:types", exit_code: 0, evidence: "no emit" },
			],
			subagentOutput: {
				task_id: "T01",
				result: "completed",
				changed_files: ["src/parser/index.ts"],
				tests_run: ["bun test test/parser.test.ts", "bun run check:types"],
				evidence: ["2 pass", "no emit"],
				execution_skills_used: ["test-driven-development"],
				final_tail_skills_used: ["ponytail"],
				scope_notes: ["No forbidden files touched"],
			},
		});

		expect(review.result).toBe("TASK_FIX_REQUIRED");
		expect(review.must_fix_items.map(item => item.id)).toContain("missing_red_evidence");
	});

	it("requires a TDD evidence bucket for the current task", () => {
		const review = reviewTaskExecution({
			book,
			taskId: "T01",
			tddEvidenceMatrix: { tasks: {} },
			skillEvidenceMatrix: completeSkillEvidenceMatrix,
			codebaseMemoryReindex: readyReindexEvidence,
			changedFiles: ["src/parser/index.ts"],
			commands: [
				{ command: "bun test test/parser.test.ts", exit_code: 0, evidence: "2 pass" },
				{ command: "bun run check:types", exit_code: 0, evidence: "no emit" },
			],
			subagentOutput: {
				task_id: "T01",
				result: "completed",
				changed_files: ["src/parser/index.ts"],
				tests_run: ["bun test test/parser.test.ts", "bun run check:types"],
				evidence: ["2 pass", "no emit"],
				execution_skills_used: ["test-driven-development"],
				final_tail_skills_used: ["ponytail"],
				scope_notes: ["No forbidden files touched"],
			},
		});

		expect(review.result).toBe("TASK_FIX_REQUIRED");
		expect(review.must_fix_items.map(item => item.id)).toContain("missing_red_evidence");
	});

	it("requires a TDD evidence matrix before accepting a task", () => {
		const review = reviewTaskExecution({
			book,
			taskId: "T01",
			skillEvidenceMatrix: completeSkillEvidenceMatrix,
			codebaseMemoryReindex: readyReindexEvidence,
			changedFiles: ["src/parser/index.ts"],
			commands: [
				{ command: "bun test test/parser.test.ts", exit_code: 0, evidence: "2 pass" },
				{ command: "bun run check:types", exit_code: 0, evidence: "no emit" },
			],
			subagentOutput: {
				task_id: "T01",
				result: "completed",
				changed_files: ["src/parser/index.ts"],
				tests_run: ["bun test test/parser.test.ts", "bun run check:types"],
				evidence: ["2 pass", "no emit"],
				execution_skills_used: ["test-driven-development"],
				final_tail_skills_used: ["ponytail"],
				scope_notes: ["No forbidden files touched"],
			},
		});

		expect(review.result).toBe("TASK_FIX_REQUIRED");
		expect(review.must_fix_items.map(item => item.id)).toContain("tdd_evidence_matrix_missing");
	});

	it("requires required skill evidence for the current task", () => {
		const review = reviewTaskExecution({
			book,
			taskId: "T01",
			tddEvidenceMatrix: passingTddEvidenceMatrix,
			skillEvidenceMatrix: { tasks: { T01: [] } },
			codebaseMemoryReindex: readyReindexEvidence,
			changedFiles: ["src/parser/index.ts"],
			commands: [
				{ command: "bun test test/parser.test.ts", exit_code: 0, evidence: "2 pass" },
				{ command: "bun run check:types", exit_code: 0, evidence: "no emit" },
			],
			subagentOutput: {
				task_id: "T01",
				result: "completed",
				changed_files: ["src/parser/index.ts"],
				tests_run: ["bun test test/parser.test.ts", "bun run check:types"],
				evidence: ["2 pass", "no emit"],
				execution_skills_used: ["test-driven-development"],
				final_tail_skills_used: ["ponytail"],
				scope_notes: ["No forbidden files touched"],
			},
		});

		expect(review.result).toBe("TASK_FIX_REQUIRED");
		expect(review.must_fix_items.map(item => item.id)).toContain("skill_evidence_missing");
	});

	it("requires a skill evidence matrix before accepting a task", () => {
		const review = reviewTaskExecution({
			book,
			taskId: "T01",
			tddEvidenceMatrix: passingTddEvidenceMatrix,
			codebaseMemoryReindex: readyReindexEvidence,
			changedFiles: ["src/parser/index.ts"],
			commands: [
				{ command: "bun test test/parser.test.ts", exit_code: 0, evidence: "2 pass" },
				{ command: "bun run check:types", exit_code: 0, evidence: "no emit" },
			],
			subagentOutput: {
				task_id: "T01",
				result: "completed",
				changed_files: ["src/parser/index.ts"],
				tests_run: ["bun test test/parser.test.ts", "bun run check:types"],
				evidence: ["2 pass", "no emit"],
				execution_skills_used: ["test-driven-development"],
				final_tail_skills_used: ["ponytail"],
				scope_notes: ["No forbidden files touched"],
			},
		});

		expect(review.result).toBe("TASK_FIX_REQUIRED");
		expect(review.must_fix_items.map(item => item.id)).toContain("skill_evidence_matrix_missing");
	});

	it("rejects a task with advisor blocker findings", () => {
		const review = reviewTaskExecution({
			book,
			taskId: "T01",
			tddEvidenceMatrix: passingTddEvidenceMatrix,
			skillEvidenceMatrix: completeSkillEvidenceMatrix,
			codebaseMemoryReindex: readyReindexEvidence,
			changedFiles: ["src/parser/index.ts", "test/parser.test.ts"],
			commands: [
				{ command: "bun test test/parser.test.ts", exit_code: 0, evidence: "2 pass" },
				{ command: "bun run check:types", exit_code: 0, evidence: "no emit" },
			],
			subagentOutput: {
				task_id: "T01",
				result: "completed",
				changed_files: ["src/parser/index.ts", "test/parser.test.ts"],
				tests_run: ["bun test test/parser.test.ts", "bun run check:types"],
				evidence: ["2 pass", "no emit"],
				execution_skills_used: ["test-driven-development"],
				final_tail_skills_used: ["ponytail"],
				scope_notes: ["No forbidden files touched"],
			},
			advisorFindings: [
				{
					schema_version: 1,
					run_id: "run-123",
					task_id: "T01",
					severity: "blocker",
					category: "evidence",
					finding: "Missing green evidence for TDD cycle",
					evidence: ".omp/plan-runs/run-123/events.jsonl",
					required_action: "Re-run TDD green step",
				},
			],
		});

		expect(review.result).toBe("TASK_FIX_REQUIRED");
		expect(review.evidence_quality).toBe("FAIL");
		expect(review.must_fix_items.some(item => item.id === "advisor_blocker_evidence")).toBe(true);
		const blockerItem = review.must_fix_items.find(item => item.id === "advisor_blocker_evidence");
		expect(blockerItem?.description).toBe("Re-run TDD green step");
		expect(blockerItem?.evidence).toBe(".omp/plan-runs/run-123/events.jsonl");
	});
	it("requires Codebase Memory reindex evidence before TASK_ACCEPTED", () => {
		const review = reviewTaskExecution({
			book,
			taskId: "T01",
			tddEvidenceMatrix: passingTddEvidenceMatrix,
			skillEvidenceMatrix: completeSkillEvidenceMatrix,
			changedFiles: ["src/parser/index.ts", "test/parser.test.ts"],
			commands: [
				{ command: "bun test test/parser.test.ts", exit_code: 0, evidence: "2 pass" },
				{ command: "bun run check:types", exit_code: 0, evidence: "no emit" },
			],
			subagentOutput: {
				task_id: "T01",
				result: "completed",
				changed_files: ["src/parser/index.ts", "test/parser.test.ts"],
				tests_run: ["bun test test/parser.test.ts", "bun run check:types"],
				evidence: ["2 pass", "no emit"],
				execution_skills_used: ["test-driven-development"],
				final_tail_skills_used: ["ponytail"],
				scope_notes: ["No forbidden files touched"],
			},
		});

		expect(review.result).toBe("TASK_FIX_REQUIRED");
		expect(review.must_fix_items.map(item => item.id)).toContain("codebase_memory_reindex_missing");
	});

	it("blocks TASK_ACCEPTED when Codebase Memory reindex failed", () => {
		const review = reviewTaskExecution({
			book,
			taskId: "T01",
			tddEvidenceMatrix: passingTddEvidenceMatrix,
			skillEvidenceMatrix: completeSkillEvidenceMatrix,
			codebaseMemoryReindex: {
				...readyReindexEvidence,
				status: "failed",
				degraded_reason: "index_repository_failed",
			},
			changedFiles: ["src/parser/index.ts", "test/parser.test.ts"],
			commands: [
				{ command: "bun test test/parser.test.ts", exit_code: 0, evidence: "2 pass" },
				{ command: "bun run check:types", exit_code: 0, evidence: "no emit" },
			],
			subagentOutput: {
				task_id: "T01",
				result: "completed",
				changed_files: ["src/parser/index.ts", "test/parser.test.ts"],
				tests_run: ["bun test test/parser.test.ts", "bun run check:types"],
				evidence: ["2 pass", "no emit"],
				execution_skills_used: ["test-driven-development"],
				final_tail_skills_used: ["ponytail"],
				scope_notes: ["No forbidden files touched"],
			},
		});

		expect(review.result).toBe("TASK_FIX_REQUIRED");
		expect(review.must_fix_items).toContainEqual({
			id: "codebase_memory_reindex_failed",
			description: "Codebase Memory reindex evidence is failed or invalid.",
			evidence: "Codebase Memory reindex status failed for task T01",
		});
	});

	it("rejects Codebase Memory reindex evidence for a different task", () => {
		const review = reviewTaskExecution({
			book,
			taskId: "T01",
			tddEvidenceMatrix: passingTddEvidenceMatrix,
			skillEvidenceMatrix: completeSkillEvidenceMatrix,
			codebaseMemoryReindex: { ...readyReindexEvidence, task_id: "T02" },
			changedFiles: ["src/parser/index.ts", "test/parser.test.ts"],
			commands: [
				{ command: "bun test test/parser.test.ts", exit_code: 0, evidence: "2 pass" },
				{ command: "bun run check:types", exit_code: 0, evidence: "no emit" },
			],
			subagentOutput: {
				task_id: "T01",
				result: "completed",
				changed_files: ["src/parser/index.ts", "test/parser.test.ts"],
				tests_run: ["bun test test/parser.test.ts", "bun run check:types"],
				evidence: ["2 pass", "no emit"],
				execution_skills_used: ["test-driven-development"],
				final_tail_skills_used: ["ponytail"],
				scope_notes: ["No forbidden files touched"],
			},
		});

		expect(review.result).toBe("TASK_FIX_REQUIRED");
		expect(review.must_fix_items[0]?.evidence).toContain("does not match reviewed task T01");
	});
});
