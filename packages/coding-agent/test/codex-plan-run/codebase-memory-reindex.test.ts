import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	type CodebaseMemoryReindexProvider,
	mergeCodebaseMemoryReindexSummary,
	runCodebaseMemoryTaskReindex,
	validateCodebaseMemoryReindexForTaskReview,
} from "../../src/codex-plan-run/codebase-memory-reindex";

const mockProvider: CodebaseMemoryReindexProvider = {
	indexRepository: async () => ({
		exitCode: 0,
		outputExcerpt: "Indexed 150 files successfully",
	}),
	getIndexStatus: async () => ({
		status: "ready",
		project: "oh-my-pi",
		nodes: 1200,
		edges: 3400,
	}),
};

describe("Codebase memory reindex evidence", () => {
	let tmpDir: string;

	beforeAll(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "reindex-test-"));
	});

	afterAll(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("writes JSON and Markdown evidence with status ready after code changes", async () => {
		const evidence = await runCodebaseMemoryTaskReindex({
			runId: "run-1",
			taskId: "T01",
			repoPath: "/tmp/fake-repo",
			project: "oh-my-pi",
			acceptingDir: tmpDir,
			changedFiles: ["src/index.ts", "src/worker.ts"],
			provider: mockProvider,
			now: new Date("2026-06-30T12:00:00.000Z"),
		});

		expect(evidence.schema_version).toBe(1);
		expect(evidence.run_id).toBe("run-1");
		expect(evidence.task_id).toBe("T01");
		expect(evidence.repo_path).toBe("/tmp/fake-repo");
		expect(evidence.project).toBe("oh-my-pi");
		expect(evidence.mode).toBe("fast");
		expect(evidence.started_at).toBe("2026-06-30T12:00:00.000Z");
		expect(evidence.completed_at).toBe("2026-06-30T12:00:00.000Z");
		expect(evidence.status).toBe("ready");
		expect(evidence.index_repository.attempted).toBe(true);
		expect(evidence.index_repository.exit_code).toBe(0);
		expect(evidence.index_repository.output_excerpt).toBe("Indexed 150 files successfully");
		expect(evidence.index_status.status).toBe("ready");
		expect(evidence.index_status.project).toBe("oh-my-pi");
		expect(evidence.index_status.nodes).toBe(1200);
		expect(evidence.index_status.edges).toBe(3400);
		expect(evidence.changed_files).toEqual(["src/index.ts", "src/worker.ts"]);
		expect(evidence.degraded_reason).toBeNull();
		expect(evidence.jsonPath).toBe(join(tmpDir, "tasks", "T01", "codebase-memory-reindex.json"));
		expect(evidence.markdownPath).toBe(join(tmpDir, "tasks", "T01", "codebase-memory-reindex.md"));

		const jsonContent = await readFile(evidence.jsonPath, "utf-8");
		const parsed = JSON.parse(jsonContent);
		expect(parsed.schema_version).toBe(1);
		expect(parsed.status).toBe("ready");
		expect(parsed.task_id).toBe("T01");

		const mdContent = await readFile(evidence.markdownPath, "utf-8");
		expect(mdContent).toContain("# Codebase Memory Reindex Evidence");
		expect(mdContent).toContain("T01");
		expect(mdContent).toContain("ready");
	});

	it("skips indexRepository when no code changes but writes index status evidence", async () => {
		let indexRepositoryCalled = false;
		const trackingProvider: CodebaseMemoryReindexProvider = {
			...mockProvider,
			indexRepository: async () => {
				indexRepositoryCalled = true;
				return { exitCode: 0, outputExcerpt: "" };
			},
		};

		const evidence = await runCodebaseMemoryTaskReindex({
			runId: "run-1",
			taskId: "T02",
			repoPath: "/tmp/fake-repo",
			project: "oh-my-pi",
			acceptingDir: tmpDir,
			changedFiles: [],
			provider: trackingProvider,
			now: new Date("2026-06-30T12:00:01.000Z"),
		});

		expect(indexRepositoryCalled).toBe(false);
		expect(evidence.index_repository.attempted).toBe(false);
		expect(evidence.index_repository.exit_code).toBeNull();
		expect(evidence.status).toBe("ready");
		expect(evidence.index_status.status).toBe("ready");
		expect(evidence.index_status.nodes).toBe(1200);
		expect(evidence.index_status.edges).toBe(3400);

		const jsonContent = await readFile(evidence.jsonPath, "utf-8");
		const parsed = JSON.parse(jsonContent);
		expect(parsed.status).toBe("ready");
		expect(parsed.index_repository.attempted).toBe(false);

		const mdContent = await readFile(evidence.markdownPath, "utf-8");
		expect(mdContent).toContain("# Codebase Memory Reindex Evidence");
		expect(mdContent).toContain("T02");
	});

	it("writes degraded evidence with degraded_reason provider_missing when provider is null", async () => {
		const evidence = await runCodebaseMemoryTaskReindex({
			runId: "run-1",
			taskId: "T03",
			repoPath: "/tmp/fake-repo",
			project: "oh-my-pi",
			acceptingDir: tmpDir,
			changedFiles: ["src/index.ts"],
			provider: null,
			now: new Date("2026-06-30T12:00:02.000Z"),
		});

		expect(evidence.status).toBe("degraded");
		expect(evidence.degraded_reason).toBe("provider_missing");
		expect(evidence.index_repository.attempted).toBe(false);
		expect(evidence.index_repository.exit_code).toBeNull();
		expect(evidence.index_status.status).toBe("unknown");
		expect(evidence.index_status.nodes).toBe(0);
		expect(evidence.index_status.edges).toBe(0);

		expect(validateCodebaseMemoryReindexForTaskReview(evidence)).toBeNull();
	});

	it("yields status failed when indexRepository exits non-zero and blocks task review", async () => {
		const failingProvider: CodebaseMemoryReindexProvider = {
			...mockProvider,
			indexRepository: async () => ({
				exitCode: 1,
				outputExcerpt: "Error: failed to index repository",
			}),
		};

		const evidence = await runCodebaseMemoryTaskReindex({
			runId: "run-1",
			taskId: "T04",
			repoPath: "/tmp/fake-repo",
			project: "oh-my-pi",
			acceptingDir: tmpDir,
			changedFiles: ["src/index.ts"],
			provider: failingProvider,
			now: new Date("2026-06-30T12:00:03.000Z"),
		});

		expect(evidence.status).toBe("failed");
		expect(evidence.index_repository.exit_code).toBe(1);
		expect(evidence.index_repository.output_excerpt).toBe("Error: failed to index repository");

		expect(validateCodebaseMemoryReindexForTaskReview(evidence)).toBe(
			"Codebase Memory reindex status failed for task T04",
		);
	});

	it("writes failed evidence when indexRepository throws", async () => {
		const throwingProvider: CodebaseMemoryReindexProvider = {
			...mockProvider,
			indexRepository: async () => {
				throw new Error("Connection refused");
			},
		};

		const evidence = await runCodebaseMemoryTaskReindex({
			runId: "run-1",
			taskId: "T05",
			repoPath: "/tmp/fake-repo",
			project: "oh-my-pi",
			acceptingDir: tmpDir,
			changedFiles: ["src/index.ts"],
			provider: throwingProvider,
			now: new Date("2026-06-30T12:00:04.000Z"),
		});

		expect(evidence.status).toBe("failed");
		expect(evidence.index_repository.attempted).toBe(true);
		expect(evidence.index_repository.exit_code).toBe(-1);
		expect(evidence.index_repository.output_excerpt).toContain("Connection refused");

		const jsonContent = await readFile(evidence.jsonPath, "utf-8");
		const parsed = JSON.parse(jsonContent);
		expect(parsed.status).toBe("failed");
		expect(parsed.task_id).toBe("T05");

		expect(validateCodebaseMemoryReindexForTaskReview(evidence)).toBe(
			"Codebase Memory reindex status failed for task T05",
		);
	});

	it("produces degraded evidence when getIndexStatus throws", async () => {
		const failingStatusProvider: CodebaseMemoryReindexProvider = {
			...mockProvider,
			indexRepository: async () => ({
				exitCode: 0,
				outputExcerpt: "Indexed successfully",
			}),
			getIndexStatus: async () => {
				throw new Error("Index status unavailable");
			},
		};

		const evidence = await runCodebaseMemoryTaskReindex({
			runId: "run-1",
			taskId: "T06",
			repoPath: "/tmp/fake-repo",
			project: "oh-my-pi",
			acceptingDir: tmpDir,
			changedFiles: [],
			provider: failingStatusProvider,
			now: new Date("2026-06-30T12:00:05.000Z"),
		});

		expect(evidence.status).toBe("degraded");
		expect(evidence.degraded_reason).toBe("index_status_unavailable");
		expect(evidence.index_repository.attempted).toBe(false);
		expect(evidence.index_status.status).toBe("unknown");

		// Degraded does not block review
		expect(validateCodebaseMemoryReindexForTaskReview(evidence)).toBeNull();
	});

	it("throws when taskId contains path traversal", async () => {
		await expect(
			runCodebaseMemoryTaskReindex({
				runId: "run-1",
				taskId: "../evil",
				repoPath: "/tmp/fake-repo",
				project: "oh-my-pi",
				acceptingDir: tmpDir,
				changedFiles: ["src/index.ts"],
				provider: mockProvider,
				now: new Date("2026-06-30T12:00:06.000Z"),
			}),
		).rejects.toThrow("taskId");
	});

	it("writes merged summary file keyed by task id", async () => {
		const e1 = await runCodebaseMemoryTaskReindex({
			runId: "run-1",
			taskId: "T07",
			repoPath: "/tmp/fake-repo",
			project: "oh-my-pi",
			acceptingDir: tmpDir,
			changedFiles: ["src/foo.ts"],
			provider: mockProvider,
			now: new Date("2026-06-30T12:00:04.000Z"),
		});

		const e2 = await runCodebaseMemoryTaskReindex({
			runId: "run-1",
			taskId: "T08",
			repoPath: "/tmp/fake-repo",
			project: "oh-my-pi",
			acceptingDir: tmpDir,
			changedFiles: [],
			provider: mockProvider,
			now: new Date("2026-06-30T12:00:05.000Z"),
		});

		await mergeCodebaseMemoryReindexSummary({
			acceptingDir: tmpDir,
			evidence: [e1, e2],
		});

		const summaryPath = join(tmpDir, "codebase-memory-reindex-summary.json");
		const summaryContent = await readFile(summaryPath, "utf-8");
		const summary = JSON.parse(summaryContent);

		expect(summary.T07).toBeDefined();
		expect(summary.T08).toBeDefined();
		expect(summary.T07.task_id).toBe("T07");
		expect(summary.T07.status).toBe("ready");
		expect(summary.T08.task_id).toBe("T08");
		expect(summary.T08.status).toBe("ready");
	});
});
