import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type {
	CodebaseMemoryReconProvider,
	PlanExecutionBook,
	SkillEvidenceMatrix,
	TddEvidenceMatrix,
} from "../../src/codex-plan-run";
import {
	createOmpFixExecutionTaskFromMainAcceptance,
	type MainThreadAcceptanceReviewRequest,
	renderMainThreadAcceptanceCompletionSections,
	runMainThreadAcceptanceReview,
} from "../../src/codex-plan-run/main-acceptance-review";
import type { StageManifestEntry } from "../../src/codex-plan-run/stage-ledger";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "omp-main-acceptance-cbm-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) {
		await rm(dir, { recursive: true, force: true });
	}
});

const book: PlanExecutionBook = {
	schema_version: 1,
	run_id: "run-123",
	created_at: "2026-06-24T00:00:00.000Z",
	plan: {
		path: "/repo/docs/superpowers/plans/demo.md",
		sha256: "abc123",
		repo_path: "/repo",
	},
	accepting_dir: "/repo/docs/superpowers/accepting/demo",
	intake_gate: [{ gate: "plan_sha256_matches", result: "PASS", evidence: "abc123" }],
	project_recon: {
		repo_path: "/repo",
		relevant_modules: ["src/codex-plan-run"],
		likely_files: ["src/codex-plan-run/main-acceptance-review.ts"],
		existing_patterns: ["pure gate functions"],
		test_commands: ["bun test test/codex-plan-run/main-acceptance-review.test.ts"],
		build_commands: ["bun run check:types"],
		style_conventions: ["keep gate checks deterministic"],
		risk_areas: ["stale evidence"],
		forbidden_changes: ["docs/forbidden.md"],
		task_file_map: { T01: ["src/codex-plan-run/main-acceptance-review.ts"] },
	},
	required_execution_skills: [
		{
			name: "test-driven-development",
			source_path: "/skills/test-driven-development/SKILL.md",
			content_sha256: "skill-sha",
			loaded_at: "2026-06-24T00:00:00.000Z",
			guidance: "Write a failing test first.",
		},
	],
	required_review_skills: [
		{
			name: "requesting-code-review",
			source_path: "/skills/requesting-code-review/SKILL.md",
			content_sha256: "review-sha",
			loaded_at: "2026-06-24T00:00:00.000Z",
			guidance: "Review completed work.",
		},
	],
	final_tail_skills: [
		{
			name: "verification-before-completion",
			source_path: "/skills/verification-before-completion/SKILL.md",
			content_sha256: "verify-sha",
			loaded_at: "2026-06-24T00:00:00.000Z",
			guidance: "Run verification commands before claiming completion.",
		},
	],
	final_acceptance_commands: ["bun test test/codex-plan-run/main-acceptance-review.test.ts", "bun run check:types"],
	tasks: [
		{
			id: "T01",
			title: "Add main acceptance gate",
			source: "Plan section 1",
			todo: "Implement main-thread acceptance review.",
			execution_skills: ["test-driven-development"],
			review_skills: ["requesting-code-review"],
			final_tail_skills: ["verification-before-completion"],
			allowed_files: [
				"src/codex-plan-run/main-acceptance-review.ts",
				"test/codex-plan-run/main-acceptance-review.test.ts",
			],
			forbidden_files: ["docs/forbidden.md"],
			smoke_commands: ["bun test test/codex-plan-run/main-acceptance-review.test.ts"],
			tdd_gates: {
				red: {
					command: "bun test test/codex-plan-run/main-acceptance-review.test.ts",
					expected: "FAIL",
					evidence_required: "RED_EVIDENCE",
				},
				green: {
					command: "bun test test/codex-plan-run/main-acceptance-review.test.ts",
					expected: "PASS",
					evidence_required: "GREEN_EVIDENCE",
				},
				regression: {
					command: "bun test test/codex-plan-run/main-acceptance-review.test.ts",
					expected: "PASS",
					evidence_required: "REGRESSION_EVIDENCE",
				},
			},
			advisor_watch_points: ["main acceptance must block unresolved advisor blockers"],
			required_skill_evidence: ["test-driven-development"],
			skill_evidence: {
				execution: [],
				review: [],
				final_tail: [],
			},
			implementation_analysis:
				"execution skills read\nrelevant guidance extracted\nimplementation approach\nrisks\nsmallest acceptable change",
			execution_scope: {
				goal: "Implement main-thread acceptance review.",
				allowed_files: [
					"src/codex-plan-run/main-acceptance-review.ts",
					"test/codex-plan-run/main-acceptance-review.test.ts",
				],
				forbidden_files: ["docs/forbidden.md"],
				likely_files: ["src/codex-plan-run/main-acceptance-review.ts"],
				existing_patterns: ["pure gate functions"],
				out_of_scope: ["unrelated refactors"],
			},
			implementation_steps: ["Write tests", "Implement gate"],
			review_gate: {
				acceptance_criteria: ["Main acceptance runs before packet generation"],
				smoke_commands: ["bun test test/codex-plan-run/main-acceptance-review.test.ts"],
				required_evidence: ["command evidence"],
				must_fix_conditions: ["missing evidence"],
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
				command: "bun test test/codex-plan-run/main-acceptance-review.test.ts",
				cwd: "/repo",
				exit_code: 1,
				started_at: "2026-06-24T00:00:00.000Z",
				completed_at: "2026-06-24T00:00:01.000Z",
				output_excerpt: "expected failing acceptance test",
				evidence_file_path: "/repo/evidence/red.txt",
			},
			{
				kind: "GREEN_EVIDENCE",
				task_id: "T01",
				command: "bun test test/codex-plan-run/main-acceptance-review.test.ts",
				cwd: "/repo",
				exit_code: 0,
				started_at: "2026-06-24T00:00:02.000Z",
				completed_at: "2026-06-24T00:00:03.000Z",
				output_excerpt: "pass",
				evidence_file_path: "/repo/evidence/green.txt",
			},
			{
				kind: "REGRESSION_EVIDENCE",
				task_id: "T01",
				command: "bun test test/codex-plan-run/main-acceptance-review.test.ts",
				cwd: "/repo",
				exit_code: 0,
				started_at: "2026-06-24T00:00:04.000Z",
				completed_at: "2026-06-24T00:00:05.000Z",
				output_excerpt: "pass",
				evidence_file_path: "/repo/evidence/regression.txt",
			},
		],
	},
};

const completeSkillEvidenceMatrix: SkillEvidenceMatrix = {
	tasks: {
		T01: [
			{
				task_id: "T01",
				skill: "test-driven-development",
				source: "skill_loaded",
				evidence: "/skills/test-driven-development/SKILL.md",
				created_at: "2026-06-24T00:00:00.000Z",
			},
			{
				task_id: "T01",
				skill: "test-driven-development",
				source: "skill_declared_by_task_card",
				evidence: "required_skill_evidence",
				created_at: "2026-06-24T00:00:01.000Z",
			},
			{
				task_id: "T01",
				skill: "test-driven-development",
				source: "skill_claimed_by_subagent_output",
				evidence: "task output",
				created_at: "2026-06-24T00:00:02.000Z",
			},
		],
	},
};

function request(overrides: Partial<MainThreadAcceptanceReviewRequest> = {}): MainThreadAcceptanceReviewRequest {
	return {
		runId: "run-123",
		reviewRound: 1,
		repoPath: "/repo",
		worktreePath: "/repo/.worktrees/run",
		planPath: "/repo/docs/superpowers/plans/demo.md",
		planSha256: "abc123",
		acceptingDir: "/repo/docs/superpowers/accepting/demo",
		executionBookPath: "/repo/docs/superpowers/accepting/demo/plan-execution-book.md",
		manifestPath: "/repo/docs/superpowers/accepting/demo/manifest.json",
		completionDocPath: "/repo/docs/superpowers/accepting/demo/omp-completion.md",
		todoSnapshot: {
			runId: "run-123",
			version: 1,
			state: "main_acceptance_review_running",
			updatedAt: "2026-06-24T00:00:00.000Z",
			source: "state-machine",
			phases: [
				{
					name: "Plan Execution Book Tasks",
					tasks: [{ content: "T01 Add main acceptance gate", status: "completed" }],
				},
			],
		},
		executionBook: book,
		taskOutputs: [
			{
				task_id: "T01",
				result: "completed",
				subagent_id: "subagent-1",
				summary: "Implemented gate.",
				files_changed: ["src/codex-plan-run/main-acceptance-review.ts"],
				commands_run: [
					{
						command: "bun test test/codex-plan-run/main-acceptance-review.test.ts",
						exit_code: 0,
						cwd: "/repo",
						started_at: "2026-06-24T00:00:00.000Z",
						completed_at: "2026-06-24T00:00:01.000Z",
						output_excerpt: "pass",
					},
				],
				evidence_files: ["/repo/docs/superpowers/accepting/demo/T01.md"],
				review_skills_used: ["requesting-code-review"],
				final_tail_skills_used: ["verification-before-completion"],
			},
		],
		taskReviewRecords: [
			{
				task_id: "T01",
				review_skills_used: ["requesting-code-review"],
				final_tail_skills_used: ["verification-before-completion"],
				plan_compliance: "PASS",
				scope_control: "PASS",
				smoke_tests: "PASS",
				evidence_quality: "PASS",
				over_implementation_check: "PASS",
				result: "TASK_ACCEPTED",
				must_fix_items: [],
			},
		],
		verificationCommands: [
			{
				command: "bun test test/codex-plan-run/main-acceptance-review.test.ts",
				exit_code: 0,
				cwd: "/repo",
				started_at: "2026-06-24T00:00:00.000Z",
				completed_at: "2026-06-24T00:00:01.000Z",
				output_excerpt: "pass",
			},
			{
				command: "bun run check:types",
				exit_code: 0,
				cwd: "/repo",
				started_at: "2026-06-24T00:00:02.000Z",
				completed_at: "2026-06-24T00:00:03.000Z",
				output_excerpt: "pass",
			},
		],
		finalAcceptanceCommands: ["bun test test/codex-plan-run/main-acceptance-review.test.ts", "bun run check:types"],
		gitDiffSummary: {
			changed_files: ["src/codex-plan-run/main-acceptance-review.ts"],
			forbidden_files_changed: [],
		},
		tddEvidenceMatrix: passingTddEvidenceMatrix,
		skillEvidenceMatrix: completeSkillEvidenceMatrix,
		advisorSummary: { items: [] },
		manifestExtensions: {
			codebase_memory: {
				execution_recon: "/repo/docs/superpowers/accepting/demo/codebase-memory-recon.json",
				reindex_summary: "/repo/docs/superpowers/accepting/demo/codebase-memory-reindex-summary.json",
				tasks: {
					T01: {
						status: "ready",
						jsonPath: "/repo/docs/superpowers/accepting/demo/tasks/T01/codebase-memory-reindex.json",
					},
				},
			},
			advisor: { subagents_enabled: true, summary: "/repo/docs/superpowers/accepting/demo/advisor-summary.json" },
			model_routing: {
				tasks: {
					T01: {
						resolved_model: "anthropic/claude-sonnet-4",
						model_role: "superpowers:implementer",
						evidence_path: "/repo/docs/superpowers/accepting/demo/tasks/T01/model-routing-evidence.json",
					},
				},
			},
			superpowers: { codebase_memory_gate_mode: "advisory" },
			settings: {
				execution_loop: {
					runtimeScenario: { browser: { enabled: true }, api: { enabled: true }, database: { enabled: false } },
					classification: { enabled: true, requireReviewerEvidence: true },
				},
			},
			role_bound_execution: {
				enabled: true,
				role_registry_snapshot_path: "/repo/docs/superpowers/accepting/demo/role-registry-snapshot.json",
				spec_task_framework_path: "/repo/docs/superpowers/accepting/demo/spec-task-framework.json",
				spec_task_framework_sha256: "framework-sha",
				actual_spec_task_framework_sha256: "framework-sha",
				stages: completeStageManifestEntries(),
				classification_summary: {
					tasks: {
						T01: {
							runtime_surface: "browser",
							requires_frontend_design: true,
							requires_security_review: false,
							requires_payment_review: false,
							requires_data_migration_review: false,
							requires_destructive_operation_review: false,
							evidence_paths: ["/repo/docs/superpowers/accepting/demo/T01.md"],
						},
					},
					specialized_reviews: [
						{
							type: "requires_frontend_design",
							evidence_paths: ["/repo/docs/superpowers/accepting/demo/T01.md"],
						},
					],
				},
				classification_summary_json: JSON.stringify({
					tasks: {
						T01: {
							runtime_surface: "browser",
							requires_frontend_design: true,
							requires_security_review: false,
							requires_payment_review: false,
							requires_data_migration_review: false,
							requires_destructive_operation_review: false,
							evidence_paths: ["/repo/docs/superpowers/accepting/demo/T01.md"],
						},
					},
					specialized_reviews: [
						{
							type: "requires_frontend_design",
							evidence_paths: ["/repo/docs/superpowers/accepting/demo/T01.md"],
						},
					],
				}),
			},
			prompt_packs: {
				generated: true,
				prompt_pack_paths: ["/repo/docs/superpowers/accepting/demo/prompt-packs/T01.json"],
			},
			advisor_gate: {
				enabled: true,
				records_path: "/repo/docs/superpowers/accepting/demo/advisor-gate-records.json",
				blocking_findings: 0,
			},
			global_impact: {
				enabled: true,
				report_path: "/repo/docs/superpowers/accepting/demo/global-impact-report.json",
				status: "accepted",
			},
			real_business_simulation: {
				enabled: true,
				environment_plan_path: "/repo/docs/superpowers/accepting/demo/runtime-environment-plan.json",
				scenario_plan_path: "/repo/docs/superpowers/accepting/demo/runtime-scenario-plan.json",
				report_path: "/repo/docs/superpowers/accepting/demo/real-runtime-simulation-report.json",
				cleanup_report_path: "/repo/docs/superpowers/accepting/demo/runtime-cleanup-report.md",
				status: "passed",
				runtimeScenario: { browser: { enabled: true }, api: { enabled: true }, database: { enabled: false } },
			},
		},
		...overrides,
	};
}

function completeStageManifestEntries(): Record<string, StageManifestEntry> {
	const stageIds = ["tdd-writer", "implementer", "test-runner", "spec-reviewer", "quality-reviewer", "acceptance"];
	const entries: Record<string, StageManifestEntry> = {};
	for (const stageId of stageIds) {
		entries[`T01:${stageId}`] = {
			output_path: `/repo/docs/superpowers/accepting/demo/tasks/T01/stages/${stageId}/output.json`,
			model_routing_path: `/repo/docs/superpowers/accepting/demo/tasks/T01/stages/${stageId}/model-routing-evidence.json`,
			advisor_gate_paths: [
				`/repo/docs/superpowers/accepting/demo/tasks/T01/stages/${stageId}/advisor-gates/after_stage.json`,
			],
			status: "accepted",
		};
	}
	return entries;
}

describe("MainThreadAcceptanceReview", () => {
	it("accepts only when every task, review record, command, and scope check passes", async () => {
		const result = await runMainThreadAcceptanceReview(request());

		expect(result).toMatchObject({
			result: "MAIN_ACCEPTANCE_ACCEPTED",
			review_round: 1,
			must_fix_items: [],
			next_allowed: "CodexReviewRequestPacket",
		});
	});

	it("requires final acceptance commands to exist and pass", async () => {
		const result = await runMainThreadAcceptanceReview(
			request({
				verificationCommands: [
					{
						command: "bun test test/codex-plan-run/main-acceptance-review.test.ts",
						exit_code: 1,
						cwd: "/repo",
						started_at: "2026-06-24T00:00:00.000Z",
						completed_at: "2026-06-24T00:00:01.000Z",
						output_excerpt: "fail",
					},
				],
			}),
		);

		expect(result.result).toBe("MAIN_ACCEPTANCE_FIX_REQUIRED");
		expect(result.must_fix_items).toContainEqual(
			expect.objectContaining({
				category: "verification",
				required_commands: ["bun test test/codex-plan-run/main-acceptance-review.test.ts"],
			}),
		);
	});

	it("rejects stale PASS and placeholder evidence", async () => {
		const result = await runMainThreadAcceptanceReview(
			request({
				verificationCommands: [
					{
						command: "bun test test/codex-plan-run/main-acceptance-review.test.ts",
						exit_code: 0,
						cwd: "/repo",
						started_at: "2026-06-24T00:00:00.000Z",
						completed_at: "2026-06-24T00:00:01.000Z",
						output_excerpt: "inherited PASS from previous round",
					},
				],
			}),
		);

		expect(result.result).toBe("MAIN_ACCEPTANCE_FIX_REQUIRED");
		expect(result.must_fix_items).toContainEqual(expect.objectContaining({ category: "evidence" }));
	});

	it("rejects forbidden file changes from the original task scope", async () => {
		const result = await runMainThreadAcceptanceReview(
			request({
				gitDiffSummary: {
					changed_files: ["docs/forbidden.md"],
					forbidden_files_changed: ["docs/forbidden.md"],
				},
			}),
		);

		expect(result.result).toBe("MAIN_ACCEPTANCE_FIX_REQUIRED");
		expect(result.must_fix_items).toContainEqual(
			expect.objectContaining({ category: "scope", authorized_files: book.tasks[0]?.execution_scope.allowed_files }),
		);
	});

	it("rejects Codebase Memory acceptance findings from the final architecture review", async () => {
		const repo = await makeTempDir();
		const provider: CodebaseMemoryReconProvider = {
			async getProjectStatus() {
				return {
					indexed: true,
					project: "Users-demo-repo",
					rootPath: repo,
					nodeCount: 42,
					edgeCount: 100,
				};
			},
			async getArchitecture() {
				return {
					relevantModules: ["src/codex-plan-run"],
					existingPatterns: ["Main acceptance changes stay in codex-plan-run gate modules."],
					riskAreas: ["acceptance bypass"],
				};
			},
			async searchTaskContext({ task }) {
				return {
					taskId: task.id,
					files: ["src/codex-plan-run/main-acceptance-review.ts"],
					symbols: [],
					patterns: ["Use existing MainThreadAcceptanceReview must-fix categories."],
					risks: [],
				};
			},
			async reviewAcceptance() {
				return {
					findings: [
						{
							id: "CBM-SCOPE-BYPASS",
							severity: "must_fix",
							category: "scope",
							description: "Changed file is outside the Codebase Memory task context.",
							evidence: "src/unrelated/bypass.ts is not near the accepted call graph.",
							requiredFix: "Move the change into the authorized gate module or update the plan evidence.",
							affectedTasks: ["T01"],
							authorizedFiles: ["src/codex-plan-run/main-acceptance-review.ts"],
						},
					],
				};
			},
		};

		const result = await runMainThreadAcceptanceReview(
			request({
				repoPath: repo,
				acceptingDir: join(repo, "docs", "superpowers", "accepting", "demo"),
				gitDiffSummary: {
					changed_files: ["src/unrelated/bypass.ts"],
					forbidden_files_changed: [],
				},
				codebaseMemory: {
					enabled: true,
					provider,
				},
			}),
		);

		expect(result.result).toBe("MAIN_ACCEPTANCE_FIX_REQUIRED");
		expect(result.must_fix_items).toContainEqual(
			expect.objectContaining({
				id: "MF-CBM-SCOPE-BYPASS",
				category: "scope",
				evidence: "src/unrelated/bypass.ts is not near the accepted call graph.",
			}),
		);
	});

	it("supports the 16.1.7 Codebase Memory provider contract when acceptance review is absent", async () => {
		const repo = await makeTempDir();
		const seen: string[] = [];
		const provider: CodebaseMemoryReconProvider = {
			async getProjectStatus({ repoPath }) {
				seen.push(`status:${repoPath}`);
				return {
					indexed: true,
					project: "Users-demo-repo",
					rootPath: repo,
					nodeCount: 42,
					edgeCount: 100,
				};
			},
			async getArchitecture({ project, repoPath }) {
				seen.push(`architecture:${project}:${repoPath}`);
				return {
					relevantModules: ["src/codex-plan-run"],
					existingPatterns: ["Main acceptance changes stay in codex-plan-run gate modules."],
					riskAreas: [],
				};
			},
			async searchTaskContext({ project, repoPath, task }) {
				seen.push(`task:${project}:${repoPath}:${task.id}`);
				return {
					taskId: task.id,
					files: ["src/codex-plan-run/main-acceptance-review.ts"],
					symbols: [],
					patterns: ["Use existing MainThreadAcceptanceReview must-fix categories."],
					risks: [],
				};
			},
		};

		const result = await runMainThreadAcceptanceReview(
			request({
				repoPath: repo,
				acceptingDir: join(repo, "docs", "superpowers", "accepting", "demo"),
				codebaseMemory: {
					enabled: true,
					provider,
				},
			}),
		);

		expect(result.result).toBe("MAIN_ACCEPTANCE_ACCEPTED");
		expect(seen).toEqual([
			`status:${repo}`,
			`architecture:Users-demo-repo:${repo}`,
			`task:Users-demo-repo:${repo}:T01`,
		]);
	});

	it("turns must-fix findings into a bounded OmpFixExecutionTask", async () => {
		const review = await runMainThreadAcceptanceReview(
			request({
				finalAcceptanceCommands: ["bun test"],
				verificationCommands: [],
			}),
		);
		const task = createOmpFixExecutionTaskFromMainAcceptance(review, request());

		expect(task).toMatchObject({
			packet_type: "OmpFixExecutionTask",
			packet_version: 1,
			source: "MainThreadAcceptanceReview",
			original_plan_path: "/repo/docs/superpowers/plans/demo.md",
			original_plan_sha256: "abc123",
			repo_path: "/repo",
			omp_worktree: "/repo/.worktrees/run",
			accepting_dir: "/repo/docs/superpowers/accepting/demo",
			feedback_round: 1,
			main_review_round: 1,
		});
		expect(task.fix_tasks[0]).toMatchObject({
			source_must_fix_id: expect.any(String),
			red_command: "bun test",
			green_command: "bun test",
		});
		expect(task.authorized_scope.allowed_files).toContain("src/codex-plan-run/main-acceptance-review.ts");
	});

	it("renders the required omp-completion.md main acceptance sections", async () => {
		const accepted = await runMainThreadAcceptanceReview(request(), new Date("2026-06-24T00:00:00.000Z"));
		const markdown = renderMainThreadAcceptanceCompletionSections({
			result: accepted,
			evidencePath: "accepting/main-acceptance-review.json",
			finalAcceptanceCommands: [
				{ command: "bun test test/codex-plan-run/main-acceptance-review.test.ts", exit_code: 0 },
				{ command: "bun run check:types", exit_code: 0 },
			],
			fixRounds: [],
		});

		expect(markdown).toContain("## MainThreadAcceptanceReview");
		expect(markdown).toContain("- result: MAIN_ACCEPTANCE_ACCEPTED");
		expect(markdown).toContain("- evidence: accepting/main-acceptance-review.json");
		expect(markdown).toContain("## MainThreadAcceptance Fix Rounds");
		expect(markdown).toContain("must_fix_count: 0");
		expect(markdown).toContain("| round | result | must_fix_count | fix_task | regression |");
		expect(markdown).toContain("bun run check:types -> PASS");
	});

	it("requires TDD evidence and resolved advisor blockers", async () => {
		const result = await runMainThreadAcceptanceReview(
			request({
				tddEvidenceMatrix: { tasks: { T01: [] } },
				skillEvidenceMatrix: { tasks: { T01: [] } },
				advisorSummary: {
					items: [{ severity: "blocker", status: "open", message: "missing red evidence", turn_id: 4 }],
				},
			}),
		);

		expect(result.result).toBe("MAIN_ACCEPTANCE_FIX_REQUIRED");
		expect(result.must_fix_items.map(item => item.id)).toContain("missing_red_evidence");
		expect(result.must_fix_items.map(item => item.id)).toContain("advisor_blocker_unresolved");
	});

	it("requires a TDD evidence bucket for every execution book task", async () => {
		const result = await runMainThreadAcceptanceReview(
			request({
				tddEvidenceMatrix: { tasks: {} },
			}),
		);

		expect(result.result).toBe("MAIN_ACCEPTANCE_FIX_REQUIRED");
		expect(result.must_fix_items.map(item => item.id)).toContain("missing_red_evidence");
	});

	it("requires TDD evidence matrix, skill evidence matrix, and advisor summary artifacts", async () => {
		const result = await runMainThreadAcceptanceReview(
			request({
				tddEvidenceMatrix: undefined,
				skillEvidenceMatrix: undefined,
				advisorSummary: undefined,
			}),
		);

		expect(result.result).toBe("MAIN_ACCEPTANCE_FIX_REQUIRED");
		expect(result.must_fix_items.map(item => item.id)).toEqual(
			expect.arrayContaining([
				"tdd_evidence_matrix_missing",
				"skill_evidence_matrix_missing",
				"advisor_summary_missing",
			]),
		);
	});

	it("requires skill evidence matrix entries before final acceptance", async () => {
		const result = await runMainThreadAcceptanceReview(
			request({
				skillEvidenceMatrix: { tasks: { T01: [] } },
			}),
		);

		expect(result.result).toBe("MAIN_ACCEPTANCE_FIX_REQUIRED");
		expect(result.must_fix_items.some(item => item.id.startsWith("skill_evidence_missing"))).toBe(true);
	});

	it("creates stable unique fix task ids for repeated skill evidence findings", async () => {
		const review = await runMainThreadAcceptanceReview(
			request({
				skillEvidenceMatrix: { tasks: { T01: [] } },
			}),
		);
		const task = createOmpFixExecutionTaskFromMainAcceptance(review, request());
		const ids = task.fix_tasks.map(fixTask => fixTask.id);

		expect(new Set(ids).size).toBe(ids.length);
	});
	it("requires every accepted task to include PlanRun evidence extension artifacts", async () => {
		const result = await runMainThreadAcceptanceReview(
			request({
				manifestExtensions: {
					codebase_memory: {
						execution_recon: "/repo/docs/superpowers/accepting/demo/codebase-memory-recon.json",
						reindex_summary: "/repo/docs/superpowers/accepting/demo/codebase-memory-reindex-summary.json",
						tasks: {},
					},
					advisor: { subagents_enabled: true },
					model_routing: { tasks: {} },
					superpowers: {},
				},
			}),
		);

		expect(result.result).toBe("MAIN_ACCEPTANCE_FIX_REQUIRED");
		if (result.result === "MAIN_ACCEPTANCE_FIX_REQUIRED") {
			const ids = result.must_fix_items.map(item => item.id);
			expect(ids).toContain("MF-CODEBASE-MEMORY-REINDEX-T01");
			expect(ids).toContain("MF-MODEL-ROUTING-T01");
			expect(ids).toContain("MF-ADVISOR-SUMMARY");
			expect(ids).toContain("MF-SUPERPOWERS-CODEBASE-MEMORY-GATE");
		}
	});

	it("requires model routing evidence paths for every accepted task", async () => {
		const result = await runMainThreadAcceptanceReview(
			request({
				manifestExtensions: {
					codebase_memory: {
						execution_recon: "/repo/docs/superpowers/accepting/demo/codebase-memory-recon.json",
						reindex_summary: "/repo/docs/superpowers/accepting/demo/codebase-memory-reindex-summary.json",
						tasks: {
							T01: {
								status: "ready",
								jsonPath: "/repo/docs/superpowers/accepting/demo/tasks/T01/codebase-memory-reindex.json",
							},
						},
					},
					advisor: {
						subagents_enabled: true,
						summary: "/repo/docs/superpowers/accepting/demo/advisor-summary.json",
					},
					model_routing: { tasks: { T01: { resolved_model: "anthropic/claude-sonnet-4" } } },
					superpowers: { codebase_memory_gate_mode: "advisory" },
				},
			}),
		);

		expect(result.result).toBe("MAIN_ACCEPTANCE_FIX_REQUIRED");
		if (result.result === "MAIN_ACCEPTANCE_FIX_REQUIRED") {
			expect(result.must_fix_items.map(item => item.id)).toContain("MF-MODEL-ROUTING-T01");
		}
	});

	it("rejects missing or blocked role-bound execution evidence hard gates", async () => {
		const result = await runMainThreadAcceptanceReview(
			request({
				manifestExtensions: {
					codebase_memory: {
						execution_recon: "/repo/docs/superpowers/accepting/demo/codebase-memory-recon.json",
						reindex_summary: "/repo/docs/superpowers/accepting/demo/codebase-memory-reindex-summary.json",
						tasks: {
							T01: {
								status: "ready",
								jsonPath: "/repo/docs/superpowers/accepting/demo/tasks/T01/codebase-memory-reindex.json",
							},
						},
					},
					advisor: {
						subagents_enabled: true,
						summary: "/repo/docs/superpowers/accepting/demo/advisor-summary.json",
					},
					model_routing: {
						tasks: {
							T01: {
								resolved_model: "anthropic/claude-sonnet-4",
								model_role: "superpowers:implementer",
								evidence_path: "/repo/docs/superpowers/accepting/demo/tasks/T01/model-routing-evidence.json",
							},
						},
					},
					superpowers: { codebase_memory_gate_mode: "advisory" },
					role_bound_execution: { enabled: true },
					prompt_packs: { generated: true, prompt_pack_paths: [] },
					advisor_gate: {
						enabled: true,
						records_path: "/repo/docs/superpowers/accepting/demo/advisor-gate-records.json",
						blocking_findings: 2,
					},
					global_impact: { enabled: true, status: "repair_required" },
					real_business_simulation: { enabled: true, status: "blocked" },
				},
			}),
		);

		expect(result.result).toBe("MAIN_ACCEPTANCE_FIX_REQUIRED");
		if (result.result === "MAIN_ACCEPTANCE_FIX_REQUIRED") {
			const ids = result.must_fix_items.map(item => item.id);
			expect(ids).toContain("MF-MISSING-SPEC-TASK-FRAMEWORK");
			expect(ids).toContain("MF-MISSING-PROMPT-PACK");
			expect(ids).toContain("MF-MISSING-ADVISOR-GATE");
			expect(ids).toContain("MF-GLOBAL-IMPACT-REPAIR-REQUIRED");
			expect(ids).toContain("MF-REAL-RUNTIME-SIMULATION-FAILED");
			expect(ids).toContain("MF-MISSING-RUNTIME-CLEANUP-REPORT");
		}
	});

	it("preserves existing acceptance when role-bound execution extensions are absent", async () => {
		const result = await runMainThreadAcceptanceReview(
			request({
				manifestExtensions: {
					codebase_memory: {
						execution_recon: "/repo/docs/superpowers/accepting/demo/codebase-memory-recon.json",
						reindex_summary: "/repo/docs/superpowers/accepting/demo/codebase-memory-reindex-summary.json",
						tasks: {
							T01: {
								status: "ready",
								jsonPath: "/repo/docs/superpowers/accepting/demo/tasks/T01/codebase-memory-reindex.json",
							},
						},
					},
					advisor: {
						subagents_enabled: true,
						summary: "/repo/docs/superpowers/accepting/demo/advisor-summary.json",
					},
					model_routing: {
						tasks: {
							T01: {
								resolved_model: "anthropic/claude-sonnet-4",
								model_role: "superpowers:implementer",
								evidence_path: "/repo/docs/superpowers/accepting/demo/tasks/T01/model-routing-evidence.json",
							},
						},
					},
					superpowers: { codebase_memory_gate_mode: "advisory" },
				},
			}),
		);

		expect(result).toMatchObject({
			result: "MAIN_ACCEPTANCE_ACCEPTED",
			review_round: 1,
			must_fix_items: [],
			next_allowed: "CodexReviewRequestPacket",
		});
	});

	it("requires prompt pack extension when role-bound execution is enabled", async () => {
		const base = request();
		const result = await runMainThreadAcceptanceReview(
			request({
				manifestExtensions: {
					...base.manifestExtensions,
					role_bound_execution: { enabled: true, spec_task_framework_path: "/tmp/spec-task-framework.json" },
					prompt_packs: undefined,
				},
			}),
		);

		expect(result.result).toBe("MAIN_ACCEPTANCE_FIX_REQUIRED");
		if (result.result === "MAIN_ACCEPTANCE_FIX_REQUIRED") {
			expect(result.must_fix_items.map(item => item.id)).toContain("MF-MISSING-PROMPT-PACK");
		}
	});

	it("requires advisor gate blocking count when advisor gate is enabled", async () => {
		const base = request();
		const result = await runMainThreadAcceptanceReview(
			request({
				manifestExtensions: {
					...base.manifestExtensions,
					advisor_gate: { enabled: true, records_path: "/tmp/tasks" } as any,
				},
			}),
		);

		expect(result.result).toBe("MAIN_ACCEPTANCE_FIX_REQUIRED");
		if (result.result === "MAIN_ACCEPTANCE_FIX_REQUIRED") {
			expect(result.must_fix_items.map(item => item.id)).toContain("MF-MISSING-ADVISOR-GATE");
		}
	});

	it("rejects role-bound execution when any framework stage evidence is missing", async () => {
		const base = request();
		const result = await runMainThreadAcceptanceReview(
			request({
				manifestExtensions: {
					...base.manifestExtensions,
					role_bound_execution: {
						enabled: true,
						role_registry_snapshot_path: "/repo/docs/superpowers/accepting/demo/role-registry-snapshot.json",
						spec_task_framework_path: "/repo/docs/superpowers/accepting/demo/spec-task-framework.json",
						spec_task_framework_sha256: "framework-sha",
						stages: {
							"T01:tdd-writer": {
								output_path: "/repo/docs/superpowers/accepting/demo/tasks/T01/stages/tdd-writer/output.json",
								model_routing_path:
									"/repo/docs/superpowers/accepting/demo/tasks/T01/stages/tdd-writer/model-routing-evidence.json",
								advisor_gate_paths: [
									"/repo/docs/superpowers/accepting/demo/tasks/T01/stages/tdd-writer/advisor-gates/after_stage.json",
								],
								status: "accepted",
							},
						},
					},
				},
			}),
		);

		expect(result.result).toBe("MAIN_ACCEPTANCE_FIX_REQUIRED");
		expect(result.must_fix_items).toContainEqual(expect.objectContaining({ id: "MF-MISSING-ROLE-BOUND-STAGE" }));
	});

	it("rejects role-bound stage entries without advisor gate paths instead of throwing", async () => {
		const base = request();
		const stages = completeStageManifestEntries();
		delete (stages["T01:tdd-writer"] as Partial<StageManifestEntry>).advisor_gate_paths;

		const result = await runMainThreadAcceptanceReview(
			request({
				manifestExtensions: {
					...base.manifestExtensions,
					role_bound_execution: {
						...base.manifestExtensions!.role_bound_execution!,
						stages: stages as Record<string, StageManifestEntry>,
					},
				},
			}),
		);

		expect(result.result).toBe("MAIN_ACCEPTANCE_FIX_REQUIRED");
		if (result.result === "MAIN_ACCEPTANCE_FIX_REQUIRED") {
			expect(result.must_fix_items.map(item => item.id)).toContain("MF-MISSING-ROLE-BOUND-STAGE");
		}
	});

	it("rejects blocked and abandoned role-bound todo statuses", async () => {
		const blocked = await runMainThreadAcceptanceReview(
			request({
				todoSnapshot: {
					runId: "run-123",
					version: 2,
					state: "main_acceptance_review_running",
					updatedAt: "2026-06-30T00:00:00.000Z",
					source: "state-machine",
					phases: [{ name: "Role Bound Stages", tasks: [{ content: "T01 implementer", status: "blocked" }] }],
				},
			}),
		);

		expect(blocked.result).toBe("MAIN_ACCEPTANCE_FIX_REQUIRED");
		expect(blocked.must_fix_items).toContainEqual(
			expect.objectContaining({ id: "MF-TASKLIST-NONTERMINAL-ROLE-BOUND" }),
		);
	});

	it("rejects role-bound framework missing actual sha256", async () => {
		const base = request();
		const result = await runMainThreadAcceptanceReview(
			request({
				manifestExtensions: {
					...base.manifestExtensions,
					role_bound_execution: {
						...base.manifestExtensions!.role_bound_execution!,
						actual_spec_task_framework_sha256: undefined,
					},
				},
			}),
		);

		expect(result.result).toBe("MAIN_ACCEPTANCE_FIX_REQUIRED");
		if (result.result === "MAIN_ACCEPTANCE_FIX_REQUIRED") {
			expect(result.must_fix_items.map(item => item.id)).toContain("MF-MISSING-SPEC-TASK-FRAMEWORK-ACTUAL-SHA");
		}
	});

	it("rejects role-bound framework sha256 mismatch", async () => {
		const result = await runMainThreadAcceptanceReview(
			request({
				manifestExtensions: {
					...request().manifestExtensions,
					role_bound_execution: {
						enabled: true,
						role_registry_snapshot_path: "/repo/docs/superpowers/accepting/demo/role-registry-snapshot.json",
						spec_task_framework_path: "/repo/docs/superpowers/accepting/demo/spec-task-framework.json",
						spec_task_framework_sha256: "wrong-sha",
						actual_spec_task_framework_sha256: "actual-sha",
						stages: completeStageManifestEntries(),
					},
				},
			}),
		);

		expect(result.result).toBe("MAIN_ACCEPTANCE_FIX_REQUIRED");
		expect(result.must_fix_items).toContainEqual(
			expect.objectContaining({ id: "MF-SPEC-TASK-FRAMEWORK-SHA-MISMATCH" }),
		);
	});

	it("rejects role-bound final acceptance when productized entry evidence is missing", async () => {
		const base = request();
		const result = await runMainThreadAcceptanceReview(
			request({
				manifestExtensions: {
					...base.manifestExtensions,
					role_bound_execution: {
						enabled: true,
						// Missing role_registry_snapshot_path = missing productized entry
						spec_task_framework_path: base.manifestExtensions!.role_bound_execution!.spec_task_framework_path,
						spec_task_framework_sha256: base.manifestExtensions!.role_bound_execution!.spec_task_framework_sha256,
						actual_spec_task_framework_sha256:
							base.manifestExtensions!.role_bound_execution!.actual_spec_task_framework_sha256,
						stages: base.manifestExtensions!.role_bound_execution!.stages,
					},
				},
			}),
		);

		expect(result.result).toBe("MAIN_ACCEPTANCE_FIX_REQUIRED");
		expect(result.must_fix_items).toContainEqual(
			expect.objectContaining({ id: "MF-MISSING-PLAN-RUN-ENTRY-EVIDENCE" }),
		);
	});

	it("rejects classification_summary items requiring specialized review when evidence_paths is empty", async () => {
		const base = request();
		const result = await runMainThreadAcceptanceReview(
			request({
				manifestExtensions: {
					...base.manifestExtensions,
					role_bound_execution: {
						...base.manifestExtensions!.role_bound_execution!,
						classification_summary: {
							tasks: {
								T01: {
									runtime_surface: "browser",
									requires_frontend_design: true,
									requires_security_review: false,
									requires_payment_review: false,
									requires_data_migration_review: false,
									requires_destructive_operation_review: false,
									evidence_paths: [],
								},
							},
							specialized_reviews: [{ type: "frontend_design", evidence_paths: [] }],
						},
					},
				},
			}),
		);

		expect(result.result).toBe("MAIN_ACCEPTANCE_FIX_REQUIRED");
		expect(result.must_fix_items).toContainEqual(
			expect.objectContaining({ id: "MF-MISSING-SPECIALIZED-REVIEW-EVIDENCE" }),
		);
	});

	it("skips productized entry and specialized review checks when role_bound_execution is absent", async () => {
		const result = await runMainThreadAcceptanceReview(
			request({
				manifestExtensions: {
					codebase_memory: {
						execution_recon: "/repo/docs/superpowers/accepting/demo/codebase-memory-recon.json",
						reindex_summary: "/repo/docs/superpowers/accepting/demo/codebase-memory-reindex-summary.json",
						tasks: {
							T01: {
								status: "ready",
								jsonPath: "/repo/docs/superpowers/accepting/demo/tasks/T01/codebase-memory-reindex.json",
							},
						},
					},
					advisor: {
						subagents_enabled: true,
						summary: "/repo/docs/superpowers/accepting/demo/advisor-summary.json",
					},
					model_routing: {
						tasks: {
							T01: {
								resolved_model: "anthropic/claude-sonnet-4",
								model_role: "superpowers:implementer",
								evidence_path: "/repo/docs/superpowers/accepting/demo/tasks/T01/model-routing-evidence.json",
							},
						},
					},
					superpowers: { codebase_memory_gate_mode: "advisory" },
				},
			}),
		);

		expect(result).toMatchObject({
			result: "MAIN_ACCEPTANCE_ACCEPTED",
			review_round: 1,
			must_fix_items: [],
			next_allowed: "CodexReviewRequestPacket",
		});
	});

	it("skips productized entry and specialized review checks when role_bound_execution is disabled", async () => {
		const base = request();
		const result = await runMainThreadAcceptanceReview(
			request({
				manifestExtensions: {
					...base.manifestExtensions,
					role_bound_execution: { enabled: false },
				},
			}),
		);

		const ids = result.must_fix_items.map(item => item.id);
		expect(ids).not.toContain("MF-MISSING-PLAN-RUN-ENTRY-EVIDENCE");
		expect(ids).not.toContain("MF-MISSING-SPECIALIZED-REVIEW-EVIDENCE");
	});
});
