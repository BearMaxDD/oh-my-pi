import { describe, expect, it } from "bun:test";
import { getDefault, SETTINGS_SCHEMA, type SettingPath } from "../../src/config/settings-schema";

describe("superpowers execution loop settings", () => {
	const requiredKeys = [
		"superpowers.executionLoop.roleBoundExecution.enabled",
		"superpowers.executionLoop.roleBoundExecution.requirePromptPacks",
		"superpowers.executionLoop.roleBoundExecution.requireAdvisorGate",
		"superpowers.executionLoop.roleBoundExecution.requireModelRoutingEvidence",
		"superpowers.executionLoop.todo.language",
		"superpowers.executionLoop.todo.showRole",
		"superpowers.executionLoop.todo.showModel",
		"superpowers.executionLoop.todo.deriveFromEvidence",
		"superpowers.executionLoop.globalImpactGate.enabled",
		"superpowers.executionLoop.globalImpactGate.mode",
		"superpowers.executionLoop.realBusinessSimulationGate.enabled",
		"superpowers.executionLoop.realBusinessSimulationGate.mode",
		"superpowers.executionLoop.realBusinessSimulationGate.allowedEnvironments",
		"superpowers.executionLoop.realBusinessSimulationGate.requireCleanupReport",
	] as const satisfies readonly SettingPath[];

	it("defines all role-bound execution loop settings", () => {
		for (const key of requiredKeys) expect(key in SETTINGS_SCHEMA).toBe(true);
	});

	it("defines role-bound execution loop defaults", () => {
		expect(getDefault("superpowers.executionLoop.roleBoundExecution.enabled")).toBe(true);
		expect(getDefault("superpowers.executionLoop.roleBoundExecution.requirePromptPacks")).toBe(true);
		expect(getDefault("superpowers.executionLoop.roleBoundExecution.requireAdvisorGate")).toBe(true);
		expect(getDefault("superpowers.executionLoop.roleBoundExecution.requireModelRoutingEvidence")).toBe(true);
		expect(getDefault("superpowers.executionLoop.todo.language")).toBe("zh");
		expect(getDefault("superpowers.executionLoop.todo.showRole")).toBe(true);
		expect(getDefault("superpowers.executionLoop.todo.showModel")).toBe(true);
		expect(getDefault("superpowers.executionLoop.todo.deriveFromEvidence")).toBe(true);
		expect(getDefault("superpowers.executionLoop.globalImpactGate.enabled")).toBe(true);
		expect(getDefault("superpowers.executionLoop.globalImpactGate.mode")).toBe("required");
		expect(getDefault("superpowers.executionLoop.realBusinessSimulationGate.enabled")).toBe(true);
		expect(getDefault("superpowers.executionLoop.realBusinessSimulationGate.mode")).toBe("required");
		expect(getDefault("superpowers.executionLoop.realBusinessSimulationGate.allowedEnvironments")).toEqual([
			"local",
			"docker",
			"sandbox",
		]);
		expect(getDefault("superpowers.executionLoop.realBusinessSimulationGate.requireCleanupReport")).toBe(true);
	});

	it("uses schema shapes compatible with existing settings definitions", () => {
		expect(SETTINGS_SCHEMA["superpowers.executionLoop.todo.language"].type).toBe("enum");
		expect(SETTINGS_SCHEMA["superpowers.executionLoop.globalImpactGate.mode"].type).toBe("enum");
		expect(SETTINGS_SCHEMA["superpowers.executionLoop.realBusinessSimulationGate.allowedEnvironments"].type).toBe(
			"array",
		);
	});

	it("defines runtimeScenario defaults", () => {
		const s = SETTINGS_SCHEMA as Record<string, { default: unknown }>;
		expect(s["superpowers.executionLoop.runtimeScenario.browser.enabled"].default).toBe(false);
		expect(s["superpowers.executionLoop.runtimeScenario.api.enabled"].default).toBe(false);
		expect(s["superpowers.executionLoop.runtimeScenario.database.enabled"].default).toBe(false);
	});

	it("defines classification defaults", () => {
		const s = SETTINGS_SCHEMA as Record<string, { default: unknown }>;
		expect(s["superpowers.executionLoop.classification.enabled"].default).toBe(true);
		expect(s["superpowers.executionLoop.classification.requireReviewerEvidence"].default).toBe(true);
	});
});
