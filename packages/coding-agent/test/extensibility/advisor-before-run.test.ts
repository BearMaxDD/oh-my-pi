/**
 * Tests for advisor_before_run extension hook.
 *
 * TDD: these tests are written before the implementation.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import * as path from "node:path";
import type { AgentTool } from "@oh-my-pi/pi-agent-core";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { ExtensionRuntime } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/loader";
import {
	EXTENSION_HANDLER_TIMEOUT_MS,
	ExtensionRunner,
	testSetExtensionHandlerTimeoutMs,
} from "@oh-my-pi/pi-coding-agent/extensibility/extensions/runner";
import type {
	AdvisorBeforeRunEvent,
	AdvisorBeforeRunResult,
	AdvisorRunTrigger,
	Extension,
} from "@oh-my-pi/pi-coding-agent/extensibility/extensions/types";
import { Type } from "@oh-my-pi/pi-coding-agent/extensibility/typebox";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { TempDir } from "@oh-my-pi/pi-utils";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function fakeTool(name: string): AgentTool {
	return {
		name,
		description: `Tool ${name}`,
		label: name,
		parameters: Type.Object({}),
		execute: async () => ({ content: [{ type: "text" as const, text: "ok" }] }),
	} as unknown as AgentTool;
}

function makeEvent(
	sessionId: string,
	advisorId: string,
	trigger: AdvisorRunTrigger,
	options?: Partial<Omit<AdvisorBeforeRunEvent, "type" | "sessionId" | "advisorId" | "trigger">>,
): AdvisorBeforeRunEvent {
	return {
		type: "advisor_before_run",
		sessionId,
		advisorId,
		trigger,
		messages: [],
		...options,
	};
}

type HandlerFn = (...args: unknown[]) => Promise<unknown>;

function fakeExtension(name: string, handler: HandlerFn): Extension {
	return {
		path: name,
		resolvedPath: name,
		handlers: new Map<string, HandlerFn[]>([["advisor_before_run", [handler]]]),
		tools: new Map(),
		commands: new Map(),
		flags: new Map(),
		shortcuts: new Map(),
		messageRenderers: new Map(),
		assistantThinkingRenderers: [],
	};
}

function fakeExtensionNoHandler(name: string): Extension {
	return {
		path: name,
		resolvedPath: name,
		handlers: new Map<string, HandlerFn[]>(),
		tools: new Map(),
		commands: new Map(),
		flags: new Map(),
		shortcuts: new Map(),
		messageRenderers: new Map(),
		assistantThinkingRenderers: [],
	};
}

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("advisor_before_run hook", () => {
	let sharedTempDir: TempDir;
	let authStorage: AuthStorage;
	let modelRegistry: ModelRegistry;
	let sessionManager: SessionManager;
	let tempDir: TempDir;

	beforeAll(async () => {
		sharedTempDir = TempDir.createSync("@pi-advisor-before-run-");
		authStorage = await AuthStorage.create(path.join(sharedTempDir.path(), "testauth.db"));
		modelRegistry = new ModelRegistry(authStorage);
	});

	afterAll(() => {
		authStorage.close();
		sharedTempDir.removeSync();
	});

	beforeEach(() => {
		tempDir = TempDir.createSync("@pi-advisor-before-run-test-");
		sessionManager = SessionManager.inMemory();
	});

	afterEach(() => {
		testSetExtensionHandlerTimeoutMs(EXTENSION_HANDLER_TIMEOUT_MS);
		tempDir.removeSync();
	});

	function createRunner(extensions: Extension[]): ExtensionRunner {
		return new ExtensionRunner(extensions, new ExtensionRuntime(), tempDir.path(), sessionManager, modelRegistry);
	}

	// -----------------------------------------------------------------------
	// Test 1: two fake extensions, merged result by load order, frozen
	// -----------------------------------------------------------------------
	it("merges results from multiple handlers preserving load order and freezes arrays", async () => {
		const ext1 = fakeExtension("ext1", async () => {
			return {
				additionalSystemContext: ["rules"],
				additionalTools: [fakeTool("compliance_verdict")],
			} satisfies AdvisorBeforeRunResult;
		});
		const ext2 = fakeExtension("ext2", async () => {
			return {
				additionalSystemContext: ["context"],
			} satisfies AdvisorBeforeRunResult;
		});

		const runner = createRunner([ext1, ext2]);
		const result = await runner.emitBeforeRun(makeEvent("s1", "a1", "turn_end"));

		expect(result).toBeDefined();
		expect(result!.additionalSystemContext).toEqual(["rules", "context"]);
		expect(result!.additionalTools).toHaveLength(1);
		expect(result!.additionalTools![0]!.name).toBe("compliance_verdict");

		// Verify arrays are frozen
		expect(Object.isFrozen(result!.additionalSystemContext!)).toBe(true);
		expect(Object.isFrozen(result!.additionalTools!)).toBe(true);

		// Order: load order preserved
		const ext3 = fakeExtension("ext3", async () => {
			return {
				additionalSystemContext: ["compliance_review"],
				additionalTools: [fakeTool("advise")],
			} satisfies AdvisorBeforeRunResult;
		});
		const runner2 = createRunner([ext1, ext2, ext3]);
		const result2 = await runner2.emitBeforeRun(makeEvent("s1", "a1", "turn_end"));

		expect(result2!.additionalSystemContext).toEqual(["rules", "context", "compliance_review"]);
		expect(result2!.additionalTools!.map(t => t.name)).toEqual(["compliance_verdict", "advise"]);
	});

	// -----------------------------------------------------------------------
	// Test 2: tool conflict rejection
	// -----------------------------------------------------------------------
	it("rejects duplicate tool names from different extensions", async () => {
		const ext1 = fakeExtension("ext1", async () => {
			return {
				additionalTools: [fakeTool("compliance_verdict")],
			} satisfies AdvisorBeforeRunResult;
		});
		const ext2 = fakeExtension("ext2", async () => {
			return {
				additionalTools: [fakeTool("compliance_verdict")],
			} satisfies AdvisorBeforeRunResult;
		});

		const runner = createRunner([ext1, ext2]);

		await expect(runner.emitBeforeRun(makeEvent("s1", "a1", "turn_end"))).rejects.toThrow(
			'duplicate advisor tool "compliance_verdict"',
		);
	});

	// -----------------------------------------------------------------------
	// Test 3: no handler → undefined
	// -----------------------------------------------------------------------
	it("returns undefined when no extension handles the event", async () => {
		const ext = fakeExtensionNoHandler("ext-nohandler");
		const runner = createRunner([ext]);

		const result = await runner.emitBeforeRun(makeEvent("s1", "a1", "turn_end"));

		expect(result).toBeUndefined();
	});

	// -----------------------------------------------------------------------
	// Test 4: compliance_review trigger timeout rejection
	// -----------------------------------------------------------------------
	it("rejects when a compliance_review handler times out", async () => {
		const ext = fakeExtension("ext-timeout", async () => {
			const { promise } = Promise.withResolvers<void>();
			await promise; // never resolves
		});

		// Use a short timeout so the test doesn't hang
		const shortTimeoutMs = 50;
		testSetExtensionHandlerTimeoutMs(shortTimeoutMs);

		const runner = createRunner([ext]);

		// Store the error listener
		const errors: string[] = [];
		runner.onError(err => {
			errors.push(err.error);
		});

		// Timeout should reject (not silently return undefined)
		await expect(runner.emitBeforeRun(makeEvent("s1", "a1", "compliance_review"))).rejects.toThrow("timed out");
		expect(errors.length).toBeGreaterThan(0);
		expect(errors[0]).toContain("timed out");
	});
});
