import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { TodoSnapshot } from "./types";

export type StageLedgerStatus = "accepted" | "repair_required" | "blocked";

export interface StageAdvisorGatePath {
	gate: string;
	status: StageLedgerStatus;
	path: string;
}

export interface StageManifestEntry {
	output_path: string;
	model_routing_path: string;
	advisor_gate_paths: string[];
	status: StageLedgerStatus;
}

export interface WriteStageLedgerEntryOptions {
	acceptingDir: string;
	runId: string;
	taskId: string;
	stageId: string;
	status: StageLedgerStatus;
	output: unknown;
	modelRouting: unknown;
	advisorGates: readonly StageAdvisorGatePath[];
}

export interface StageLedgerEntryResult {
	key: string;
	manifest: StageManifestEntry;
}

function validateSegment(value: string): void {
	if (!/^[A-Za-z0-9_.:-]+$/.test(value) || value.includes("..")) {
		throw new Error("Invalid stage ledger path segment");
	}
}

function sha256Text(value: string): string {
	return createHash("sha256").update(value).digest("hex");
}

export async function writeStageLedgerEntry(options: WriteStageLedgerEntryOptions): Promise<StageLedgerEntryResult> {
	validateSegment(options.taskId);
	validateSegment(options.stageId);
	const stageDir = join(options.acceptingDir, "tasks", options.taskId, "stages", options.stageId);
	const advisorDir = join(stageDir, "advisor-gates");
	await mkdir(advisorDir, { recursive: true });

	const outputPath = join(stageDir, "output.json");
	const modelRoutingPath = join(stageDir, "model-routing-evidence.json");
	await writeFile(outputPath, `${JSON.stringify(options.output, null, 2)}\n`, "utf8");
	await writeFile(modelRoutingPath, `${JSON.stringify(options.modelRouting, null, 2)}\n`, "utf8");

	const advisorGatePaths: string[] = [];
	for (const gate of options.advisorGates) {
		validateSegment(gate.gate);
		const gatePath = join(advisorDir, `${gate.gate}.json`);
		await writeFile(gatePath, `${JSON.stringify(gate, null, 2)}\n`, "utf8");
		advisorGatePaths.push(gatePath);
	}

	return {
		key: `${options.taskId}:${options.stageId}`,
		manifest: {
			output_path: outputPath,
			model_routing_path: modelRoutingPath,
			advisor_gate_paths: advisorGatePaths,
			status: options.status,
		},
	};
}

export async function writeRoleRegistrySnapshot(options: {
	acceptingDir: string;
	registry: unknown;
}): Promise<{ path: string; sha256: string }> {
	await mkdir(options.acceptingDir, { recursive: true });
	const path = join(options.acceptingDir, "role-registry-snapshot.json");
	const body = `${JSON.stringify(options.registry, null, 2)}\n`;
	await writeFile(path, body, "utf8");
	return { path, sha256: sha256Text(body) };
}

export function sha256Json(value: unknown): string {
	return sha256Text(`${JSON.stringify(value, null, 2)}\n`);
}

export function renderTodoSnapshotMarkdown(snapshot: TodoSnapshot): string {
	const lines: string[] = [
		"# Todo Snapshot",
		"",
		`Run ID: ${snapshot.runId}`,
		`Version: ${snapshot.version}`,
		`State: ${snapshot.state}`,
		`Updated: ${snapshot.updatedAt}`,
		`Source: ${snapshot.source}`,
		"",
	];
	for (const phase of snapshot.phases) {
		lines.push(`## ${phase.name}`, "");
		for (const task of phase.tasks) {
			lines.push(`- [${task.status === "completed" ? "x" : " "}] ${task.content}`);
		}
		lines.push("");
	}
	return lines.join("\n");
}

export async function writeTodoSnapshotArtifact(options: {
	acceptingDir: string;
	snapshot: TodoSnapshot;
}): Promise<{ jsonPath: string; markdownPath: string }> {
	const snapshotsDir = join(options.acceptingDir, "todo-snapshots");
	await mkdir(snapshotsDir, { recursive: true });
	const jsonPath = join(snapshotsDir, "0001.json");
	const markdownPath = join(snapshotsDir, "0001.md");
	await writeFile(jsonPath, `${JSON.stringify(options.snapshot, null, 2)}\n`, "utf8");
	await writeFile(markdownPath, renderTodoSnapshotMarkdown(options.snapshot), "utf8");
	return { jsonPath, markdownPath };
}
