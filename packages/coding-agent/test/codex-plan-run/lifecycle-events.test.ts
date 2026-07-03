import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	appendPlanRunLifecycleEvent,
	type PlanRunLifecycleEvent,
	readPlanRunLifecycleEvents,
} from "../../src/codex-plan-run/lifecycle-events";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "omp-lifecycle-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) {
		await rm(dir, { recursive: true, force: true });
	}
});

function createMinimalEvent(overrides: Partial<PlanRunLifecycleEvent> = {}): PlanRunLifecycleEvent {
	return {
		run_id: "test-run-123",
		event: "plan_received",
		state: "plan_received",
		at: new Date("2026-06-26T12:00:00Z"),
		acceptingDir: "/tmp/accepting",
		...overrides,
	};
}

describe("Plan run lifecycle events", () => {
	it("appends events to JSONL and preserves order", async () => {
		const dir = await makeTempDir();
		const filePath = join(dir, "lifecycle.jsonl");

		const event1 = createMinimalEvent({ run_id: "run-1", event: "plan_received", state: "plan_received" });
		const event2 = createMinimalEvent({ run_id: "run-1", event: "worktree_ready", state: "worktree_ready" });

		await appendPlanRunLifecycleEvent(filePath, event1);
		await appendPlanRunLifecycleEvent(filePath, event2);

		const events = await readPlanRunLifecycleEvents(filePath);
		expect(events).toHaveLength(2);
		expect(events[0]!.run_id).toBe("run-1");
		expect(events[0]!.event).toBe("plan_received");
		expect(events[0]!.state).toBe("plan_received");
		expect(events[1]!.run_id).toBe("run-1");
		expect(events[1]!.event).toBe("worktree_ready");
		expect(events[1]!.state).toBe("worktree_ready");
	});

	it("creates parent directory when it does not exist", async () => {
		const dir = await makeTempDir();
		const nestedDir = join(dir, "sub", "nested");
		const filePath = join(nestedDir, "events.jsonl");

		const event = createMinimalEvent({ run_id: "create-dir-test" });
		await appendPlanRunLifecycleEvent(filePath, event);

		const content = await readFile(filePath, "utf-8");
		const lines = content.trim().split("\n");
		expect(lines).toHaveLength(1);

		const parsed = JSON.parse(lines[0]!);
		expect(parsed.run_id).toBe("create-dir-test");
	});

	it("throws when run_id is missing", async () => {
		const dir = await makeTempDir();
		const filePath = join(dir, "events.jsonl");

		const event = createMinimalEvent({ run_id: "" });
		await expect(appendPlanRunLifecycleEvent(filePath, event)).rejects.toThrow(
			/PlanRunLifecycleEvent requires a non-empty run_id/,
		);
	});

	it("throws when event is missing", async () => {
		const dir = await makeTempDir();
		const filePath = join(dir, "events.jsonl");

		const event = createMinimalEvent({ event: "" });
		await expect(appendPlanRunLifecycleEvent(filePath, event)).rejects.toThrow(
			/PlanRunLifecycleEvent requires a non-empty event/,
		);
	});

	it("throws when acceptingDir is missing", async () => {
		const dir = await makeTempDir();
		const filePath = join(dir, "events.jsonl");

		const event = createMinimalEvent({ acceptingDir: "" });
		await expect(appendPlanRunLifecycleEvent(filePath, event)).rejects.toThrow(
			/PlanRunLifecycleEvent requires a non-empty acceptingDir/,
		);
	});

	it("truncates stdout and stderr summary fields to max length", async () => {
		const dir = await makeTempDir();
		const filePath = join(dir, "events.jsonl");

		const longOutput = "x".repeat(10_000);
		const event = createMinimalEvent({
			run_id: "truncate-test",
			summary: {
				stdout: longOutput,
				stderr: longOutput,
			},
		});

		await appendPlanRunLifecycleEvent(filePath, event);

		const events = await readPlanRunLifecycleEvents(filePath);
		expect(events).toHaveLength(1);
		expect(events[0]!.summary?.stdout?.length).toBeLessThanOrEqual(4096);
		expect(events[0]!.summary?.stderr?.length).toBeLessThanOrEqual(4096);
		expect(events[0]!.summary?.stdout).toBe("x".repeat(4096));
		expect(events[0]!.summary?.stderr).toBe("x".repeat(4096));
	});

	it("preserves events despite empty JSONL file", async () => {
		const dir = await makeTempDir();
		const filePath = join(dir, "empty.jsonl");

		const events = await readPlanRunLifecycleEvents(filePath);
		expect(events).toEqual([]);
	});

	it("handles event with evidence path", async () => {
		const dir = await makeTempDir();
		const filePath = join(dir, "events.jsonl");

		const event = createMinimalEvent({
			run_id: "evidence-test",
			event: "execution_book_ready",
			evidence: ["/path/to/evidence1.md", "/path/to/evidence2.md"],
		});

		await appendPlanRunLifecycleEvent(filePath, event);

		const events = await readPlanRunLifecycleEvents(filePath);
		expect(events).toHaveLength(1);
		expect(events[0]!.evidence).toEqual(["/path/to/evidence1.md", "/path/to/evidence2.md"]);
	});

	it("serializes Date to ISO string in JSONL", async () => {
		const dir = await makeTempDir();
		const filePath = join(dir, "events.jsonl");

		const at = new Date("2026-06-26T14:30:00.000Z");
		const event = createMinimalEvent({ at });

		await appendPlanRunLifecycleEvent(filePath, event);

		const content = await readFile(filePath, "utf-8");
		const parsed = JSON.parse(content.trim());
		expect(parsed.at).toBe("2026-06-26T14:30:00.000Z");
	});
});
