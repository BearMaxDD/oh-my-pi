import type { ModelAssignment, ModelVisibilityValue } from "../modes/model-visibility";
import type { BuildPlanRunPanelViewModelInput } from "./plan-run-panel-model";

export const PLAN_RUN_STATES = [
	"created",
	"project_recon_done",
	"main_plan_ready",
	"execution_book_ready",
	"todos_initialized",
	"tasks_running",
	"task_ready",
	"task_running",
	"task_green_evidence_pending",
	"codebase_memory_reindex_pending",
	"codebase_memory_reindex_done",
	"advisor_task_card_review_done",
	"model_routing_evidence_done",
	"superpowers_codebase_memory_gate_done",
	"task_review_pending",
	"task_accepted",
	"task_fix_required",
	"implementation_verified",
	"completion_doc_written",
	"global_impact_reviewing",
	"global_repair_required",
	"global_impact_accepted",
	"real_business_simulation_planning",
	"real_business_simulation_running",
	"real_business_simulation_repair_required",
	"real_business_simulation_passed",
	"final_acceptance_reviewing",
	"main_acceptance_review_running",
	"main_acceptance_fix_required",
	"fix_tasks_running",
	"main_acceptance_accepted",
	"accepted",
	"rejected",
	"blocked",
	"review_packet_validated",
	"ready_for_user",
] as const;

export type PlanRunState = (typeof PLAN_RUN_STATES)[number];
export type PlanRunGateState = Exclude<PlanRunState, "ready_for_user">;

export const PLAN_RUN_BLOCKER_REASONS = [
	"blocked_missing_red_evidence",
	"blocked_missing_green_evidence",
	"blocked_missing_regression_evidence",
	"blocked_tdd_order_violation",
	"blocked_stale_evidence",
	"blocked_advisor_blocker_unresolved",
] as const;

export type PlanRunBlockerReason = (typeof PLAN_RUN_BLOCKER_REASONS)[number];

export interface PlanRunBlocker {
	reason: PlanRunBlockerReason;
	message: string;
	evidencePath: string;
}

export interface BlockedPlanRun {
	state: "main_acceptance_fix_required";
	blockedAt: PlanRunGateState;
	blockers: PlanRunBlocker[];
}

export interface PlanRunArtifact {
	path: string;
	requires: string[];
}

export type PlanRunTodoStatus = "pending" | "in_progress" | "completed" | "abandoned" | "blocked";

export interface PlanRunTodoItem {
	id?: string;
	content: string;
	status: PlanRunTodoStatus;
	blockers?: string[];
	modelAssignment?: {
		executionModel?: ModelAssignment;
		advisorModel?: ModelVisibilityValue;
		assignedSubagentId?: string;
	};
}

export interface PlanRunTodoPhase {
	name: string;
	tasks: PlanRunTodoItem[];
}

export interface TodoSnapshot {
	runId: string;
	version: number;
	state: PlanRunState | string;
	updatedAt: string;
	source: "state-machine" | "todo-tool" | "rpc-sync" | string;
	phases: PlanRunTodoPhase[];
	tasks?: PlanRunTodoItem[];
}

export interface PlanRunSessionSnapshot {
	todoSnapshot?: TodoSnapshot;
	panel?: BuildPlanRunPanelViewModelInput;
	updatedAt?: string;
	degradedReasons?: string[];
}
