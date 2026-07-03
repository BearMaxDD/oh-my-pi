import { afterEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import {
	buildCodebaseMemoryContextMessages,
	checkCodebaseMemoryBinary,
	classifyCodebaseMemoryIntent,
	configureCodebaseMemoryDiscovery,
	ensureCodebaseMemoryMCPServer,
	getCodebaseMemoryStatus,
	parseCodebaseMemoryCommandArgs,
	resolveCodebaseMemoryMCPConfigPath,
	shouldSuggestCodebaseMemoryContext,
} from "@oh-my-pi/pi-coding-agent/codebase-memory-autocontext";
import { resetSettingsForTest, Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { readMCPConfigFile } from "@oh-my-pi/pi-coding-agent/mcp/config-writer";
import { getMCPConfigPath } from "@oh-my-pi/pi-utils";
import codebaseMemoryAutocontextExtension from "../examples/extensions/codebase-memory-autocontext";

const tempDirs: string[] = [];

function makeTempDir(): string {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-cbm-autocontext-"));
	tempDirs.push(dir);
	return dir;
}

function userMessage(content: string): AgentMessage {
	return { role: "user", content, timestamp: 1 };
}

afterEach(() => {
	resetSettingsForTest();
	for (const dir of tempDirs.splice(0)) {
		fs.rmSync(dir, { recursive: true, force: true });
	}
});

describe("codebase memory autocontext", () => {
	it("detects codebase analysis tasks and respects explicit opt-out", () => {
		expect(shouldSuggestCodebaseMemoryContext("分析 src/session/agent-session.ts 里 refreshMCPTools 谁调用")).toBe(
			true,
		);
		expect(shouldSuggestCodebaseMemoryContext("这个 handler 的调用链和影响范围是什么")).toBe(true);
		expect(
			classifyCodebaseMemoryIntent(
				"TypeError: Cannot read properties of undefined\n    at loadConfig (src/config.ts:12:3)",
			).confidence,
		).toBe("high");
		expect(shouldSuggestCodebaseMemoryContext("翻译这句话：hello world")).toBe(false);
		expect(shouldSuggestCodebaseMemoryContext("不要用 MCP，直接解释一下这个函数")).toBe(false);
	});

	it("does not inject for greetings, translation, or explicit opt-out requests", () => {
		expect(classifyCodebaseMemoryIntent("你好，今天怎么样？")).toMatchObject({
			shouldInject: false,
			confidence: "none",
		});
		expect(classifyCodebaseMemoryIntent("Hello, how are you?")).toMatchObject({
			shouldInject: false,
			confidence: "none",
		});
		expect(classifyCodebaseMemoryIntent("translate this sentence: hello world")).toMatchObject({
			shouldInject: false,
			confidence: "none",
		});
		expect(classifyCodebaseMemoryIntent("Please do not use codebase-memory, just explain the snippet")).toMatchObject(
			{
				shouldInject: false,
				confidence: "none",
				reasons: ["explicit_opt_out"],
			},
		);
		expect(classifyCodebaseMemoryIntent("你好，今天怎么样？", { cwd: process.cwd() })).toMatchObject({
			shouldInject: false,
			confidence: "none",
		});
		expect(
			buildCodebaseMemoryContextMessages([userMessage("Hello, how are you?")], { cwd: process.cwd() }),
		).toBeUndefined();
	});

	it("does not inject for ordinary language with code-like homonyms", () => {
		expect(classifyCodebaseMemoryIntent("This class was very interesting")).toMatchObject({
			shouldInject: false,
			confidence: "none",
		});
		expect(classifyCodebaseMemoryIntent("Please explain the route from Paris to Rome")).toMatchObject({
			shouldInject: false,
			confidence: "none",
		});
		expect(classifyCodebaseMemoryIntent("The import fee is high")).toMatchObject({
			shouldInject: false,
			confidence: "none",
		});
		expect(classifyCodebaseMemoryIntent("我们调用一下大家明天开会")).toMatchObject({
			shouldInject: false,
			confidence: "none",
		});
		expect(classifyCodebaseMemoryIntent("这个方案实现起来很难")).toMatchObject({
			shouldInject: false,
			confidence: "none",
		});
		expect(classifyCodebaseMemoryIntent("帮我整理文件")).toMatchObject({
			shouldInject: false,
			confidence: "none",
		});
		expect(classifyCodebaseMemoryIntent("请总结这个文件")).toMatchObject({
			shouldInject: false,
			confidence: "none",
		});
	});

	it("detects Chinese and English code task keywords", () => {
		expect(classifyCodebaseMemoryIntent("排查配置加载失败")).toMatchObject({
			shouldInject: true,
			confidence: "medium",
			reasons: ["code_task_keyword"],
		});
		expect(classifyCodebaseMemoryIntent("please implement retry logic for auth flow")).toMatchObject({
			shouldInject: true,
			confidence: "medium",
			reasons: ["code_task_keyword"],
		});
	});

	it("treats stack traces as high-confidence code tasks", () => {
		expect(
			classifyCodebaseMemoryIntent("RangeError: invalid array length\n    at parse (/workspace/src/parser.ts:42:7)"),
		).toMatchObject({
			shouldInject: true,
			confidence: "high",
			reasons: expect.arrayContaining(["stack_trace"]),
		});
	});

	it("raises confidence for symbol-like tokens when repository signals are present", () => {
		expect(classifyCodebaseMemoryIntent("refreshMCPTools", { hasCodeRepositorySignals: true })).toMatchObject({
			shouldInject: true,
			confidence: "high",
			reasons: expect.arrayContaining(["symbol_like_token", "code_repository_cwd"]),
		});

		const cwd = makeTempDir();
		fs.writeFileSync(path.join(cwd, "package.json"), "{}");
		expect(classifyCodebaseMemoryIntent("loadAgentSessionGraph", { cwd })).toMatchObject({
			shouldInject: true,
			confidence: "high",
			reasons: expect.arrayContaining(["symbol_like_token", "code_repository_cwd"]),
		});
	});

	it("appends one compact Chinese graph-first instruction only for ready code tasks", () => {
		const messages = [userMessage("修复 src/mcp/config.ts 的配置加载问题")];

		const next = buildCodebaseMemoryContextMessages(messages, {
			status: { state: "ready", message: "ready", toolCount: 3 },
		});

		if (!next) throw new Error("Expected codebase-memory context messages");
		expect(next).toHaveLength(2);
		expect(next[0]).toBe(messages[0]);
		expect(next[1]).toMatchObject({ role: "user" });
		expect(next[1].role).toBe("user");
		if (next[1].role !== "user") throw new Error("Expected injected user message");
		expect(String(next[1].content)).toContain("[codebase-memory-autocontext]");
		expect(String(next[1].content)).toContain("search_graph");
		expect(String(next[1].content)).toContain("trace_path");
		expect(String(next[1].content)).toContain("get_code_snippet");
		expect(String(next[1].content)).toContain("优先使用");

		expect(buildCodebaseMemoryContextMessages(next)).toBeUndefined();

		expect(buildCodebaseMemoryContextMessages([userMessage("写一段产品文案")])).toBeUndefined();
		expect(buildCodebaseMemoryContextMessages(messages)).toBeUndefined();
		expect(
			buildCodebaseMemoryContextMessages(messages, {
				status: { state: "not_configured", message: "missing", toolCount: 0 },
			}),
		).toBeUndefined();
	});

	it("writes the project MCP server once and reports ready status from configured tools", async () => {
		const cwd = makeTempDir();

		const result = await ensureCodebaseMemoryMCPServer({ cwd });

		expect(result).toMatchObject({ changed: true, scope: "project", serverName: "codebase-memory" });
		const config = await readMCPConfigFile(getMCPConfigPath("project", cwd));
		expect(config.mcpServers?.["codebase-memory"]).toMatchObject({
			type: "stdio",
			command: "codebase-memory-mcp",
		});

		const repeated = await ensureCodebaseMemoryMCPServer({ cwd });
		expect(repeated).toMatchObject({ changed: false, scope: "project", serverName: "codebase-memory" });

		expect(
			getCodebaseMemoryStatus({
				configuredServer: config.mcpServers?.["codebase-memory"],
				allTools: ["read_file", "mcp__codebase_memory_search_graph", "mcp__codebase_memory_trace_path"],
			}),
		).toMatchObject({ state: "ready" });
	});

	it("supports project, user, and profile MCP config targets", async () => {
		const cwd = makeTempDir();
		const profileRoot = path.join(makeTempDir(), "profiles");

		expect(resolveCodebaseMemoryMCPConfigPath({ cwd, scope: "project" })).toBe(getMCPConfigPath("project", cwd));
		expect(resolveCodebaseMemoryMCPConfigPath({ cwd, scope: "user" })).toBe(getMCPConfigPath("user", cwd));
		expect(resolveCodebaseMemoryMCPConfigPath({ cwd, scope: "profile", profile: "dev", profileRoot })).toBe(
			path.join(profileRoot, "dev", "agent", "mcp.json"),
		);

		const result = await ensureCodebaseMemoryMCPServer({ cwd, scope: "profile", profile: "dev", profileRoot });
		expect(result).toMatchObject({ changed: true, scope: "profile" });
		const config = await readMCPConfigFile(path.join(profileRoot, "dev", "agent", "mcp.json"));
		expect(config.mcpServers?.["codebase-memory"]).toMatchObject({ command: "codebase-memory-mcp" });
	});

	it("checks binary availability and reports degraded states", async () => {
		await expect(
			checkCodebaseMemoryBinary({
				command: "codebase-memory-mcp",
				exec: async () => ({ exitCode: 1, stdout: "", stderr: "not found" }),
			}),
		).resolves.toMatchObject({ available: false });

		expect(
			getCodebaseMemoryStatus({ configuredServer: { type: "stdio", command: "codebase-memory-mcp" } }),
		).toMatchObject({
			state: "mcp_unavailable",
		});
		expect(
			getCodebaseMemoryStatus({
				configuredServer: { type: "stdio", command: "codebase-memory-mcp" },
				binaryAvailable: false,
			}),
		).toMatchObject({ state: "binary_missing" });
		expect(
			getCodebaseMemoryStatus({
				configuredServer: { type: "stdio", command: "codebase-memory-mcp" },
				binaryAvailable: true,
				allTools: ["mcp__codebase_memory_search_graph"],
				indexStatus: "missing",
			}),
		).toMatchObject({ state: "index_missing" });
		expect(
			getCodebaseMemoryStatus({
				configuredServer: { type: "stdio", command: "codebase-memory-mcp" },
				binaryAvailable: true,
				allTools: ["mcp__codebase_memory_search_graph"],
				indexStatus: "query_failed",
			}),
		).toMatchObject({ state: "query_failed" });
	});

	it("reports all codebase-memory status states", () => {
		expect(getCodebaseMemoryStatus({})).toMatchObject({ state: "not_configured" });
		expect(
			getCodebaseMemoryStatus({
				configuredServer: { type: "stdio", command: "codebase-memory-mcp" },
				binaryAvailable: false,
			}),
		).toMatchObject({ state: "binary_missing" });
		expect(
			getCodebaseMemoryStatus({
				configuredServer: { type: "stdio", command: "codebase-memory-mcp" },
				binaryAvailable: true,
				allTools: [],
			}),
		).toMatchObject({ state: "mcp_unavailable" });
		expect(
			getCodebaseMemoryStatus({
				configuredServer: { type: "stdio", command: "codebase-memory-mcp" },
				binaryAvailable: true,
				allTools: ["mcp__codebase_memory_search_graph"],
				indexStatus: "missing",
			}),
		).toMatchObject({ state: "index_missing" });
		expect(
			getCodebaseMemoryStatus({
				configuredServer: { type: "stdio", command: "codebase-memory-mcp" },
				binaryAvailable: true,
				allTools: ["mcp__codebase_memory_search_graph"],
				indexStatus: "query_failed",
			}),
		).toMatchObject({ state: "query_failed" });
		expect(
			getCodebaseMemoryStatus({
				configuredServer: { type: "stdio", command: "codebase-memory-mcp" },
				binaryAvailable: true,
				allTools: ["mcp__codebase_memory_search_graph"],
				indexStatus: "ready",
			}),
		).toMatchObject({ state: "ready" });
	});

	it("configures MCP discovery settings without dropping existing servers", async () => {
		const settings = Settings.isolated();
		settings.set("mcp.discoveryDefaultServers", ["github"]);

		const result = await configureCodebaseMemoryDiscovery(settings);

		expect(result).toEqual({
			changed: true,
			discoveryMode: "mcp-only",
			defaultServers: ["github", "codebase-memory"],
		});
		expect(settings.get("tools.discoveryMode")).toBe("mcp-only");
		expect(settings.get("mcp.discoveryDefaultServers")).toEqual(["github", "codebase-memory"]);

		const repeated = await configureCodebaseMemoryDiscovery(settings);
		expect(repeated).toEqual({
			changed: false,
			discoveryMode: "mcp-only",
			defaultServers: ["github", "codebase-memory"],
		});
	});

	it("reports current default servers when setup enables discovery", async () => {
		const cwd = makeTempDir();
		const settings = await Settings.init({ inMemory: true });
		settings.set("mcp.discoveryDefaultServers", ["github"]);

		const notifications: string[] = [];
		const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
		codebaseMemoryAutocontextExtension({
			setLabel() {},
			on() {},
			getAllTools: () => [],
			exec: async () => ({ code: 0, stdout: "/usr/bin/codebase-memory-mcp\n", stderr: "", killed: false }),
			registerCommand(name: string, command: { handler: (args: string, ctx: unknown) => Promise<void> }) {
				commands.set(name, command);
			},
		} as never);

		const command = commands.get("codebase-memory");
		if (!command) throw new Error("Expected codebase-memory command registration");
		await command.handler("setup --no-path-check --enable-discovery", {
			cwd,
			ui: { notify: (message: string) => notifications.push(message) },
		});

		expect(notifications.at(-1)).toContain("github, codebase-memory");
	});

	it("extension discovery command enables MCP discovery", async () => {
		const cwd = makeTempDir();
		const settings = await Settings.init({ inMemory: true });
		settings.set("mcp.discoveryDefaultServers", ["github"]);

		const notifications: string[] = [];
		const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
		codebaseMemoryAutocontextExtension({
			setLabel() {},
			on() {},
			getAllTools: () => [],
			exec: async () => ({ code: 0, stdout: "", stderr: "", killed: false }),
			registerCommand(name: string, command: { handler: (args: string, ctx: unknown) => Promise<void> }) {
				commands.set(name, command);
			},
		} as never);

		const command = commands.get("codebase-memory");
		if (!command) throw new Error("Expected codebase-memory command registration");
		await command.handler("discovery --enable", {
			cwd,
			ui: { notify: (message: string) => notifications.push(message) },
		});

		expect(settings.get("tools.discoveryMode")).toBe("mcp-only");
		expect(settings.get("mcp.discoveryDefaultServers")).toEqual(["github", "codebase-memory"]);
		expect(notifications.at(-1)).toContain("MCP discovery enabled");
	});

	it("extension status and doctor commands report status details", async () => {
		const cwd = makeTempDir();
		await ensureCodebaseMemoryMCPServer({ cwd });

		const notifications: string[] = [];
		const commands = new Map<string, { handler: (args: string, ctx: unknown) => Promise<void> }>();
		codebaseMemoryAutocontextExtension({
			setLabel() {},
			on() {},
			getAllTools: () => ["mcp__codebase_memory_search_graph"],
			exec: async () => ({ code: 0, stdout: "/usr/bin/codebase-memory-mcp\n", stderr: "", killed: false }),
			registerCommand(name: string, command: { handler: (args: string, ctx: unknown) => Promise<void> }) {
				commands.set(name, command);
			},
		} as never);

		const command = commands.get("codebase-memory");
		if (!command) throw new Error("Expected codebase-memory command registration");
		await command.handler("status", {
			cwd,
			ui: { notify: (message: string, level: string) => notifications.push(`${level}: ${message}`) },
		});
		await command.handler("doctor", {
			cwd,
			ui: { notify: (message: string, level: string) => notifications.push(`${level}: ${message}`) },
		});

		expect(notifications[0]).toContain("info: codebase-memory MCP server is configured");
		expect(notifications[1]).toContain("Tools discovered: 1");
		expect(notifications[1]).toContain("Binary: ok/unknown");
	});

	it("parses setup and discovery command arguments", () => {
		expect(parseCodebaseMemoryCommandArgs("setup --scope user --enable-discovery")).toMatchObject({
			command: "setup",
			scope: "user",
			enableDiscovery: true,
		});
		expect(
			parseCodebaseMemoryCommandArgs("setup --profile dev --command /opt/bin/codebase-memory-mcp"),
		).toMatchObject({
			command: "setup",
			scope: "profile",
			profile: "dev",
			mcpCommand: "/opt/bin/codebase-memory-mcp",
		});
		expect(parseCodebaseMemoryCommandArgs("discovery --enable")).toMatchObject({
			command: "discovery",
			enableDiscovery: true,
		});
	});
});
