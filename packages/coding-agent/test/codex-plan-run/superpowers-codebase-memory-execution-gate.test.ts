import { describe, expect, it } from "bun:test";
import {
	resolveSuperpowersCodebaseMemoryExecutionGate,
	type SuperpowersCodebaseMemoryGateEvidence,
	writeSuperpowersCodebaseMemoryGateEvidence,
} from "../../src/codex-plan-run/superpowers-codebase-memory-execution-gate";

const runId = "run-abc123";
const taskId = "T1";
const codeSkill = "test-driven-development";
const nonCodeSkill = "cli-creator";

const baseReconEvidence = {
	kind: "execution" as const,
	project: "oh-my-pi",
	repo_path: "/repo",
	generated_at: "2026-06-30T00:00:00.000Z",
	evidencePath: ".omp/plan-runs/run-abc123/tasks/T1/codebase-memory-recon.json",
	markdownPath: ".omp/plan-runs/run-abc123/tasks/T1/codebase-memory-recon.md",
	project_status: { indexed: true, project: "oh-my-pi", rootPath: "/repo", nodeCount: 100, edgeCount: 200 },
	architecture: { relevantModules: ["src"], summary: "well-structured" },
	task_contexts: [
		{
			taskId: "T1",
			files: ["src/index.ts"],
			symbols: [{ name: "main" }],
			patterns: [],
			risks: [],
			graph: {
				seed_files: ["src/index.ts"],
				seed_symbols: ["main"],
				nodes: [{ id: "symbol:main", label: "Function", name: "main", file_path: "src/index.ts" }],
				edges: [],
				trace_paths: [],
				edge_types: [],
				risk_nodes: [],
			},
		},
	],
};

const degradedReconEvidence = {
	...baseReconEvidence,
	project_status: { indexed: false, project: "oh-my-pi", rootPath: "/repo", stale: true },
};

describe("resolveSuperpowersCodebaseMemoryExecutionGate", () => {
	it("returns ready and not blocked for non-code skill (required mode)", () => {
		const evidence = resolveSuperpowersCodebaseMemoryExecutionGate({
			run_id: runId,
			task_id: taskId,
			skillName: nonCodeSkill,
			mode: "required",
		});

		expect(evidence.status).toBe("ready");
		expect(evidence.blocked).toBe(false);
		expect(evidence.schema_version).toBe(1);
		expect(evidence.skill).toBe(nonCodeSkill);
		expect(evidence.mode).toBe("required");
	});

	it("returns ready and not blocked for mode off (stores mode as advisory)", () => {
		const evidence = resolveSuperpowersCodebaseMemoryExecutionGate({
			run_id: runId,
			task_id: taskId,
			skillName: codeSkill,
			mode: "off",
		});

		expect(evidence.status).toBe("ready");
		expect(evidence.blocked).toBe(false);
		// off mode stores as advisory in evidence
		expect(evidence.mode).toBe("advisory");
	});

	it("returns ready and not blocked for code-sensitive skill with healthy recon (advisory mode)", () => {
		const evidence = resolveSuperpowersCodebaseMemoryExecutionGate({
			run_id: runId,
			task_id: taskId,
			skillName: codeSkill,
			mode: "advisory",
			reconEvidence: baseReconEvidence,
		});

		expect(evidence.status).toBe("ready");
		expect(evidence.blocked).toBe(false);
	});

	it("returns ready and not blocked for code-sensitive skill with healthy recon (required mode)", () => {
		const evidence = resolveSuperpowersCodebaseMemoryExecutionGate({
			run_id: runId,
			task_id: taskId,
			skillName: codeSkill,
			mode: "required",
			reconEvidence: baseReconEvidence,
		});

		expect(evidence.status).toBe("ready");
		expect(evidence.blocked).toBe(false);
	});

	it("returns status degraded and blocked false for advisory mode with degraded/no recon evidence", () => {
		const evidence = resolveSuperpowersCodebaseMemoryExecutionGate({
			run_id: runId,
			task_id: taskId,
			skillName: codeSkill,
			mode: "advisory",
			reconEvidence: degradedReconEvidence,
		});

		expect(evidence.status).toBe("degraded");
		expect(evidence.blocked).toBe(false);
		expect(evidence.degraded_reason).toBeTruthy();
	});

	it("returns status degraded and blocked false for advisory mode with undefined recon evidence", () => {
		const evidence = resolveSuperpowersCodebaseMemoryExecutionGate({
			run_id: runId,
			task_id: taskId,
			skillName: codeSkill,
			mode: "advisory",
		});

		expect(evidence.status).toBe("degraded");
		expect(evidence.blocked).toBe(false);
		expect(evidence.degraded_reason).toBeTruthy();
	});

	it("returns status blocked and blocked true for required mode with degraded recon evidence", () => {
		const evidence = resolveSuperpowersCodebaseMemoryExecutionGate({
			run_id: runId,
			task_id: taskId,
			skillName: codeSkill,
			mode: "required",
			reconEvidence: degradedReconEvidence,
		});

		expect(evidence.status).toBe("blocked");
		expect(evidence.blocked).toBe(true);
		expect(evidence.degraded_reason).toBeTruthy();
	});

	it("returns status blocked and blocked true for required mode with no recon evidence", () => {
		const evidence = resolveSuperpowersCodebaseMemoryExecutionGate({
			run_id: runId,
			task_id: taskId,
			skillName: codeSkill,
			mode: "required",
		});

		expect(evidence.status).toBe("blocked");
		expect(evidence.blocked).toBe(true);
		expect(evidence.degraded_reason).toBeTruthy();
	});

	it("preserves run_id and task_id in evidence output", () => {
		const evidence = resolveSuperpowersCodebaseMemoryExecutionGate({
			run_id: runId,
			task_id: taskId,
			skillName: codeSkill,
			mode: "advisory",
		});

		expect(evidence.run_id).toBe(runId);
		expect(evidence.task_id).toBe(taskId);
	});

	it("defaults mode to advisory when not provided", () => {
		const evidence = resolveSuperpowersCodebaseMemoryExecutionGate({
			run_id: runId,
			task_id: taskId,
			skillName: codeSkill,
		});

		expect(evidence.mode).toBe("advisory");
	});

	it("includes recon_evidence in output when provided", () => {
		const evidence = resolveSuperpowersCodebaseMemoryExecutionGate({
			run_id: runId,
			task_id: taskId,
			skillName: codeSkill,
			mode: "advisory",
			reconEvidence: baseReconEvidence,
		});

		expect(evidence.recon_evidence).toEqual(baseReconEvidence);
	});

	it("returns empty object for recon_evidence when not provided", () => {
		const evidence = resolveSuperpowersCodebaseMemoryExecutionGate({
			run_id: runId,
			task_id: taskId,
			skillName: codeSkill,
			mode: "advisory",
		});

		expect(evidence.recon_evidence).toEqual({});
	});
});

describe("writeSuperpowersCodebaseMemoryGateEvidence", () => {
	it("writes evidence json to <accepting_dir>/tasks/<task_id>/superpowers-codebase-memory-gate.json", async () => {
		const evidence: SuperpowersCodebaseMemoryGateEvidence = {
			schema_version: 1,
			run_id: runId,
			task_id: taskId,
			skill: codeSkill,
			mode: "advisory",
			status: "ready",
			recon_evidence: {},
			degraded_reason: "",
			blocked: false,
		};

		const path = await writeSuperpowersCodebaseMemoryGateEvidence("/tmp/test-accepting", evidence);

		expect(path).toContain("/tmp/test-accepting/tasks/T1/superpowers-codebase-memory-gate.json");
	});

	it("writes a valid JSON file that can be parsed back", async () => {
		const evidence: SuperpowersCodebaseMemoryGateEvidence = {
			schema_version: 1,
			run_id: runId,
			task_id: taskId,
			skill: codeSkill,
			mode: "required",
			status: "blocked",
			recon_evidence: { kind: "execution", project: "oh-my-pi" },
			degraded_reason: "Codebase memory index is not available",
			blocked: true,
		};

		const path = await writeSuperpowersCodebaseMemoryGateEvidence("/tmp/test-accepting", evidence);

		const content = await Bun.file(path).text();
		const parsed = JSON.parse(content);

		expect(parsed.schema_version).toBe(1);
		expect(parsed.status).toBe("blocked");
		expect(parsed.blocked).toBe(true);
		expect(parsed.run_id).toBe(runId);
		expect(parsed.task_id).toBe(taskId);
	});

	it("creates intermediate directories automatically", async () => {
		const evidence: SuperpowersCodebaseMemoryGateEvidence = {
			schema_version: 1,
			run_id: runId,
			task_id: taskId,
			skill: codeSkill,
			mode: "advisory",
			status: "ready",
			recon_evidence: {},
			degraded_reason: "",
			blocked: false,
		};
		const path = await writeSuperpowersCodebaseMemoryGateEvidence("/tmp/nested/deep/test-dir", evidence);

		expect(path).toContain("/tmp/nested/deep/test-dir/tasks/T1/superpowers-codebase-memory-gate.json");
	});
});
