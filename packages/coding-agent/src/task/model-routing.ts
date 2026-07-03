/**
 * Pure role-bound model routing resolver.
 *
 * Resolves a modelRole (explicit or inferred from role) to a set of model
 * overrides, handling configured role models, agent model overrides, and
 * superpower-specific fallback chains.
 *
 * This module powers Task 4 of the role-bound superpowers rollout.
 */
import { resolveAgentModelPatterns, resolveConfiguredModelPatterns } from "../config/model-resolver";
import { getKnownRoleIds, MODEL_ROLES, type ModelRole } from "../config/model-roles";
import type { Settings } from "../config/settings";

export interface ResolveTaskModelRoutingOptions {
	/** Explicit model role key (e.g. "smol", "superpowers:test-runner"). */
	modelRole?: string;
	/**
	 * Agent role name. When modelRole is absent but role matches a known model
	 * role key, modelRole is inferred from role.
	 */
	role?: string;
	/** Raw task.agentModelOverrides settings value (Record<agentName, model>). */
	agentModelOverrides?: Record<string, string>;
	/** Name of the agent being spawned (used as key into agentModelOverrides). */
	agentName?: string;
	/** Agent definition model patterns (legacy fallback). */
	agentModel?: string | string[];
	/** Settings instance for model role lookups. */
	settings?: Settings;
	/** Active session model pattern (legacy fallback). */
	activeModelPattern?: string;
	/** Fallback model pattern (legacy fallback). */
	fallbackModelPattern?: string;
}

export interface TaskModelRoutingResolution {
	/** Resolved model role (undefined when no modelRole is determined). */
	modelRole: string | undefined;
	/**
	 * The explicitly requested model pattern from
	 * settings.modelRoles[modelRole] or agentModelOverrides[agentName]
	 * (whichever had priority).
	 */
	requestedModel: string | undefined;
	/** Ordered fallback role names (e.g. ["smol", "task", "default"]). */
	fallbackModelRoles: string[];
	/**
	 * Unique, ordered model override patterns — includes the requested model
	 * (if any) followed by resolved fallback role patterns — deduplicated and
	 * ready to feed into model resolution.
	 */
	modelOverrides: string[];
}

/** Fallback chains for superpower roles when no model is explicitly configured. */
const SUPERPOWERS_ROLE_FALLBACKS: Record<string, string[]> = {
	"superpowers:tdd-writer": ["task", "default"],
	"superpowers:implementer": ["task", "default"],
	"superpowers:test-runner": ["smol", "task", "default"],
	"superpowers:spec-reviewer": ["acceptance", "slow", "default"],
	"superpowers:quality-reviewer": ["acceptance", "slow", "default"],
	"superpowers:acceptance": ["acceptance", "slow", "default"],
};

const DEFAULT_FALLBACK: string[] = ["task", "default"];

/**
 * Resolve model routing for a task spawn based on modelRole, role, and settings.
 *
 * Behaviour:
 * - When modelRole is explicitly set: check settings.modelRoles[modelRole]
 *   first, then agentModelOverrides[agentName], then fallback to role fallbacks.
 * - When modelRole is absent but role matches a known model role key: infer
 *   modelRole = role, then proceed as above.
 * - When neither modelRole nor a known model role is available: fall back to
 *   the legacy resolveAgentModelPatterns behaviour.
 */
export function resolveTaskModelRouting(options: ResolveTaskModelRoutingOptions): TaskModelRoutingResolution {
	const {
		modelRole,
		role,
		agentModelOverrides,
		agentName,
		agentModel,
		settings,
		activeModelPattern,
		fallbackModelPattern,
	} = options;

	// ── Step 1: determine effective modelRole ──────────────────────────────
	let effectiveModelRole: string | undefined = modelRole;

	if (!effectiveModelRole && role) {
		const knownRoleIds = settings ? getKnownRoleIds(settings) : [];
		if (knownRoleIds.includes(role)) {
			effectiveModelRole = role;
		}
	}

	// ── Step 2: no modelRole → legacy path ─────────────────────────────────
	if (!effectiveModelRole) {
		const overrideModel = agentName ? agentModelOverrides?.[agentName] : undefined;
		const legacyPatterns = resolveAgentModelPatterns({
			settingsOverride: overrideModel,
			agentModel,
			settings,
			activeModelPattern,
			fallbackModelPattern,
		});

		return {
			modelRole: undefined,
			requestedModel: undefined,
			fallbackModelRoles: [],
			modelOverrides: legacyPatterns,
		};
	}

	// ── Step 3: resolve requested model ────────────────────────────────────
	const roleModel = settings?.getModelRole(effectiveModelRole);
	const overrideModel = agentName ? agentModelOverrides?.[agentName] : undefined;
	const requestedModel = roleModel ?? overrideModel;

	// ── Step 4: determine fallback roles ────────────────────────────────────
	// Registry fallbackRoleIds take priority for superpowers roles, falling back
	// to SUPERPOWERS_ROLE_FALLBACKS compatibility map, then DEFAULT_FALLBACK.
	const isSuperpower = effectiveModelRole.startsWith("superpowers:");
	const registryInfo = isSuperpower ? MODEL_ROLES[effectiveModelRole as ModelRole] : undefined;
	const fallbackModelRoles = registryInfo?.fallbackRoleIds?.length
		? registryInfo.fallbackRoleIds
		: (SUPERPOWERS_ROLE_FALLBACKS[effectiveModelRole] ?? DEFAULT_FALLBACK);

	// ── Step 5: build unique model override patterns ───────────────────────
	const allPatterns: string[] = [];

	if (requestedModel) {
		allPatterns.push(...resolveConfiguredModelPatterns(requestedModel, settings));
	}

	for (const fbRole of fallbackModelRoles) {
		// Priority: configured model > pi/ alias (for roles with priority chains) > bare role name
		const configuredFallbackModel = settings?.getModelRole(fbRole);
		if (configuredFallbackModel) {
			allPatterns.push(...resolveConfiguredModelPatterns(configuredFallbackModel, settings));
		} else {
			const aliasPatterns = resolveConfiguredModelPatterns(`pi/${fbRole}`, settings);
			if (aliasPatterns.length > 0) {
				allPatterns.push(...aliasPatterns);
			} else {
				allPatterns.push(fbRole);
			}
		}
	}

	const seen = new Set<string>();
	const modelOverrides = allPatterns.filter(p => {
		if (seen.has(p)) return false;
		seen.add(p);
		return true;
	});

	return {
		modelRole: effectiveModelRole,
		requestedModel,
		fallbackModelRoles,
		modelOverrides,
	};
}
