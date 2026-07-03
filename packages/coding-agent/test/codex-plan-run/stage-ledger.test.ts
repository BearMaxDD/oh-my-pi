import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	writeRoleRegistrySnapshot,
	writeStageLedgerEntry,
	writeTodoSnapshotArtifact,
} from "../../src/codex-plan-run/stage-ledger";

const tempDirs: string[] = [];
async function makeTempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "omp-stage-ledger-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe("stage ledger", () => {
	it("writes output, model routing evidence, advisor gates, and manifest stage entry", async () => {
		const acceptingDir = await makeTempDir();
		const entry = await writeStageLedgerEntry({
			acceptingDir,
			runId: "run-ledger-test",
			taskId: "T01",
			stageId: "tdd-writer",
			status: "accepted",
			output: { schema_version: "superpowers.stage_output.tdd_writer.v1", evidence_paths: ["red-evidence.md"] },
			modelRouting: {
				task_id: "T01",
				stage_id: "tdd-writer",
				model_role: "superpowers:tdd-writer",
				resolved_model: "openai/gpt-5.5",
			},
			advisorGates: [
				{ gate: "before_stage", status: "accepted", path: "before-stage.json" },
				{ gate: "after_stage", status: "accepted", path: "after-stage.json" },
			],
		});

		expect(entry.key).toBe("T01:tdd-writer");
		expect(entry.manifest.status).toBe("accepted");
		expect(entry.manifest.advisor_gate_paths).toHaveLength(2);
		await stat(entry.manifest.output_path);
		await stat(entry.manifest.model_routing_path);
		await stat(entry.manifest.advisor_gate_paths[0] as string);
	});

	it("writes role registry snapshot with sha256", async () => {
		const acceptingDir = await makeTempDir();
		const result = await writeRoleRegistrySnapshot({
			acceptingDir,
			registry: { roles: { "superpowers:tdd-writer": { name: "TDD Writer" } } },
		});
		const body = await readFile(result.path, "utf8");
		const expected = createHash("sha256").update(body).digest("hex");

		expect(result.path.endsWith("role-registry-snapshot.json")).toBe(true);
		expect(result.sha256).toBe(expected);
	});

	it("rejects unsafe task and stage path segments", async () => {
		const acceptingDir = await makeTempDir();
		await expect(
			writeStageLedgerEntry({
				acceptingDir,
				runId: "run-ledger-test",
				taskId: "../T01",
				stageId: "tdd-writer",
				status: "accepted",
				output: { evidence_paths: [] },
				modelRouting: { task_id: "T01" },
				advisorGates: [],
			}),
		).rejects.toThrow("Invalid stage ledger path segment");
	});

	it("writes todo-snapshots/0001.json and 0001.md", async () => {
		const acceptingDir = await makeTempDir();
		const result = await writeTodoSnapshotArtifact({
			acceptingDir,
			snapshot: {
				runId: "run-todo-test",
				version: 1,
				state: "tasks_running",
				updatedAt: "2026-06-30T00:00:00.000Z",
				source: "state-machine",
				phases: [
					{
						name: "Role-Bound Execution",
						tasks: [
							{ id: "T01:tdd-writer", content: "task T01: write test", status: "completed" },
							{ id: "T01:implementer", content: "task T01: implement", status: "pending" },
						],
					},
				],
			},
		});

		const jsonBody = await stat(result.jsonPath);
		expect(jsonBody.isFile()).toBe(true);
		const mdBody = await stat(result.markdownPath);
		expect(mdBody.isFile()).toBe(true);
		expect(result.jsonPath).toContain("todo-snapshots/0001.json");
		expect(result.markdownPath).toContain("todo-snapshots/0001.md");
		const mdContent = await readFile(result.markdownPath, "utf8");
		expect(mdContent).toContain("Todo Snapshot");
		expect(mdContent).toContain("Run ID: run-todo-test");
	});
});
