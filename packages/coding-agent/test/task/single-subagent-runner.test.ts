import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCommandSingleSubagentRuntime, createSingleSubagentBridge } from "../../src/task/single-subagent-runner";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "plan-run-bridge-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	await Promise.all(tempDirs.splice(0).map(dir => rm(dir, { recursive: true, force: true })));
});

describe("createSingleSubagentBridge", () => {
	it("writes auditable input and maps successful runtime output", async () => {
		const acceptingDir = await makeTempDir();
		const bridge = createSingleSubagentBridge({
			cwd: "/repo",
			acceptingDir,
			runSubagent: async input => ({
				exitCode: 0,
				stdout: JSON.stringify({ outputPath: join(acceptingDir, "tasks/T1-impl/output.json") }),
				stderr: "",
				agentId: input.id,
				modelRole: input.modelRole,
				resolvedModel: "test-model",
			}),
		});

		const result = await bridge({
			id: "T1-impl",
			role: "实现者",
			modelRole: "superpowers:implementer",
			context: "run_id: run-1",
			assignment: "write output",
			description: "Implement stage",
			required_skill_evidence: ["implementation-summary.md"],
		});

		expect(result.exitCode).toBe(0);
		expect(result.outputPath).toContain("tasks/T1-impl/output.json");
		expect(result.id).toBe("T1-impl");
		expect(result.resolvedModel).toBe("test-model");

		const input = JSON.parse(await readFile(join(acceptingDir, "tasks/T1-impl/input.json"), "utf8"));
		expect(input.assignment).toBe("write output");
		expect(input.required_skill_evidence).toEqual(["implementation-summary.md"]);
	});

	it("parses evidence from runtime stdout JSON and returns it in the bridge result", async () => {
		const acceptingDir = await makeTempDir();
		const evidencePaths = [
			join(acceptingDir, "evidence/red-evidence.md"),
			join(acceptingDir, "evidence/green-evidence.md"),
		];
		const bridge = createSingleSubagentBridge({
			cwd: "/repo",
			acceptingDir,
			runSubagent: async () => ({
				exitCode: 0,
				stdout: JSON.stringify({
					outputPath: join(acceptingDir, "tasks/T1-impl/output.json"),
					evidence: evidencePaths,
				}),
				stderr: "",
				agentId: "T1-impl",
				modelRole: "superpowers:implementer",
			}),
		});

		const result = await bridge({
			id: "T1-impl",
			role: "实现者",
			modelRole: "superpowers:implementer",
			context: "run_id: run-1",
			assignment: "write output",
			description: "Implement stage",
			required_skill_evidence: [],
		});

		expect(result.exitCode).toBe(0);
		expect(result.outputPath).toContain("tasks/T1-impl/output.json");
		expect(result.evidence).toEqual(evidencePaths);
	});

	it("returns structured error when input artifact cannot be prepared", async () => {
		const acceptingFile = join(await makeTempDir(), "not-a-directory");
		await import("node:fs/promises").then(({ writeFile }) => writeFile(acceptingFile, "file"));
		const bridge = createSingleSubagentBridge({
			cwd: "/repo",
			acceptingDir: acceptingFile,
			runSubagent: async () => ({ exitCode: 0 }),
		});

		const result = await bridge({
			id: "T1-impl",
			role: "实现者",
			modelRole: "superpowers:implementer",
			context: "run_id: run-1",
			assignment: "write output",
			description: "Implement stage",
			required_skill_evidence: [],
		});

		expect(result.exitCode).not.toBe(0);
		expect(result.stderr).toContain("Failed to prepare bridge environment");
	});
});

describe("createCommandSingleSubagentRuntime", () => {
	it("runs configured command with OMP env vars and returns stdout/stderr", async () => {
		const acceptingDir = await makeTempDir();
		const inputPath = join(acceptingDir, "input.json");
		const outputPath = join(acceptingDir, "output.json");

		// Write a dummy input file so the child script can read it
		await writeFile(inputPath, JSON.stringify({ assignment: "do the thing" }), "utf8");

		// Write a helper script that reads the input path, writes output, and prints JSON to stdout
		const helperScript = join(acceptingDir, "helper.cjs");
		await writeFile(
			helperScript,
			[
				"const { readFileSync, writeFileSync } = require('fs');",
				"const inputPath = process.env.OMP_PLAN_RUN_SUBAGENT_INPUT_PATH;",
				"const outputPath = process.env.OMP_PLAN_RUN_SUBAGENT_OUTPUT_PATH;",
				"const input = JSON.parse(readFileSync(inputPath, 'utf8'));",
				"writeFileSync(outputPath, JSON.stringify({ done: true }));",
				"process.stdout.write(JSON.stringify({ outputPath, evidence: [outputPath] }));",
			].join("\n"),
			"utf8",
		);

		const runtime = createCommandSingleSubagentRuntime({ command: process.execPath, args: [helperScript] });
		const result = await runtime({
			id: "T1-impl",
			role: "implementer",
			modelRole: "superpowers:implementer",
			context: "run_id: run-1",
			assignment: "do the thing",
			description: "Implement stage",
			cwd: acceptingDir,
			acceptingDir,
			inputPath,
			outputPath,
		});

		expect(result.exitCode).toBe(0);
		expect(result.stderr).toBe("");
		const stdoutParsed = JSON.parse(result.stdout ?? "{}");
		expect(stdoutParsed.outputPath).toBe(outputPath);
		expect(stdoutParsed.evidence).toEqual([outputPath]);
	});

	it("returns nonzero with stderr message when no command is configured", async () => {
		const runtime = createCommandSingleSubagentRuntime();
		const result = await runtime({
			id: "T1-impl",
			role: "implementer",
			modelRole: "superpowers:implementer",
			context: "run_id: run-1",
			assignment: "do the thing",
			description: "Implement stage",
			cwd: "/tmp",
			acceptingDir: "/tmp",
			inputPath: "/tmp/input.json",
			outputPath: "/tmp/output.json",
		});

		expect(result.exitCode).not.toBe(0);
		expect(result.stderr).toContain("single subagent runtime command is not configured");
	});
});
