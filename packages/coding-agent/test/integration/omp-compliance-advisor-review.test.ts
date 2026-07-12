/**
 * Cross-repo integration test for the OMP Compliance Advisor Extension.
 *
 * TDD: this test is written against the real built extension before
 * deleting the old ComplianceVerdictTool bridge.
 *
 * Loads the extension via loadExtensions(), creates an ExtensionRunner
 * and an AgentSession with advisor enabled, then drives the full
 * compliance lifecycle:
 *   compliance start -> write evidence -> compliance_complete ->
 *   fake advisor review (emit advisor_before_run, assert augmentation,
 *   call compliance_verdict with pass fixture) -> assert completed ->
 *   assert no compliance tool on normal turns.
 */

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { Agent } from "@oh-my-pi/pi-agent-core";
import { createMockModel, type MockModel } from "@oh-my-pi/pi-ai/providers/mock";
import { getBundledModel } from "@oh-my-pi/pi-catalog/models";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { loadExtensions } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/loader";
import { ExtensionRunner } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/runner";
import type {
	AdvisorBeforeRunEvent,
	LoadExtensionsResult,
} from "@oh-my-pi/pi-coding-agent/extensibility/extensions/types";
import { AgentSession } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";
import { TempDir } from "@oh-my-pi/pi-utils";

// ---------------------------------------------------------------------------
// Resolve extension entry from env var
// ---------------------------------------------------------------------------

const compliancePackageDir: string | undefined = process.env.OMP_COMPLIANCE_PACKAGE;
const extensionEntryPath: string = compliancePackageDir ? path.join(compliancePackageDir, "dist", "extension.js") : "";

// ---------------------------------------------------------------------------
// Default TDD contract fixture
// ---------------------------------------------------------------------------

const DEFAULT_TDD_CONTENT = [
	"# Goal: Build the feature",
	"",
	"## Scope",
	"- core module",
	"- user registration",
	"",
	"## Files",
	"- src/index.ts",
	"- src/routes/register.ts",
	"- src/middleware/auth.ts",
	"",
	"## Tests",
	"- bun test passes",
	"- registration returns 201",
	"- invalid input returns 400",
	"",
	"## Verification",
	"- bun test",
	"- biome check",
	"",
	"## Completion Criteria",
	"- all passing",
	"- coverage 80%",
	"",
].join("\n");

// ---------------------------------------------------------------------------
// Suite
// ---------------------------------------------------------------------------

describe("OMP Compliance Advisor Extension -- cross-repo integration", () => {
	let tmpDir: TempDir;
	let session: AgentSession;
	let sessionManager: SessionManager;
	let authStorage: AuthStorage;
	let modelRegistry: ModelRegistry;
	let extensionRunner: ExtensionRunner;
	let tddPath: string;
	let extensionsResult: LoadExtensionsResult;
	let advisorMock: MockModel;
	let currentTaskId = "";
	let currentContractHash = "";
	let currentAttempt = 0;
	let hookSawFrozenMessages = false;
	const originalPrimaryMessage = "primary transcript must remain unchanged";

	beforeEach(async () => {
		if (!compliancePackageDir) {
			throw new Error("Missing OMP_COMPLIANCE_PACKAGE env var -- set it to the omp-compliance package path");
		}
		if (!fs.existsSync(extensionEntryPath)) {
			throw new Error(`Extension entry not found at ${extensionEntryPath}`);
		}

		tmpDir = TempDir.createSync("@omp-compliance-integration-");

		// Write TDD contract inside the fork repo because the extension reads
		// process.cwd() as repoRoot and validates TDD is inside repo root.
		const testDir = path.join(process.cwd(), ".omp-test-tdd");
		fs.mkdirSync(testDir, { recursive: true });
		tddPath = path.join(testDir, "tdd.md");
		fs.writeFileSync(tddPath, DEFAULT_TDD_CONTENT, "utf-8");

		// Load the compliance extension
		extensionsResult = await loadExtensions([extensionEntryPath], tmpDir.path());
		expect(extensionsResult.extensions).toHaveLength(1);
		expect(extensionsResult.errors).toEqual([]);
		const beforeRunHandlers = extensionsResult.extensions[0].handlers.get("advisor_before_run") ?? [];
		beforeRunHandlers.push(async (event: unknown) => {
			const messages = (event as { messages?: ReadonlyArray<{ content?: unknown }> }).messages;
			hookSawFrozenMessages = Object.isFrozen(messages);
			if (messages?.[0]) messages[0].content = "extension mutation";
		});
		extensionsResult.extensions[0].handlers.set("advisor_before_run", beforeRunHandlers);

		// Setup auth and model
		authStorage = await AuthStorage.create(path.join(tmpDir.path(), "testauth.db"));
		modelRegistry = new ModelRegistry(authStorage);
		authStorage.setRuntimeApiKey("anthropic", "test-key");
		sessionManager = SessionManager.inMemory();
		advisorMock = createMockModel({
			handler: context => {
				const hasVerdictTool = context.tools?.some(tool => tool.name === "compliance_verdict") ?? false;
				if (hasVerdictTool) {
					return {
						content: [
							{
								type: "toolCall",
								name: "compliance_verdict",
								arguments: {
									schema_version: 1,
									task_id: currentTaskId,
									contract_hash: currentContractHash,
									attempt: currentAttempt,
									status: "pass",
									findings: [{ id: "review-1", reason: "All checks passed" }],
								},
							},
						],
					};
				}
				return { content: ["Review completed."] };
			},
		});

		// Create extension runner
		extensionRunner = new ExtensionRunner(
			extensionsResult.extensions,
			extensionsResult.runtime,
			tmpDir.path(),
			sessionManager,
			modelRegistry,
		);
		extensionRunner.initialize(
			{
				sendMessage: () => {},
				sendUserMessage: () => {},
				appendEntry: () => {},
				setLabel: () => {},
				getActiveTools: () => [],
				getAllTools: () => [],
				setActiveTools: async () => {},
				getCommands: () => [],
				setModel: async () => false,
				getThinkingLevel: () => undefined,
				setThinkingLevel: () => {},
				getSessionName: () => undefined,
				setSessionName: async () => {},
				requestAdvisorReview: request => session.requestAdvisorReview(request),
			},
			{
				getModel: () => undefined,
				isIdle: () => true,
				abort: () => {},
				hasPendingMessages: () => false,
				shutdown: () => {},
				getContextUsage: () => undefined,
				getSystemPrompt: () => [],
				compact: async () => {},
			},
		);

		// Emit session_start so the extension captures a sessionId
		await extensionRunner.emit({ type: "session_start" });

		// Create AgentSession with advisor enabled
		const bundled = getBundledModel("anthropic", "claude-sonnet-4-5");
		if (!bundled) throw new Error("Expected built-in anthropic model");
		const model = { ...bundled };

		const agent = new Agent({
			getApiKey: () => "test-key",
			initialState: {
				model,
				systemPrompt: ["test"],
				tools: [],
				messages: [{ role: "user", content: originalPrimaryMessage, timestamp: Date.now() }],
			},
		});

		session = new AgentSession({
			agent,
			sessionManager,
			settings: Settings.isolated({
				"advisor.enabled": true,
			}),
			modelRegistry,
			extensionRunner,
			advisorStreamFn: advisorMock.stream,
		});
		session.settings.setModelRole("advisor", "anthropic/claude-sonnet-4-5");
		expect(session.setAdvisorEnabled(true)).toBe(true);
		session.subscribe(() => {});
	});

	afterEach(async () => {
		try {
			await session.dispose();
		} catch {
			// dispose may throw if already disposed
		}
		authStorage?.close();
		tmpDir?.removeSync();

		// Clean up test artifacts written to fork repo
		const testDir = path.join(process.cwd(), ".omp-test-tdd");
		if (fs.existsSync(testDir)) {
			fs.rmSync(testDir, { recursive: true, force: true });
		}
		const evidenceDir = path.join(process.cwd(), ".omp", "compliance");
		if (fs.existsSync(evidenceDir)) {
			fs.rmSync(evidenceDir, { recursive: true, force: true });
		}
	});

	it("drives the full compliance lifecycle: start -> complete -> advisor review -> pass -> completed", async () => {
		const ext = extensionsResult.extensions[0];
		const evidenceDir = path.join(process.cwd(), ".omp", "compliance");

		// -----------------------------------------------------------------------
		// 1. Execute compliance start via the extension's registered command
		// -----------------------------------------------------------------------
		const cmd = ext.commands.get("compliance");
		expect(cmd).toBeDefined();

		// tddPath is absolute and inside the repo root
		// Extension command handler expects string[], not the OMP RegisteredCommand type.
		const cmdHandler = cmd!.handler as unknown as (args: string[]) => Promise<void>;
		await cmdHandler(["start", tddPath]);
		// Find evidence files written by start
		const evidenceFilesAfterStart = fs.readdirSync(evidenceDir).filter(f => f.endsWith(".jsonl"));
		expect(evidenceFilesAfterStart.length).toBeGreaterThan(0);

		// Read the first evidence record to extract task identity
		const taskIdFromEvidence = evidenceFilesAfterStart[0].replace(/\.jsonl$/, "");
		const jsonlContent = await fs.promises.readFile(path.join(evidenceDir, `${taskIdFromEvidence}.jsonl`), "utf-8");
		const startRecords = jsonlContent
			.split("\n")
			.filter(Boolean)
			.map(line => JSON.parse(line));
		expect(startRecords.length).toBeGreaterThan(0);
		const startRecord = startRecords[0] as Record<string, unknown>;
		expect(startRecord.event).toBe("active");

		const taskId = startRecord.taskId as string;
		const contractHash = startRecord.contractHash as string;
		const attempt = startRecord.attempt as number;
		currentTaskId = taskId;
		currentContractHash = contractHash;
		currentAttempt = attempt;
		expect(taskId).toBeTruthy();
		expect(contractHash).toBeTruthy();
		expect(typeof attempt).toBe("number");

		// -----------------------------------------------------------------------
		// 2. Execute compliance_complete tool
		// -----------------------------------------------------------------------
		const completeTool = ext.tools.get("compliance_complete");
		expect(completeTool).toBeDefined();
		const toolDef = completeTool!.definition;
		// Tool definition uses extension's own type (handler, not execute)
		const handlerFn =
			"handler" in toolDef
				? (toolDef as unknown as { handler: (p: Record<string, unknown>) => Promise<unknown> }).handler
				: undefined;
		expect(handlerFn).toBeDefined();

		const completeResult = (await handlerFn!({
			summary: "Implemented the feature -- all tests pass",
			claimed_verification: ["bun test passes", "biome check clean"],
		})) as Record<string, unknown>;

		expect(completeResult.success).toBe(true);
		const reviewId = completeResult.reviewId as string;
		expect(reviewId).toBeTruthy();
		expect(completeResult.status).toBe("advisor_reviewing");
		expect(completeResult.receipt).toMatchObject({ status: "accepted", reviewId });

		// Verify completion_requested evidence
		const afterCompleteJsonl = await fs.promises.readFile(path.join(evidenceDir, `${taskId}.jsonl`), "utf-8");
		const afterCompleteRecords = afterCompleteJsonl
			.split("\n")
			.filter(Boolean)
			.map(line => JSON.parse(line));
		const hasRequested = afterCompleteRecords.some(
			(r: Record<string, unknown>) => r.event === "completion_requested",
		);
		expect(hasRequested).toBe(true);
		expect(afterCompleteRecords.some((r: Record<string, unknown>) => r.event === "advisor_review_accepted")).toBe(
			true,
		);

		// The real Advisor runtime must invoke compliance_verdict through AgentTool.execute.
		for (let i = 0; i < 100; i++) {
			const records = (await fs.promises.readFile(path.join(evidenceDir, `${taskId}.jsonl`), "utf-8"))
				.split("\n")
				.filter(Boolean)
				.map(line => JSON.parse(line) as Record<string, unknown>);
			if (records.some(record => record.event === "completed")) break;
			await Bun.sleep(10);
		}
		expect(advisorMock.calls.length).toBeGreaterThanOrEqual(1);
		const reviewCall = advisorMock.calls.find(call =>
			call.context.tools?.some(tool => tool.name === "compliance_verdict"),
		);
		expect(reviewCall).toBeDefined();
		expect(hookSawFrozenMessages).toBe(true);
		expect((session.agent.state.messages[0] as { content?: unknown } | undefined)?.content).toBe(
			originalPrimaryMessage,
		);

		// Verify completed evidence
		const afterVerdictJsonl = await fs.promises.readFile(path.join(evidenceDir, `${taskId}.jsonl`), "utf-8");
		const afterVerdictRecords = afterVerdictJsonl
			.split("\n")
			.filter(Boolean)
			.map(line => JSON.parse(line));
		const hasCompleted = afterVerdictRecords.some((r: Record<string, unknown>) => r.event === "completed");
		expect(hasCompleted).toBe(true);

		// -----------------------------------------------------------------------
		// 5. Emit advisor_before_run with a normal turn_end trigger -- assert
		//    no compliance tool
		// -----------------------------------------------------------------------
		const normalTurnEvent: AdvisorBeforeRunEvent = {
			type: "advisor_before_run",
			sessionId: "test-session-id",
			advisorId: "advisor-1",
			trigger: "turn_end",
			messages: Object.freeze([]) as readonly [],
		};

		const normalAugmentation = await extensionRunner.emitBeforeRun(normalTurnEvent);
		expect(normalAugmentation).toBeUndefined();
	});

	it("getAdvisorAvailableToolNames does NOT include compliance_verdict (old bridge deleted)", () => {
		const names = session.getAdvisorAvailableToolNames();
		expect(names).not.toContain("compliance_verdict");
	});
});
