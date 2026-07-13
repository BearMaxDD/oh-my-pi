/**
 * Integration test: AgentSession -> AdvisorRuntime extensionRunner wiring.
 *
 * Verifies that the extensionRunner passed to AgentSession is forwarded to
 * AdvisorRuntime, and that observable events flow through the production path.
 */
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { Agent } from "@oh-my-pi/pi-agent-core";
import { createMockModel } from "@oh-my-pi/pi-ai/providers/mock";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { Snowflake, TempDir } from "@oh-my-pi/pi-utils";

interface RecordedEvent {
	type: string;
	[key: string]: unknown;
}

/**
 * Minimal mock that satisfies the methods AgentSession calls on ExtensionRunner
 * during advisor lifecycle (emit, hasHandlers, emitBeforeRun). Passed with a cast
 * since ExtensionRunner has many more methods the test doesn't exercise.
 */
function makeMockExtensionRunner(): {
	emit: (event: RecordedEvent) => Promise<void>;
	hasHandlers: (_eventType: string) => boolean;
	emitBeforeRun: () => Promise<undefined>;
	events: RecordedEvent[];
	/** Resolves when an `advisor_run_finished` event fires. */
	runFinished: Promise<void>;
} {
	const events: RecordedEvent[] = [];
	const runFinished = Promise.withResolvers<void>();
	return {
		events,
		async emit(event: RecordedEvent) {
			events.push(event);
			if (event.type === "advisor_run_finished") {
				runFinished.resolve();
			}
		},
		hasHandlers: () => true,
		emitBeforeRun: async () => undefined,
		runFinished: runFinished.promise,
	};
}

describe("AgentSession -> AdvisorRuntime extensionRunner wiring", () => {
	let tempDir: TempDir;
	let session: AgentSession;
	let authStorage: AuthStorage;
	let mockRunner: ReturnType<typeof makeMockExtensionRunner>;

	beforeEach(async () => {
		tempDir = TempDir.createSync("@pi-advisor-ext-runner-");

		// Main agent mock model
		const model = getBundledModel("anthropic", "claude-sonnet-4-5")!;
		const mainMock = createMockModel({
			responses: [{ content: ["ok"] }],
		});

		// Advisor mock model — returns instantly
		const advisorMock = createMockModel({
			responses: [{ content: ["review done"] }],
		});

		// Auth + model registry
		authStorage = await AuthStorage.create(tempDir.join(`auth-${Snowflake.next()}.db`));
		authStorage.setRuntimeApiKey("anthropic", "test-key");
		const modelRegistry = new ModelRegistry(authStorage, tempDir.join("models.yml"));

		const sessionManager = SessionManager.inMemory();

		mockRunner = makeMockExtensionRunner();

		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: {
				model,
				systemPrompt: ["Test"],
				tools: [],
				messages: [{ role: "user", content: "test", timestamp: Date.now() }],
			},
			streamFn: mainMock.stream,
		});

		session = new AgentSession({
			agent,
			sessionManager,
			settings: Settings.isolated({
				"advisor.enabled": true,
			}),
			modelRegistry,
			extensionRunner: mockRunner as never,
			advisorStreamFn: advisorMock.stream,
		});

		// Set the advisor model role and (re)build the advisor runtime.
		// The constructor's #buildAdvisorRuntime silently skips when no advisor
		// model is configured, so we set the role first, then enable explicitly.
		session.settings.setModelRole("advisor", "anthropic/claude-sonnet-4-5");
		expect(session.setAdvisorEnabled(true)).toBe(true);
		session.subscribe(() => {});
	});

	afterEach(async () => {
		try {
			await session?.dispose();
		} catch {
			// dispose may throw if already disposed
		}
		authStorage?.close();
		await tempDir?.remove();
	});

	it("wires extensionRunner to AdvisorRuntime and emits observable events on review", async () => {
		// Trigger a compliance review through the full AgentSession path
		const receipt = await session.requestAdvisorReview({
			reviewId: "integration-review-1",
		});
		expect(receipt.status).toBe("accepted");

		// Wait for the advisor to finish its run (the mock returns instantly)
		await mockRunner.runFinished;

		// The advisor runtime should have fired observable events through the
		// extensionRunner: at least advisor_run_started + advisor_run_finished
		const advisorEvents = mockRunner.events.filter(e =>
			e.type.startsWith("advisor_"),
		);
		expect(advisorEvents.length).toBeGreaterThanOrEqual(2);

		const started = advisorEvents.find(e => e.type === "advisor_run_started")!;
		const finished = advisorEvents.find(e => e.type === "advisor_run_finished")!;
		expect(started).toBeDefined();
		expect(finished).toBeDefined();

		// sessionId is the primary session id
		expect(started.sessionId).toBeTypeOf("string");
		expect(finished.sessionId).toBeTypeOf("string");
		expect(started.sessionId).toBe(finished.sessionId);

		// advisorSessionId is a separate UUID (independent from sessionId)
		expect(started.advisorSessionId).toBeTypeOf("string");
		expect(finished.advisorSessionId).toBeTypeOf("string");
		expect(started.advisorSessionId).toBe(finished.advisorSessionId);
		expect(started.advisorSessionId).not.toBe(started.sessionId);

		// Review details pass through
		expect(started.reviewId).toBe("integration-review-1");
		expect(finished.reviewId).toBe("integration-review-1");

		// Order: run_started before run_finished
		const startIdx = mockRunner.events.indexOf(started);
		const finishIdx = mockRunner.events.indexOf(finished);
		expect(startIdx).toBeLessThan(finishIdx);
	});

	it("emits advisor events with compliance_review trigger", async () => {
		const receipt = await session.requestAdvisorReview({
			reviewId: "review-trigger-test",
		});
		expect(receipt.status).toBe("accepted");

		await mockRunner.runFinished;

		const started = mockRunner.events.find(e => e.type === "advisor_run_started")!;
		expect(started).toBeDefined();
		expect(started.trigger).toBe("compliance_review");
	});
});
