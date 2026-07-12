/**
 * Tests for AgentSession.requestAdvisorReview and advisor_before_run hook.
 *
 * TDD: these tests are written before the implementation.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as path from "node:path";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { ExtensionRuntime } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/loader";
import { ExtensionRunner } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/runner";
import type {
	AdvisorBeforeRunEvent,
	AdvisorBeforeRunResult,
	AdvisorRunTrigger,
	Extension,
	ExtensionActions,
} from "@oh-my-pi/pi-coding-agent/extensibility/extensions/types";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { TempDir } from "@oh-my-pi/pi-utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeExtension(name: string, handler: (...args: unknown[]) => Promise<unknown>): Extension {
	return {
		path: name,
		resolvedPath: name,
		label: name,
		handlers: new Map([["advisor_before_run", [handler]]]),
		tools: new Map(),
		commands: new Map(),
		shortcuts: new Map(),
		flags: new Map(),
		messageRenderers: new Map(),
		assistantThinkingRenderers: [],
	};
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("AgentSession requestAdvisorReview and advisor_before_run integration", () => {
	let sharedTempDir: TempDir;
	let authStorage: AuthStorage;
	let modelRegistry: ModelRegistry;
	let tempDir: TempDir;
	let sessionManager: SessionManager;

	beforeEach(async () => {
		sharedTempDir = TempDir.createSync("@pi-advisor-review-runtime-");
		authStorage = await AuthStorage.create(path.join(sharedTempDir.path(), "testauth.db"));
		modelRegistry = new ModelRegistry(authStorage);
		tempDir = TempDir.createSync("@pi-advisor-review-runtime-test-");
		sessionManager = SessionManager.inMemory();
	});

	afterEach(() => {
		authStorage.close();
		sharedTempDir.removeSync();
		tempDir.removeSync();
	});

	function createRunner(extensions: Extension[], actions: ExtensionActions): ExtensionRunner {
		const runtime = new ExtensionRuntime();
		const runner = new ExtensionRunner(extensions, runtime, tempDir.path(), sessionManager, modelRegistry);
		runner.initialize(actions, {
			getModel: () => undefined,
			isIdle: () => true,
			abort: () => {},
			hasPendingMessages: () => false,
			shutdown: () => {},
			getContextUsage: () => undefined,
			getSystemPrompt: () => [],
			compact: async () => {},
		});
		return runner;
	}

	// -----------------------------------------------------------------------
	// Test 1: advisor_before_run handler receives expected fields
	// -----------------------------------------------------------------------
	it("advisor_before_run handler receives sessionId, advisorId, messages, metadata", async () => {
		const receivedEvents: AdvisorBeforeRunEvent[] = [];
		const ext = fakeExtension("ext-advisor", (async (event: AdvisorBeforeRunEvent) => {
			receivedEvents.push(event);
			return {
				additionalSystemContext: ["Extra context from extension"],
			} satisfies AdvisorBeforeRunResult;
		}) as (...args: unknown[]) => Promise<unknown>);

		const runner = createRunner([ext], {
			sendMessage: () => {},
			sendUserMessage: () => {},
			appendEntry: () => {},
			setLabel: () => {},
			getActiveTools: () => [],
			getAllTools: () => [],
			setActiveTools: async () => {},
			getCommands: () => [],
			setModel: async () => false,
			getThinkingLevel: () => undefined,
			setThinkingLevel: () => {},
			getSessionName: () => undefined,
			setSessionName: async () => {},
			requestAdvisorReview: async request => {
				// Simulate what AgentSession.requestAdvisorReview would do:
				// forward to the first advisor's runtime
				return { status: "accepted", reviewId: request.reviewId };
			},
		});

		// Emit the advisor_before_run event as the ExtensionRunner would
		const event: AdvisorBeforeRunEvent = {
			type: "advisor_before_run",
			sessionId: "session-abc",
			advisorId: "advisor-1",
			trigger: "compliance_review" as AdvisorRunTrigger,
			messages: Object.freeze([
				{ role: "user", content: "Hello", timestamp: 1 } as AgentMessage,
			]) as readonly AgentMessage[],
			metadata: Object.freeze({ reviewId: "rev-001" }) as Readonly<Record<string, unknown>>,
		};

		const result = await runner.emitBeforeRun(event);

		expect(receivedEvents).toHaveLength(1);
		expect(receivedEvents[0].sessionId).toBe("session-abc");
		expect(receivedEvents[0].advisorId).toBe("advisor-1");
		expect(receivedEvents[0].trigger).toBe("compliance_review");
		expect(receivedEvents[0].messages).toHaveLength(1);
		expect(receivedEvents[0].metadata).toEqual({ reviewId: "rev-001" });
		expect(result).toBeDefined();
		expect(result!.additionalSystemContext).toEqual(["Extra context from extension"]);
	});

	// -----------------------------------------------------------------------
	// Test 2: requestAdvisorReview via the ExtensionActions chain
	// -----------------------------------------------------------------------
	it("requestAdvisorReview is reachable via ExtensionActions", async () => {
		let receivedReviewId: string | undefined;

		const actions: ExtensionActions = {
			sendMessage: () => {},
			sendUserMessage: () => {},
			appendEntry: () => {},
			setLabel: () => {},
			getActiveTools: () => [],
			getAllTools: () => [],
			setActiveTools: async () => {},
			getCommands: () => [],
			setModel: async () => false,
			getThinkingLevel: () => undefined,
			setThinkingLevel: () => {},
			getSessionName: () => undefined,
			setSessionName: async () => {},
			requestAdvisorReview: async request => {
				receivedReviewId = request.reviewId;
				return { status: "accepted", reviewId: request.reviewId };
			},
		};

		const ext = fakeExtensionNoHandler("ext-noop");
		const runner = createRunner([ext], actions);

		const receipt = await runner["runtime"].requestAdvisorReview({
			reviewId: "rev-003",
		});

		expect(receipt.status).toBe("accepted");
		expect(receipt.reviewId).toBe("rev-003");
		expect(receivedReviewId).toBe("rev-003");
	});

	// -----------------------------------------------------------------------
	// Test 3: advisor_before_run handler sees read-only messages
	// -----------------------------------------------------------------------
	it("advisor_before_run handler sees readonly messages", async () => {
		const ext = fakeExtension("ext-immutable", (async (event: AdvisorBeforeRunEvent) => {
			expect(Object.isFrozen(event.messages)).toBe(true);
			return undefined;
		}) as (...args: unknown[]) => Promise<unknown>);

		const runner = createRunner([ext], {
			sendMessage: () => {},
			sendUserMessage: () => {},
			appendEntry: () => {},
			setLabel: () => {},
			getActiveTools: () => [],
			getAllTools: () => [],
			setActiveTools: async () => {},
			getCommands: () => [],
			setModel: async () => false,
			getThinkingLevel: () => undefined,
			setThinkingLevel: () => {},
			getSessionName: () => undefined,
			setSessionName: async () => {},
			requestAdvisorReview: async request => ({ status: "rejected", reviewId: request.reviewId }),
		});

		await runner.emitBeforeRun({
			type: "advisor_before_run",
			sessionId: "s1",
			advisorId: "a1",
			trigger: "turn_end",
			messages: Object.freeze([]) as readonly AgentMessage[],
		});
	});
});

// ---------------------------------------------------------------------------
// Helper: extension without handlers
// ---------------------------------------------------------------------------
function fakeExtensionNoHandler(name: string): Extension {
	return {
		path: name,
		resolvedPath: name,
		label: name,
		handlers: new Map(),
		tools: new Map(),
		commands: new Map(),
		shortcuts: new Map(),
		flags: new Map(),
		messageRenderers: new Map(),
		assistantThinkingRenderers: [],
	};
}
