/**
 * AgentSessionModelLock — strict session model lock enforcement.
 *
 * These tests verify that AgentSessionModelLock correctly blocks context
 * promotion and retry-model fallback when a session is created with
 * modelLock.  Ordinary sessions (no modelLock) continue to promote and
 * fall back normally.
 *
 * The modelLock feature has been implemented in production:
 *   - AgentSessionModelLock type exported from sdk.ts
 *   - modelLock field on AgentSessionOptions
 *   - #modelLock stored in constructor
 *   - #tryContextPromotion / #promoteContextModel check #modelLock first
 *   - #tryRetryModelFallback / #tryFireworksFastFallback check #modelLock
 *
 * These tests serve as REGRESSION guards: they confirm the behavior works
 * and will fail if a future change removes the lock guards.
 */

import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import * as path from "node:path";
import { Agent } from "@oh-my-pi/pi-agent-core";
import { createMockModel } from "@oh-my-pi/pi-ai/providers/mock";
import type { Model } from "@oh-my-pi/pi-ai";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { AgentSession, type AgentSessionConfig } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { TempDir } from "@oh-my-pi/pi-utils";
import type { AgentSessionModelLock } from "@oh-my-pi/pi-coding-agent/sdk";

// ── Shared auth/registry fixture ─────────────────────────────────────

let sharedAuth: AuthStorage;
let sharedRegistry: ModelRegistry;
let sharedTempDir: TempDir;

beforeAll(async () => {
	sharedTempDir = TempDir.createSync("@pi-model-lock-");
	sharedAuth = await AuthStorage.create(path.join(sharedTempDir.path(), "testauth.db"));
	sharedAuth.setRuntimeApiKey("anthropic", "test-key");
	sharedAuth.setRuntimeApiKey("openai", "test-key");
	sharedAuth.setRuntimeApiKey("openai-codex", "test-key");
	sharedRegistry = new ModelRegistry(sharedAuth);
});

afterAll(() => { sharedAuth.close(); sharedTempDir.removeSync(); });

describe("AgentSessionModelLock", () => {
	afterEach(() => { vi.restoreAllMocks(); });
	it("type exists and requires strict_role", () => {
		const lock = { strict_role: "superpowers:implementer" } satisfies AgentSessionModelLock;
		expect(lock.strict_role).toBe("superpowers:implementer");
	});
});

	it("rejects a bound model identity that differs from the session model", () => {
		const model = sharedRegistry.find("openai-codex", "gpt-5.3-codex-spark");
		if (!model) throw new Error("Expected codex spark");
		const agent = new Agent({
			initialState: { model, systemPrompt: ["Test"], tools: [], messages: [] },
		});

		expect(() => new AgentSession({
			agent,
			sessionManager: SessionManager.inMemory(),
			settings: Settings.isolated(),
			modelRegistry: sharedRegistry,
			modelLock: {
				strict_role: "superpowers:implementer",
				provider: "openai-codex",
				model_id: "gpt-5.5",
			},
		} satisfies AgentSessionConfig)).toThrow("Strict session model lock does not match the session model");
	});

// ── Context promotion ────────────────────────────────────────────────

describe("Context promotion", () => {
	let session: AgentSession;
	let registry: ModelRegistry;
	let auth: AuthStorage;
	let dir: TempDir;

	beforeEach(async () => {
		dir = TempDir.createSync("@pi-promo-");
		auth = await AuthStorage.create(path.join(dir.path(), "auth.db"));
		auth.setRuntimeApiKey("openai-codex", "test-key");
		registry = new ModelRegistry(auth);
	});

	afterEach(async () => {
		if (session) await session.dispose();
		auth.close();
		dir.removeSync();
	});

	function overflowMsg(m: { provider: string; id: string; api: string }) {
		return {
			role: "assistant" as const, content: [{ type: "text" as const, text: "" }],
			api: m.api, provider: m.provider, model: m.id,
			usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, totalTokens: 0,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 } },
			stopReason: "error" as const, errorMessage: "context_length_exceeded", timestamp: Date.now(),
		};
	}

	it("ordinary session promotes (regression guard)", async () => {
		const spark = registry.find("openai-codex", "gpt-5.3-codex-spark");
		const codex = registry.find("openai-codex", "gpt-5.5");
		if (!spark || !codex) throw new Error("Expected codex models");

		const agent = new Agent({
			initialState: { model: spark, systemPrompt: ["Test"], tools: [], messages: [] },
		});
		session = new AgentSession({
			agent, sessionManager: SessionManager.inMemory(),
			settings: Settings.isolated({ "compaction.enabled": false, "contextPromotion.enabled": true }),
			modelRegistry: registry,
		});

		const { promise, resolve } = Promise.withResolvers<void>();
		const unsub = session.subscribe(e => { if (e.type === "agent_end") { unsub(); resolve(); } });
		const timer = setTimeout(resolve, 2000);
		session.agent.emitExternalEvent({ type: "message_end", message: overflowMsg(spark) });
		session.agent.emitExternalEvent({ type: "agent_end", messages: [overflowMsg(spark)] });
		await promise;
		clearTimeout(timer);
		expect(session.model?.id).toBe(codex.id);
	});

	it("session with modelLock blocks promotion", async () => {
		const spark = registry.find("openai-codex", "gpt-5.3-codex-spark");
		if (!spark) throw new Error("Expected codex spark");

		const agent = new Agent({
			initialState: { model: spark, systemPrompt: ["Test"], tools: [], messages: [] },
		});
		session = new AgentSession({
			agent, sessionManager: SessionManager.inMemory(),
			settings: Settings.isolated({ "compaction.enabled": false, "contextPromotion.enabled": true }),
			modelRegistry: registry,
			modelLock: { strict_role: "superpowers:implementer" } satisfies AgentSessionModelLock,
		} satisfies AgentSessionConfig);

		const { promise, resolve } = Promise.withResolvers<void>();
		const unsub = session.subscribe(e => { if (e.type === "agent_end") { unsub(); resolve(); } });
		const timer = setTimeout(resolve, 500);
		session.agent.emitExternalEvent({ type: "message_end", message: overflowMsg(spark) });
		session.agent.emitExternalEvent({ type: "agent_end", messages: [overflowMsg(spark)] });
		await promise;
		clearTimeout(timer);
		expect(session.model?.id).toBe(spark.id);
	});
});

// ── Retry-model fallback ─────────────────────────────────────────────

describe("Retry-model fallback", () => {
	let session: AgentSession | undefined;
	let registry: ModelRegistry;
	let auth: AuthStorage;
	let dir: TempDir;

	beforeEach(async () => {
		dir = TempDir.createSync("@pi-fallback-");
		auth = await AuthStorage.create(path.join(dir.path(), "auth.db"));
		auth.setRuntimeApiKey("anthropic", "test-key");
		auth.setRuntimeApiKey("openai", "test-key");
		registry = new ModelRegistry(auth);
	});

	afterEach(async () => {
		if (session) { await session.dispose(); session = undefined; }
		auth.close();
		dir.removeSync();
	});

	function makeAgent(initialModel: Model, primaryPat: string, fallbackPat: string) {
		const mock = createMockModel();
		let attempts = 0;
		return new Agent({
			getApiKey: () => "test-key",
			initialState: { model: initialModel, systemPrompt: ["Test"], tools: [], messages: [] },
			streamFn: (model, messages, options) => {
				attempts++;
				const key = `${model.provider}/${model.id}`;
				if (key === primaryPat && attempts <= 1) {
					mock.push({ throw: "overloaded_error: 503" });
				} else if (key === fallbackPat) {
					mock.push({ content: ["Recovered"] });
				} else {
					mock.push({ throw: `Unexpected: ${key}` });
				}
				return mock.stream(model, messages, options);
			},
		});
	}

	function fallbackSettings() {
		const s = Settings.isolated({ "compaction.enabled": false, "retry.baseDelayMs": 5, "retry.maxRetries": 2, "retry.fallbackChains": { default: ["openai/gpt-4o-mini"] } });
		s.setModelRole("default", "anthropic/claude-sonnet-4-5");
		return s;
	}

	it("ordinary session falls back (regression guard)", async () => {
		const primary = registry.find("anthropic", "claude-sonnet-4-5");
		if (!primary) throw new Error("Expected claude-sonnet-4-5");
		const agent = makeAgent(primary, "anthropic/claude-sonnet-4-5", "openai/gpt-4o-mini");
		session = new AgentSession({ agent, sessionManager: SessionManager.inMemory(), settings: fallbackSettings(), modelRegistry: registry });
		await session.prompt("Recover").catch(() => {});
		await session.waitForIdle();
		expect(session.model?.id).toBe("gpt-4o-mini");
	});

	it("session with modelLock blocks fallback", async () => {
		const primary = registry.find("anthropic", "claude-sonnet-4-5");
		if (!primary) throw new Error("Expected claude-sonnet-4-5");
		const agent = makeAgent(primary, "anthropic/claude-sonnet-4-5", "openai/gpt-4o-mini");
		session = new AgentSession({
			agent, sessionManager: SessionManager.inMemory(), settings: fallbackSettings(), modelRegistry: registry,
			modelLock: { strict_role: "superpowers:implementer" } satisfies AgentSessionModelLock,
		} satisfies AgentSessionConfig);
		await session.prompt("Recover").catch(() => {});
		await session.waitForIdle();
		expect(session.model?.id).toBe("claude-sonnet-4-5");
	});
});
