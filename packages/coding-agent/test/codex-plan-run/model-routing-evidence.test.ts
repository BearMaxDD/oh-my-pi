import { afterAll, beforeAll, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
	createModelRoutingEvidence,
	type ModelRoutingEvidence,
	validateModelRoutingEvidenceForAcceptance,
	writeModelRoutingEvidence,
} from "../../src/codex-plan-run/model-routing-evidence";

describe("Model routing evidence", () => {
	let tmpDir: string;

	beforeAll(async () => {
		tmpDir = await mkdtemp(join(tmpdir(), "model-routing-evidence-test-"));
	});

	afterAll(async () => {
		await rm(tmpDir, { recursive: true, force: true });
	});

	it("creates ModelRoutingEvidence with schema_version 1 and all fields", () => {
		const evidence = createModelRoutingEvidence({
			runId: "run-42",
			taskId: "T02",
			agentId: "agent-007",
			modelRole: "superpowers:tdd-writer",
			requestedModel: "anthropic/claude-sonnet-4",
			resolvedModel: "anthropic/claude-sonnet-4-20250514",
			fallbackRoles: ["smol", "task", "default"],
			fallbackUsed: false,
			modelOverrides: ["anthropic/claude-sonnet-4", "anthropic/claude-haiku-3.5"],
			serviceTier: "default",
			thinkingLevel: "normal",
		});

		expect(evidence.schema_version).toBe(1);
		expect(evidence.run_id).toBe("run-42");
		expect(evidence.task_id).toBe("T02");
		expect(evidence.agent_id).toBe("agent-007");
		expect(evidence.model_role).toBe("superpowers:tdd-writer");
		expect(evidence.requested_model).toBe("anthropic/claude-sonnet-4");
		expect(evidence.resolved_model).toBe("anthropic/claude-sonnet-4-20250514");
		expect(evidence.fallback_roles).toEqual(["smol", "task", "default"]);
		expect(evidence.fallback_used).toBe(false);
		expect(evidence.model_overrides).toEqual(["anthropic/claude-sonnet-4", "anthropic/claude-haiku-3.5"]);
		expect(evidence.service_tier).toBe("default");
		expect(evidence.thinking_level).toBe("normal");
	});

	it("writeModelRoutingEvidence writes JSON file to acceptingDir/tasks/taskId/model-routing-evidence.json", async () => {
		const evidence = createModelRoutingEvidence({
			runId: "run-42",
			taskId: "T02",
			resolvedModel: "anthropic/claude-sonnet-4-20250514",
		});

		const filePath = await writeModelRoutingEvidence(evidence, tmpDir);

		expect(filePath).toBe(join(tmpDir, "tasks", "T02", "model-routing-evidence.json"));

		const jsonContent = await readFile(filePath, "utf-8");
		const parsed = JSON.parse(jsonContent);
		expect(parsed.schema_version).toBe(1);
		expect(parsed.run_id).toBe("run-42");
		expect(parsed.task_id).toBe("T02");
		expect(parsed.resolved_model).toBe("anthropic/claude-sonnet-4-20250514");
	});

	it("validateModelRoutingEvidenceForAcceptance returns [] when model_role has resolved_model", () => {
		const evidence = createModelRoutingEvidence({
			runId: "run-42",
			taskId: "T02",
			modelRole: "superpowers:tdd-writer",
			resolvedModel: "anthropic/claude-sonnet-4-20250514",
		});

		const errors = validateModelRoutingEvidenceForAcceptance(evidence);
		expect(errors).toEqual([]);
	});

	it("validateModelRoutingEvidenceForAcceptance returns error when model_role exists and resolved_model is null", () => {
		const evidence = createModelRoutingEvidence({
			runId: "run-42",
			taskId: "T02",
			modelRole: "superpowers:tdd-writer",
			resolvedModel: null,
		});

		const errors = validateModelRoutingEvidenceForAcceptance(evidence);
		expect(errors).toEqual(["Role-bound task T02 resolved_model is required"]);
	});

	it("validateModelRoutingEvidenceForAcceptance returns error when model_role exists and resolved_model is undefined", () => {
		const evidence: ModelRoutingEvidence = {
			schema_version: 1,
			run_id: "run-42",
			task_id: "T02",
			model_role: "superpowers:tdd-writer",
		};

		const errors = validateModelRoutingEvidenceForAcceptance(evidence);
		expect(errors).toEqual(["Role-bound task T02 resolved_model is required"]);
	});

	it("validateModelRoutingEvidenceForAcceptance returns [] when model_role is undefined", () => {
		const evidence: ModelRoutingEvidence = {
			schema_version: 1,
			run_id: "run-42",
			task_id: "T02",
		};

		const errors = validateModelRoutingEvidenceForAcceptance(evidence);
		expect(errors).toEqual([]);
	});
});
