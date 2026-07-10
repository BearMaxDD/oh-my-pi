import type { ModelRegistry } from "../config/model-registry";
import { getRoleInfo } from "../config/model-roles";
import type { Settings } from "../config/settings";
import {
	type RoleContractCheck,
	type RoleContractValidationResult,
	type TaskOperationRequirements,
	validateRoleContractForTask,
} from "../task/role-contract-validator";
import {
	resolveStrictRoleModelBinding,
	type StrictRoleModelBinding,
	type StrictRoleModelBindingErrorCode,
} from "../task/strict-role-model-binding";
import type { PlanExecutionBook } from "./execution-book";
import { type ModelRoutingEvidenceV2, writeModelRoutingEvidenceV2 } from "./model-routing-evidence";
import type { PromptPack } from "./prompt-pack";

export interface StageOutputRef {
	taskId: string;
	stageId: string;
	outputPath: string;
}

export interface RoleRoutingDecision {
	readonly source: "explicit_stage";
	readonly selectedRoleId: string;
	readonly confidence: 1;
	readonly reasons: readonly string[];
	readonly candidates: ReadonlyArray<{
		readonly roleId: string;
		readonly confidence: 1;
		readonly reason: string;
	}>;
}

export interface StrictRoleContractValidation {
	readonly passed: boolean;
	readonly roleId: string;
	readonly contractVersion?: string;
	readonly checks: ReadonlyArray<Readonly<RoleContractCheck>>;
}

export interface StrictRoleExecutionPlan {
	readonly decision: RoleRoutingDecision;
	readonly contract: StrictRoleContractValidation;
	readonly binding: Readonly<StrictRoleModelBinding>;
	readonly evidence: {
		readonly path: string;
		readonly status: "preflight_passed";
		/** Immutable preflight identity required for strict runtime V2 transitions. */
		readonly acceptingDir?: string;
		readonly preflight?: Readonly<ModelRoutingEvidenceV2>;
	};
}

export type StagePreflightErrorCode =
	| StrictRoleModelBindingErrorCode
	| "role_contract_missing"
	| "stage_identity_invalid"
	| "stage_preflight_dependencies_missing";

export class StrictStagePreflightError extends Error {
	constructor(
		public readonly code: StagePreflightErrorCode,
		message: string,
	) {
		super(message);
		this.name = "StrictStagePreflightError";
	}
}

export interface StagePreflightInput {
	book: PlanExecutionBook;
	acceptingDir: string;
	taskId: string;
	stageId: string;
	modelRole: string;
	promptPack: PromptPack;
	settings: Settings;
	modelRegistry: Pick<ModelRegistry, "getAvailable">;
	requirements: TaskOperationRequirements;
}

/** Raw stage input for non-PlanRun compatibility callers only. */
export interface UnplannedRoleBoundStageRunInput {
	book: PlanExecutionBook;
	acceptingDir: string;
	taskId: string;
	stageId: string;
	promptPack: PromptPack;
	modelRole: string;
	previousStageOutputs: StageOutputRef[];
}

/** A PlanRun stage input is unusable until strict preflight has succeeded. */
export interface RoleBoundStageRunInput extends UnplannedRoleBoundStageRunInput {
	strictRoleExecutionPlan: StrictRoleExecutionPlan;
}

export interface BuildRoleBoundStageRunInputsOptions {
	book: PlanExecutionBook;
	acceptingDir: string;
	taskId: string;
	promptPacks: readonly PromptPack[];
	previousStageOutputs: readonly StageOutputRef[];
	settings: Settings;
	modelRegistry: Pick<ModelRegistry, "getAvailable">;
}

export type BuildUnplannedRoleBoundStageRunInputsOptions = Omit<
	BuildRoleBoundStageRunInputsOptions,
	"settings" | "modelRegistry"
>;

const STAGE_ORDER = [
	"tdd-writer",
	"implementer",
	"test-runner",
	"spec-reviewer",
	"quality-reviewer",
	"acceptance",
] as const;

const STAGE_ROLE: Readonly<Record<(typeof STAGE_ORDER)[number], string>> = {
	"tdd-writer": "superpowers:tdd-writer",
	implementer: "superpowers:implementer",
	"test-runner": "superpowers:test-runner",
	"spec-reviewer": "superpowers:spec-reviewer",
	"quality-reviewer": "superpowers:quality-reviewer",
	acceptance: "superpowers:acceptance",
};

const SAFE_STAGE_ID_RE = /^[A-Za-z0-9._:-]+$/;

function orderIndex(stageId: string): number {
	const index = STAGE_ORDER.indexOf(stageId as (typeof STAGE_ORDER)[number]);
	return index === -1 ? STAGE_ORDER.length : index;
}

function requirementsForPromptPack(pack: PromptPack): TaskOperationRequirements {
	return {
		needsProductionWrite: pack.role_contract.may_edit_production_code,
		needsTestWrite: pack.role_contract.may_edit_test_code,
		needsAcceptanceDecision: pack.stage_id === "acceptance",
		readOnly: pack.role_contract.read_only,
		stageId: pack.stage_id,
	};
}

function assertPromptPackMatchesStage(input: StagePreflightInput): void {
	if (
		!input.taskId ||
		!input.stageId ||
		input.taskId === "." ||
		input.stageId === "." ||
		input.taskId.includes("..") ||
		input.stageId.includes("..") ||
		!SAFE_STAGE_ID_RE.test(input.taskId) ||
		!SAFE_STAGE_ID_RE.test(input.stageId)
	) {
		throw new StrictStagePreflightError(
			"stage_identity_invalid",
			"PlanRun task and stage identifiers must be safe path segments",
		);
	}

	if (
		input.promptPack.task_id !== input.taskId ||
		input.promptPack.stage_id !== input.stageId ||
		input.promptPack.role_id !== input.modelRole
	) {
		throw new StrictStagePreflightError(
			"role_contract_missing",
			"Prompt pack identity must match the strict PlanRun stage identity",
		);
	}
}

function assertFixedStageRole(input: StagePreflightInput): void {
	const expectedRole = STAGE_ROLE[input.stageId as (typeof STAGE_ORDER)[number]];
	if (expectedRole === undefined) {
		throw new StrictStagePreflightError(
			"stage_identity_invalid",
			`Stage ${input.stageId} is not a fixed PlanRun stage`,
		);
	}
	if (input.modelRole !== expectedRole) {
		throw new StrictStagePreflightError(
			"role_contract_missing",
			`Stage ${input.stageId} must use role ${expectedRole}`,
		);
	}
}

function createRoleDecision(input: StagePreflightInput): RoleRoutingDecision {
	const reason = `plan_run_stage:${input.stageId}`;
	return Object.freeze({
		source: "explicit_stage" as const,
		selectedRoleId: input.modelRole,
		confidence: 1 as const,
		reasons: Object.freeze([reason, `prompt_pack_role:${input.promptPack.role_id}`]),
		candidates: Object.freeze([Object.freeze({ roleId: input.modelRole, confidence: 1 as const, reason })]),
	});
}

function toPreflightEvidence(
	input: StagePreflightInput,
	decision: RoleRoutingDecision,
	contract: RoleContractValidationResult,
	binding: StrictRoleModelBinding,
): ModelRoutingEvidenceV2 {
	const now = new Date().toISOString();
	return {
		schema_version: 2,
		run_id: input.book.run_id,
		task_id: input.taskId,
		stage_id: input.stageId,
		model_role: input.modelRole,
		requested_model: binding.configuredSelector,
		resolved_model: binding.canonicalSelector,
		fallback_roles: [],
		fallback_used: false,
		thinking_level: String(binding.thinkingLevel ?? "model_default"),
		status: "preflight_passed",
		timestamps: { created_at: now, updated_at: now },
		role_decision: {
			decision_id: `${input.book.run_id}:${input.taskId}:${input.stageId}:explicit_stage`,
			source: decision.source,
			selected_role_id: decision.selectedRoleId,
			confidence: decision.confidence,
			candidates: decision.candidates.map(candidate => ({
				role_id: candidate.roleId,
				confidence: candidate.confidence,
				reason: candidate.reason,
			})),
			reasons: [...decision.reasons],
		},
		contract_validation: {
			contract_version: contract.contractVersion ?? "unknown",
			passed: contract.passed,
			checks: contract.checks.map(check => ({
				code: check.code,
				passed: check.passed,
				message: `${check.code}:${check.passed ? "passed" : "failed"}`,
			})),
		},
		model_binding: {
			configured_selector: binding.configuredSelector,
			provider: binding.provider,
			model_id: binding.modelId,
			thinking_source: binding.thinkingSource,
			thinking_level: String(binding.thinkingLevel ?? "model_default"),
			binding_hash: binding.bindingHash,
		},
	};
}

function toBlockedPreflightEvidence(
	input: StagePreflightInput,
	decision: RoleRoutingDecision,
	contract: RoleContractValidationResult,
	error: unknown,
): ModelRoutingEvidenceV2 {
	const now = new Date().toISOString();
	const errorCode =
		typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
			? error.code
			: "preflight_failed";
	const errorMessage = error instanceof Error ? error.message : "Strict stage preflight failed";
	return {
		schema_version: 2,
		run_id: input.book.run_id,
		task_id: input.taskId,
		stage_id: input.stageId,
		model_role: input.modelRole,
		requested_model: input.settings.getModelRole(input.modelRole),
		resolved_model: null,
		fallback_roles: [],
		fallback_used: false,
		status: "blocked",
		timestamps: { created_at: now, updated_at: now },
		role_decision: {
			decision_id: `${input.book.run_id}:${input.taskId}:${input.stageId}:explicit_stage`,
			source: decision.source,
			selected_role_id: decision.selectedRoleId,
			confidence: decision.confidence,
			candidates: decision.candidates.map(candidate => ({
				role_id: candidate.roleId,
				confidence: candidate.confidence,
				reason: candidate.reason,
			})),
			reasons: [...decision.reasons],
		},
		contract_validation: {
			contract_version: contract.contractVersion ?? "unknown",
			passed: contract.passed,
			checks: contract.checks.map(check => ({
				code: check.code,
				passed: check.passed,
				message: `${check.code}:${check.passed ? "passed" : "failed"}`,
			})),
		},
		model_binding: {},
		error: { code: errorCode, message: errorMessage },
	};
}

/**
 * Resolve and persist the exact role/model contract before a fixed PlanRun
 * stage can be handed to a runner. Successful preflight writes the V2
 * stage-scoped evidence atomically before exposing the immutable plan.
 */
export async function buildStrictStageExecutionPlan(input: StagePreflightInput): Promise<StrictRoleExecutionPlan> {
	assertPromptPackMatchesStage(input);
	const decision = createRoleDecision(input);
	const contract = validateRoleContractForTask({
		roleId: input.modelRole,
		roleInfo: getRoleInfo(input.modelRole, input.settings),
		requirements: input.requirements,
	});
	const rejectWithBlockedEvidence = async (error: Error): Promise<never> => {
		await writeModelRoutingEvidenceV2(
			toBlockedPreflightEvidence(input, decision, contract, error),
			input.acceptingDir,
		);
		throw error;
	};
	if (!contract.passed) {
		return rejectWithBlockedEvidence(
			new StrictStagePreflightError(
				"role_contract_missing",
				`Role ${input.modelRole} does not satisfy the strict stage contract`,
			),
		);
	}

	let binding: StrictRoleModelBinding;
	try {
		assertFixedStageRole(input);
		binding = resolveStrictRoleModelBinding({
			validatedRoleId: input.modelRole,
			contract: { contractVersion: contract.contractVersion },
			settings: input.settings,
			availableModels: input.modelRegistry.getAvailable(),
		});
	} catch (error) {
		if (error instanceof Error) return rejectWithBlockedEvidence(error);
		throw error;
	}

	const preflightEvidence = toPreflightEvidence(input, decision, contract, binding);
	const evidencePath = await writeModelRoutingEvidenceV2(preflightEvidence, input.acceptingDir);
	return Object.freeze({
		decision,
		contract: Object.freeze({
			passed: contract.passed,
			roleId: contract.roleId,
			...(contract.contractVersion === undefined ? {} : { contractVersion: contract.contractVersion }),
			checks: Object.freeze(contract.checks.map(check => Object.freeze({ ...check }))),
		}),
		binding: Object.freeze(binding),
		evidence: Object.freeze({
			path: evidencePath,
			status: "preflight_passed" as const,
			acceptingDir: input.acceptingDir,
			preflight: Object.freeze(preflightEvidence),
		}),
	});
}

/**
 * Map prompt packs without preflight for non-PlanRun compatibility callers.
 * PlanRun MUST use buildRoleBoundStageRunInputs instead.
 */
export function buildUnplannedRoleBoundStageRunInputs(
	options: BuildUnplannedRoleBoundStageRunInputsOptions,
): UnplannedRoleBoundStageRunInput[] {
	return [...options.promptPacks]
		.filter(pack => pack.task_id === options.taskId)
		.sort((left, right) => orderIndex(left.stage_id) - orderIndex(right.stage_id))
		.map(pack => ({
			book: options.book,
			acceptingDir: options.acceptingDir,
			taskId: options.taskId,
			stageId: pack.stage_id,
			promptPack: pack,
			modelRole: pack.role_id,
			previousStageOutputs: [...options.previousStageOutputs],
		}));
}

/** Build only strict, preflighted PlanRun stage inputs. */
export async function buildRoleBoundStageRunInputs(
	options: BuildRoleBoundStageRunInputsOptions,
): Promise<RoleBoundStageRunInput[]> {
	if (!options.settings || !options.modelRegistry) {
		throw new StrictStagePreflightError(
			"stage_preflight_dependencies_missing",
			"PlanRun stage preflight requires settings and a model registry",
		);
	}
	const stageInputs = buildUnplannedRoleBoundStageRunInputs(options);
	return Promise.all(
		stageInputs.map(async stageInput => ({
			...stageInput,
			strictRoleExecutionPlan: await buildStrictStageExecutionPlan({
				...stageInput,
				settings: options.settings,
				modelRegistry: options.modelRegistry,
				requirements: requirementsForPromptPack(stageInput.promptPack),
			}),
		})),
	);
}
