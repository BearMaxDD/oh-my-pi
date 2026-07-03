import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createDefaultRuntimeSimulationRunner } from "../../src/codex-plan-run/default-runtime-runner";
import type { BusinessSimulationScenario, RuntimeEnvironmentPlan } from "../../src/codex-plan-run/runtime-scenarios";

const tempDirs: string[] = [];
async function makeTempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "omp-default-runtime-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

function minimalEnv(
	overrides: Partial<RuntimeEnvironmentPlan> & Pick<RuntimeEnvironmentPlan, "type">,
): RuntimeEnvironmentPlan {
	return {
		schema_version: "superpowers.runtime_environment_plan.v1",
		run_id: "test-run",
		environment_type: overrides.type,
		startup_commands: [],
		health_checks: [],
		required_env_vars: [],
		forbidden_targets: [],
		cleanup_commands: [],
		safety_notes_zh: [],
		...overrides,
	} as RuntimeEnvironmentPlan;
}

function cliScenario(id: string, command: string, expected: string): BusinessSimulationScenario {
	return {
		id,
		title_zh: "CLI test",
		source_requirement: "",
		actor: "developer",
		preconditions: [],
		steps: [
			{
				id: `${id}-step`,
				kind: "cli",
				title_zh: "Run command",
				timeout_ms: 5000,
				expected,
				required: true,
				cwd: ".",
				command,
				expected_exit_code: 0,
				expected_output_contains: expected,
				redacts: [],
			},
		],
		expected_results: [],
		evidence_required: [],
	};
}

describe("default runtime simulation runner", () => {
	it("runs startup, scenario command, log check, and cleanup with secret redaction", async () => {
		const cwd = await makeTempDir();
		const logPath = join(cwd, "runtime.log");
		await writeFile(logPath, "ready token=secret-value\n", "utf8");
		const runner = createDefaultRuntimeSimulationRunner({ cwd, timeoutMs: 2000, redactValues: ["secret-value"] });

		const start = await runner.start(
			minimalEnv({
				type: "local",
				startup_commands: [{ cwd, command: "printf 'started token=secret-value'", timeout_ms: 2000 }],
				health_checks: [
					{
						title_zh: "Check ready log",
						command: { cwd, command: `grep -q "ready" "${logPath}"`, timeout_ms: 2000 },
						expected_exit_code: 0,
					},
				],
			}),
		);
		const scenario = await runner.executeScenario(
			cliScenario("cli-path", "printf 'scenario token=secret-value'", "scenario"),
		);
		const cleanup = await runner.cleanup(
			minimalEnv({
				type: "local",
				cleanup_commands: [{ cwd, command: "printf cleanup", timeout_ms: 2000 }],
			}),
		);

		expect(start.status).toBe("passed");
		expect(scenario.status).toBe("passed");
		expect(cleanup.status).toBe("passed");
		expect(JSON.stringify(start)).not.toContain("secret-value");
		expect(JSON.stringify(scenario)).not.toContain("secret-value");
	});

	it("classifies missing command capability as blocked", async () => {
		const cwd = await makeTempDir();
		const runner = createDefaultRuntimeSimulationRunner({ cwd, timeoutMs: 50 });
		const start = await runner.start(
			minimalEnv({
				type: "docker",
				startup_commands: [{ cwd, command: "docker compose up", timeout_ms: 50 }],
			}),
		);

		expect(start.status).toBe("blocked");
		expect(start.failure_summary_zh).toContain("docker runtime is not enabled");
	});

	it("returns blocked for sandbox when not enabled", async () => {
		const runner = createDefaultRuntimeSimulationRunner({ cwd: await makeTempDir(), timeoutMs: 50 });
		const start = await runner.start(
			minimalEnv({
				type: "sandbox",
			}),
		);

		expect(start.status).toBe("blocked");
		expect(start.failure_summary_zh).toContain("sandbox runtime is not enabled");
	});

	it("fails startup when a command exits non-zero", async () => {
		const cwd = await makeTempDir();
		const runner = createDefaultRuntimeSimulationRunner({ cwd, timeoutMs: 2000 });
		const start = await runner.start(
			minimalEnv({
				type: "local",
				startup_commands: [{ cwd, command: "exit 1", timeout_ms: 2000 }],
			}),
		);

		expect(start.status).toBe("failed");
	});

	it("fails health check when expected exit code mismatches", async () => {
		const cwd = await makeTempDir();
		const runner = createDefaultRuntimeSimulationRunner({ cwd, timeoutMs: 2000 });
		const start = await runner.start(
			minimalEnv({
				type: "local",
				health_checks: [
					{
						title_zh: "Always fail",
						command: { cwd, command: "exit 1", timeout_ms: 2000 },
						expected_exit_code: 0,
					},
				],
			}),
		);

		expect(start.status).toBe("failed");
	});

	it("reports timeout when command exceeds timeoutMs", async () => {
		const cwd = await makeTempDir();
		const runner = createDefaultRuntimeSimulationRunner({ cwd, timeoutMs: 50 });
		const start = await runner.start(
			minimalEnv({
				type: "local",
				startup_commands: [{ cwd, command: "sleep 10", timeout_ms: 50 }],
			}),
		);

		expect(start.status).toBe("failed");
		expect(JSON.stringify(start)).toContain("TIMEOUT");
	});

	it("honors new-style scenario steps and step timeout", async () => {
		const cwd = await makeTempDir();
		const logPath = join(cwd, "new-style.log");
		await writeFile(logPath, "ready\n", "utf8");
		const runner = createDefaultRuntimeSimulationRunner({ cwd, timeoutMs: 2000 });
		const result = await runner.executeScenario({
			id: "new-style",
			title_zh: "New style",
			source_requirement: "",
			actor: "developer",
			preconditions: [],
			steps: [
				{
					id: "step-1",
					kind: "cli",
					title_zh: "CLI step",
					timeout_ms: 500,
					expected: "ok",
					required: true,
					cwd,
					command: "printf ok",
					expected_exit_code: 0,
					expected_output_contains: "ok",
					redacts: [],
				},
				{
					id: "step-2",
					kind: "log_check",
					title_zh: "Log check",
					timeout_ms: 500,
					expected: "ready",
					required: true,
					path: logPath,
					contains: "ready",
				},
			],
			expected_results: [],
			evidence_required: [],
		});

		expect(result.status).toBe("passed");
	});

	it("returns promptly when a command ignores SIGTERM", async () => {
		const cwd = await makeTempDir();
		const runner = createDefaultRuntimeSimulationRunner({ cwd, timeoutMs: 50 });
		const started = Date.now();
		const start = await runner.start(
			minimalEnv({
				environment_type: "local",
				type: "local",
				startup_commands: [{ cwd, command: "trap '' TERM; sleep 10", timeout_ms: 50 }],
			}),
		);

		expect(start.status).toBe("failed");
		expect(Date.now() - started).toBeLessThan(1000);
	});

	it("fails scenario step when cli command exit code is non-zero", async () => {
		const cwd = await makeTempDir();
		const runner = createDefaultRuntimeSimulationRunner({ cwd, timeoutMs: 2000 });
		const result = await runner.executeScenario(cliScenario("fail-step", "exit 1", "anything"));
		expect(result.status).toBe("failed");
		expect(result.executed_steps[0].status).toBe("failed");
	});

	it("fails scenario step when cli output does not contain expected text", async () => {
		const cwd = await makeTempDir();
		const runner = createDefaultRuntimeSimulationRunner({ cwd, timeoutMs: 2000 });
		const result = await runner.executeScenario(cliScenario("mismatch", "printf wrong", "expected-text"));
		expect(result.status).toBe("failed");
	});

	it("fails scenario log_check step when file does not contain expected text", async () => {
		const cwd = await makeTempDir();
		const logPath = join(cwd, "test.log");
		await writeFile(logPath, "some content\n", "utf8");
		const runner = createDefaultRuntimeSimulationRunner({ cwd, timeoutMs: 2000 });
		const result = await runner.executeScenario({
			id: "log-check",
			title_zh: "Log check",
			source_requirement: "",
			actor: "developer",
			preconditions: [],
			steps: [
				{
					id: "log-step",
					kind: "log_check",
					title_zh: "Check log",
					timeout_ms: 2000,
					expected: "missing-text",
					required: true,
					path: logPath,
					contains: "missing-text",
				},
			],
			expected_results: [],
			evidence_required: [],
		});
		expect(result.status).toBe("failed");
	});

	it("redacts secrets from health check log reading and scenario output", async () => {
		const cwd = await makeTempDir();
		const logPath = join(cwd, "secrets.log");
		await writeFile(logPath, "password=mysecret\n", "utf8");
		const runner = createDefaultRuntimeSimulationRunner({ cwd, timeoutMs: 2000, redactValues: ["mysecret"] });
		const start = await runner.start(
			minimalEnv({
				type: "local",
				health_checks: [
					{
						title_zh: "Check log",
						command: { cwd, command: `grep -q "password" "${logPath}"`, timeout_ms: 2000 },
						expected_exit_code: 0,
					},
				],
			}),
		);
		expect(start.status).toBe("passed");
		expect(JSON.stringify(start)).not.toContain("mysecret");
	});

	it("enables docker when enableDocker is set", async () => {
		const cwd = await makeTempDir();
		const runner = createDefaultRuntimeSimulationRunner({ cwd, timeoutMs: 2000, enableDocker: true });
		const start = await runner.start(
			minimalEnv({
				type: "docker",
				startup_commands: [{ cwd, command: "printf 'docker allowed'", timeout_ms: 2000 }],
			}),
		);
		// If docker is enabled, startup should proceed (command is run, not docker compose up)
		expect(start.status).toBe("passed");
	});

	it("passes scenario on matching cli output", async () => {
		const cwd = await makeTempDir();
		const runner = createDefaultRuntimeSimulationRunner({ cwd, timeoutMs: 2000 });
		const result = await runner.executeScenario(cliScenario("match", "printf hello", "hello"));
		expect(result.status).toBe("passed");
	});

	it("passes cleanup when commands succeed", async () => {
		const cwd = await makeTempDir();
		const runner = createDefaultRuntimeSimulationRunner({ cwd, timeoutMs: 2000 });
		const result = await runner.cleanup(
			minimalEnv({
				type: "local",
				cleanup_commands: [{ cwd, command: "printf ok", timeout_ms: 2000 }],
			}),
		);
		expect(result.status).toBe("passed");
	});

	it("reports cleanup failure when commands fail", async () => {
		const cwd = await makeTempDir();
		const runner = createDefaultRuntimeSimulationRunner({ cwd, timeoutMs: 2000 });
		const result = await runner.cleanup(
			minimalEnv({
				type: "local",
				cleanup_commands: [{ cwd, command: "exit 1", timeout_ms: 2000 }],
			}),
		);
		expect(result.status).toBe("failed");
	});

	it("blocks scenario when required browser/api/database steps have no executor", async () => {
		const cwd = await makeTempDir();
		const runner = createDefaultRuntimeSimulationRunner({ cwd, timeoutMs: 2000 });
		const result = await runner.executeScenario({
			id: "blocked-unsupported",
			title_zh: "Unsupported step kinds",
			source_requirement: "",
			actor: "developer",
			preconditions: [],
			steps: [
				{
					id: "browse",
					kind: "browser",
					title_zh: "Open page",
					timeout_ms: 5000,
					expected: "page loaded",
					required: true,
					url: "https://example.com",
					action: "navigate",
					text: "",
					selector: "",
					expected_url: "",
					expected_text: "",
				},
				{
					id: "api-call",
					kind: "api",
					title_zh: "Call endpoint",
					timeout_ms: 5000,
					expected: "200 OK",
					required: true,
					method: "GET",
					url: "https://api.example.com",
					expected_status: 200,
				},
				{
					id: "db-query",
					kind: "database",
					title_zh: "Run query",
					timeout_ms: 5000,
					expected: "query results",
					required: true,
					connection_ref: "postgres://localhost:5432",
					read_only: true as const,
					query: "SELECT 1",
				},
			],
			expected_results: [],
			evidence_required: [],
		});
		expect(result.status).toBe("blocked");
		expect(result.executed_steps).toHaveLength(1);
		expect(result.executed_steps[0].index).toBe(0);
		expect(result.executed_steps[0].status).toBe("blocked");
		expect(result.executed_steps[0].evidence).toContain("runtime_step_kind_not_configured:browser");
	});

	it("does not block scenario for optional unsupported step when subsequent required steps pass", async () => {
		const cwd = await makeTempDir();
		const runner = createDefaultRuntimeSimulationRunner({ cwd, timeoutMs: 2000 });
		const result = await runner.executeScenario({
			id: "optional-unsupported",
			title_zh: "Optional browser then CLI",
			source_requirement: "",
			actor: "developer",
			preconditions: [],
			steps: [
				{
					id: "opt-browse",
					kind: "browser",
					title_zh: "Optional browser",
					timeout_ms: 5000,
					expected: "page",
					required: false,
					url: "https://example.com",
					action: "navigate",
					text: "",
					selector: "",
					expected_url: "",
					expected_text: "",
				},
				{
					id: "cli-pass",
					kind: "cli",
					title_zh: "CLI step",
					timeout_ms: 2000,
					expected: "ok",
					required: true,
					cwd,
					command: "printf ok",
					expected_exit_code: 0,
					expected_output_contains: "ok",
					redacts: [],
				},
			],
			expected_results: [],
			evidence_required: [],
		});
		expect(result.status).toBe("passed");
		expect(result.executed_steps).toHaveLength(2);
		expect(result.executed_steps[0].status).toBe("blocked");
		expect(result.executed_steps[0].evidence).toContain("runtime_step_kind_not_configured:browser");
		expect(result.executed_steps[1].status).toBe("passed");
		expect(result.executed_steps[1].evidence).toContain("ok");
	});

	it("allows cleanup to succeed after a blocked scenario", async () => {
		const cwd = await makeTempDir();
		const runner = createDefaultRuntimeSimulationRunner({ cwd, timeoutMs: 2000 });
		// Execute a scenario that blocks due to required unsupported step
		const scenario = await runner.executeScenario({
			id: "block-then-cleanup",
			title_zh: "Blocked scenario",
			source_requirement: "",
			actor: "developer",
			preconditions: [],
			steps: [
				{
					id: "db-block",
					kind: "database",
					title_zh: "DB query",
					timeout_ms: 5000,
					expected: "data",
					required: true,
					connection_ref: "postgres://localhost:5432",
					read_only: true as const,
					query: "SELECT 1",
				},
			],
			expected_results: [],
			evidence_required: [],
		});
		expect(scenario.status).toBe("blocked");

		// Cleanup must remain independently callable and succeed
		const cleanup = await runner.cleanup(
			minimalEnv({
				type: "local",
				cleanup_commands: [{ cwd, command: "printf cleanup-ok", timeout_ms: 2000 }],
			}),
		);
		expect(cleanup.status).toBe("passed");
	});
	it("blocks required api/browser/database step when disabled by runtimeScenario setting", async () => {
		const cwd = await makeTempDir();
		const runner = createDefaultRuntimeSimulationRunner({
			cwd,
			timeoutMs: 2000,
			runtimeScenario: { api: { enabled: false } },
		});
		const result = await runner.executeScenario({
			id: "disabled-by-settings",
			title_zh: "Disabled by settings",
			source_requirement: "",
			actor: "developer",
			preconditions: [],
			steps: [
				{
					id: "api-disabled",
					kind: "api",
					title_zh: "Disabled API",
					timeout_ms: 5000,
					expected: "should block",
					required: true,
					method: "GET",
					url: "http://localhost:3000/api/test",
					expected_status: 200,
				},
			],
			expected_results: [],
			evidence_required: [],
		});
		expect(result.status).toBe("blocked");
		expect(result.executed_steps[0].evidence).toBe("runtime_step_kind_disabled_by_settings:api");
	});

	it("blocks browser step when disabled by runtimeScenario setting", async () => {
		const cwd = await makeTempDir();
		const runner = createDefaultRuntimeSimulationRunner({
			cwd,
			timeoutMs: 2000,
			runtimeScenario: { browser: { enabled: false } },
		});
		const result = await runner.executeScenario({
			id: "browser-disabled",
			title_zh: "Browser disabled",
			source_requirement: "",
			actor: "developer",
			preconditions: [],
			steps: [
				{
					id: "browse",
					kind: "browser",
					title_zh: "Open page",
					timeout_ms: 5000,
					expected: "page loaded",
					required: true,
					url: "https://example.com",
					action: "navigate",
					text: "",
					selector: "",
					expected_url: "",
					expected_text: "",
				},
			],
			expected_results: [],
			evidence_required: [],
		});
		expect(result.status).toBe("blocked");
		expect(result.executed_steps[0].evidence).toBe("runtime_step_kind_disabled_by_settings:browser");
	});

	it("blocks database step when disabled by runtimeScenario setting", async () => {
		const cwd = await makeTempDir();
		const runner = createDefaultRuntimeSimulationRunner({
			cwd,
			timeoutMs: 2000,
			runtimeScenario: { database: { enabled: false } },
		});
		const result = await runner.executeScenario({
			id: "db-disabled",
			title_zh: "DB disabled",
			source_requirement: "",
			actor: "developer",
			preconditions: [],
			steps: [
				{
					id: "db-query",
					kind: "database",
					title_zh: "Run query",
					timeout_ms: 5000,
					expected: "query results",
					required: true,
					connection_ref: "postgres://localhost:5432",
					read_only: true as const,
					query: "SELECT 1",
				},
			],
			expected_results: [],
			evidence_required: [],
		});
		expect(result.status).toBe("blocked");
		expect(result.executed_steps[0].evidence).toBe("runtime_step_kind_disabled_by_settings:database");
	});

	it("does not block disabled optional step when later required steps pass", async () => {
		const cwd = await makeTempDir();
		const runner = createDefaultRuntimeSimulationRunner({
			cwd,
			timeoutMs: 2000,
			runtimeScenario: { api: { enabled: false } },
		});
		const result = await runner.executeScenario({
			id: "optional-disabled-then-cli",
			title_zh: "Optional disabled then cli",
			source_requirement: "",
			actor: "developer",
			preconditions: [],
			steps: [
				{
					id: "opt-api",
					kind: "api",
					title_zh: "Optional API",
					timeout_ms: 5000,
					expected: "optional",
					required: false,
					method: "GET",
					url: "http://localhost:3000/api/test",
					expected_status: 200,
				},
				{
					id: "cli-pass",
					kind: "cli",
					title_zh: "CLI step",
					timeout_ms: 2000,
					expected: "ok",
					required: true,
					cwd,
					command: "printf ok",
					expected_exit_code: 0,
					expected_output_contains: "ok",
					redacts: [],
				},
			],
			expected_results: [],
			evidence_required: [],
		});
		expect(result.status).toBe("passed");
		expect(result.executed_steps[0].status).toBe("blocked");
		expect(result.executed_steps[0].evidence).toBe("runtime_step_kind_disabled_by_settings:api");
		expect(result.executed_steps[1].status).toBe("passed");
	});

	it("delegates api step to injected executor when enabled and configured", async () => {
		const cwd = await makeTempDir();
		const executor = {
			async execute(_step: any) {
				return { status: "passed" as const, evidence: "api executor passed", parsedBody: undefined };
			},
		};
		const runner = createDefaultRuntimeSimulationRunner({
			cwd,
			timeoutMs: 2000,
			runtimeScenario: { api: { enabled: true } },
			apiExecutor: executor,
		});
		const result = await runner.executeScenario({
			id: "api-executor-pass",
			title_zh: "API executor pass",
			source_requirement: "",
			actor: "developer",
			preconditions: [],
			steps: [
				{
					id: "api-pass",
					kind: "api",
					title_zh: "API pass",
					timeout_ms: 5000,
					expected: "pass",
					required: true,
					method: "GET",
					url: "http://localhost:3000/test",
					expected_status: 200,
				},
			],
			expected_results: [],
			evidence_required: [],
		});
		expect(result.status).toBe("passed");
		expect(result.executed_steps[0].status).toBe("passed");
		expect(result.executed_steps[0].evidence).toBe("api executor passed");
	});

	it("delegates browser step to injected executor when enabled and configured", async () => {
		const cwd = await makeTempDir();
		const executor = {
			async execute(_step: any) {
				return { status: "passed" as const, evidence: "browser executor passed" };
			},
		};
		const runner = createDefaultRuntimeSimulationRunner({
			cwd,
			timeoutMs: 2000,
			runtimeScenario: { browser: { enabled: true } },
			browserExecutor: executor,
		});
		const result = await runner.executeScenario({
			id: "browser-executor-pass",
			title_zh: "Browser executor pass",
			source_requirement: "",
			actor: "developer",
			preconditions: [],
			steps: [
				{
					id: "browse",
					kind: "browser",
					title_zh: "Open page",
					timeout_ms: 5000,
					expected: "page loaded",
					required: true,
					url: "https://example.com",
					action: "navigate",
					text: "",
					selector: "",
					expected_url: "",
					expected_text: "",
				},
			],
			expected_results: [],
			evidence_required: [],
		});
		expect(result.status).toBe("passed");
		expect(result.executed_steps[0].status).toBe("passed");
		expect(result.executed_steps[0].evidence).toBe("browser executor passed");
	});

	it("delegates database step to injected executor when enabled and configured", async () => {
		const cwd = await makeTempDir();
		const executor = {
			async execute(_step: any) {
				return { status: "passed" as const, evidence: "database executor passed" };
			},
		};
		const runner = createDefaultRuntimeSimulationRunner({
			cwd,
			timeoutMs: 2000,
			runtimeScenario: { database: { enabled: true } },
			databaseExecutor: executor,
		});
		const result = await runner.executeScenario({
			id: "db-executor-pass",
			title_zh: "DB executor pass",
			source_requirement: "",
			actor: "developer",
			preconditions: [],
			steps: [
				{
					id: "db-query",
					kind: "database",
					title_zh: "Run query",
					timeout_ms: 5000,
					expected: "query results",
					required: true,
					connection_ref: "postgres://localhost:5432",
					read_only: true as const,
					query: "SELECT 1",
				},
			],
			expected_results: [],
			evidence_required: [],
		});
		expect(result.status).toBe("passed");
		expect(result.executed_steps[0].status).toBe("passed");
		expect(result.executed_steps[0].evidence).toBe("database executor passed");
	});

	it("fails required step when injected executor returns failed", async () => {
		const cwd = await makeTempDir();
		const executor = {
			async execute(_step: any) {
				return { status: "failed" as const, evidence: "api executor failed" };
			},
		};
		const runner = createDefaultRuntimeSimulationRunner({
			cwd,
			timeoutMs: 2000,
			runtimeScenario: { api: { enabled: true } },
			apiExecutor: executor,
		});
		const result = await runner.executeScenario({
			id: "api-executor-fail",
			title_zh: "API executor fail",
			source_requirement: "",
			actor: "developer",
			preconditions: [],
			steps: [
				{
					id: "api-fail",
					kind: "api",
					title_zh: "API fail",
					timeout_ms: 5000,
					expected: "fail",
					required: true,
					method: "GET",
					url: "http://localhost:3000/test",
					expected_status: 200,
				},
			],
			expected_results: [],
			evidence_required: [],
		});
		expect(result.status).toBe("failed");
		expect(result.executed_steps[0].status).toBe("failed");
	});

	it("still blocks not-configured step when runtimeScenario is set but executor is missing", async () => {
		const cwd = await makeTempDir();
		const runner = createDefaultRuntimeSimulationRunner({
			cwd,
			timeoutMs: 2000,
			runtimeScenario: { browser: { enabled: true } },
			// no browserExecutor
		});
		const result = await runner.executeScenario({
			id: "configured-no-executor",
			title_zh: "Enabled but no executor",
			source_requirement: "",
			actor: "developer",
			preconditions: [],
			steps: [
				{
					id: "browse-no-exec",
					kind: "browser",
					title_zh: "Browser no executor",
					timeout_ms: 5000,
					expected: "block",
					required: true,
					url: "https://example.com",
					action: "navigate",
					text: "",
					selector: "",
					expected_url: "",
					expected_text: "",
				},
			],
			expected_results: [],
			evidence_required: [],
		});
		expect(result.status).toBe("blocked");
		expect(result.executed_steps[0].evidence).toBe("runtime_step_kind_not_configured:browser");
	});

	it("backward compatible: no runtimeScenario setting falls through to not-configured", async () => {
		const cwd = await makeTempDir();
		const runner = createDefaultRuntimeSimulationRunner({ cwd, timeoutMs: 2000 });
		const result = await runner.executeScenario({
			id: "backward-compat",
			title_zh: "Backward compat",
			source_requirement: "",
			actor: "developer",
			preconditions: [],
			steps: [
				{
					id: "api-old",
					kind: "api",
					title_zh: "Old API",
					timeout_ms: 5000,
					expected: "block",
					required: true,
					method: "GET",
					url: "http://localhost:3000/test",
					expected_status: 200,
				},
			],
			expected_results: [],
			evidence_required: [],
		});
		expect(result.status).toBe("blocked");
		expect(result.executed_steps[0].evidence).toBe("runtime_step_kind_not_configured:api");
	});

	it("default api executor when enabled and no explicit apiExecutor", async () => {
		const cwd = await makeTempDir();
		const runner = createDefaultRuntimeSimulationRunner({
			cwd,
			timeoutMs: 2000,
			runtimeScenario: { api: { enabled: true } },
			// no apiExecutor
		});
		const result = await runner.executeScenario({
			id: "default-api-executor",
			title_zh: "Default API executor",
			source_requirement: "",
			actor: "developer",
			preconditions: [],
			steps: [
				{
					id: "api-step",
					kind: "api",
					title_zh: "Default API",
					timeout_ms: 5000,
					expected: "blocked for production",
					required: true,
					method: "GET",
					url: "https://api.example.com/data",
					expected_status: 200,
				},
			],
			expected_results: [],
			evidence_required: [],
		});
		// Should NOT be "not_configured" — the default executor handles it
		expect(result.status).toBe("blocked");
		expect(result.executed_steps[0].evidence).not.toContain("not_configured");
		expect(result.executed_steps[0].evidence).toContain("production-like url blocked");
	});

	it("database step blocks when query fails read-only validation before delegation", async () => {
		const cwd = await makeTempDir();
		const executor = {
			async execute(_step: any) {
				return { status: "passed" as const, evidence: "should not reach" };
			},
		};
		const runner = createDefaultRuntimeSimulationRunner({
			cwd,
			timeoutMs: 2000,
			runtimeScenario: { database: { enabled: true } },
			databaseExecutor: executor,
		});
		const result = await runner.executeScenario({
			id: "db-readonly-violation",
			title_zh: "DB read-only violation",
			source_requirement: "",
			actor: "developer",
			preconditions: [],
			steps: [
				{
					id: "db-violation",
					kind: "database",
					title_zh: "DB violation",
					timeout_ms: 5000,
					expected: "should block",
					required: true,
					connection_ref: "postgres://localhost:5432",
					read_only: true as const,
					query: "INSERT INTO users VALUES (1)",
				},
			],
			expected_results: [],
			evidence_required: [],
		});
		expect(result.status).toBe("blocked");
		expect(result.executed_steps[0].evidence).toContain("read-only sql violation");
	});

	it("database step blocks SHOW TABLES query via read-only validation before delegation", async () => {
		const cwd = await makeTempDir();
		const executor = {
			async execute(_step: any) {
				return { status: "passed" as const, evidence: "should not reach" };
			},
		};
		const runner = createDefaultRuntimeSimulationRunner({
			cwd,
			timeoutMs: 2000,
			runtimeScenario: { database: { enabled: true } },
			databaseExecutor: executor,
		});
		const result = await runner.executeScenario({
			id: "db-show-tables",
			title_zh: "DB SHOW TABLES",
			source_requirement: "",
			actor: "developer",
			preconditions: [],
			steps: [
				{
					id: "db-show",
					kind: "database",
					title_zh: "SHOW TABLES",
					timeout_ms: 5000,
					expected: "should block",
					required: true,
					connection_ref: "postgres://localhost:5432",
					read_only: true as const,
					query: "SHOW TABLES",
				},
			],
			expected_results: [],
			evidence_required: [],
		});
		expect(result.status).toBe("blocked");
		expect(result.executed_steps[0].evidence).toContain("read-only sql violation");
	});

	it("database step blocks multi-statement query with read-only validation", async () => {
		const cwd = await makeTempDir();
		const executor = {
			async execute(_step: any) {
				return { status: "passed" as const, evidence: "should not reach" };
			},
		};
		const runner = createDefaultRuntimeSimulationRunner({
			cwd,
			timeoutMs: 2000,
			runtimeScenario: { database: { enabled: true } },
			databaseExecutor: executor,
		});
		const result = await runner.executeScenario({
			id: "db-multi-stmt",
			title_zh: "DB multi-statement",
			source_requirement: "",
			actor: "developer",
			preconditions: [],
			steps: [
				{
					id: "db-multi",
					kind: "database",
					title_zh: "Multi-statement",
					timeout_ms: 5000,
					expected: "should block",
					required: true,
					connection_ref: "postgres://localhost:5432",
					read_only: true as const,
					query: "SELECT 1; SELECT 2",
				},
			],
			expected_results: [],
			evidence_required: [],
		});
		expect(result.status).toBe("blocked");
		expect(result.executed_steps[0].evidence).toContain("read-only sql violation");
	});

	it("propagates step evidence_path and executor evidencePath on success", async () => {
		const cwd = await makeTempDir();
		const executor = {
			async execute(_step: any) {
				return { status: "passed" as const, evidence: "exec ok", evidencePath: "/tmp/executor-evidence.json" };
			},
		};
		const runner = createDefaultRuntimeSimulationRunner({
			cwd,
			timeoutMs: 2000,
			runtimeScenario: { database: { enabled: true } },
			databaseExecutor: executor,
		});
		const result = await runner.executeScenario({
			id: "evidence-propagation",
			title_zh: "Evidence propagation",
			source_requirement: "",
			actor: "developer",
			preconditions: [],
			steps: [
				{
					id: "db-evidence",
					kind: "database",
					title_zh: "DB evidence",
					timeout_ms: 5000,
					expected: "pass",
					required: true,
					connection_ref: "postgres://localhost:5432",
					read_only: true as const,
					query: "SELECT 1",
					evidence_path: "/tmp/step-evidence.json",
				},
			],
			expected_results: [],
			evidence_required: [],
		});
		expect(result.status).toBe("passed");
		expect(result.evidence_paths).toContain("/tmp/step-evidence.json");
		expect(result.evidence_paths).toContain("/tmp/executor-evidence.json");
	});

	it("deduplicates evidence paths when step.evidence_path and executor evidencePath are the same", async () => {
		const cwd = await makeTempDir();
		const executor = {
			async execute(_step: any) {
				return { status: "passed" as const, evidence: "exec ok", evidencePath: "/tmp/shared-evidence.json" };
			},
		};
		const runner = createDefaultRuntimeSimulationRunner({
			cwd,
			timeoutMs: 2000,
			runtimeScenario: { database: { enabled: true } },
			databaseExecutor: executor,
		});
		const result = await runner.executeScenario({
			id: "evidence-dedup",
			title_zh: "Evidence dedup",
			source_requirement: "",
			actor: "developer",
			preconditions: [],
			steps: [
				{
					id: "db-dedup",
					kind: "database",
					title_zh: "DB dedup",
					timeout_ms: 5000,
					expected: "pass",
					required: true,
					connection_ref: "postgres://localhost:5432",
					read_only: true as const,
					query: "SELECT 1",
					evidence_path: "/tmp/shared-evidence.json",
				},
			],
			expected_results: [],
			evidence_required: [],
		});
		expect(result.status).toBe("passed");
		// The same path should appear exactly once, not twice
		expect(result.evidence_paths).toEqual(["/tmp/shared-evidence.json"]);
	});

	it("propagates step evidence_path on executor failure", async () => {
		const cwd = await makeTempDir();
		const executor = {
			async execute(_step: any) {
				return { status: "failed" as const, evidence: "exec failed" };
			},
		};
		const runner = createDefaultRuntimeSimulationRunner({
			cwd,
			timeoutMs: 2000,
			runtimeScenario: { api: { enabled: true } },
			apiExecutor: executor,
		});
		const result = await runner.executeScenario({
			id: "evidence-failure",
			title_zh: "Evidence on failure",
			source_requirement: "",
			actor: "developer",
			preconditions: [],
			steps: [
				{
					id: "api-fail-evidence",
					kind: "api",
					title_zh: "API fail evidence",
					timeout_ms: 5000,
					expected: "fail",
					required: true,
					method: "GET",
					url: "http://localhost:3000/test",
					expected_status: 200,
					evidence_path: "/tmp/fail-evidence.json",
				},
			],
			expected_results: [],
			evidence_required: [],
		});
		expect(result.status).toBe("failed");
		expect(result.evidence_paths).toContain("/tmp/fail-evidence.json");
	});
});
