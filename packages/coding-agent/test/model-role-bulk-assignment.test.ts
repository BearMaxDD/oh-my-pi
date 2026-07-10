/**
 * Model role bulk assignment state machine — pure reducer.
 *
 * Contract:
 * 1. State steps cycle: thinking → roles → preview → saving → error
 * 2. Concrete selector → canSave=true, notConcreteReason=null
 * 3. Non-concrete (canonical/glob/alias) → canSave=false, reason set
 * 4. Preview only with selected roles; sorts them; shows actual changes
 * 5. Save failure retains selection & preview for retry; back from error
 *    returns to the last valid step without data loss
 * 6. Back from any non-initial step is safe (data preserved)
 * 7. Thinking level choice is stored and returned
 * 8. Reducer is pure: repeated calls with same state+action return identical
 *    (by value) results
 */

import { describe, expect, it } from "bun:test";
import { ThinkingLevel } from "@oh-my-pi/pi-agent-core";
import {
	initialBulkAssignmentState,
	bulkAssignmentReducer,
	type BulkAssignmentState,
	type BulkAssignmentAction,
	type BulkAssignmentSelectorDetail,
} from "../src/modes/components/model-role-bulk-assignment";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Build a state from partial overrides — used so each test doesn't repeat
 *  the seven fields of the initial state it doesn't test. */
function stateWith(overrides: Partial<BulkAssignmentState>): BulkAssignmentState {
	return { ...initialBulkAssignmentState, ...overrides };
}

function dispatch(
	state: BulkAssignmentState,
	action: BulkAssignmentAction,
): BulkAssignmentState {
	return bulkAssignmentReducer(state, action);
}

// ---------------------------------------------------------------------------
// Step 1: Thinking — model selector & thinking level
// ---------------------------------------------------------------------------

describe("thinking step — selector validation", () => {
	it("accepts concrete provider/model selector and enables saving", () => {
		const next = dispatch(initialBulkAssignmentState, {
			type: "SET_SELECTOR",
			selector: "anthropic/claude-sonnet-4-20250514",
			isConcrete: true,
		});

		expect(next.selector).toBe("anthropic/claude-sonnet-4-20250514");
		expect(next.notConcreteReason).toBeNull();
		expect(next.canSave).toBe(true);
	});

	it("rejects canonical selector (e.g. fast-latest) with displayable reason", () => {
		const next = dispatch(initialBulkAssignmentState, {
			type: "SET_SELECTOR",
			selector: "fast-latest",
			isConcrete: false,
			notConcreteReason: "Canonical selector does not pin a specific provider/model",
		});

		expect(next.selector).toBe("fast-latest");
		expect(next.notConcreteReason).toBe(
			"Canonical selector does not pin a specific provider/model",
		);
		expect(next.canSave).toBe(false);
	});

	it("rejects glob pattern selector with displayable reason", () => {
		const next = dispatch(initialBulkAssignmentState, {
			type: "SET_SELECTOR",
			selector: "anthropic/*",
			isConcrete: false,
			notConcreteReason: "Glob patterns are not allowed for bulk role assignment",
		});

		expect(next.selector).toBe("anthropic/*");
		expect(next.notConcreteReason).toBe(
			"Glob patterns are not allowed for bulk role assignment",
		);
		expect(next.canSave).toBe(false);
	});

	it("rejects alias selector with displayable reason", () => {
		const next = dispatch(initialBulkAssignmentState, {
			type: "SET_SELECTOR",
			selector: "@default",
			isConcrete: false,
			notConcreteReason: "Alias selectors are not allowed for bulk role assignment",
		});

		expect(next.selector).toBe("@default");
		expect(next.notConcreteReason).toBe(
			"Alias selectors are not allowed for bulk role assignment",
		);
		expect(next.canSave).toBe(false);
	});

	it("clears previous notConcreteReason when a concrete selector replaces a non-concrete one", () => {
		// Start with an alias
		const state = dispatch(initialBulkAssignmentState, {
			type: "SET_SELECTOR",
			selector: "@default",
			isConcrete: false,
			notConcreteReason: "Alias not supported",
		});

		const next = dispatch(state, {
			type: "SET_SELECTOR",
			selector: "openai/gpt-4o",
			isConcrete: true,
		});

		expect(next.selector).toBe("openai/gpt-4o");
		expect(next.notConcreteReason).toBeNull();
		expect(next.canSave).toBe(true);
	});

	it("preserves selector detail when available", () => {
		const detail: BulkAssignmentSelectorDetail = {
			provider: "anthropic",
			modelId: "claude-sonnet-4-20250514",
			isConcrete: true,
		};
		const next = dispatch(initialBulkAssignmentState, {
			type: "SET_SELECTOR",
			selector: "anthropic/claude-sonnet-4-20250514",
			isConcrete: true,
			detail,
		});

		expect(next.selectorDetail).toEqual(detail);
	});
});

describe("thinking step — thinking level choice", () => {
	it("accepts a concrete thinking level", () => {
		const next = dispatch(initialBulkAssignmentState, {
			type: "SET_THINKING_LEVEL",
			thinkingLevel: ThinkingLevel.High,
		});

		expect(next.thinkingLevel).toBe(ThinkingLevel.High);
	});

	it("accepts auto thinking level", () => {
		const next = dispatch(initialBulkAssignmentState, {
			type: "SET_THINKING_LEVEL",
			thinkingLevel: "auto",
		});

		expect(next.thinkingLevel).toBe("auto");
	});

	it("accepts thinking level off", () => {
		const next = dispatch(initialBulkAssignmentState, {
			type: "SET_THINKING_LEVEL",
			thinkingLevel: "off",
		});

		expect(next.thinkingLevel).toBe("off");
	});

	it("overwrites previous thinking level on successive calls", () => {
		const a = dispatch(initialBulkAssignmentState, {
			type: "SET_THINKING_LEVEL",
			thinkingLevel: ThinkingLevel.Low,
		});
		expect(a.thinkingLevel).toBe(ThinkingLevel.Low);

		const b = dispatch(a, {
			type: "SET_THINKING_LEVEL",
			thinkingLevel: ThinkingLevel.XHigh,
		});
		expect(b.thinkingLevel).toBe(ThinkingLevel.XHigh);
	});
});

describe("thinking→roles transition via NEXT", () => {
	it("advances to roles step when a concrete selector has been set", () => {
		const state = dispatch(initialBulkAssignmentState, {
			type: "SET_SELECTOR",
			selector: "openai/gpt-4o",
			isConcrete: true,
		});
		expect(state.step).toBe("thinking");

		const next = dispatch(state, { type: "NEXT" });
		expect(next.step).toBe("roles");
		expect(next.selector).toBe("openai/gpt-4o");
	});

	it("stays at thinking step when selector is non-concrete (glob)", () => {
		const state = dispatch(initialBulkAssignmentState, {
			type: "SET_SELECTOR",
			selector: "anthropic/*",
			isConcrete: false,
			notConcreteReason: "Glob patterns are not allowed",
		});

		const next = dispatch(state, { type: "NEXT" });
		expect(next.step).toBe("thinking");
	});

	it("stays at thinking step when no selector has been set", () => {
		const next = dispatch(initialBulkAssignmentState, { type: "NEXT" });
		expect(next.step).toBe("thinking");
	});

	it("stays at thinking when selector is a canonical alias", () => {
		const state = dispatch(initialBulkAssignmentState, {
			type: "SET_SELECTOR",
			selector: "fast-latest",
			isConcrete: false,
			notConcreteReason: "Canonical selector does not pin a specific provider/model",
		});

		const next = dispatch(state, { type: "NEXT" });
		expect(next.step).toBe("thinking");
	});
});

describe("SET_SELECTOR guard — no-op outside thinking step", () => {
	const modelState = {
		selector: "anthropic/claude-sonnet-4-20250514",
		canSave: true,
		thinkingLevel: ThinkingLevel.High,
		selectedRoleIds: ["default", "slow"],
		previewChanges: {
			changedRoleIds: ["default", "slow"],
			unchangedRoleIds: [],
			previous: { default: undefined, slow: "openai/gpt-4o" },
			next: { default: "anthropic/claude-sonnet-4-20250514", slow: "anthropic/claude-sonnet-4-20250514" },
			persisted: false,
		},
		availableRoleIds: ["default", "smol", "slow", "vision"],
	} satisfies Partial<BulkAssignmentState>;

	it("is a no-op in roles step — full state preserved", () => {
		const state: BulkAssignmentState = stateWith({ ...modelState, step: "roles" });
		const next = dispatch(state, {
			type: "SET_SELECTOR",
			selector: "openai/gpt-4o",
			isConcrete: true,
		});

		expect(next).toStrictEqual(state);
	});

	it("is a no-op in preview step — full state preserved", () => {
		const state: BulkAssignmentState = stateWith({ ...modelState, step: "preview" });
		const next = dispatch(state, {
			type: "SET_SELECTOR",
			selector: "openai/gpt-4o",
			isConcrete: true,
		});

		expect(next).toStrictEqual(state);
	});

	it("is a no-op in saving step — full state preserved", () => {
		const state: BulkAssignmentState = stateWith({ ...modelState, step: "saving" });
		const next = dispatch(state, {
			type: "SET_SELECTOR",
			selector: "openai/gpt-4o",
			isConcrete: true,
		});

		expect(next).toStrictEqual(state);
	});

	it("is a no-op in error step — full state including error preserved", () => {
		const state: BulkAssignmentState = stateWith({
			...modelState,
			step: "error",
			errorMessage: "Persistence error: file write failed",
		});
		const next = dispatch(state, {
			type: "SET_SELECTOR",
			selector: "openai/gpt-4o",
			isConcrete: true,
		});

		expect(next).toStrictEqual(state);
	});
});

// ---------------------------------------------------------------------------
// Role selection
// ---------------------------------------------------------------------------

describe("roles step — role toggling", () => {
	const rolesState: BulkAssignmentState = stateWith({
		step: "roles",
		availableRoleIds: ["default", "smol", "slow", "vision"],
		selectedRoleIds: [],
	});

	it("adds a role via TOGGLE_ROLE when not already selected", () => {
		const next = dispatch(rolesState, {
			type: "TOGGLE_ROLE",
			roleId: "default",
		});

		expect(next.selectedRoleIds).toEqual(["default"]);
	});

	it("removes a role via TOGGLE_ROLE when already selected", () => {
		const stateWithDefault = dispatch(rolesState, {
			type: "TOGGLE_ROLE",
			roleId: "default",
		});

		const next = dispatch(stateWithDefault, {
			type: "TOGGLE_ROLE",
			roleId: "default",
		});

		expect(next.selectedRoleIds).toEqual([]);
	});

	it("maintains other selected roles when toggling one off", () => {
		const withTwo = dispatch(
			dispatch(rolesState, { type: "TOGGLE_ROLE", roleId: "default" }),
			{ type: "TOGGLE_ROLE", roleId: "vision" },
		);
		expect([...withTwo.selectedRoleIds].sort()).toEqual(["default", "vision"]);

		const next = dispatch(withTwo, { type: "TOGGLE_ROLE", roleId: "default" });
		expect(next.selectedRoleIds).toEqual(["vision"]);
	});

	it("silently ignores TOGGLE_ROLE for a roleId not in availableRoleIds", () => {
		const next = dispatch(rolesState, {
			type: "TOGGLE_ROLE",
			roleId: "nonexistent",
		});

		expect(next).toStrictEqual(rolesState);
	});
});

describe("roles step — SET_SELECTED_ROLES", () => {
	it("replaces the entire selection set", () => {
		const state: BulkAssignmentState = stateWith({
			step: "roles",
			availableRoleIds: ["default", "smol", "slow", "vision"],
			selectedRoleIds: ["default"],
		});

		const next = dispatch(state, {
			type: "SET_SELECTED_ROLES",
			roleIds: ["smol", "vision"],
		});

		expect(next.selectedRoleIds).toEqual(["smol", "vision"]);
	});

	it("accepts empty selection", () => {
		const state: BulkAssignmentState = stateWith({
			step: "roles",
			availableRoleIds: ["default", "smol"],
			selectedRoleIds: ["default"],
		});

		const next = dispatch(state, {
			type: "SET_SELECTED_ROLES",
			roleIds: [],
		});

		expect(next.selectedRoleIds).toEqual([]);
	});

	it("filters out roleIds not present in availableRoleIds", () => {
		const state: BulkAssignmentState = stateWith({
			step: "roles",
			availableRoleIds: ["default", "smol", "slow"],
			selectedRoleIds: ["default"],
		});

		const next = dispatch(state, {
			type: "SET_SELECTED_ROLES",
			roleIds: ["default", "ghost", "smol"],
		});

		expect(next.selectedRoleIds).toEqual(["default", "smol"]);
	});

	it("deduplicates roleIds in the selection set", () => {
		const state: BulkAssignmentState = stateWith({
			step: "roles",
			availableRoleIds: ["default", "smol", "slow"],
			selectedRoleIds: [],
		});

		const next = dispatch(state, {
			type: "SET_SELECTED_ROLES",
			roleIds: ["default", "default", "smol", "default", "slow", "smol"],
		});

		expect(next.selectedRoleIds).toEqual(["default", "smol", "slow"]);
	});
});
describe("TOGGLE_ROLE and SET_SELECTED_ROLES guards — no-ops outside roles step", () => {
	const shared = {
		selector: "anthropic/claude-sonnet-4-20250514",
		canSave: true,
		thinkingLevel: ThinkingLevel.High,
		selectedRoleIds: ["default", "slow"],
		availableRoleIds: ["default", "smol", "slow", "vision"],
	} satisfies Partial<BulkAssignmentState>;

	const modelState = {
		...shared,
		previewChanges: {
			changedRoleIds: ["default", "slow"] as string[],
			unchangedRoleIds: [] as string[],
			previous: { default: undefined, slow: "openai/gpt-4o" },
			next: { default: "anthropic/claude-sonnet-4-20250514", slow: "anthropic/claude-sonnet-4-20250514" },
			persisted: false,
		},
	} satisfies Partial<BulkAssignmentState>;

	// --- TOGGLE_ROLE guards ---

	it("TOGGLE_ROLE is a no-op in preview step", () => {
		const state: BulkAssignmentState = stateWith({ ...modelState, step: "preview" });
		const next = dispatch(state, { type: "TOGGLE_ROLE", roleId: "default" });
		expect(next).toStrictEqual(state);
	});

	it("TOGGLE_ROLE is a no-op in saving step", () => {
		const state: BulkAssignmentState = stateWith({ ...modelState, step: "saving" });
		const next = dispatch(state, { type: "TOGGLE_ROLE", roleId: "default" });
		expect(next).toStrictEqual(state);
	});

	it("TOGGLE_ROLE is a no-op in error step", () => {
		const state: BulkAssignmentState = stateWith({
			...modelState,
			step: "error",
			errorMessage: "Persistence error",
		});
		const next = dispatch(state, { type: "TOGGLE_ROLE", roleId: "default" });
		expect(next).toStrictEqual(state);
	});

	// --- SET_SELECTED_ROLES guards ---

	it("SET_SELECTED_ROLES is a no-op in preview step", () => {
		const state: BulkAssignmentState = stateWith({ ...modelState, step: "preview" });
		const next = dispatch(state, { type: "SET_SELECTED_ROLES", roleIds: [] });
		expect(next).toStrictEqual(state);
	});

	it("SET_SELECTED_ROLES is a no-op in saving step", () => {
		const state: BulkAssignmentState = stateWith({ ...modelState, step: "saving" });
		const next = dispatch(state, { type: "SET_SELECTED_ROLES", roleIds: [] });
		expect(next).toStrictEqual(state);
	});

	it("SET_SELECTED_ROLES is a no-op in error step", () => {
		const state: BulkAssignmentState = stateWith({
			...modelState,
			step: "error",
			errorMessage: "Persistence error",
		});
		const next = dispatch(state, { type: "SET_SELECTED_ROLES", roleIds: [] });
		expect(next).toStrictEqual(state);
	});

	it("TOGGLE_ROLE is a no-op in thinking step (selector not yet confirmed)", () => {
		const state: BulkAssignmentState = stateWith({ ...modelState, step: "thinking" });
		const next = dispatch(state, { type: "TOGGLE_ROLE", roleId: "default" });
		expect(next).toStrictEqual(state);
	});

	it("SET_SELECTED_ROLES is a no-op in thinking step (selector not yet confirmed)", () => {
		const state: BulkAssignmentState = stateWith({ ...modelState, step: "thinking" });
		const next = dispatch(state, { type: "SET_SELECTED_ROLES", roleIds: [] });
		expect(next).toStrictEqual(state);
	});
});

describe("SET_THINKING_LEVEL and SET_AVAILABLE_ROLES guards — no-ops outside thinking step", () => {
	const modelState = {
		step: "thinking" as const,
		selector: "anthropic/claude-sonnet-4-20250514",
		canSave: true,
		thinkingLevel: ThinkingLevel.High,
		selectedRoleIds: ["default", "slow"],
		availableRoleIds: ["default", "smol", "slow", "vision"],
	} satisfies Partial<BulkAssignmentState>;

	// --- SET_THINKING_LEVEL guards ---

	it("SET_THINKING_LEVEL is a no-op in roles step", () => {
		const state: BulkAssignmentState = stateWith({ ...modelState, step: "roles" });
		const next = dispatch(state, { type: "SET_THINKING_LEVEL", thinkingLevel: ThinkingLevel.Low });
		expect(next).toStrictEqual(state);
	});

	it("SET_THINKING_LEVEL is a no-op in preview step", () => {
		const state: BulkAssignmentState = stateWith({ ...modelState, step: "preview", previewChanges: null });
		const next = dispatch(state, { type: "SET_THINKING_LEVEL", thinkingLevel: ThinkingLevel.Low });
		expect(next).toStrictEqual(state);
	});

	it("SET_THINKING_LEVEL is a no-op in saving step", () => {
		const state: BulkAssignmentState = stateWith({ ...modelState, step: "saving", previewChanges: null });
		const next = dispatch(state, { type: "SET_THINKING_LEVEL", thinkingLevel: ThinkingLevel.Low });
		expect(next).toStrictEqual(state);
	});

	it("SET_THINKING_LEVEL is a no-op in error step", () => {
		const state: BulkAssignmentState = stateWith({ ...modelState, step: "error", errorMessage: "err", previewChanges: null });
		const next = dispatch(state, { type: "SET_THINKING_LEVEL", thinkingLevel: ThinkingLevel.Low });
		expect(next).toStrictEqual(state);
	});

	// --- SET_AVAILABLE_ROLES guards ---

	it("SET_AVAILABLE_ROLES is a no-op in roles step", () => {
		const state: BulkAssignmentState = stateWith({ ...modelState, step: "roles" });
		const next = dispatch(state, { type: "SET_AVAILABLE_ROLES", roleIds: ["default", "smol"] });
		expect(next).toStrictEqual(state);
	});

	it("SET_AVAILABLE_ROLES is a no-op in preview step", () => {
		const state: BulkAssignmentState = stateWith({ ...modelState, step: "preview", previewChanges: null });
		const next = dispatch(state, { type: "SET_AVAILABLE_ROLES", roleIds: ["default", "smol"] });
		expect(next).toStrictEqual(state);
	});

	it("SET_AVAILABLE_ROLES is a no-op in saving step", () => {
		const state: BulkAssignmentState = stateWith({ ...modelState, step: "saving", previewChanges: null });
		const next = dispatch(state, { type: "SET_AVAILABLE_ROLES", roleIds: ["default", "smol"] });
		expect(next).toStrictEqual(state);
	});

	it("SET_AVAILABLE_ROLES is a no-op in error step", () => {
		const state: BulkAssignmentState = stateWith({ ...modelState, step: "error", errorMessage: "err", previewChanges: null });
		const next = dispatch(state, { type: "SET_AVAILABLE_ROLES", roleIds: ["default", "smol"] });
		expect(next).toStrictEqual(state);
	});
});

// ---------------------------------------------------------------------------
// Preview
// ---------------------------------------------------------------------------

describe("preview — transition and selection guard", () => {
	const stateInRoles: BulkAssignmentState = stateWith({
		step: "roles",
		selector: "anthropic/claude-sonnet-4-20250514",
		canSave: true,
		availableRoleIds: ["default", "smol", "slow", "vision"],
		selectedRoleIds: ["default", "slow"],
		thinkingLevel: ThinkingLevel.High,
	});

	it("transitions to preview step with sorted role IDs when roles are selected", () => {
		const next = dispatch(stateInRoles, {
			type: "PREVIEW",
			changes: {
				changedRoleIds: ["default", "slow"],
				unchangedRoleIds: [],
				previous: {},
				next: { default: "anthropic/claude-sonnet-4-20250514", slow: "anthropic/claude-sonnet-4-20250514" },
				persisted: false,
			},
		});

		expect(next.step).toBe("preview");
		expect(next.previewChanges).not.toBeNull();
		expect(next.previewChanges!.changedRoleIds).toEqual(["default", "slow"]);
		expect(next.selectedRoleIds).toEqual(["default", "slow"]);
	});

	it("stays in roles when no roles are selected (PREVIEW without selection)", () => {
		const emptySelection: BulkAssignmentState = {
			...stateInRoles,
			selectedRoleIds: [],
		};

		const next = dispatch(emptySelection, {
			type: "PREVIEW",
			changes: {
				changedRoleIds: [],
				unchangedRoleIds: [],
				previous: {},
				next: {},
				persisted: false,
			},
		});

		expect(next.step).toBe("roles");
		expect(next.previewChanges).toBeNull();
	});

	it("preview shows only selected role IDs in sorted order", () => {
		const unsortedState: BulkAssignmentState = {
			...stateInRoles,
			selectedRoleIds: ["slow", "vision", "default"],
		};

		const next = dispatch(unsortedState, {
			type: "PREVIEW",
			changes: {
				changedRoleIds: ["default", "slow", "vision"],
				unchangedRoleIds: [],
				previous: { default: undefined, slow: undefined, vision: undefined },
				next: {
					default: "anthropic/claude-sonnet-4-20250514",
					slow: "anthropic/claude-sonnet-4-20250514",
					vision: "anthropic/claude-sonnet-4-20250514",
				},
				persisted: false,
			},
		});

		// Role IDs in preview must be sorted
		expect(next.selectedRoleIds).toEqual(["default", "slow", "vision"]);
		expect(next.previewChanges!.changedRoleIds).toEqual(["default", "slow", "vision"]);
	});

	it("preview distinguishes changed vs unchanged roles", () => {
		const partialChanges: BulkAssignmentState = {
			...stateInRoles,
			availableRoleIds: ["default", "smol", "slow", "vision"],
			selectedRoleIds: ["default", "smol"],
		};

		const next = dispatch(partialChanges, {
			type: "PREVIEW",
			changes: {
				changedRoleIds: ["default"],
				unchangedRoleIds: ["smol"],
				previous: { default: "openai/gpt-4o", smol: "anthropic/claude-sonnet-4-20250514" },
				next: { default: "anthropic/claude-sonnet-4-20250514", smol: "anthropic/claude-sonnet-4-20250514" },
				persisted: false,
			},
		});

		expect(next.previewChanges!.changedRoleIds).toEqual(["default"]);
		expect(next.previewChanges!.unchangedRoleIds).toEqual(["smol"]);
	});
});

// ---------------------------------------------------------------------------
// Save cycle: saving → success / error
// ---------------------------------------------------------------------------

describe("save cycle — saving, success, and error", () => {
	const previewState: BulkAssignmentState = stateWith({
		step: "preview",
		selector: "anthropic/claude-sonnet-4-20250514",
		canSave: true,
		thinkingLevel: ThinkingLevel.High,
		selectedRoleIds: ["default", "slow"],
		previewChanges: {
			changedRoleIds: ["default", "slow"],
			unchangedRoleIds: [],
			previous: { default: undefined, slow: "openai/gpt-4o" },
			next: { default: "anthropic/claude-sonnet-4-20250514", slow: "anthropic/claude-sonnet-4-20250514" },
			persisted: false,
		},
	});

	it("SAVE transitions from preview to saving step", () => {
		const next = dispatch(previewState, { type: "SAVE" });
		expect(next.step).toBe("saving");
	});

	it("SAVE_SUCCESS transitions from saving to thinking (reset for next assignment)", () => {
		const savingState = dispatch(previewState, { type: "SAVE" });
		const next = dispatch(savingState, { type: "SAVE_SUCCESS" });

		expect(next.step).toBe("thinking");
		expect(next.selector).toBe("");
		expect(next.selectedRoleIds).toEqual([]);
		expect(next.previewChanges).toBeNull();
		expect(next.errorMessage).toBeNull();
	});

	it("SAVE_FAILURE transitions from saving to error, retaining selection and preview", () => {
		const savingState = dispatch(previewState, { type: "SAVE" });
		const next = dispatch(savingState, {
			type: "SAVE_FAILURE",
			error: "Persistence error: file write failed",
		});

		expect(next.step).toBe("error");
		expect(next.errorMessage).toBe("Persistence error: file write failed");
		// Selection and preview retained for retry
		expect(next.selector).toBe("anthropic/claude-sonnet-4-20250514");
		expect(next.selectedRoleIds).toEqual(["default", "slow"]);
		expect(next.previewChanges).not.toBeNull();
		expect(next.canSave).toBe(true);
	});

	it("SAVE_FAILURE stores the error message", () => {
		const savingState = dispatch(previewState, { type: "SAVE" });
		const next = dispatch(savingState, {
			type: "SAVE_FAILURE",
			error: "Network error: timeout",
		});

		expect(next.step).toBe("error");
		expect(next.errorMessage).toBe("Network error: timeout");
	});
});

// ---------------------------------------------------------------------------
// Retry from error
// ---------------------------------------------------------------------------

describe("retry from error", () => {
	const errorState: BulkAssignmentState = stateWith({
		step: "error",
		selector: "anthropic/claude-sonnet-4-20250514",
		canSave: true,
		thinkingLevel: ThinkingLevel.XHigh,
		selectedRoleIds: ["default", "slow"],
		previewChanges: {
			changedRoleIds: ["default", "slow"],
			unchangedRoleIds: [],
			previous: { default: undefined, slow: "openai/gpt-4o" },
			next: { default: "anthropic/claude-sonnet-4-20250514", slow: "anthropic/claude-sonnet-4-20250514" },
			persisted: false,
		},
		errorMessage: "Persistence error: file write failed",
	});

	it("RETRY transitions back to saving, retaining all selections", () => {
		const next = dispatch(errorState, { type: "RETRY" });

		expect(next.step).toBe("saving");
		// All data retained for retry
		expect(next.selector).toBe("anthropic/claude-sonnet-4-20250514");
		expect(next.thinkingLevel).toBe(ThinkingLevel.XHigh);
		expect(next.selectedRoleIds).toEqual(["default", "slow"]);
		expect(next.previewChanges).not.toBeNull();
		expect(next.canSave).toBe(true);
	});

	it("DISMISS_ERROR transitions from error to initial state", () => {
		const next = dispatch(errorState, { type: "DISMISS_ERROR" });

		expect(next.step).toBe("thinking");
		expect(next.selector).toBe("");
		expect(next.notConcreteReason).toBeNull();
		expect(next.selectedRoleIds).toEqual([]);
		expect(next.previewChanges).toBeNull();
		expect(next.errorMessage).toBeNull();
	});
});

// ---------------------------------------------------------------------------
// Back transitions (safe — data preserved)
// ---------------------------------------------------------------------------

describe("back transitions preserve state for retry", () => {
	it("BACK from roles returns to thinking, preserving selector and thinking", () => {
		const rolesState: BulkAssignmentState = stateWith({
			step: "roles",
			selector: "anthropic/claude-sonnet-4-20250514",
			canSave: true,
			thinkingLevel: ThinkingLevel.Medium,
			availableRoleIds: ["default", "smol", "slow"],
			selectedRoleIds: ["default"],
		});

		const next = dispatch(rolesState, { type: "BACK" });

		expect(next.step).toBe("thinking");
		expect(next.selector).toBe("anthropic/claude-sonnet-4-20250514");
		expect(next.thinkingLevel).toBe(ThinkingLevel.Medium);
	});

	it("BACK from preview returns to roles, preserving selected roles", () => {
		const previewState: BulkAssignmentState = stateWith({
			step: "preview",
			selector: "anthropic/claude-sonnet-4-20250514",
			canSave: true,
			thinkingLevel: ThinkingLevel.High,
			selectedRoleIds: ["default", "slow"],
			previewChanges: {
				changedRoleIds: ["default", "slow"],
				unchangedRoleIds: [],
				previous: { default: undefined, slow: "openai/gpt-4o" },
				next: { default: "anthropic/claude-sonnet-4-20250514", slow: "anthropic/claude-sonnet-4-20250514" },
				persisted: false,
			},
		});

		const next = dispatch(previewState, { type: "BACK" });

		expect(next.step).toBe("roles");
		expect(next.selectedRoleIds).toEqual(["default", "slow"]);
		// Preview cleared after going back to edit roles
		expect(next.previewChanges).toBeNull();
	});

	it("BACK from error returns to preview, preserving preview data", () => {
		const errorState: BulkAssignmentState = stateWith({
			step: "error",
			selector: "anthropic/claude-sonnet-4-20250514",
			canSave: true,
			thinkingLevel: ThinkingLevel.High,
			selectedRoleIds: ["default", "slow"],
			previewChanges: {
				changedRoleIds: ["default", "slow"],
				unchangedRoleIds: [],
				previous: { default: undefined, slow: "openai/gpt-4o" },
				next: { default: "anthropic/claude-sonnet-4-20250514", slow: "anthropic/claude-sonnet-4-20250514" },
				persisted: false,
			},
			errorMessage: "Persistence error: file write failed",
		});

		const next = dispatch(errorState, { type: "BACK" });

		expect(next.step).toBe("preview");
		expect(next.previewChanges).not.toBeNull();
		expect(next.previewChanges!.changedRoleIds).toEqual(["default", "slow"]);
		expect(next.selectedRoleIds).toEqual(["default", "slow"]);
		expect(next.errorMessage).toBeNull();
	});

	it("BACK from thinking is a no-op (already at initial step)", () => {
		const next = dispatch(initialBulkAssignmentState, { type: "BACK" });

		expect(next.step).toBe("thinking");
		expect(next).toEqual(initialBulkAssignmentState);
	});
});

describe("back→refresh→next→preview clears stale selected roles", () => {
	it("removes selected roleIds no longer in availableRoleIds when previewing after a back/refresh/NEXT cycle", () => {
		// User selects roles and previews
		const afterPreview = dispatch(
			stateWith({
				step: "roles",
				selector: "anthropic/claude-sonnet-4-20250514",
				canSave: true,
				availableRoleIds: ["default", "smol", "slow", "vision"],
				selectedRoleIds: ["default", "vision"],
			}),
			{ type: "PREVIEW", changes: { changedRoleIds: ["default", "vision"], unchangedRoleIds: [], previous: {}, next: { default: "anthropic/claude-sonnet-4-20250514", vision: "anthropic/claude-sonnet-4-20250514" }, persisted: false } },
		);
		expect(afterPreview.step).toBe("preview");

		// Go back through roles to thinking
		const afterRoles = dispatch(afterPreview, { type: "BACK" });
		expect(afterRoles.step).toBe("roles");

		const afterThinking = dispatch(afterRoles, { type: "BACK" });
		expect(afterThinking.step).toBe("thinking");

		// Available roles refresh at thinking step
		const afterRefresh = dispatch(afterThinking, { type: "SET_AVAILABLE_ROLES", roleIds: ["default", "smol"] });
		expect(afterRefresh.availableRoleIds).toEqual(["default", "smol"]);

		// NEXT to roles
		const afterNext = dispatch(afterRefresh, { type: "NEXT" });
		expect(afterNext.step).toBe("roles");

		// PREVIEW — stale "vision" removed, "smol" NOT auto-selected
		const afterPreview2 = dispatch(afterNext, {
			type: "PREVIEW",
			changes: { changedRoleIds: ["default"], unchangedRoleIds: [], previous: { default: undefined }, next: { default: "anthropic/claude-sonnet-4-20250514" }, persisted: false },
		});
		expect(afterPreview2.step).toBe("preview");
		expect(afterPreview2.selectedRoleIds).toEqual(["default"]);
		expect(afterPreview2.previewChanges!.changedRoleIds).toEqual(["default"]);
		expect(afterPreview2.previewChanges!.unchangedRoleIds).toEqual([]);
	});
});

// ---------------------------------------------------------------------------
// Reducer purity — same inputs always produce same output
// ---------------------------------------------------------------------------

describe("reducer purity", () => {
	it("produces identical state for repeated SET_SELECTOR calls", () => {
		const action: BulkAssignmentAction = {
			type: "SET_SELECTOR",
			selector: "openai/gpt-4o",
			isConcrete: true,
		};

		const a = dispatch(initialBulkAssignmentState, action);
		const b = dispatch(initialBulkAssignmentState, action);

		expect(a).toEqual(b);
	});

	it("produces identical state for repeated PREVIEW calls", () => {
		const state: BulkAssignmentState = stateWith({
			step: "roles",
			selector: "openai/gpt-4o",
			canSave: true,
			availableRoleIds: ["default", "smol"],
			selectedRoleIds: ["default"],
		});

		const action: BulkAssignmentAction = {
			type: "PREVIEW",
			changes: {
				changedRoleIds: ["default"],
				unchangedRoleIds: ["smol"],
				previous: { default: undefined, smol: "openai/gpt-4o" },
				next: { default: "openai/gpt-4o", smol: "openai/gpt-4o" },
				persisted: false,
			},
		};

		const a = dispatch(state, action);
		const b = dispatch(state, action);

		expect(a).toEqual(b);
	});
});

// ---------------------------------------------------------------------------
// Initial state shape
// ---------------------------------------------------------------------------

describe("initial state", () => {
	it("starts at thinking step with no selector, no roles, cannot save", () => {
		expect(initialBulkAssignmentState.step).toBe("thinking");
		expect(initialBulkAssignmentState.selector).toBe("");
		expect(initialBulkAssignmentState.notConcreteReason).toBeNull();
		expect(initialBulkAssignmentState.canSave).toBe(false);
		expect(initialBulkAssignmentState.selectedRoleIds).toEqual([]);
		expect(initialBulkAssignmentState.previewChanges).toBeNull();
		expect(initialBulkAssignmentState.errorMessage).toBeNull();
	});

	it("has no selector detail and default thinking level in initial state", () => {
		expect(initialBulkAssignmentState.selectorDetail).toBeUndefined();
		expect(initialBulkAssignmentState.thinkingLevel).toBe("inherit");
		expect(initialBulkAssignmentState.availableRoleIds).toEqual([]);
	});
});
