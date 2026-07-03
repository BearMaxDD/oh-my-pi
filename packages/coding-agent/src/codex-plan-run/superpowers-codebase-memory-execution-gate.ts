import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { isCodeSensitiveSuperpowersSkill } from "../superpowers/codebase-memory-gate";
import type { CodebaseMemoryExecutionRecon } from "./codebase-memory-recon";

/**
 * Schema version 1 evidence for the superpowers codebase memory execution gate.
 * schema_version: 1
 */
export interface SuperpowersCodebaseMemoryGateEvidence {
	schema_version: 1;
	run_id: string;
	task_id: string;
	skill: string;
	mode: "advisory" | "required";
	status: "ready" | "degraded" | "blocked";
	recon_evidence: CodebaseMemoryExecutionRecon | Record<string, unknown> | null;
	degraded_reason: string;
	blocked: boolean;
}

export interface ResolveSuperpowersCodebaseMemoryGateInput {
	run_id: string;
	task_id: string;
	skillName: string;
	mode?: "off" | "advisory" | "required";
	reconEvidence?: CodebaseMemoryExecutionRecon | null;
}

/**
 * Determine whether a recon evidence object indicates degradation.
 * Degradation means: recon is missing/empty, project not indexed, or stale.
 */
function isDegradedRecon(reconEvidence?: CodebaseMemoryExecutionRecon | null): boolean {
	if (!reconEvidence) return true;
	if (!reconEvidence.project_status) return true;
	if (!reconEvidence.project_status.indexed) return true;
	if (reconEvidence.project_status.stale) return true;
	return false;
}

/**
 * Build a human-readable degraded reason from the recon evidence.
 */
function buildDegradedReason(reconEvidence?: CodebaseMemoryExecutionRecon | null): string {
	if (!reconEvidence) return "Codebase memory execution recon is not available";
	if (!reconEvidence.project_status) return "Codebase memory project status is not available";
	const status = reconEvidence.project_status;
	if (!status.indexed) return `Codebase memory index is not available for project "${status.project}"`;
	if (status.stale) return `Codebase memory index for project "${status.project}" is stale`;
	return "Codebase memory execution recon is degraded";
}

/**
 * Resolve the superpowers codebase memory execution gate for a given task.
 *
 * Returns evidence describing whether the gate is ready, degraded, or blocked.
 *
 * Gate rules:
 * - mode "off" → stored as "advisory" in evidence, status "ready", blocked false
 * - Non-code-sensitive skill (any mode) → status "ready", blocked false
 * - Code-sensitive skill + advisory mode + degraded/no recon → status "degraded", blocked false
 * - Code-sensitive skill + required mode + degraded/no recon → status "blocked", blocked true
 * - Healthy recon evidence (indexed and not stale) → status "ready", blocked false
 */
export function resolveSuperpowersCodebaseMemoryExecutionGate(
	input: ResolveSuperpowersCodebaseMemoryGateInput,
): SuperpowersCodebaseMemoryGateEvidence {
	const mode = input.mode ?? "advisory";
	const isCodeSkill = isCodeSensitiveSuperpowersSkill(input.skillName);

	// Off mode: store as advisory, always ready and not blocked
	if (mode === "off") {
		return {
			schema_version: 1,
			run_id: input.run_id,
			task_id: input.task_id,
			skill: input.skillName,
			mode: "advisory",
			status: "ready",
			recon_evidence: input.reconEvidence ?? {},
			degraded_reason: "",
			blocked: false,
		};
	}

	// Non-code skill: always ready and not blocked regardless of mode
	if (!isCodeSkill) {
		return {
			schema_version: 1,
			run_id: input.run_id,
			task_id: input.task_id,
			skill: input.skillName,
			mode,
			status: "ready",
			recon_evidence: input.reconEvidence ?? {},
			degraded_reason: "",
			blocked: false,
		};
	}

	// Code-sensitive skill: check recon health
	const degraded = isDegradedRecon(input.reconEvidence);

	if (!degraded) {
		// Healthy recon: ready
		return {
			schema_version: 1,
			run_id: input.run_id,
			task_id: input.task_id,
			skill: input.skillName,
			mode,
			status: "ready",
			recon_evidence: input.reconEvidence ?? {},
			degraded_reason: "",
			blocked: false,
		};
	}

	// Degraded or missing recon
	const degradedReason = buildDegradedReason(input.reconEvidence);
	const blocked = mode === "required";
	const status = blocked ? "blocked" : "degraded";

	return {
		schema_version: 1,
		run_id: input.run_id,
		task_id: input.task_id,
		skill: input.skillName,
		mode,
		status,
		recon_evidence: input.reconEvidence ?? {},
		degraded_reason: degradedReason,
		blocked,
	};
}

/**
 * Write superpowers codebase memory gate evidence to the accepting directory.
 *
 * The file is written to `<accepting_dir>/tasks/<task_id>/superpowers-codebase-memory-gate.json`.
 *
 * @param acceptingDir - Base accepting directory path
 * @param evidence - The evidence to write
 * @returns The absolute path of the written evidence file
 */
export async function writeSuperpowersCodebaseMemoryGateEvidence(
	acceptingDir: string,
	evidence: SuperpowersCodebaseMemoryGateEvidence,
): Promise<string> {
	const evidenceDir = join(acceptingDir, "tasks", evidence.task_id);
	const evidencePath = join(evidenceDir, "superpowers-codebase-memory-gate.json");

	await mkdir(evidenceDir, { recursive: true });
	await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");

	return evidencePath;
}
