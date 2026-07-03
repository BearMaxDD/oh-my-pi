import { describe, expect, it } from "bun:test";
import { advancePlanRunState, createBlockedPlanRun, isPlanRunTerminal } from "../../src/codex-plan-run/state-machine";

describe("autonomous plan run state machine", () => {
	it("advances through the autonomous happy path", () => {
		let state = advancePlanRunState("created", "project_recon_done");
		state = advancePlanRunState(state, "main_plan_ready");
		state = advancePlanRunState(state, "execution_book_ready");
		state = advancePlanRunState(state, "todos_initialized");
		state = advancePlanRunState(state, "tasks_running");
		state = advancePlanRunState(state, "implementation_verified");
		state = advancePlanRunState(state, "completion_doc_written");
		state = advancePlanRunState(state, "main_acceptance_review_running");
		state = advancePlanRunState(state, "main_acceptance_accepted");
		state = advancePlanRunState(state, "review_packet_validated");
		state = advancePlanRunState(state, "ready_for_user");

		expect(state).toBe("ready_for_user");
		expect(isPlanRunTerminal(state)).toBe(true);
	});

	it("rejects skipped gates", () => {
		expect(() => advancePlanRunState("created", "tasks_running")).toThrow(
			"Invalid plan run transition: created -> tasks_running",
		);
	});

	it("returns acceptance repair runs to main acceptance review", () => {
		let state = advancePlanRunState("main_acceptance_review_running", "main_acceptance_fix_required");
		state = advancePlanRunState(state, "fix_tasks_running");
		state = advancePlanRunState(state, "main_acceptance_review_running");

		expect(state).toBe("main_acceptance_review_running");
	});

	it("keeps repair subagent rounds inside the acceptance loop", () => {
		let state = advancePlanRunState("main_acceptance_review_running", "main_acceptance_fix_required");
		state = advancePlanRunState(state, "fix_tasks_running");
		state = advancePlanRunState(state, "main_acceptance_review_running");
		state = advancePlanRunState(state, "main_acceptance_fix_required");
		state = advancePlanRunState(state, "fix_tasks_running");
		state = advancePlanRunState(state, "main_acceptance_review_running");
		state = advancePlanRunState(state, "main_acceptance_accepted");
		state = advancePlanRunState(state, "review_packet_validated");
		state = advancePlanRunState(state, "ready_for_user");

		expect(state).toBe("ready_for_user");
	});

	it("stores concrete blocker evidence", () => {
		const blocked = createBlockedPlanRun("main_acceptance_review_running", [
			{
				reason: "blocked_missing_red_evidence",
				message: "Task T1 has no RED_EVIDENCE",
				evidencePath: ".omp/plan-runs/run-1/tdd-evidence-matrix.json",
			},
		]);

		expect(blocked.state).toBe("main_acceptance_fix_required");
		expect(blocked.blockers[0]?.reason).toBe("blocked_missing_red_evidence");
	});

	it("advances through the task-level evidence/reindex/advisor/model-routing/superpowers chain", () => {
		let state = advancePlanRunState("task_green_evidence_pending", "codebase_memory_reindex_pending");
		state = advancePlanRunState(state, "codebase_memory_reindex_done");
		state = advancePlanRunState(state, "advisor_task_card_review_done");
		state = advancePlanRunState(state, "model_routing_evidence_done");
		state = advancePlanRunState(state, "superpowers_codebase_memory_gate_done");
		state = advancePlanRunState(state, "task_review_pending");

		expect(state).toBe("task_review_pending");
		expect(isPlanRunTerminal(state)).toBe(false);
	});

	it("rejects invalid transitions in the task-level chain", () => {
		expect(() => advancePlanRunState("task_green_evidence_pending", "task_review_pending")).toThrow(
			"Invalid plan run transition: task_green_evidence_pending -> task_review_pending",
		);
	});

	it("advances from todos_initialized through the new task path and back to implementation_verified", () => {
		let state = advancePlanRunState("todos_initialized", "task_ready");
		state = advancePlanRunState(state, "task_running");
		state = advancePlanRunState(state, "task_green_evidence_pending");
		state = advancePlanRunState(state, "codebase_memory_reindex_pending");
		state = advancePlanRunState(state, "codebase_memory_reindex_done");
		state = advancePlanRunState(state, "advisor_task_card_review_done");
		state = advancePlanRunState(state, "model_routing_evidence_done");
		state = advancePlanRunState(state, "superpowers_codebase_memory_gate_done");
		state = advancePlanRunState(state, "task_review_pending");
		state = advancePlanRunState(state, "task_accepted");
		state = advancePlanRunState(state, "implementation_verified");

		expect(state).toBe("implementation_verified");
	});

	it("supports task_fix_required loop back to task_running", () => {
		let state = advancePlanRunState("task_review_pending", "task_fix_required");
		state = advancePlanRunState(state, "task_running");
		state = advancePlanRunState(state, "task_green_evidence_pending");

		expect(state).toBe("task_green_evidence_pending");
	});

	it("preserves old path todos_initialized -> tasks_running -> implementation_verified", () => {
		let state = advancePlanRunState("todos_initialized", "tasks_running");
		state = advancePlanRunState(state, "implementation_verified");

		expect(state).toBe("implementation_verified");
	});

	it("preserves acceptance repair loop", () => {
		let state = advancePlanRunState("main_acceptance_review_running", "main_acceptance_fix_required");
		state = advancePlanRunState(state, "fix_tasks_running");
		state = advancePlanRunState(state, "main_acceptance_review_running");

		expect(state).toBe("main_acceptance_review_running");
	});

	it("preserves full old autonomous happy path", () => {
		let state = advancePlanRunState("created", "project_recon_done");
		state = advancePlanRunState(state, "main_plan_ready");
		state = advancePlanRunState(state, "execution_book_ready");
		state = advancePlanRunState(state, "todos_initialized");
		state = advancePlanRunState(state, "tasks_running");
		state = advancePlanRunState(state, "implementation_verified");
		state = advancePlanRunState(state, "completion_doc_written");
		state = advancePlanRunState(state, "main_acceptance_review_running");
		state = advancePlanRunState(state, "main_acceptance_accepted");
		state = advancePlanRunState(state, "review_packet_validated");
		state = advancePlanRunState(state, "ready_for_user");

		expect(state).toBe("ready_for_user");
	});

	it("advances through global impact, real business simulation, final acceptance to accepted", () => {
		let state = advancePlanRunState("completion_doc_written", "global_impact_reviewing");
		state = advancePlanRunState(state, "global_impact_accepted");
		state = advancePlanRunState(state, "real_business_simulation_planning");
		state = advancePlanRunState(state, "real_business_simulation_running");
		state = advancePlanRunState(state, "real_business_simulation_passed");
		state = advancePlanRunState(state, "final_acceptance_reviewing");
		state = advancePlanRunState(state, "accepted");

		expect(state).toBe("accepted");
		expect(isPlanRunTerminal(state)).toBe(true);
	});

	it("advances through global impact, real business simulation, final acceptance to main acceptance review", () => {
		let state = advancePlanRunState("completion_doc_written", "global_impact_reviewing");
		state = advancePlanRunState(state, "global_impact_accepted");
		state = advancePlanRunState(state, "real_business_simulation_planning");
		state = advancePlanRunState(state, "real_business_simulation_running");
		state = advancePlanRunState(state, "real_business_simulation_passed");
		state = advancePlanRunState(state, "final_acceptance_reviewing");
		state = advancePlanRunState(state, "main_acceptance_review_running");
		state = advancePlanRunState(state, "main_acceptance_accepted");
		state = advancePlanRunState(state, "review_packet_validated");
		state = advancePlanRunState(state, "ready_for_user");

		expect(state).toBe("ready_for_user");
		expect(isPlanRunTerminal(state)).toBe(true);
	});

	it("routes global_repair_required back to fix_tasks_running", () => {
		let state = advancePlanRunState("global_impact_reviewing", "global_repair_required");
		state = advancePlanRunState(state, "fix_tasks_running");

		expect(state).toBe("fix_tasks_running");
	});

	it("routes real_business_simulation_repair_required back to fix_tasks_running", () => {
		let state = advancePlanRunState("real_business_simulation_running", "real_business_simulation_repair_required");
		state = advancePlanRunState(state, "fix_tasks_running");

		expect(state).toBe("fix_tasks_running");
	});

	it("terminates on accepted, rejected, and blocked states", () => {
		expect(isPlanRunTerminal("accepted")).toBe(true);
		expect(isPlanRunTerminal("rejected")).toBe(true);
		expect(isPlanRunTerminal("blocked")).toBe(true);
		expect(isPlanRunTerminal("ready_for_user")).toBe(true);
		expect(isPlanRunTerminal("created")).toBe(false);
		expect(isPlanRunTerminal("final_acceptance_reviewing")).toBe(false);
		expect(isPlanRunTerminal("global_impact_reviewing")).toBe(false);
		expect(isPlanRunTerminal("real_business_simulation_running")).toBe(false);
	});

	it("rejects invalid branch from final_acceptance_reviewing", () => {
		expect(() => advancePlanRunState("final_acceptance_reviewing", "completion_doc_written")).toThrow(
			"Invalid plan run transition: final_acceptance_reviewing -> completion_doc_written",
		);
	});

	it("rejects invalid branch from real_business_simulation_running", () => {
		expect(() => advancePlanRunState("real_business_simulation_running", "accepted")).toThrow(
			"Invalid plan run transition: real_business_simulation_running -> accepted",
		);
	});

	it("rejects invalid branch from global_impact_reviewing", () => {
		expect(() => advancePlanRunState("global_impact_reviewing", "main_acceptance_review_running")).toThrow(
			"Invalid plan run transition: global_impact_reviewing -> main_acceptance_review_running",
		);
	});
});
