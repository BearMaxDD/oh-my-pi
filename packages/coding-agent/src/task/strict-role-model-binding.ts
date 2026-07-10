import { createHash } from "node:crypto";
import { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import type { Effort, Model } from "@oh-my-pi/pi-ai";
import { getSupportedEfforts } from "@oh-my-pi/pi-catalog/model-thinking";
import { findExactAvailableModel, parseExactModelSelector, splitUpstreamRouting } from "../config/model-resolver";
import type { Settings } from "../config/settings";
import { AUTO_THINKING } from "../thinking";

export type StrictRoleModelBindingErrorCode =
	| "role_model_unconfigured"
	| "role_model_not_concrete"
	| "role_model_unavailable"
	| "role_thinking_unsupported";

export class StrictRoleModelBindingError extends Error {
	constructor(
		public readonly code: StrictRoleModelBindingErrorCode,
		public readonly roleId: string,
		message: string,
	) {
		super(message);
		this.name = "StrictRoleModelBindingError";
	}
}

export interface StrictRoleModelContract {
	contractVersion?: string | number;
	version?: string | number;
}

export interface ResolveStrictRoleModelBindingOptions {
	validatedRoleId: string;
	contract: StrictRoleModelContract;
	settings: Settings;
	availableModels: readonly Model[];
}

export interface StrictRoleModelBinding {
	schemaVersion: 1;
	contractVersion: string | number;
	roleId: string;
	configuredSelector: string;
	provider: string;
	modelId: string;
	modelRef: string;
	model: Model;
	thinkingSource: "explicit" | "model_default";
	thinkingLevel: Effort | ThinkingLevel | undefined;
	canonicalSelector: string;
	createdAt: string;
	bindingHash: string;
}

export function computeStrictRoleModelBindingHash(input: {
	roleId: string;
	configuredSelector: string;
	provider: string;
	modelId: string;
	thinkingLevel: StrictRoleModelBinding["thinkingLevel"];
	contractVersion: string | number;
}): string {
	return createHash("sha256")
		.update(
			JSON.stringify([
				input.roleId,
				input.configuredSelector,
				input.provider,
				input.modelId,
				input.thinkingLevel ?? null,
				input.contractVersion,
			]),
		)
		.digest("hex");
}

function strictError(
	code: StrictRoleModelBindingErrorCode,
	roleId: string,
	message: string,
): StrictRoleModelBindingError {
	return new StrictRoleModelBindingError(code, roleId, message);
}

/**
 * Resolve a role's configured selector into a pinned, exact available model.
 *
 * Unlike the legacy task router, this path neither expands role aliases nor
 * falls back across providers or model variants.
 */
export function resolveStrictRoleModelBinding(options: ResolveStrictRoleModelBindingOptions): StrictRoleModelBinding {
	const { validatedRoleId: roleId, contract, settings, availableModels } = options;
	const configuredSelector = settings.getModelRole(roleId);
	if (!configuredSelector?.trim()) {
		throw strictError("role_model_unconfigured", roleId, `No model is configured for role ${roleId}`);
	}

	const parsed = parseExactModelSelector(configuredSelector);
	if (!parsed) {
		throw strictError("role_model_not_concrete", roleId, `Role ${roleId} must use an exact provider/model selector`);
	}

	// Exact model IDs win (for example Vertex's `@default` deployments). Only
	// an unavailable @-suffixed selector whose exact base exists is routing
	// syntax rather than a literal unavailable model ID.
	const model = findExactAvailableModel(availableModels, parsed.provider, parsed.id);
	if (!model) {
		const routing = splitUpstreamRouting(configuredSelector);
		const routedBase = routing ? parseExactModelSelector(routing.base) : undefined;
		if (
			routedBase &&
			findExactAvailableModel(availableModels, routedBase.provider, routedBase.id)
		) {
			throw strictError("role_model_not_concrete", roleId, `Role ${roleId} must use an exact provider/model selector`);
		}
		throw strictError(
			"role_model_unavailable",
			roleId,
			`Configured model ${parsed.provider}/${parsed.id} is unavailable for role ${roleId}`,
		);
	}

	const requestedThinking = parsed.thinkingLevel;
	let thinkingLevel: Effort | ThinkingLevel | undefined;
	let thinkingSource: StrictRoleModelBinding["thinkingSource"] = "model_default";
	if (requestedThinking !== undefined) {
		if (requestedThinking === ThinkingLevel.Off) {
			thinkingLevel = ThinkingLevel.Off;
		} else if (
			requestedThinking === ThinkingLevel.Inherit ||
			requestedThinking === AUTO_THINKING ||
			!getSupportedEfforts(model).includes(requestedThinking as Effort)
		) {
			throw strictError(
				"role_thinking_unsupported",
				roleId,
				`Thinking level ${requestedThinking} is unsupported by ${parsed.provider}/${parsed.id}`,
			);
		} else {
			thinkingLevel = requestedThinking as Effort;
		}
		thinkingSource = "explicit";
	}

	const canonicalSelector = `${parsed.provider}/${parsed.id}`;
	const contractVersion = contract.contractVersion ?? contract.version ?? 1;
	return {
		schemaVersion: 1,
		contractVersion,
		roleId,
		configuredSelector,
		provider: parsed.provider,
		modelId: parsed.id,
		modelRef: canonicalSelector,
		model,
		thinkingSource,
		thinkingLevel,
		canonicalSelector,
		createdAt: new Date().toISOString(),
		bindingHash: computeStrictRoleModelBindingHash({
			roleId,
			configuredSelector,
			provider: parsed.provider,
			modelId: parsed.id,
			thinkingLevel,
			contractVersion,
		}),
	};
}
