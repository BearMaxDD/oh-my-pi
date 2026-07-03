import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	REQUIRED_AUTONOMOUS_ARTIFACTS,
	runPlanExecutionBookGate,
	validateAutonomousArtifactSet,
} from "@oh-my-pi/pi-coding-agent/plan-gate/execution-book";
import type { CodebaseMemoryReconProvider } from "../../src/codex-plan-run/codebase-memory-recon";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "omp-plan-book-gate-"));
	tempDirs.push(dir);
	return dir;
}

function sha256(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) {
		await rm(dir, { recursive: true, force: true });
	}
});

describe("plan execution book gate", () => {
	it("defines and validates the autonomous completion artifact set", () => {
		expect(REQUIRED_AUTONOMOUS_ARTIFACTS).toEqual([
			"plan-execution-book.md",
			"plan-run-manifest.json",
			"todo-snapshot.json",
			"events.jsonl",
			"task-review-records.json",
			"tdd-evidence-matrix.json",
			"skill-discovery-report.json",
			"skill-evidence-matrix.json",
			"superpowers-bootstrap-evidence.json",
			"advisor-summary.json",
			"omp-completion.md",
		]);

		const missing = validateAutonomousArtifactSet([
			"plan-execution-book.md",
			"plan-run-manifest.json",
			"todo-snapshot.json",
			"events.jsonl",
			"task-review-records.json",
			"tdd-evidence-matrix.json",
			"skill-discovery-report.json",
			"skill-evidence-matrix.json",
			"superpowers-bootstrap-evidence.json",
			"advisor-summary.json",
		]);

		expect(missing.ok).toBe(false);
		expect(missing.missing).toEqual(["omp-completion.md"]);
		expect(validateAutonomousArtifactSet(REQUIRED_AUTONOMOUS_ARTIFACTS).ok).toBe(true);
	});

	it("validates intake, writes execution book, and derives project recon", async () => {
		const repo = await makeTempDir();
		await Bun.write(
			join(repo, "package.json"),
			JSON.stringify({ scripts: { test: "bun test", "check:types": "tsgo -p tsconfig.json --noEmit" } }),
		);
		const planText = "# Codex Plan\n\nImplement parser.\n";
		const planPath = join(repo, "docs", "superpowers", "plans", "demo.md");
		await Bun.write(planPath, planText);
		const acceptingDir = join(repo, "docs", "superpowers", "accepting", "demo");

		const result = await runPlanExecutionBookGate({
			runId: "run-123",
			planPath,
			planSha256: sha256(planText),
			repoPath: repo,
			acceptingDir,
			requiredExecutionSkills: ["test-driven-development"],
			requiredReviewSkills: ["verification-before-completion"],
			finalTailSkills: ["ponytail"],
			tasks: [
				{
					id: "T01",
					title: "Implement parser",
					source: "Plan section 1",
					todo: "Implement parser.",
					acceptance: ["Parser implementation satisfies the Codex plan section."],
					likelyFiles: ["src/parser.ts", "test/parser.test.ts"],
				},
			],
			skills: [
				{
					name: "test-driven-development",
					filePath: "/skills/test-driven-development/SKILL.md",
					content: "Write a failing test first.",
				},
				{
					name: "verification-before-completion",
					filePath: "/skills/verification-before-completion/SKILL.md",
					content: "Run verification commands.",
				},
				{
					name: "ponytail",
					filePath: "/skills/ponytail/SKILL.md",
					content: "Use the smallest acceptable change.",
				},
			],
			now: new Date("2026-06-23T00:00:00.000Z"),
		});

		expect(result.status).toBe("passed");
		expect(result.nextAllowed).toBe(true);
		expect(result.bookPath).toBe(join(acceptingDir, "plan-execution-book.md"));
		expect(result.book.project_recon.test_commands).toContain("bun test");
		expect(result.book.project_recon.build_commands).toContain("tsgo -p tsconfig.json --noEmit");
		expect(await Bun.file(result.bookPath).text()).toContain("## Project Recon");
		expect(result.manifest.execution_book?.path).toBe(result.bookPath);
		expect(result.todoSnapshot.state).toBe("execution_book_ready");
	});

	it("runs Codebase Memory recon before writing the execution book", async () => {
		const repo = await makeTempDir();
		await Bun.write(join(repo, "package.json"), JSON.stringify({ scripts: { test: "bun test" } }));
		const planText = "# Codex Plan\n\nWire Codebase Memory recon.\n";
		const planPath = join(repo, "docs", "superpowers", "plans", "demo.md");
		await Bun.write(planPath, planText);
		const acceptingDir = join(repo, "docs", "superpowers", "accepting", "demo");
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
					relevantModules: ["src/plan-gate", "src/codex-plan-run"],
					existingPatterns: ["Plan gates are pure functions with explicit evidence files."],
					riskAreas: ["execution book intake gates"],
				};
			},
			async searchTaskContext({ task }) {
				return {
					taskId: task.id,
					files: ["src/plan-gate/execution-book.ts", "src/codex-plan-run/codebase-memory-recon.ts"],
					symbols: [
						{
							name: "runPlanExecutionBookGate",
							qualifiedName: "src.plan-gate.execution-book.runPlanExecutionBookGate",
							file: "src/plan-gate/execution-book.ts",
						},
					],
					patterns: ["Existing gate writes markdown evidence before returning."],
					risks: ["Recon evidence must be auditable from acceptingDir."],
				};
			},
		};

		const result = await runPlanExecutionBookGate({
			runId: "run-cbm",
			planPath,
			planSha256: sha256(planText),
			repoPath: repo,
			acceptingDir,
			requiredExecutionSkills: ["test-driven-development"],
			requiredReviewSkills: ["verification-before-completion"],
			finalTailSkills: ["ponytail"],
			tasks: [
				{
					id: "T01",
					title: "Wire recon",
					source: "Plan section 1",
					todo: "Wire Codebase Memory recon.",
					acceptance: ["Execution book includes Codebase Memory context."],
					likelyFiles: ["src/plan-gate/execution-book.ts"],
				},
			],
			skills: [
				{ name: "test-driven-development", filePath: "/skills/tdd/SKILL.md", content: "TDD" },
				{ name: "verification-before-completion", filePath: "/skills/verify/SKILL.md", content: "Verify" },
				{ name: "ponytail", filePath: "/skills/ponytail/SKILL.md", content: "Small" },
			],
			codebaseMemory: { enabled: true, provider },
			now: new Date("2026-06-24T00:00:00.000Z"),
		});

		expect(result.book.intake_gate).toContainEqual(
			expect.objectContaining({
				gate: "codebase_memory_recon_done",
				result: "PASS",
				evidence: join(acceptingDir, "codebase-memory-recon.json"),
			}),
		);
		expect(result.book.project_recon.task_file_map.T01).toContain("src/codex-plan-run/codebase-memory-recon.ts");
		expect(result.book.project_recon.existing_patterns).toContain(
			"Plan gates are pure functions with explicit evidence files.",
		);
		expect(await Bun.file(join(acceptingDir, "codebase-memory-recon.json")).text()).toContain("Users-demo-repo");
		expect(await Bun.file(join(acceptingDir, "codebase-memory-recon.md")).text()).toContain(
			"runPlanExecutionBookGate",
		);
		expect(await Bun.file(result.bookPath).text()).toContain("codebase_memory_recon_done");
	});

	it("blocks when accepting_dir is outside repo_path", async () => {
		const repo = await makeTempDir();
		const outside = await makeTempDir();
		const planText = "# Codex Plan\n";
		const planPath = join(repo, "plan.md");
		await Bun.write(planPath, planText);

		await expect(
			runPlanExecutionBookGate({
				runId: "run-123",
				planPath,
				planSha256: sha256(planText),
				repoPath: repo,
				acceptingDir: outside,
				requiredExecutionSkills: ["test-driven-development"],
				requiredReviewSkills: ["verification-before-completion"],
				finalTailSkills: ["ponytail"],
				tasks: [{ id: "T01", title: "Task", source: "Plan", todo: "Do it" }],
				skills: [
					{ name: "test-driven-development", filePath: "/skills/tdd/SKILL.md", content: "TDD" },
					{ name: "verification-before-completion", filePath: "/skills/verify/SKILL.md", content: "Verify" },
					{ name: "ponytail", filePath: "/skills/ponytail/SKILL.md", content: "Small" },
				],
			}),
		).rejects.toThrow("accepting_dir must stay inside repo_path");
	});
});
