/**
 * Tests for requestAdvisorReview in the ExtensionAPI → ExtensionRuntime → Actions chain.
 *
 * TDD: these tests are written before the implementation.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as path from "node:path";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { ExtensionRuntime } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/loader";
import { ExtensionRunner } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/runner";
import type { Extension, ExtensionActions } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/types";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { TempDir } from "@oh-my-pi/pi-utils";

// ---------------------------------------------------------------------------
// Helpers
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

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("ExtensionAPI → ExtensionRuntime requestAdvisorReview forwarding", () => {
	let sharedTempDir: TempDir;
	let authStorage: AuthStorage;
	let modelRegistry: ModelRegistry;
	let tempDir: TempDir;
	let sessionManager: SessionManager;

	beforeEach(async () => {
		sharedTempDir = TempDir.createSync("@pi-advisor-review-api-");
		authStorage = await AuthStorage.create(path.join(sharedTempDir.path(), "testauth.db"));
		modelRegistry = new ModelRegistry(authStorage);
		tempDir = TempDir.createSync("@pi-advisor-review-api-test-");
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
	// Test 1: ConcreteExtensionAPI.requestAdvisorReview delegates to runtime
	// -----------------------------------------------------------------------
	it("delegates requestAdvisorReview to the injected runtime action", async () => {
		// Mock action: record what was forwarded
		let receivedRequest: unknown;
		const mockAction: ExtensionActions["requestAdvisorReview"] = async request => {
			receivedRequest = request;
			return { status: "accepted", reviewId: request.reviewId };
		};

		const ext = fakeExtensionNoHandler("ext1");
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
			requestAdvisorReview: mockAction,
		});

		// Access the wired runtime directly — ConcreteExtensionAPI delegates here
		const result = await runner["runtime"].requestAdvisorReview({
			reviewId: "rev-001",
			metadata: { source: "test" },
		});

		expect(result).toEqual({ status: "accepted", reviewId: "rev-001" });
		expect(receivedRequest).toEqual({
			reviewId: "rev-001",
			metadata: { source: "test" },
		});
	});

	// -----------------------------------------------------------------------
	// Test 2: ExtensionRuntime throws before initialization
	// -----------------------------------------------------------------------
	it("ExtensionRuntime.requestAdvisorReview throws before initialize", async () => {
		const runtime = new ExtensionRuntime();
		expect(() => runtime.requestAdvisorReview({ reviewId: "test" })).toThrow("Extension runtime not initialized");
	});

	// -----------------------------------------------------------------------
	// Test 3: receipt is forwarded through the full chain
	// -----------------------------------------------------------------------
	it("forwards receipt through the full initialize chain", async () => {
		const mockAction: ExtensionActions["requestAdvisorReview"] = async request => {
			return { status: "rejected", reviewId: request.reviewId, reason: "busy" };
		};

		const ext = fakeExtensionNoHandler("ext1");
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
			requestAdvisorReview: mockAction,
		});

		const result = await runner["runtime"].requestAdvisorReview({
			reviewId: "rev-002",
		});

		expect(result).toEqual({ status: "rejected", reviewId: "rev-002", reason: "busy" });
	});
});
