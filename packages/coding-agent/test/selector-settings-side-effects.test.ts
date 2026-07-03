import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "bun:test";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { KeybindingsManager } from "@oh-my-pi/pi-coding-agent/config/keybindings";
import type { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { ModelSelectorComponent } from "@oh-my-pi/pi-coding-agent/modes/components/model-selector";
import { SelectorController } from "@oh-my-pi/pi-coding-agent/modes/controllers/selector-controller";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import { type Component, setKeybindings } from "@oh-my-pi/pi-tui";
import { beginSettingsTest, restoreSettingsTestState, type SettingsTestState } from "./helpers/settings-test-state";

let settingsState: SettingsTestState | undefined;
const CTRL_N = "\x0e";

beforeAll(() => {
	initTheme();
});

beforeEach(async () => {
	settingsState = beginSettingsTest();
	await Settings.init({ inMemory: true });
});

afterEach(() => {
	setKeybindings(KeybindingsManager.inMemory());
	vi.restoreAllMocks();
	restoreSettingsTestState(settingsState);
	settingsState = undefined;
});

describe("selector setting side effects", () => {
	it("refreshes the status line when git integration changes at runtime", () => {
		const updateSettings = vi.fn();
		const updateEditorTopBorder = vi.fn();
		const requestRender = vi.fn();
		const controller = new SelectorController({
			statusLine: { updateSettings },
			updateEditorTopBorder,
			ui: { requestRender },
		} as unknown as ConstructorParameters<typeof SelectorController>[0]);

		Settings.instance.override("git.enabled", false);
		controller.handleSettingChange("git.enabled", false);

		expect(updateSettings).toHaveBeenCalledWith(
			expect.objectContaining({
				preset: Settings.instance.get("statusLine.preset"),
				leftSegments: Settings.instance.get("statusLine.leftSegments"),
				rightSegments: Settings.instance.get("statusLine.rightSegments"),
			}),
		);
		expect(updateEditorTopBorder).toHaveBeenCalledTimes(1);
		expect(requestRender).toHaveBeenCalledTimes(1);
	});

	it("invalidates UI and updates editor top border when tui.tight changes", () => {
		const invalidate = vi.fn();
		const updateEditorTopBorder = vi.fn();
		const requestRender = vi.fn();
		const controller = new SelectorController({
			ui: { invalidate, requestRender },
			updateEditorTopBorder,
		} as unknown as ConstructorParameters<typeof SelectorController>[0]);

		controller.handleSettingChange("tui.tight", true);

		expect(invalidate).toHaveBeenCalledTimes(1);
		expect(updateEditorTopBorder).toHaveBeenCalledTimes(1);
		expect(requestRender).toHaveBeenCalledTimes(1);
	});

	it("refreshes advisor model UI, not main model UI, after selecting the advisor role", async () => {
		setKeybindings(
			KeybindingsManager.inMemory({
				"tui.select.down": "ctrl+n",
			}),
		);
		const model = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!model) throw new Error("Expected bundled anthropic/claude-sonnet-4-5 model");

		const calls: string[] = [];
		const switchAdvisorModel = vi.fn(() => {
			calls.push("switchAdvisorModel");
			return true;
		});
		const refreshAdvisorModelUi = vi.fn(() => {
			calls.push("refreshAdvisorModelUi");
		});
		const refreshMainModelUi = vi.fn(() => {
			calls.push("refreshMainModelUi");
		});
		const editorContainer = {
			children: [] as Component[],
			clear() {
				this.children = [];
			},
			addChild(child: Component) {
				this.children.push(child);
			},
		};
		const modelRegistry = {
			getAll: () => [model],
			getCanonicalModelSelections: () => [],
			getDiscoverableProviders: () => [],
			refresh: vi.fn(async () => undefined),
		} as unknown as ModelRegistry;
		const requestRender = vi.fn();
		const controller = new SelectorController({
			editor: {} as Component,
			editorContainer,
			keybindings: KeybindingsManager.inMemory(),
			session: {
				model,
				getContextUsage: () => ({ tokens: 0 }),
				modelRegistry,
				scopedModels: [{ model, thinkingLevel: "off" }],
				switchAdvisorModel,
			},
			settings: Settings.instance,
			showError: vi.fn(),
			showStatus: vi.fn(),
			refreshAdvisorModelUi,
			refreshMainModelUi,
			ui: {
				requestRender,
				setFocus: vi.fn(),
				terminal: { columns: 120, rows: 40 },
			},
		} as unknown as ConstructorParameters<typeof SelectorController>[0]);

		controller.showModelSelector();
		const selector = editorContainer.children[0];
		if (!(selector instanceof ModelSelectorComponent)) throw new Error("Expected model selector component");

		selector.handleInput("\n");
		for (let i = 0; i < 9; i++) selector.handleInput(CTRL_N);
		selector.handleInput("\n");
		selector.handleInput("\n");
		await Bun.sleep(0);

		expect(switchAdvisorModel).toHaveBeenCalledWith("anthropic/claude-sonnet-4-5", {
			scope: "current-run",
			reasonCode: "quality_risk",
			evidence: ["Selected from model role picker"],
		});
		expect(calls).toEqual(["switchAdvisorModel", "refreshAdvisorModelUi"]);
		expect(refreshAdvisorModelUi).toHaveBeenCalledTimes(1);
		expect(refreshMainModelUi).not.toHaveBeenCalled();
	});
});
