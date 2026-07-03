import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { BusinessPathRef } from "./spec-task-framework";

export interface RuntimeEnvironmentPlan {
	schema_version: "superpowers.runtime_environment_plan.v1";
	run_id: string;
	/** @deprecated use `type` instead */
	environment_type: "local" | "docker" | "sandbox" | "staging";
	type: RuntimeEnvironmentType;
	startup_commands: RuntimeCommand[];
	health_checks: RuntimeHealthCheck[];
	required_env_vars: RuntimeEnvVarRequirement[];
	forbidden_targets: string[];
	cleanup_commands: RuntimeCommand[];
	safety_notes_zh: string[];
}

export interface RuntimeCommand {
	cwd: string;
	command: string;
	timeout_ms: number;
	redacts?: string[];
}

export interface RuntimeCommandHealthCheck {
	title_zh: string;
	command: RuntimeCommand;
	expected_exit_code: number;
}
export interface RuntimeEnvVarRequirement {
	name: string;
	required: boolean;
	redacted: boolean;
}

export type RuntimeEnvironmentType = "local" | "docker" | "sandbox";

export type RuntimeScenarioStepKind = "browser" | "api" | "database" | "cli" | "log_check";

export interface BrowserStep {
	id: string;
	kind: "browser";
	title_zh: string;
	timeout_ms: number;
	expected: string;
	evidence_path?: string;
	required: boolean;
	url: string;
	action: string;
	selector?: string;
	text: string;
	expected_url: string;
	expected_text: string;
}

export interface ApiStep {
	id: string;
	kind: "api";
	title_zh: string;
	timeout_ms: number;
	expected: string;
	evidence_path?: string;
	required: boolean;
	method: string;
	url: string;
	headers?: Record<string, string>;
	body?: string;
	expected_status: number;
	expected_body_contains?: string;
}

export interface DatabaseStep {
	id: string;
	kind: "database";
	title_zh: string;
	timeout_ms: number;
	expected: string;
	evidence_path?: string;
	required: boolean;
	connection_ref: string;
	read_only: true;
	query: string;
	expected_rows?: number;
	expected_contains?: string;
}

export interface CliStep {
	id: string;
	kind: "cli";
	title_zh: string;
	timeout_ms: number;
	expected: string;
	evidence_path?: string;
	required: boolean;
	cwd: string;
	command: string;
	expected_exit_code: number;
	expected_output_contains?: string;
	redacts: string[];
}

export interface LogCheckStep {
	id: string;
	kind: "log_check";
	title_zh: string;
	timeout_ms: number;
	expected: string;
	evidence_path?: string;
	required: boolean;
	path: string;
	contains: string;
}

export type RuntimeScenarioStep = BrowserStep | ApiStep | DatabaseStep | CliStep | LogCheckStep;

export interface RuntimeLogHealthCheck {
	type: "log_contains";
	path: string;
	text: string;
}

export type RuntimeHealthCheck = RuntimeCommandHealthCheck | RuntimeLogHealthCheck;

export interface BusinessSimulationScenario {
	id: string;
	title_zh: string;
	source_requirement: string;
	actor: string;
	preconditions: string[];
	steps: RuntimeScenarioStep[];
	expected_results: string[];
	evidence_required: string[];
}

export function buildRuntimeEnvironmentPlan(options: {
	runId: string;
	repoPath: string;
	businessPaths: readonly BusinessPathRef[];
}): RuntimeEnvironmentPlan {
	const environment = options.businessPaths.find(path => path.runtime_required)?.suggested_environment ?? "local";
	return {
		schema_version: "superpowers.runtime_environment_plan.v1",
		run_id: options.runId,
		type: environment === "staging" ? "sandbox" : (environment as RuntimeEnvironmentType),
		environment_type: environment === "staging" ? "sandbox" : environment,
		startup_commands: [
			{
				cwd: options.repoPath,
				command: "bun run check:types",
				timeout_ms: 120000,
				redacts: ["token", "password", "cookie"],
			},
		],
		health_checks: [
			{
				title_zh: "TypeScript 类型检查可运行",
				command: {
					cwd: options.repoPath,
					command: "bun run check:types",
					timeout_ms: 120000,
					redacts: ["token", "password", "cookie"],
				},
				expected_exit_code: 0,
			},
		],
		required_env_vars: [],
		forbidden_targets: ["production", "prod", "live"],
		cleanup_commands: [{ cwd: options.repoPath, command: "true", timeout_ms: 10000 }],
		safety_notes_zh: ["默认禁止连接生产环境", "默认禁止 destructive operation", "日志必须脱敏", "命令必须有 timeout"],
	};
}

const kindKeywords: Array<{ kind: RuntimeScenarioStepKind; keywords: string[] }> = [
	{ kind: "browser", keywords: ["browser", "ui", "page", "click", "frontend"] },
	{ kind: "api", keywords: ["api", "http", "endpoint", "request"] },
	{ kind: "database", keywords: ["database", "db", "sql", "row", "query"] },
	{ kind: "cli", keywords: ["cli", "command", "terminal"] },
	{ kind: "log_check", keywords: ["log", "trace", "audit"] },
];

function synthesizeStepKinds(user_story: string): RuntimeScenarioStepKind[] {
	const lower = user_story.toLowerCase();
	const matched: RuntimeScenarioStepKind[] = [];
	for (const { kind, keywords } of kindKeywords) {
		if (keywords.some(kw => lower.includes(kw))) {
			matched.push(kind);
		}
	}
	if (matched.length === 0) {
		return ["cli", "log_check"];
	}
	return matched;
}

function buildStep(kind: RuntimeScenarioStepKind, index: number): RuntimeScenarioStep {
	const id = `sim-step-${index + 1}`;
	switch (kind) {
		case "browser":
			return {
				id,
				kind,
				title_zh: `用户界面操作 #${index + 1}`,
				timeout_ms: 30000,
				required: true,
				expected: "页面加载成功",
				url: "http://localhost:3000",
				action: "navigate",
				text: "",
				expected_url: "http://localhost:3000",
				expected_text: "系统正常运行",
			};
		case "api":
			return {
				id,
				kind,
				title_zh: `接口调用 #${index + 1}`,
				timeout_ms: 30000,
				required: true,
				expected: "返回状态码 200",
				method: "GET",
				url: "/api/health",
				expected_status: 200,
			};
		case "database":
			return {
				id,
				kind,
				title_zh: `数据库查询 #${index + 1}`,
				timeout_ms: 30000,
				required: true,
				expected: "查询成功",
				connection_ref: "default",
				read_only: true,
				query: "SELECT 1",
			};
		case "cli":
			return {
				id,
				kind,
				title_zh: `命令行执行 #${index + 1}`,
				timeout_ms: 30000,
				required: true,
				expected: "runtime-evidence",
				cwd: ".",
				command: "printf 'runtime-evidence'",
				expected_exit_code: 0,
				expected_output_contains: "runtime-evidence",
				redacts: [],
			};
		case "log_check":
			return {
				id,
				kind,
				title_zh: `日志检查 #${index + 1}`,
				timeout_ms: 30000,
				required: true,
				expected: "日志包含目标内容",
				path: "logs/app.log",
				contains: "SUCCESS",
			};
	}
}

export function buildBusinessSimulationScenarios(options: {
	businessPaths: readonly BusinessPathRef[];
	runtimeScenario?: {
		browser?: { enabled: boolean };
		api?: { enabled: boolean };
		database?: { enabled: boolean };
	};
}): BusinessSimulationScenario[] {
	const rs = options.runtimeScenario;

	// Determine whether a kind is allowed by runtime scenario settings.
	// cli and log_check are always allowed; browser/api/database respect enablement.
	const isKindAllowed = (kind: RuntimeScenarioStepKind): boolean => {
		if (kind === "cli" || kind === "log_check") return true;
		if (!rs) return true;
		if (kind === "browser") return rs.browser?.enabled !== false;
		if (kind === "api") return rs.api?.enabled !== false;
		if (kind === "database") return rs.database?.enabled !== false;
		return true;
	};

	return options.businessPaths
		.filter(path => path.runtime_required)
		.map(path => {
			const allStepKinds = synthesizeStepKinds(path.user_story);
			const allowedKinds = allStepKinds.filter(isKindAllowed);
			const stepKinds = allowedKinds.length === 0 ? ["cli" as RuntimeScenarioStepKind] : allowedKinds;
			const steps = stepKinds.map((kind, index) => buildStep(kind, index));
			return {
				id: path.id,
				title_zh: path.title_zh,
				source_requirement: path.user_story,
				actor: "developer",
				preconditions: ["已生成 execution-book.json", "已生成 spec-task-framework.json", "当前环境不是生产环境"],
				steps,
				expected_results: ["真实业务路径完成", "证据文件可打开", "清理报告存在"],
				evidence_required: ["real-runtime-simulation-report.md", "runtime-cleanup-report.md"],
			};
		});
}

function renderEnvironmentPlan(plan: RuntimeEnvironmentPlan): string {
	return [
		"# Runtime Environment Plan",
		"",
		`run_id: ${plan.run_id}`,
		`type: ${plan.type}`,
		"## Startup Commands",
		...plan.startup_commands.map(command => `- (${command.timeout_ms}ms) ${command.cwd}: ${command.command}`),
		"",
		"## Safety Notes",
		...plan.safety_notes_zh.map(note => `- ${note}`),
		"",
	].join("\n");
}

export function renderRuntimeScenarioStep(step: RuntimeScenarioStep): string {
	const parts: string[] = [`- [${step.kind}] ${step.title_zh}`];
	switch (step.kind) {
		case "browser":
			parts.push(`  ${step.action} ${step.url}`);
			if (step.selector) parts.push(`  selector: ${step.selector}`);
			break;
		case "api":
			parts.push(`  ${step.method} ${step.url}`);
			parts.push(`  expected_status: ${step.expected_status}`);
			break;
		case "database":
			parts.push(`  query: ${step.query}`);
			if (step.expected_rows !== undefined) parts.push(`  expected_rows: ${step.expected_rows}`);
			if (step.expected_contains) parts.push(`  expected_contains: ${step.expected_contains}`);
			break;
		case "cli":
			parts.push(`  command: ${step.command}`);
			parts.push(`  expected_exit_code: ${step.expected_exit_code}`);
			break;
		case "log_check":
			parts.push(`  path: ${step.path}`);
			parts.push(`  contains: ${step.contains}`);
			break;
	}
	parts.push(`  expected: ${step.expected}`);
	parts.push(`  evidence: role-bound evidence required`);
	return parts.join("\n");
}

function renderScenarios(scenarios: readonly BusinessSimulationScenario[]): string {
	const lines = ["# Business Simulation Scenarios", ""];
	for (const scenario of scenarios) {
		lines.push(`## ${scenario.id} ${scenario.title_zh}`, "", scenario.source_requirement, "", "### Steps");
		for (const step of scenario.steps) lines.push(renderRuntimeScenarioStep(step));
		lines.push("");
	}
	return lines.join("\n");
}

export async function writeRuntimeScenarioArtifacts(options: {
	acceptingDir: string;
	environment: RuntimeEnvironmentPlan;
	scenarios: readonly BusinessSimulationScenario[];
}): Promise<{ environmentPlanPath: string; scenariosPath: string }> {
	await mkdir(options.acceptingDir, { recursive: true });
	const environmentPlanPath = join(options.acceptingDir, "runtime-environment-plan.md");
	const scenariosPath = join(options.acceptingDir, "business-simulation-scenarios.md");
	await writeFile(environmentPlanPath, renderEnvironmentPlan(options.environment), "utf8");
	await writeFile(scenariosPath, renderScenarios(options.scenarios), "utf8");
	return { environmentPlanPath, scenariosPath };
}
