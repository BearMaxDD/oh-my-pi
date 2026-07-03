import type { ExtensionAPI } from "@oh-my-pi/pi-coding-agent";
import {
	buildCodebaseMemoryContextMessages,
	checkCodebaseMemoryBinary,
	configureCodebaseMemoryDiscovery,
	createDefaultCodebaseMemoryMCPServerConfig,
	ensureCodebaseMemoryMCPServer,
	getCodebaseMemoryStatus,
	parseCodebaseMemoryCommandArgs,
	readCodebaseMemoryMCPServer,
} from "@oh-my-pi/pi-coding-agent/codebase-memory-autocontext";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";

export default function codebaseMemoryAutocontext(pi: ExtensionAPI) {
	pi.setLabel("Codebase memory autocontext");

	pi.on("context", async (event, ctx) => {
		const configuredServer = await readCodebaseMemoryMCPServer(ctx.cwd);
		const status = getCodebaseMemoryStatus({
			configuredServer,
			allTools: pi.getAllTools(),
		});
		const messages = buildCodebaseMemoryContextMessages(event.messages, { cwd: ctx.cwd, status });
		return messages ? { messages } : undefined;
	});

	pi.registerCommand("codebase-memory", {
		description: "Inspect or configure codebase-memory MCP autocontext",
		getArgumentCompletions(argumentPrefix: string) {
			if (argumentPrefix.includes(" ")) return null;
			const normalized = argumentPrefix.trim().toLowerCase();
			const completions = [
				{ label: "status", value: "status", description: "Show codebase-memory MCP status" },
				{ label: "setup", value: "setup", description: "Add the project MCP server config" },
				{ label: "doctor", value: "doctor", description: "Show setup and discovery diagnostics" },
				{ label: "discovery", value: "discovery", description: "Configure MCP tool discovery settings" },
			];
			if (normalized.length === 0) return completions;
			const filtered = completions.filter(item => item.label.startsWith(normalized));
			return filtered.length > 0 ? filtered : null;
		},
		async handler(args, ctx) {
			let parsed: ReturnType<typeof parseCodebaseMemoryCommandArgs>;
			try {
				parsed = parseCodebaseMemoryCommandArgs(args);
			} catch (error) {
				ctx.ui.notify(error instanceof Error ? error.message : String(error), "error");
				return;
			}

			if (parsed.command === "setup") {
				const command = parsed.mcpCommand ?? "codebase-memory-mcp";
				if (!parsed.noPathCheck) {
					const binary = await checkCodebaseMemoryBinary({
						command,
						exec: (cmd, cmdArgs) => pi.exec(cmd, cmdArgs, { cwd: ctx.cwd }),
					});
					if (!binary.available) {
						ctx.ui.notify(`codebase-memory MCP binary missing: ${binary.error ?? command}`, "error");
						return;
					}
				}
				const result = await ensureCodebaseMemoryMCPServer({
					cwd: ctx.cwd,
					scope: parsed.scope,
					profile: parsed.profile,
					config: createDefaultCodebaseMemoryMCPServerConfig(ctx.cwd, command),
				});
				let discoveryServers: string[] | undefined;
				if (parsed.enableDiscovery) {
					const discovery = await configureCodebaseMemoryDiscovery(Settings.instance);
					discoveryServers = discovery.defaultServers;
				}
				const setupMessage = result.changed
					? `Configured codebase-memory MCP server at ${result.configPath}`
					: `codebase-memory MCP server already exists at ${result.configPath}`;
				const discoveryMessage = discoveryServers
					? ` Discovery default servers: ${discoveryServers.join(", ")}.`
					: "";
				ctx.ui.notify(`${setupMessage}${discoveryMessage}`, "info");
				return;
			}

			if (parsed.command === "discovery") {
				if (!parsed.enableDiscovery) {
					ctx.ui.notify("Run /codebase-memory discovery --enable to set tools.discoveryMode=mcp-only.", "info");
					return;
				}
				const result = await configureCodebaseMemoryDiscovery(Settings.instance);
				ctx.ui.notify(
					result.changed
						? `MCP discovery enabled for codebase-memory (${result.defaultServers.join(", ")}).`
						: `MCP discovery already configured for codebase-memory (${result.defaultServers.join(", ")}).`,
					"info",
				);
				return;
			}

			if (parsed.command === "status" || parsed.command === "doctor") {
				const configuredServer = await readCodebaseMemoryMCPServer(ctx.cwd, parsed.scope, "codebase-memory", {
					profile: parsed.profile,
				});
				const binary = configuredServer
					? await checkCodebaseMemoryBinary({
							command: "command" in configuredServer ? configuredServer.command : undefined,
							exec: (cmd, cmdArgs) => pi.exec(cmd, cmdArgs, { cwd: ctx.cwd }),
						})
					: undefined;
				const status = getCodebaseMemoryStatus({
					configuredServer,
					binaryAvailable: binary?.available,
					allTools: pi.getAllTools(),
				});
				const detail =
					parsed.command === "doctor"
						? `${status.message} Tools discovered: ${status.toolCount}. Binary: ${binary?.available === false ? "missing" : "ok/unknown"}. Run /codebase-memory setup to create a project config.`
						: status.message;
				ctx.ui.notify(detail, status.state === "ready" ? "info" : "warning");
				return;
			}

			ctx.ui.notify("Usage: /codebase-memory status | setup | doctor | discovery", "warning");
		},
	});
}
