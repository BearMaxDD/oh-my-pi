import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PlanRunDriverInput, PlanRunDriverResult } from "../../src/codex-plan-run/driver";
import type { PlanExecutionBook } from "../../src/codex-plan-run/execution-book";
import { runPlanRunEntry } from "../../src/codex-plan-run/plan-run-entry";

async function makeTempDir(): Promise<string> {
	return mkdtemp(join(tmpdir(), "plan-run-entry-"));
}

function makeBook(acceptingDir: string): PlanExecutionBook {
	return {
		schema_version: 1,
		run_id: "run-entry-test",
		created_at: "2026-07-01T00:00:00.000Z",
		plan: { path: "/repo/plan.md", sha256: "sha", repo_path: "/repo" },
		accepting_dir: acceptingDir,
		intake_gate: [],
		project_recon: {
			repo_path: "/repo",
			relevant_modules: [],
			likely_files: [],
			existing_patterns: [],
			test_commands: [],
			build_commands: [],
			style_conventions: [],
			risk_areas: [],
			forbidden_changes: [],
			task_file_map: {},
		},
		required_execution_skills: [],
		required_review_skills: [],
		final_tail_skills: [],
		final_acceptance_commands: ["bun run check:types"],
		tasks: [],
	};
}

describe("runPlanRunEntry", () => {
	it("reads an execution book and calls launchPlanRunDriver with settings-derived input", async () => {
		const acceptingDir = await makeTempDir();
		const bookPath = join(acceptingDir, "execution-book.json");
		await writeFile(bookPath, JSON.stringify(makeBook(acceptingDir)), "utf8");
		let captured: PlanRunDriverInput | undefined;
		const result = await runPlanRunEntry({
			bookPath,
			acceptingDir,
			repoPath: "/repo",
			project: "entry-project",
			settings: {
				get: (key: string) => {
					const values: Record<string, unknown> = {
						"superpowers.executionLoop.mode": "role-bound",
						"superpowers.executionLoop.roleBoundExecution.enabled": true,
						"superpowers.executionLoop.roleBoundExecution.requireAdvisorGate": true,
						"superpowers.executionLoop.globalImpactGate.enabled": true,
						"superpowers.executionLoop.globalImpactGate.mode": "required",
						"superpowers.executionLoop.realBusinessSimulationGate.enabled": true,
						"superpowers.executionLoop.realBusinessSimulationGate.allowedEnvironments": ["local"],
					};
					return values[key];
				},
			},
			deps: {
				spawnTask: async () => {
					throw new Error("spawnTask should not be reached by injected runDriver");
				},
				reviewTask: async () => {
					throw new Error("reviewTask should not be reached by injected runDriver");
				},
				runMainAcceptance: async () => {
					throw new Error("runMainAcceptance should not be reached by injected runDriver");
				},
				createRepairDecision: () => {
					throw new Error("createRepairDecision should not be reached by injected runDriver");
				},
				spawnStage: async () => {
					throw new Error("spawnStage should not be reached by injected runDriver");
				},
			},
			runDriver: async (input: PlanRunDriverInput): Promise<PlanRunDriverResult> => {
				captured = input;
				return { state: "ready_for_user" } satisfies PlanRunDriverResult;
			},
		});

		expect(result.state).toBe("ready_for_user");
		expect(captured?.executionBook.run_id).toBe("run-entry-test");
		expect(captured?.acceptingDir).toBe(acceptingDir);
		expect(captured?.repoPath).toBe("/repo");
		expect(captured?.project).toBe("entry-project");
		expect(captured?.enableRoleBoundExecution).toBe(true);
	});

	it("writes a gate failure summary when launcher preflight blocks", async () => {
		const acceptingDir = await makeTempDir();
		const bookPath = join(acceptingDir, "execution-book.json");
		await writeFile(bookPath, JSON.stringify(makeBook(acceptingDir)), "utf8");
		const result = await runPlanRunEntry({
			bookPath,
			acceptingDir,
			repoPath: "/repo",
			project: "entry-project",
			settings: {
				get: (key: string) => {
					const values: Record<string, unknown> = {
						"superpowers.executionLoop.mode": "role-bound",
						"superpowers.executionLoop.roleBoundExecution.enabled": true,
						"superpowers.executionLoop.roleBoundExecution.requireAdvisorGate": true,
						"superpowers.executionLoop.globalImpactGate.enabled": true,
						"superpowers.executionLoop.globalImpactGate.mode": "required",
						"superpowers.executionLoop.realBusinessSimulationGate.enabled": false,
					};
					return values[key];
				},
			},
			deps: {
				spawnTask: async () => {
					throw new Error("spawnTask should not be reached");
				},
				reviewTask: async () => {
					throw new Error("reviewTask should not be reached");
				},
				runMainAcceptance: async () => {
					throw new Error("runMainAcceptance should not be reached");
				},
				createRepairDecision: () => {
					throw new Error("createRepairDecision should not be reached");
				},
			},
			runDriver: async () => {
				throw new Error("runDriver should not be reached — preflight should block first");
			},
		});
		const summary = await readFile(join(acceptingDir, "gate-failure-summary.json"), "utf8");
		expect(result.state).toBe("main_acceptance_fix_required");
		expect(summary).toContain("role-bound execution requires spawnStage dependency");
	});
});
