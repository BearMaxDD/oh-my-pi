import { afterEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { Agent } from "@oh-my-pi/pi-agent-core";
import * as compactionModule from "@oh-my-pi/pi-agent-core/compaction";
import type { AssistantMessage } from "@oh-my-pi/pi-ai";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { loadExtensions } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/loader";
import { ExtensionRunner } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/runner";
import { AgentSession, type AgentSessionEvent } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { USER_TODO_EDIT_CUSTOM_TYPE } from "@oh-my-pi/pi-coding-agent/tools";
import { getProjectAgentDir, TempDir } from "@oh-my-pi/pi-utils";
import * as snapcompact from "@oh-my-pi/snapcompact";

const CHINESE_TEXT = "请继续执行这个很长的中文任务。".repeat(240);

type Harness = {
	tempDir: TempDir;
	session: AgentSession;
	sessionManager: SessionManager;
	authStorage: AuthStorage;
	events: AgentSessionEvent[];
};

async function createHarness(
	options: {
		strategy?: "smart" | "context-full" | "handoff" | "shake" | "snapcompact" | "off";
		modelInput?: string[];
		withCompactionHook?: boolean;
		withSessionCompactHook?: boolean;
	} = {},
): Promise<Harness> {
	const tempDir = TempDir.createSync("@pi-smart-compaction-router-");
	const authStorage = await AuthStorage.create(path.join(tempDir.path(), "testauth.db"));
	authStorage.setRuntimeApiKey("anthropic", "test-key");
	const modelRegistry = new ModelRegistry(authStorage, path.join(tempDir.path(), "models.yml"));
	const baseModel = getBundledModel("anthropic", "claude-sonnet-4-5");
	if (!baseModel) throw new Error("Expected bundled anthropic model to exist");
	const model = options.modelInput ? { ...baseModel, input: options.modelInput as typeof baseModel.input } : baseModel;
	const sessionManager = SessionManager.create(tempDir.path(), tempDir.path());
	const extensionRunner =
		options.withCompactionHook || options.withSessionCompactHook
			? await createCompactionHook(tempDir, sessionManager, modelRegistry, {
					beforeCompact: !!options.withCompactionHook,
					sessionCompact: !!options.withSessionCompactHook,
				})
			: undefined;
	const agent = new Agent({
		initialState: {
			model,
			systemPrompt: ["Test"],
			tools: [],
			messages: [],
		},
	});
	const settings = Settings.isolated({
		"compaction.enabled": true,
		"compaction.autoContinue": false,
		"compaction.strategy": options.strategy ?? "snapcompact",
		"compaction.keepRecentTokens": 1,
		"contextPromotion.enabled": false,
	});
	const session = new AgentSession({ agent, sessionManager, settings, modelRegistry, extensionRunner });
	const events: AgentSessionEvent[] = [];
	session.subscribe(event => events.push(event));
	seedConversation(sessionManager, session.agent, CHINESE_TEXT);
	return { tempDir, session, sessionManager, authStorage, events };
}

async function createCompactionHook(
	tempDir: TempDir,
	sessionManager: SessionManager,
	modelRegistry: ModelRegistry,
	options: { beforeCompact?: boolean; sessionCompact?: boolean } = {},
): Promise<ExtensionRunner> {
	const extensionsDir = path.join(getProjectAgentDir(tempDir.path()), "extensions");
	fs.mkdirSync(extensionsDir, { recursive: true });
	const extensionPath = path.join(extensionsDir, "smart-compaction-short-circuit.ts");
	const lines: string[] = [];
	lines.push("export default function(pi) {");
	if (options.sessionCompact) {
		lines.push(
			"\tconst signals = globalThis.__smartCompactionSignals ?? (globalThis.__smartCompactionSignals = []);",
		);
	}
	if (options.beforeCompact) {
		lines.push('\tpi.on("session_before_compact", async (event) => ({');
		lines.push("\t\tcompaction: {");
		lines.push('\t\t\tsummary: "context full summary",');
		lines.push('\t\t\tshortSummary: "context full",');
		lines.push("\t\t\tfirstKeptEntryId: event.preparation.firstKeptEntryId,");
		lines.push("\t\t\ttokensBefore: event.preparation.tokensBefore,");
		lines.push("\t\t\tdetails: { readFiles: [], modifiedFiles: [] },");
		lines.push('\t\t\tpreserveData: { hookKey: "from-hook" },');
		lines.push("\t\t},");
		lines.push("\t}));");
	}
	if (options.sessionCompact) {
		lines.push('\tpi.on("session_compact", async () => { signals.push("session_compact"); });');
	}
	lines.push("}");
	fs.writeFileSync(extensionPath, lines.join("\n"));
	const extensionsResult = await loadExtensions([extensionPath], tempDir.path());
	return new ExtensionRunner(
		extensionsResult.extensions,
		extensionsResult.runtime,
		tempDir.path(),
		sessionManager,
		modelRegistry,
	);
}

function seedConversation(sessionManager: SessionManager, agent: Agent, summarizableText: string): void {
	for (const message of [
		{ role: "user" as const, content: "start", timestamp: Date.now() - 4 },
		{
			role: "assistant" as const,
			content: [{ type: "text" as const, text: summarizableText }],
			api: "anthropic-messages" as const,
			provider: "anthropic" as const,
			model: "claude-sonnet-4-5",
			stopReason: "stop" as const,
			usage: {
				input: 1000,
				output: 1000,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 2000,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			timestamp: Date.now() - 3,
		},
		{ role: "user" as const, content: "continue", timestamp: Date.now() - 2 },
		{
			role: "assistant" as const,
			content: [{ type: "text" as const, text: "recent answer" }],
			api: "anthropic-messages" as const,
			provider: "anthropic" as const,
			model: "claude-sonnet-4-5",
			stopReason: "stop" as const,
			usage: {
				input: 100,
				output: 10,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 110,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			timestamp: Date.now() - 1,
		},
	]) {
		sessionManager.appendMessage(message);
		agent.appendMessage(message);
	}
}
function smartSignals(): string[] {
	const root = globalThis as typeof globalThis & { __smartCompactionSignals?: string[] };
	if (!root.__smartCompactionSignals) root.__smartCompactionSignals = [];
	return root.__smartCompactionSignals;
}

describe("AgentSession smart compaction router", () => {
	let harnesses: Harness[] = [];

	afterEach(async () => {
		for (const harness of harnesses) {
			await harness.session.dispose();
			harness.authStorage.close();
			await harness.tempDir.remove();
		}
		harnesses = [];
		vi.restoreAllMocks();
		smartSignals().length = 0;
	});

	async function harness(options: Parameters<typeof createHarness>[0] = {}): Promise<Harness> {
		const created = await createHarness(options);
		harnesses.push(created);
		return created;
	}

	function thresholdAssistant(h: Harness): AssistantMessage {
		const model = h.session.model;
		if (!model) throw new Error("Expected model to be set");
		return {
			role: "assistant",
			content: [{ type: "text", text: "threshold trigger" }],
			api: model.api,
			provider: model.provider,
			model: model.id,
			stopReason: "stop",
			usage: {
				input: 10_000,
				output: 1_000,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 11_000,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			timestamp: Date.now(),
		};
	}

	function overflowAssistant(h: Harness): AssistantMessage {
		const model = h.session.model;
		if (!model) throw new Error("Expected model to be set");
		return {
			role: "assistant",
			content: [{ type: "text", text: "overflow" }],
			api: model.api,
			provider: model.provider,
			model: model.id,
			stopReason: "error",
			errorMessage: "maximum context length is 200000 tokens, however you requested 200001 tokens",
			usage: {
				input: 120_000,
				output: 0,
				cacheRead: 0,
				cacheWrite: 0,
				totalTokens: 120_000,
				cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			},
			timestamp: Date.now(),
		};
	}

	async function waitForEvent(
		h: Harness,
		predicate: (event: AgentSessionEvent) => boolean,
	): Promise<AgentSessionEvent> {
		const existing = h.events.find(predicate);
		if (existing) return existing;
		const deadline = Date.now() + 5_000;
		while (Date.now() < deadline) {
			await Bun.sleep(5);
			const found = h.events.find(predicate);
			if (found) return found;
		}
		throw new Error("Timed out waiting for event");
	}

	it("manual default /compact falls back to context-full on high non-ASCII snapcompact blocker", async () => {
		const h = await harness({ strategy: "snapcompact" });
		const lastEntryId = h.sessionManager.getBranch().at(-1)?.id;
		if (!lastEntryId) throw new Error("Expected seeded entry id");
		const compactSpy = vi.spyOn(compactionModule, "compact").mockResolvedValue({
			summary: "context full summary",
			shortSummary: "context full",
			firstKeptEntryId: lastEntryId,
			tokensBefore: 100,
			details: { readFiles: [], modifiedFiles: [] },
		});
		const snapcompactSpy = vi.spyOn(snapcompact, "compact");
		vi.spyOn(snapcompact, "scanRenderability").mockReturnValue({ isSafe: false, unrenderableRatio: 0.993 });
		const result = await h.session.compact();

		expect(result.summary).toBe("context full summary");
		expect(snapcompactSpy).not.toHaveBeenCalled();
		expect(compactSpy).toHaveBeenCalledTimes(1);
		expect(h.sessionManager.getEntries().filter(entry => entry.type === "compaction")).toHaveLength(1);
		expect(h.events.map(event => (event.type === "notice" ? event.message : "")).join("\n")).not.toContain(
			"No LLM fallback was attempted",
		);
		expect(
			h.events.some(event => event.type === "notice" && event.message.includes("falling back to context-full")),
		).toBe(true);
	});

	it("explicit /compact snapcompact stays strict and suggests /compact soft", async () => {
		const h = await harness({ strategy: "snapcompact" });
		const compactSpy = vi.spyOn(compactionModule, "compact");
		vi.spyOn(snapcompact, "scanRenderability").mockReturnValue({ isSafe: false, unrenderableRatio: 0.993 });
		await expect(h.session.compact(undefined, { mode: "snapcompact" })).rejects.toThrow(
			"Use /compact or /compact soft",
		);
		expect(compactSpy).not.toHaveBeenCalled();
		expect(h.sessionManager.getEntries().filter(entry => entry.type === "compaction")).toHaveLength(0);
		expect(
			h.events.some(event => event.type === "notice" && event.message.includes("Use /compact or /compact soft")),
		).toBe(true);
	});

	it("manual default /compact falls back when the active model is text-only", async () => {
		const h = await harness({ strategy: "snapcompact", modelInput: ["text"] });
		const entries = h.sessionManager.getBranch();
		const lastEntryId = entries[entries.length - 1]?.id;
		if (!lastEntryId) throw new Error("Expected seeded entry id");
		const compactSpy = vi.spyOn(compactionModule, "compact").mockResolvedValue({
			summary: "context full summary",
			shortSummary: "context full",
			firstKeptEntryId: lastEntryId,
			tokensBefore: 100,
			details: { readFiles: [], modifiedFiles: [] },
		});
		const result = await h.session.compact();
		expect(result.summary).toBe("context full summary");
		expect(compactSpy).toHaveBeenCalledTimes(1);
		expect(h.events.some(event => event.type === "notice" && event.message.includes("vision-capable model"))).toBe(
			true,
		);
		expect(h.events.map(event => (event.type === "notice" ? event.message : "")).join("\n")).not.toContain(
			"No LLM fallback was attempted",
		);
	});

	it("manual default /compact falls back when kept history exhausts the snapcompact frame budget", async () => {
		const h = await harness({ strategy: "snapcompact" });
		vi.spyOn(snapcompact, "scanRenderability").mockReturnValue({ isSafe: true, unrenderableRatio: 0 });
		const snapcompactSpy = vi.spyOn(snapcompact, "compact");
		const entries = h.sessionManager.getBranch();
		const lastEntryId = entries[entries.length - 1]?.id;
		if (!lastEntryId) throw new Error("Expected seeded entry id");
		const compactSpy = vi.spyOn(compactionModule, "compact").mockResolvedValue({
			summary: "context full summary",
			shortSummary: "context full",
			firstKeptEntryId: lastEntryId,
			tokensBefore: 100,
			details: { readFiles: [], modifiedFiles: [] },
		});
		const currentModel = h.session.agent.state.model;
		h.session.agent.setModel({ ...currentModel, contextWindow: 1, maxTokens: 1 });
		h.session.settings.set("compaction.reserveTokens", 0);
		const result = await h.session.compact();
		expect(result.summary).toBe("context full summary");
		expect(compactSpy).toHaveBeenCalledTimes(1);
		expect(snapcompactSpy).not.toHaveBeenCalled();
		expect(h.events.some(event => event.type === "notice" && event.message.includes("Kept history alone"))).toBe(
			true,
		);
	});

	it("auto threshold fallback emits context-full action and does not surface snapcompact blocker", async () => {
		const h = await harness({ strategy: "snapcompact" });
		vi.spyOn(snapcompact, "scanRenderability").mockReturnValue({ isSafe: false, unrenderableRatio: 0.993 });
		const entries = h.sessionManager.getBranch();
		const lastEntryId = entries[entries.length - 1]?.id;
		if (!lastEntryId) throw new Error("Expected seeded entry id");
		vi.spyOn(compactionModule, "compact").mockResolvedValue({
			summary: "context full summary",
			shortSummary: "context full",
			firstKeptEntryId: lastEntryId,
			tokensBefore: 100,
			details: { readFiles: [], modifiedFiles: [] },
		});
		h.session.settings.set("compaction.thresholdPercent", 1);
		h.session.settings.set("contextPromotion.enabled", false);

		const assistant = thresholdAssistant(h);
		h.session.agent.emitExternalEvent({ type: "message_end", message: assistant });
		h.session.agent.emitExternalEvent({ type: "agent_end", messages: [assistant] });

		const endEvent = await waitForEvent(
			h,
			(event): event is Extract<AgentSessionEvent, { type: "auto_compaction_end" }> =>
				event.type === "auto_compaction_end",
		);

		expect(endEvent).toMatchObject({ type: "auto_compaction_end", action: "context-full", aborted: false });
		expect(h.events.map(event => (event.type === "notice" ? event.message : "")).join("\n")).not.toContain(
			"No LLM fallback was attempted",
		);
		expect(h.sessionManager.getEntries().filter(entry => entry.type === "compaction")).toHaveLength(1);
	});

	it("auto threshold uses compaction hook result and skips snapcompact even when scan would be safe", async () => {
		const h = await harness({ strategy: "snapcompact", withCompactionHook: true });
		// Snapcompact renderability would be safe — the guard must still skip it
		// because the hook already produced a compaction result.
		vi.spyOn(snapcompact, "scanRenderability").mockReturnValue({ isSafe: true, unrenderableRatio: 0 });
		const snapcompactCompactSpy = vi.spyOn(snapcompact, "compact");
		h.session.settings.set("compaction.thresholdPercent", 1);
		h.session.settings.set("contextPromotion.enabled", false);

		const assistant = thresholdAssistant(h);
		h.session.agent.emitExternalEvent({ type: "message_end", message: assistant });
		h.session.agent.emitExternalEvent({ type: "agent_end", messages: [assistant] });

		const endEvent = await waitForEvent(
			h,
			(event): event is Extract<AgentSessionEvent, { type: "auto_compaction_end" }> =>
				event.type === "auto_compaction_end",
		);

		expect(endEvent).toMatchObject({ type: "auto_compaction_end", aborted: false });
		expect(snapcompactCompactSpy).not.toHaveBeenCalled();
		expect(h.sessionManager.getEntries().filter(entry => entry.type === "compaction")).toHaveLength(1);
		// The hook's full compaction result must be preserved: summary, details,
		// and preserveData (with no snapcompact archive leaking in).
		const compactionEntry = h.sessionManager
			.getEntries()
			.find(
				entry => entry.type === "compaction" && (entry as { summary?: string }).summary === "context full summary",
			);
		expect(compactionEntry).toBeDefined();
		const entryPreserveData = (compactionEntry as { preserveData?: Record<string, unknown> }).preserveData;
		expect(entryPreserveData).toBeDefined();
		expect(entryPreserveData!.hookKey).toBe("from-hook");
		expect(entryPreserveData!.snapcompact).toBeUndefined();
	});

	it("overflow recovery uses context-full directly when configured strategy is snapcompact", async () => {
		const h = await harness({ strategy: "snapcompact", withCompactionHook: true });
		const snapcompactCompactSpy = vi.spyOn(snapcompact, "compact");
		h.session.settings.set("contextPromotion.enabled", false);

		const assistant = overflowAssistant(h);
		h.session.agent.emitExternalEvent({ type: "message_end", message: assistant });
		h.session.agent.emitExternalEvent({ type: "agent_end", messages: [assistant] });

		const endEvent = await waitForEvent(
			h,
			(event): event is Extract<AgentSessionEvent, { type: "auto_compaction_end" }> =>
				event.type === "auto_compaction_end",
		);

		expect(snapcompactCompactSpy).not.toHaveBeenCalled();
		expect(endEvent).toMatchObject({ type: "auto_compaction_end", action: "context-full", willRetry: true });
		expect(
			h.events.some(
				event => event.type === "notice" && event.message.includes("overflow recovery selected context-full"),
			),
		).toBe(true);
	});

	it("strategy smart records route reason when high non-ASCII falls back", async () => {
		const h = await harness({ strategy: "smart" });
		vi.spyOn(snapcompact, "scanRenderability").mockReturnValue({ isSafe: false, unrenderableRatio: 0.993 });
		const entries = h.sessionManager.getBranch();
		const lastEntryId = entries[entries.length - 1]?.id;
		if (!lastEntryId) throw new Error("Expected seeded entry id");
		vi.spyOn(compactionModule, "compact").mockResolvedValue({
			summary: "context full summary",
			shortSummary: "context full",
			firstKeptEntryId: lastEntryId,
			tokensBefore: 100,
			details: { readFiles: [], modifiedFiles: [] },
		});
		h.session.settings.set("compaction.thresholdPercent", 1);
		h.session.settings.set("contextPromotion.enabled", false);

		const assistant = thresholdAssistant(h);
		h.session.agent.emitExternalEvent({ type: "message_end", message: assistant });
		h.session.agent.emitExternalEvent({ type: "agent_end", messages: [assistant] });

		const endEvent = await waitForEvent(
			h,
			(event): event is Extract<AgentSessionEvent, { type: "auto_compaction_end" }> =>
				event.type === "auto_compaction_end",
		);

		expect(endEvent).toMatchObject({
			type: "auto_compaction_end",
			action: "context-full",
			selectedAction: "context-full",
			routeReason: "high_non_ascii",
			aborted: false,
		});
		expect(h.sessionManager.getEntries().filter(entry => entry.type === "compaction")).toHaveLength(1);
	});

	it("strategy smart still attempts snapcompact when smartFallback is disabled", async () => {
		const h = await harness({ strategy: "smart" });
		h.session.settings.set("compaction.smartFallback", false);
		h.session.settings.set("compaction.thresholdPercent", 1);
		h.session.settings.set("contextPromotion.enabled", false);
		vi.spyOn(snapcompact, "scanRenderability").mockReturnValue({ isSafe: true, unrenderableRatio: 0 });
		const entries = h.sessionManager.getBranch();
		const lastEntryId = entries[entries.length - 1]?.id;
		if (!lastEntryId) throw new Error("Expected seeded entry id");
		const snapcompactSpy = vi.spyOn(snapcompact, "compact").mockResolvedValue({
			summary: "snap summary",
			shortSummary: "snap",
			firstKeptEntryId: lastEntryId,
			tokensBefore: 100,
			details: { readFiles: [], modifiedFiles: [] },
		});
		const assistant = thresholdAssistant(h);
		h.session.agent.emitExternalEvent({ type: "message_end", message: assistant });
		h.session.agent.emitExternalEvent({ type: "agent_end", messages: [assistant] });
		const endEvent = await waitForEvent(
			h,
			(event): event is Extract<AgentSessionEvent, { type: "auto_compaction_end" }> =>
				event.type === "auto_compaction_end",
		);
		expect(snapcompactSpy).toHaveBeenCalledTimes(1);
		expect(endEvent).toMatchObject({
			type: "auto_compaction_end",
			action: "snapcompact",
			selectedAction: "snapcompact",
			aborted: false,
		});
	});
	it("fallback compaction still triggers session_compact hook and syncs todo phases", async () => {
		const h = await harness({ strategy: "snapcompact", withSessionCompactHook: true });
		const phases = [
			{ name: "Phase", tasks: [{ content: "Continue after compact", status: "in_progress" as const }] },
		];
		h.sessionManager.appendCustomEntry(USER_TODO_EDIT_CUSTOM_TYPE, { phases });
		h.session.setTodoPhases([]);
		vi.spyOn(snapcompact, "scanRenderability").mockReturnValue({ isSafe: false, unrenderableRatio: 0.993 });
		const entries = h.sessionManager.getBranch();
		const lastEntryId = entries[entries.length - 1]?.id;
		if (!lastEntryId) throw new Error("Expected seeded entry id");
		vi.spyOn(compactionModule, "compact").mockResolvedValue({
			summary: "context full summary",
			shortSummary: "context full",
			firstKeptEntryId: lastEntryId,
			tokensBefore: 100,
			details: { readFiles: [], modifiedFiles: [] },
		});
		await h.session.compact();
		expect(smartSignals()).toEqual(["session_compact"]);
		expect(h.session.getTodoPhases()).toEqual(phases);
		expect(h.sessionManager.getEntries().filter(entry => entry.type === "compaction")).toHaveLength(1);
	});
});
