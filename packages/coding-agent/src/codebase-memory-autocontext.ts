import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import { getMCPConfigPath } from "@oh-my-pi/pi-utils";
import type { Settings } from "./config/settings";
import { addMCPServer, getMCPServer } from "./mcp/config-writer";
import type { MCPServerConfig } from "./mcp/types";

export const CODEBASE_MEMORY_SERVER_NAME = "codebase-memory";

export type CodebaseMemoryMCPConfigScope = "project" | "user" | "profile";

export type CodebaseMemoryCommand = "status" | "setup" | "doctor" | "discovery";

export type CodebaseMemoryIndexStatus = "unknown" | "ready" | "missing" | "query_failed";

export type CodebaseMemoryIntentConfidence = "none" | "low" | "medium" | "high";

export interface EnsureCodebaseMemoryMCPServerOptions {
	cwd: string;
	scope?: CodebaseMemoryMCPConfigScope;
	profile?: string;
	profileRoot?: string;
	configPath?: string;
	serverName?: string;
	config?: MCPServerConfig;
}

export interface EnsureCodebaseMemoryMCPServerResult {
	changed: boolean;
	configPath: string;
	scope: CodebaseMemoryMCPConfigScope;
	serverName: string;
	config: MCPServerConfig;
}

export type CodebaseMemoryStatusState =
	| "ready"
	| "not_configured"
	| "binary_missing"
	| "mcp_unavailable"
	| "index_missing"
	| "query_failed";

export interface CodebaseMemoryStatusInput {
	configuredServer?: MCPServerConfig;
	binaryAvailable?: boolean;
	allTools?: readonly string[];
	indexStatus?: CodebaseMemoryIndexStatus;
}

export interface CodebaseMemoryStatus {
	state: CodebaseMemoryStatusState;
	message: string;
	toolCount: number;
}

export interface CodebaseMemoryIntentContext {
	cwd?: string;
	hasCodeRepositorySignals?: boolean;
}

export interface CodebaseMemoryIntent {
	shouldInject: boolean;
	confidence: CodebaseMemoryIntentConfidence;
	reasons: string[];
}

export interface BuildCodebaseMemoryContextOptions {
	cwd?: string;
	status?: CodebaseMemoryStatus;
}

export interface CodebaseMemoryCommandArgs {
	command: CodebaseMemoryCommand;
	scope: CodebaseMemoryMCPConfigScope;
	profile?: string;
	mcpCommand?: string;
	enableDiscovery: boolean;
	noPathCheck: boolean;
}

export interface ResolveCodebaseMemoryMCPConfigPathOptions {
	cwd: string;
	scope?: CodebaseMemoryMCPConfigScope;
	profile?: string;
	profileRoot?: string;
}

export interface CheckCodebaseMemoryBinaryOptions {
	command?: string;
	exec?: (command: string, args: string[]) => Promise<CodebaseMemoryExecResult>;
}

export interface CodebaseMemoryExecResult {
	code?: number;
	exitCode?: number;
	stdout?: string;
	stderr?: string;
	killed?: boolean;
}

export interface CodebaseMemoryBinaryStatus {
	available: boolean;
	command: string;
	path?: string;
	error?: string;
}

export interface ConfigureCodebaseMemoryDiscoveryResult {
	changed: boolean;
	discoveryMode: "mcp-only";
	defaultServers: string[];
}

const CODEBASE_MEMORY_TOOL_PREFIX = "mcp__codebase_memory_";
const CODEBASE_MEMORY_CONTEXT_MARKER = "[codebase-memory-autocontext]";

const CODE_TASK_PATTERNS = [
	/\b(src|lib|packages|apps|test|tests|pkg|cmd|internal|frontend|backend)\/[\w./-]+/i,
	/\b[A-Za-z_$][\w$]*\s*\(/,
	/\b(import|export)\s+[\w${}\s,*]+from\s+["'][^"']+["']/i,
	/\b(handler|middleware|component|hook|caller|callee|call\s*graph|impact|dependency|stack\s*trace|symbol)\b/i,
	/\b(fix|debug|implement|refactor|test|trace)\b.{0,60}\b(code|logic|flow|function|method|class|handler|service|controller|component|config|bug|issue|error|failing|retry)\b/i,
	/\b(code|logic|flow|function|method|class|handler|service|controller|component|config|bug|issue|error|failing|retry)\b.{0,60}\b(fix|debug|implement|refactor|test|trace)\b/i,
	/(代码|函数|方法|接口|调用链|影响范围|测试失败|路由|处理器|配置加载|依赖|堆栈|符号|源码)/,
	/(修复|实现|排查|重构).{0,24}(代码|函数|方法|接口|配置|加载|失败|bug|错误|测试|逻辑|流程|模块|文件|src|服务)/i,
];

const NON_CODE_PATTERNS = [
	/(翻译|润色|文案|总结这段话|写邮件|起名|闲聊)/,
	/\b(translate|copywriting|rewrite this sentence|email draft|brainstorm names)\b/i,
];

const EXPLICIT_OPTOUT_PATTERNS = [
	/(不要|不用|别用).{0,12}(MCP|mcp|图谱|codebase-memory|codebase memory)/,
	/\b(without|no|do not use|don't use)\s+(mcp|codebase-memory|codebase memory|graph)\b/i,
];

const STACK_TRACE_PATTERNS = [
	/\b(TypeError|ReferenceError|SyntaxError|RangeError|Traceback|panic:|goroutine)\b/,
	/\bat\s+[\w.$<>]+\s*\([^)]*:\d+:\d+\)/,
	/\bat\s+[^)\n]+:\d+:\d+/,
	/\b[\w./-]+\.(ts|tsx|js|jsx|go|rs|py|java|kt|rb|php):\d+(:\d+)?\b/i,
];

const SYMBOL_PATTERNS = [
	/\b[A-Z][A-Za-z0-9_$]+(?:[A-Z][A-Za-z0-9_$]+)+\b/,
	/\b[a-z][A-Za-z0-9_$]*[A-Z][A-Za-z0-9_$]*\b/,
	/\b[A-Za-z_$][\w$]*\.[A-Za-z_$][\w$]*\b/,
];

const CODEBASE_MEMORY_CONTEXT_PROMPT = [
	CODEBASE_MEMORY_CONTEXT_MARKER,
	"当前请求看起来是代码理解或修改任务。优先使用 codebase-memory MCP 图谱工具：",
	"1. search_graph：定位函数、类、路由、变量或符号。",
	"2. trace_path：分析调用方、被调用方、依赖和影响范围。",
	"3. get_code_snippet：在图谱定位后读取精确源码。",
	"只有在查找字符串、配置、非代码文件或图谱结果不足时，再使用 rg / 文件读取。",
].join("\n");

export function shouldSuggestCodebaseMemoryContext(input: string): boolean {
	return classifyCodebaseMemoryIntent(input).shouldInject;
}

export function classifyCodebaseMemoryIntent(
	input: string,
	context: CodebaseMemoryIntentContext = {},
): CodebaseMemoryIntent {
	const text = input.trim();
	if (text.length === 0) return { shouldInject: false, confidence: "none", reasons: [] };
	if (EXPLICIT_OPTOUT_PATTERNS.some(pattern => pattern.test(text))) {
		return { shouldInject: false, confidence: "none", reasons: ["explicit_opt_out"] };
	}

	const reasons: string[] = [];
	if (CODE_TASK_PATTERNS.some(pattern => pattern.test(text))) reasons.push("code_task_keyword");
	if (STACK_TRACE_PATTERNS.some(pattern => pattern.test(text))) reasons.push("stack_trace");
	if (SYMBOL_PATTERNS.some(pattern => pattern.test(text))) reasons.push("symbol_like_token");
	if (context.hasCodeRepositorySignals ?? (context.cwd ? hasCodeRepositorySignals(context.cwd) : false)) {
		reasons.push("code_repository_cwd");
	}

	if (
		NON_CODE_PATTERNS.some(pattern => pattern.test(text)) &&
		!reasons.some(reason => reason === "code_task_keyword" || reason === "stack_trace")
	) {
		return { shouldInject: false, confidence: "none", reasons: ["non_code_task"] };
	}

	const triggeringReasons = reasons.filter(reason => reason !== "code_repository_cwd");
	if (triggeringReasons.length === 0) return { shouldInject: false, confidence: "none", reasons };
	const confidence = reasons.includes("stack_trace")
		? "high"
		: reasons.length >= 2
			? "high"
			: reasons.includes("code_task_keyword")
				? "medium"
				: "low";
	return { shouldInject: true, confidence, reasons };
}

export function buildCodebaseMemoryContextMessages(
	messages: readonly AgentMessage[],
	options: BuildCodebaseMemoryContextOptions = {},
): AgentMessage[] | undefined {
	if (hasCodebaseMemoryContextMarker(messages)) return undefined;
	if (options.status?.state !== "ready") return undefined;

	const lastUserText = extractLastUserText(messages);
	if (!lastUserText || !classifyCodebaseMemoryIntent(lastUserText, { cwd: options.cwd }).shouldInject) {
		return undefined;
	}

	return [
		...messages,
		{
			role: "user",
			content: CODEBASE_MEMORY_CONTEXT_PROMPT,
			synthetic: true,
			timestamp: Date.now(),
		},
	];
}

export async function ensureCodebaseMemoryMCPServer(
	options: EnsureCodebaseMemoryMCPServerOptions,
): Promise<EnsureCodebaseMemoryMCPServerResult> {
	const scope = options.scope ?? "project";
	const serverName = options.serverName ?? CODEBASE_MEMORY_SERVER_NAME;
	const configPath = options.configPath ?? resolveCodebaseMemoryMCPConfigPath(options);
	const config = options.config ?? createDefaultCodebaseMemoryMCPServerConfig(options.cwd);
	const existing = await getMCPServer(configPath, serverName);

	if (existing) {
		return { changed: false, configPath, scope, serverName, config: existing };
	}

	await addMCPServer(configPath, serverName, config);
	return { changed: true, configPath, scope, serverName, config };
}

export async function readCodebaseMemoryMCPServer(
	cwd: string,
	scope: CodebaseMemoryMCPConfigScope = "project",
	serverName = CODEBASE_MEMORY_SERVER_NAME,
	options: Pick<ResolveCodebaseMemoryMCPConfigPathOptions, "profile" | "profileRoot"> = {},
): Promise<MCPServerConfig | undefined> {
	return getMCPServer(resolveCodebaseMemoryMCPConfigPath({ cwd, scope, ...options }), serverName);
}

export function getCodebaseMemoryStatus(input: CodebaseMemoryStatusInput): CodebaseMemoryStatus {
	const toolCount = (input.allTools ?? []).filter(name => name.startsWith(CODEBASE_MEMORY_TOOL_PREFIX)).length;
	if (!input.configuredServer) {
		return {
			state: "not_configured",
			message: "codebase-memory MCP server is not configured.",
			toolCount,
		};
	}
	if (input.binaryAvailable === false) {
		return {
			state: "binary_missing",
			message: "codebase-memory-mcp binary is not available on PATH or at the configured command.",
			toolCount,
		};
	}
	if (toolCount === 0) {
		return {
			state: "mcp_unavailable",
			message: "codebase-memory MCP server is configured, but no graph tools are currently discovered.",
			toolCount,
		};
	}
	if (input.indexStatus === "missing") {
		return {
			state: "index_missing",
			message: "codebase-memory MCP tools are discovered, but the current repository index is missing.",
			toolCount,
		};
	}
	if (input.indexStatus === "query_failed") {
		return {
			state: "query_failed",
			message: "codebase-memory MCP tools are discovered, but the latest graph status query failed.",
			toolCount,
		};
	}
	return {
		state: "ready",
		message: "codebase-memory MCP server is configured and graph tools are discovered.",
		toolCount,
	};
}

export function createDefaultCodebaseMemoryMCPServerConfig(
	cwd: string,
	command = "codebase-memory-mcp",
): MCPServerConfig {
	return {
		type: "stdio",
		command,
		cwd,
	};
}

export function resolveCodebaseMemoryMCPConfigPath(options: ResolveCodebaseMemoryMCPConfigPathOptions): string {
	const scope = options.scope ?? "project";
	if (scope === "project" || scope === "user") {
		return getMCPConfigPath(scope, options.cwd);
	}

	const profile = options.profile?.trim();
	if (!profile || !/^[a-zA-Z0-9_.-]+$/.test(profile)) {
		throw new Error("Invalid profile name. Use letters, numbers, dash, underscore, or dot.");
	}
	const profileRoot = options.profileRoot ?? path.join(os.homedir(), ".omp", "profiles");
	return path.join(profileRoot, profile, "agent", "mcp.json");
}

export async function checkCodebaseMemoryBinary(
	options: CheckCodebaseMemoryBinaryOptions = {},
): Promise<CodebaseMemoryBinaryStatus> {
	const command = options.command ?? "codebase-memory-mcp";
	const exec = options.exec ?? defaultExec;
	const result: CodebaseMemoryExecResult = await exec("sh", ["-lc", `command -v ${quoteShell(command)}`]);
	const code = result.code ?? result.exitCode ?? 1;
	if (code === 0) {
		const resolvedPath = result.stdout?.trim() || command;
		return { available: true, command, path: resolvedPath };
	}
	return { available: false, command, error: result.stderr?.trim() || result.stdout?.trim() || "not found" };
}

export async function configureCodebaseMemoryDiscovery(
	settings: Settings,
	serverName = CODEBASE_MEMORY_SERVER_NAME,
): Promise<ConfigureCodebaseMemoryDiscoveryResult> {
	const existingMode = settings.get("tools.discoveryMode");
	const existingServers = settings.get("mcp.discoveryDefaultServers");
	const defaultServers = Array.isArray(existingServers) ? existingServers.filter(isString) : [];
	const nextServers = defaultServers.includes(serverName) ? defaultServers : [...defaultServers, serverName];
	let changed = false;

	if (existingMode !== "mcp-only") {
		settings.set("tools.discoveryMode", "mcp-only");
		changed = true;
	}
	if (!arraysEqual(defaultServers, nextServers)) {
		settings.set("mcp.discoveryDefaultServers", nextServers);
		changed = true;
	}
	if (changed) await settings.flush();
	return { changed, discoveryMode: "mcp-only", defaultServers: nextServers };
}

export function parseCodebaseMemoryCommandArgs(args: string): CodebaseMemoryCommandArgs {
	const tokens = tokenizeArgs(args);
	const first = tokens[0];
	const command: CodebaseMemoryCommand =
		first === "setup" || first === "doctor" || first === "discovery" || first === "status" ? first : "status";
	const rest =
		command === "status" && first && !first.startsWith("--")
			? tokens.slice(1)
			: tokens.slice(command === "status" ? 0 : 1);
	const parsed: CodebaseMemoryCommandArgs = {
		command,
		scope: "project",
		enableDiscovery: false,
		noPathCheck: false,
	};

	for (let index = 0; index < rest.length; index++) {
		const token = rest[index];
		const next = rest[index + 1];
		if (token === "--scope") {
			if (next !== "project" && next !== "user") throw new Error("Invalid --scope value. Use project or user.");
			parsed.scope = next;
			index++;
			continue;
		}
		if (token === "--profile") {
			if (!next) throw new Error("Missing --profile value.");
			parsed.scope = "profile";
			parsed.profile = next;
			index++;
			continue;
		}
		if (token === "--command") {
			if (!next) throw new Error("Missing --command value.");
			parsed.mcpCommand = next;
			index++;
			continue;
		}
		if (token === "--enable" || token === "--enable-discovery") {
			parsed.enableDiscovery = true;
			continue;
		}
		if (token === "--no-path-check") {
			parsed.noPathCheck = true;
			continue;
		}
		throw new Error(`Unknown codebase-memory option: ${token}`);
	}
	return parsed;
}

function extractLastUserText(messages: readonly AgentMessage[]): string | undefined {
	for (let index = messages.length - 1; index >= 0; index--) {
		const message = messages[index];
		if (message?.role !== "user") continue;
		const text = extractContentText("content" in message ? message.content : undefined);
		if (text.trim().length > 0) return text;
	}
	return undefined;
}

function extractContentText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.map(part => {
			if (part && typeof part === "object" && "text" in part && typeof part.text === "string") {
				return part.text;
			}
			return "";
		})
		.join("\n");
}

function hasCodebaseMemoryContextMarker(messages: readonly AgentMessage[]): boolean {
	return messages.some(message => {
		if (!("content" in message)) return false;
		return extractContentText(message.content).includes(CODEBASE_MEMORY_CONTEXT_MARKER);
	});
}

function hasCodeRepositorySignals(cwd: string): boolean {
	for (const marker of ["package.json", "go.mod", "Cargo.toml", "pyproject.toml", ".git", "src", "packages"]) {
		if (fs.existsSync(path.join(cwd, marker))) return true;
	}
	return false;
}

async function defaultExec(
	command: string,
	args: string[],
): Promise<{ code: number; stdout: string; stderr: string; killed: boolean }> {
	const proc = Bun.spawn([command, ...args], { stdout: "pipe", stderr: "pipe" });
	const [stdout, stderr, code] = await Promise.all([
		new Response(proc.stdout).text(),
		new Response(proc.stderr).text(),
		proc.exited,
	]);
	return { code, stdout, stderr, killed: false };
}

function quoteShell(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

function isString(value: unknown): value is string {
	return typeof value === "string";
}

function arraysEqual(left: readonly string[], right: readonly string[]): boolean {
	return left.length === right.length && left.every((value, index) => value === right[index]);
}

function tokenizeArgs(input: string): string[] {
	const tokens: string[] = [];
	const pattern = /"([^"]*)"|'([^']*)'|(\S+)/g;
	for (const match of input.matchAll(pattern)) {
		tokens.push(match[1] ?? match[2] ?? match[3] ?? "");
	}
	return tokens;
}
