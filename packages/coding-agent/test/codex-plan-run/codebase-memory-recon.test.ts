import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type CodebaseMemoryReconProvider,
	mergeCodebaseMemoryProjectRecon,
	runCodebaseMemoryExecutionRecon,
} from "../../src/codex-plan-run/codebase-memory-recon";
import type { PlanExecutionBookTaskInput, ProjectRecon } from "../../src/codex-plan-run/execution-book";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "omp-cbm-recon-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) {
		await rm(dir, { recursive: true, force: true });
	}
});

const task: PlanExecutionBookTaskInput = {
	id: "T01",
	title: "Graph-shaped recon",
	source: "plan",
	todo: "Use Codebase Memory graph evidence",
	allowedFiles: ["src/codex-plan-run/codebase-memory-recon.ts"],
	forbiddenFiles: [],
	smokeCommands: [],
};

describe("Codebase Memory graph recon", () => {
	it("writes graph slice nodes, edges, and trace metadata for each task", async () => {
		const repo = await makeTempDir();
		const acceptingDir = await makeTempDir();
		const provider: CodebaseMemoryReconProvider = {
			async getProjectStatus() {
				return { indexed: true, project: "Users-demo-repo", rootPath: repo, nodeCount: 12, edgeCount: 34 };
			},
			async getArchitecture() {
				return { relevantModules: ["src/codex-plan-run"], existingPatterns: [], riskAreas: [] };
			},
			async searchTaskContext() {
				return {
					taskId: "ignored-provider-id",
					files: [join(repo, "src/codex-plan-run/codebase-memory-recon.ts")],
					symbols: [
						{
							name: "runCodebaseMemoryExecutionRecon",
							qualifiedName: "src.codex-plan-run.codebase-memory-recon.runCodebaseMemoryExecutionRecon",
							file: join(repo, "src/codex-plan-run/codebase-memory-recon.ts"),
						},
					],
					patterns: ["Graph evidence records structural edges instead of only file lists."],
					risks: ["CALLS edge drift can hide impacted callers."],
					graph: {
						seed_files: [join(repo, "src/codex-plan-run/codebase-memory-recon.ts")],
						seed_symbols: ["src.codex-plan-run.codebase-memory-recon.runCodebaseMemoryExecutionRecon"],
						nodes: [
							{
								id: "fn:runRecon",
								label: "Function",
								name: "runCodebaseMemoryExecutionRecon",
								qualified_name: "src.codex-plan-run.codebase-memory-recon.runCodebaseMemoryExecutionRecon",
								file_path: join(repo, "src/codex-plan-run/codebase-memory-recon.ts"),
								start_line: 122,
								end_line: 161,
							},
							{
								id: "fn:writeEvidence",
								label: "Function",
								name: "writeEvidence",
								qualified_name: "src.codex-plan-run.codebase-memory-recon.writeEvidence",
								file_path: join(repo, "src/codex-plan-run/codebase-memory-recon.ts"),
							},
						],
						edges: [{ type: "CALLS", source: "fn:runRecon", target: "fn:writeEvidence", confidence: 0.94 }],
						trace_paths: [
							{
								mode: "calls",
								direction: "outbound",
								start: "fn:runRecon",
								end: "fn:writeEvidence",
								edge_types: ["CALLS"],
							},
						],
						risk_nodes: ["fn:runRecon"],
					},
				};
			},
		};

		const recon = await runCodebaseMemoryExecutionRecon({
			repoPath: repo,
			acceptingDir,
			tasks: [task],
			provider,
			now: new Date("2026-06-30T00:00:00.000Z"),
		});

		expect(recon.task_contexts[0].graph.nodes.map(node => node.qualified_name)).toContain(
			"src.codex-plan-run.codebase-memory-recon.runCodebaseMemoryExecutionRecon",
		);
		expect(recon.task_contexts[0].graph.edges).toContainEqual(
			expect.objectContaining({ type: "CALLS", source: "fn:runRecon", target: "fn:writeEvidence" }),
		);
		expect(recon.task_contexts[0].graph.trace_paths[0]).toMatchObject({ mode: "calls", direction: "outbound" });
		expect(recon.task_contexts[0].graph.seed_files).toEqual(["src/codex-plan-run/codebase-memory-recon.ts"]);

		const written = JSON.parse(await readFile(join(acceptingDir, "codebase-memory-recon.json"), "utf8"));
		expect(written.task_contexts[0].graph.edges[0].type).toBe("CALLS");
		const markdown = await readFile(join(acceptingDir, "codebase-memory-recon.md"), "utf8");
		expect(markdown).toContain("## Graph Slice");
		expect(markdown).toContain("CALLS: fn:runRecon -> fn:writeEvidence");
	});

	it("folds graph node file paths into project recon and task file maps", () => {
		const base: ProjectRecon = {
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
		};

		const merged = mergeCodebaseMemoryProjectRecon(base, {
			kind: "execution",
			project: "Users-demo-repo",
			repo_path: "/repo",
			generated_at: "2026-06-30T00:00:00.000Z",
			evidencePath: "/accept/codebase-memory-recon.json",
			markdownPath: "/accept/codebase-memory-recon.md",
			project_status: { indexed: true, project: "Users-demo-repo", rootPath: "/repo" },
			architecture: {},
			task_contexts: [
				{
					taskId: "T01",
					files: [],
					symbols: [],
					patterns: [],
					risks: [],
					graph: {
						seed_files: [],
						seed_symbols: [],
						nodes: [{ label: "Function", name: "handler", file_path: "src/handler.ts" }],
						edges: [],
						trace_paths: [],
						edge_types: [],
						risk_nodes: [],
					},
				},
			],
		});

		expect(merged.likely_files).toContain("src/handler.ts");
		expect(merged.task_file_map.T01).toContain("src/handler.ts");
		expect(merged.existing_patterns).toContain("Codebase Memory graph slice T01: 1 nodes, 0 edges");
	});

	it("preserves distinct graph nodes that share a file path", async () => {
		const repo = await makeTempDir();
		const acceptingDir = await makeTempDir();
		const provider: CodebaseMemoryReconProvider = {
			async getProjectStatus() {
				return { indexed: true, project: "Users-demo-repo", rootPath: repo };
			},
			async getArchitecture() {
				return {};
			},
			async searchTaskContext() {
				return {
					taskId: "T01",
					files: ["src/shared.ts"],
					symbols: [],
					patterns: [],
					risks: [],
					graph: {
						seed_files: ["src/shared.ts"],
						seed_symbols: ["alpha", "beta"],
						nodes: [
							{ label: "Function", name: "alpha", file_path: "src/shared.ts", start_line: 10, end_line: 20 },
							{ label: "Function", name: "beta", file_path: "src/shared.ts", start_line: 30, end_line: 40 },
						],
						edges: [{ type: "CALLS", source: "alpha", target: "beta" }],
						trace_paths: [],
						risk_nodes: ["beta"],
					},
				};
			},
		};

		const recon = await runCodebaseMemoryExecutionRecon({ repoPath: repo, acceptingDir, tasks: [task], provider });

		expect(recon.task_contexts[0].graph.nodes.map(node => node.name)).toEqual(["alpha", "beta"]);
	});
});
