import { describe, expect, mock, test } from "bun:test";
import type {
	AdvisorAgent,
	AdvisorBeforeRunInput,
	AdvisorRunAugmentation,
	AdvisorRuntimeHost,
} from "../src/advisor/runtime";
import { AdvisorRuntime } from "../src/advisor/runtime";

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

function makeMockHost(): AdvisorRuntimeHost {
	return {
		snapshotMessages: () => [],
		enqueueAdvice: () => {},
	};
}

interface RecordedEvent {
	type: string;
	[key: string]: unknown;
}

function makeMockExtensionRunner(): {
	emit: (event: RecordedEvent) => Promise<void>;
	hasHandlers: (eventType: string) => boolean;
	events: RecordedEvent[];
} {
	const events: RecordedEvent[] = [];
	return {
		events,
		async emit(event: RecordedEvent) {
			events.push(event);
		},
		hasHandlers: () => true,
	};
}

describe("AdvisorRuntime — observable events", () => {
	test("events fire in correct order with shared advisorSessionId", async () => {
		const agent = makeMockAgent();
		const host = makeMockHost();
		const runner = makeMockExtensionRunner();
		const runtime = new AdvisorRuntime(agent, host, 1000, runner);

		// Trigger a review
		const receipt = runtime.requestReview({
			trigger: "compliance_review",
			reviewId: "review-1",
		});
		expect(receipt).toEqual({ status: "accepted", reviewId: "review-1" });

		// Wait for drain to process the review
		await runtime.waitForCatchup(1000, 1);

		// Verify events
		const events = runner.events;

		// Should have advisor_run_started and advisor_run_finished
		const startEvents = events.filter(e => e.type === "advisor_run_started");
		const finishEvents = events.filter(e => e.type === "advisor_run_finished");

		expect(startEvents.length).toBeGreaterThanOrEqual(1);
		expect(finishEvents.length).toBeGreaterThanOrEqual(1);

		const startEvent = startEvents[0]!;
		const finishEvent = finishEvents[0]!;

		// Verify event fields
		expect(startEvent.type).toBe("advisor_run_started");
		expect(startEvent.advisorSessionId).toBeTypeOf("string");
		expect(startEvent.reviewId).toBe("review-1");
		expect(startEvent.trigger).toBe("compliance_review");

		expect(finishEvent.type).toBe("advisor_run_finished");
		expect(finishEvent.advisorSessionId).toBe(startEvent.advisorSessionId);
		expect(finishEvent.sessionId).toBe(startEvent.sessionId);
		expect(finishEvent.reviewId).toBe("review-1");
		expect(finishEvent.duration).toBeGreaterThanOrEqual(0);

		// Verify order: run_started comes before run_finished
		const startIdx = events.indexOf(startEvent);
		const finishIdx = events.indexOf(finishEvent);
		expect(startIdx).toBeLessThan(finishIdx);

		runtime.dispose();
	});

	test("onTurnEnd also emits advisor events", async () => {
		const agent = makeMockAgent();
		const host: AdvisorRuntimeHost = {
			...makeMockHost(),
			snapshotMessages: () => [
				{
					role: "user",
					content: "test message",
					timestamp: Date.now(),
				} as never,
			],
		};
		const runner = makeMockExtensionRunner();
		const runtime = new AdvisorRuntime(agent, host, 1000, runner);

		runtime.onTurnEnd();

		// Wait for drain
		await runtime.waitForCatchup(1000, 1);

		const events = runner.events;
		const startEvents = events.filter(e => e.type === "advisor_run_started");
		const finishEvents = events.filter(e => e.type === "advisor_run_finished");

		expect(startEvents.length).toBeGreaterThanOrEqual(1);
		expect(finishEvents.length).toBeGreaterThanOrEqual(1);

		const startEvent = startEvents[0]!;
		const finishEvent = finishEvents[0]!;

		// trigger should be turn_end for onTurnEnd events
		expect(startEvent.trigger).toBe("turn_end");

		// Same advisorSessionId across events
		expect(finishEvent.advisorSessionId).toBe(startEvent.advisorSessionId);

		runtime.dispose();
	});

	test("events share same advisorSessionId across start and finish", async () => {
		const agent = makeMockAgent();
		const host = makeMockHost();
		const runner = makeMockExtensionRunner();
		const runtime = new AdvisorRuntime(agent, host, 1000, runner);

		runtime.requestReview({
			trigger: "compliance_review",
			reviewId: "review-session-id",
		});

		await runtime.waitForCatchup(1000, 1);

		const events = runner.events;
		const advisorSessionIds = events
			.filter(e => e.type.startsWith("advisor_"))
			.map(e => e.advisorSessionId as string);

		// All advisor events should share the same advisorSessionId
		expect(advisorSessionIds.length).toBeGreaterThanOrEqual(2);
		for (const id of advisorSessionIds) {
			expect(id).toBe(advisorSessionIds[0]);
		}

		runtime.dispose();
	});
});
