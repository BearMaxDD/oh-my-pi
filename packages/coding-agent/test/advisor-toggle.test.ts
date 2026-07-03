import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "bun:test";
import * as path from "node:path";
import { Agent } from "@oh-my-pi/pi-agent-core";
import type { Model } from "@oh-my-pi/pi-ai";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { TempDir } from "@oh-my-pi/pi-utils";

describe("AgentSession advisor toggle", () => {
	let sharedDir: TempDir;
	let authStorage: AuthStorage;
	let modelRegistry: ModelRegistry;
	let model: Model;
	let alternateAdvisorModel: Model;

	function createTestAgent(): Agent {
		return new Agent({
			initialState: {
				model,
				systemPrompt: ["Test"],
				tools: [],
				messages: [],
			},
		});
	}

	beforeAll(async () => {
		sharedDir = TempDir.createSync("@pi-advisor-toggle-shared-");
		authStorage = await AuthStorage.create(path.join(sharedDir.path(), "testauth.db"));
		authStorage.setRuntimeApiKey("anthropic", "test-key");
		modelRegistry = new ModelRegistry(authStorage);
		const bundled = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!bundled) throw new Error("Expected built-in anthropic model to exist");
		model = bundled;
		const alternate = getBundledModel("anthropic", "claude-opus-4-5");
		if (!alternate) throw new Error("Expected built-in anthropic alternate advisor model to exist");
		alternateAdvisorModel = alternate;
	});

	afterAll(async () => {
		authStorage.close();
		try {
			await sharedDir.remove();
		} catch {}
	});

	let tempDir: TempDir;
	let session: AgentSession;
	let sessionManager: SessionManager;

	beforeEach(async () => {
		tempDir = TempDir.createSync("@pi-advisor-toggle-");
		sessionManager = SessionManager.create(tempDir.path(), tempDir.path());
		const agent = createTestAgent();
		const settings = Settings.isolated({ "compaction.enabled": false });
		session = new AgentSession({
			agent,
			sessionManager,
			settings,
			modelRegistry,
			advisorReadOnlyTools: [],
		});
	});

	afterEach(async () => {
		await session.dispose();
		try {
			await tempDir.remove();
		} catch {}
	});

	it("starts with advisor disabled", () => {
		expect(session.isAdvisorActive()).toBe(false);
		expect(session.isAdvisorEnabled()).toBe(false);
		expect(session.formatAdvisorStatus()).toBe("Advisor is disabled.");
	});

	it("toggle enables the advisor and runtime", () => {
		session.settings.setModelRole("advisor", "anthropic/claude-sonnet-4-5");
		const active = session.toggleAdvisorEnabled();
		expect(active).toBe(true);
		expect(session.isAdvisorActive()).toBe(true);
		expect(session.isAdvisorEnabled()).toBe(true);
		expect(session.formatAdvisorStatus()).toContain("Advisor is enabled (anthropic/claude-sonnet-4-5)");
	});

	it("switches the active advisor model with a runtime role override", () => {
		session.settings.setModelRole("advisor", "anthropic/claude-sonnet-4-5");
		expect(session.setAdvisorEnabled(true)).toBe(true);
		expect(session.formatAdvisorStatus()).toContain("Advisor is enabled (anthropic/claude-sonnet-4-5)");

		const switched = session.switchAdvisorModel(`${alternateAdvisorModel.provider}/${alternateAdvisorModel.id}`, {
			scope: "current-run",
			reasonCode: "quality_risk",
			evidence: ["unit test requested a stronger advisor"],
		});

		expect(switched).toBe(true);
		expect(session.isAdvisorActive()).toBe(true);
		expect(session.formatAdvisorStatus()).toContain(
			`Advisor is enabled (${alternateAdvisorModel.provider}/${alternateAdvisorModel.id})`,
		);
		expect(session.settings.getModelRole("advisor")).toBe(
			`${alternateAdvisorModel.provider}/${alternateAdvisorModel.id}`,
		);

		session.settings.clearOverride("modelRoles");
		expect(session.settings.getModelRole("advisor")).toBe("anthropic/claude-sonnet-4-5");
	});

	it("reports the live advisor model assignment source", () => {
		session.settings.setModelRole("advisor", "anthropic/claude-sonnet-4-5");
		expect(session.setAdvisorEnabled(true)).toBe(true);

		expect(session.getAdvisorModelAssignment()).toEqual({
			role: "advisor",
			model: "anthropic/claude-sonnet-4-5",
			displayName: "claude-sonnet-4-5",
			source: "modelRoles",
			scope: "current-run",
		});

		expect(
			session.switchAdvisorModel(`${alternateAdvisorModel.provider}/${alternateAdvisorModel.id}`, {
				scope: "current-run",
				reasonCode: "quality_risk",
				evidence: ["unit test requested a stronger advisor"],
			}),
		).toBe(true);

		expect(session.getAdvisorModelAssignment()).toEqual({
			role: "advisor",
			model: `${alternateAdvisorModel.provider}/${alternateAdvisorModel.id}`,
			displayName: alternateAdvisorModel.id,
			source: "runtimeOverride",
			scope: "current-run",
		});
	});

	it("reports a disabled advisor runtime switch as runtimeOverride once enabled", () => {
		session.settings.setModelRole("advisor", "anthropic/claude-sonnet-4-5");
		expect(session.isAdvisorActive()).toBe(false);

		expect(
			session.switchAdvisorModel(`${alternateAdvisorModel.provider}/${alternateAdvisorModel.id}`, {
				scope: "current-run",
				reasonCode: "quality_risk",
				evidence: ["unit test selected advisor before enabling"],
			}),
		).toBe(false);
		expect(session.setAdvisorEnabled(true)).toBe(true);

		expect(session.getAdvisorModelAssignment()).toEqual({
			role: "advisor",
			model: `${alternateAdvisorModel.provider}/${alternateAdvisorModel.id}`,
			displayName: alternateAdvisorModel.id,
			source: "runtimeOverride",
			scope: "current-run",
		});
	});

	it("returns advisor assignment source to modelRoles after clearing a runtime override", () => {
		session.settings.setModelRole("advisor", "anthropic/claude-sonnet-4-5");
		expect(session.setAdvisorEnabled(true)).toBe(true);
		expect(
			session.switchAdvisorModel(`${alternateAdvisorModel.provider}/${alternateAdvisorModel.id}`, {
				scope: "current-run",
				reasonCode: "quality_risk",
				evidence: ["unit test selected a temporary advisor"],
			}),
		).toBe(true);
		expect(session.getAdvisorModelAssignment()?.source).toBe("runtimeOverride");

		expect(session.setAdvisorEnabled(false)).toBe(false);
		session.settings.clearOverride("modelRoles");
		expect(session.setAdvisorEnabled(true)).toBe(true);

		expect(session.getAdvisorModelAssignment()).toEqual({
			role: "advisor",
			model: "anthropic/claude-sonnet-4-5",
			displayName: "claude-sonnet-4-5",
			source: "modelRoles",
			scope: "current-run",
		});
	});

	it("explicit enable overrides default-off setting for the session only", () => {
		session.settings.setModelRole("advisor", "anthropic/claude-sonnet-4-5");
		session.settings.override("advisor.enabled", false);
		const customSession = new AgentSession({
			agent: session.agent,
			sessionManager,
			settings: session.settings,
			modelRegistry,
			advisorReadOnlyTools: [],
		});
		expect(customSession.isAdvisorEnabled()).toBe(false);

		const active = customSession.setAdvisorEnabled(true);

		expect(active).toBe(true);
		expect(customSession.isAdvisorActive()).toBe(true);
		expect(customSession.isAdvisorEnabled()).toBe(true);
		expect(customSession.settings.get("advisor.enabled")).toBe(false);
	});

	it("toggle disables the advisor and runtime", () => {
		session.settings.setModelRole("advisor", "anthropic/claude-sonnet-4-5");
		session.toggleAdvisorEnabled();
		const active = session.toggleAdvisorEnabled();
		expect(active).toBe(false);
		expect(session.isAdvisorActive()).toBe(false);
		expect(session.isAdvisorEnabled()).toBe(false);
	});

	it("setAdvisorEnabled reports inactive when the advisor role resolves to no model", () => {
		// The advisor role falls back to the `slow` priority chain when unset, so an
		// unset role still resolves a model. The inactive-but-enabled path is only
		// reached when the configured advisor model cannot be resolved at all.
		session.settings.setModelRole("advisor", "nonexistent/advisor-model");
		const active = session.setAdvisorEnabled(true);
		expect(active).toBe(false);
		expect(session.isAdvisorActive()).toBe(false);
		expect(session.isAdvisorEnabled()).toBe(true);
		expect(session.formatAdvisorStatus()).toBe(
			"Advisor setting is enabled, but no model is assigned to the 'advisor' role.",
		);
	});

	it("keeps sessions isolated when sharing a Settings instance", async () => {
		const sharedSettings = Settings.isolated({ "compaction.enabled": false });
		sharedSettings.setModelRole("advisor", "anthropic/claude-sonnet-4-5");
		expect(sharedSettings.get("advisor.enabled")).toBe(false);

		const sessionA = new AgentSession({
			agent: session.agent,
			sessionManager,
			settings: sharedSettings,
			modelRegistry,
			advisorReadOnlyTools: [],
		});
		const sessionB = new AgentSession({
			agent: session.agent,
			sessionManager,
			settings: sharedSettings,
			modelRegistry,
			advisorReadOnlyTools: [],
		});

		expect(sessionA.isAdvisorEnabled()).toBe(false);
		expect(sessionB.isAdvisorEnabled()).toBe(false);

		const activeA = sessionA.setAdvisorEnabled(true);
		expect(activeA).toBe(true);
		expect(sessionA.isAdvisorEnabled()).toBe(true);
		expect(sessionA.isAdvisorActive()).toBe(true);

		expect(sessionB.isAdvisorEnabled()).toBe(false);
		expect(sessionB.isAdvisorActive()).toBe(false);
		expect(sessionB.formatAdvisorStatus()).toBe("Advisor is disabled.");

		const activeB = sessionB.toggleAdvisorEnabled();
		expect(activeB).toBe(true);
		expect(sessionB.isAdvisorEnabled()).toBe(true);

		sessionA.setAdvisorEnabled(false);
		expect(sessionA.isAdvisorEnabled()).toBe(false);
		expect(sessionA.isAdvisorActive()).toBe(false);

		expect(sessionB.isAdvisorEnabled()).toBe(true);
		expect(sessionB.isAdvisorActive()).toBe(true);
	});

	it("starts advisor for subagents from advisor.subagents without enabling the main advisor", async () => {
		const sharedSettings = Settings.isolated({
			"advisor.enabled": false,
			"advisor.subagents": true,
			"compaction.enabled": false,
		});
		sharedSettings.setModelRole("advisor", "anthropic/claude-sonnet-4-5");
		const mainSession = new AgentSession({
			agent: createTestAgent(),
			sessionManager,
			settings: sharedSettings,
			modelRegistry,
			advisorReadOnlyTools: [],
		});
		const subSession = new AgentSession({
			agent: createTestAgent(),
			sessionManager,
			settings: sharedSettings,
			modelRegistry,
			advisorReadOnlyTools: [],
			agentKind: "sub",
		});

		try {
			expect(mainSession.isAdvisorEnabled()).toBe(false);
			expect(mainSession.isAdvisorActive()).toBe(false);
			expect(subSession.isAdvisorEnabled()).toBe(true);
			expect(subSession.isAdvisorActive()).toBe(true);
		} finally {
			await subSession.dispose();
			await mainSession.dispose();
		}
	});
});
