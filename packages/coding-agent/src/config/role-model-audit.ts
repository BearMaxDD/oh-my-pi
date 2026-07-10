import { validateRoleContractForTask } from "../task/role-contract-validator";
import { resolveStrictRoleModelBinding, StrictRoleModelBindingError } from "../task/strict-role-model-binding";
import type { ModelRegistry } from "./model-registry";
import { getKnownRoleIds, getRoleInfo } from "./model-roles";
import type { Settings } from "./settings";

export type RoleModelContractStatus = "complete" | "incomplete";

export type RoleModelAuditStatus = "unconfigured" | "not_concrete" | "unavailable" | "thinking_unsupported" | "valid";

export interface RoleModelAuditEntry {
	roleId: string;
	selector: string | undefined;
	contractStatus: RoleModelContractStatus;
	modelStatus: RoleModelAuditStatus;
	executable: boolean;
	message: string;
}

function toModelStatus(error: StrictRoleModelBindingError): RoleModelAuditStatus {
	switch (error.code) {
		case "role_model_unconfigured":
			return "unconfigured";
		case "role_model_not_concrete":
			return "not_concrete";
		case "role_model_unavailable":
			return "unavailable";
		case "role_thinking_unsupported":
			return "thinking_unsupported";
	}
}

/**
 * Audit every known role without applying legacy model-routing aliases or
 * provider fallbacks. Each role is resolved exactly once by the strict binding
 * resolver so availability and thinking support have one source of truth.
 */
export function auditStrictRoleBindings(settings: Settings, registry: ModelRegistry): RoleModelAuditEntry[] {
	const availableModels = registry.getAvailable();

	return getKnownRoleIds(settings).map(roleId => {
		const roleInfo = getRoleInfo(roleId, settings);
		const validation = validateRoleContractForTask({
			roleId,
			roleInfo,
			requirements: { needsProductionWrite: false, needsTestWrite: false, readOnly: false },
		});
		const contractStatus: RoleModelContractStatus = validation.passed ? "complete" : "incomplete";
		let modelStatus: RoleModelAuditStatus;
		let message = "Strict role-model binding is valid.";

		try {
			resolveStrictRoleModelBinding({
				validatedRoleId: roleId,
				contract: validation.contractVersion ? { contractVersion: validation.contractVersion } : {},
				settings,
				availableModels,
			});
			modelStatus = "valid";
		} catch (error) {
			if (!(error instanceof StrictRoleModelBindingError)) throw error;
			modelStatus = toModelStatus(error);
			message = error.message;
		}

		if (contractStatus === "incomplete") {
			message = `${message} Role contract is incomplete.`;
		}

		return {
			roleId,
			selector: settings.getModelRole(roleId),
			contractStatus,
			modelStatus,
			executable: contractStatus === "complete" && modelStatus === "valid",
			message,
		};
	});
}
