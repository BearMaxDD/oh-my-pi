/**
 * Tests for AgentSession.requestAdvisorReview trigger passthrough and fallback.
 *
 * TDD: Verify trigger routing: known trigger → passed through;
 * undefined/unknown → fallback to "compliance_review" + log.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, jest } from "bun:test";
import * as path from "node:path";
import { Agent } from "@oh-my-pi/pi-agent-core";
import type { Model } from "@oh-my-pi/pi-ai";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { AdvisorRuntime } from "@oh-my-pi/pi-coding-agent/advisor";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { getProjectAgentDir, logger, TempDir } from "@oh-my-pi/pi-utils";

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("AgentSession.requestAdvisorReview trigger passthrough", () => {
	let sharedDir: TempDir;
	let authStorage: AuthStorage;
	let modelRegistry: ModelRegistry;
	let model: Model;

	beforeAll(async () => {
		sharedDir = TempDir.createSync("@pi-advisor-review-request-shared-");
		authStorage = await AuthStorage.create(path.join(sharedDir.path(), "testauth.db"));
		authStorage.setRuntimeApiKey("anthropic", "test-key");
		authStorage.setRuntimeApiKey("openai", "test-key");
		authStorage.setRuntimeApiKey("openrouter", "test-key");
		modelRegistry = new ModelRegistry(authStorage);
		const bundled = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!bundled) throw new Error("Expected built-in anthropic model to exist");
		model = bundled;
	});

	afterAll(async () => {
		authStorage.close();
		try { await sharedDir.remove(); } catch { /* best-effort */ }
	});

	let tempDir: TempDir;
	let session: AgentSession;
	let sessionManager: SessionManager;
	let requestReviewSpy: ReturnType<typeof jest.spyOn>;
	let origLogWarn: typeof logger.warn;
	let warnCalls: unknown[][];

	beforeEach(async () => {
		tempDir = TempDir.createSync("@pi-advisor-review-request-");
		sessionManager = SessionManager.create(tempDir.path(), tempDir.path());
		const agent = new Agent({
			initialState: {
				model,
				systemPrompt: ["Test"],
				tools: [],
				messages: [],
			},
		});
		const settings = Settings.isolated({ "compaction.enabled": false });
		session = new AgentSession({
			agent,
			sessionManager,
			settings,
			modelRegistry,
			advisorTools: [],
		});

		// Spy on AdvisorRuntime.requestReview to capture trigger values
		requestReviewSpy = jest.spyOn(AdvisorRuntime.prototype, "requestReview") as ReturnType<typeof jest.spyOn>;

		// Intercept logger.warn to capture unknown-trigger warnings
		warnCalls = [];
		origLogWarn = logger.warn;
		logger.warn = (...args: unknown[]) => {
			warnCalls.push(args);
		};
	});

	afterEach(async () => {
		logger.warn = origLogWarn;
		requestReviewSpy.mockRestore();
		await session.dispose();
		try { await tempDir.remove(); } catch { /* best-effort */ }
	});

	// Enable the advisor after the spy is in place
	async function enableAdvisor(): Promise<void> {
		session.settings.setModelRole("advisor", "anthropic/claude-sonnet-4-5");
		session.setAdvisorEnabled(true);
		expect(session.isAdvisorActive()).toBe(true);
	}

	// -----------------------------------------------------------------------
	// Test 1: known trigger "git_pre_push" is passed through
	// -----------------------------------------------------------------------
	it("passes git_pre_push trigger through to the runtime", async () => {
		await enableAdvisor();
		const result = await session.requestAdvisorReview({
			reviewId: "rev-git-push",
			trigger: "git_pre_push",
		});
		expect(result.status).toBe("accepted");
		expect(requestReviewSpy).toHaveBeenCalledTimes(1);
		expect(requestReviewSpy).toHaveBeenCalledWith(
			expect.objectContaining({ trigger: "git_pre_push", reviewId: "rev-git-push" }),
		);
	});

	// -----------------------------------------------------------------------
	// Test 2: undefined trigger → fallback to "compliance_review"
	// -----------------------------------------------------------------------
	it("falls back to compliance_review when trigger is undefined", async () => {
		await enableAdvisor();
		const result = await session.requestAdvisorReview({
			reviewId: "rev-no-trigger",
		});
		expect(result.status).toBe("accepted");
		expect(requestReviewSpy).toHaveBeenCalledTimes(1);
		expect(requestReviewSpy).toHaveBeenCalledWith(
			expect.objectContaining({ trigger: "compliance_review", reviewId: "rev-no-trigger" }),
		);
		// No warning for undefined trigger
		expect(warnCalls.length).toBe(0);
	});

	// -----------------------------------------------------------------------
	// Test 3: unknown trigger → fallback to "compliance_review" + warning
	// -----------------------------------------------------------------------
	it("falls back to compliance_review and logs warning for unknown trigger", async () => {
		await enableAdvisor();
		const result = await session.requestAdvisorReview({
			reviewId: "rev-unknown",
			trigger: "unknown_trigger" as "git_pre_push", // cast to satisfy TS
		});
		expect(result.status).toBe("accepted");
		expect(requestReviewSpy).toHaveBeenCalledTimes(1);
		expect(requestReviewSpy).toHaveBeenCalledWith(
			expect.objectContaining({ trigger: "compliance_review", reviewId: "rev-unknown" }),
		);
		// Should have logged a warning about the unknown trigger
		expect(warnCalls.length).toBeGreaterThanOrEqual(1);
		const warning = warnCalls[0][0] as string;
		expect(warning).toContain("unknown_trigger");
	});
});
