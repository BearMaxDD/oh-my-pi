import { afterEach, describe, expect, test } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { runSuperpowersAgentsCommand } from "../src/cli/superpowers-agents-cli";

describe("superpowers agents CLI", () => {
	const tempDirs: string[] = [];

	afterEach(() => {
		for (const dir of tempDirs.splice(0)) {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});

	test("sync writes wrappers and emits JSON when requested", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-sp-agents-cli-"));
		tempDirs.push(dir);
		const lines: string[] = [];

		await runSuperpowersAgentsCommand(
			{ group: "agents", action: "sync", flags: { dir, json: true, force: false } },
			{ write: line => lines.push(line) },
		);

		expect(lines).toHaveLength(1);
		const parsed = JSON.parse(lines[0]) as { targetDir: string; written: string[] };
		expect(parsed.targetDir).toBe(dir);
		expect(parsed.written).toHaveLength(9);
		expect(fs.readdirSync(dir).sort()).toContain("superpowers-tdd-writer.md");
	});

	test("sync rejects when settings has enabled: false", async () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-sp-agents-cli-"));
		tempDirs.push(dir);

		await expect(
			runSuperpowersAgentsCommand(
				{
					group: "agents",
					action: "sync",
					flags: { dir, json: false, force: false },
				},
				{ write: () => {}, settings: { enabled: false } },
			),
		).rejects.toThrow("Superpowers agent bridge is disabled");
	});
});
