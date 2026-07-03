import { describe, expect, it } from "bun:test";
import { getKnownRoleIds, getRoleInfo } from "../src/config/model-roles";

function makeSettings(
	overrides: { modelRoles?: Record<string, string>; modelTags?: Record<string, any>; cycleOrder?: string[] } = {},
) {
	return {
		get: (key: string) => {
			if (key === "cycleOrder") return overrides.cycleOrder ?? [];
			if (key === "modelTags") return overrides.modelTags ?? {};
			return undefined;
		},
		getModelRoles: () => overrides.modelRoles ?? {},
		getModelRole: (role: string) => overrides.modelRoles?.[role],
	} as any;
}

describe("acceptance model role", () => {
	it("is a known role for final plan run acceptance", () => {
		const settings = makeSettings();

		expect(getKnownRoleIds(settings)).toContain("acceptance");
		expect(getRoleInfo("acceptance", settings).description).toContain("final acceptance");
	});
});
describe("superpowers model roles", () => {
	it("are known roles via getKnownRoleIds", () => {
		const settings = makeSettings();

		expect(getKnownRoleIds(settings)).toContain("superpowers:tdd-writer");
		expect(getKnownRoleIds(settings)).toContain("superpowers:implementer");
		expect(getKnownRoleIds(settings)).toContain("superpowers:test-runner");
		expect(getKnownRoleIds(settings)).toContain("superpowers:spec-reviewer");
		expect(getKnownRoleIds(settings)).toContain("superpowers:quality-reviewer");
		expect(getKnownRoleIds(settings)).toContain("superpowers:acceptance");
	});

	it("tdd-writer has expected metadata", () => {
		const settings = makeSettings();
		const info = getRoleInfo("superpowers:tdd-writer", settings);

		expect(info.name).toBe("TDD Writer");
		expect(info.tag).toBe("TDD");
		expect(info.description).toBe("读任务规格，写失败测试，提交 red evidence");
	});

	it("superpowers:acceptance has expected metadata", () => {
		const settings = makeSettings();
		const info = getRoleInfo("superpowers:acceptance", settings);

		expect(info.name).toBe("Acceptance");
		expect(info.tag).toBe("ACCEPT");
		expect(info.description).toBe("只处理 must-fix 和最终通过/拒绝");
	});
});

it("includes all new superpowers roles in getKnownRoleIds", () => {
	const settings = makeSettings();
	const ids = getKnownRoleIds(settings);

	expect(ids).toContain("superpowers:advisor");
	expect(ids).toContain("superpowers:prompt-engineer");
	expect(ids).toContain("superpowers:impact-reviewer");
	expect(ids).toContain("superpowers:runtime-simulator");
	expect(ids).toContain("superpowers:business-scenario-reviewer");
	expect(ids).toContain("superpowers:frontend-designer");
	expect(ids).toContain("superpowers:security-reviewer");
	expect(ids).toContain("superpowers:release-auditor");
	expect(ids).toContain("superpowers:payment-reviewer");
	expect(ids).toContain("superpowers:data-migration-reviewer");
});

it("superpowers:implementer has complete role-bound metadata", () => {
	const settings = makeSettings();
	const info = getRoleInfo("superpowers:implementer", settings);

	expect(info.zhDescription).toBe("Implementer：只改生产代码，让 red 测试变绿");
	expect(info.recommendedTier).toBe("high");
	expect(info.recommendAdvancedModel).toBe(true);
	expect(info.capabilities).toContain("implementation");
	expect(info.canRunAsSubagent).toBe(true);
	expect(info.readOnly).toBe(false);
	expect(info.canEditProductionCode).toBe(true);
	expect(info.canEditTestCode).toBe(false);
	expect(info.requiresAdvisor).toBe(true);
	expect(info.fallbackRoleIds).toContain("task");
	expect(info.fallbackRoleIds).toContain("default");
});

it("superpowers:spec-reviewer is readOnly and cannot edit code", () => {
	const settings = makeSettings();
	const info = getRoleInfo("superpowers:spec-reviewer", settings);

	expect(info.readOnly).toBe(true);
	expect(info.canEditProductionCode).toBe(false);
	expect(info.canEditTestCode).toBe(false);
	expect(info.capabilities).toContain("spec_review");
});

it("modelTags override preserves built-in role-bound metadata", () => {
	const settings = makeSettings({
		modelTags: {
			"superpowers:implementer": {
				name: "Custom Impl",
				description: "Custom description",
				color: "error",
				hidden: false,
			},
		},
	});
	const info = getRoleInfo("superpowers:implementer", settings);

	// Overridden fields
	expect(info.name).toBe("Custom Impl");
	expect(info.description).toBe("Custom description");
	expect(info.color).toBe("error");

	// Built-in role-bound metadata preserved
	expect(info.zhDescription).toBe("Implementer：只改生产代码，让 red 测试变绿");
	expect(info.recommendedTier).toBe("high");
	expect(info.capabilities).toContain("implementation");
	expect(info.canEditProductionCode).toBe(true);
	expect(info.canEditTestCode).toBe(false);
	expect(info.readOnly).toBe(false);
	expect(info.requiresAdvisor).toBe(true);
});

it("superpowers:payment-reviewer has visible role info and menu metadata", () => {
	const settings = makeSettings();
	const info = getRoleInfo("superpowers:payment-reviewer", settings);

	expect(info.name).toBe("Payment Reviewer");
	expect(info.tag).toBeDefined();
	expect(info.description).toBeDefined();
	expect(info.menuHintZh).toBeDefined();
	expect(info.capabilities).toContain("payment_review");
	expect(info.readOnly).toBe(true);
	expect(info.requiresAdvisor).toBe(true);
});

it("superpowers:data-migration-reviewer has visible role info and menu metadata", () => {
	const settings = makeSettings();
	const info = getRoleInfo("superpowers:data-migration-reviewer", settings);

	expect(info.name).toBe("Data Migration Reviewer");
	expect(info.tag).toBeDefined();
	expect(info.description).toBeDefined();
	expect(info.menuHintZh).toBeDefined();
	expect(info.capabilities).toContain("data_migration_review");
	expect(info.readOnly).toBe(true);
	expect(info.requiresAdvisor).toBe(true);
});

describe("getKnownRoleIds hidden filtering", () => {
	it("filters hidden built-in roles from cycleOrder", () => {
		const settings = makeSettings({
			cycleOrder: ["smol", "default", "title"],
		});

		// title is built-in with hidden: true; addRole must not re-add it
		expect(getKnownRoleIds(settings)).not.toContain("title");
	});

	it("filters built-in roles hidden via modelTags from initial list", () => {
		// smol is NOT hidden in built-in MODEL_ROLES, but modelTags override sets hidden: true
		const settings = makeSettings({
			modelTags: { smol: { hidden: true } },
		});

		expect(getKnownRoleIds(settings)).not.toContain("smol");
	});

	it("filters hidden custom roles from modelTags", () => {
		const settings = makeSettings({
			modelTags: {
				"custom-visible": { name: "Visible" },
				"custom-hidden": { name: "Hidden", hidden: true },
			},
		});

		expect(getKnownRoleIds(settings)).toContain("custom-visible");
		expect(getKnownRoleIds(settings)).not.toContain("custom-hidden");
	});

	it("filters hidden roles from getModelRoles", () => {
		const settings = makeSettings({
			modelRoles: { "my-hidden-role": "gpt-4o" },
			modelTags: { "my-hidden-role": { name: "Hidden", hidden: true } },
		});

		expect(getKnownRoleIds(settings)).not.toContain("my-hidden-role");
	});
});
