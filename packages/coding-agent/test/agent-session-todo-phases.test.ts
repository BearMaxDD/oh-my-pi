import { afterEach, describe, expect, it } from "bun:test";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import type { TodoPhase } from "@oh-my-pi/pi-coding-agent/tools/todo";
import { createTestSession, type TestSessionContext } from "./utilities";

describe("AgentSession todo phases", () => {
	let ctx: TestSessionContext | undefined;
	let session: AgentSession;

	afterEach(async () => {
		await ctx?.cleanup();
		ctx = undefined;
	});

	it("preserves model assignments across set/get todo phase round-trips", async () => {
		ctx = await createTestSession({ inMemory: true });
		session = ctx.session;
		const phases: TodoPhase[] = [
			{
				name: "Execution",
				tasks: [
					{
						content: "T05 Shard latency metrics",
						status: "in_progress",
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
			},
		];

		session.setTodoPhases(phases);

		expect(session.getTodoPhases()[0]?.tasks[0]?.modelAssignment).toMatchObject({
			executionModel: { model: "deepseek/deepseek-r1", displayName: "deepseek-r1" },
			advisorModel: { model: "openai/gpt-5.5", displayName: "gpt-5.5" },
		});
	});
});
