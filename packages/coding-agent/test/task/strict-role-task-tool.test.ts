/**
 * Strict role TaskTool entry — executeRoleBound.
 *
 * RED phase: method absent; tests will fail because executeRoleBound does not
 * exist on TaskTool. Once implemented (GREEN), every assertion below must
 * pass without modification.
 *
 * Contracts (rework-contracts.md §10):
 * 1. executeRoleBound passes the same strictRoleExecutionPlan identity to
 *    runSubprocess (the plan object is built once, forwarded by reference).
 * 2. Public schema properties never expose evidencePath or bindingHash.
 * 3. Strict entry bypasses resolveTaskModelRouting (legacy routing).
 */
//
// Public API boundary — compile-time sentinels.
//
// RoleBoundExecutionContext is an internal TaskTool contract. Its type leaks
// through src/index.ts `export type * from "./task/types"` and MUST be removed
// from that wildcard before this code can compile without @ts-expect-error.

import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import type { Model } from "@oh-my-pi/pi-ai";
import { toolWireSchema } from "@oh-my-pi/pi-ai/utils/schema";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { AgentLifecycleManager } from "@oh-my-pi/pi-coding-agent/registry/agent-lifecycle";
import { AgentRegistry } from "@oh-my-pi/pi-coding-agent/registry/agent-registry";
import { TaskTool } from "@oh-my-pi/pi-coding-agent/task";
import * as discoveryModule from "@oh-my-pi/pi-coding-agent/task/discovery";
import * as executorModule from "@oh-my-pi/pi-coding-agent/task/executor";
//
// The deeper subpath @oh-my-pi/pi-coding-agent/task/types is reachable via
// package.json's `"./*"` export and task/types.ts still exports the type.
// This sentinel is RED until RoleBoundExecutionContext moves out of types.ts
// into a non-exported internal module (e.g. task/internal.ts).
// pending move out of task/types.ts
import type { AgentDefinition, SingleResult, TaskParams } from "@oh-my-pi/pi-coding-agent/task/types";
import type { ToolSession } from "@oh-my-pi/pi-coding-agent/tools";
import type { StrictRoleExecutionPlan } from "../../src/codex-plan-run/role-bound-stage-scheduler";
import * as modelRoutingModule from "../../src/task/model-routing";

const taskAgent: AgentDefinition = {
	name: "task",
	description: "General-purpose task agent",
	systemPrompt: "You are a task agent.",
	source: "bundled",
};

function createSession(options: { settings?: Record<string, unknown> } = {}): ToolSession {
	return {
		cwd: "/tmp",
		hasUI: false,
		settings: Settings.isolated(options.settings ?? {}),
		getSessionFile: () => null,
		getSessionSpawns: () => "*",
		getPlanReferencePath: () => "local://PLAN.md",
	} as unknown as ToolSession;
}

function getSchemaProperties(tool: TaskTool): Record<string, unknown> {
	const wire = toolWireSchema(tool) as { properties?: Record<string, unknown> };
	return wire.properties ?? {};
}

function makeResult(id: string, overrides: Partial<SingleResult> = {}): SingleResult {
	return {
		index: 0,
		id,
		agent: "task",
		agentSource: "bundled",
		task: "task prompt",
		assignment: "Do the thing.",
		exitCode: 0,
		output: "All done.",
		stderr: "",
		truncated: false,
		durationMs: 5,
		tokens: 0,
		requests: 1,
		...overrides,
	};
}

/** Minimal StrictRoleExecutionPlan fixture for contract verification. */
function strictRoleExecutionPlanFixture(roleId: string, evidencePath: string): StrictRoleExecutionPlan {
	return {
		decision: {
			source: "explicit_stage",
			selectedRoleId: roleId,
			confidence: 1,
			reasons: ["Stage preflight passed"],
			candidates: [{ roleId, confidence: 1, reason: "Matched stage" }],
		},
		contract: {
			passed: true,
			roleId,
			contractVersion: "1.0",
			checks: [],
		},
		binding: {
			schemaVersion: 1,
			contractVersion: "1.0",
			roleId,
			configuredSelector: "openai/gpt-5.2-codex",
			provider: "openai",
			modelId: "gpt-5.2-codex",
			modelRef: "openai/gpt-5.2-codex",
			model: {} as Model,
			thinkingSource: "model_default",
			thinkingLevel: undefined,
			canonicalSelector: "openai/gpt-5.2-codex",
			createdAt: "2026-01-01T00:00:00.000Z",
			bindingHash: "0000000000000000000000000000000000000000000000000000000000000000",
		},
		evidence: {
			path: evidencePath,
			status: "preflight_passed",
		},
	};
}
/**
 * Return channel shared by execute and executeRoleBound.
 */
type TaskToolExecuteResult = ReturnType<TaskTool["execute"]>;

/**
 * Type-level sketch of the executeRoleBound signature once implemented.
 * Used via unknown cast because the value is erased (RED phase).
 */
type ExecuteRoleBoundFn = (
	toolCallId: string,
	params: TaskParams,
	context: { strictRoleExecutionPlan: StrictRoleExecutionPlan },
	signal?: AbortSignal,
) => TaskToolExecuteResult;

describe("executeRoleBound", () => {
	beforeEach(() => {
		AgentRegistry.resetGlobalForTests();
		AgentLifecycleManager.resetGlobalForTests();
	});

	afterEach(() => {
		vi.restoreAllMocks();
		AgentLifecycleManager.resetGlobalForTests();
		AgentRegistry.resetGlobalForTests();
	});

	it("passes the same strictRoleExecutionPlan identity to runSubprocess", async () => {
		vi.spyOn(discoveryModule, "discoverAgents").mockResolvedValue({
			agents: [taskAgent],
			projectAgentsDir: null,
		});
		let capturedStrictRoleExecutionPlan: unknown;
		vi.spyOn(executorModule, "runSubprocess").mockImplementation(async options => {
			const opts = options as unknown as Record<string, unknown>;
			capturedStrictRoleExecutionPlan = opts.strictRoleExecutionPlan;
			return makeResult("agent-1");
		});

		const tool = await TaskTool.create(createSession());

		// Build the plan fixture whose identity must be forwarded verbatim.
		const plan = strictRoleExecutionPlanFixture(
			"superpowers:implementer",
			"/tmp/tasks/T01/stages/implementer/model-routing-evidence.json",
		);

		const roleBoundTool = tool as unknown as { executeRoleBound: ExecuteRoleBoundFn };

		/* Current role-bound context: executeRoleBound forwards plan identity so
		 * the plan object passed in must arrive at runSubprocess (===). */
		await roleBoundTool.executeRoleBound(
			"tc-rb",
			{
				role: "superpowers:implementer",
				assignment: "Implement the auth module.",
				id: "Agent-1",
			} as TaskParams,
			{ strictRoleExecutionPlan: plan },
		);

		// Identity assertion: the same plan object (===) that was passed into
		// executeRoleBound MUST arrive as runSubprocess's strictRoleExecutionPlan.
		expect(capturedStrictRoleExecutionPlan).toBe(plan);
		expect(executorModule.runSubprocess).toHaveBeenCalledTimes(1);
	});

	it("public schema exposes neither evidencePath nor bindingHash", async () => {
		vi.spyOn(discoveryModule, "discoverAgents").mockResolvedValue({
			agents: [taskAgent],
			projectAgentsDir: null,
		});

		// Use flat (non-batch) schema so the sanity checks on public fields work.
		const tool = await TaskTool.create(createSession({ settings: { "task.batch": false } }));
		const properties = getSchemaProperties(tool);

		// Internal binding fields must never appear in the public wire schema.
		expect("evidencePath" in properties).toBe(false);
		expect("bindingHash" in properties).toBe(false);

		// Public fields are still visible on the flat schema (sanity).
		expect("agent" in properties).toBe(true);
		expect("assignment" in properties).toBe(true);
		expect("role" in properties).toBe(true);
	});

	it("bypasses resolveTaskModelRouting (strict entry)", async () => {
		vi.spyOn(discoveryModule, "discoverAgents").mockResolvedValue({
			agents: [taskAgent],
			projectAgentsDir: null,
		});
		vi.spyOn(executorModule, "runSubprocess").mockResolvedValue(makeResult("agent-1"));
		const routingSpy = vi.spyOn(modelRoutingModule, "resolveTaskModelRouting").mockReturnValue({
			modelRole: "superpowers:implementer",
			requestedModel: "openai/gpt-5.2-codex",
			fallbackModelRoles: ["task", "default"],
			modelOverrides: ["openai/gpt-5.2-codex", "openai/gpt-5.2-codex"],
		});

		const tool = await TaskTool.create(createSession());
		const roleBoundTool = tool as unknown as { executeRoleBound: ExecuteRoleBoundFn };

		const plan = strictRoleExecutionPlanFixture(
			"superpowers:implementer",
			"/tmp/tasks/T01/stages/implementer/model-routing-evidence.json",
		);
		/* Strict entry: executeRoleBound must NOT call resolveTaskModelRouting. */
		await roleBoundTool.executeRoleBound(
			"tc-rb-2",
			{
				role: "superpowers:implementer",
				assignment: "Write tests.",
			} as TaskParams,
			{ strictRoleExecutionPlan: plan },
		);

		expect(routingSpy).not.toHaveBeenCalled();
	});
});
