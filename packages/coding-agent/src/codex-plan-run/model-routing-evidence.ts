import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";

/**
 * TRD snake_case evidence artifact for model routing.
 *
 * Written to `<accepting_dir>/tasks/<task_id>/model-routing-evidence.json`
 * so PlanRun driver and task-review gates can verify that a role-bound
 * subagent actually resolved to a real model (vs. staying unresolved).
 */
export interface ModelRoutingEvidence {
	schema_version: number;
	run_id: string;
	task_id: string;
	agent_id?: string;
	model_role?: string;
	requested_model?: string;
	resolved_model?: string | null;
	fallback_roles?: string[];
	fallback_used?: boolean;
	model_overrides?: string[];
	service_tier?: string;
	thinking_level?: string;
}

export interface CreateModelRoutingEvidenceParams {
	runId: string;
	taskId: string;
	agentId?: string;
	modelRole?: string;
	requestedModel?: string;
	resolvedModel?: string | null;
	fallbackRoles?: string[];
	fallbackUsed?: boolean;
	modelOverrides?: string[];
	serviceTier?: string;
	thinkingLevel?: string;
}

/**
 * Create a model-routing evidence object from camelCase runtime fields,
 * mapping them to the TRD snake_case schema.
 */
export function createModelRoutingEvidence(params: CreateModelRoutingEvidenceParams): ModelRoutingEvidence {
	return {
		schema_version: 1,
		run_id: params.runId,
		task_id: params.taskId,
		agent_id: params.agentId,
		model_role: params.modelRole,
		requested_model: params.requestedModel,
		resolved_model: params.resolvedModel,
		fallback_roles: params.fallbackRoles,
		fallback_used: params.fallbackUsed,
		model_overrides: params.modelOverrides,
		service_tier: params.serviceTier,
		thinking_level: params.thinkingLevel,
	};
}

/**
 * Write a ModelRoutingEvidence object to `<acceptingDir>/tasks/<taskId>/model-routing-evidence.json`.
 * Creates parent directories as needed.
 *
 * @returns The absolute path of the written file.
 */
export async function writeModelRoutingEvidence(evidence: ModelRoutingEvidence, acceptingDir: string): Promise<string> {
	const dir = join(acceptingDir, "tasks", evidence.task_id);
	await mkdir(dir, { recursive: true });
	const filePath = join(dir, "model-routing-evidence.json");
	await writeFile(filePath, `${JSON.stringify(evidence, null, 2)}\n`);
	return filePath;
}

/**
 * Validate a ModelRoutingEvidence for plan-run task review / acceptance.
 *
 * A role-bound task (one with `model_role` set) MUST have a `resolved_model`;
 * if it doesn't, the model routing failed to resolve and the task review should
 * flag it.
 *
 * @returns A string array of validation errors (empty = valid).
 */
export function validateModelRoutingEvidenceForAcceptance(evidence: ModelRoutingEvidence): string[] {
	const errors: string[] = [];
	if (evidence.model_role != null && !evidence.resolved_model) {
		errors.push(`Role-bound task ${evidence.task_id} resolved_model is required`);
	}
	return errors;
}
