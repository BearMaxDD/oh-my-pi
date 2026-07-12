import { describe, expect, mock, test } from "bun:test";
import type {
	AdvisorAgent,
	AdvisorBeforeRunInput,
	AdvisorRunAugmentation,
	AdvisorRuntimeHost,
} from "../../src/advisor/runtime";
import { AdvisorRuntime } from "../../src/advisor/runtime";

/**
 * Minimal mock agent that satisfies AdvisorAgent and records prompts.
 */
function makeMockAgent(): AdvisorAgent & { prompts: string[] } {
	const prompts: string[] = [];
	return {
		prompts,
		async prompt(input: string) {
			prompts.push(input);
		},
		abort() {},
		reset() {},
		state: { messages: [] },
	};
}

const HASH = "sha256-abc123def456";

describe("AdvisorRuntime — compliance review queue", () => {
	test("requestReview accepts, deduplicates, and invokes beforeRun", async () => {
		const agent = makeMockAgent();
		const beforeRun = mock(
			(_input: AdvisorBeforeRunInput): Promise<AdvisorRunAugmentation | undefined> => Promise.resolve(undefined),
		);
		const host: AdvisorRuntimeHost = {
			snapshotMessages: () => agent.state.messages,
			enqueueAdvice() {},
			beforeRun,
		};
		const runtime = new AdvisorRuntime(agent, host);

		// First call — should accept
		const receipt = runtime.requestReview({
			trigger: "compliance_review",
			reviewId: "review-1",
			metadata: { taskId: "task-9", contractHash: HASH, attempt: 1 },
		});
		expect(receipt).toEqual({ accepted: true, reviewId: "review-1" });

		// Wait for drain to process the review
		await runtime.waitForCatchup(1000, 1);

		// beforeRun should have been called with compliance_review trigger
		expect(beforeRun.mock.calls.length).toBeGreaterThanOrEqual(1);
		const call0 = beforeRun.mock.calls[0]![0];
		expect(call0.trigger).toBe("compliance_review");
		expect(call0.reviewId).toBe("review-1");

		// Second call — same reviewId → duplicate
		const dup = runtime.requestReview({
			trigger: "compliance_review",
			reviewId: "review-1",
		});
		expect(dup).toEqual({
			accepted: false,
			reviewId: "review-1",
			reason: "duplicate",
		});

		runtime.dispose();
	});

	test("normal onTurnEnd uses turn_end trigger and still works", async () => {
		const agent = makeMockAgent();
		const beforeRun = mock(
			(_input: AdvisorBeforeRunInput): Promise<AdvisorRunAugmentation | undefined> => Promise.resolve(undefined),
		);
		const host: AdvisorRuntimeHost = {
			snapshotMessages: () => agent.state.messages,
			enqueueAdvice() {},
			beforeRun,
		};
		const runtime = new AdvisorRuntime(agent, host);

		// Simulate a primary turn — messages appear, onTurnEnd pushes turn_end
		agent.state.messages.push({
			role: "user",
			content: "Hello",
			timestamp: Date.now(),
		} as never);
		runtime.onTurnEnd();

		await runtime.waitForCatchup(1000, 1);

		// beforeRun should be called with turn_end
		expect(beforeRun.mock.calls.length).toBeGreaterThanOrEqual(1);
		const call0 = beforeRun.mock.calls[0]![0];
		expect(call0.trigger).toBe("turn_end");
		// Normal turn_end has no reviewId
		expect(call0.reviewId).toBeUndefined();

		runtime.dispose();
	});

	test("failure isolation — hook failure retries, then normal turn still works", async () => {
		const agent = makeMockAgent();
		let callCount = 0;
		const beforeRun = mock((_input: AdvisorBeforeRunInput): Promise<AdvisorRunAugmentation | undefined> => {
			callCount++;
			if (callCount <= 3) throw new Error("hook transient failure");
			return Promise.resolve(undefined);
		});
		const host: AdvisorRuntimeHost = {
			snapshotMessages: () => agent.state.messages,
			enqueueAdvice() {},
			beforeRun,
		};
		const runtime = new AdvisorRuntime(agent, host, 10); // short retry delay

		// Push a compliance review
		runtime.requestReview({
			trigger: "compliance_review",
			reviewId: "review-iso-1",
			metadata: { attempt: 1 },
		});

		// Wait for all retries to exhaust
		await runtime.waitForCatchup(2000, 1);

		// beforeRun should have been called at least 3 times (consecutive failures)
		expect(beforeRun.mock.calls.length).toBeGreaterThanOrEqual(3);

		// Now push a normal turn_end — should succeed
		callCount = 0; // reset so next hook call succeeds
		agent.state.messages.push({
			role: "user",
			content: "normal update",
			timestamp: Date.now(),
		} as never);
		runtime.onTurnEnd();

		await runtime.waitForCatchup(1000, 1);

		// Normal turn_end should have triggered beforeRun with turn_end
		const turnEndCalls = beforeRun.mock.calls.filter(c => (c[0] as AdvisorBeforeRunInput).trigger === "turn_end");
		expect(turnEndCalls.length).toBeGreaterThanOrEqual(1);

		runtime.dispose();
	});
});
