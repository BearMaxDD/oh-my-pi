import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendPlanRunEvent } from "../../src/codex-plan-run/events";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "omp-plan-events-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) {
		await rm(dir, { recursive: true, force: true });
	}
});

describe("PlanRun events", () => {
	it("writes an event line to events.jsonl and returns the path", async () => {
		const dir = await makeTempDir();
		const resultPath = await appendPlanRunEvent({
			acceptingDir: dir,
			event: {
				schema_version: 1,
				run_id: "run-abc",
				state: "task_running",
				type: "task_running",
				task_id: "T1",
				created_at: "2026-06-30T00:00:00.000Z",
			},
		});

		expect(resultPath).toBe(join(dir, "events.jsonl"));

		const content = await readFile(join(dir, "events.jsonl"), "utf8");
		const lines = content.trim().split("\n");
		expect(lines).toHaveLength(1);

		const parsed = JSON.parse(lines[0]!);
		expect(parsed).toEqual({
			schema_version: 1,
			run_id: "run-abc",
			state: "task_running",
			type: "task_running",
			task_id: "T1",
			created_at: "2026-06-30T00:00:00.000Z",
		});
	});

	it("appends multiple event lines to events.jsonl", async () => {
		const dir = await makeTempDir();
		await appendPlanRunEvent({
			acceptingDir: dir,
			event: {
				schema_version: 1,
				run_id: "run-abc",
				state: "task_green_evidence_pending",
				type: "codebase_memory_reindex_started",
				created_at: "2026-06-30T00:00:00.000Z",
			},
		});
		await appendPlanRunEvent({
			acceptingDir: dir,
			event: {
				schema_version: 1,
				run_id: "run-abc",
				state: "codebase_memory_reindex_done",
				type: "codebase_memory_reindex_completed",
				task_id: "T1",
				created_at: "2026-06-30T00:00:01.000Z",
			},
		});

		const content = await readFile(join(dir, "events.jsonl"), "utf8");
		const lines = content.trim().split("\n");
		expect(lines).toHaveLength(2);

		const first = JSON.parse(lines[0]!);
		expect(first.state).toBe("task_green_evidence_pending");
		expect(first.type).toBe("codebase_memory_reindex_started");
		const second = JSON.parse(lines[1]!);
		expect(second.state).toBe("codebase_memory_reindex_done");
		expect(second.type).toBe("codebase_memory_reindex_completed");
	});

	it("creates parent directories if they do not exist", async () => {
		const base = await makeTempDir();
		const nestedDir = join(base, "deep", "nested");
		await appendPlanRunEvent({
			acceptingDir: nestedDir,
			event: {
				schema_version: 1,
				run_id: "run-xyz",
				state: "created",
				type: "execution_book_ready",
				created_at: "2026-06-30T00:00:00.000Z",
			},
		});

		const content = await readFile(join(nestedDir, "events.jsonl"), "utf8");
		const parsed = JSON.parse(content.trim());
		expect(parsed.run_id).toBe("run-xyz");
	});
});
