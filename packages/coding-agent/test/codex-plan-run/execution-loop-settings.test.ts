import { describe, expect, it } from "bun:test";
import { resolveExecutionLoopSettings } from "../../src/codex-plan-run/execution-loop-settings";

type SettingsMap = Record<string, unknown>;

function makeSettings(values: SettingsMap) {
	return {
		get(key: string): unknown {
			return values[key];
		},
	};
}

const defaults: SettingsMap = {
	"superpowers.executionLoop.mode": "role-bound",
	"superpowers.executionLoop.roleBoundExecution.enabled": true,
	"superpowers.executionLoop.roleBoundExecution.requireAdvisorGate": true,
	"superpowers.executionLoop.globalImpactGate.enabled": true,
	"superpowers.executionLoop.globalImpactGate.mode": "required",
	"superpowers.executionLoop.realBusinessSimulationGate.enabled": true,
	"superpowers.executionLoop.realBusinessSimulationGate.mode": "required",
	"superpowers.executionLoop.realBusinessSimulationGate.allowedEnvironments": ["local", "docker", "sandbox"],
	"superpowers.executionLoop.realBusinessSimulationGate.requireCleanupReport": true,
};

describe("resolveExecutionLoopSettings", () => {
	it("disables every productized gate when execution loop mode is off", () => {
		const resolved = resolveExecutionLoopSettings({
			settings: makeSettings({
				...defaults,
				"superpowers.executionLoop.mode": "off",
			}),
		});

		expect(resolved.driverDefaults).toEqual({
			enableRoleBoundExecution: false,
			enableAdvisorGate: false,
			enableGlobalImpactGate: false,
			enableRealBusinessSimulationGate: false,
			superpowersGateMode: "off",
		});
		expect(resolved.blockers).toEqual([]);
	});

	it("enables role-bound, advisor, global impact, and runtime gates in role-bound mode", () => {
		const resolved = resolveExecutionLoopSettings({
			settings: makeSettings(defaults),
		});

		expect(resolved.driverDefaults).toMatchObject({
			enableRoleBoundExecution: true,
			enableAdvisorGate: true,
			enableGlobalImpactGate: true,
			enableRealBusinessSimulationGate: true,
			superpowersGateMode: "required",
		});
	});

	it("lets hybrid mode keep runtime simulation controlled by its own setting", () => {
		const resolved = resolveExecutionLoopSettings({
			settings: makeSettings({
				...defaults,
				"superpowers.executionLoop.mode": "hybrid",
				"superpowers.executionLoop.realBusinessSimulationGate.enabled": false,
			}),
		});

		expect(resolved.driverDefaults.enableRoleBoundExecution).toBe(true);
		expect(resolved.driverDefaults.enableAdvisorGate).toBe(true);
		expect(resolved.driverDefaults.enableGlobalImpactGate).toBe(true);
		expect(resolved.driverDefaults.enableRealBusinessSimulationGate).toBe(false);
	});

	it("uses explicit overrides after settings defaults", () => {
		const resolved = resolveExecutionLoopSettings({
			settings: makeSettings({
				...defaults,
				"superpowers.executionLoop.mode": "off",
			}),
			overrides: {
				enableRoleBoundExecution: true,
				enableGlobalImpactGate: true,
			},
		});

		expect(resolved.driverDefaults.enableRoleBoundExecution).toBe(true);
		expect(resolved.driverDefaults.enableGlobalImpactGate).toBe(true);
		expect(resolved.driverDefaults.enableAdvisorGate).toBe(false);
	});

	it("blocks invalid runtime environment settings with an actionable message", () => {
		const resolved = resolveExecutionLoopSettings({
			settings: makeSettings({
				...defaults,
				"superpowers.executionLoop.realBusinessSimulationGate.allowedEnvironments": [],
			}),
		});

		expect(resolved.blockers).toEqual([
			{
				reason: "invalid_runtime_allowed_environments",
				message:
					"realBusinessSimulationGate.allowedEnvironments must include local, docker, or sandbox when runtime simulation is enabled.",
			},
		]);
	});

	it('parses string "false" as boolean false', () => {
		const resolved = resolveExecutionLoopSettings({
			settings: makeSettings({
				...defaults,
				"superpowers.executionLoop.roleBoundExecution.enabled": "false",
			}),
		});

		expect(resolved.driverDefaults.enableRoleBoundExecution).toBe(false);
	});

	it('parses string "0" as boolean false', () => {
		const resolved = resolveExecutionLoopSettings({
			settings: makeSettings({
				...defaults,
				"superpowers.executionLoop.realBusinessSimulationGate.enabled": "0",
			}),
		});

		expect(resolved.driverDefaults.enableRealBusinessSimulationGate).toBe(false);
	});

	it('parses string "true" as boolean true', () => {
		const resolved = resolveExecutionLoopSettings({
			settings: makeSettings({
				...defaults,
				"superpowers.executionLoop.roleBoundExecution.enabled": "true",
			}),
		});

		expect(resolved.driverDefaults.enableRoleBoundExecution).toBe(true);
	});

	it('parses string "1" as boolean true', () => {
		const resolved = resolveExecutionLoopSettings({
			settings: makeSettings({
				...defaults,
				"superpowers.executionLoop.realBusinessSimulationGate.enabled": "1",
			}),
		});

		expect(resolved.driverDefaults.enableRealBusinessSimulationGate).toBe(true);
	});

	it("falls back to default for unrecognized string values", () => {
		const resolved = resolveExecutionLoopSettings({
			settings: makeSettings({
				...defaults,
				"superpowers.executionLoop.roleBoundExecution.enabled": "yes",
			}),
		});

		// The default for roleBoundExecution.enabled is true.
		expect(resolved.driverDefaults.enableRoleBoundExecution).toBe(true);
	});

	it("falls back to default for empty string", () => {
		const resolved = resolveExecutionLoopSettings({
			settings: makeSettings({
				...defaults,
				"superpowers.executionLoop.globalImpactGate.enabled": "",
			}),
		});

		// The default for globalImpactGate.enabled is true.
		expect(resolved.driverDefaults.enableGlobalImpactGate).toBe(true);
	});

	it("returns runtimeScenario defaults from schema", () => {
		const resolved = resolveExecutionLoopSettings({
			settings: makeSettings(defaults),
		}) as unknown as {
			runtimeScenario: { browser: { enabled: boolean }; api: { enabled: boolean }; database: { enabled: boolean } };
		};

		expect(resolved.runtimeScenario).toBeDefined();
		expect(resolved.runtimeScenario.browser.enabled).toBe(false);
		expect(resolved.runtimeScenario.api.enabled).toBe(false);
		expect(resolved.runtimeScenario.database.enabled).toBe(false);
	});

	it("returns classification defaults from schema", () => {
		const resolved = resolveExecutionLoopSettings({
			settings: makeSettings(defaults),
		}) as unknown as { classification: { enabled: boolean; requireReviewerEvidence: boolean } };

		expect(resolved.classification).toBeDefined();
		expect(resolved.classification.enabled).toBe(true);
		expect(resolved.classification.requireReviewerEvidence).toBe(true);
	});

	it("applies explicit overrides to runtimeScenario", () => {
		const resolved = resolveExecutionLoopSettings({
			settings: makeSettings({
				...defaults,
				"superpowers.executionLoop.runtimeScenario.browser.enabled": true,
			}),
		}) as unknown as { runtimeScenario: { browser: { enabled: boolean } } };

		expect(resolved.runtimeScenario.browser.enabled).toBe(true);
	});

	it("applies explicit overrides to classification", () => {
		const resolved = resolveExecutionLoopSettings({
			settings: makeSettings({
				...defaults,
				"superpowers.executionLoop.classification.enabled": false,
			}),
		}) as unknown as { classification: { enabled: boolean } };

		expect(resolved.classification.enabled).toBe(false);
	});
});
