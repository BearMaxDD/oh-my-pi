/**
 * Model routing resolution — resolveTaskModelRouting.
 *
 * Contract:
 * 1. Explicit modelRole prefers settings.modelRoles[modelRole] over
 *    task.agentModelOverrides and includes fallback task/default role models.
 * 2. role infers modelRole when role is a known model role key.
 * 3. Unconfigured superpowers:test-runner falls back through task/default.
 * 4. Registry superpowers roles use their declared fallbackRoleIds.
 * 5. No modelRole preserves legacy resolveAgentModelPatterns behavior.
 */
import { describe, expect, it } from "bun:test";
import { resolveAgentModelPatterns } from "../../src/config/model-resolver";
import { resolveTaskModelRouting } from "../../src/task/model-routing";

function makeSettings(
	overrides: { modelRoles?: Record<string, string>; modelTags?: Record<string, any>; cycleOrder?: string[] } = {},
) {
	return {
		get: (key: string) => {
			if (key === "cycleOrder") return overrides.cycleOrder ?? [];
			if (key === "modelTags") return overrides.modelTags ?? {};
			if (key === "modelProviderOrder") return [];
			return undefined;
		},
		getModelRoles: () => overrides.modelRoles ?? {},
		getModelRole: (role: string) => overrides.modelRoles?.[role],
		getStorage: () => undefined,
	} as any;
}

describe("resolveTaskModelRouting", () => {
	it("explicit modelRole prefers settings.modelRoles[modelRole] over task.agentModelOverrides and includes fallback task/default role models", () => {
		const settings = makeSettings({ modelRoles: { smol: "claude-sonnet-4-20250514" } });

		const result = resolveTaskModelRouting({
			modelRole: "smol",
			agentModelOverrides: { myAgent: "gpt-4o" },
			agentName: "myAgent",
			settings,
		});

		expect(result.modelRole).toBe("smol");
		// settings.modelRoles takes priority over agentModelOverrides
		expect(result.requestedModel).toBe("claude-sonnet-4-20250514");
		expect(result.fallbackModelRoles).toEqual(["task", "default"]);
		// Exact ordering: configured model first, then fallback roles, no duplicates
		expect(result.modelOverrides).toEqual(["claude-sonnet-4-20250514", "task", "default"]);
	});

	it("explicit modelRole falls through to agentModelOverrides when settings.modelRoles unset", () => {
		const settings = makeSettings();

		const result = resolveTaskModelRouting({
			modelRole: "smol",
			agentModelOverrides: { myAgent: "gpt-4o" },
			agentName: "myAgent",
			settings,
		});

		expect(result.modelRole).toBe("smol");
		// When settings.modelRoles is unset, agentModelOverrides[agentName] is used
		expect(result.requestedModel).toBe("gpt-4o");
		expect(result.modelOverrides).toEqual(["gpt-4o", "task", "default"]);
	});

	it("role infers modelRole when role is a known model role key", () => {
		const settings = makeSettings();

		const result = resolveTaskModelRouting({
			role: "smol",
			settings,
		});

		expect(result.modelRole).toBe("smol");
		expect(result.requestedModel).toBeUndefined();
	});

	it("falls back through configured modelRoles for fallback roles", () => {
		const settings = makeSettings({ modelRoles: { task: "claude-haiku-3-20240307", default: "gpt-4o" } });

		const result = resolveTaskModelRouting({
			modelRole: "superpowers:test-runner",
			settings,
		});

		expect(result.modelRole).toBe("superpowers:test-runner");
		expect(result.fallbackModelRoles).toEqual(["task", "default"]);
		// task and default have configured models → those models appear in modelOverrides
		expect(result.modelOverrides).toContain("claude-haiku-3-20240307");
		expect(result.modelOverrides).toContain("gpt-4o");
		// All patterns are unique
		expect(new Set(result.modelOverrides).size).toBe(result.modelOverrides.length);
	});

	it("role does not infer modelRole when role is unknown", () => {
		const settings = makeSettings();

		const result = resolveTaskModelRouting({
			role: "not-a-role",
			settings,
			activeModelPattern: "claude-sonnet-4-20250514",
		});

		// Unknown role falls through to legacy path
		expect(result.modelRole).toBeUndefined();
		expect(result.modelOverrides).toEqual(["claude-sonnet-4-20250514"]);
	});

	it("unconfigured superpowers:test-runner falls back through task/default", () => {
		const settings = makeSettings();

		const result = resolveTaskModelRouting({
			modelRole: "superpowers:test-runner",
			settings,
		});

		expect(result.fallbackModelRoles).toEqual(["task", "default"]);
		expect(result.modelRole).toBe("superpowers:test-runner");
		expect(result.requestedModel).toBeUndefined();
		// modelOverrides = only task + default (no smol in fallback)
		expect(result.modelOverrides).toEqual(["task", "default"]);
		expect(new Set(result.modelOverrides).size).toBe(result.modelOverrides.length);
	});

	it("new superpowers role respects registry fallbackRoleIds when not in SUPERPOWERS_ROLE_FALLBACKS", () => {
		const settings = makeSettings({
			modelRoles: { advisor: "advisor-model", slow: "slow-model", default: "default-model", task: "task-model" },
		});

		const result = resolveTaskModelRouting({
			modelRole: "superpowers:security-reviewer",
			settings,
		});

		expect(result.fallbackModelRoles).toEqual(["advisor", "slow", "default"]);
		expect(result.modelOverrides).toEqual(["advisor-model", "slow-model", "default-model"]);
		expect(result.modelOverrides).not.toContain("task-model");
	});
	it("no modelRole preserves legacy resolveAgentModelPatterns behavior with agent override", () => {
		const settings = makeSettings({
			modelRoles: { default: "gpt-4o" },
		});

		// Expected legacy result
		const legacyExpected = resolveAgentModelPatterns({
			settingsOverride: "claude-haiku-3-20240307",
			agentModel: undefined,
			settings,
			activeModelPattern: "claude-sonnet-4-20250514",
		});

		const result = resolveTaskModelRouting({
			settings,
			activeModelPattern: "claude-sonnet-4-20250514",
			agentModelOverrides: { someAgent: "claude-haiku-3-20240307" },
			agentName: "someAgent",
		});

		expect(result.modelRole).toBeUndefined();
		expect(result.requestedModel).toBeUndefined();
		expect(result.fallbackModelRoles).toEqual([]);
		expect(result.modelOverrides).toEqual(legacyExpected);
	});

	it("no modelRole preserves legacy resolveAgentModelPatterns behavior without overrides", () => {
		const settings = makeSettings({
			modelRoles: { default: "claude-sonnet-4-20250514" },
		});

		// Expected legacy result
		const legacyExpected = resolveAgentModelPatterns({
			settingsOverride: undefined,
			agentModel: undefined,
			settings,
			activeModelPattern: "claude-sonnet-4-20250514",
		});

		const result = resolveTaskModelRouting({
			settings,
			activeModelPattern: "claude-sonnet-4-20250514",
		});

		expect(result.modelRole).toBeUndefined();
		expect(result.modelOverrides).toEqual(legacyExpected);
	});
});
