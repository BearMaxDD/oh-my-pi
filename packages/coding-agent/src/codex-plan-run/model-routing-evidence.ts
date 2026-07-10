import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
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

export type ModelRoutingEvidenceV2Status = "preflight_passed" | "started" | "blocked" | "completed" | "acceptance_failed";

export interface ModelRoutingEvidenceTimestamps {
	created_at?: string;
	updated_at?: string;
	started_at?: string;
	completed_at?: string;
}

export interface ModelRoutingEvidenceRoleCandidate {
	role_id?: string;
	confidence?: number;
	reason?: string;
}


export interface ModelRoutingEvidenceAdvisor {
	model?: string;
	result?: string;
}
export interface ModelRoutingEvidenceRoleDecision {
	decision_id?: string;
	source?: string;
	selected_role_id?: string;
	confidence?: number;
	candidates?: ModelRoutingEvidenceRoleCandidate[];
	reasons?: string[];
	advisor?: ModelRoutingEvidenceAdvisor;
}

export interface ModelRoutingEvidenceContractCheck {
	code?: string;
	passed?: boolean;
	message?: string;
}

export interface ModelRoutingEvidenceContractValidation {
	contract_version?: string;
	passed?: boolean;
	checks?: ModelRoutingEvidenceContractCheck[];
}

export interface ModelRoutingEvidenceModelBinding {
	configured_selector?: string;
	provider?: string;
	model_id?: string;
	thinking_source?: string;
	thinking_level?: string;
	binding_hash?: string;
}

export interface ModelRoutingEvidenceActual {
	exact_match?: boolean;
	fallback_used?: boolean;
	parent_model_used?: boolean;
	context_promotion_used?: boolean;
	provider?: string;
	model_id?: string;
	thinking_level?: string;
	session_created?: boolean;
	first_dispatch?: boolean;
}

export interface ModelRoutingEvidenceError {
	code?: string;
	message?: string;
}

/**
 * Stage-scoped routing evidence. V2 artifacts are immutable with respect to
 * their run, task, and stage identity; subsequent writes may only advance the
 * stage state through an allowed transition.
 */
export interface ModelRoutingEvidenceV2 extends Omit<ModelRoutingEvidence, "schema_version"> {
	schema_version: 2;
	stage_id?: string;
	status: ModelRoutingEvidenceV2Status;
	timestamps: ModelRoutingEvidenceTimestamps;
	role_decision: ModelRoutingEvidenceRoleDecision;
	contract_validation: ModelRoutingEvidenceContractValidation;
	model_binding: ModelRoutingEvidenceModelBinding;
	actual?: ModelRoutingEvidenceActual;
	error?: ModelRoutingEvidenceError;
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
 * Write V2 evidence to its stage-scoped path using a same-directory atomic
 * rename. Existing evidence must retain the same identity and make a legal
 * state transition before it can be replaced.
 */
export async function writeModelRoutingEvidenceV2(evidence: ModelRoutingEvidenceV2, acceptingDir: string): Promise<string> {
	const dir = evidence.stage_id ? join(acceptingDir, "tasks", evidence.task_id, "stages", evidence.stage_id) : join(acceptingDir, "tasks", evidence.task_id);
	const filePath = join(dir, "model-routing-evidence.json");

	await mkdir(dir, { recursive: true });
	const existing = await readExistingModelRoutingEvidenceV2(filePath);
	if (existing && isPersistedModelRoutingEvidenceV2(existing)) {
		assertMatchingEvidenceIdentity(existing, evidence);
		assertValidEvidenceTransition(existing.status, evidence.status);
	}

	const temporaryPath = join(dir, `.model-routing-evidence-${randomUUID()}.tmp`);
	try {
		await writeFile(temporaryPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
		await rename(temporaryPath, filePath);
	} finally {
		await rm(temporaryPath, { force: true });
	}

	return filePath;
}

async function readExistingModelRoutingEvidenceV2(filePath: string): Promise<ModelRoutingEvidence | ModelRoutingEvidenceV2 | undefined> {
	try {
		return JSON.parse(await readFile(filePath, "utf8")) as ModelRoutingEvidence | ModelRoutingEvidenceV2;
	} catch (error) {
		if (isMissingFileError(error)) {
			return undefined;
		}
		throw error;
	}
}

function isMissingFileError(error: unknown): error is NodeJS.ErrnoException {
	return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function isPersistedModelRoutingEvidenceV2(evidence: ModelRoutingEvidence | ModelRoutingEvidenceV2): evidence is ModelRoutingEvidenceV2 {
	return evidence.schema_version === 2 && "status" in evidence;
}

function assertMatchingEvidenceIdentity(existing: ModelRoutingEvidenceV2, incoming: ModelRoutingEvidenceV2): void {
	for (const field of ["run_id", "task_id"] as const) {
		if (existing[field] !== incoming[field]) {
			throw new Error(`Cannot overwrite routing evidence with a different ${field}`);
		}
	}
	if (existing.stage_id !== incoming.stage_id) {
		throw new Error("Cannot overwrite routing evidence with a different stage_id");
	}
}

function assertValidEvidenceTransition(from: ModelRoutingEvidenceV2Status, to: ModelRoutingEvidenceV2Status): void {
	const permittedTransitions: Readonly<Record<ModelRoutingEvidenceV2Status, readonly ModelRoutingEvidenceV2Status[]>> = {
		preflight_passed: ["started", "blocked"],
		started: ["completed", "acceptance_failed"],
		blocked: [],
		completed: [],
		acceptance_failed: [],
	};

	if (!permittedTransitions[from].includes(to)) {
		throw new Error(`Invalid routing evidence state transition: ${from} → ${to}`);
	}
}


function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}

function validateRequiredStrings(errors: string[], label: string, value: unknown, fields: readonly string[]): Record<string, unknown> {
	const record = isRecord(value) ? value : {};
	for (const field of fields) {
		if (typeof record[field] !== "string" || record[field].length === 0) {
			errors.push(`${label}.${field} is required`);
		}
	}
	return record;
}

function validateRequiredBooleans(errors: string[], label: string, value: Record<string, unknown>, fields: readonly string[]): void {
	for (const field of fields) {
		if (typeof value[field] !== "boolean") {
			errors.push(`${label}.${field} is required`);
		}
	}
}

function validateV2EvidenceForAcceptance(errors: string[], evidence: Partial<ModelRoutingEvidenceV2>): void {
	const stageLabel = evidence.stage_id ?? "(task-level)";
	if (evidence.status !== "completed" && !evidence.actual) {
		return;
	}
	if (evidence.status !== "completed") {
		errors.push(`Stage ${stageLabel} status must be completed for acceptance`);
	}

	validateRequiredStrings(errors, "timestamps", evidence.timestamps, ["created_at", "updated_at"]);

	const roleDecision = validateRequiredStrings(errors, "role_decision", evidence.role_decision, ["decision_id", "source", "selected_role_id"]);
	if (typeof roleDecision.confidence !== "number") {
		errors.push("role_decision.confidence is required");
	}
	if (!Array.isArray(roleDecision.candidates)) {
		errors.push("role_decision.candidates is required");
	} else {
		for (const candidate of roleDecision.candidates) {
			const record = validateRequiredStrings(errors, "role_decision.candidates", candidate, ["role_id", "reason"]);
			if (typeof record.confidence !== "number") {
				errors.push("role_decision.candidates.confidence is required");
			}
		}
	}
	if (!Array.isArray(roleDecision.reasons) || !roleDecision.reasons.every((reason) => typeof reason === "string")) {
		errors.push("role_decision.reasons is required");
	}
	if (roleDecision.advisor !== undefined) {
		validateRequiredStrings(errors, "role_decision.advisor", roleDecision.advisor, ["model", "result"]);
	}

	const contractValidation = validateRequiredStrings(errors, "contract_validation", evidence.contract_validation, ["contract_version"]);
	if (contractValidation.passed !== true) {
		errors.push("contract_validation.passed must be true");
	}
	if (!Array.isArray(contractValidation.checks)) {
		errors.push("contract_validation.checks is required");
	} else {
		for (const check of contractValidation.checks) {
			const record = validateRequiredStrings(errors, "contract_validation.checks", check, ["code", "message"]);
			if (record.passed !== true) {
				errors.push("contract_validation.checks.passed must be true");
			}
		}
	}


	const modelBinding = validateRequiredStrings(errors, "model_binding", evidence.model_binding, [
		"configured_selector",
		"provider",
		"model_id",
		"thinking_source",
		"thinking_level",
		"binding_hash",
	]);
	if (evidence.status !== "completed") {
		return;
	}

	const actual = validateRequiredStrings(errors, "actual", evidence.actual, ["provider", "model_id", "thinking_level"]);
	validateRequiredBooleans(errors, "actual", actual, [
		"exact_match",
		"fallback_used",
		"parent_model_used",
		"context_promotion_used",
		"session_created",
	]);
	if (actual.exact_match !== true) {
		errors.push(`Stage ${stageLabel} actual exact model match is required`);
	}
	if (actual.fallback_used === true) {
		errors.push(`Stage ${stageLabel} actual fallback use is not allowed`);
	}
	if (actual.parent_model_used === true) {
		errors.push(`Stage ${stageLabel} actual parent model use is not allowed`);
	}
	if (actual.context_promotion_used === true) {
		errors.push(`Stage ${stageLabel} actual context promotion is not allowed`);
	}
	if (actual.session_created !== true) {
		errors.push(`Stage ${stageLabel} actual session_created must be true`);
	}
	for (const field of ["provider", "model_id", "thinking_level"] as const) {
		if (typeof modelBinding[field] === "string" && typeof actual[field] === "string" && modelBinding[field] !== actual[field]) {
			errors.push(`model_binding.${field} must match actual.${field}`);
		}
	}
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
export function validateModelRoutingEvidenceForAcceptance(evidence: ModelRoutingEvidence | ModelRoutingEvidenceV2): string[] {
	const errors: string[] = [];
	if (evidence.model_role != null && !evidence.resolved_model) {
		errors.push(`Role-bound task ${evidence.task_id} resolved_model is required`);
	}

	if (evidence.schema_version !== 2) {
		return errors;
	}

	validateV2EvidenceForAcceptance(errors, evidence as Partial<ModelRoutingEvidenceV2>);
	return errors;
}
