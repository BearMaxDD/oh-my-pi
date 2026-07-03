import type { BlockedPlanRun, PlanRunBlocker, PlanRunGateState, PlanRunState } from "./types";

const NEXT_STATES: Record<Exclude<PlanRunState, "ready_for_user">, PlanRunState | undefined> = {
	created: "project_recon_done",
	project_recon_done: "main_plan_ready",
	main_plan_ready: "execution_book_ready",
	execution_book_ready: "todos_initialized",
	todos_initialized: undefined,
	tasks_running: "implementation_verified",
	task_ready: "task_running",
	task_running: "task_green_evidence_pending",
	task_green_evidence_pending: "codebase_memory_reindex_pending",
	codebase_memory_reindex_pending: "codebase_memory_reindex_done",
	codebase_memory_reindex_done: "advisor_task_card_review_done",
	advisor_task_card_review_done: "model_routing_evidence_done",
	model_routing_evidence_done: "superpowers_codebase_memory_gate_done",
	superpowers_codebase_memory_gate_done: "task_review_pending",
	task_review_pending: undefined,
	task_accepted: "implementation_verified",
	task_fix_required: "task_running",
	implementation_verified: "completion_doc_written",
	completion_doc_written: "global_impact_reviewing",
	global_impact_reviewing: undefined,
	global_repair_required: "fix_tasks_running",
	global_impact_accepted: "real_business_simulation_planning",
	real_business_simulation_planning: "real_business_simulation_running",
	real_business_simulation_running: undefined,
	real_business_simulation_repair_required: "fix_tasks_running",
	real_business_simulation_passed: "final_acceptance_reviewing",
	final_acceptance_reviewing: undefined,
	accepted: undefined,
	rejected: undefined,
	blocked: undefined,
	main_acceptance_review_running: undefined,
	main_acceptance_fix_required: "fix_tasks_running",
	fix_tasks_running: "main_acceptance_review_running",
	main_acceptance_accepted: "review_packet_validated",
	review_packet_validated: "ready_for_user",
};

const BRANCHING_NEXT_STATES: Partial<Record<PlanRunState, readonly PlanRunState[]>> = {
	completion_doc_written: ["global_impact_reviewing", "main_acceptance_review_running"],
	todos_initialized: ["task_ready", "tasks_running"],
	task_review_pending: ["task_accepted", "task_fix_required"],
	main_acceptance_review_running: ["main_acceptance_fix_required", "main_acceptance_accepted"],
	global_impact_reviewing: ["global_repair_required", "global_impact_accepted"],
	real_business_simulation_running: ["real_business_simulation_repair_required", "real_business_simulation_passed"],
	final_acceptance_reviewing: ["accepted", "rejected", "blocked", "main_acceptance_review_running"],
};

export function advancePlanRunState(current: PlanRunState, next: PlanRunState): PlanRunState {
	if (current === "ready_for_user") {
		throw new Error("Invalid plan run transition: ready_for_user is terminal");
	}
	const allowed = BRANCHING_NEXT_STATES[current] ?? [NEXT_STATES[current]];
	if (!allowed.includes(next)) {
		throw new Error(`Invalid plan run transition: ${current} -> ${next}`);
	}
	return next;
}

export function isPlanRunTerminal(state: PlanRunState): boolean {
	return state === "ready_for_user" || state === "accepted" || state === "rejected" || state === "blocked";
}

export function createBlockedPlanRun(blockedAt: PlanRunGateState, blockers: PlanRunBlocker[]): BlockedPlanRun {
	if (blockers.length === 0) {
		throw new Error("main_acceptance_fix_required requires at least one blocker");
	}
	return { state: "main_acceptance_fix_required", blockedAt, blockers };
}
