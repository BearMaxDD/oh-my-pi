/**
 * Strict role execution — runSubprocess strict path.
 *
 * Contract:
 * 1. strictRoleExecutionPlan bypasses auth/parent/retry fallback and passes
 *    binding.model to createAgentSession.
 * 2. Revalidation mismatch rejects with role_model_mismatch before session
 *    creation (createAgentSession never called).
 * 3. Actual-evidence writer rejection rejects with routing_evidence_write_failed
 *    before session creation (createAgentSession never called).
 * 4. Existing wall-clock timeouts are unchanged (legacy regression).
 */

import { afterEach, describe, expect, it, vi } from "bun:test";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import type { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import type { LoadExtensionsResult } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/types";
import type { CreateAgentSessionResult } from "@oh-my-pi/pi-coding-agent/sdk";
import * as sdkModule from "@oh-my-pi/pi-coding-agent/sdk";
import type { AgentSession, AgentSessionEvent, PromptOptions } from "@oh-my-pi/pi-coding-agent/session/agent-session";
import { runSubprocess } from "@oh-my-pi/pi-coding-agent/task/executor";
import type { AgentDefinition } from "@oh-my-pi/pi-coding-agent/task/types";
import { EventBus } from "@oh-my-pi/pi-coding-agent/utils/event-bus";
import * as evidenceModule from "../../src/codex-plan-run/model-routing-evidence";
import type { StrictRoleExecutionPlan } from "../../src/codex-plan-run/role-bound-stage-scheduler";
import * as modelResolver from "../../src/config/model-resolver";
import type { AgentProgress } from "../../src/task/types";

// ── Fixtures ─────────────────────────────────────────────────────

/** A minimal AgentSession that yields nothing and never hangs. */
function createSilentSession(): AgentSession {
	const session: Partial<AgentSession> = {
		state: { messages: [] } as never,
		agent: { state: { systemPrompt: ["test"] } } as never,
		extensionRunner: undefined as never,
		sessionManager: {
			appendSessionInit: () => {},
		} as never,
		getActiveToolNames: () => ["read", "yield"],
		setActiveToolsByName: async (_names: string[]) => {},
		subscribe: (_listener: (event: AgentSessionEvent) => void) => () => {},
		prompt: async (_text: string, _options?: PromptOptions) => true,
		waitForIdle: async () => {},
		getLastAssistantMessage: () => undefined,
		abort: async () => {},
		dispose: async () => {},
	};
	return session as AgentSession;
}

function mockCreateAgentSession(session: AgentSession) {
	return vi.spyOn(sdkModule, "createAgentSession").mockResolvedValue({
		session,
		extensionsResult: {} as unknown as LoadExtensionsResult,
		setToolUIContext: () => {},
		eventBus: new EventBus(),
	} satisfies CreateAgentSessionResult);
}

const baseAgent: AgentDefinition = {
	name: "task",
	description: "test",
	systemPrompt: "test",
	source: "bundled",
};

/** Model fixture for a concrete, resolvable model. */
const modelFixture = buildModel({
	id: "claude-sonnet-4-20250514",
	provider: "anthropic",
	api: "anthropic-messages",
	name: "anthropic/claude-sonnet-4-20250514",
	baseUrl: "https://api.anthropic.com",
	input: ["text"] as ("text" | "image")[],
	cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
	contextWindow: 200_000,
	maxTokens: 8_192,
	reasoning: false,
});
const strictReadyRegistry = {
	refresh: async () => {},
	getAvailable: () => [modelFixture],
	getModel: () => undefined,
	authStorage: { getApiKey: async () => undefined },
} as unknown as ModelRegistry;

const baseOptions = {
	cwd: "/tmp",
	agent: baseAgent,
	task: "do work",
	index: 0,
	id: "strict-role-agent",
	modelRegistry: strictReadyRegistry,
	enableLsp: false,
};

/** Build a minimal StrictRoleExecutionPlan fixture with a given binding model. */
function strictPlanFixture(bindingModel: typeof modelFixture = modelFixture): StrictRoleExecutionPlan {
	const roleId = "superpowers:implementer";
	return {
		decision: {
			source: "explicit_stage" as const,
			selectedRoleId: roleId,
			confidence: 1,
			reasons: ["explicit stage assignment"],
			candidates: [
				{
					roleId,
					confidence: 1,
					reason: "explicit stage assignment",
				},
			],
		},
		contract: {
			passed: true,
			roleId,
			contractVersion: "1.0",
			checks: [],
		},
		binding: {
			schemaVersion: 1 as const,
			contractVersion: "1.0",
			roleId,
			configuredSelector: "anthropic/claude-sonnet-4-20250514",
			provider: bindingModel.provider,
			modelId: bindingModel.id,
			modelRef: `${bindingModel.provider}/${bindingModel.id}`,
			model: bindingModel,
			thinkingSource: "model_default" as const,
			thinkingLevel: undefined,
			canonicalSelector: "anthropic/claude-sonnet-4-20250514",
			createdAt: "2026-07-10T00:00:00.000Z",
			bindingHash: "fcec765aea064e3c9fb620faa1aa9bf61d02b0372c5020134639aa1ae58503f8",
		},
		evidence: {
			path: "/tmp/tasks/task-1/model-routing-evidence.json",
			acceptingDir: "/tmp",
			status: "preflight_passed" as const,
			preflight: {
				schema_version: 2,
				run_id: "run-abc",
				task_id: "task-1",
				stage_id: "implementer",
				model_role: "superpowers:implementer",
				requested_model: "anthropic/claude-sonnet-4-20250514",
				resolved_model: "anthropic/claude-sonnet-4-20250514",
				fallback_roles: [],
				fallback_used: false,
				thinking_level: "model_default",
				status: "preflight_passed",
				timestamps: { created_at: "2026-07-10T00:00:00.000Z", updated_at: "2026-07-10T00:00:00.000Z" },
				role_decision: {
					decision_id: "run-abc:task-1:implementer:explicit_stage",
					source: "explicit_stage",
					selected_role_id: "superpowers:implementer",
					confidence: 1,
					candidates: [{ role_id: "superpowers:implementer", confidence: 1, reason: "explicit stage assignment" }],
					reasons: ["explicit stage assignment"],
				},
				contract_validation: {
					contract_version: "1.0",
					passed: true,
					checks: [],
				},
				model_binding: {
					configured_selector: "anthropic/claude-sonnet-4-20250514",
					provider: bindingModel.provider,
					model_id: bindingModel.id,
					thinking_source: "model_default",
					thinking_level: "model_default",
					binding_hash: "fcec765aea064e3c9fb620faa1aa9bf61d02b0372c5020134639aa1ae58503f8",
				},
			},
		} as StrictRoleExecutionPlan["evidence"] & {
			acceptingDir: string;
			preflight: Record<string, unknown>;
		},
	};
}

// ── Tests ────────────────────────────────────────────────────────

describe("runSubprocess strict role execution", () => {
	afterEach(() => {
		vi.restoreAllMocks();
	});

	it("bypasses auth/parent/retry fallback and passes binding.model to createAgentSession", async () => {
		const session = createSilentSession();
		const createSessionSpy = mockCreateAgentSession(session);
		vi.spyOn(evidenceModule, "writeModelRoutingEvidenceV2").mockResolvedValue("/tmp/evidence.json");
		const fallbackSpy = vi.spyOn(modelResolver, "resolveModelOverrideWithAuthFallback");

		const plan = strictPlanFixture();

		// ── RED phase ──────────────────────────────────────────────────────
		// runSubprocess does NOT currently destructure
		// strictRoleExecutionPlan from options.  The legacy model-resolution
		// path fires (fallbackSpy IS called) and createAgentSession is called
		// with an undefined/shadow model, NOT plan.binding.model.
		//
		// Once the strict branch is wired (GREEN), the executor will:
		//   1. Bypass the auth/retry-fallback chain entirely — fallbackSpy
		//      MUST NOT be called.
		//   2. Pass `plan.binding.model` verbatim to createAgentSession.
		await runSubprocess({
			...baseOptions,
			strictRoleExecutionPlan: plan,
		});

		// GREEN contract: auth/parent/retry fallback was completely bypassed.
		expect(fallbackSpy).not.toHaveBeenCalled();

		// GREEN contract: createAgentSession model is identity-equal to the
		// binding's model object (same reference, not just equal provider/id).
		const actualOptions = createSessionSpy.mock.calls[0]?.[0];
		expect(actualOptions?.model).toBe(plan.binding.model);
	});

	it("rejects with role_model_mismatch before session creation when revalidation fails", async () => {
		const session = createSilentSession();
		const createSessionSpy = mockCreateAgentSession(session);

		// The plan was bound to modelFixture (anthropic/claude-sonnet-4-20250514),
		// but the model registry does not advertise that model — simulate a
		// runtime revalidation mismatch.
		const emptyRegistry = {
			refresh: async () => {},
			getAvailable: () => [],
		} as unknown as ModelRegistry;
		const plan = strictPlanFixture();

		// ── RED phase ──────────────────────────────────────────────────────
		// runSubprocess does NOT revalidate the binding; it falls through to
		// legacy model-resolution which calls createAgentSession, and the
		// promise fulfills (not rejects).  Both assertions below REDden.
		//
		// Once the revalidation gate is wired (GREEN), the executor will:
		//   1. Compare plan.binding.model against the registry's available set
		//   2. Reject with `{ code: "role_model_mismatch" }` when unavailable
		//   3. NEVER call createAgentSession
		await expect(
			runSubprocess({
				...baseOptions,
				modelRegistry: emptyRegistry,
				strictRoleExecutionPlan: plan,
			}),
		).rejects.toMatchObject({ code: "role_model_mismatch" });

		expect(createSessionSpy).not.toHaveBeenCalled();
	});

	it("rejects with routing_evidence_write_failed before session creation when evidence writer fails", async () => {
		const session = createSilentSession();
		const createSessionSpy = mockCreateAgentSession(session);
		vi.spyOn(evidenceModule, "writeModelRoutingEvidenceV2").mockRejectedValue(new Error("disk full"));

		const plan = strictPlanFixture();

		// ── RED phase ──────────────────────────────────────────────────────
		// runSubprocess does NOT call the evidence writer from the strict
		// path, so the spy rejection is never observed.  The promise fulfills
		// (not rejects) and createSessionSpy IS called.
		// Both assertions below REDden.
		//
		// Once the evidence gate is wired (GREEN), the executor will:
		//   1. Call writeModelRoutingEvidenceV2 with a "started" evidence
		//   2. Reject with `{ code: "routing_evidence_write_failed" }` on failure
		//   3. NEVER call createAgentSession
		await expect(
			runSubprocess({
				...baseOptions,
				strictRoleExecutionPlan: plan,
			}),
		).rejects.toMatchObject({ code: "routing_evidence_write_failed" });

		expect(createSessionSpy).not.toHaveBeenCalled();
	});

	it("surfaces validatedRoleId/configuredSelector/bindingHash/exactMatch in progress when strict execution plan is present", async () => {
		const session = createSilentSession();
		const createSessionSpy = mockCreateAgentSession(session);
		vi.spyOn(evidenceModule, "writeModelRoutingEvidenceV2").mockResolvedValue("/tmp/evidence.json");
		const plan = strictPlanFixture();
		const capturedProgresses: AgentProgress[] = [];

		// ── RED phase ──────────────────────────────────────────────────────
		// The strict path is now wired (GREEN), but the executor does not yet
		// thread strict binding metadata into progress emission at executor.ts
		// ~1070–1090 / ~1214.  capturedProgresses will have entries but will
		// lack validatedRoleId/configuredSelector/bindingHash/exactMatch.
		//
		// Once the progress field is wired (GREEN), the executor will set:
		//   progress.validatedRoleId = plan.contract.roleId
		//   progress.configuredSelector = plan.binding.configuredSelector
		//   progress.bindingHash = plan.binding.bindingHash
		//   progress.exactMatch = true
		await runSubprocess({
			...baseOptions,
			strictRoleExecutionPlan: plan,
			onProgress: (p: AgentProgress) => {
				capturedProgresses.push(p);
			},
		});

		const lastProgress = capturedProgresses[capturedProgresses.length - 1];
		expect(lastProgress).toBeDefined();

		// GREEN contract: strict execution populates all four binding fields.
		expect(lastProgress?.validatedRoleId).toBe(plan.contract.roleId);
		expect(lastProgress?.configuredSelector).toBe(plan.binding.configuredSelector);
		expect(lastProgress?.bindingHash).toBe(plan.binding.bindingHash);
		expect(lastProgress?.exactMatch).toBe(true);
	});

	it("omits binding-specific progress fields in normal (non-strict) execution", async () => {
		const session = createSilentSession();
		const createSessionSpy = mockCreateAgentSession(session);
		vi.spyOn(evidenceModule, "writeModelRoutingEvidenceV2").mockResolvedValue("/tmp/evidence.json");

		const capturedProgresses: AgentProgress[] = [];

		// This test verifies that normal (non-strict) AgentProgress contains
		// baseline routing/identity fields but does NOT gain the strict binding
		// metadata.  It passes now in RED and must remain passing in GREEN —
		// the implementer must NOT backfill these into the legacy path.
		await runSubprocess({
			...baseOptions,
			strictRoleExecutionPlan: undefined,
			onProgress: (p: AgentProgress) => {
				capturedProgresses.push(p);
			},
		});

		const lastProgress = capturedProgresses[capturedProgresses.length - 1];
		expect(lastProgress).toBeDefined();

		// Baseline fields are present and populated.
		expect(lastProgress?.id).toBe(baseOptions.id);
		expect(lastProgress?.agent).toBe(baseAgent.name);
		expect(lastProgress?.task).toBe(baseOptions.task);
		expect(lastProgress?.status).toBeOneOf(["completed", "failed", "aborted"]);

		// Non-strict routing fields are present.
		expect(lastProgress).toHaveProperty("modelRole");
		expect(lastProgress).toHaveProperty("requestedModel");

		// Strict binding fields MUST NOT appear in non-strict execution.
		expect(lastProgress?.validatedRoleId).toBeUndefined();
		expect(lastProgress?.configuredSelector).toBeUndefined();
		expect(lastProgress?.bindingHash).toBeUndefined();
		expect(lastProgress?.exactMatch).toBeUndefined();
	});
});
