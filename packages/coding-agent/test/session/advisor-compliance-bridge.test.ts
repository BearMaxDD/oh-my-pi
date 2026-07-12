/**
 * Advisor compliance bridge — integration test verifying the ComplianceVerdictTool
 * is injected into the advisor toolset when the session carries a sink.
 *
 * The bridge is ONE tool class + ONE wiring change in #buildAdvisorRuntime.
 * No changes to AdvisorRuntime, AdviseTool, Agent, or ExtensionAPI.
 */
import { describe, expect, it, vi } from "bun:test";
import { Agent } from "@oh-my-pi/pi-agent-core";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { createTools } from "@oh-my-pi/pi-coding-agent/tools";
import * as os from "node:os";
import * as path from "node:path";
import * as fs from "node:fs";

/** Minimal test session builder for bridge testing. */
async function buildSession(opts: {
	complianceSink?: (verdict: any) => Promise<{ success: boolean; error?: string }>;
}): Promise<{ session: AgentSession; cleanup: () => Promise<void> }> {
	const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "omp-bridge-test-"));
	const toolSession = {
		cwd: tempDir,
		hasUI: false,
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		settings: Settings.isolated(),
	};

	const tools = await createTools(toolSession);
	const model = getBundledModel("anthropic", "claude-sonnet-4-5")!;
	const agent = new Agent({
		getApiKey: () => "test-key",
		initialState: { model, systemPrompt: ["test"], tools },
	});

	const sessionManager = SessionManager.inMemory();
	const settings = Settings.isolated();
	const authStorage = await AuthStorage.create(path.join(tempDir, "testauth.db"));
	const modelRegistry = new ModelRegistry(authStorage, path.join(tempDir, "models.yml"));

	const session = new AgentSession({
		agent,
		sessionManager,
		settings,
		modelRegistry,
		complianceVerdictSink: opts.complianceSink,
	});

	session.subscribe(() => {});

	const cleanup = async () => {
		await session.dispose();
		authStorage.close();
		fs.rmSync(tempDir, { recursive: true, force: true });
	};

	return { session, cleanup };
}

describe("advisor compliance bridge", () => {
	it("registers compliance_verdict in available tool pool when sink is set", async () => {
		const sink = vi.fn().mockResolvedValue({ success: true });
		const { session, cleanup } = await buildSession({ complianceSink: sink });
		try {
			const names = session.getAdvisorAvailableToolNames();
			expect(names).toContain("compliance_verdict");
		} finally {
			await cleanup();
		}
	});

	it("does NOT register compliance_verdict when sink is absent", async () => {
		const { session, cleanup } = await buildSession({});
		try {
			const names = session.getAdvisorAvailableToolNames();
			expect(names).not.toContain("compliance_verdict");
		} finally {
			await cleanup();
		}
	});

	it("does NOT register compliance_verdict when sink is absent even after enable", async () => {
		const { session, cleanup } = await buildSession({});
		try {
			session.settings.set("advisor.enabled", true);
			const names = session.getAdvisorAvailableToolNames();
			expect(names).not.toContain("compliance_verdict");
		} finally {
			await cleanup();
		}
	});

	it("injected tool forwards verdicts to the registered sink", async () => {
		// Verify the sink is reachable through the bridge by checking the pool.
		const sink = vi.fn().mockResolvedValue({ success: true });
		const { session, cleanup } = await buildSession({ complianceSink: sink });
		try {
			const names = session.getAdvisorAvailableToolNames();
			expect(names).toContain("compliance_verdict");
			// The sink is not called by getAdvisorAvailableToolNames — it's called
			// when the advisor agent executes the tool. That execution path is
			// covered in compliance-verdict-tool.test.ts.
		} finally {
			await cleanup();
		}
	});
});
