import { readFile } from "node:fs/promises";
import type {
	ExecutedStep,
	RuntimeCleanupResult,
	RuntimeLogRef,
	RuntimeSimulationRunner,
	RuntimeStartResult,
	ScenarioExecutionResult,
} from "./real-runtime-simulation";
import type { IApiExecutor, IBrowserExecutor, IDatabaseExecutor } from "./runtime-executors";
import { assertReadOnlySql, createApiStepExecutor } from "./runtime-executors";
import type {
	BusinessSimulationScenario,
	DatabaseStep,
	RuntimeCommand,
	RuntimeEnvironmentPlan,
	RuntimeScenarioStep,
} from "./runtime-scenarios";

interface RuntimeScenarioSettings {
	browser?: { enabled: boolean };
	api?: { enabled: boolean };
	database?: { enabled: boolean };
}

export interface DefaultRuntimeSimulationRunnerOptions {
	cwd: string;
	timeoutMs: number;
	redactValues?: string[];
	enableDocker?: boolean;
	enableSandbox?: boolean;
	runtimeScenario?: RuntimeScenarioSettings;
	apiExecutor?: IApiExecutor;
	browserExecutor?: IBrowserExecutor;
	databaseExecutor?: IDatabaseExecutor;
}

function redact(text: string, values: readonly string[]): string {
	return values.reduce((current, value) => current.split(value).join("[REDACTED]"), text);
}

async function runCommand(
	command: string | RuntimeCommand,
	options: DefaultRuntimeSimulationRunnerOptions,
	overrides: { timeoutMs?: number; redacts?: readonly string[] } = {},
): Promise<{ exitCode: number; output: string }> {
	const commandText = typeof command === "string" ? command : command.command;
	const cwd = typeof command === "string" ? options.cwd : command.cwd || options.cwd;
	const timeoutMs =
		overrides.timeoutMs ??
		(typeof command === "string" ? options.timeoutMs : command.timeout_ms || options.timeoutMs);
	const redacts = [
		...(options.redactValues ?? []),
		...(overrides.redacts ?? []),
		...(typeof command === "string" ? [] : (command.redacts ?? [])),
	];
	const proc = Bun.spawn(["bash", "-lc", commandText], { cwd, stdout: "pipe", stderr: "pipe" });
	let killTimer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<"timeout">(resolve => {
		killTimer = setTimeout(() => resolve("timeout"), timeoutMs);
	});
	const exitOrTimeout = await Promise.race([proc.exited, timeout]);
	if (killTimer) clearTimeout(killTimer);
	if (exitOrTimeout === "timeout") {
		proc.kill();
		const graceResult = await Promise.race([
			proc.exited.then(() => "exited" as const),
			new Promise<"force">(resolve => setTimeout(() => resolve("force"), 50)),
		]);
		if (graceResult === "force") {
			proc.kill("SIGKILL");
			await proc.exited;
		}
		return { exitCode: -1, output: redact(`[TIMEOUT after ${timeoutMs}ms]`, redacts) };
	}
	const exitCode = exitOrTimeout;
	const stdout = await new Response(proc.stdout).text();
	const stderr = await new Response(proc.stderr).text();
	return { exitCode, output: redact(`${stdout}${stderr}`, redacts) };
}

export function createDefaultRuntimeSimulationRunner(
	options: DefaultRuntimeSimulationRunnerOptions,
): RuntimeSimulationRunner {
	return {
		async start(environment: RuntimeEnvironmentPlan): Promise<RuntimeStartResult> {
			const envType = environment.type ?? environment.environment_type;
			if (envType === "docker" && options.enableDocker !== true) {
				return { status: "blocked", logs: [], failure_summary_zh: "docker runtime is not enabled" };
			}
			if (envType === "sandbox" && options.enableSandbox !== true) {
				return { status: "blocked", logs: [], failure_summary_zh: "sandbox runtime is not enabled" };
			}

			const logs: RuntimeLogRef[] = [];
			for (const cmd of environment.startup_commands) {
				const result = await runCommand(cmd, options);
				logs.push({ path: "runtime/startup.log", summary: result.output });
				if (result.exitCode !== 0) {
					return { status: "failed", logs, failure_summary_zh: result.output };
				}
			}

			for (const check of environment.health_checks) {
				if ("type" in check && check.type === "log_contains") {
					const body = redact(await readFile(check.path, "utf8"), options.redactValues || []);
					if (!body.includes(check.text)) {
						return { status: "failed", logs, failure_summary_zh: `health check missing ${check.text}` };
					}
					logs.push({ path: check.path, summary: "log_contains passed" });
					continue;
				}
				if (!("command" in check)) continue;
				const result = await runCommand(check.command, options);
				if (result.exitCode !== check.expected_exit_code) {
					return { status: "failed", logs, failure_summary_zh: `health check failed: ${result.output}` };
				}
			}

			return { status: "passed", logs };
		},
		async executeScenario(scenario: BusinessSimulationScenario): Promise<ScenarioExecutionResult> {
			const executed_steps: ExecutedStep[] = [];
			const evidencePaths: string[] = [];
			for (const [index, step] of scenario.steps.entries()) {
				if (step.evidence_path) evidencePaths.push(step.evidence_path);
				if (step.kind === "cli") {
					const result = await runCommand(
						{ cwd: step.cwd, command: step.command, timeout_ms: step.timeout_ms, redacts: step.redacts },
						options,
					);
					const outputOk = !step.expected_output_contains || result.output.includes(step.expected_output_contains);
					const passed = result.exitCode === step.expected_exit_code && outputOk;
					executed_steps.push({
						index,
						status: passed ? ("passed" as const) : ("failed" as const),
						evidence: result.output,
					});
					if (!passed)
						return {
							scenario_id: scenario.id,
							status: "failed",
							executed_steps,
							evidence_paths: [...evidencePaths],
						};
				} else if (step.kind === "log_check") {
					const body = redact(await readFile(step.path, "utf8"), options.redactValues || []);
					const passed = body.includes(step.contains);
					executed_steps.push({
						index,
						status: passed ? ("passed" as const) : ("failed" as const),
						evidence: step.path,
					});
					if (!passed) {
						const logPaths = [...evidencePaths, step.path];
						return { scenario_id: scenario.id, status: "failed", executed_steps, evidence_paths: logPaths };
					}
				} else if (step.kind === "browser" || step.kind === "api" || step.kind === "database") {
					const kind = step.kind;
					const rs = options.runtimeScenario;
					const setting = rs?.[kind];

					// Check if this step kind is disabled by settings
					if (setting && !setting.enabled) {
						const evidence = `runtime_step_kind_disabled_by_settings:${kind}`;
						executed_steps.push({ index, status: "blocked", evidence });
						if (step.required) {
							return {
								scenario_id: scenario.id,
								status: "blocked",
								executed_steps,
								evidence_paths: [...evidencePaths],
								failure_summary_zh: evidence,
							};
						}
						continue;
					}

					// Try to find an executor for this kind
					let executor =
						kind === "browser"
							? options.browserExecutor
							: kind === "api"
								? options.apiExecutor
								: options.databaseExecutor;

					// For API steps with enabled setting, fall back to built-in executor
					if (!executor && kind === "api" && setting?.enabled) {
						executor = createApiStepExecutor();
					}

					if (!executor) {
						const evidence = `runtime_step_kind_not_configured:${kind}`;
						executed_steps.push({ index, status: "blocked", evidence });
						if (step.required) {
							return {
								scenario_id: scenario.id,
								status: "blocked",
								executed_steps,
								evidence_paths: [...evidencePaths],
								failure_summary_zh: evidence,
							};
						}
						continue;
					}

					// Validate read-only for database steps before delegation
					if (kind === "database") {
						try {
							assertReadOnlySql((step as DatabaseStep).query);
						} catch (e) {
							const evidence = e instanceof Error ? e.message : String(e);
							executed_steps.push({ index, status: "blocked", evidence });
							if (step.required) {
								return {
									scenario_id: scenario.id,
									status: "blocked",
									executed_steps,
									evidence_paths: [...evidencePaths],
									failure_summary_zh: evidence,
								};
							}
							continue;
						}
					}

					// Delegate to executor
					const result = await (
						executor.execute as (
							step: RuntimeScenarioStep,
						) => Promise<{ status: string; evidence: string; evidencePath?: string }>
					)(step);
					executed_steps.push({
						index,
						status: result.status as "passed" | "failed" | "blocked",
						evidence: result.evidence,
					});
					if (result.evidencePath && !evidencePaths.includes(result.evidencePath))
						evidencePaths.push(result.evidencePath);
					if (result.status !== "passed") {
						if (step.required) {
							return {
								scenario_id: scenario.id,
								status: result.status as "failed" | "blocked",
								executed_steps,
								evidence_paths: [...evidencePaths],
								failure_summary_zh: result.evidence,
							};
						}
					}
				}
			}
			return { scenario_id: scenario.id, status: "passed", executed_steps, evidence_paths: evidencePaths };
		},

		async cleanup(environment: RuntimeEnvironmentPlan): Promise<RuntimeCleanupResult> {
			const environmentType = environment.type ?? environment.environment_type;
			if (environmentType === "docker" && options.enableDocker !== true) {
				return {
					status: "blocked",
					report_path: "runtime-cleanup-report.md",
					residuals: ["docker runtime is not enabled"],
				};
			}
			if (environmentType === "sandbox" && options.enableSandbox !== true) {
				return {
					status: "blocked",
					report_path: "runtime-cleanup-report.md",
					residuals: ["sandbox runtime is not enabled"],
				};
			}
			const residuals: string[] = [];
			for (const cmd of environment.cleanup_commands) {
				const result = await runCommand(cmd, options);
				if (result.exitCode !== 0) residuals.push(result.output);
			}
			return {
				status: residuals.length === 0 ? ("passed" as const) : ("failed" as const),
				report_path: "runtime-cleanup-report.md",
				residuals,
			};
		},
	};
}
