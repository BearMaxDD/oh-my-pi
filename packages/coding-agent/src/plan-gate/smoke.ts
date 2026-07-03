import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";

export interface SmokeCommandResult {
	command: string;
	cwd: string;
	exitCode: number | null;
	stdout: string;
	stderr: string;
	durationMs: number;
	timedOut: boolean;
}

export type SmokeCommandRunner = (
	command: string,
	options: { cwd: string; timeoutMs: number },
) => Promise<SmokeCommandResult>;

export interface PlanSmokeGateRequest {
	planPath: string;
	planSha256: string;
	repoPath: string;
	acceptingDir: string;
	completionMdPath: string;
	commands?: string[];
	timeoutMs?: number;
	runner?: SmokeCommandRunner;
	now?: Date;
}

export interface PlanSmokeGateResult {
	status: "passed" | "failed";
	nextAllowed: boolean;
	planPath: string;
	planSha256: string;
	actualPlanSha256: string;
	acceptingDir: string;
	completionMdPath: string;
	jsonPath: string;
	markdownPath: string;
	commands: SmokeCommandResult[];
	repairPrompt?: string;
}

const DEFAULT_TIMEOUT_MS = 120_000;
const OUTPUT_LIMIT = 20_000;

function sha256(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

function trimOutput(text: string): string {
	if (text.length <= OUTPUT_LIMIT) return text;
	return `${text.slice(0, OUTPUT_LIMIT)}\n[truncated ${text.length - OUTPUT_LIMIT} chars]`;
}

export function parseFixedSmokeCommands(planText: string): string[] {
	const lines = planText.split(/\r?\n/);
	const start = lines.findIndex(line => /^#{2,6}\s*(固定冒烟测试|fixed smoke tests?)\s*$/i.test(line.trim()));
	if (start < 0) return [];
	const section: string[] = [];
	for (let index = start + 1; index < lines.length; index++) {
		const line = lines[index];
		if (/^#{2,6}\s+/.test(line.trim())) break;
		section.push(line);
	}

	const commands: string[] = [];
	let inCommands = false;
	for (const rawLine of section) {
		const line = rawLine.replace(/\t/g, "    ");
		if (/^\s*-?\s*commands\s*:\s*$/i.test(line)) {
			inCommands = true;
			continue;
		}
		if (!inCommands) continue;
		const item = line.match(/^\s{2,}-\s+(.+?)\s*$/);
		if (item?.[1]) {
			commands.push(item[1]);
			continue;
		}
		if (line.trim().length > 0 && /^\s{0,2}-\s+\w/.test(line)) break;
	}
	return commands;
}

async function defaultSmokeCommandRunner(
	command: string,
	options: { cwd: string; timeoutMs: number },
): Promise<SmokeCommandResult> {
	const started = Date.now();
	return new Promise(resolve => {
		const child = spawn(command, {
			cwd: options.cwd,
			shell: true,
			stdio: ["ignore", "pipe", "pipe"],
		});
		let stdout = "";
		let stderr = "";
		let settled = false;
		const timeout = setTimeout(() => {
			settled = true;
			child.kill("SIGTERM");
			resolve({
				command,
				cwd: options.cwd,
				exitCode: null,
				stdout: trimOutput(stdout),
				stderr: trimOutput(stderr || `Timed out after ${options.timeoutMs}ms`),
				durationMs: Date.now() - started,
				timedOut: true,
			});
		}, options.timeoutMs);

		child.stdout?.on("data", chunk => {
			stdout = trimOutput(stdout + String(chunk));
		});
		child.stderr?.on("data", chunk => {
			stderr = trimOutput(stderr + String(chunk));
		});
		child.on("close", code => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			resolve({
				command,
				cwd: options.cwd,
				exitCode: code,
				stdout: trimOutput(stdout),
				stderr: trimOutput(stderr),
				durationMs: Date.now() - started,
				timedOut: false,
			});
		});
		child.on("error", error => {
			if (settled) return;
			settled = true;
			clearTimeout(timeout);
			resolve({
				command,
				cwd: options.cwd,
				exitCode: 1,
				stdout: trimOutput(stdout),
				stderr: trimOutput(error.message),
				durationMs: Date.now() - started,
				timedOut: false,
			});
		});
	});
}

function buildRepairPrompt(failed: SmokeCommandResult[]): string {
	const details = failed
		.map(result =>
			[
				`Command: ${result.command}`,
				`Exit code: ${result.exitCode ?? "timeout"}`,
				result.stdout ? `stdout:\n${result.stdout}` : "",
				result.stderr ? `stderr:\n${result.stderr}` : "",
			]
				.filter(Boolean)
				.join("\n"),
		)
		.join("\n\n---\n\n");
	return [
		"Fixed smoke acceptance failed. Do not mark the plan complete.",
		"Use the same Codex-generated plan and current worktree, make a focused repair plan, fix the failing behavior, then rerun plan_smoke with the same plan path and checksum.",
		"",
		details,
	].join("\n");
}

function renderMarkdown(result: PlanSmokeGateResult): string {
	const commandRows = result.commands
		.map(command =>
			[
				`### ${command.command}`,
				`- cwd: ${command.cwd}`,
				`- exitCode: ${command.exitCode ?? "timeout"}`,
				`- durationMs: ${command.durationMs}`,
				`- timedOut: ${command.timedOut}`,
				"",
				"```text",
				command.stdout || "(no stdout)",
				"```",
				"",
				"```text",
				command.stderr || "(no stderr)",
				"```",
			].join("\n"),
		)
		.join("\n\n");
	return [
		"# Plan Smoke Results",
		"",
		`- status: ${result.status}`,
		`- nextAllowed: ${result.nextAllowed}`,
		`- planPath: ${result.planPath}`,
		`- planSha256: ${result.planSha256}`,
		`- actualPlanSha256: ${result.actualPlanSha256}`,
		`- completionMdPath: ${result.completionMdPath}`,
		"",
		commandRows,
		result.repairPrompt ? ["", "## Repair Prompt", "", "```text", result.repairPrompt, "```"].join("\n") : "",
		"",
	].join("\n");
}

export async function runPlanSmokeGate(request: PlanSmokeGateRequest): Promise<PlanSmokeGateResult> {
	const timeoutMs = request.timeoutMs ?? DEFAULT_TIMEOUT_MS;
	const planText = await readFile(request.planPath, "utf8");
	const actualPlanSha256 = sha256(planText);
	if (actualPlanSha256 !== request.planSha256) {
		throw new Error(`Plan SHA-256 mismatch: expected ${request.planSha256}, got ${actualPlanSha256}`);
	}

	const commands = request.commands?.length ? request.commands : parseFixedSmokeCommands(planText);
	if (commands.length === 0) {
		throw new Error("No fixed smoke commands provided or found in the plan.");
	}

	const runner = request.runner ?? defaultSmokeCommandRunner;
	const results: SmokeCommandResult[] = [];
	for (const command of commands) {
		results.push(await runner(command, { cwd: request.repoPath, timeoutMs }));
	}

	const failed = results.filter(result => result.timedOut || result.exitCode !== 0);
	const status: PlanSmokeGateResult["status"] = failed.length === 0 ? "passed" : "failed";
	const jsonPath = join(request.acceptingDir, "smoke-results.json");
	const markdownPath = join(request.acceptingDir, "smoke-results.md");
	const result: PlanSmokeGateResult = {
		status,
		nextAllowed: status === "passed",
		planPath: request.planPath,
		planSha256: request.planSha256,
		actualPlanSha256,
		acceptingDir: request.acceptingDir,
		completionMdPath: request.completionMdPath,
		jsonPath,
		markdownPath,
		commands: results,
		repairPrompt: failed.length > 0 ? buildRepairPrompt(failed) : undefined,
	};

	await mkdir(request.acceptingDir, { recursive: true });
	await writeFile(jsonPath, `${JSON.stringify(result, null, 2)}\n`);
	await writeFile(markdownPath, renderMarkdown(result));
	return result;
}
