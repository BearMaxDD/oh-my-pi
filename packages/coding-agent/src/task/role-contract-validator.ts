import { MODEL_ROLES, type ModelRoleInfo } from "../config/model-roles";

export interface TaskOperationRequirements {
	needsProductionWrite: boolean;
	needsTestWrite: boolean;
	needsAcceptanceDecision?: boolean;
	readOnly: boolean;
	stageId?: string;
}

export interface RoleContractCheck {
	code:
		| "role_exists"
		| "contract_complete"
		| "subagent_allowed"
		| "stage_allowed"
		| "production_write_allowed"
		| "test_write_allowed"
		| "capabilities_satisfied"
		| "readonly_compatible";
	passed: boolean;
}

export interface RoleContractValidationResult {
	passed: boolean;
	roleId: string;
	contractVersion?: string;
	checks: RoleContractCheck[];
}

export interface ValidateRoleContractForTaskOptions {
	roleId: string;
	roleInfo?: ModelRoleInfo;
	requirements: TaskOperationRequirements;
}

function registeredRoleInfo(roleId: string): ModelRoleInfo | undefined {
	return Object.prototype.hasOwnProperty.call(MODEL_ROLES, roleId)
		? MODEL_ROLES[roleId as keyof typeof MODEL_ROLES]
		: undefined;
}

function hasCompleteContract(roleInfo: ModelRoleInfo | undefined): boolean {
	const contractVersion = roleInfo?.contractVersion;
	return (
		typeof contractVersion === "string" &&
		contractVersion.trim().length > 0 &&
		(roleInfo?.capabilities?.length ?? 0) > 0 &&
		roleInfo?.canRunAsSubagent !== undefined &&
		roleInfo?.readOnly !== undefined &&
		roleInfo?.canEditProductionCode !== undefined &&
		roleInfo?.canEditTestCode !== undefined
	);
}

export function validateRoleContractForTask({
	roleId,
	roleInfo,
	requirements,
}: ValidateRoleContractForTaskOptions): RoleContractValidationResult {
	const registered = registeredRoleInfo(roleId);
	const info = roleInfo ?? registered;
	const checks: RoleContractCheck[] = [
		{ code: "role_exists", passed: registered !== undefined },
		{ code: "contract_complete", passed: hasCompleteContract(info) },
		{ code: "subagent_allowed", passed: info?.canRunAsSubagent === true },
		{
			code: "stage_allowed",
			passed:
				requirements.stageId === undefined ||
				info?.allowedStageIds === undefined ||
				info.allowedStageIds.includes(requirements.stageId),
		},
		{
			code: "production_write_allowed",
			passed: !requirements.needsProductionWrite || info?.canEditProductionCode === true,
		},
		{
			code: "test_write_allowed",
			passed: !requirements.needsTestWrite || info?.canEditTestCode === true,
		},
		...(requirements.needsAcceptanceDecision
			? [{
				code: "capabilities_satisfied" as const,
				passed: info?.capabilities?.includes("acceptance") === true,
			}]
			: []),
		{
			code: "readonly_compatible",
			passed: !requirements.readOnly || info?.readOnly === true,
		},
	];

	return {
		passed: checks.every(check => check.passed),
		roleId,
		...(info?.contractVersion === undefined ? {} : { contractVersion: info.contractVersion }),
		checks,
	};
}
