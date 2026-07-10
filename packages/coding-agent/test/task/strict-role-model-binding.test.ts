/**
 * Strict role model binding — resolveStrictRoleModelBinding.
 *
 * Contract:
 * 1. Accepts exact provider/modelId[:thinking] selectors only.
 * 2. Rejects canonical (bare id), pi/ alias, glob patterns, no-provider.
 * 3. Preserves colons inside model ID, strips only the legal thinking suffix.
 * 4. Rejects unavailable model, unsupported thinking, unconfigured role.
 * 5. bindingHash is deterministic (stable across identical inputs).
 * 6. Legacy model-routing fallback behavior is unaffected.
 */

import { describe, expect, it } from "bun:test";
import { resolveStrictRoleModelBinding } from "../../src/task/strict-role-model-binding";
import { Settings } from "../../src/config/settings";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import { Effort } from "@oh-my-pi/pi-catalog/effort";
import type { Model } from "@oh-my-pi/pi-ai";

/**
 * Build a minimal Model fixture with the given provider and id.
 * No reasoning/thinking by default (thinking-unsupported model).
 */
function modelFixture(provider: string, id: string, options?: { reasoning?: boolean }): Model {
	return buildModel({
		id,
		provider,
		api: "openai-responses",
		name: `${provider}/${id}`,
		baseUrl: "https://example.invalid",
		reasoning: options?.reasoning ?? false,
		input: ["text"] as ("text" | "image")[],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 16_000,
		maxTokens: 4_096,
	});
}

/**
 * Reasoning-capable model fixture with explicit thinking efforts.
 */
function reasoningModelFixture(provider: string, id: string): Model {
	return buildModel({
		id,
		provider,
		api: "openai-responses",
		name: `${provider}/${id}`,
		baseUrl: "https://example.invalid",
		reasoning: true,
		input: ["text"] as ("text" | "image")[],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 200_000,
		maxTokens: 8_192,
	});
}

/**
 * Create isolated settings with the given modelRoles map.
 */
function settingsWith(modelRoles: Record<string, string>): Settings {
	return Settings.isolated({ modelRoles });
}

describe("resolveStrictRoleModelBinding", () => {
	it("accepts exact provider/modelId with explicit thinking level", () => {
		const models = [reasoningModelFixture("openai", "gpt-5.2-codex")];
		const settings = settingsWith({ "superpowers:implementer": "openai/gpt-5.2-codex:high" });
		const binding = resolveStrictRoleModelBinding({
			validatedRoleId: "superpowers:implementer",
			contract: {} as never, // placeholder — contract validation is separate
			settings,
			availableModels: models,
		});

		expect(binding.schemaVersion).toBe(1);
		expect(binding.roleId).toBe("superpowers:implementer");
		expect(binding.provider).toBe("openai");
		expect(binding.modelId).toBe("gpt-5.2-codex");
		expect(binding.thinkingLevel).toBe(Effort.High);
		expect(binding.thinkingSource).toBe("explicit");
		expect(binding.canonicalSelector).toBe("openai/gpt-5.2-codex");
	});

	it("accepts exact provider/modelId without thinking suffix", () => {
		const models = [modelFixture("ollama", "qwen3:32b")];
		const settings = settingsWith({ "superpowers:implementer": "ollama/qwen3:32b" });
		const binding = resolveStrictRoleModelBinding({
			validatedRoleId: "superpowers:implementer",
			contract: {} as never,
			settings,
			availableModels: models,
		});

		expect(binding.provider).toBe("ollama");
		expect(binding.modelId).toBe("qwen3:32b");
		expect(binding.thinkingLevel).toBeUndefined();
		expect(binding.thinkingSource).toBe("model_default");
	});

	it("preserves colons inside modelId, stripping only the legal thinking suffix", () => {
		const models = [reasoningModelFixture("ollama", "qwen3:32b")];
		const settings = settingsWith({ "superpowers:implementer": "ollama/qwen3:32b:high" });
		const binding = resolveStrictRoleModelBinding({
			validatedRoleId: "superpowers:implementer",
			contract: {} as never,
			settings,
			availableModels: models,
		});

		// The model ID retains the internal colon; only the trailing
		// `:high` thinking suffix is stripped.
		expect(binding.modelId).toBe("qwen3:32b");
		expect(binding.thinkingLevel).toBe(Effort.High);
	});

	it("rejects canonical selector without a provider (bare model id)", () => {
		const models = [modelFixture("openai", "gpt-5.2-codex")];
		const settings = settingsWith({ "superpowers:implementer": "gpt-5.2-codex" });
		expect(() =>
			resolveStrictRoleModelBinding({
				validatedRoleId: "superpowers:implementer",
				contract: {} as never,
				settings,
				availableModels: models,
			}),
		).toThrow(expect.objectContaining({ code: "role_model_not_concrete" }));
	});

	it("rejects pi/ alias selector", () => {
		const settings = settingsWith({ "superpowers:implementer": "pi/implementer" });
		expect(() =>
			resolveStrictRoleModelBinding({
				validatedRoleId: "superpowers:implementer",
				contract: {} as never,
				settings,
				availableModels: [],
			}),
		).toThrow(expect.objectContaining({ code: "role_model_not_concrete" }));
	});

	it("rejects glob pattern selector", () => {
		const settings = settingsWith({ "superpowers:implementer": "openrouter/*" });
		expect(() =>
			resolveStrictRoleModelBinding({
				validatedRoleId: "superpowers:implementer",
				contract: {} as never,
				settings,
				availableModels: [],
			}),
		).toThrow(expect.objectContaining({ code: "role_model_not_concrete" }));
	});

	it("does NOT match OpenRouter fallback — exact provider/model only", () => {
		// openai/gpt-5.2-codex is in availableModels but the configured
		// selector is an OpenRouter model that has no match. The resolver
		// MUST NOT fall back to the openai variant.
		const models = [modelFixture("openai", "gpt-5.2-codex")];
		const settings = settingsWith({ "superpowers:implementer": "openrouter/gpt-5.2-codex" });
		expect(() =>
			resolveStrictRoleModelBinding({
				validatedRoleId: "superpowers:implementer",
				contract: {} as never,
				settings,
				availableModels: models,
			}),
		).toThrow(expect.objectContaining({ code: "role_model_unavailable" }));
	});

	it("accepts Vertex modelId with embedded @ — not treated as upstream routing", () => {
		// Vertex AI model selectors include an `@version` component (e.g.
		// claude-opus-4-8@default). The resolver MUST NOT strip the `@` suffix
		// as upstream routing syntax.
		const modelId = "claude-opus-4-8@default";
		const models = [modelFixture("google-vertex", modelId)];
		const settings = settingsWith({ "superpowers:implementer": `google-vertex/${modelId}` });
		const binding = resolveStrictRoleModelBinding({
			validatedRoleId: "superpowers:implementer",
			contract: {} as never,
			settings,
			availableModels: models,
		});

		expect(binding.provider).toBe("google-vertex");
		expect(binding.modelId).toBe("claude-opus-4-8@default");
	});

	it("rejects an @upstream routing selector as non-concrete when its base model exists", () => {
		const models = [modelFixture("openrouter", "gpt-5")];
		const settings = settingsWith({ "superpowers:implementer": "openrouter/gpt-5@cerebras" });
		expect(() =>
			resolveStrictRoleModelBinding({
				validatedRoleId: "superpowers:implementer",
				contract: {} as never,
				settings,
				availableModels: models,
			}),
		).toThrow(expect.objectContaining({ code: "role_model_not_concrete" }));
	});

	it("rejects cross-provider mismatch — exact provider/model must both be available", () => {
		// Configured openai/gpt-5.2-codex but only openrouter/gpt-5.2-codex
		// exists in availableModels. The resolver MUST NOT cross-provider match.
		const models = [modelFixture("openrouter", "gpt-5.2-codex")];
		const settings = settingsWith({ "superpowers:implementer": "openai/gpt-5.2-codex" });
		expect(() =>
			resolveStrictRoleModelBinding({
				validatedRoleId: "superpowers:implementer",
				contract: {} as never,
				settings,
				availableModels: models,
			}),
		).toThrow(expect.objectContaining({ code: "role_model_unavailable" }));
	});

	it("throws role_model_unconfigured for a role with no modelRoles entry", () => {
		const settings = settingsWith({});
		expect(() =>
			resolveStrictRoleModelBinding({
				validatedRoleId: "superpowers:implementer",
				contract: {} as never,
				settings,
				availableModels: [],
			}),
		).toThrow(expect.objectContaining({ code: "role_model_unconfigured" }));
	});

	it("throws role_model_unavailable when the exact model is not in availableModels", () => {
		const settings = settingsWith({ "superpowers:implementer": "openai/gpt-5.2-codex" });
		expect(() =>
			resolveStrictRoleModelBinding({
				validatedRoleId: "superpowers:implementer",
				contract: {} as never,
				settings,
				availableModels: [],
			}),
		).toThrow(expect.objectContaining({ code: "role_model_unavailable" }));
	});

	it("throws role_thinking_unsupported when model does not support the requested thinking level", () => {
		// modelFixture creates a non-reasoning model (reasoning: false)
		const models = [modelFixture("openai", "gpt-5.2-codex")];
		const settings = settingsWith({ "superpowers:implementer": "openai/gpt-5.2-codex:high" });
		expect(() =>
			resolveStrictRoleModelBinding({
				validatedRoleId: "superpowers:implementer",
				contract: {} as never,
				settings,
				availableModels: models,
			}),
		).toThrow(expect.objectContaining({ code: "role_thinking_unsupported" }));
	});

	it("preserves configuredSelector on the binding", () => {
		const models = [reasoningModelFixture("openai", "gpt-5.2-codex")];
		const selector = "openai/gpt-5.2-codex:high";
		const settings = settingsWith({ "superpowers:implementer": selector });
		const binding = resolveStrictRoleModelBinding({
			validatedRoleId: "superpowers:implementer",
			contract: {} as never,
			settings,
			availableModels: models,
		});

		expect(binding.configuredSelector).toBe(selector);
	});

	it("sets schemaVersion to 1", () => {
		const models = [reasoningModelFixture("openai", "gpt-5.2-codex")];
		const settings = settingsWith({ "superpowers:implementer": "openai/gpt-5.2-codex" });
		const binding = resolveStrictRoleModelBinding({
			validatedRoleId: "superpowers:implementer",
			contract: {} as never,
			settings,
			availableModels: models,
		});

		expect(binding.schemaVersion).toBe(1);
	});

	it("includes a createdAt ISO timestamp", () => {
		const models = [reasoningModelFixture("openai", "gpt-5.2-codex")];
		const settings = settingsWith({ "superpowers:implementer": "openai/gpt-5.2-codex" });
		const binding = resolveStrictRoleModelBinding({
			validatedRoleId: "superpowers:implementer",
			contract: {} as never,
			settings,
			availableModels: models,
		});

		expect(binding.createdAt).toBeDefined();
		expect(() => new Date(binding.createdAt)).not.toThrow();
	});

	it("error objects include the roleId field", () => {
		const settings = settingsWith({});
		try {
			resolveStrictRoleModelBinding({
				validatedRoleId: "superpowers:implementer",
				contract: {} as never,
				settings,
				availableModels: [],
			});
			expect.unreachable("Should have thrown");
		} catch (error) {
			const err = error as { code: string; roleId: string };
			expect(err.roleId).toBe("superpowers:implementer");
		}
	});

	it("rejects non-aggregator @upstream syntax as non-concrete when its base model exists", () => {
		// Routing suffixes are invalid for strict binding even when a legacy
		// resolver would discover that this provider cannot route upstream.
		const models = [reasoningModelFixture("openai", "gpt-4o")];
		const settings = settingsWith({ "superpowers:implementer": "openai/gpt-4o@upstream" });
		expect(() =>
			resolveStrictRoleModelBinding({
				validatedRoleId: "superpowers:implementer",
				contract: {} as never,
				settings,
				availableModels: models,
			}),
		).toThrow(expect.objectContaining({ code: "role_model_not_concrete" }));
	});

	it("generates a stable bindingHash for identical inputs", () => {
		const models = [reasoningModelFixture("openai", "gpt-5.2-codex")];
		const settings = settingsWith({ "superpowers:implementer": "openai/gpt-5.2-codex:high" });
		const input = {
			validatedRoleId: "superpowers:implementer",
			contract: {} as never,
			settings,
			availableModels: models,
		};
		const binding1 = resolveStrictRoleModelBinding(input);
		const binding2 = resolveStrictRoleModelBinding(input);

		expect(binding1.bindingHash).toBe(binding2.bindingHash);
	});

	it("generates different bindingHashes for different inputs", () => {
		const models = [reasoningModelFixture("openai", "gpt-5.2-codex")];
		const settingsA = settingsWith({ "superpowers:implementer": "openai/gpt-5.2-codex:high" });
		const settingsB = settingsWith({ "superpowers:implementer": "openai/gpt-5.2-codex:low" });
		const inputA = {
			validatedRoleId: "superpowers:implementer",
			contract: {} as never,
			settings: settingsA,
			availableModels: models,
		};
		const inputB = {
			validatedRoleId: "superpowers:implementer",
			contract: {} as never,
			settings: settingsB,
			availableModels: models,
		};
		const bindingA = resolveStrictRoleModelBinding(inputA);
		const bindingB = resolveStrictRoleModelBinding(inputB);

		expect(bindingA.bindingHash).not.toBe(bindingB.bindingHash);
	});
});
