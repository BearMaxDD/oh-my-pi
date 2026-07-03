import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import { BashTool } from "@oh-my-pi/pi-coding-agent/tools/bash";
import { Snowflake } from "@oh-my-pi/pi-utils";

function makeSession(cwd: string, taskDepth: number): ToolSession {
	return {
		cwd,
		hasUI: false,
		skills: [],
		taskDepth,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		settings: Settings.isolated({
			"async.enabled": false,
			"bash.autoBackground.enabled": false,
			"bashInterceptor.enabled": false,
			"bash.stripTrailingHeadTail": false,
			"task.codeWrites": "subagent-only",
		} as Parameters<typeof Settings.isolated>[0]),
		getClientBridge: () => undefined,
	};
}

describe("BashTool subagent-only code writes", () => {
	let tempDir: string;

	beforeEach(() => {
		tempDir = path.join(os.tmpdir(), `omp-code-writes-${Snowflake.next()}`);
		fs.mkdirSync(tempDir, { recursive: true });
	});

	afterEach(() => {
		fs.rmSync(tempDir, { recursive: true, force: true });
	});

	it("blocks main-agent bash commands that create code files", async () => {
		const tool = new BashTool(makeSession(tempDir, 0));

		await expect(
			tool.execute("main-write", { command: "mkdir -p src && printf 'export const x = 1;\\n' > src/new.ts" }),
		).rejects.toThrow("Main agent bash modified files outside allowed evidence paths");
	});

	it("allows main-agent bash commands that only create accepting evidence", async () => {
		const tool = new BashTool(makeSession(tempDir, 0));
		const result = await tool.execute("main-accepting", {
			command:
				"mkdir -p docs/superpowers/accepting/demo && printf 'completion\\n' > docs/superpowers/accepting/demo/omp-completion.md",
		});

		expect(result.isError).toBeUndefined();
		expect(fs.existsSync(path.join(tempDir, "docs/superpowers/accepting/demo/omp-completion.md"))).toBe(true);
	});

	it("allows subagent bash commands to create code files", async () => {
		const tool = new BashTool(makeSession(tempDir, 1));
		const result = await tool.execute("subagent-write", {
			command: "mkdir -p src && printf 'export const x = 1;\\n' > src/new.ts",
		});

		expect(result.isError).toBeUndefined();
		expect(fs.existsSync(path.join(tempDir, "src/new.ts"))).toBe(true);
	});
});
