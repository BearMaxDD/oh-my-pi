import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
	cleanSuperpowersAgents,
	listSuperpowersAgentRoles,
	renderSuperpowersAgentMarkdown,
	SUPERPOWERS_AGENT_MARKER,
	superpowersRoleFileName,
	syncSuperpowersAgents,
} from "../src/superpowers/agent-bridge";
import { parseAgent } from "../src/task/agents";

describe("superpowers agent bridge role metadata", () => {
	test("lists the supported superpowers roles in execution order", () => {
		expect(listSuperpowersAgentRoles().map(role => role.name)).toEqual([
			"superpowers:tdd-writer",
			"superpowers:implementer",
			"superpowers:test-runner",
			"superpowers:spec-reviewer",
			"superpowers:quality-reviewer",
			"superpowers:acceptance",
			"superpowers:systematic-debugging",
			"superpowers:brainstorming",
			"superpowers:finishing-a-development-branch",
		]);
	});

	test("maps role names to stable markdown file names", () => {
		expect(superpowersRoleFileName("superpowers:tdd-writer")).toBe("superpowers-tdd-writer.md");
		expect(superpowersRoleFileName("superpowers:quality-reviewer")).toBe("superpowers-quality-reviewer.md");
	});

	test("renders a valid generated agent wrapper", () => {
		const role = listSuperpowersAgentRoles()[0];
		const markdown = renderSuperpowersAgentMarkdown(role);

		expect(markdown).toContain(SUPERPOWERS_AGENT_MARKER);
		expect(markdown).toContain("name: superpowers:tdd-writer");
		expect(markdown).toContain("description: TDD Writer");
		expect(markdown).toContain("Follow the superpowers role `superpowers:tdd-writer`.");
		expect(markdown).toContain("Do not modify production code.");
	});
});

describe("superpowers agent bridge filesystem operations", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-sp-bridge-"));
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	test("sync writes generated markdown wrappers that parse as OMP agents", async () => {
		const result = await syncSuperpowersAgents({ targetDir: tempDir });

		// 9 roles = 9 written files
		expect(result.written).toHaveLength(9);
		expect(result.skipped).toHaveLength(0);
		expect(result.updated).toHaveLength(0);
		expect(result.targetDir).toBeTruthy();

		// All written paths are absolute and under targetDir
		for (const file of result.written) {
			expect(file.startsWith(result.targetDir)).toBe(true);
			expect(fs.existsSync(file)).toBe(true);
		}

		// TDD writer file parses correctly (parseFrontmatter strips HTML comments)
		const tddFile = result.written.find(f => f.endsWith("superpowers-tdd-writer.md"))!;
		expect(tddFile).toBeDefined();
		const content = fs.readFileSync(tddFile, "utf-8");
		const agent = parseAgent(tddFile, content, "user");
		expect(agent.name).toBe("superpowers:tdd-writer");
		expect(agent.description).toContain("TDD Writer");
		expect(agent.systemPrompt).toContain("Do not modify production code.");
	});

	test("sync skips an existing non-generated same-name file unless force", async () => {
		// Write a user-owned file (no marker) ahead of sync
		const conflictPath = path.join(tempDir, "superpowers-tdd-writer.md");
		const userContent = "# User-owned file\n\nThis is mine.\n";
		fs.writeFileSync(conflictPath, userContent, "utf-8");

		const result = await syncSuperpowersAgents({ targetDir: tempDir });

		// Conflict reported for this file
		expect(result.conflicts).toHaveLength(1);
		expect(result.conflicts[0]).toBe(conflictPath);
		expect(result.targetDir).toBeTruthy();

		// Original content preserved
		expect(fs.readFileSync(conflictPath, "utf-8")).toBe(userContent);

		// Marker still absent (generated content was NOT written)
		const content = fs.readFileSync(conflictPath, "utf-8");
		expect(content).not.toContain(SUPERPOWERS_AGENT_MARKER);

		// Other 8 files written as normal
		expect(result.written).toHaveLength(8);
	});

	test("clean removes generated files and preserves user-owned files", async () => {
		// First sync all generated wrappers
		await syncSuperpowersAgents({ targetDir: tempDir });

		// Write a user-owned file
		const userFilePath = path.join(tempDir, "superpowers-user-owned.md");
		fs.writeFileSync(userFilePath, "# My custom agent\n\nThis is user-authored.", "utf-8");

		const result = await cleanSuperpowersAgents({ targetDir: tempDir });

		// 9 generated files removed, user file preserved in skipped
		expect(result.removed).toHaveLength(9);
		expect(result.skipped).toEqual([userFilePath]);
		expect(result.targetDir).toBeTruthy();

		// Only the user-owned file remains on disk
		const remaining = fs.readdirSync(tempDir);
		expect(remaining).toEqual(["superpowers-user-owned.md"]);
	});

	test("sync output produces files that all parse as valid OMP agents with expected names", async () => {
		const result = await syncSuperpowersAgents({ targetDir: tempDir });

		// All 9 roles written
		expect(result.written).toHaveLength(9);

		// Parse every generated file
		const agents = result.written
			.filter(f => f.endsWith(".md"))
			.map(f => {
				const content = fs.readFileSync(f, "utf-8");
				return parseAgent(f, content, "user");
			});

		expect(agents).toHaveLength(9);
		const names = agents.map(a => a.name);

		// Specific superpowers roles must be parseable
		expect(names).toContain("superpowers:tdd-writer");
		expect(names).toContain("superpowers:acceptance");

		// Every parsed agent has all required fields
		for (const agent of agents) {
			expect(agent.name).toBeTruthy();
			expect(agent.description).toBeTruthy();
			expect(agent.systemPrompt).toContain(`Follow the superpowers role \`${agent.name}\``);
			expect(agent.source).toBe("user");
			expect(agent.filePath).toBeTruthy();
		}
	});
});
