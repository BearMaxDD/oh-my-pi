import { describe, expect, test } from "bun:test";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildSkillPromptMessage } from "../src/extensibility/skills";
import { SUPERPOWERS_CODEBASE_MEMORY_GATE_MARKER } from "../src/superpowers/codebase-memory-gate";

describe("buildSkillPromptMessage superpowers codebase-memory gate", () => {
	test("adds graph-first context to code-sensitive superpowers skills", async () => {
		const dir = await mkdtemp(join(tmpdir(), "omp-skill-gate-"));
		const skillPath = join(dir, "SKILL.md");
		await writeFile(skillPath, "---\nname: writing-plans\n---\n# Writing Plans\n");

		const result = await buildSkillPromptMessage(
			{ name: "writing-plans", filePath: skillPath, baseDir: dir },
			"规划 OMP 代码修改",
		);

		expect(result.message).toContain("# Writing Plans");
		expect(result.message).toContain(SUPERPOWERS_CODEBASE_MEMORY_GATE_MARKER);
		expect(result.message).toContain("search_graph");
		expect(result.message).toContain("User: 规划 OMP 代码修改");
	});

	test("does not add graph-first context to non-code superpowers skills", async () => {
		const dir = await mkdtemp(join(tmpdir(), "omp-skill-gate-"));
		const skillPath = join(dir, "SKILL.md");
		await writeFile(skillPath, "---\nname: chinese-documentation\n---\n# Chinese Documentation\n");

		const result = await buildSkillPromptMessage(
			{ name: "chinese-documentation", filePath: skillPath, baseDir: dir },
			"整理标点",
		);

		expect(result.message).toContain("# Chinese Documentation");
		expect(result.message).not.toContain(SUPERPOWERS_CODEBASE_MEMORY_GATE_MARKER);
	});

	test("respects disabled gate option", async () => {
		const dir = await mkdtemp(join(tmpdir(), "omp-skill-gate-"));
		const skillPath = join(dir, "SKILL.md");
		await writeFile(skillPath, "---\nname: writing-plans\n---\n# Writing Plans\n");

		const result = await buildSkillPromptMessage(
			{ name: "writing-plans", filePath: skillPath, baseDir: dir },
			"规划 OMP 代码修改",
			{
				codebaseMemoryGate: { enabled: false, mode: "advisory" },
			},
		);

		expect(result.message).toContain("# Writing Plans");
		expect(result.message).not.toContain(SUPERPOWERS_CODEBASE_MEMORY_GATE_MARKER);
	});
});
