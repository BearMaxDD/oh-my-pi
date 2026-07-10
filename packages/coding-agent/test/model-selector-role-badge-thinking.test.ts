import { afterEach, beforeAll, beforeEach, describe, expect, test, vi } from "bun:test";
import { stripVTControlCharacters } from "node:util";
import type { Model } from "@oh-my-pi/pi-ai";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { KeybindingsManager } from "@oh-my-pi/pi-coding-agent/config/keybindings";
import type { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { getKnownRoleIds } from "@oh-my-pi/pi-coding-agent/config/model-roles";
import type { ModelRoleBatchUpdateResult } from "@oh-my-pi/pi-coding-agent/config/settings";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { ModelSelectorComponent } from "@oh-my-pi/pi-coding-agent/modes/components/model-selector";
import { SelectorController } from "@oh-my-pi/pi-coding-agent/modes/controllers/selector-controller";
import { getThemeByName, setThemeInstance } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { InteractiveModeContext } from "@oh-my-pi/pi-coding-agent/modes/types";
import { AUTO_THINKING, type ConfiguredThinkingLevel } from "@oh-my-pi/pi-coding-agent/thinking";
import { type Component, setKeybindings, type TUI } from "@oh-my-pi/pi-tui";
import { beginSettingsTest, restoreSettingsTestState, type SettingsTestState } from "./helpers/settings-test-state";

type TestSettings = ReturnType<typeof makeSettings>;

function makeSettings(
	overrides: {
		modelRoles?: Record<string, string>;
		modelTags?: Record<string, any>;
		cycleOrder?: string[];
		modelProviderOrder?: string[];
	} = {},
) {
	return {
		get: (key: string) => {
			if (key === "cycleOrder") return overrides.cycleOrder ?? [];
			if (key === "modelTags") return overrides.modelTags ?? {};
			if (key === "modelProviderOrder") return overrides.modelProviderOrder ?? [];
			return undefined;
		},
		getModelRoles: () => overrides.modelRoles ?? {},
		getModelRole: (role: string) => overrides.modelRoles?.[role],
		getStorage: () => undefined,
	} as any;
}

function normalizeRenderedText(text: string): string {
	return stripVTControlCharacters(text).replace(/\s+/g, " ").trim();
}

function createSelector(model: Model, settings: TestSettings): ModelSelectorComponent {
	const modelRegistry = {
		getAll: () => [model],
		getDiscoverableProviders: () => [],
		getCanonicalModelSelections: () => [],
	} as unknown as ModelRegistry;
	const ui = {
		requestRender: vi.fn(),
	} as unknown as TUI;

	return new ModelSelectorComponent(
		ui,
		model,
		settings,
		modelRegistry,
		[{ model, thinkingLevel: "off" }],
		() => {},
		() => {},
	);
}

function createOllamaCloudModel(id: string): Model {
	return buildModel({
		id,
		name: "DeepSeek V4 Pro",
		api: "ollama-chat",
		provider: "ollama-cloud",
		baseUrl: "https://ollama.com",
		reasoning: true,
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 1_000_000,
		maxTokens: 8192,
	});
}
function createContextTestModel(id: string, contextWindow: number): Model {
	return buildModel({
		id,
		name: id,
		api: "ollama-chat",
		baseUrl: "https://example.com",
		reasoning: false,
		provider: "test",
		input: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow,
		maxTokens: 1024,
	});
}

function createScopedSelector(
	models: Model[],
	settings: Settings,
	onSelect: (model: Model, role: string | null, thinkingLevel?: ConfiguredThinkingLevel, selector?: string) => void,
	options?: { temporaryOnly?: boolean; currentContextTokens?: number },
): ModelSelectorComponent {
	const modelRegistry = {
		getAll: () => models,
		getDiscoverableProviders: () => [],
		getCanonicalModelSelections: () => [],
	} as unknown as ModelRegistry;
	const ui = {
		requestRender: vi.fn(),
	} as unknown as TUI;
	return new ModelSelectorComponent(
		ui,
		undefined,
		settings,
		modelRegistry,
		models.map(model => ({ model })),
		(model, role, thinkingLevel, selector) => onSelect(model, role, thinkingLevel, selector),
		() => {},
		options,
	);
}
let testTheme = await getThemeByName("dark");

function installTestTheme(): void {
	if (!testTheme) {
		throw new Error("Failed to load dark theme for ModelSelector tests");
	}
	setThemeInstance(testTheme);
}

describe("ModelSelector role badge thinking display", () => {
	beforeAll(async () => {
		testTheme = await getThemeByName("dark");
		if (!testTheme) {
			throw new Error("Failed to load dark theme for ModelSelector tests");
		}
	});

	test("shows custom roles from cycleOrder/modelRoles and honors built-in metadata overrides", async () => {
		installTestTheme();
		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Expected bundled model anthropic/claude-sonnet-4-5");

		const settings = makeSettings({
			cycleOrder: ["smol", "custom-fast", "default"],
			modelRoles: {
				default: `${model.provider}/${model.id}`,
				"custom-fast": `${model.provider}/${model.id}:low`,
				smol: `${model.provider}/${model.id}`,
			},
			modelTags: {
				smol: { name: "Quick", color: "error" },
			},
		});

		const selector = createSelector(model, settings);
		await Bun.sleep(0);
		installTestTheme();

		const rendered = normalizeRenderedText(selector.render(220).join("\n"));
		expect(rendered).toContain("custom-fast (low)");
		expect(rendered).toContain("SMOL (inherit)");

		selector.handleInput("\n");
		installTestTheme();
		const menuRendered = normalizeRenderedText(selector.render(220).join("\n"));
		expect(menuRendered).toContain("Set as custom-fast");
		expect(menuRendered).toContain("Set as SMOL (快速小任务/轻量查询，建议轻量模型)");
	});

	test("renders xhigh effort for OpenAI GPT-5.5 thinking options", async () => {
		installTestTheme();
		const model = getBundledModel("openai", "gpt-5.5");
		if (!model) throw new Error("Expected bundled model openai/gpt-5.5");

		const selector = createSelector(model, makeSettings({}));
		await Bun.sleep(0);
		installTestTheme();

		selector.handleInput("\n");
		selector.handleInput("\n");

		const rendered = normalizeRenderedText(selector.render(220).join("\n"));
		expect(rendered).toContain("Thinking for: Default (gpt-5.5)");
		expect(rendered).toContain("low medium high xhigh");
		expect(rendered).not.toContain("low medium high max");
	});

	test("reloads DEFAULT(auto) from defaultThinkingLevel", async () => {
		installTestTheme();
		const model = getBundledModel("openai", "gpt-5.5");
		if (!model) throw new Error("Expected bundled model openai/gpt-5.5");

		const settings = Settings.isolated({
			defaultThinkingLevel: AUTO_THINKING,
			modelRoles: {
				default: `${model.provider}/${model.id}`,
			},
		});

		const selector = createSelector(model, settings);
		await Bun.sleep(0);
		installTestTheme();

		const rendered = normalizeRenderedText(selector.render(220).join("\n"));
		expect(rendered).toContain("DEFAULT (auto)");
	});

	test("renders DEFAULT (auto) when modelRoles.default carries an explicit :auto suffix", async () => {
		installTestTheme();
		const model = getBundledModel("openai", "gpt-5.5");
		if (!model) throw new Error("Expected bundled model openai/gpt-5.5");

		const settings = Settings.isolated({
			modelRoles: {
				default: `${model.provider}/${model.id}:auto`,
			},
		});

		const selector = createSelector(model, settings);
		await Bun.sleep(0);
		installTestTheme();

		const rendered = normalizeRenderedText(selector.render(220).join("\n"));
		expect(rendered).toContain("DEFAULT (auto)");
		expect(rendered).not.toContain("DEFAULT (inherit)");
	});

	test("renders SMOL (auto) when modelRoles.smol carries an explicit :auto suffix", async () => {
		installTestTheme();
		const model = getBundledModel("openai", "gpt-5.5");
		if (!model) throw new Error("Expected bundled model openai/gpt-5.5");

		const settings = Settings.isolated({
			modelRoles: {
				default: `${model.provider}/${model.id}`,
				smol: `${model.provider}/${model.id}:auto`,
			},
		});

		const selector = createSelector(model, settings);
		await Bun.sleep(0);
		installTestTheme();

		const rendered = normalizeRenderedText(selector.render(220).join("\n"));
		expect(rendered).toContain("SMOL (auto)");
		expect(rendered).not.toContain("SMOL (inherit)");
	});

	test("shows compact auto badges for unconfigured role defaults", async () => {
		installTestTheme();
		const settings = makeSettings({});
		const haiku = createContextTestModel("claude-haiku-4.5", 128_000);
		const codex = createContextTestModel("gpt-5.1-codex", 128_000);

		const selector = createScopedSelector([codex, haiku], settings, () => {});
		await Bun.sleep(0);
		installTestTheme();

		const rendered = normalizeRenderedText(selector.render(220).join("\n"));
		expect(rendered).toContain("claude-haiku-4.5");
		expect(rendered).toContain("gpt-5.1-codex");
		expect(rendered).toContain("[SMOL auto]");
		expect(rendered).toContain("[SLOW auto]");
	});

	test("dims and disables models below the current context size in temporary mode", async () => {
		installTestTheme();
		const settings = makeSettings({});
		const small = createContextTestModel("a-small", 4096);
		const large = createContextTestModel("b-large", 128_000);
		const selected: string[] = [];
		const selector = createScopedSelector([small, large], settings, model => selected.push(model.id), {
			temporaryOnly: true,
			currentContextTokens: 6000,
		});
		await Bun.sleep(0);
		installTestTheme();

		const rendered = normalizeRenderedText(selector.render(220).join("\n"));
		expect(rendered).toContain("a-small");
		expect(rendered).toContain("context>4.1k");

		selector.handleInput("\n");
		expect(selected).toEqual(["b-large"]);
	});

	test("labels temporary picker as session-only and points to role assignment", async () => {
		installTestTheme();
		const settings = makeSettings({});
		const model = createContextTestModel("session-model", 128_000);
		const selector = createScopedSelector([model], settings, () => {}, { temporaryOnly: true });
		await Bun.sleep(0);
		installTestTheme();

		const rendered = normalizeRenderedText(selector.render(220).join("\n"));
		expect(rendered).toContain("Temporary model selection is session-only");
		expect(rendered).toContain("Alt+M or /model");
		expect(rendered).toContain("default/smol/plan/task/slow/custom roles");
	});

	test("opens over-context default role actions for global configuration", async () => {
		installTestTheme();
		const settings = makeSettings({});
		const small = createContextTestModel("only-small", 4096);
		const onSelect = vi.fn();
		const selector = createScopedSelector([small], settings, onSelect, {
			currentContextTokens: 6000,
		});
		await Bun.sleep(0);
		installTestTheme();

		const rendered = normalizeRenderedText(selector.render(220).join("\n"));
		expect(rendered).toContain("only-small");
		expect(rendered).not.toContain("current context 6k > 4.1k limit");

		selector.handleInput("\n");
		const afterOpen = normalizeRenderedText(selector.render(220).join("\n"));
		expect(afterOpen).toContain("Action for: only-small");
		expect(afterOpen).toContain("Set as DEFAULT (默认主对话/未指定角色，建议高级模型)");
		expect(afterOpen).not.toContain("context>4.1k");

		selector.handleInput("\n");
		const afterRoleEnter = normalizeRenderedText(selector.render(220).join("\n"));
		expect(afterRoleEnter).toContain("Thinking for: Default (only-small)");
		expect(onSelect).not.toHaveBeenCalled();

		selector.handleInput("\n");
		expect(onSelect.mock.calls[0]?.[0]).toBe(small);
		expect(onSelect.mock.calls[0]?.[1]).toBe("default");
		expect(onSelect.mock.calls[0]?.[3]).toBe("test/only-small");
	});

	test("uses cached models for Enter while offline refresh is still pending", () => {
		installTestTheme();
		const settings = makeSettings({});
		const cachedModel = createContextTestModel("cached-fast", 128_000);
		const refreshGate = Promise.withResolvers<void>();
		const onSelect = vi.fn();
		const modelRegistry = {
			getAll: () => [cachedModel],
			refresh: vi.fn(() => refreshGate.promise),
			refreshProvider: vi.fn(async () => {}),
			getError: () => undefined,
			getAvailable: () => [cachedModel],
			getDiscoverableProviders: () => [],
		} as unknown as ModelRegistry;
		const ui = {
			requestRender: vi.fn(),
		} as unknown as TUI;

		const selector = new ModelSelectorComponent(
			ui,
			undefined,
			settings,
			modelRegistry,
			[],
			model => onSelect(model.id),
			() => {},
			{ temporaryOnly: true },
		);

		selector.handleInput("\n");
		expect(onSelect).toHaveBeenCalledWith("cached-fast");
		expect(modelRegistry.refresh).toHaveBeenCalledTimes(1);
		refreshGate.resolve();
	});

	test("keeps the highlighted model when a background refresh reorders the list", async () => {
		installTestTheme();
		const settings = makeSettings({});
		const modelBb = createContextTestModel("bb-model", 128_000);
		const modelCc = createContextTestModel("cc-model", 128_000);
		const modelAa = createContextTestModel("aa-model", 128_000);
		let availableModels: Model[] = [modelBb, modelCc];
		const refreshGate = Promise.withResolvers<void>();
		const onSelect = vi.fn();
		const modelRegistry = {
			getAll: () => availableModels,
			refresh: vi.fn(() => refreshGate.promise),
			refreshProvider: vi.fn(async () => {}),
			getError: () => undefined,
			getAvailable: () => availableModels,
			getDiscoverableProviders: () => [],
		} as unknown as ModelRegistry;
		const ui = {
			requestRender: vi.fn(),
		} as unknown as TUI;

		const selector = new ModelSelectorComponent(
			ui,
			undefined,
			settings,
			modelRegistry,
			[],
			model => onSelect(model.id),
			() => {},
			{ temporaryOnly: true },
		);

		// Highlight the second entry, then let the pending refresh land a model
		// that sorts ahead of it and shifts every index.
		selector.handleInput("\x1b[B");
		availableModels = [modelAa, modelBb, modelCc];
		refreshGate.resolve();
		await Bun.sleep(0);

		selector.handleInput("\n");
		expect(onSelect).toHaveBeenCalledWith("cc-model");
	});

	test("refreshes Ollama Cloud using provider id instead of tab label", async () => {
		installTestTheme();
		const settings = makeSettings({});
		const discoveredModel = createOllamaCloudModel("deepseek-v4-pro");
		let availableModels: Model[] = [];
		const refreshProvider = vi.fn(async (providerId: string) => {
			if (providerId === "ollama-cloud") {
				availableModels = [discoveredModel];
			}
		});
		const modelRegistry = {
			getAll: () => availableModels,
			refresh: vi.fn(async () => {}),
			refreshProvider,
			getError: () => undefined,
			getAvailable: () => availableModels,
			getDiscoverableProviders: () => ["ollama-cloud"],
			getProviderDiscoveryState: () => ({
				provider: "ollama-cloud",
				status: "idle",
				optional: false,
				stale: false,
				models: [],
			}),
		} as any;
		const ui = {
			requestRender: vi.fn(),
		} as unknown as TUI;

		const selector = new ModelSelectorComponent(
			ui,
			undefined,
			settings,
			modelRegistry,
			[],
			() => {},
			() => {},
		);
		await Bun.sleep(0);
		installTestTheme();

		const initialRendered = normalizeRenderedText(selector.render(220).join("\n"));
		expect(initialRendered).toContain("OLLAMA CLOUD");

		selector.handleInput("\t");
		await Bun.sleep(125);
		installTestTheme();

		expect(refreshProvider).toHaveBeenCalledWith("ollama-cloud", "online");
		expect(modelRegistry.refresh).toHaveBeenCalledTimes(1);
		const rendered = normalizeRenderedText(selector.render(220).join("\n"));
		expect(rendered).toContain("deepseek-v4-pro");
		expect(rendered).not.toContain("Provider has not been refreshed yet");
	});

	test("switches provider tabs immediately and refreshes in background with spinner animation", async () => {
		installTestTheme();
		const settings = makeSettings({});
		const discoveredModel = createOllamaCloudModel("deepseek-v4-pro");
		let availableModels: Model[] = [];
		let resolveRefresh: (() => void) | undefined;
		const refreshProvider = vi.fn(
			(_providerId: string, _strategy?: string) =>
				new Promise<void>(resolve => {
					resolveRefresh = () => {
						availableModels = [discoveredModel];
						resolve();
					};
				}),
		);
		const modelRegistry = {
			getAll: () => availableModels,
			refresh: vi.fn(async () => {}),
			refreshProvider,
			getError: () => undefined,
			getAvailable: () => availableModels,
			getDiscoverableProviders: () => ["ollama-cloud"],
			getProviderDiscoveryState: () => ({
				provider: "ollama-cloud",
				status: "idle",
				optional: false,
				stale: false,
				models: [],
			}),
		} as any;
		const ui = {
			requestRender: vi.fn(),
		} as unknown as TUI;

		const selector = new ModelSelectorComponent(
			ui,
			undefined,
			settings,
			modelRegistry,
			[],
			() => {},
			() => {},
		);
		await Bun.sleep(0);
		installTestTheme();

		selector.handleInput("\t");

		// Core regression: tab switch must not synchronously enter provider refresh.
		expect(refreshProvider).not.toHaveBeenCalled();

		const immediateRendered = normalizeRenderedText(selector.render(220).join("\n"));
		expect(immediateRendered).toContain("Refreshing OLLAMA CLOUD in background");

		await Bun.sleep(5);
		expect(refreshProvider).not.toHaveBeenCalled();
		await Bun.sleep(120);
		expect(refreshProvider).toHaveBeenCalledWith("ollama-cloud", "online");

		const spinnerFrame1 = selector.render(220).join("\n");
		await Bun.sleep(100);
		installTestTheme();
		const spinnerFrame2 = selector.render(220).join("\n");
		expect(normalizeRenderedText(spinnerFrame2)).toContain("Refreshing OLLAMA CLOUD in background");
		expect(spinnerFrame2).not.toEqual(spinnerFrame1);

		resolveRefresh?.();
		await Bun.sleep(10);
		installTestTheme();

		expect(modelRegistry.refresh).toHaveBeenCalledTimes(1);
		const finalRendered = normalizeRenderedText(selector.render(220).join("\n"));
		expect(finalRendered).toContain("deepseek-v4-pro");
		expect(finalRendered).not.toContain("Refreshing OLLAMA CLOUD in background");
	});

	test("shows Superpowers role descriptions in menu labels", async () => {
		installTestTheme();
		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Expected bundled model anthropic/claude-sonnet-4-5");

		const settings = makeSettings({
			cycleOrder: ["superpowers:tdd-writer", "superpowers:runtime-simulator", "superpowers:acceptance"],
		});

		const selector = createSelector(model, settings);
		await Bun.sleep(0);
		installTestTheme();

		selector.handleInput("\n");
		installTestTheme();

		const menuRendered = normalizeRenderedText(selector.render(220).join("\n"));
		expect(menuRendered).toContain(
			"Set as superpowers:tdd-writer (TDD Writer，写失败测试和 red evidence，建议高级模型)",
		);
		expect(menuRendered).toContain(
			"Set as superpowers:runtime-simulator (Runtime Simulator，真实环境业务路径模拟，建议高质量模型)",
		);
		expect(menuRendered).toContain("Set as ACCEPT (Acceptance，最终验收/must-fix 判定，建议最高质量模型)");
	});

	test("keeps legacy menu labels unchanged when no description exists", async () => {
		installTestTheme();
		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Expected bundled model anthropic/claude-sonnet-4-5");

		const settings = makeSettings({
			modelTags: {
				"custom-no-description": { name: "Custom No Description" },
			},
		});

		const selector = createSelector(model, settings);
		await Bun.sleep(0);
		installTestTheme();

		selector.handleInput("\n");
		installTestTheme();

		const menuRendered = normalizeRenderedText(selector.render(220).join("\n"));
		expect(menuRendered).toContain("Set as Custom No Description");
		expect(menuRendered).not.toContain("Custom No Description：");
	});
	test("suppresses description for non-superpowers tagless custom roles", async () => {
		installTestTheme();
		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Expected bundled model anthropic/claude-sonnet-4-5");

		const settings = makeSettings({
			modelTags: {
				"custom-described": { name: "custom-described", description: "中文说明" },
			},
		});

		const selector = createSelector(model, settings);
		await Bun.sleep(0);
		installTestTheme();

		selector.handleInput("\n");
		installTestTheme();

		const menuRendered = normalizeRenderedText(selector.render(220).join("\n"));
		// non-superpowers roles must NOT render description
		expect(menuRendered).toContain("Set as custom-described");
		expect(menuRendered).not.toContain("中文说明");
	});
});

describe("bulk assign to roles action", () => {
	beforeAll(async () => {
		testTheme = await getThemeByName("dark");
		if (!testTheme) {
			throw new Error("Failed to load dark theme for bulk assign tests");
		}
	});

	/** Create a minimal UI mock sufficient for ModelSelectorComponent construction. */
	function mockUI(): TUI {
		return { requestRender: vi.fn() } as unknown as TUI;
	}

	/** Create a minimal model registry returning the given models. */
	function mockRegistry(models: Model[]): ModelRegistry {
		return {
			getAll: () => models,
			getDiscoverableProviders: () => [],
			getCanonicalModelSelections: () => [],
			refresh: vi.fn(async () => {}),
			getAvailable: () => models,
			getError: () => undefined,
			refreshProvider: vi.fn(),
			getProviderDiscoveryState: () => undefined,
		} as unknown as ModelRegistry;
	}

	test('"Assign to roles..." is the first menu action for a concrete model', async () => {
		installTestTheme();
		const model = createContextTestModel("gpt-4o", 128_000);
		const settings = Settings.isolated({});
		const onBulkRoleSelect = vi.fn();
		const onSelect = vi.fn();

		const selector = new ModelSelectorComponent(
			mockUI(),
			undefined,
			settings,
			mockRegistry([model]),
			[{ model }],
			onSelect,
			() => {},
			{ onBulkRoleSelect },
		);
		installTestTheme();

		selector.handleInput("\n"); // open menu

		const rendered = normalizeRenderedText(selector.render(220).join("\n"));

		// "Assign to roles..." must be present
		expect(rendered).toContain("Assign to roles...");

		// It must appear before any "Set as <role>" entries
		const assignIndex = rendered.indexOf("Assign to roles...");
		const setAsIndex = rendered.indexOf("Set as DEFAULT");
		expect(assignIndex).toBeGreaterThanOrEqual(0);
		expect(setAsIndex).toBeGreaterThan(assignIndex);
	});

	test("keyboard navigation through bulk flow invokes onBulkRoleSelect exactly once at preview confirmation", async () => {
		installTestTheme();
		const model = createContextTestModel("gpt-4o", 128_000);
		const settings = Settings.isolated({});
		const onBulkRoleSelect = vi.fn();
		const onSelect = vi.fn();

		const selector = new ModelSelectorComponent(
			mockUI(),
			undefined,
			settings,
			mockRegistry([model]),
			[{ model }],
			onSelect,
			() => {},
			{ onBulkRoleSelect },
		);
		await Bun.sleep(0);
		installTestTheme();

		// Open menu → "Assign to roles..." → bulk flow
		selector.handleInput("\n"); // open menu
		selector.handleInput("\n"); // select "Assign to roles..." → bulk thinking step

		// After selecting "Assign to roles...": the bulk thinking step must be shown
		const thinkingStep = normalizeRenderedText(selector.render(220).join("\n"));
		expect(thinkingStep).toMatch(/(?:thinking|inherit|auto|off|low|medium|high|xhigh)/i);

		selector.handleInput("\n"); // confirm thinking level → roles step

		// Roles step: must list available roles with "DEFAULT" as an option
		const rolesStep = normalizeRenderedText(selector.render(220).join("\n"));
		expect(rolesStep).toMatch(/(?:DEFAULT|default|role)/i);

		selector.handleInput(" "); // Space toggles DEFAULT role

		// After toggle: DEFAULT must appear as selected
		const afterToggle = normalizeRenderedText(selector.render(220).join("\n"));
		expect(afterToggle).toMatch(/(?:DEFAULT.*(?:selected|✓|✔|●)|●.*DEFAULT|selected.*DEFAULT)/i);

		selector.handleInput("\n"); // advance to preview

		// Preview step: shows DEFAULT in the change list
		const previewStep = normalizeRenderedText(selector.render(220).join("\n"));
		expect(previewStep).toContain("DEFAULT");
		expect(previewStep).toMatch(/(?:change|preview|update)/i);

		selector.handleInput("\n"); // confirm preview → callback fires once

		expect(onBulkRoleSelect).toHaveBeenCalledTimes(1);
		expect(onBulkRoleSelect).toHaveBeenCalledWith(expect.objectContaining({ selector: "test/gpt-4o" }));
	});

	test("non-concrete model shows 'Assign to roles...' disabled with explanatory block message", async () => {
		installTestTheme();
		// An OpenRouter model with upstream routing is non-concrete for bulk
		// assignment because assertConcreteSelector rejects
		// openrouter/:id@upstream selectors.
		const nonConcreteModel = buildModel({
			id: "z-ai/glm-4.7@cerebras",
			name: "GLM-4.7",
			api: "openrouter-chat",
			provider: "openrouter",
			baseUrl: "https://openrouter.ai",
			reasoning: true,
			input: ["text"],
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
			contextWindow: 1_000_000,
			maxTokens: 8192,
		});
		const settings = Settings.isolated({});
		const onBulkRoleSelect = vi.fn();
		const onSelect = vi.fn();

		const selector = new ModelSelectorComponent(
			mockUI(),
			undefined,
			settings,
			mockRegistry([nonConcreteModel]),
			[{ model: nonConcreteModel }],
			onSelect,
			() => {},
			{ onBulkRoleSelect },
		);
		await Bun.sleep(0);
		installTestTheme();

		selector.handleInput("\n"); // open menu

		const rendered = normalizeRenderedText(selector.render(220).join("\n"));

		// "Assign to roles..." must still be present (always shown)
		expect(rendered).toContain("Assign to roles...");

		// But it must appear with a disabled/block message explaining that
		// bulk assignment is not available for routed selectors
		expect(rendered).toMatch(/bulk.*(?:not.*(?:available|supported)|cannot|disabled|routed|upstream)/i);

		// Attempting to select it must NOT invoke the callback
		const onBulkRoleSelectBefore = onBulkRoleSelect.mock.calls.length;
		selector.handleInput("\n"); // Enter with "Assign to roles..." highlighted
		expect(onBulkRoleSelect).toHaveBeenCalledTimes(onBulkRoleSelectBefore);
	});

	test("selecting high thinking level persists ':high' suffix in callback selector", async () => {
		installTestTheme();
		const model = getBundledModel("openai", "gpt-5.5");
		if (!model) throw new Error("Expected bundled model openai/gpt-5.5");
		const settings = Settings.isolated({});
		const onBulkRoleSelect = vi.fn();
		const onSelect = vi.fn();

		const selector = new ModelSelectorComponent(
			mockUI(),
			undefined,
			settings,
			mockRegistry([model]),
			[{ model }],
			onSelect,
			() => {},
			{ onBulkRoleSelect },
		);
		installTestTheme();
		// Open menu → "Assign to roles..." → bulk thinking step
		selector.handleInput("\n"); // open menu
		expect(normalizeRenderedText(selector.render(220).join("\n"))).toContain("Assign to roles...");
		selector.handleInput("\n"); // select "Assign to roles..."

		// Thinking options: Inherit(0) → Off(1) → auto(2) → low(3) → medium(4) → high(5) → xhigh(6)
		// Navigate down 5 from index 0 to reach "high"
		for (let i = 0; i < 5; i++) selector.handleInput("\x1b[B");
		selector.handleInput("\n"); // confirm "high" thinking → roles step

		// Toggle role → advance to preview → confirm
		selector.handleInput(" "); // Space toggles DEFAULT
		selector.handleInput("\n"); // advance to preview
		selector.handleInput("\n"); // confirm preview → callback fires

		expect(onBulkRoleSelect).toHaveBeenCalledTimes(1);
		expect(onBulkRoleSelect).toHaveBeenCalledWith(
			expect.objectContaining({
				selector: expect.stringMatching(/^openai\/gpt-5\.5:high$/),
			}),
		);
	});

	test("selecting auto thinking level must NOT append ':auto' suffix in callback selector", async () => {
		installTestTheme();
		const model = getBundledModel("openai", "gpt-5.5");
		if (!model) throw new Error("Expected bundled model openai/gpt-5.5");
		const settings = Settings.isolated({});
		const onBulkRoleSelect = vi.fn();
		const onSelect = vi.fn();

		const selector = new ModelSelectorComponent(
			mockUI(),
			undefined,
			settings,
			mockRegistry([model]),
			[{ model }],
			onSelect,
			() => {},
			{ onBulkRoleSelect },
		);
		installTestTheme();

		// Open menu → "Assign to roles..." → bulk thinking step
		selector.handleInput("\n"); // open menu
		expect(normalizeRenderedText(selector.render(220).join("\n"))).toContain("Assign to roles...");
		selector.handleInput("\n"); // select "Assign to roles..."

		// Thinking options: Inherit(0) → Off(1) → auto(2)
		// Navigate down 2 from index 0 to reach "auto"
		for (let i = 0; i < 2; i++) selector.handleInput("\x1b[B");
		selector.handleInput("\n"); // confirm "auto" thinking → roles step

		// Toggle role → advance to preview → confirm
		selector.handleInput(" "); // Space toggles DEFAULT
		selector.handleInput("\n"); // advance to preview
		selector.handleInput("\n"); // confirm preview → callback fires

		expect(onBulkRoleSelect).toHaveBeenCalledTimes(1);
		expect(onBulkRoleSelect).toHaveBeenCalledWith(
			expect.objectContaining({
				// Bare selector — no ":auto" suffix
				selector: "openai/gpt-5.5",
			}),
		);
	});

	test("known custom role custom-fast (without custom: prefix) appears in roles step and is accepted in callback", async () => {
		installTestTheme();
		const model = getBundledModel("openai", "gpt-5.5");
		if (!model) throw new Error("Expected bundled model openai/gpt-5.5");
		const settings = Settings.isolated({
			modelRoles: {
				"custom-fast": `${model.provider}/${model.id}`,
			},
		});
		// Surface custom-fast as a known role via modelTags
		settings.set("modelTags", { "custom-fast": { name: "custom-fast" } });
		const onBulkRoleSelect = vi.fn();
		const onSelect = vi.fn();

		const selector = new ModelSelectorComponent(
			mockUI(),
			undefined,
			settings,
			mockRegistry([model]),
			[{ model }],
			onSelect,
			() => {},
			{ onBulkRoleSelect },
		);
		installTestTheme();

		// Open menu → "Assign to roles..."
		selector.handleInput("\n"); // open menu
		expect(normalizeRenderedText(selector.render(220).join("\n"))).toContain("Assign to roles...");
		selector.handleInput("\n"); // select "Assign to roles..."

		// Confirm thinking → roles step
		selector.handleInput("\n");

		// Roles step must list custom-fast
		const rolesUI = normalizeRenderedText(selector.render(220).join("\n"));
		expect(rolesUI).toMatch(/(?:custom-fast|custom_fast)/i);

		// Navigate to custom-fast in the role list using its known index
		const customIndex = getKnownRoleIds(settings).indexOf("custom-fast");
		expect(customIndex).toBeGreaterThanOrEqual(0);
		for (let i = 0; i < customIndex; i++) selector.handleInput("\x1b[B");
		selector.handleInput(" "); // Space toggles custom-fast

		// Advance to preview → must show custom-fast
		selector.handleInput("\n"); // advance to preview
		const previewUI = normalizeRenderedText(selector.render(220).join("\n"));
		expect(previewUI).toMatch(/(?:custom-fast|custom_fast)/i);

		// Confirm → callback fires with exactly roleIds: ["custom-fast"]
		selector.handleInput("\n");

		expect(onBulkRoleSelect).toHaveBeenCalledTimes(1);
		expect(onBulkRoleSelect).toHaveBeenCalledWith(
			expect.objectContaining({
				roleIds: ["custom-fast"],
			}),
		);
	});

	describe("controller callback injection via showModelSelector", () => {
		let settingsState: SettingsTestState | undefined;

		beforeEach(async () => {
			settingsState = beginSettingsTest();
			await Settings.init({ inMemory: true });
			setKeybindings(KeybindingsManager.inMemory({ "tui.select.down": "ctrl+n" }));
			installTestTheme();
		});

		afterEach(() => {
			vi.restoreAllMocks();
			setKeybindings(KeybindingsManager.inMemory());
			restoreSettingsTestState(settingsState);
			settingsState = undefined;
		});

		/** Shared minimal session mock for the controller test doubles. */
		function makeSession(model: Model, modelRegistry: ModelRegistry): Record<string, unknown> {
			return {
				model,
				getContextUsage: () => ({ tokens: 0 }),
				modelRegistry,
				scopedModels: [{ model }],
				setModel: vi.fn(),
				setModelTemporary: vi.fn(),
				setThinkingLevel: vi.fn(),
				switchAdvisorModel: vi.fn(),
				getAvailableThinkingLevels: () => [],
				getAvailableModels: () => [model],
			};
		}

		/** Controller context mock. */
		function makeCtx(model: Model, settings: Settings, overrides: Record<string, unknown>): Record<string, unknown> {
			const editorContainer = {
				children: [] as Component[],
				clear() {
					(this.children as Component[]).length = 0;
				},
				addChild(child: Component) {
					(this.children as Component[]).push(child);
				},
			};
			const modelRegistry = {
				getAll: () => [model],
				getCanonicalModelSelections: () => [],
				getDiscoverableProviders: () => [],
				refresh: vi.fn(async () => {}),
				getAvailable: () => [model],
				getError: () => undefined,
				refreshProvider: vi.fn(),
				getProviderDiscoveryState: () => undefined,
			} as unknown as ModelRegistry;
			return {
				editor: {} as Component,
				editorContainer,
				keybindings: KeybindingsManager.inMemory(),
				session: makeSession(model, modelRegistry),
				settings,
				showError: vi.fn(),
				showStatus: vi.fn(),
				refreshAdvisorModelUi: vi.fn(),
				refreshMainModelUi: vi.fn(),
				ui: {
					requestRender: vi.fn(),
					setFocus: vi.fn(),
					terminal: { columns: 120, rows: 40 },
				},
				statusLine: { invalidate: vi.fn(), updateSettings: vi.fn() },
				updateEditorBorderColor: vi.fn(),
				...overrides,
			};
		}

		/** Extract the editorContainer from the context mock. */
		function extractSelector(ctx: Record<string, unknown>): ModelSelectorComponent {
			const container = (ctx as Record<string, unknown>).editorContainer as { children: Component[] };
			const sel = container.children[0];
			if (!(sel instanceof ModelSelectorComponent)) throw new Error("Expected ModelSelectorComponent");
			return sel;
		}

		test("resolved persistence — role badge appears after controller saves via real setModelRolesAtomic", async () => {
			const model = createContextTestModel("gpt-4o", 128_000);
			const settings = Settings.isolated({}); // no role assignments yet

			// Gate + call-through: the spy lets the test control timing while still
			// executing the real persistence so settings are actually updated.
			const gate = Promise.withResolvers<ModelRoleBatchUpdateResult>();
			const persistenceDone = Promise.withResolvers<void>();
			const realAtomic = settings.setModelRolesAtomic.bind(settings);
			vi.spyOn(settings, "setModelRolesAtomic").mockImplementation(async assignments => {
				await gate.promise;
				const result = await realAtomic(assignments);
				persistenceDone.resolve();
				return result;
			});

			const showError = vi.fn();
			const ctx = makeCtx(model, settings, { showError });
			const controller = new SelectorController(ctx as unknown as InteractiveModeContext);
			controller.showModelSelector();
			installTestTheme();

			const selector = extractSelector(ctx);

			// Before bulk assignment: no DEFAULT badge
			const before = normalizeRenderedText(selector.render(220).join("\n"));
			expect(before).not.toContain("DEFAULT");

			// Open menu → "Assign to roles..." → bulk flow
			selector.handleInput("\n"); // open menu
			expect(normalizeRenderedText(selector.render(220).join("\n"))).toContain("Assign to roles...");
			selector.handleInput("\n"); // select "Assign to roles..." → bulk thinking step
			expect(normalizeRenderedText(selector.render(220).join("\n"))).toMatch(
				/(?:thinking|inherit|auto|off|low|medium|high|xhigh)/i,
			);
			selector.handleInput("\n"); // confirm thinking level → roles step
			expect(normalizeRenderedText(selector.render(220).join("\n"))).toMatch(/(?:DEFAULT|default|role)/i);
			selector.handleInput(" "); // Space toggles DEFAULT role
			expect(normalizeRenderedText(selector.render(220).join("\n"))).toMatch(
				/(?:DEFAULT.*(?:selected|✓|✔|●)|●.*DEFAULT|selected.*DEFAULT)/i,
			);
			selector.handleInput("\n"); // advance to preview
			expect(normalizeRenderedText(selector.render(220).join("\n"))).toMatch(/(?:change|preview|update)/i);
			selector.handleInput("\n"); // confirm preview → callback fires, suspended on gate

			// Gate is still pending — controller hasn't surfaced anything
			expect(showError).not.toHaveBeenCalled();

			// Resolve the gate — realAtomic runs and updates settings
			gate.resolve({
				changedRoleIds: ["default"],
				unchangedRoleIds: [],
				previous: {},
				next: { default: "test/gpt-4o" },
				persisted: true,
			});
			// Wait for realAtomic to complete (precise signal from the spy)
			await persistenceDone.promise;
			// One yield for the callback's post-await continuation
			await Promise.resolve();
			// One more for component state/render
			await Promise.resolve();

			// After success: the component reads the updated settings and renders the badge
			const after = normalizeRenderedText(selector.render(220).join("\n"));
			expect(after).toContain("DEFAULT");
			expect(showError).not.toHaveBeenCalled();
		});

		test("rejected persistence — selector shows error, no new badge, no controller showError", async () => {
			const model = createContextTestModel("gpt-4o", 128_000);
			const settings = Settings.isolated({}); // no role assignments

			const rejectBulk = Promise.withResolvers<ModelRoleBatchUpdateResult>();
			vi.spyOn(settings, "setModelRolesAtomic").mockReturnValue(rejectBulk.promise);

			const showError = vi.fn();
			const ctx = makeCtx(model, settings, { showError });
			const controller = new SelectorController(ctx as unknown as InteractiveModeContext);
			controller.showModelSelector();
			installTestTheme();

			const selector = extractSelector(ctx);

			// Before: no DEFAULT badge
			expect(normalizeRenderedText(selector.render(220).join("\n"))).not.toContain("DEFAULT");

			// Open menu → "Assign to roles..." → bulk flow → confirm
			selector.handleInput("\n"); // open menu
			expect(normalizeRenderedText(selector.render(220).join("\n"))).toContain("Assign to roles...");
			selector.handleInput("\n"); // select "Assign to roles..." → bulk thinking step
			selector.handleInput("\n"); // confirm thinking level → roles step
			selector.handleInput(" "); // Space toggles DEFAULT role
			selector.handleInput("\n"); // advance to preview
			selector.handleInput("\n"); // confirm preview → callback fires, suspended on gate

			// Reject the persistence
			rejectBulk.reject(new Error("Persistence error: file write failed"));
			await 0;
			await 0;
			await 0;

			// Controller must NOT surface showError — the bulk reducer handles it
			expect(showError).not.toHaveBeenCalled();

			// The rendered output must surface the error from the reducer's error step
			const rendered = normalizeRenderedText(selector.render(220).join("\n"));
			expect(rendered).toMatch(/(?:error|fail|could not|persistence)/i);

			// No new role badge appears (settings never updated)
			expect(rendered).not.toContain("DEFAULT");
		});
	});

	/** Extract the editorContainer from the context object. */
	function editorContainerFrom(ctx: Record<string, unknown>): { children: Component[] } {
		return (ctx as Record<string, unknown>).editorContainer as { children: Component[] };
	}
});
