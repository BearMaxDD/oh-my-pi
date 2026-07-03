import { describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildPlanExecutionBookToolResult } from "../../src/tools/plan-execution-book";

describe("plan_execution_book tool", () => {
	it("creates autonomous execution artifacts", async () => {
		const result = await buildPlanExecutionBookToolResult({
			mode: "autonomous",
			runId: "run-1",
			userRequest: "Add export",
			repoPath: "/repo",
			recon: {
				summary: "TypeScript repo",
				relevant_files: ["src/export.ts"],
				test_commands: ["bun test test/export.test.ts"],
				build_commands: ["bun run check:types"],
				risks: ["missing regression"],
			},
		});

		expect(result.run_id).toBe("run-1");
		expect(result.artifacts.map(artifact => artifact.path)).toContain("plan-execution-book.md");
		expect(result.artifacts.map(artifact => artifact.path)).toContain("tdd-evidence-matrix.json");
		expect(result.artifacts.find(artifact => artifact.path === "plan-execution-book.md")?.content).toContain(
			"# OMP Plan Execution Book",
		);
		expect(
			JSON.parse(result.artifacts.find(artifact => artifact.path === "task-cards.json")?.content ?? ""),
		).toHaveLength(1);
	});

	it("materializes autonomous artifacts when an artifact directory is provided", async () => {
		const artifactDir = await mkdtemp(join(tmpdir(), "plan-execution-book-"));
		try {
			const result = await buildPlanExecutionBookToolResult({
				mode: "autonomous",
				runId: "run-1",
				userRequest: "Add export",
				repoPath: "/repo",
				artifactDir,
				recon: {
					summary: "TypeScript repo",
					relevant_files: ["src/export.ts"],
					test_commands: ["bun test test/export.test.ts"],
					build_commands: ["bun run check:types"],
					risks: ["missing regression"],
				},
			});

			expect(result.artifacts.every(artifact => artifact.written_path?.startsWith(artifactDir))).toBe(true);
			expect(await readFile(join(artifactDir, "plan-execution-book.md"), "utf8")).toContain(
				"# OMP Plan Execution Book",
			);
			expect(await readFile(join(artifactDir, "advisor-summary.json"), "utf8")).toBe('{\n  "items": []\n}\n');
		} finally {
			await rm(artifactDir, { recursive: true, force: true });
		}
	});
});
