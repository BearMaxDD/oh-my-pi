import { describe, expect, it } from "bun:test";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PlanRunTaskSpawnParams } from "../../src/codex-plan-run/plan-run-spawn-adapter";
import {
	createCommandSubagentRunner,
	createPlanRunDeps,
	parsePlanRunRuntimeArgsEnv,
} from "../../src/commands/plan-run";
import type { SingleSubagentRuntime } from "../../src/task/single-subagent-runner";

describe("createPlanRunDeps", () => {
	it("returns deps with spawnTask and spawnStage functions", async () => {
		const deps = await createPlanRunDeps({ cwd: "/tmp/repo", acceptingDir: "/tmp/accept" });
		expect(deps.spawnTask).toBeDefined();
		expect(typeof deps.spawnTask).toBe("function");
		expect(deps.spawnStage).toBeDefined();
		expect(typeof deps.spawnStage).toBe("function");
	});

	it("spawnTask does not contain 'dependency is not wired'", async () => {
		const deps = await createPlanRunDeps({ cwd: "/tmp/repo", acceptingDir: "/tmp/accept" });
		const result = await deps.spawnTask({
			book: {
				schema_version: 1,
				run_id: "run-test",
				created_at: "2026-07-02T00:00:00.000Z",
				plan: { path: "/tmp/plan.md", sha256: "abc123", repo_path: "/tmp/repo" },
				accepting_dir: "/tmp/accept",
				intake_gate: [],
				project_recon: {
					repo_path: "/tmp/repo",
					relevant_modules: [],
					likely_files: [],
					existing_patterns: [],
					test_commands: [],
					build_commands: [],
					style_conventions: [],
					risk_areas: [],
					forbidden_changes: [],
					task_file_map: {},
				},
				required_execution_skills: [],
				required_review_skills: [],
				final_tail_skills: [],
				final_acceptance_commands: [],
				tasks: [],
			},
			acceptingDir: "/tmp/accept",
			taskId: "T1",
		});
		expect(result.result).toBe("blocked");
		expect(JSON.stringify(result)).not.toContain("dependency is not wired");
	});

	it("wires a default subagent bridge into command deps", async () => {
		const deps = await createPlanRunDeps({ cwd: "/tmp/repo", acceptingDir: "/tmp/accept" });
		const result = await deps.spawnTask({
			book: {
				schema_version: 1,
				run_id: "run-test",
				created_at: "2026-07-02T00:00:00.000Z",
				plan: { path: "/tmp/plan.md", sha256: "abc123", repo_path: "/tmp/repo" },
				accepting_dir: "/tmp/accept",
				intake_gate: [],
				project_recon: {
					repo_path: "/tmp/repo",
					relevant_modules: [],
					likely_files: [],
					existing_patterns: [],
					test_commands: [],
					build_commands: [],
					style_conventions: [],
					risk_areas: [],
					forbidden_changes: [],
					task_file_map: {},
				},
				required_execution_skills: [],
				required_review_skills: [],
				final_tail_skills: [],
				final_acceptance_commands: [],
				tasks: [],
			},
			acceptingDir: "/tmp/accept",
			taskId: "T1",
		});

		expect(JSON.stringify(result)).not.toContain("Subagent runner 未接入");
		expect(JSON.stringify(result)).not.toContain("subagent runner 未接入");
	});

	it("uses injected runSubagent runtime for the default bridge", async () => {
		const acceptingDir = await mkdtemp(join(tmpdir(), "plan-run-deps-"));
		const runtime: SingleSubagentRuntime = async () => ({
			exitCode: 0,
			stdout: JSON.stringify({
				outputPath: "/tmp/accept/tasks/T1/output.json",
				evidence: ["/tmp/accept/tasks/T1/output.json"],
			}),
			agentId: "runtime-agent",
			modelRole: "superpowers:implementer",
			resolvedModel: "runtime-model",
		});
		const deps = await createPlanRunDeps({ cwd: "/tmp/repo", acceptingDir, runSubagent: runtime });
		const result = await deps.spawnTask({
			book: {
				schema_version: 1,
				run_id: "run-test",
				created_at: "2026-07-02T00:00:00.000Z",
				plan: { path: "/tmp/plan.md", sha256: "abc123", repo_path: "/tmp/repo" },
				accepting_dir: acceptingDir,
				intake_gate: [],
				project_recon: {
					repo_path: "/tmp/repo",
					relevant_modules: [],
					likely_files: [],
					existing_patterns: [],
					test_commands: [],
					build_commands: [],
					style_conventions: [],
					risk_areas: [],
					forbidden_changes: [],
					task_file_map: {},
				},
				required_execution_skills: [],
				required_review_skills: [],
				final_tail_skills: [],
				final_acceptance_commands: [],
				tasks: [],
			},
			acceptingDir,
			taskId: "T1",
		});

		expect(result.result).toBe("completed");
		expect(result.agentId).toBe("runtime-agent");
		expect(result.resolvedModel).toBe("runtime-model");
	});

	it("explicit bridge still bypasses runtime command", async () => {
		const acceptingDir = await mkdtemp(join(tmpdir(), "plan-run-deps-"));
		const explicitBridge = async () => ({
			exitCode: 0,
			outputPath: "/tmp/explicit/output.json",
			id: "explicit-agent",
			modelRole: "superpowers:reviewer",
			resolvedModel: "explicit-model",
		});
		// Even with runSubagent set, the explicit bridge takes priority
		const ignoredRuntime: SingleSubagentRuntime = async () => ({
			exitCode: 0,
			stdout: "{}",
			agentId: "ignored-agent",
		});
		const deps = await createPlanRunDeps({
			cwd: "/tmp/repo",
			acceptingDir,
			bridge: explicitBridge,
			runSubagent: ignoredRuntime,
		});
		const result = await deps.spawnTask({
			book: {
				schema_version: 1,
				run_id: "run-test",
				created_at: "2026-07-02T00:00:00.000Z",
				plan: { path: "/tmp/plan.md", sha256: "abc123", repo_path: "/tmp/repo" },
				accepting_dir: acceptingDir,
				intake_gate: [],
				project_recon: {
					repo_path: "/tmp/repo",
					relevant_modules: [],
					likely_files: [],
					existing_patterns: [],
					test_commands: [],
					build_commands: [],
					style_conventions: [],
					risk_areas: [],
					forbidden_changes: [],
					task_file_map: {},
				},
				required_execution_skills: [],
				required_review_skills: [],
				final_tail_skills: [],
				final_acceptance_commands: [],
				tasks: [],
			},
			acceptingDir,
			taskId: "T1",
		});

		expect(result.result).toBe("completed");
		expect(result.agentId).toBe("explicit-agent");
		expect(result.resolvedModel).toBe("explicit-model");
	});

	it("default no runtime command remains blocked diagnostic", async () => {
		const acceptingDir = await mkdtemp(join(tmpdir(), "plan-run-deps-"));
		// No bridge, no runSubagent, no runtimeCommand → blocked diagnostic
		const deps = await createPlanRunDeps({ cwd: "/tmp/repo", acceptingDir });
		const result = await deps.spawnTask({
			book: {
				schema_version: 1,
				run_id: "run-test",
				created_at: "2026-07-02T00:00:00.000Z",
				plan: { path: "/tmp/plan.md", sha256: "abc123", repo_path: "/tmp/repo" },
				accepting_dir: acceptingDir,
				intake_gate: [],
				project_recon: {
					repo_path: "/tmp/repo",
					relevant_modules: [],
					likely_files: [],
					existing_patterns: [],
					test_commands: [],
					build_commands: [],
					style_conventions: [],
					risk_areas: [],
					forbidden_changes: [],
					task_file_map: {},
				},
				required_execution_skills: [],
				required_review_skills: [],
				final_tail_skills: [],
				final_acceptance_commands: [],
				tasks: [],
			},
			acceptingDir,
			taskId: "T1",
		});

		expect(result.result).toBe("blocked");
		expect(JSON.stringify(result)).toContain("single subagent runtime is not configured");
	});
});

describe("createCommandSubagentRunner", () => {
	it("returns structured blocked runner", async () => {
		const runner = createCommandSubagentRunner({ cwd: "/tmp/repo", acceptingDir: "/tmp/accept" });
		const params: PlanRunTaskSpawnParams = {
			agent: "task",
			id: "T1-implementer",
			role: "实现者",
			modelRole: "superpowers:implementer",
			context: "Run ID: run-test\nTask: T1",
			assignment: "Execute stage implementer",
			description: "Implementer stage",
			required_skill_evidence: [],
		};
		const result = await runner.run(params);
		expect(result.result).toBe("blocked");
		expect(result.changed_files).toEqual([]);
		expect(result.evidence).toEqual([]);
		expect(result.tests_run).toEqual([]);
		expect(result.scope_notes).toContain("/tmp/repo");
		expect(result.scope_notes).toContain("/tmp/accept");
		expect(result.agentId).toBe("T1-implementer");
		expect(result.modelRole).toBe("superpowers:implementer");
		expect(result.advisorFindings).toBeDefined();
		expect(result.advisorFindings!.length).toBeGreaterThanOrEqual(1);
		const finding = result.advisorFindings![0];
		expect(finding.finding).toContain("Subagent runner 未接入");
		// detail_zh — the evidence field contains the subagent runner mention
		expect(finding.evidence).toContain("subagent runner");
	});

	it("returns completed when bridge resolves exitCode 0", async () => {
		const advisorFinding = {
			schema_version: 1 as const,
			run_id: "run-test",
			task_id: "T1-implementer",
			severity: "warning" as const,
			category: "evidence" as const,
			finding: "Bridge success finding",
			evidence: "bridge-success-evidence",
			required_action: "review finding",
		};
		const bridge = async () => ({
			exitCode: 0,
			outputPath: "/tmp/accept/tasks/T1/stages/impl/output.json",
			id: "bridge-agent-1",
			modelRole: "superpowers:implementer",
			resolvedModel: "deepseek/deepseek-v4-flash",
			modelOverrides: ["--temperature=0.2"],
			advisorFindings: [advisorFinding],
		});
		const runner = createCommandSubagentRunner({
			cwd: "/tmp/repo",
			acceptingDir: "/tmp/accept",
			bridge,
		});
		const params: PlanRunTaskSpawnParams = {
			agent: "task",
			id: "T1-implementer",
			role: "实现者",
			modelRole: "superpowers:implementer",
			context: "Run ID: run-test\nTask: T1",
			assignment: "Execute stage implementer",
			description: "Implementer stage",
			required_skill_evidence: [],
		};
		const result = await runner.run(params);
		expect(result.result).toBe("completed");
		expect(result.evidence).toEqual(["/tmp/accept/tasks/T1/stages/impl/output.json"]);
		expect(result.agentId).toBe("bridge-agent-1");
		expect(result.modelRole).toBe("superpowers:implementer");
		expect(result.resolvedModel).toBe("deepseek/deepseek-v4-flash");
		expect(result.modelOverrides).toEqual(["--temperature=0.2"]);
		expect(result.changed_files).toEqual([]);
		expect(result.tests_run).toEqual([]);
		expect(result.advisorFindings).toEqual([advisorFinding]);
	});

	it("returns completed with bridge evidence when provided", async () => {
		const evidencePaths = ["path-1.md", "path-2.md"];
		const bridge = async () => ({
			exitCode: 0,
			outputPath: "/tmp/accept/tasks/T1/stages/impl/output.json",
			evidence: evidencePaths,
			id: "bridge-agent-1",
			modelRole: "superpowers:implementer",
			resolvedModel: "deepseek/deepseek-v4-flash",
			modelOverrides: ["--temperature=0.2"],
		});
		const runner = createCommandSubagentRunner({
			cwd: "/tmp/repo",
			acceptingDir: "/tmp/accept",
			bridge,
		});
		const params: PlanRunTaskSpawnParams = {
			agent: "task",
			id: "T1-implementer",
			role: "实现者",
			modelRole: "superpowers:implementer",
			context: "Run ID: run-test\nTask: T1",
			assignment: "Execute stage implementer",
			description: "Implementer stage",
			required_skill_evidence: [],
		};
		const result = await runner.run(params);
		expect(result.result).toBe("completed");
		expect(result.evidence).toEqual(evidencePaths);
		expect(result.agentId).toBe("bridge-agent-1");
		expect(result.modelRole).toBe("superpowers:implementer");
		expect(result.resolvedModel).toBe("deepseek/deepseek-v4-flash");
		expect(result.modelOverrides).toEqual(["--temperature=0.2"]);
		expect(result.changed_files).toEqual([]);
		expect(result.tests_run).toEqual([]);
	});

	it("returns blocked when bridge resolves non-zero exit code", async () => {
		const bridge = async () => ({
			exitCode: 1,
			stderr: "Agent process crashed with SIGTERM",
			id: "bridge-agent-1",
			modelRole: "superpowers:implementer",
		});
		const runner = createCommandSubagentRunner({
			cwd: "/tmp/repo",
			acceptingDir: "/tmp/accept",
			bridge,
		});
		const params: PlanRunTaskSpawnParams = {
			agent: "task",
			id: "T1-implementer",
			role: "实现者",
			modelRole: "superpowers:implementer",
			context: "Run ID: run-test\nTask: T1",
			assignment: "Execute stage implementer",
			description: "Implementer stage",
			required_skill_evidence: [],
		};
		const result = await runner.run(params);
		expect(result.result).toBe("blocked");
		expect(result.scope_notes).toContain("Agent process crashed with SIGTERM");
		expect(result.advisorFindings).toBeDefined();
		expect(result.advisorFindings!.length).toBeGreaterThanOrEqual(1);
		expect(result.advisorFindings![0].finding).toContain("Subagent bridge 返回非零退出码");
	});

	it("returns blocked with exit code in scope_notes when bridge returns non-zero without stderr", async () => {
		const bridge = async () => ({
			exitCode: 127,
		});
		const runner = createCommandSubagentRunner({
			cwd: "/tmp/repo",
			acceptingDir: "/tmp/accept",
			bridge,
		});
		const params: PlanRunTaskSpawnParams = {
			agent: "task",
			id: "T1-implementer",
			role: "实现者",
			modelRole: "superpowers:implementer",
			context: "Run ID: run-test\nTask: T1",
			assignment: "Execute stage implementer",
			description: "Implementer stage",
			required_skill_evidence: [],
		};
		const result = await runner.run(params);
		expect(result.result).toBe("blocked");
		expect(result.scope_notes).toContain("exit code 127");
		expect(result.agentId).toBe("T1-implementer");
		expect(result.modelRole).toBe("superpowers:implementer");
	});

	it("returns completed with fallback agentId and modelRole when bridge omits them", async () => {
		const bridge = async () => ({
			exitCode: 0,
			outputPath: "/tmp/output.json",
		});
		const runner = createCommandSubagentRunner({
			cwd: "/tmp/repo",
			acceptingDir: "/tmp/accept",
			bridge,
		});
		const params: PlanRunTaskSpawnParams = {
			agent: "task",
			id: "T2-reviewer",
			role: "审查者",
			modelRole: "superpowers:reviewer",
			context: "Run ID: run-test\nTask: T2",
			assignment: "Review T1 output",
			description: "Reviewer stage",
			required_skill_evidence: [],
		};
		const result = await runner.run(params);
		expect(result.result).toBe("completed");
		expect(result.agentId).toBe("T2-reviewer");
		expect(result.modelRole).toBe("superpowers:reviewer");
	});

	it("no bridge preserves structured blocked fallback", async () => {
		const runner = createCommandSubagentRunner({
			cwd: "/tmp/repo",
			acceptingDir: "/tmp/accept",
		});
		const params: PlanRunTaskSpawnParams = {
			agent: "task",
			id: "T3-implementer",
			role: "实现者",
			modelRole: "superpowers:implementer",
			context: "Run ID: run-test\nTask: T3",
			assignment: "Execute stage implementer",
			description: "Implementer stage",
			required_skill_evidence: [],
		};
		const result = await runner.run(params);
		expect(result.result).toBe("blocked");
		expect(result.advisorFindings![0].finding).toContain("Subagent runner 未接入");
	});
});

describe("parsePlanRunRuntimeArgsEnv", () => {
	it("returns string array for valid JSON array of strings", () => {
		expect(parsePlanRunRuntimeArgsEnv('["--foo","bar"]')).toEqual(["--foo", "bar"]);
	});

	it("returns undefined for malformed JSON", () => {
		expect(parsePlanRunRuntimeArgsEnv("{not json")).toBeUndefined();
	});

	it("returns undefined for valid non-array JSON (e.g. string)", () => {
		expect(parsePlanRunRuntimeArgsEnv('"42"')).toBeUndefined();
	});

	it("returns undefined for valid array with non-string item", () => {
		expect(parsePlanRunRuntimeArgsEnv('["ok", 1]')).toBeUndefined();
	});
});
