import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import type { StageManifestEntry } from "./stage-ledger";
import { PLAN_RUN_STATES, type PlanRunState } from "./types";

export interface PlanRunGitState {
	branch: string;
	head_commit: string;
	status_short?: string;
}

export interface PlanRunGateError {
	gate: PlanRunState;
	message: string;
	evidence?: string;
}

export interface PlanRunManifest {
	schema_version: 1;
	run_id: string;
	state: PlanRunState;
	source_repo: string;
	worktree: string;
	git_state?: PlanRunGitState;
	final_workspace_state_hash?: string;
	plan: {
		original_path: string;
		worktree_path: string;
		sha256: string;
	};
	skill: {
		required: string;
		loaded: boolean;
		loaded_at?: string;
		content_sha256?: string;
		source_path?: string;
	};
	execution_book?: {
		path: string;
		exists: boolean;
		task_count: number;
		required_execution_skills: string[];
		required_review_skills: string[];
		final_tail_skills: string[];
		content_sha256?: string;
	};
	todos: {
		version: number;
		state: "missing" | "synced" | "stale";
		source: "state-machine" | "todo-tool" | "rpc-sync";
		pending_required_tasks: number;
	};
	completion: {
		path: string;
		exists: boolean;
	};
	main_acceptance?: {
		result: "MAIN_ACCEPTANCE_ACCEPTED" | "MAIN_ACCEPTANCE_FIX_REQUIRED";
		review_round: number;
		accepted_at?: string;
		evidence_path: string;
		must_fix_count?: number;
	};
	packet: {
		valid: boolean;
		packet_id?: string;
	};
	codebase_memory?: {
		execution_recon?: string;
		reindex_summary?: string;
		tasks: Record<string, { status?: string; jsonPath?: string; degraded_reason?: string | null }>;
	};
	advisor?: {
		subagents_enabled: boolean;
		summary?: string;
	};
	model_routing?: {
		tasks: Record<string, { resolved_model?: string | null; model_role?: string | null; evidence_path?: string }>;
	};
	superpowers?: {
		codebase_memory_gate_mode: "off" | "advisory" | "required";
	};
	settings?: {
		execution_loop: {
			runtimeScenario?: {
				browser: { enabled: boolean };
				api: { enabled: boolean };
				database: { enabled: boolean };
			};
			classification?: {
				enabled: boolean;
				requireReviewerEvidence: boolean;
			};
		};
	};
	role_bound_execution?: {
		enabled: boolean;
		role_registry_snapshot_path?: string;
		role_registry_snapshot_sha256?: string;
		spec_task_framework_path?: string;
		spec_task_framework_sha256?: string;
		actual_spec_task_framework_sha256?: string;
		stages?: Record<string, StageManifestEntry>;
		classification_summary?: {
			tasks: Record<
				string,
				{
					runtime_surface: string;
					requires_frontend_design: boolean;
					requires_security_review: boolean;
					requires_payment_review: boolean;
					requires_data_migration_review: boolean;
					requires_destructive_operation_review: boolean;
					evidence_paths: string[];
				}
			>;
			specialized_reviews?: Array<{ type?: string; evidence_paths?: string[] }>;
		};
		classification_summary_json?: string;
	};
	prompt_packs?: {
		generated: boolean;
		prompt_pack_paths: string[];
	};
	advisor_gate?: {
		enabled: boolean;
		records_path?: string;
		blocking_findings?: number;
	};
	global_impact?: {
		enabled: boolean;
		report_path?: string;
		status?: "accepted" | "repair_required" | "blocked";
	};
	real_business_simulation?: {
		enabled: boolean;
		environment_plan_path?: string;
		scenario_plan_path?: string;
		report_path?: string;
		cleanup_report_path?: string;
		status?: "passed" | "repair_required" | "blocked";
		runtimeScenario?: {
			browser: { enabled: boolean };
			api: { enabled: boolean };
			database: { enabled: boolean };
		};
	};
	gate_errors: PlanRunGateError[];
}

function stateAtOrAfter(state: PlanRunState, gate: PlanRunState): boolean {
	const stateIndex = PLAN_RUN_STATES.indexOf(state);
	const gateIndex = PLAN_RUN_STATES.indexOf(gate);
	if (stateIndex < 0 || gateIndex < 0) {
		throw new Error("stateAtOrAfter requires valid PLAN_RUN_STATES values");
	}
	return stateIndex >= gateIndex;
}

function samePath(left: string, right: string): boolean {
	return resolve(left) === resolve(right);
}

function isPlanRunState(value: unknown): value is PlanRunState {
	return typeof value === "string" && (PLAN_RUN_STATES as readonly string[]).includes(value);
}

export function validatePlanRunManifest(manifest: PlanRunManifest): string[] {
	const errors: string[] = [];
	if (manifest.schema_version !== 1) errors.push("schema_version must be 1");
	if (!manifest.run_id) errors.push("run_id is required");
	if (!isPlanRunState(manifest.state)) errors.push("state must be one of PLAN_RUN_STATES");
	if (!manifest.worktree) errors.push("worktree is required");
	if (!manifest.plan.original_path) errors.push("plan.original_path is required");
	if (!manifest.plan.worktree_path) errors.push("plan.worktree_path is required");
	if (!manifest.plan.sha256) errors.push("plan.sha256 is required");
	if (!isPlanRunState(manifest.state)) return errors;
	if (stateAtOrAfter(manifest.state, "execution_book_ready")) {
		if (manifest.source_repo && manifest.worktree && !samePath(manifest.source_repo, manifest.worktree)) {
			errors.push("source_repo must match worktree after execution_book_ready");
		}
		if (!manifest.git_state) {
			errors.push("git_state is required after execution_book_ready");
		} else {
			if (!manifest.git_state.branch) errors.push("git_state.branch is required after execution_book_ready");
			if (!manifest.git_state.head_commit)
				errors.push("git_state.head_commit is required after execution_book_ready");
		}
		if (!manifest.execution_book) {
			errors.push("execution_book is required after execution_book_ready");
		} else {
			if (!manifest.execution_book.path) errors.push("execution_book.path is required");
			if (!manifest.execution_book.exists)
				errors.push("execution_book.exists must be true after execution_book_ready");
			if (manifest.execution_book.task_count <= 0) errors.push("execution_book.task_count must be positive");
			if (manifest.execution_book.required_execution_skills.length === 0) {
				errors.push("execution_book.required_execution_skills must not be empty");
			}
			if (manifest.execution_book.required_review_skills.length === 0) {
				errors.push("execution_book.required_review_skills must not be empty");
			}
			if (manifest.execution_book.final_tail_skills.length === 0) {
				errors.push("execution_book.final_tail_skills must not be empty");
			}
		}
	}

	if (stateAtOrAfter(manifest.state, "task_review_pending")) {
		if (!manifest.codebase_memory?.reindex_summary) {
			errors.push("codebase_memory.reindex_summary is required after task_review_pending");
		}
		if (!manifest.advisor?.summary) {
			errors.push("advisor.summary is required after task_review_pending");
		}
		if (!manifest.model_routing?.tasks || Object.keys(manifest.model_routing.tasks).length === 0) {
			errors.push("model_routing.tasks must not be empty after task_review_pending");
		}
		if (!manifest.superpowers?.codebase_memory_gate_mode) {
			errors.push("superpowers.codebase_memory_gate_mode is required after task_review_pending");
		}
	}
	if (stateAtOrAfter(manifest.state, "review_packet_validated") && !manifest.packet.valid) {
		errors.push("review_packet_validated requires packet.valid");
	}
	if (stateAtOrAfter(manifest.state, "main_acceptance_accepted")) {
		if (!manifest.main_acceptance) {
			errors.push("main_acceptance is required after main_acceptance_accepted");
		} else {
			if (manifest.main_acceptance.result !== "MAIN_ACCEPTANCE_ACCEPTED") {
				errors.push("review_packet_validated requires MAIN_ACCEPTANCE_ACCEPTED");
			}
			if (manifest.main_acceptance.review_round <= 0) {
				errors.push("main_acceptance.review_round must be positive");
			}
			if (!manifest.main_acceptance.evidence_path) {
				errors.push("main_acceptance.evidence_path is required after main_acceptance_accepted");
			}
		}
	}

	if (stateAtOrAfter(manifest.state, "final_acceptance_reviewing")) {
		if (manifest.role_bound_execution?.enabled && !manifest.role_bound_execution.spec_task_framework_path) {
			errors.push(
				"role_bound_execution.spec_task_framework_path is required when role_bound_execution is enabled after final_acceptance_reviewing",
			);
		}
		if (manifest.role_bound_execution?.enabled && !manifest.role_bound_execution.spec_task_framework_sha256) {
			errors.push(
				"role_bound_execution.spec_task_framework_sha256 is required when role-bound execution is enabled",
			);
		}
		if (
			manifest.role_bound_execution?.enabled &&
			Object.keys(manifest.role_bound_execution.stages || {}).length === 0
		) {
			errors.push("role_bound_execution.stages must not be empty when role-bound execution is enabled");
		}
		if (manifest.role_bound_execution?.enabled && !manifest.role_bound_execution.classification_summary) {
			errors.push("role_bound_execution.classification_summary is required when role-bound execution is enabled");
		} else if (manifest.role_bound_execution?.enabled) {
			const summary = manifest.role_bound_execution.classification_summary as unknown;
			const summaryIsStructured =
				typeof summary === "object" &&
				summary !== null &&
				!Array.isArray(summary) &&
				typeof (summary as { tasks?: unknown }).tasks === "object" &&
				(summary as { tasks?: unknown }).tasks !== null &&
				!Array.isArray((summary as { tasks?: unknown }).tasks);
			if (!summaryIsStructured) {
				errors.push("role_bound_execution.classification_summary must be a structured object with tasks");
			}
			const summaryJson = manifest.role_bound_execution.classification_summary_json;
			if (!summaryJson) {
				errors.push(
					"role_bound_execution.classification_summary_json is required when role-bound execution is enabled",
				);
			} else if (summaryIsStructured) {
				try {
					const parsed = JSON.parse(summaryJson);
					if (JSON.stringify(parsed) !== JSON.stringify(summary)) {
						errors.push("role_bound_execution.classification_summary_json must match classification_summary");
					}
				} catch {
					errors.push("role_bound_execution.classification_summary_json must be valid JSON");
				}
			}
		}
		if (manifest.advisor_gate?.enabled && !manifest.advisor_gate.records_path) {
			errors.push(
				"advisor_gate.records_path is required when advisor_gate is enabled after final_acceptance_reviewing",
			);
		}
		if (manifest.global_impact?.enabled && !manifest.global_impact.report_path) {
			errors.push(
				"global_impact.report_path is required when global_impact is enabled after final_acceptance_reviewing",
			);
		}
		if (manifest.real_business_simulation?.enabled && !manifest.real_business_simulation.report_path) {
			errors.push(
				"real_business_simulation.report_path is required when real_business_simulation is enabled after final_acceptance_reviewing",
			);
		}
	}
	return errors;
}

export async function writePlanRunManifest(path: string, manifest: PlanRunManifest): Promise<void> {
	const errors = validatePlanRunManifest(manifest);
	if (errors.length > 0) {
		throw new Error(`Invalid PlanRunManifest: ${errors.join("; ")}`);
	}
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

export async function readPlanRunManifest(path: string): Promise<PlanRunManifest> {
	return JSON.parse(await readFile(path, "utf8")) as PlanRunManifest;
}
