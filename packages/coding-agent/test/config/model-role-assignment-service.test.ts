/**
 * Model role bulk assignment service — assignModelToRoles.
 *
 * Contract:
 * 1. Rejects non-concrete selectors (alias, bare id, glob); never calls atomic.
 * 2. Dedupes and sorts roleIds; calls setModelRolesAtomic once with sorted
 *    unique roles each mapped to the concrete selector.
 * 3. Rejects unknown roles, including unregistered custom: names; never calls atomic.
 * 4. Accepts all roles surfaced by getKnownRoleIds(settings), including custom names.
 */

import { describe, expect, it, vi } from "bun:test";
import { type AssignmentDependencies, assignModelToRoles } from "../../src/config/model-role-assignment-service";
import { type ModelRoleBatchUpdateResult, Settings } from "../../src/config/settings";

/** Settings fixture with a tracked atomic-assignment stub. */
function mockDeps(
	atomicImpl?: (assignments: Record<string, string>) => Promise<ModelRoleBatchUpdateResult>,
): AssignmentDependencies {
	const settings = Settings.isolated({});
	const atomicMock = vi.fn(
		atomicImpl ??
			(async (assignments: Record<string, string>) => ({
				changedRoleIds: Object.keys(assignments),
				unchangedRoleIds: [] as string[],
				previous: {} as Record<string, string | undefined>,
				next: { ...assignments },
				persisted: true,
			})),
	);
	vi.spyOn(settings, "setModelRolesAtomic").mockImplementation(atomicMock);
	return { settings };
}

describe("assignModelToRoles", () => {
	it("rejects non-concrete selector (alias)", async () => {
		const deps = mockDeps();
		await expect(assignModelToRoles({ selector: "pi/smol", roleIds: ["default"] }, deps)).rejects.toThrow();
		expect(deps.settings.setModelRolesAtomic).not.toHaveBeenCalled();
	});

	it("rejects non-concrete selector (bare canonical id)", async () => {
		const deps = mockDeps();
		await expect(assignModelToRoles({ selector: "claude-sonnet-4-5", roleIds: ["default"] }, deps)).rejects.toThrow();
		expect(deps.settings.setModelRolesAtomic).not.toHaveBeenCalled();
	});

	it("rejects non-concrete selector (glob pattern)", async () => {
		const deps = mockDeps();
		await expect(
			assignModelToRoles({ selector: "anthropic/claude-*", roleIds: ["default"] }, deps),
		).rejects.toThrow();
		expect(deps.settings.setModelRolesAtomic).not.toHaveBeenCalled();
	});

	it("dedupes and sorts roleIds then calls atomic API once", async () => {
		const deps = mockDeps();
		await assignModelToRoles(
			{
				selector: "openai/gpt-5.2-codex:high",
				roleIds: ["superpowers:test-runner", "superpowers:implementer", "superpowers:implementer", "default"],
			},
			deps,
		);

		expect(deps.settings.setModelRolesAtomic).toHaveBeenCalledTimes(1);
		expect(deps.settings.setModelRolesAtomic).toHaveBeenCalledWith({
			default: "openai/gpt-5.2-codex:high",
			"superpowers:implementer": "openai/gpt-5.2-codex:high",
			"superpowers:test-runner": "openai/gpt-5.2-codex:high",
		});
	});

	it("rejects unknown role", async () => {
		const deps = mockDeps();
		await expect(
			assignModelToRoles({ selector: "openai/gpt-5.2-codex:high", roleIds: ["nonexistent:role"] }, deps),
		).rejects.toThrow();
		expect(deps.settings.setModelRolesAtomic).not.toHaveBeenCalled();
	});

	it("rejects unregistered custom: role", async () => {
		const deps = mockDeps();
		await expect(
			assignModelToRoles({ selector: "openai/gpt-5.2-codex:high", roleIds: ["custom:unregistered"] }, deps),
		).rejects.toThrow();
		expect(deps.settings.setModelRolesAtomic).not.toHaveBeenCalled();
	});
	it("accepts known custom role custom-fast surfaced by getKnownRoleIds (no custom: prefix)", async () => {
		const settings = Settings.isolated({
			modelRoles: {
				"custom-fast": "openai/gpt-5.2-codex:high",
			},
		});
		settings.set("modelTags", { "custom-fast": { name: "custom-fast" } });
		const atomicSpy = vi.spyOn(settings, "setModelRolesAtomic");
		const deps: AssignmentDependencies = { settings };
		await expect(
			assignModelToRoles({ selector: "openai/gpt-5.2-codex:high", roleIds: ["custom-fast"] }, deps),
		).resolves.toBeDefined();
		expect(atomicSpy).toHaveBeenCalledWith({
			"custom-fast": "openai/gpt-5.2-codex:high",
		});
	});

	it("accepts known role (default)", async () => {
		const deps = mockDeps();
		await assignModelToRoles({ selector: "openai/gpt-5.2-codex:high", roleIds: ["default"] }, deps);
		expect(deps.settings.setModelRolesAtomic).toHaveBeenCalledTimes(1);
	});

	it("accepts superpowers: prefixed known role", async () => {
		const deps = mockDeps();
		await assignModelToRoles({ selector: "openai/gpt-5.2-codex:high", roleIds: ["superpowers:implementer"] }, deps);
		expect(deps.settings.setModelRolesAtomic).toHaveBeenCalledTimes(1);
	});

	it("accepts custom: role surfaced by getKnownRoleIds", async () => {
		const settings = Settings.isolated({
			modelRoles: { "custom:researcher": "openai/gpt-5.2-codex:high" },
		});
		settings.set("modelTags", { "custom:researcher": { name: "Researcher" } });
		const atomicSpy = vi.spyOn(settings, "setModelRolesAtomic");
		await assignModelToRoles({ selector: "openai/gpt-5.2-codex:high", roleIds: ["custom:researcher"] }, { settings });
		expect(atomicSpy).toHaveBeenCalledTimes(1);
	});

	it("rejects upstream routing selector (multi-slash + @)", async () => {
		const deps = mockDeps();
		await expect(
			assignModelToRoles({ selector: "openrouter/z-ai/glm-4.7@cerebras", roleIds: ["default"] }, deps),
		).rejects.toThrow();
		expect(deps.settings.setModelRolesAtomic).not.toHaveBeenCalled();
	});

	it("accepts workers-ai model with @ in literal path (not routing)", async () => {
		const deps = mockDeps();
		await assignModelToRoles({ selector: "workers-ai/@cf/meta/llama-3.1-8b-instruct", roleIds: ["default"] }, deps);
		expect(deps.settings.setModelRolesAtomic).toHaveBeenCalledTimes(1);
	});

	it("accepts Vertex AI concrete selector with @deployment suffix", async () => {
		const deps = mockDeps();
		await assignModelToRoles(
			{ selector: "google-vertex/claude-opus-4-8@default", roleIds: ["superpowers:implementer"] },
			deps,
		);
		expect(deps.settings.setModelRolesAtomic).toHaveBeenCalledTimes(1);
	});
});
