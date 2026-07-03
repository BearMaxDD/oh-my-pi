import { describe, expect, it } from "bun:test";
import {
	countPendingRequiredTasks,
	createTodoSnapshotForExecutionBook,
	createTodoSnapshotForState,
} from "../../src/codex-plan-run/todo-snapshot";

describe("Codex plan run todo snapshot", () => {
	it("creates protocol tasks for the current plan run state", () => {
		const snapshot = createTodoSnapshotForState({
			runId: "run-1",
			version: 1,
			state: "execution_book_ready",
			now: new Date("2026-06-21T00:00:00.000Z"),
		});

		expect(snapshot).toMatchObject({
			runId: "run-1",
			version: 1,
			state: "execution_book_ready",
			updatedAt: "2026-06-21T00:00:00.000Z",
			source: "state-machine",
		});
		expect(snapshot.phases).toHaveLength(1);
		expect(snapshot.phases[0]?.name).toBe("Codex Plan Protocol");

		const tasks = snapshot.phases[0]?.tasks ?? [];
		expect(tasks.map(task => task.content)).toContain("T03 注入 omp-executing-codex-plan skill");
		expect(tasks.map(task => task.content)).toContain("T04 生成 Plan Execution Book 与 Task Execution Cards");
		expect(tasks.find(task => task.content.startsWith("T01 "))?.status).toBe("completed");
		expect(tasks.find(task => task.content.startsWith("T02 "))?.status).toBe("completed");
		expect(tasks.find(task => task.content.startsWith("T03 "))?.status).toBe("completed");
		expect(tasks.find(task => task.content.startsWith("T04 "))?.status).toBe("completed");
		expect(tasks.find(task => task.content.startsWith("T05 "))?.status).toBe("in_progress");
		expect(tasks.filter(task => task.status === "in_progress")).toHaveLength(1);
	});

	it("counts no pending required tasks when ready for Codex review", () => {
		const snapshot = createTodoSnapshotForState({
			runId: "run-1",
			version: 1,
			state: "ready_for_user",
			now: new Date("2026-06-21T00:00:00.000Z"),
		});

		expect(countPendingRequiredTasks(snapshot.phases)).toBe(0);
	});

	it("adds a dedicated main acceptance phase before packet generation", () => {
		const snapshot = createTodoSnapshotForState({
			runId: "run-1",
			version: 1,
			state: "main_acceptance_review_running",
			now: new Date("2026-06-24T00:00:00.000Z"),
		});

		expect(snapshot.phases.map(phase => phase.name)).toEqual(["Codex Plan Protocol", "Main Acceptance"]);
		expect(snapshot.phases[1]?.tasks).toEqual([
			{ content: "Run main-thread acceptance review", status: "in_progress" },
			{ content: "Fix main acceptance findings", status: "pending" },
			{ content: "Re-run final acceptance commands", status: "pending" },
			{ content: "Generate CodexReviewRequestPacket", status: "pending" },
		]);
	});

	it("tracks main acceptance fix rounds separately from packet generation", () => {
		const snapshot = createTodoSnapshotForState({
			runId: "run-1",
			version: 1,
			state: "main_acceptance_fix_required",
			now: new Date("2026-06-24T00:00:00.000Z"),
		});

		expect(snapshot.phases[1]?.tasks).toEqual([
			{ content: "Run main-thread acceptance review", status: "completed" },
			{ content: "Fix main acceptance findings", status: "in_progress" },
			{ content: "Re-run final acceptance commands", status: "pending" },
			{ content: "Generate CodexReviewRequestPacket", status: "pending" },
		]);
		expect(countPendingRequiredTasks(snapshot.phases)).toBeGreaterThan(0);
	});

	it("marks repair fix tasks in progress while fix tasks are running", () => {
		const snapshot = createTodoSnapshotForState({
			runId: "run-1",
			version: 1,
			state: "fix_tasks_running",
			now: new Date("2026-06-24T00:00:00.000Z"),
		});

		expect(snapshot.phases[1]?.tasks).toEqual([
			{ content: "Run main-thread acceptance review", status: "completed" },
			{ content: "Fix main acceptance findings", status: "in_progress" },
			{ content: "Re-run final acceptance commands", status: "pending" },
			{ content: "Generate CodexReviewRequestPacket", status: "pending" },
		]);
	});

	it("preserves progress up to the failed gate for blocked snapshots", () => {
		const snapshot = createTodoSnapshotForState({
			runId: "run-1",
			version: 1,
			state: "review_packet_validated",
			blockedAt: "review_packet_validated",
			now: new Date("2026-06-21T00:00:00.000Z"),
		});
		const tasks = snapshot.phases[0]?.tasks ?? [];

		expect(tasks.slice(0, 6).map(task => task.status)).toEqual([
			"completed",
			"completed",
			"completed",
			"completed",
			"completed",
			"completed",
		]);
		expect(tasks.find(task => task.content.startsWith("T07 "))?.status).toBe("completed");
		expect(tasks.find(task => task.content.startsWith("T08 "))?.status).toBe("in_progress");
		expect(tasks.filter(task => task.status === "in_progress")).toHaveLength(1);
		expect(countPendingRequiredTasks(snapshot.phases)).toBe(1);
	});

	it("marks required skill injection as in progress when that gate is blocked", () => {
		const snapshot = createTodoSnapshotForState({
			runId: "run-1",
			version: 1,
			state: "main_acceptance_fix_required",
			blockedAt: "main_plan_ready",
			now: new Date("2026-06-21T00:00:00.000Z"),
		});
		const tasks = snapshot.phases[0]?.tasks ?? [];

		expect(tasks.find(task => task.content.startsWith("T01 "))?.status).toBe("completed");
		expect(tasks.find(task => task.content.startsWith("T02 "))?.status).toBe("completed");
		expect(tasks.find(task => task.content.startsWith("T03 "))?.status).toBe("in_progress");
		expect(tasks.filter(task => task.status === "in_progress")).toHaveLength(1);
	});

	it("marks the execution book gate as in progress before todos can initialize", () => {
		const snapshot = createTodoSnapshotForState({
			runId: "run-1",
			version: 1,
			state: "main_acceptance_fix_required",
			blockedAt: "execution_book_ready",
			now: new Date("2026-06-21T00:00:00.000Z"),
		});
		const tasks = snapshot.phases[0]?.tasks ?? [];

		expect(tasks.find(task => task.content.startsWith("T01 "))?.status).toBe("completed");
		expect(tasks.find(task => task.content.startsWith("T02 "))?.status).toBe("completed");
		expect(tasks.find(task => task.content.startsWith("T03 "))?.status).toBe("completed");
		expect(tasks.find(task => task.content.startsWith("T04 "))?.status).toBe("in_progress");
		expect(tasks.find(task => task.content.startsWith("T05 "))?.status).toBe("pending");
		expect(tasks.filter(task => task.status === "in_progress")).toHaveLength(1);
	});

	it("derives visible task todos from the plan execution book", () => {
		const snapshot = createTodoSnapshotForExecutionBook({
			runId: "run-1",
			version: 2,
			state: "execution_book_ready",
			tasks: [
				{ id: "T01", title: "Write tests" },
				{ id: "T02", title: "Implement parser" },
			],
			acceptedTaskIds: new Set(["T01"]),
			fixRequiredTaskIds: new Set(["T02"]),
			now: new Date("2026-06-21T00:00:00.000Z"),
		});

		expect(snapshot.phases.map(phase => phase.name)).toEqual(["Codex Plan Protocol", "Plan Execution Book Tasks"]);
		expect(snapshot.phases[1]?.tasks).toEqual([
			{ id: "T01", content: "T01 Write tests", status: "completed" },
			{ id: "T02", content: "T02 Implement parser", status: "in_progress" },
		]);
		expect(countPendingRequiredTasks(snapshot.phases)).toBeGreaterThan(0);
	});

	it("attaches model assignments to execution book task todos", () => {
		const snapshot = createTodoSnapshotForExecutionBook({
			runId: "run-1",
			version: 2,
			state: "tasks_running",
			tasks: [
				{
					id: "T05",
					title: "Shard latency metrics",
					modelAssignment: {
						executionModel: {
							role: "task",
							model: "deepseek/deepseek-r1",
							displayName: "deepseek-r1",
							source: "modelRoles",
							scope: "current-run",
						},
						advisorModel: {
							role: "advisor",
							model: "openai/gpt-5.5",
							displayName: "gpt-5.5",
							source: "runtimeOverride",
							scope: "current-run",
						},
					},
				},
			],
			now: new Date("2026-06-28T00:00:00.000Z"),
		});

		expect(snapshot.phases[1]?.tasks[0]).toMatchObject({
			id: "T05",
			content: "T05 Shard latency metrics",
			modelAssignment: {
				executionModel: { model: "deepseek/deepseek-r1", displayName: "deepseek-r1" },
				advisorModel: { model: "openai/gpt-5.5", displayName: "gpt-5.5" },
			},
		});
	});
});

describe("autonomous todo snapshot", () => {
	it("marks missing TDD evidence as blocked task status", () => {
		const snapshot = createTodoSnapshotForExecutionBook({
			book: {
				run_id: "run-1",
				tasks: [{ id: "T1", title: "Implement feature" }],
			},
			taskStatuses: { T1: "blocked_missing_red_evidence" },
		});

		const tasks = snapshot.tasks ?? [];
		expect(tasks[0]?.status).toBe("blocked");
		expect(tasks[0]?.blockers).toContain("blocked_missing_red_evidence");
	});
});
