import type { ModelRoleBatchUpdateResult } from "../../config/settings";
import type { ConfiguredThinkingLevel } from "../../thinking";

export type BulkAssignmentStep = "thinking" | "roles" | "preview" | "saving" | "error";

/** Metadata supplied by the selector UI after it validates a model selector. */
export interface BulkAssignmentSelectorDetail {
	provider: string;
	modelId: string;
	isConcrete: boolean;
}

export interface BulkAssignmentState {
	step: BulkAssignmentStep;
	selector: string;
	selectorDetail?: BulkAssignmentSelectorDetail;
	notConcreteReason: string | null;
	thinkingLevel: ConfiguredThinkingLevel;
	availableRoleIds: readonly string[];
	selectedRoleIds: readonly string[];
	canSave: boolean;
	previewChanges: ModelRoleBatchUpdateResult | null;
	errorMessage: string | null;
}

export type BulkAssignmentAction =
	| {
			type: "SET_SELECTOR";
			selector: string;
			isConcrete: true;
			detail?: BulkAssignmentSelectorDetail;
	  }
	| {
			type: "SET_SELECTOR";
			selector: string;
			isConcrete: false;
			notConcreteReason: string;
			detail?: BulkAssignmentSelectorDetail;
	  }
	| { type: "SET_THINKING_LEVEL"; thinkingLevel: ConfiguredThinkingLevel }
	| { type: "SET_AVAILABLE_ROLES"; roleIds: readonly string[] }
	| { type: "NEXT" }
	| { type: "TOGGLE_ROLE"; roleId: string }
	| { type: "SET_SELECTED_ROLES"; roleIds: readonly string[] }
	| { type: "PREVIEW"; changes: ModelRoleBatchUpdateResult }
	| { type: "SAVE" }
	| { type: "SAVE_SUCCESS" }
	| { type: "SAVE_FAILURE"; error: string }
	| { type: "RETRY" }
	| { type: "DISMISS_ERROR" }
	| { type: "BACK" };

export const initialBulkAssignmentState: BulkAssignmentState = {
	step: "thinking",
	selector: "",
	notConcreteReason: null,
	thinkingLevel: "inherit",
	availableRoleIds: [],
	selectedRoleIds: [],
	canSave: false,
	previewChanges: null,
	errorMessage: null,
};

function resetBulkAssignmentState(): BulkAssignmentState {
	return {
		...initialBulkAssignmentState,
		availableRoleIds: [...initialBulkAssignmentState.availableRoleIds],
		selectedRoleIds: [],
	};
}

function normalizeSelectedRoleIds(roleIds: readonly string[], availableRoleIds?: readonly string[]): string[] {
	const available = availableRoleIds === undefined ? undefined : new Set(availableRoleIds);
	return [...new Set(roleIds.filter(roleId => available === undefined || available.has(roleId)))];
}

function previewForSelectedRoles(
	changes: ModelRoleBatchUpdateResult,
	selectedRoleIds: readonly string[],
): ModelRoleBatchUpdateResult {
	const selected = new Set(selectedRoleIds);
	const changed = new Set(changes.changedRoleIds);
	const unchanged = new Set(changes.unchangedRoleIds);
	const previous: Record<string, string | undefined> = {};
	const next: Record<string, string> = {};

	for (const roleId of selectedRoleIds) {
		if (Object.hasOwn(changes.previous, roleId)) {
			previous[roleId] = changes.previous[roleId];
		}
		if (Object.hasOwn(changes.next, roleId)) {
			next[roleId] = changes.next[roleId];
		}
	}

	return {
		changedRoleIds: selectedRoleIds.filter(roleId => selected.has(roleId) && changed.has(roleId)),
		unchangedRoleIds: selectedRoleIds.filter(roleId => selected.has(roleId) && unchanged.has(roleId)),
		previous,
		next,
		persisted: changes.persisted,
	};
}

/**
 * Pure state machine for a bulk model-role assignment flow. Selector validation
 * and settings persistence are performed by the UI/controller; this reducer
 * only records their results and makes legal transitions explicit.
 */
export function bulkAssignmentReducer(state: BulkAssignmentState, action: BulkAssignmentAction): BulkAssignmentState {
	switch (action.type) {
		case "SET_SELECTOR":
			if (state.step !== "thinking") {
				return state;
			}
			return {
				...state,
				selector: action.selector,
				selectorDetail: action.detail === undefined ? undefined : { ...action.detail },
				notConcreteReason: action.isConcrete ? null : action.notConcreteReason,
				canSave: action.isConcrete,
			};

		case "SET_THINKING_LEVEL":
			return state.step === "thinking" ? { ...state, thinkingLevel: action.thinkingLevel } : state;

		case "SET_AVAILABLE_ROLES":
			return state.step === "thinking"
				? {
						...state,
						availableRoleIds: [...action.roleIds],
						selectedRoleIds: normalizeSelectedRoleIds(state.selectedRoleIds, action.roleIds),
					}
				: state;

		case "NEXT":
			return state.step === "thinking" && state.canSave
				? {
						...state,
						step: "roles",
						selectedRoleIds: normalizeSelectedRoleIds(state.selectedRoleIds, state.availableRoleIds),
					}
				: state;

		case "TOGGLE_ROLE": {
			if (state.step !== "roles") {
				return state;
			}
			if (!state.availableRoleIds.includes(action.roleId)) {
				return state;
			}
			const selectedRoleIds = normalizeSelectedRoleIds(
				state.selectedRoleIds.includes(action.roleId)
					? state.selectedRoleIds.filter(roleId => roleId !== action.roleId)
					: [...state.selectedRoleIds, action.roleId],
				state.availableRoleIds,
			);
			return { ...state, selectedRoleIds };
		}

		case "SET_SELECTED_ROLES":
			if (state.step !== "roles") {
				return state;
			}
			return {
				...state,
				selectedRoleIds: normalizeSelectedRoleIds(action.roleIds, state.availableRoleIds),
			};

		case "PREVIEW": {
			if (state.step !== "roles" || state.selectedRoleIds.length === 0) {
				return state;
			}
			const selectedRoleIds = normalizeSelectedRoleIds(state.selectedRoleIds, state.availableRoleIds).sort();
			return {
				...state,
				step: "preview",
				selectedRoleIds,
				previewChanges: previewForSelectedRoles(action.changes, selectedRoleIds),
				errorMessage: null,
			};
		}

		case "SAVE":
			return state.step === "preview" && state.canSave && state.selectedRoleIds.length > 0
				? { ...state, step: "saving", errorMessage: null }
				: state;

		case "SAVE_SUCCESS":
			return state.step === "saving" ? resetBulkAssignmentState() : state;

		case "SAVE_FAILURE":
			return state.step === "saving" ? { ...state, step: "error", errorMessage: action.error } : state;

		case "RETRY":
			return state.step === "error" ? { ...state, step: "saving", errorMessage: null } : state;

		case "DISMISS_ERROR":
			return state.step === "error" ? resetBulkAssignmentState() : state;

		case "BACK":
			switch (state.step) {
				case "roles":
					return { ...state, step: "thinking" };
				case "preview":
					return { ...state, step: "roles", previewChanges: null };
				case "error":
					return { ...state, step: "preview", errorMessage: null };
				default:
					return state;
			}
	}
}
