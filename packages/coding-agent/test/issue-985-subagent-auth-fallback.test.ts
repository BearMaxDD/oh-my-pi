import { afterEach, describe, expect, test, vi } from "bun:test";
import type { Api, Model } from "@oh-my-pi/pi-ai";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import { kNoAuth } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import {
	type ModelLookupRegistry,
	resolveModelOverrideWithAuthFallback,
} from "@oh-my-pi/pi-coding-agent/config/model-resolver";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import * as sdkModule from "@oh-my-pi/pi-coding-agent/sdk";
import type { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { runSubprocess } from "@oh-my-pi/pi-coding-agent/task/executor";
import type { AgentDefinition, SubagentLifecyclePayload } from "@oh-my-pi/pi-coding-agent/task/types";
import { TASK_SUBAGENT_LIFECYCLE_CHANNEL } from "@oh-my-pi/pi-coding-agent/task/types";

/**
 * Regression test for #985.
 *
 * Reporter screenshot showed parent session on DeepSeek V4 Pro dispatching a
 * task subagent that resolved to `qwen3.6-plus-free` — an opencode-zen model
 * the user has no working credentials for. The dispatch hit a provider that
 * could not serve the model and surfaced a confusing API rejection instead of
 * silently using the parent's already-authenticated model.
 *
 * The fix: at dispatch time, if the resolved subagent model has no working
 * credentials, fall back to the parent session's active model (which by
 * definition has working auth — the parent turn is using it).
 */

const parentModel: Model<Api> = buildModel({
	id: "deepseek-v4-pro",
	name: "DeepSeek V4 Pro",
	api: "openai-completions",
	provider: "deepseek",
	baseUrl: "https://api.deepseek.com",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128000,
	maxTokens: 8192,
});

const unauthedTaskModel: Model<Api> = buildModel({
	id: "qwen3.6-plus-free",
	name: "Qwen3.6 Plus Free",
	api: "openai-completions",
	provider: "opencode-zen",
	baseUrl: "https://opencode.ai/zen/v1",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128000,
	maxTokens: 8192,
});

const badRuntimeModel: Model<Api> = buildModel({
	id: "bad-runtime-model",
	name: "Bad Runtime Model",
	api: "openai-completions",
	provider: "primary",
	baseUrl: "https://api.primary.test",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128000,
	maxTokens: 8192,
});

const sharedModel: Model<Api> = buildModel({
	id: "shared-id",
	name: "Shared",
	api: "openai-completions",
	provider: "deepseek",
	baseUrl: "https://api.deepseek.com",
	reasoning: false,
	input: ["text"],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 128000,
	maxTokens: 8192,
});

interface MockRegistryOptions {
	models: Model<Api>[];
	authedProviders: Set<string>;
}

function createMockRegistry(options: MockRegistryOptions): ModelLookupRegistry & {
	getApiKey(model: Model<Api>): Promise<string | undefined>;
} {
	return {
		getAvailable: () => options.models,
		getApiKey: async (model: Model<Api>) =>
			options.authedProviders.has(model.provider) ? "sk-test-token" : undefined,
	} as unknown as ModelLookupRegistry & { getApiKey(model: Model<Api>): Promise<string | undefined> };
}

function createYieldingSession(): AgentSession {
	const listeners: Array<(event: { type: string; [key: string]: unknown }) => void> = [];
	const session = {
		agent: { state: { systemPrompt: ["test"] } },
		state: { messages: [] },
		extensionRunner: undefined,
		sessionManager: { appendSessionInit: () => {} },
		getActiveToolNames: () => ["yield"],
		setActiveToolsByName: async () => {},
		subscribe: (listener: (event: { type: string; [key: string]: unknown }) => void) => {
			listeners.push(listener);
			return () => {};
		},
		prompt: async () => {
			for (const listener of listeners) {
				listener({
					type: "tool_execution_end",
					toolCallId: "tool-yield",
					toolName: "yield",
					result: { content: [{ type: "text", text: "Result submitted." }], details: { status: "success" } },
					isError: false,
				});
			}
		},
		waitForIdle: async () => {},
		getLastAssistantMessage: () => undefined,
		abort: async () => {},
		dispose: async () => {},
	};
	return session as unknown as AgentSession;
}

describe("issue #985: subagent dispatch auth fallback", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});
	test("falls back to parent active model when resolved subagent model has no auth", async () => {
		const registry = createMockRegistry({
			models: [parentModel, unauthedTaskModel, badRuntimeModel],
			authedProviders: new Set(["deepseek"]), // user has DeepSeek; primary unauthed
		});

		const result = await resolveModelOverrideWithAuthFallback(
			["primary/bad-runtime-model"],
			"deepseek/deepseek-v4-pro",
			registry,
		);

		expect(result.authFallbackUsed).toBe(true);
		expect(result.model?.provider).toBe("deepseek");
		expect(result.model?.id).toBe("deepseek-v4-pro");
	});

	test("does not fall back when resolved subagent model has working auth", async () => {
		const registry = createMockRegistry({
			models: [parentModel, unauthedTaskModel],
			authedProviders: new Set(["deepseek", "opencode-zen"]),
		});

		const result = await resolveModelOverrideWithAuthFallback(
			["qwen3.6-plus-free"],
			"deepseek/deepseek-v4-pro",
			registry,
		);

		expect(result.authFallbackUsed).toBe(false);
		expect(result.model?.provider).toBe("opencode-zen");
		expect(result.model?.id).toBe("qwen3.6-plus-free");
	});

	test("returns primary unchanged when parent active model also has no auth", async () => {
		const registry = createMockRegistry({
			models: [parentModel, unauthedTaskModel],
			authedProviders: new Set(), // nothing authed
		});

		const result = await resolveModelOverrideWithAuthFallback(
			["qwen3.6-plus-free"],
			"deepseek/deepseek-v4-pro",
			registry,
		);

		expect(result.authFallbackUsed).toBe(false);
		expect(result.model?.provider).toBe("opencode-zen");
		expect(result.model?.id).toBe("qwen3.6-plus-free");
	});

	test("returns primary unchanged when no parent active model is provided", async () => {
		const registry = createMockRegistry({
			models: [parentModel, unauthedTaskModel],
			authedProviders: new Set(["deepseek"]),
		});

		const result = await resolveModelOverrideWithAuthFallback(["qwen3.6-plus-free"], undefined, registry);

		expect(result.authFallbackUsed).toBe(false);
		expect(result.model?.provider).toBe("opencode-zen");
	});

	test("does not fall back when subagent and parent resolve to the same model", async () => {
		const registry = createMockRegistry({
			models: [sharedModel],
			authedProviders: new Set(), // even with no auth, identical model means no benefit
		});

		const result = await resolveModelOverrideWithAuthFallback(["deepseek/shared-id"], "deepseek/shared-id", registry);

		expect(result.authFallbackUsed).toBe(false);
		expect(result.model?.id).toBe("shared-id");
	});

	test("treats keyless providers (kNoAuth marker) as authenticated", async () => {
		// Keyless-by-design providers (Ollama, llama.cpp, lm-studio) advertise the
		// kNoAuth sentinel from getApiKey to signal that they do not require
		// credentials. The helper treats this as authenticated so an explicitly
		// configured local model is never silently rerouted to the parent's
		// remote provider (see #1008).
		const registry: ModelLookupRegistry & { getApiKey(model: Model<Api>): Promise<string | undefined> } = {
			getAvailable: () => [parentModel, unauthedTaskModel],
			getApiKey: async (model: Model<Api>) => {
				if (model.provider === "deepseek") return "sk-test";
				if (model.provider === "opencode-zen") return kNoAuth;
				return undefined;
			},
		} as never;

		const result = await resolveModelOverrideWithAuthFallback(
			["qwen3.6-plus-free"],
			"deepseek/deepseek-v4-pro",
			registry,
		);

		expect(result.authFallbackUsed).toBe(false);
		expect(result.model?.provider).toBe("opencode-zen");
		expect(result.model?.id).toBe("qwen3.6-plus-free");
	});

	test("runSubprocess result includes fallbackUsed and requestedModel on auth fallback", async () => {
		vi.spyOn(sdkModule, "createAgentSession").mockResolvedValue({ session: createYieldingSession() } as any);

		const unauthedModel = buildModel({
			id: "unauthed-model",
			name: "Unauthed Model",
			api: "openai-completions",
			provider: "noauth",
			baseUrl: "https://noauth.example.test",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 8192,
		});

		const authedModel = buildModel({
			id: "authed-model",
			name: "Authed Model",
			api: "openai-completions",
			provider: "authed",
			baseUrl: "https://authed.example.test",
			reasoning: false,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 128000,
			maxTokens: 8192,
		});

		const agent: AgentDefinition = {
			name: "task",
			description: "test",
			systemPrompt: "test",
			source: "bundled",
		};

		const modelRegistry = {
			getAvailable: () => [unauthedModel, authedModel],
			refresh: async () => {},
			getApiKey: async (model: Model<Api>) => {
				if (model.provider === "authed") return "sk-authed";
				return undefined;
			},
		};

		const settings = Settings.isolated();
		settings.setModelRole("default", "noauth/unauthed-model");

		const lifecycleEvents: SubagentLifecyclePayload[] = [];
		const eventBus = {
			emit: (channel: string, payload: SubagentLifecyclePayload) => {
				if (channel === TASK_SUBAGENT_LIFECYCLE_CHANNEL) lifecycleEvents.push(payload);
			},
		};

		const result = await runSubprocess({
			cwd: "/tmp",
			agent,
			task: "work",
			assignment: "work",
			index: 0,
			id: "AuthFallback",
			modelOverride: "noauth/unauthed-model",
			modelRole: "test-role",
			requestedModel: "noauth/unauthed-model",
			parentActiveModelPattern: "authed/authed-model",
			modelRegistry: modelRegistry as any,
			settings,
			eventBus: eventBus as any,
		});

		expect(result.fallbackUsed).toBe(true);
		expect(result.requestedModel).toBe("noauth/unauthed-model");
		expect(result.modelRole).toBe("test-role");
		const terminalLifecycleEvent = lifecycleEvents.find(event => event.status !== "started");
		expect(terminalLifecycleEvent?.fallbackUsed).toBe(true);
		expect(terminalLifecycleEvent?.requestedModel).toBe("noauth/unauthed-model");
	});
});
