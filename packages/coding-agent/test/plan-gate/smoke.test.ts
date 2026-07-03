import { afterEach, describe, expect, it } from "bun:test";
import { createHash } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	parseFixedSmokeCommands,
	runPlanSmokeGate,
	type SmokeCommandRunner,
} from "@oh-my-pi/pi-coding-agent/plan-gate/smoke";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "omp-plan-smoke-"));
	tempDirs.push(dir);
	return dir;
}

function sha256(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) {
		await rm(dir, { recursive: true, force: true });
	}
});

describe("plan smoke gate", () => {
	it("parses fixed smoke commands from the plan section", () => {
		const commands = parseFixedSmokeCommands(`# Plan

## 固定冒烟测试

- cwd: /repo
- commands:
  - bun test packages/coding-agent/test/plan-gate/smoke.test.ts
  - bun run check:types
- pass_condition:
  - 所有命令 exit code = 0

## Other

- commands:
  - should not be parsed
`);

		expect(commands).toEqual(["bun test packages/coding-agent/test/plan-gate/smoke.test.ts", "bun run check:types"]);
	});

	it("blocks completion and writes repair prompt when a fixed smoke command fails", async () => {
		const dir = await makeTempDir();
		const planText = `# Plan

## 固定冒烟测试

- commands:
  - bun test failing.test.ts
`;
		const planPath = join(dir, "plan.md");
		await Bun.write(planPath, planText);
		const acceptingDir = join(dir, "docs", "superpowers", "accepting", "demo");
		const runner: SmokeCommandRunner = async command => ({
			command,
			cwd: dir,
			exitCode: 1,
			stdout: "one test failed",
			stderr: "expected true to be false",
			durationMs: 12,
			timedOut: false,
		});

		const result = await runPlanSmokeGate({
			planPath,
			planSha256: sha256(planText),
			repoPath: dir,
			acceptingDir,
			completionMdPath: join(acceptingDir, "omp-completion.md"),
			runner,
		});

		expect(result.status).toBe("failed");
		expect(result.nextAllowed).toBe(false);
		expect(result.repairPrompt).toContain("bun test failing.test.ts");
		expect(result.repairPrompt).toContain("expected true to be false");
		expect(await Bun.file(join(acceptingDir, "smoke-results.json")).exists()).toBe(true);
		expect(await Bun.file(join(acceptingDir, "smoke-results.md")).exists()).toBe(true);
	});
});
