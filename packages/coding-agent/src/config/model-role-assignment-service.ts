import { parseExactModelSelector, splitUpstreamRouting } from "./model-resolver";
import { MODEL_ROLE_IDS } from "./model-roles";
import type { ModelRoleBatchUpdateResult, Settings } from "./settings";

export interface ModelRoleBulkAssignmentRequest {
	selector: string;
	roleIds: readonly string[];
}

export interface AssignmentDependencies {
	settings: Pick<Settings, "setModelRolesAtomic">;
}

export class ModelRoleAssignmentError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "ModelRoleAssignmentError";
	}
}

function assertConcreteSelector(selector: string): string {
	const normalized = selector.trim();
	const parsed = parseExactModelSelector(normalized);
	const routed = splitUpstreamRouting(normalized);
	if (
		!parsed ||
		(routed && (parsed.provider === "openrouter" || parsed.provider === "vercel-ai-gateway"))
	) {
		throw new ModelRoleAssignmentError("Model role assignments require an exact provider/model selector");
	}
	return normalized;
}


function normalizeRoleIds(roleIds: readonly string[]): string[] {
	const normalized = new Set<string>();
	for (const roleId of roleIds) {
		const trimmed = roleId.trim();
		if (
			!trimmed ||
			(!MODEL_ROLE_IDS.includes(trimmed as (typeof MODEL_ROLE_IDS)[number]) && !trimmed.startsWith("custom:"))
		) {
			throw new ModelRoleAssignmentError(`Unknown model role: ${roleId}`);
		}
		normalized.add(trimmed);
	}
	if (normalized.size === 0) {
		throw new ModelRoleAssignmentError("Assign at least one model role");
	}
	return [...normalized].sort();
}

/**
 * Validate a bulk role assignment, then commit its full change set through the
 * single Settings transaction rather than compensating individual role writes.
 */
export async function assignModelToRoles(
	request: ModelRoleBulkAssignmentRequest,
	deps: AssignmentDependencies,
): Promise<ModelRoleBatchUpdateResult> {
	const selector = assertConcreteSelector(request.selector);
	const roleIds = normalizeRoleIds(request.roleIds);
	return deps.settings.setModelRolesAtomic(Object.fromEntries(roleIds.map(roleId => [roleId, selector])));
}
