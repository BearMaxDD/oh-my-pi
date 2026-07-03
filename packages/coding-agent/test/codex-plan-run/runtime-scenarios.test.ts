import { describe, expect, it } from "bun:test";
import type { RuntimeScenarioStep, RuntimeScenarioStepKind } from "../../src/codex-plan-run/runtime-scenarios";
import {
	buildBusinessSimulationScenarios,
	renderRuntimeScenarioStep,
} from "../../src/codex-plan-run/runtime-scenarios";
import type { BusinessPathRef } from "../../src/codex-plan-run/spec-task-framework";

/**
 * RED tests for Task 2 — Runtime Scenario Schema and Synthesis.
 *
 * These tests assert behaviour that the GREEN phase must implement:
 * 1. No placeholder command in generated scenarios.
 * 2. Parsing a rich user_story produces all five step kinds,
 *    each with complete metadata.
 * 3. renderRuntimeScenarioStep() renders API steps legibly.
 */

function apiBusinessPath(overrides?: Partial<BusinessPathRef>): BusinessPathRef {
	return {
		id: "fullstack-checkout",
		title_zh: "全栈结账流程",
		user_story:
			"用户通过 browser 访问结账页面，调用 API 验证库存，查询 database 确认地址，运行 CLI 执行同步，检查 logs 确认成功",
		runtime_required: true,
		suggested_environment: "local",
		...overrides,
	};
}

describe("runtime scenario schema and synthesis", () => {
	it("builds meaningful CLI commands for generated scenarios", () => {
		const scenarios = buildBusinessSimulationScenarios({
			businessPaths: [apiBusinessPath()],
		});

		expect(scenarios.length).toBeGreaterThan(0);
		let cliStepCount = 0;
		for (const scenario of scenarios) {
			for (const step of scenario.steps) {
				if ("command" in step && typeof step.command === "string") {
					cliStepCount++;
					// Command must be a non-empty, meaningful shell command
					expect(step.command.length).toBeGreaterThan(0);
					// Must contain a recognized command prefix
					expect(step.command).toMatch(/^(printf|curl|bun|node|npm|git|cat|echo|ls|cd|mkdir|rm|touch)/);
					// Must not contain stale placeholder text
					expect(step.command).not.toContain("role-bound evidence generated");
					// Must have evidence-producing output
					expect(step).toHaveProperty("expected");
					expect(step).toHaveProperty("expected_exit_code");
					expect(step).toHaveProperty("expected_output_contains");
					expect(step.expected_output_contains).toBeTruthy();
				}
			}
		}
		// At least one CLI step should be present
		expect(cliStepCount).toBeGreaterThan(0);
	});

	it("generates all five scenario step kinds from a rich user_story", () => {
		const scenarios = buildBusinessSimulationScenarios({
			businessPaths: [apiBusinessPath()],
		});

		expect(scenarios.length).toBeGreaterThan(0);

		const steps = scenarios[0].steps;
		const kinds = steps.map(s => s.kind);
		const expectedKinds: RuntimeScenarioStepKind[] = ["browser", "api", "cli", "database", "log_check"];
		expect([...kinds].sort()).toEqual([...expectedKinds].sort());

		for (const step of steps) {
			expect(step).toHaveProperty("id");
			expect(step).toHaveProperty("kind");
			expect(step).toHaveProperty("title_zh");
			expect(step).toHaveProperty("timeout_ms");
			expect(step).toHaveProperty("expected");
			expect(step).toHaveProperty("required");
		}
	});

	it("renderRuntimeScenarioStep renders an API step with method, target, expected, and evidence", () => {
		const apiStep: RuntimeScenarioStep = {
			kind: "api",
			id: "api-checkout",
			title_zh: "提交结账请求",
			timeout_ms: 30000,
			required: true,
			method: "POST",
			url: "/api/checkout",
			expected: "状态码 201，返回 order_id",
			expected_status: 201,
		};

		const rendered = renderRuntimeScenarioStep(apiStep);

		expect(rendered).toContain("api");
		expect(rendered).toContain("POST");
		expect(rendered).toContain("/api/checkout");
		expect(rendered).toContain("状态码 201");
		expect(rendered).toContain("order_id");
		expect(rendered).toContain("role-bound evidence");
	});
});

describe("runtimeScenario integration", () => {
	it("disables browser, api, and database steps when runtimeScenario disables them", () => {
		const scenarios = buildBusinessSimulationScenarios({
			businessPaths: [apiBusinessPath()],
			runtimeScenario: {
				browser: { enabled: false },
				api: { enabled: false },
				database: { enabled: false },
			},
		});

		expect(scenarios.length).toBeGreaterThan(0);
		const steps = scenarios[0].steps;
		for (const step of steps) {
			expect(step.kind).not.toBe("browser");
			expect(step.kind).not.toBe("api");
			expect(step.kind).not.toBe("database");
		}
		const kinds = steps.map(s => s.kind);
		expect(kinds).toContain("cli");
		expect(kinds).toContain("log_check");
	});

	it("falls back to cli step when disabling all inferred non-cli kinds removes everything", () => {
		const scenarios = buildBusinessSimulationScenarios({
			businessPaths: [
				{
					id: "api-only",
					title_zh: "纯接口路径",
					user_story: "Use the browser page to call the API endpoint and run a database query",
					runtime_required: true,
					suggested_environment: "local",
				},
			],
			runtimeScenario: {
				browser: { enabled: false },
				api: { enabled: false },
				database: { enabled: false },
			},
		});

		expect(scenarios.length).toBeGreaterThan(0);
		const steps = scenarios[0].steps;
		expect(steps.length).toBeGreaterThanOrEqual(1);
		for (const step of steps) {
			expect(step.kind).toBe("cli");
		}
	});

	it("filters only disabled kinds and keeps remaining enabled", () => {
		const scenarios = buildBusinessSimulationScenarios({
			businessPaths: [apiBusinessPath()],
			runtimeScenario: {
				browser: { enabled: false },
				database: { enabled: false },
			},
		});

		expect(scenarios.length).toBeGreaterThan(0);
		const steps = scenarios[0].steps;
		const kinds = steps.map(s => s.kind);
		expect(kinds).not.toContain("browser");
		expect(kinds).not.toContain("database");
		expect(kinds).toContain("api");
		expect(kinds).toContain("cli");
		expect(kinds).toContain("log_check");
	});
});
