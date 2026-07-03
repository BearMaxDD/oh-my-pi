import { existsSync } from "node:fs";
import { resolve } from "node:path";
import type { PlanRunGitState, PlanRunManifest } from "./manifest";
import { PLAN_RUN_STATES, type PlanRunState } from "./types";

export interface PacketMainThreadAcceptance {
	result: "MAIN_ACCEPTANCE_ACCEPTED" | "MAIN_ACCEPTANCE_FIX_REQUIRED";
	review_round: number;
	accepted_at: string;
	evidence_path: string;
}

export interface CodexReviewRequestPacket {
	packet_type: "CodexReviewRequestPacket";
	packet_id: string;
	run_id: string;
	repo_path: string;
	omp_worktree: string;
	git_state: PlanRunGitState;
	workspace_state_hash: string;
	original_plan_path: string;
	worktree_plan_path: string;
	plan_sha256: string;
	execution_book_path: string;
	accepting_dir: string;
	plan_execution_book: string;
	tasks: Array<{
		task_id: string;
		task_card: string;
		execution_skills_used: string[];
		review_skills_used: string[];
		final_tail_skills_used: string[];
		commands: Array<{
			command: string;
			exit_code: number | null;
		}>;
		result: "TASK_ACCEPTED" | "TASK_FIX_REQUIRED";
	}>;
	final_status: "READY_FOR_CODEX_REVIEW";
	main_thread_acceptance: PacketMainThreadAcceptance;
	completion_md_path: string;
	manifest_path: string;
	changed_files: string[];
	verification_commands: Array<{
		command: string;
		exit_code: number | null;
	}>;
	evidence_table: Array<Record<string, unknown>>;
}

export type CodexReviewRequestPacketTask = CodexReviewRequestPacket["tasks"][number];
export type CodexReviewRequestPacketCommand = CodexReviewRequestPacket["verification_commands"][number];

export interface CreateCodexReviewRequestPacketOptions {
	manifest: PlanRunManifest;
	acceptingDir: string;
	manifestPath: string;
	tasks: CodexReviewRequestPacketTask[];
	changedFiles: string[];
	verificationCommands: CodexReviewRequestPacketCommand[];
	evidenceTable: Array<Record<string, unknown>>;
	mainThreadAcceptance?: PacketMainThreadAcceptance;
	packetId?: string;
}

export interface PacketGuardRequest {
	manifest: PlanRunManifest;
	packet: CodexReviewRequestPacket;
	currentGitState?: PlanRunGitState;
	finalWorkspaceStateHash?: string;
}

export interface PacketGuardResult {
	valid: boolean;
	errors: string[];
}

function hasNoItems(values: unknown): boolean {
	return !Array.isArray(values) || values.length === 0;
}

function verificationCommandsAllPass(values: CodexReviewRequestPacket["verification_commands"]): boolean {
	return (
		Array.isArray(values) &&
		values.every(
			command =>
				command !== null &&
				typeof command === "object" &&
				typeof command.command === "string" &&
				command.command.trim().length > 0 &&
				command.exit_code !== null &&
				command.exit_code === 0,
		)
	);
}

function verificationCommandsIncludeRequiredChecks(values: CodexReviewRequestPacket["verification_commands"]): boolean {
	const testCommandPattern = /(^|&&\s*)bun\s+test(?:\s|$)/;
	const typecheckCommandPattern = /(^|&&\s*)bun\s+run\s+check:types(?:\s|$)/;
	return (
		Array.isArray(values) &&
		values.some(command => {
			if (command === null || typeof command !== "object" || typeof command.command !== "string") {
				return false;
			}
			const text = command.command.trim();
			return testCommandPattern.test(text) || typecheckCommandPattern.test(text);
		})
	);
}

function stateAtOrAfter(state: PlanRunState, gate: PlanRunState): boolean {
	return PLAN_RUN_STATES.indexOf(state) >= PLAN_RUN_STATES.indexOf(gate);
}

function samePath(left: string, right: string): boolean {
	return resolve(left) === resolve(right);
}

function sameGitState(left: PlanRunGitState | undefined, right: PlanRunGitState | undefined): boolean {
	return !!left && !!right && left.branch === right.branch && left.head_commit === right.head_commit;
}

export function createCodexReviewRequestPacket({
	manifest,
	acceptingDir,
	manifestPath,
	tasks,
	changedFiles,
	verificationCommands,
	evidenceTable,
	mainThreadAcceptance,
	packetId,
}: CreateCodexReviewRequestPacketOptions): CodexReviewRequestPacket {
	if (!manifest.execution_book) {
		throw new Error("Cannot create CodexReviewRequestPacket without execution_book metadata");
	}
	if (!manifest.git_state) {
		throw new Error("Cannot create CodexReviewRequestPacket without git_state metadata");
	}
	if (!manifest.final_workspace_state_hash) {
		throw new Error("Cannot create CodexReviewRequestPacket without final workspace state hash");
	}
	return {
		packet_type: "CodexReviewRequestPacket",
		packet_id: packetId ?? manifest.packet.packet_id ?? `${manifest.run_id}-packet`,
		run_id: manifest.run_id,
		repo_path: manifest.source_repo,
		omp_worktree: manifest.worktree,
		git_state: manifest.git_state,
		workspace_state_hash: manifest.final_workspace_state_hash,
		original_plan_path: manifest.plan.original_path,
		worktree_plan_path: manifest.plan.worktree_path,
		plan_sha256: manifest.plan.sha256,
		execution_book_path: manifest.execution_book.path,
		accepting_dir: acceptingDir,
		plan_execution_book: manifest.execution_book.path,
		tasks,
		final_status: "READY_FOR_CODEX_REVIEW",
		main_thread_acceptance: mainThreadAcceptance ?? {
			result: manifest.main_acceptance?.result ?? "MAIN_ACCEPTANCE_FIX_REQUIRED",
			review_round: manifest.main_acceptance?.review_round ?? 0,
			accepted_at: manifest.main_acceptance?.accepted_at ?? new Date(0).toISOString(),
			evidence_path: manifest.main_acceptance?.evidence_path ?? "",
		},
		completion_md_path: manifest.completion.path,
		manifest_path: manifestPath,
		changed_files: changedFiles,
		verification_commands: verificationCommands,
		evidence_table: evidenceTable,
	};
}

export function validateCodexReviewRequestPacket(request: PacketGuardRequest): PacketGuardResult {
	const { currentGitState, finalWorkspaceStateHash, manifest, packet } = request;
	const errors: string[] = [];

	if (packet.packet_type !== "CodexReviewRequestPacket") {
		errors.push("packet_type must be CodexReviewRequestPacket");
	}
	if (!packet.packet_id) {
		errors.push("packet_id is required");
	}
	if (manifest.packet.valid === true && !manifest.packet.packet_id) {
		errors.push("manifest packet_id is required");
	}
	if (manifest.packet.packet_id && packet.packet_id !== manifest.packet.packet_id) {
		errors.push("packet packet_id does not match manifest");
	}
	if (packet.run_id !== manifest.run_id) {
		errors.push("packet run_id does not match manifest");
	}
	if (packet.repo_path !== manifest.source_repo) {
		errors.push("packet repo_path does not match manifest");
	}
	if (packet.omp_worktree !== manifest.worktree) {
		errors.push("packet omp_worktree does not match manifest");
	}
	if (!manifest.git_state) {
		errors.push("manifest git_state is required");
	}
	if (!packet.git_state?.branch || !packet.git_state?.head_commit) {
		errors.push("packet git_state is required");
	} else {
		if (!sameGitState(packet.git_state, manifest.git_state)) {
			errors.push("packet git_state does not match manifest");
		}
		if (currentGitState && !sameGitState(packet.git_state, currentGitState)) {
			errors.push("packet git_state does not match current worktree HEAD");
		}
	}
	if (!packet.workspace_state_hash) {
		errors.push("packet workspace_state_hash is required");
	}
	if (!manifest.final_workspace_state_hash) {
		errors.push("manifest final_workspace_state_hash is required");
	}
	if (
		packet.workspace_state_hash &&
		manifest.final_workspace_state_hash &&
		(packet.workspace_state_hash !== manifest.final_workspace_state_hash ||
			(finalWorkspaceStateHash !== undefined && packet.workspace_state_hash !== finalWorkspaceStateHash))
	) {
		errors.push("packet, manifest, completion, and final workspace state must reference the same state hash");
	}
	if (manifest.source_repo && manifest.worktree && !samePath(manifest.source_repo, manifest.worktree)) {
		errors.push("manifest source_repo must match worktree");
	}
	if (packet.repo_path && packet.omp_worktree && !samePath(packet.repo_path, packet.omp_worktree)) {
		errors.push("packet repo_path must match omp_worktree");
	}
	if (packet.original_plan_path !== manifest.plan.original_path) {
		errors.push("packet original_plan_path does not match manifest");
	}
	if (packet.worktree_plan_path !== manifest.plan.worktree_path) {
		errors.push("packet worktree_plan_path does not match manifest");
	}
	if (packet.plan_sha256 !== manifest.plan.sha256) {
		errors.push("packet plan_sha256 does not match manifest");
	}
	if (!manifest.execution_book) {
		errors.push("manifest execution_book is required");
	} else if (packet.execution_book_path !== manifest.execution_book.path) {
		errors.push("packet execution_book_path does not match manifest");
	}
	if (packet.plan_execution_book !== packet.execution_book_path) {
		errors.push("packet plan_execution_book must match execution_book_path");
	}
	if (!packet.accepting_dir) {
		errors.push("accepting_dir is required");
	}
	if (packet.final_status !== "READY_FOR_CODEX_REVIEW") {
		errors.push("final_status must be READY_FOR_CODEX_REVIEW");
	}
	if (!packet.main_thread_acceptance) {
		errors.push("main_thread_acceptance is required");
	} else {
		if (packet.main_thread_acceptance.result !== "MAIN_ACCEPTANCE_ACCEPTED") {
			errors.push("main_thread_acceptance.result must be MAIN_ACCEPTANCE_ACCEPTED");
		}
		if (packet.main_thread_acceptance.review_round <= 0) {
			errors.push("main_thread_acceptance.review_round must be positive");
		}
		if (!packet.main_thread_acceptance.accepted_at) {
			errors.push("main_thread_acceptance.accepted_at is required");
		}
		if (!packet.main_thread_acceptance.evidence_path) {
			errors.push("main_thread_acceptance.evidence_path is required");
		} else if (!existsSync(packet.main_thread_acceptance.evidence_path)) {
			errors.push("main_thread_acceptance.evidence_path does not exist");
		}
		if (manifest.main_acceptance) {
			if (packet.main_thread_acceptance.result !== manifest.main_acceptance.result) {
				errors.push("packet main_thread_acceptance result does not match manifest");
			}
			if (packet.main_thread_acceptance.review_round !== manifest.main_acceptance.review_round) {
				errors.push("packet main_thread_acceptance review_round does not match manifest");
			}
			if (packet.main_thread_acceptance.evidence_path !== manifest.main_acceptance.evidence_path) {
				errors.push("packet main_thread_acceptance evidence_path does not match manifest");
			}
		}
	}
	if (hasNoItems(packet.tasks)) {
		errors.push("tasks must not be empty");
	} else {
		for (const task of packet.tasks) {
			if (!task.task_id) errors.push("task.task_id is required");
			if (!task.task_card) errors.push(`task ${task.task_id || "<missing>"} task_card is required`);
			if (hasNoItems(task.execution_skills_used)) {
				errors.push(`task ${task.task_id || "<missing>"} execution_skills_used must not be empty`);
			}
			if (hasNoItems(task.review_skills_used)) {
				errors.push(`task ${task.task_id || "<missing>"} review_skills_used must not be empty`);
			}
			if (hasNoItems(task.final_tail_skills_used)) {
				errors.push(`task ${task.task_id || "<missing>"} final_tail_skills_used must not be empty`);
			}
			if (!verificationCommandsAllPass(task.commands)) {
				errors.push(`task ${task.task_id || "<missing>"} commands must all pass`);
			}
			if (task.result !== "TASK_ACCEPTED") {
				errors.push(`task ${task.task_id || "<missing>"} result must be TASK_ACCEPTED`);
			}
		}
	}
	if (packet.completion_md_path !== manifest.completion.path) {
		errors.push("packet completion_md_path does not match manifest");
	}
	if (!stateAtOrAfter(manifest.state, "main_acceptance_accepted")) {
		errors.push("manifest state has not reached main_acceptance_accepted");
	}
	if (manifest.todos.pending_required_tasks !== 0) {
		errors.push("manifest has pending required todo tasks");
	}
	if (manifest.packet.valid !== true) {
		errors.push("manifest packet is not valid");
	}
	if (hasNoItems(packet.verification_commands)) {
		errors.push("verification_commands must not be empty");
	} else if (!verificationCommandsAllPass(packet.verification_commands)) {
		errors.push("verification_commands must all pass");
	} else if (!verificationCommandsIncludeRequiredChecks(packet.verification_commands)) {
		errors.push("verification_commands must include required checks");
	}
	if (!Array.isArray(packet.changed_files)) {
		errors.push("changed_files must be an array");
	}
	if (hasNoItems(packet.evidence_table)) {
		errors.push("evidence_table must not be empty");
	}
	if (!existsSync(packet.omp_worktree)) {
		errors.push("omp_worktree does not exist");
	}
	if (!existsSync(packet.repo_path)) {
		errors.push("repo_path does not exist");
	}
	if (!existsSync(packet.original_plan_path)) {
		errors.push("original_plan_path does not exist");
	}
	if (!existsSync(packet.worktree_plan_path)) {
		errors.push("worktree_plan_path does not exist");
	}
	if (!existsSync(packet.execution_book_path)) {
		errors.push("execution_book_path does not exist");
	}
	if (!existsSync(packet.completion_md_path)) {
		errors.push("completion_md_path does not exist");
	}
	if (!existsSync(packet.manifest_path)) {
		errors.push("manifest_path does not exist");
	}

	return {
		valid: errors.length === 0,
		errors,
	};
}
