import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PlanRunManifest } from "../../src/codex-plan-run/manifest";
import type { CodexReviewRequestPacket } from "../../src/codex-plan-run/packet-guard";
import {
	createCodexReviewRequestPacket,
	validateCodexReviewRequestPacket,
} from "../../src/codex-plan-run/packet-guard";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "omp-packet-guard-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) {
		await rm(dir, { recursive: true, force: true });
	}
});

function createReadyManifest(paths: {
	completionMdPath: string;
	executionBookPath?: string;
	originalPlanPath: string;
	repoPath: string;
	worktree: string;
	worktreePlanPath: string;
}): PlanRunManifest {
	const executionBookPath =
		paths.executionBookPath ??
		join(paths.worktree, "docs", "superpowers", "accepting", "demo", "plan-execution-book.md");
	return {
		schema_version: 1,
		run_id: "run-123",
		state: "main_acceptance_accepted",
		source_repo: paths.worktree,
		worktree: paths.worktree,
		git_state: {
			branch: "feature/demo",
			head_commit: "abc1234",
			status_short: "",
		},
		final_workspace_state_hash: "workspace-state",
		plan: {
			original_path: paths.originalPlanPath,
			worktree_path: paths.worktreePlanPath,
			sha256: "abc123",
		},
		skill: {
			required: "omp-executing-codex-plan",
			loaded: true,
			loaded_at: "2026-06-21T00:00:00.000Z",
			content_sha256: "def456",
			source_path: "/skills/omp-executing-codex-plan/SKILL.md",
		},
		execution_book: {
			path: executionBookPath,
			exists: true,
			task_count: 1,
			required_execution_skills: ["omp-executing-codex-plan"],
			required_review_skills: ["requesting-code-review"],
			final_tail_skills: ["verification-before-completion"],
			content_sha256: "book-sha",
		},
		todos: {
			version: 1,
			state: "synced",
			source: "state-machine",
			pending_required_tasks: 0,
		},
		completion: {
			path: paths.completionMdPath,
			exists: true,
		},
		main_acceptance: {
			result: "MAIN_ACCEPTANCE_ACCEPTED",
			review_round: 1,
			accepted_at: "2026-06-24T00:00:00.000Z",
			evidence_path: paths.completionMdPath,
			must_fix_count: 0,
		},
		packet: {
			valid: true,
			packet_id: "packet-123",
		},
		gate_errors: [],
	};
}

function createPacket(paths: {
	completionMdPath: string;
	executionBookPath?: string;
	manifestPath: string;
	originalPlanPath: string;
	repoPath: string;
	worktree: string;
	worktreePlanPath: string;
	overrides?: Partial<CodexReviewRequestPacket>;
}): CodexReviewRequestPacket {
	const executionBookPath =
		paths.executionBookPath ??
		join(paths.worktree, "docs", "superpowers", "accepting", "demo", "plan-execution-book.md");
	return {
		packet_type: "CodexReviewRequestPacket",
		packet_id: "packet-123",
		run_id: "run-123",
		repo_path: paths.worktree,
		omp_worktree: paths.worktree,
		git_state: {
			branch: "feature/demo",
			head_commit: "abc1234",
			status_short: "",
		},
		workspace_state_hash: "workspace-state",
		original_plan_path: paths.originalPlanPath,
		worktree_plan_path: paths.worktreePlanPath,
		plan_sha256: "abc123",
		execution_book_path: executionBookPath,
		accepting_dir: join(paths.worktree, "docs", "superpowers", "accepting", "demo"),
		plan_execution_book: executionBookPath,
		tasks: [
			{
				task_id: "T01",
				task_card: "T01 task card",
				execution_skills_used: ["omp-executing-codex-plan"],
				review_skills_used: ["requesting-code-review"],
				final_tail_skills_used: ["verification-before-completion"],
				commands: [{ command: "bun test test/codex-plan-run/packet-guard.test.ts", exit_code: 0 }],
				result: "TASK_ACCEPTED",
			},
		],
		final_status: "READY_FOR_CODEX_REVIEW",
		main_thread_acceptance: {
			result: "MAIN_ACCEPTANCE_ACCEPTED",
			review_round: 1,
			accepted_at: "2026-06-24T00:00:00.000Z",
			evidence_path: paths.completionMdPath,
		},
		completion_md_path: paths.completionMdPath,
		manifest_path: paths.manifestPath,
		changed_files: ["src/codex-plan-run/packet-guard.ts"],
		verification_commands: [
			{
				command: "bun test test/codex-plan-run/packet-guard.test.ts",
				exit_code: 0,
			},
		],
		evidence_table: [
			{
				artifact: "completion.md",
				evidence: paths.completionMdPath,
			},
		],
		...paths.overrides,
	};
}

describe("Final packet guard", () => {
	it("generates a CodexReviewRequestPacket that references the execution book and task review records", async () => {
		const root = await makeTempDir();
		const worktree = join(root, "worktree");
		const repoPath = join(root, "repo");
		const originalPlanPath = join(repoPath, "plans", "source.md");
		const worktreePlanPath = join(worktree, "docs", "superpowers", "plans", "task.md");
		const executionBookPath = join(worktree, "docs", "superpowers", "accepting", "demo", "plan-execution-book.md");
		const completionMdPath = join(worktree, "docs", "superpowers", "completion.md");
		const manifestPath = join(root, "plan-run.json");
		const manifest = createReadyManifest({
			completionMdPath,
			executionBookPath,
			originalPlanPath,
			repoPath,
			worktree,
			worktreePlanPath,
		});

		await mkdir(join(worktree, "docs", "superpowers", "plans"), { recursive: true });
		await mkdir(join(worktree, "docs", "superpowers", "accepting", "demo"), { recursive: true });
		await mkdir(join(repoPath, "plans"), { recursive: true });
		await writeFile(originalPlanPath, "# Original Plan\n", "utf8");
		await writeFile(worktreePlanPath, "# Plan\n", "utf8");
		await writeFile(executionBookPath, "# OMP Plan Execution Book\n", "utf8");
		await writeFile(completionMdPath, "# Completion\n", "utf8");
		await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

		const packet = createCodexReviewRequestPacket({
			manifest,
			acceptingDir: join(worktree, "docs", "superpowers", "accepting", "demo"),
			manifestPath,
			changedFiles: ["src/codex-plan-run/packet-guard.ts"],
			verificationCommands: [{ command: "bun test test/codex-plan-run/packet-guard.test.ts", exit_code: 0 }],
			evidenceTable: [{ artifact: "completion.md", evidence: completionMdPath }],
			tasks: [
				{
					task_id: "T01",
					task_card: "Task Card: T01 - packet generation",
					execution_skills_used: ["omp-executing-codex-plan"],
					review_skills_used: ["requesting-code-review"],
					final_tail_skills_used: ["verification-before-completion"],
					commands: [{ command: "bun test test/codex-plan-run/packet-guard.test.ts", exit_code: 0 }],
					result: "TASK_ACCEPTED",
				},
			],
		});

		expect(packet.packet_type).toBe("CodexReviewRequestPacket");
		expect(packet.plan_execution_book).toBe(executionBookPath);
		expect(packet.final_status).toBe("READY_FOR_CODEX_REVIEW");
		expect(packet.tasks[0]?.task_card).toContain("Task Card: T01");
		expect(validateCodexReviewRequestPacket({ manifest, packet })).toEqual({ valid: true, errors: [] });
	});

	it("rejects packets that do not match the final workspace state hash", async () => {
		const root = await makeTempDir();
		const worktree = join(root, "worktree");
		const repoPath = join(root, "repo");
		const originalPlanPath = join(repoPath, "plans", "source.md");
		const worktreePlanPath = join(worktree, "docs", "superpowers", "plans", "task.md");
		const executionBookPath = join(worktree, "docs", "superpowers", "accepting", "demo", "plan-execution-book.md");
		const completionMdPath = join(worktree, "docs", "superpowers", "completion.md");
		const manifestPath = join(root, "plan-run.json");
		const manifest = {
			...createReadyManifest({
				completionMdPath,
				executionBookPath,
				originalPlanPath,
				repoPath,
				worktree,
				worktreePlanPath,
			}),
			final_workspace_state_hash: "manifest-state",
		};
		const packet = createPacket({
			completionMdPath,
			executionBookPath,
			manifestPath,
			originalPlanPath,
			repoPath,
			worktree,
			worktreePlanPath,
			overrides: { workspace_state_hash: "packet-state" },
		});

		await mkdir(join(worktree, "docs", "superpowers", "plans"), { recursive: true });
		await mkdir(join(worktree, "docs", "superpowers", "accepting", "demo"), { recursive: true });
		await mkdir(join(repoPath, "plans"), { recursive: true });
		await writeFile(originalPlanPath, "# Original Plan\n", "utf8");
		await writeFile(worktreePlanPath, "# Plan\n", "utf8");
		await writeFile(executionBookPath, "# OMP Plan Execution Book\n", "utf8");
		await writeFile(completionMdPath, "# Completion\n", "utf8");
		await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

		const result = validateCodexReviewRequestPacket({
			manifest,
			packet,
			finalWorkspaceStateHash: "current-state",
		});

		expect(result.valid).toBe(false);
		expect(result.errors).toContain(
			"packet, manifest, completion, and final workspace state must reference the same state hash",
		);
	});

	it("refuses to create a review packet without final git state metadata", async () => {
		const root = await makeTempDir();
		const worktree = join(root, "worktree");
		const repoPath = join(root, "repo");
		const originalPlanPath = join(repoPath, "plans", "source.md");
		const worktreePlanPath = join(worktree, "docs", "superpowers", "plans", "task.md");
		const completionMdPath = join(worktree, "docs", "superpowers", "completion.md");
		const manifest = createReadyManifest({
			completionMdPath,
			originalPlanPath,
			repoPath,
			worktree,
			worktreePlanPath,
		});
		delete manifest.git_state;

		expect(() =>
			createCodexReviewRequestPacket({
				manifest,
				acceptingDir: join(worktree, "docs", "superpowers", "accepting", "demo"),
				manifestPath: join(root, "plan-run.json"),
				changedFiles: ["src/codex-plan-run/packet-guard.ts"],
				verificationCommands: [{ command: "bun test test/codex-plan-run/packet-guard.test.ts", exit_code: 0 }],
				evidenceTable: [{ artifact: "completion.md", evidence: completionMdPath }],
				tasks: [],
			}),
		).toThrow("Cannot create CodexReviewRequestPacket without git_state metadata");
	});

	it("passes only when packet paths exist and manifest is ready", async () => {
		const root = await makeTempDir();
		const worktree = join(root, "worktree");
		const repoPath = join(root, "repo");
		const originalPlanPath = join(repoPath, "plans", "source.md");
		const worktreePlanPath = join(worktree, "docs", "superpowers", "plans", "task.md");
		const executionBookPath = join(worktree, "docs", "superpowers", "accepting", "demo", "plan-execution-book.md");
		const completionMdPath = join(worktree, "docs", "superpowers", "completion.md");
		const manifestPath = join(root, "plan-run.json");
		const manifest = createReadyManifest({
			completionMdPath,
			executionBookPath,
			originalPlanPath,
			repoPath,
			worktree,
			worktreePlanPath,
		});
		const packet = createPacket({
			completionMdPath,
			executionBookPath,
			manifestPath,
			originalPlanPath,
			repoPath,
			worktree,
			worktreePlanPath,
		});

		await mkdir(join(worktree, "docs", "superpowers", "plans"), { recursive: true });
		await mkdir(join(worktree, "docs", "superpowers", "accepting", "demo"), { recursive: true });
		await mkdir(join(repoPath, "plans"), { recursive: true });
		await writeFile(originalPlanPath, "# Original Plan\n", "utf8");
		await writeFile(worktreePlanPath, "# Plan\n", "utf8");
		await writeFile(executionBookPath, "# OMP Plan Execution Book\n", "utf8");
		await writeFile(completionMdPath, "# Completion\n", "utf8");
		await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

		expect(validateCodexReviewRequestPacket({ manifest, packet })).toEqual({
			valid: true,
			errors: [],
		});
	});

	it("fails when the review packet mixes a source repo root with a different OMP worktree", async () => {
		const root = await makeTempDir();
		const worktree = join(root, "worktree");
		const repoPath = join(root, "repo");
		const originalPlanPath = join(repoPath, "plans", "source.md");
		const worktreePlanPath = join(worktree, "docs", "superpowers", "plans", "task.md");
		const executionBookPath = join(worktree, "docs", "superpowers", "accepting", "demo", "plan-execution-book.md");
		const completionMdPath = join(worktree, "docs", "superpowers", "completion.md");
		const manifestPath = join(root, "plan-run.json");
		const manifest = {
			...createReadyManifest({
				completionMdPath,
				executionBookPath,
				originalPlanPath,
				repoPath,
				worktree,
				worktreePlanPath,
			}),
			source_repo: repoPath,
		};
		const packet = {
			...createPacket({
				completionMdPath,
				executionBookPath,
				manifestPath,
				originalPlanPath,
				repoPath,
				worktree,
				worktreePlanPath,
			}),
			repo_path: repoPath,
		};

		await mkdir(join(worktree, "docs", "superpowers", "plans"), { recursive: true });
		await mkdir(join(worktree, "docs", "superpowers", "accepting", "demo"), { recursive: true });
		await mkdir(join(repoPath, "plans"), { recursive: true });
		await writeFile(originalPlanPath, "# Original Plan\n", "utf8");
		await writeFile(worktreePlanPath, "# Plan\n", "utf8");
		await writeFile(executionBookPath, "# OMP Plan Execution Book\n", "utf8");
		await writeFile(completionMdPath, "# Completion\n", "utf8");
		await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

		const result = validateCodexReviewRequestPacket({ manifest, packet });

		expect(result.valid).toBe(false);
		expect(result.errors).toContain("manifest source_repo must match worktree");
		expect(result.errors).toContain("packet repo_path must match omp_worktree");
	});

	it("fails when packet git state does not match the manifest or current worktree HEAD", async () => {
		const root = await makeTempDir();
		const worktree = join(root, "worktree");
		const repoPath = join(root, "repo");
		const originalPlanPath = join(repoPath, "plans", "source.md");
		const worktreePlanPath = join(worktree, "docs", "superpowers", "plans", "task.md");
		const executionBookPath = join(worktree, "docs", "superpowers", "accepting", "demo", "plan-execution-book.md");
		const completionMdPath = join(worktree, "docs", "superpowers", "completion.md");
		const manifestPath = join(root, "plan-run.json");
		const manifest = {
			...createReadyManifest({
				completionMdPath,
				executionBookPath,
				originalPlanPath,
				repoPath,
				worktree,
				worktreePlanPath,
			}),
			git_state: {
				branch: "feature/demo",
				head_commit: "5536599c",
				status_short: "",
			},
		};
		const packet = {
			...createPacket({
				completionMdPath,
				executionBookPath,
				manifestPath,
				originalPlanPath,
				repoPath,
				worktree,
				worktreePlanPath,
			}),
			git_state: {
				branch: "feature/demo",
				head_commit: "ce33d857",
				status_short: "",
			},
		};

		await mkdir(join(worktree, "docs", "superpowers", "plans"), { recursive: true });
		await mkdir(join(worktree, "docs", "superpowers", "accepting", "demo"), { recursive: true });
		await mkdir(join(repoPath, "plans"), { recursive: true });
		await writeFile(originalPlanPath, "# Original Plan\n", "utf8");
		await writeFile(worktreePlanPath, "# Plan\n", "utf8");
		await writeFile(executionBookPath, "# OMP Plan Execution Book\n", "utf8");
		await writeFile(completionMdPath, "# Completion\n", "utf8");
		await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

		const result = validateCodexReviewRequestPacket({
			manifest,
			packet,
			currentGitState: {
				branch: "feature/demo",
				head_commit: "4fd9c46f",
				status_short: "",
			},
		});

		expect(result.valid).toBe(false);
		expect(result.errors).toContain("packet git_state does not match manifest");
		expect(result.errors).toContain("packet git_state does not match current worktree HEAD");
	});

	it("fails when completion doc is missing", async () => {
		const root = await makeTempDir();
		const worktree = join(root, "worktree");
		const repoPath = join(root, "repo");
		const originalPlanPath = join(repoPath, "plans", "source.md");
		const worktreePlanPath = join(worktree, "docs", "superpowers", "plans", "task.md");
		const executionBookPath = join(worktree, "docs", "superpowers", "accepting", "demo", "plan-execution-book.md");
		const completionMdPath = join(worktree, "docs", "superpowers", "missing.md");
		const manifestPath = join(root, "plan-run.json");
		const manifest = {
			...createReadyManifest({
				completionMdPath,
				executionBookPath,
				originalPlanPath,
				repoPath,
				worktree,
				worktreePlanPath,
			}),
			main_acceptance: undefined,
		} as PlanRunManifest;
		const packet = createPacket({
			completionMdPath,
			executionBookPath,
			manifestPath,
			originalPlanPath,
			repoPath,
			worktree,
			worktreePlanPath,
			overrides: { main_thread_acceptance: undefined },
		} as Parameters<typeof createPacket>[0]);

		await mkdir(join(worktree, "docs", "superpowers", "plans"), { recursive: true });
		await mkdir(join(worktree, "docs", "superpowers", "accepting", "demo"), { recursive: true });
		await mkdir(join(repoPath, "plans"), { recursive: true });
		await writeFile(originalPlanPath, "# Original Plan\n", "utf8");
		await writeFile(worktreePlanPath, "# Plan\n", "utf8");
		await writeFile(executionBookPath, "# OMP Plan Execution Book\n", "utf8");
		await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

		const result = validateCodexReviewRequestPacket({ manifest, packet });

		expect(result.valid).toBe(false);
		expect(result.errors).toContain("completion_md_path does not exist");
	});

	it("fails before Codex review when the worktree plan file is missing", async () => {
		const root = await makeTempDir();
		const worktree = join(root, "worktree");
		const repoPath = join(root, "repo");
		const originalPlanPath = join(repoPath, "plans", "source.md");
		const worktreePlanPath = join(worktree, "docs", "superpowers", "plans", "missing.md");
		const completionMdPath = join(worktree, "docs", "superpowers", "completion.md");
		const manifestPath = join(root, "plan-run.json");
		const manifest = createReadyManifest({
			completionMdPath,
			originalPlanPath,
			repoPath,
			worktree,
			worktreePlanPath,
		});
		const packet = createPacket({
			completionMdPath,
			manifestPath,
			originalPlanPath,
			repoPath,
			worktree,
			worktreePlanPath,
			overrides: {
				verification_commands: [
					{
						command: "bun test",
						exit_code: 0,
					},
				],
			},
		});

		await mkdir(join(worktree, "docs", "superpowers", "plans"), { recursive: true });
		await mkdir(join(repoPath, "plans"), { recursive: true });
		await writeFile(originalPlanPath, "# Original Plan\n", "utf8");
		await writeFile(completionMdPath, "# Completion\n", "utf8");
		await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

		const result = validateCodexReviewRequestPacket({ manifest, packet });

		expect(result.valid).toBe(false);
		expect(result.errors).toContain("worktree_plan_path does not exist");
	});

	it("fails when packet plan_sha256 does not match the manifest", async () => {
		const root = await makeTempDir();
		const worktree = join(root, "worktree");
		const repoPath = join(root, "repo");
		const originalPlanPath = join(repoPath, "plans", "source.md");
		const worktreePlanPath = join(worktree, "docs", "superpowers", "plans", "task.md");
		const completionMdPath = join(worktree, "docs", "superpowers", "completion.md");
		const manifestPath = join(root, "plan-run.json");
		const manifest = createReadyManifest({
			completionMdPath,
			originalPlanPath,
			repoPath,
			worktree,
			worktreePlanPath,
		});
		const packet = createPacket({
			completionMdPath,
			manifestPath,
			originalPlanPath,
			repoPath,
			worktree,
			worktreePlanPath,
			overrides: { plan_sha256: "wrong-sha" },
		});

		await mkdir(join(worktree, "docs", "superpowers", "plans"), { recursive: true });
		await mkdir(join(repoPath, "plans"), { recursive: true });
		await writeFile(originalPlanPath, "# Original Plan\n", "utf8");
		await writeFile(worktreePlanPath, "# Plan\n", "utf8");
		await writeFile(completionMdPath, "# Completion\n", "utf8");
		await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

		const result = validateCodexReviewRequestPacket({ manifest, packet });

		expect(result.valid).toBe(false);
		expect(result.errors).toContain("packet plan_sha256 does not match manifest");
	});

	it("fails when execution_book_path does not match the manifest", async () => {
		const root = await makeTempDir();
		const worktree = join(root, "worktree");
		const repoPath = join(root, "repo");
		const originalPlanPath = join(repoPath, "plans", "source.md");
		const worktreePlanPath = join(worktree, "docs", "superpowers", "plans", "task.md");
		const executionBookPath = join(worktree, "docs", "superpowers", "accepting", "demo", "plan-execution-book.md");
		const completionMdPath = join(worktree, "docs", "superpowers", "completion.md");
		const manifestPath = join(root, "plan-run.json");
		const manifest = createReadyManifest({
			completionMdPath,
			executionBookPath,
			originalPlanPath,
			repoPath,
			worktree,
			worktreePlanPath,
		});
		const packet = createPacket({
			completionMdPath,
			executionBookPath,
			manifestPath,
			originalPlanPath,
			repoPath,
			worktree,
			worktreePlanPath,
			overrides: { execution_book_path: join(worktree, "docs", "superpowers", "accepting", "other.md") },
		});

		await mkdir(join(worktree, "docs", "superpowers", "plans"), { recursive: true });
		await mkdir(join(worktree, "docs", "superpowers", "accepting", "demo"), { recursive: true });
		await mkdir(join(repoPath, "plans"), { recursive: true });
		await writeFile(originalPlanPath, "# Original Plan\n", "utf8");
		await writeFile(worktreePlanPath, "# Plan\n", "utf8");
		await writeFile(executionBookPath, "# OMP Plan Execution Book\n", "utf8");
		await writeFile(completionMdPath, "# Completion\n", "utf8");
		await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

		const result = validateCodexReviewRequestPacket({ manifest, packet });

		expect(result.valid).toBe(false);
		expect(result.errors).toContain("packet execution_book_path does not match manifest");
	});

	it("fails when execution_book_path does not exist", async () => {
		const root = await makeTempDir();
		const worktree = join(root, "worktree");
		const repoPath = join(root, "repo");
		const originalPlanPath = join(repoPath, "plans", "source.md");
		const worktreePlanPath = join(worktree, "docs", "superpowers", "plans", "task.md");
		const executionBookPath = join(worktree, "docs", "superpowers", "accepting", "demo", "missing.md");
		const completionMdPath = join(worktree, "docs", "superpowers", "completion.md");
		const manifestPath = join(root, "plan-run.json");
		const manifest = createReadyManifest({
			completionMdPath,
			executionBookPath,
			originalPlanPath,
			repoPath,
			worktree,
			worktreePlanPath,
		});
		const packet = createPacket({
			completionMdPath,
			executionBookPath,
			manifestPath,
			originalPlanPath,
			repoPath,
			worktree,
			worktreePlanPath,
			overrides: { main_thread_acceptance: undefined },
		} as Parameters<typeof createPacket>[0]);

		await mkdir(join(worktree, "docs", "superpowers", "plans"), { recursive: true });
		await mkdir(join(repoPath, "plans"), { recursive: true });
		await writeFile(originalPlanPath, "# Original Plan\n", "utf8");
		await writeFile(worktreePlanPath, "# Plan\n", "utf8");
		await writeFile(completionMdPath, "# Completion\n", "utf8");
		await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

		const result = validateCodexReviewRequestPacket({ manifest, packet });

		expect(result.valid).toBe(false);
		expect(result.errors).toContain("execution_book_path does not exist");
	});

	it("fails when packet omits task review evidence", async () => {
		const root = await makeTempDir();
		const worktree = join(root, "worktree");
		const repoPath = join(root, "repo");
		const originalPlanPath = join(repoPath, "plans", "source.md");
		const worktreePlanPath = join(worktree, "docs", "superpowers", "plans", "task.md");
		const executionBookPath = join(worktree, "docs", "superpowers", "accepting", "demo", "plan-execution-book.md");
		const completionMdPath = join(worktree, "docs", "superpowers", "completion.md");
		const manifestPath = join(root, "plan-run.json");
		const manifest = createReadyManifest({
			completionMdPath,
			executionBookPath,
			originalPlanPath,
			repoPath,
			worktree,
			worktreePlanPath,
		});
		const packet = createPacket({
			completionMdPath,
			executionBookPath,
			manifestPath,
			originalPlanPath,
			repoPath,
			worktree,
			worktreePlanPath,
			overrides: { tasks: [], final_status: "READY_FOR_CODEX_REVIEW" },
		});

		await mkdir(join(worktree, "docs", "superpowers", "plans"), { recursive: true });
		await mkdir(join(worktree, "docs", "superpowers", "accepting", "demo"), { recursive: true });
		await mkdir(join(repoPath, "plans"), { recursive: true });
		await writeFile(originalPlanPath, "# Original Plan\n", "utf8");
		await writeFile(worktreePlanPath, "# Plan\n", "utf8");
		await writeFile(executionBookPath, "# OMP Plan Execution Book\n", "utf8");
		await writeFile(completionMdPath, "# Completion\n", "utf8");
		await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

		const result = validateCodexReviewRequestPacket({ manifest, packet });

		expect(result.valid).toBe(false);
		expect(result.errors).toContain("tasks must not be empty");
	});

	it("fails when packet_id does not match the manifest packet_id", async () => {
		const root = await makeTempDir();
		const worktree = join(root, "worktree");
		const repoPath = join(root, "repo");
		const originalPlanPath = join(repoPath, "plans", "source.md");
		const worktreePlanPath = join(worktree, "docs", "superpowers", "plans", "task.md");
		const completionMdPath = join(worktree, "docs", "superpowers", "completion.md");
		const manifestPath = join(root, "plan-run.json");
		const manifest = createReadyManifest({
			completionMdPath,
			originalPlanPath,
			repoPath,
			worktree,
			worktreePlanPath,
		});
		const packet = createPacket({
			completionMdPath,
			manifestPath,
			originalPlanPath,
			repoPath,
			worktree,
			worktreePlanPath,
			overrides: { packet_id: "packet-other" },
		});

		await mkdir(join(worktree, "docs", "superpowers", "plans"), { recursive: true });
		await mkdir(join(repoPath, "plans"), { recursive: true });
		await writeFile(originalPlanPath, "# Original Plan\n", "utf8");
		await writeFile(worktreePlanPath, "# Plan\n", "utf8");
		await writeFile(completionMdPath, "# Completion\n", "utf8");
		await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

		const result = validateCodexReviewRequestPacket({ manifest, packet });

		expect(result.valid).toBe(false);
		expect(result.errors).toContain("packet packet_id does not match manifest");
	});

	it("fails when the manifest packet is not valid", async () => {
		const root = await makeTempDir();
		const worktree = join(root, "worktree");
		const repoPath = join(root, "repo");
		const originalPlanPath = join(repoPath, "plans", "source.md");
		const worktreePlanPath = join(worktree, "docs", "superpowers", "plans", "task.md");
		const completionMdPath = join(worktree, "docs", "superpowers", "completion.md");
		const manifestPath = join(root, "plan-run.json");
		const manifest = createReadyManifest({
			completionMdPath,
			originalPlanPath,
			repoPath,
			worktree,
			worktreePlanPath,
		});
		manifest.packet.valid = false;
		const packet = createPacket({
			completionMdPath,
			manifestPath,
			originalPlanPath,
			repoPath,
			worktree,
			worktreePlanPath,
		});

		await mkdir(join(worktree, "docs", "superpowers", "plans"), { recursive: true });
		await mkdir(join(repoPath, "plans"), { recursive: true });
		await writeFile(originalPlanPath, "# Original Plan\n", "utf8");
		await writeFile(worktreePlanPath, "# Plan\n", "utf8");
		await writeFile(completionMdPath, "# Completion\n", "utf8");
		await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

		const result = validateCodexReviewRequestPacket({ manifest, packet });

		expect(result.valid).toBe(false);
		expect(result.errors).toContain("manifest packet is not valid");
	});

	it("fails when manifest packet is valid but packet_id is missing", async () => {
		const root = await makeTempDir();
		const worktree = join(root, "worktree");
		const repoPath = join(root, "repo");
		const originalPlanPath = join(repoPath, "plans", "source.md");
		const worktreePlanPath = join(worktree, "docs", "superpowers", "plans", "task.md");
		const completionMdPath = join(worktree, "docs", "superpowers", "completion.md");
		const manifestPath = join(root, "plan-run.json");
		const manifest = createReadyManifest({
			completionMdPath,
			originalPlanPath,
			repoPath,
			worktree,
			worktreePlanPath,
		});
		manifest.packet = { valid: true };
		const packet = createPacket({
			completionMdPath,
			manifestPath,
			originalPlanPath,
			repoPath,
			worktree,
			worktreePlanPath,
		});

		await mkdir(join(worktree, "docs", "superpowers", "plans"), { recursive: true });
		await mkdir(join(repoPath, "plans"), { recursive: true });
		await writeFile(originalPlanPath, "# Original Plan\n", "utf8");
		await writeFile(worktreePlanPath, "# Plan\n", "utf8");
		await writeFile(completionMdPath, "# Completion\n", "utf8");
		await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

		const result = validateCodexReviewRequestPacket({ manifest, packet });

		expect(result.valid).toBe(false);
		expect(result.errors).toContain("manifest packet_id is required");
	});

	it("fails when repo_path does not exist", async () => {
		const root = await makeTempDir();
		const worktree = join(root, "worktree");
		const repoPath = join(root, "missing-repo");
		const originalPlanPath = join(repoPath, "plans", "source.md");
		const worktreePlanPath = join(worktree, "docs", "superpowers", "plans", "task.md");
		const completionMdPath = join(worktree, "docs", "superpowers", "completion.md");
		const manifestPath = join(root, "plan-run.json");
		const manifest = {
			...createReadyManifest({
				completionMdPath,
				originalPlanPath,
				repoPath,
				worktree,
				worktreePlanPath,
			}),
			source_repo: repoPath,
		};
		const packet = {
			...createPacket({
				completionMdPath,
				manifestPath,
				originalPlanPath,
				repoPath,
				worktree,
				worktreePlanPath,
			}),
			repo_path: repoPath,
		};

		await mkdir(join(worktree, "docs", "superpowers", "plans"), { recursive: true });
		await writeFile(worktreePlanPath, "# Plan\n", "utf8");
		await writeFile(completionMdPath, "# Completion\n", "utf8");
		await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

		const result = validateCodexReviewRequestPacket({ manifest, packet });

		expect(result.valid).toBe(false);
		expect(result.errors).toContain("manifest source_repo must match worktree");
		expect(result.errors).toContain("packet repo_path must match omp_worktree");
		expect(result.errors).toContain("repo_path does not exist");
	});

	it("fails when original_plan_path does not exist", async () => {
		const root = await makeTempDir();
		const worktree = join(root, "worktree");
		const repoPath = join(root, "repo");
		const originalPlanPath = join(repoPath, "plans", "missing.md");
		const worktreePlanPath = join(worktree, "docs", "superpowers", "plans", "task.md");
		const completionMdPath = join(worktree, "docs", "superpowers", "completion.md");
		const manifestPath = join(root, "plan-run.json");
		const manifest = createReadyManifest({
			completionMdPath,
			originalPlanPath,
			repoPath,
			worktree,
			worktreePlanPath,
		});
		const packet = createPacket({
			completionMdPath,
			manifestPath,
			originalPlanPath,
			repoPath,
			worktree,
			worktreePlanPath,
		});

		await mkdir(join(worktree, "docs", "superpowers", "plans"), { recursive: true });
		await mkdir(repoPath, { recursive: true });
		await writeFile(worktreePlanPath, "# Plan\n", "utf8");
		await writeFile(completionMdPath, "# Completion\n", "utf8");
		await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

		const result = validateCodexReviewRequestPacket({ manifest, packet });

		expect(result.valid).toBe(false);
		expect(result.errors).toContain("original_plan_path does not exist");
	});

	it("fails when a verification command did not pass", async () => {
		const root = await makeTempDir();
		const worktree = join(root, "worktree");
		const repoPath = join(root, "repo");
		const originalPlanPath = join(repoPath, "plans", "source.md");
		const worktreePlanPath = join(worktree, "docs", "superpowers", "plans", "task.md");
		const completionMdPath = join(worktree, "docs", "superpowers", "completion.md");
		const manifestPath = join(root, "plan-run.json");
		const manifest = createReadyManifest({
			completionMdPath,
			originalPlanPath,
			repoPath,
			worktree,
			worktreePlanPath,
		});
		const packet = createPacket({
			completionMdPath,
			manifestPath,
			originalPlanPath,
			repoPath,
			worktree,
			worktreePlanPath,
			overrides: {
				verification_commands: [
					{
						command: "bun test test/codex-plan-run/packet-guard.test.ts",
						exit_code: 1,
					},
				],
			},
		});

		await mkdir(join(worktree, "docs", "superpowers", "plans"), { recursive: true });
		await mkdir(join(repoPath, "plans"), { recursive: true });
		await writeFile(originalPlanPath, "# Original Plan\n", "utf8");
		await writeFile(worktreePlanPath, "# Plan\n", "utf8");
		await writeFile(completionMdPath, "# Completion\n", "utf8");
		await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

		const result = validateCodexReviewRequestPacket({ manifest, packet });

		expect(result.valid).toBe(false);
		expect(result.errors).toContain("verification_commands must all pass");
	});

	it("fails when a verification command is blank", async () => {
		const root = await makeTempDir();
		const worktree = join(root, "worktree");
		const repoPath = join(root, "repo");
		const originalPlanPath = join(repoPath, "plans", "source.md");
		const worktreePlanPath = join(worktree, "docs", "superpowers", "plans", "task.md");
		const completionMdPath = join(worktree, "docs", "superpowers", "completion.md");
		const manifestPath = join(root, "plan-run.json");
		const manifest = createReadyManifest({
			completionMdPath,
			originalPlanPath,
			repoPath,
			worktree,
			worktreePlanPath,
		});
		const packet = createPacket({
			completionMdPath,
			manifestPath,
			originalPlanPath,
			repoPath,
			worktree,
			worktreePlanPath,
			overrides: {
				verification_commands: [
					{
						command: "   ",
						exit_code: 0,
					},
				],
			},
		});

		await mkdir(join(worktree, "docs", "superpowers", "plans"), { recursive: true });
		await mkdir(join(repoPath, "plans"), { recursive: true });
		await writeFile(originalPlanPath, "# Original Plan\n", "utf8");
		await writeFile(worktreePlanPath, "# Plan\n", "utf8");
		await writeFile(completionMdPath, "# Completion\n", "utf8");
		await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

		const result = validateCodexReviewRequestPacket({ manifest, packet });

		expect(result.valid).toBe(false);
		expect(result.errors).toContain("verification_commands must all pass");
	});

	it("fails when verification commands do not include required checks", async () => {
		const root = await makeTempDir();
		const worktree = join(root, "worktree");
		const repoPath = join(root, "repo");
		const originalPlanPath = join(repoPath, "plans", "source.md");
		const worktreePlanPath = join(worktree, "docs", "superpowers", "plans", "task.md");
		const completionMdPath = join(worktree, "docs", "superpowers", "completion.md");
		const manifestPath = join(root, "plan-run.json");
		const manifest = createReadyManifest({
			completionMdPath,
			originalPlanPath,
			repoPath,
			worktree,
			worktreePlanPath,
		});
		const packet = createPacket({
			completionMdPath,
			manifestPath,
			originalPlanPath,
			repoPath,
			worktree,
			worktreePlanPath,
			overrides: {
				verification_commands: [
					{
						command: "true",
						exit_code: 0,
					},
				],
			},
		});

		await mkdir(join(worktree, "docs", "superpowers", "plans"), { recursive: true });
		await mkdir(join(repoPath, "plans"), { recursive: true });
		await writeFile(originalPlanPath, "# Original Plan\n", "utf8");
		await writeFile(worktreePlanPath, "# Plan\n", "utf8");
		await writeFile(completionMdPath, "# Completion\n", "utf8");
		await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

		const result = validateCodexReviewRequestPacket({ manifest, packet });

		expect(result.valid).toBe(false);
		expect(result.errors).toContain("verification_commands must include required checks");
	});

	it("fails when verification commands only echo a required check", async () => {
		const root = await makeTempDir();
		const worktree = join(root, "worktree");
		const repoPath = join(root, "repo");
		const originalPlanPath = join(repoPath, "plans", "source.md");
		const worktreePlanPath = join(worktree, "docs", "superpowers", "plans", "task.md");
		const completionMdPath = join(worktree, "docs", "superpowers", "completion.md");
		const manifestPath = join(root, "plan-run.json");
		const manifest = createReadyManifest({
			completionMdPath,
			originalPlanPath,
			repoPath,
			worktree,
			worktreePlanPath,
		});
		const packet = createPacket({
			completionMdPath,
			manifestPath,
			originalPlanPath,
			repoPath,
			worktree,
			worktreePlanPath,
			overrides: {
				verification_commands: [
					{
						command: "echo bun test",
						exit_code: 0,
					},
				],
			},
		});

		await mkdir(join(worktree, "docs", "superpowers", "plans"), { recursive: true });
		await mkdir(join(repoPath, "plans"), { recursive: true });
		await writeFile(originalPlanPath, "# Original Plan\n", "utf8");
		await writeFile(worktreePlanPath, "# Plan\n", "utf8");
		await writeFile(completionMdPath, "# Completion\n", "utf8");
		await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

		const result = validateCodexReviewRequestPacket({ manifest, packet });

		expect(result.valid).toBe(false);
		expect(result.errors).toContain("verification_commands must include required checks");
	});

	it("fails without accepted main-thread acceptance evidence", async () => {
		const root = await makeTempDir();
		const worktree = join(root, "worktree");
		const repoPath = join(root, "repo");
		const originalPlanPath = join(repoPath, "plans", "source.md");
		const worktreePlanPath = join(worktree, "docs", "superpowers", "plans", "task.md");
		const executionBookPath = join(worktree, "docs", "superpowers", "accepting", "demo", "plan-execution-book.md");
		const completionMdPath = join(worktree, "docs", "superpowers", "completion.md");
		const manifestPath = join(root, "plan-run.json");
		const manifest = {
			...createReadyManifest({
				completionMdPath,
				executionBookPath,
				originalPlanPath,
				repoPath,
				worktree,
				worktreePlanPath,
			}),
			main_acceptance: undefined,
		} as PlanRunManifest;
		const packet = createPacket({
			completionMdPath,
			executionBookPath,
			manifestPath,
			originalPlanPath,
			repoPath,
			worktree,
			worktreePlanPath,
			overrides: { main_thread_acceptance: undefined },
		} as Parameters<typeof createPacket>[0]);

		await mkdir(join(worktree, "docs", "superpowers", "plans"), { recursive: true });
		await mkdir(join(worktree, "docs", "superpowers", "accepting", "demo"), { recursive: true });
		await mkdir(join(repoPath, "plans"), { recursive: true });
		await writeFile(originalPlanPath, "# Original Plan\n", "utf8");
		await writeFile(worktreePlanPath, "# Plan\n", "utf8");
		await writeFile(executionBookPath, "# OMP Plan Execution Book\n", "utf8");
		await writeFile(completionMdPath, "# Completion\n", "utf8");
		await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

		const result = validateCodexReviewRequestPacket({ manifest, packet });

		expect(result.valid).toBe(false);
		expect(result.errors).toContain("main_thread_acceptance is required");
	});

	it("fails when main-thread acceptance evidence is unreadable", async () => {
		const root = await makeTempDir();
		const worktree = join(root, "worktree");
		const repoPath = join(root, "repo");
		const originalPlanPath = join(repoPath, "plans", "source.md");
		const worktreePlanPath = join(worktree, "docs", "superpowers", "plans", "task.md");
		const executionBookPath = join(worktree, "docs", "superpowers", "accepting", "demo", "plan-execution-book.md");
		const completionMdPath = join(worktree, "docs", "superpowers", "completion.md");
		const manifestPath = join(root, "plan-run.json");
		const evidencePath = join(worktree, "docs", "superpowers", "accepting", "demo", "missing-review.json");
		const manifest = {
			...createReadyManifest({
				completionMdPath,
				executionBookPath,
				originalPlanPath,
				repoPath,
				worktree,
				worktreePlanPath,
			}),
			state: "main_acceptance_accepted",
			main_acceptance: {
				result: "MAIN_ACCEPTANCE_ACCEPTED",
				review_round: 1,
				evidence_path: evidencePath,
			},
		} as PlanRunManifest;
		const packet = {
			...createPacket({
				completionMdPath,
				executionBookPath,
				manifestPath,
				originalPlanPath,
				repoPath,
				worktree,
				worktreePlanPath,
			}),
			main_thread_acceptance: {
				result: "MAIN_ACCEPTANCE_ACCEPTED",
				review_round: 1,
				accepted_at: "2026-06-24T00:00:00.000Z",
				evidence_path: evidencePath,
			},
		} as CodexReviewRequestPacket;

		await mkdir(join(worktree, "docs", "superpowers", "plans"), { recursive: true });
		await mkdir(join(worktree, "docs", "superpowers", "accepting", "demo"), { recursive: true });
		await mkdir(join(repoPath, "plans"), { recursive: true });
		await writeFile(originalPlanPath, "# Original Plan\n", "utf8");
		await writeFile(worktreePlanPath, "# Plan\n", "utf8");
		await writeFile(executionBookPath, "# OMP Plan Execution Book\n", "utf8");
		await writeFile(completionMdPath, "# Completion\n", "utf8");
		await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

		const result = validateCodexReviewRequestPacket({ manifest, packet });

		expect(result.valid).toBe(false);
		expect(result.errors).toContain("main_thread_acceptance.evidence_path does not exist");
	});

	for (const command of [
		"bun testfake",
		"bun run check:typesfake",
		"true && bun testfake",
		"true && bun run check:typesfake",
	]) {
		it(`fails when verification command fakes a required check boundary: ${command}`, async () => {
			const root = await makeTempDir();
			const worktree = join(root, "worktree");
			const repoPath = join(root, "repo");
			const originalPlanPath = join(repoPath, "plans", "source.md");
			const worktreePlanPath = join(worktree, "docs", "superpowers", "plans", "task.md");
			const completionMdPath = join(worktree, "docs", "superpowers", "completion.md");
			const manifestPath = join(root, "plan-run.json");
			const manifest = createReadyManifest({
				completionMdPath,
				originalPlanPath,
				repoPath,
				worktree,
				worktreePlanPath,
			});
			const packet = createPacket({
				completionMdPath,
				manifestPath,
				originalPlanPath,
				repoPath,
				worktree,
				worktreePlanPath,
				overrides: {
					verification_commands: [
						{
							command,
							exit_code: 0,
						},
					],
				},
			});

			await mkdir(join(worktree, "docs", "superpowers", "plans"), { recursive: true });
			await mkdir(join(repoPath, "plans"), { recursive: true });
			await writeFile(originalPlanPath, "# Original Plan\n", "utf8");
			await writeFile(worktreePlanPath, "# Plan\n", "utf8");
			await writeFile(completionMdPath, "# Completion\n", "utf8");
			await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");

			const result = validateCodexReviewRequestPacket({ manifest, packet });

			expect(result.valid).toBe(false);
			expect(result.errors).toContain("verification_commands must include required checks");
		});
	}
});
