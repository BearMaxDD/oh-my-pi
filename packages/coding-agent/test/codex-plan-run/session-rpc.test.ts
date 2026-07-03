import { describe, expect, it } from "bun:test";
import type { PlanRunSessionSnapshot } from "../../src/codex-plan-run/types";
import { buildRpcSessionState, type RpcStateSession } from "../../src/modes/rpc/rpc-state";

function createSession(planRun: PlanRunSessionSnapshot | undefined): RpcStateSession {
	return {
		agent: { state: { tools: [] } },
		autoCompactionEnabled: true,
		followUpMode: "all",
		getContextUsage: () => undefined,
		getPlanRunSnapshot: () => planRun,
		getTodoPhases: () => planRun?.todoSnapshot?.phases ?? [],
		interruptMode: "immediate",
		isCompacting: false,
		isStreaming: false,
		messages: [],
		model: undefined,
		queuedMessageCount: 0,
		sessionFile: undefined,
		sessionId: "session-1",
		sessionName: "demo",
		steeringMode: "all",
		systemPrompt: ["system"],
		thinkingLevel: undefined,
	};
}

describe("plan run RPC session state", () => {
	it("includes the plan run snapshot in get_state output", () => {
		const planRun: PlanRunSessionSnapshot = {
			todoSnapshot: {
				runId: "run-1",
				version: 1,
				state: "tasks_running",
				updatedAt: "2026-06-27T00:00:00.000Z",
				source: "state-machine",
				phases: [
					{
						name: "Plan Execution Book Tasks",
						tasks: [
							{
								id: "T1",
								content: "T1 Implement feature",
								status: "blocked",
								blockers: ["blocked_missing_red_evidence"],
							},
						],
					},
				],
			},
		};

		const state = buildRpcSessionState(createSession(planRun));

		expect(state.planRun).toEqual(planRun);
		expect(state.todoPhases[0]?.tasks[0]).toMatchObject({
			id: "T1",
			status: "blocked",
			blockers: ["blocked_missing_red_evidence"],
		});
	});
});
