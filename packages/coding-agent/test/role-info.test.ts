import { describe, expect, test } from "bun:test";
import { getRoleInfo } from "@oh-my-pi/pi-coding-agent/config/model-roles";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";

describe("getRoleInfo", () => {
	test("returns built-in role info", () => {
		const settings = Settings.isolated({});

		// toMatchObject: built-in roles carry richer role-bound metadata (zhDescription,
		// recommendedTier, capabilities, etc.) beyond name/color/tag.
		expect(getRoleInfo("default", settings)).toMatchObject({
			name: "Default",
			color: "success",
			tag: "DEFAULT",
		});
		expect(getRoleInfo("smol", settings)).toMatchObject({
			name: "Fast",
			color: "warning",
			tag: "SMOL",
		});
		expect(getRoleInfo("slow", settings)).toMatchObject({
			name: "Thinking",
			color: "accent",
			tag: "SLOW",
		});
	});

	test("returns custom role info from modelTags", () => {
		const settings = Settings.isolated({
			modelTags: {
				custom: { name: "My Custom Tag", color: "error" },
				another: { name: "Another Tag" },
			},
		});

		// toMatchObject: the configured branch also returns tag/description/hidden
		// (possibly undefined) even for non-built-in custom roles.
		expect(getRoleInfo("custom", settings)).toMatchObject({
			name: "My Custom Tag",
			color: "error",
		});
		expect(getRoleInfo("another", settings)).toMatchObject({
			name: "Another Tag",
		});
		expect(getRoleInfo("another", settings).color).toBeUndefined();
	});

	test("returns fallback for unknown roles", () => {
		const settings = Settings.isolated({});

		expect(getRoleInfo("unknown-role", settings)).toEqual({
			name: "unknown-role",
			color: "muted",
		});
	});

	test("configured metadata overrides built-in role info while keeping built-in defaults", () => {
		const settings = Settings.isolated({
			modelTags: {
				smol: { name: "My Smol", color: "success" },
			},
		});

		expect(getRoleInfo("smol", settings)).toMatchObject({
			tag: "SMOL",
			name: "My Smol",
			color: "success",
		});
	});
});

test("preserves configured model tag descriptions", () => {
	const settings = Settings.isolated({
		modelTags: {
			custom: { name: "Custom", description: "my custom desc" },
			smol: { name: "Super Fast", description: "overridden smol" },
		},
	});

	expect(getRoleInfo("custom", settings).description).toBe("my custom desc");
	expect(getRoleInfo("smol", settings).description).toBe("overridden smol");
	expect(getRoleInfo("smol", settings).tag).toBe("SMOL");
	expect(getRoleInfo("default", settings).description).toBeUndefined();
});
