import { describe, expect, it } from "bun:test";
import { validateSuperpowersSkillDiscovery } from "../../src/codex-plan-run/skill-gate";

describe("superpowers skill discovery gate", () => {
	it("requires the core superpowers skills", () => {
		const report = validateSuperpowersSkillDiscovery([
			{ name: "using-superpowers", filePath: "/pkg/skills/using-superpowers/SKILL.md" },
			{ name: "brainstorming", filePath: "/pkg/skills/brainstorming/SKILL.md" },
		]);

		expect(report.ok).toBe(false);
		expect(report.missing).toContain("test-driven-development");
		expect(report.missing).toContain("verification-before-completion");
	});

	it("passes when all required runtime parity skills are present", () => {
		const names = [
			"using-superpowers",
			"brainstorming",
			"test-driven-development",
			"systematic-debugging",
			"requesting-code-review",
			"verification-before-completion",
		];
		const report = validateSuperpowersSkillDiscovery(
			names.map(name => ({ name, filePath: `/pkg/skills/${name}/SKILL.md` })),
		);

		expect(report).toEqual({ ok: true, missing: [], found: names });
	});

	it("deduplicates repeated skills while preserving first-found order", () => {
		const report = validateSuperpowersSkillDiscovery([
			{ name: "brainstorming", filePath: "/pkg/skills/brainstorming/SKILL.md" },
			{ name: "using-superpowers", filePath: "/pkg/skills/using-superpowers/SKILL.md" },
			{ name: "brainstorming", filePath: "/pkg/skills/brainstorming/duplicate/SKILL.md" },
			{
				name: "test-driven-development",
				filePath: "/pkg/skills/test-driven-development/SKILL.md",
			},
		]);

		expect(report.found).toEqual(["brainstorming", "using-superpowers", "test-driven-development"]);
	});

	it("does not count discovered skills without filePath evidence as found", () => {
		const names = [
			"using-superpowers",
			"brainstorming",
			"test-driven-development",
			"systematic-debugging",
			"requesting-code-review",
			"verification-before-completion",
		];
		const report = validateSuperpowersSkillDiscovery(
			names.map(name => ({
				name,
				filePath: name === "systematic-debugging" ? "" : `/pkg/skills/${name}/SKILL.md`,
			})),
		);

		expect(report.ok).toBe(false);
		expect(report.found).not.toContain("systematic-debugging");
		expect(report.missing).toContain("systematic-debugging");
	});

	it("normalizes whitespace around skill names and SKILL.md file paths", () => {
		const names = [
			"using-superpowers",
			"brainstorming",
			"test-driven-development",
			"systematic-debugging",
			"requesting-code-review",
			"verification-before-completion",
		];
		const report = validateSuperpowersSkillDiscovery(
			names.map(name => ({ name: ` ${name} `, filePath: ` /pkg/skills/${name}/SKILL.md ` })),
		);

		expect(report).toEqual({ ok: true, missing: [], found: names });
	});

	it("does not count non-SKILL.md paths as found", () => {
		const names = [
			"using-superpowers",
			"brainstorming",
			"test-driven-development",
			"systematic-debugging",
			"requesting-code-review",
			"verification-before-completion",
		];
		const report = validateSuperpowersSkillDiscovery(
			names.map(name => ({
				name,
				filePath:
					name === "test-driven-development"
						? "/pkg/skills/test-driven-development/README.md"
						: `/pkg/skills/${name}/SKILL.md`,
			})),
		);

		expect(report.ok).toBe(false);
		expect(report.found).not.toContain("test-driven-development");
		expect(report.missing).toContain("test-driven-development");
	});

	it("does not count SKILL.md paths that do not match the claimed skill name", () => {
		const report = validateSuperpowersSkillDiscovery([
			{ name: "test-driven-development", filePath: "/pkg/skills/brainstorming/SKILL.md" },
		]);

		expect(report.found).toEqual([]);
		expect(report.missing).toContain("test-driven-development");
	});
});
