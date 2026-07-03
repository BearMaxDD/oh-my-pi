import { afterEach, describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AdvisorGateRecord } from "../../src/codex-plan-run/advisor-gate";
import { evaluateAdvisorGate, writeAdvisorGateRecord } from "../../src/codex-plan-run/advisor-gate";
import type { PromptPack } from "../../src/codex-plan-run/prompt-pack";
import type { SpecTask } from "../../src/codex-plan-run/spec-task-framework";

const tempDirs: string[] = [];
async function makeTempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "omp-advisor-gate-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const tddPack: PromptPack = {
	schema_version: "superpowers.prompt_pack.v1",
	run_id: "run-advisor",
	task_id: "T01",
	stage_id: "tdd-writer",
	role_id: "superpowers:tdd-writer",
	role_contract: {
		zh_name: "TDD Writer",
		zh_description: "写失败测试",
		may_edit_production_code: false,
		may_edit_test_code: true,
		read_only: false,
		success_definition: ["red evidence"],
		failure_definition: ["modified production"],
	},
	context_bundle: {
		source_documents: [],
		relevant_code_snippets: [],
		previous_stage_outputs: [],
		known_constraints: [],
	},
	allowed_operations: [{ id: "modify-test-code", title_zh: "修改测试文件" }],
	forbidden_operations: [{ id: "modify-production-code", title_zh: "修改生产代码" }],
	required_outputs: [
		{ id: "red-evidence", title_zh: "Red 测试证据", artifact_path: "tasks/T01/red-evidence.md", required: true },
	],
	return_schema: { id: "superpowers.stage_output.tdd_writer.v1" },
	advisor_checkpoints: [{ gate: "after_stage", title_zh: "阶段后检查" }],
};

const prodImplPack: PromptPack = {
	schema_version: "superpowers.prompt_pack.v1",
	run_id: "run-advisor",
	task_id: "T01",
	stage_id: "implementer",
	role_id: "superpowers:implementer",
	role_contract: {
		zh_name: "Implementer",
		zh_description: "写生产代码",
		may_edit_production_code: true,
		may_edit_test_code: false,
		read_only: false,
		success_definition: ["green evidence"],
		failure_definition: ["modified test"],
	},
	context_bundle: {
		source_documents: [],
		relevant_code_snippets: [],
		previous_stage_outputs: [],
		known_constraints: [],
	},
	allowed_operations: [{ id: "modify-production-code", title_zh: "修改生产代码" }],
	forbidden_operations: [{ id: "modify-test-code", title_zh: "修改测试代码" }],
	required_outputs: [],
	return_schema: { id: "superpowers.stage_output.implementer.v1" },
	advisor_checkpoints: [{ gate: "after_stage", title_zh: "阶段后检查" }],
};

const reviewerPack: PromptPack = {
	schema_version: "superpowers.prompt_pack.v1",
	run_id: "run-advisor",
	task_id: "T01",
	stage_id: "spec-reviewer",
	role_id: "superpowers:spec-reviewer",
	role_contract: {
		zh_name: "Spec Reviewer",
		zh_description: "审查规格",
		may_edit_production_code: false,
		may_edit_test_code: false,
		read_only: true,
		success_definition: ["review complete"],
		failure_definition: ["missed issue"],
	},
	context_bundle: {
		source_documents: [],
		relevant_code_snippets: [],
		previous_stage_outputs: [],
		known_constraints: [],
	},
	allowed_operations: [],
	forbidden_operations: [{ id: "modify-code", title_zh: "修改代码" }],
	required_outputs: [],
	return_schema: { id: "superpowers.stage_output.spec_reviewer.v1" },
	advisor_checkpoints: [{ gate: "after_stage", title_zh: "阶段后检查" }],
};
describe("advisor gate", () => {
	it("blocks missing required evidence", () => {
		const record = evaluateAdvisorGate({
			runId: "run-advisor",
			promptPack: tddPack,
			gate: "after_stage",
			stageOutput: { schema_version: "superpowers.stage_output.tdd_writer.v1", evidence_paths: [] },
			changedFiles: ["test/codex-plan-run/driver.test.ts"],
			commandsRun: [{ command: "bun test", exit_code: 1, output_excerpt: "fail" }],
			existingEvidencePaths: new Set(),
		});

		expect(record.status).toBe("repair_required");
		expect(record.findings).toContainEqual(
			expect.objectContaining({ severity: "must_fix", title_zh: "缺少必需 evidence" }),
		);
	});

	it("blocks role file-scope violations", () => {
		const record = evaluateAdvisorGate({
			runId: "run-advisor",
			promptPack: tddPack,
			gate: "after_stage",
			stageOutput: {
				schema_version: "superpowers.stage_output.tdd_writer.v1",
				evidence_paths: ["tasks/T01/red-evidence.md"],
			},
			changedFiles: ["src/codex-plan-run/driver.ts"],
			commandsRun: [{ command: "bun test", exit_code: 1, output_excerpt: "fail" }],
			existingEvidencePaths: new Set(["tasks/T01/red-evidence.md"]),
		});

		expect(record.status).toBe("repair_required");
		expect(record.findings[0]).toMatchObject({ suggested_owner_role_id: "superpowers:tdd-writer" });
	});

	it("blocks test runner stages without real command evidence", () => {
		const record = evaluateAdvisorGate({
			runId: "run-advisor",
			promptPack: { ...tddPack, stage_id: "test-runner", role_id: "superpowers:test-runner" },
			gate: "after_stage",
			stageOutput: {
				schema_version: "superpowers.stage_output.test_runner.v1",
				evidence_paths: ["tasks/T01/green-evidence.md"],
			},
			changedFiles: [],
			commandsRun: [],
			existingEvidencePaths: new Set(["tasks/T01/green-evidence.md"]),
		});

		expect(record.status).toBe("repair_required");
		expect(record.findings.map(finding => finding.title_zh)).toContain("Test Runner 未运行命令");
	});

	it("writes advisor gate record", async () => {
		const acceptingDir = await makeTempDir();
		const evidencePath = join(acceptingDir, "tasks", "T01", "red-evidence.md");
		await mkdir(join(acceptingDir, "tasks", "T01"), { recursive: true });
		await writeFile(evidencePath, "red", "utf8");
		const record = evaluateAdvisorGate({
			runId: "run-advisor",
			promptPack: tddPack,
			gate: "after_stage",
			stageOutput: {
				schema_version: "superpowers.stage_output.tdd_writer.v1",
				evidence_paths: ["tasks/T01/red-evidence.md"],
			},
			changedFiles: ["test/codex-plan-run/driver.test.ts"],
			commandsRun: [{ command: "bun test", exit_code: 1, output_excerpt: "fail" }],
			existingEvidencePaths: new Set(["tasks/T01/red-evidence.md"]),
		});
		const path = await writeAdvisorGateRecord({ acceptingDir, record });

		expect((await stat(path)).isFile()).toBe(true);
		const parsed = JSON.parse(await readFile(path, "utf8"));
		expect(parsed.schema_version).toBe("superpowers.advisor_gate.v1");
	});

	it("rejects unsafe task_id path segment in writeAdvisorGateRecord", async () => {
		const acceptingDir = await makeTempDir();
		const record: AdvisorGateRecord = {
			schema_version: "superpowers.advisor_gate.v1",
			run_id: "run-advisor",
			task_id: "../..",
			gate: "after_stage",
			status: "accepted",
			findings: [],
			evidence_checked: [],
		};
		await expect(writeAdvisorGateRecord({ acceptingDir, record })).rejects.toThrow(
			"Invalid advisor gate path segment",
		);
	});

	it("rejects unsafe stage_id path segment in writeAdvisorGateRecord", async () => {
		const acceptingDir = await makeTempDir();
		const record: AdvisorGateRecord = {
			schema_version: "superpowers.advisor_gate.v1",
			run_id: "run-advisor",
			task_id: "T01",
			stage_id: "../bad",
			gate: "after_stage",
			status: "accepted",
			findings: [],
			evidence_checked: [],
		};
		await expect(writeAdvisorGateRecord({ acceptingDir, record })).rejects.toThrow(
			"Invalid advisor gate path segment",
		);
	});

	it("detects package-prefixed production paths as production", () => {
		const record = evaluateAdvisorGate({
			runId: "run-advisor",
			promptPack: tddPack,
			gate: "after_stage",
			stageOutput: {
				schema_version: "superpowers.stage_output.tdd_writer.v1",
				evidence_paths: ["tasks/T01/red-evidence.md"],
			},
			changedFiles: ["packages/coding-agent/src/parser.ts"],
			commandsRun: [{ command: "bun test", exit_code: 1, output_excerpt: "fail" }],
			existingEvidencePaths: new Set(["tasks/T01/red-evidence.md"]),
		});

		expect(record.status).toBe("repair_required");
		expect(record.findings).toContainEqual(
			expect.objectContaining({ severity: "must_fix", title_zh: "角色越权修改生产代码" }),
		);
	});

	it("detects __tests__ paths as test paths (TDD writer allowed)", () => {
		const record = evaluateAdvisorGate({
			runId: "run-advisor",
			promptPack: tddPack,
			gate: "after_stage",
			stageOutput: {
				schema_version: "superpowers.stage_output.tdd_writer.v1",
				evidence_paths: ["tasks/T01/red-evidence.md"],
			},
			changedFiles: ["src/foo/__tests__/bar.ts"],
			commandsRun: [{ command: "bun test", exit_code: 1, output_excerpt: "fail" }],
			existingEvidencePaths: new Set(["tasks/T01/red-evidence.md"]),
		});

		expect(record.status).toBe("accepted");
	});

	it("detects __tests__ paths as test paths (production implementer blocked)", () => {
		const record = evaluateAdvisorGate({
			runId: "run-advisor",
			promptPack: prodImplPack,
			gate: "after_stage",
			stageOutput: { schema_version: "superpowers.stage_output.implementer.v1", evidence_paths: [] },
			changedFiles: ["src/foo/__tests__/bar.ts"],
			commandsRun: [{ command: "bun test", exit_code: 0, output_excerpt: "pass" }],
			existingEvidencePaths: new Set(),
		});

		expect(record.status).toBe("repair_required");
		expect(record.findings).toContainEqual(
			expect.objectContaining({ severity: "must_fix", title_zh: "角色越权修改测试代码" }),
		);
	});

	it("detects /tests/ paths as test paths", () => {
		const record = evaluateAdvisorGate({
			runId: "run-advisor",
			promptPack: prodImplPack,
			gate: "after_stage",
			stageOutput: { schema_version: "superpowers.stage_output.implementer.v1", evidence_paths: [] },
			changedFiles: ["src/tests/helpers.ts"],
			commandsRun: [{ command: "bun test", exit_code: 0, output_excerpt: "pass" }],
			existingEvidencePaths: new Set(),
		});

		expect(record.status).toBe("repair_required");
		expect(record.findings).toContainEqual(
			expect.objectContaining({ severity: "must_fix", title_zh: "角色越权修改测试代码" }),
		);
	});

	it("detects _test. and _spec. patterns as test paths", () => {
		const record = evaluateAdvisorGate({
			runId: "run-advisor",
			promptPack: prodImplPack,
			gate: "after_stage",
			stageOutput: { schema_version: "superpowers.stage_output.implementer.v1", evidence_paths: [] },
			changedFiles: ["src/foo_test.py", "src/bar_spec.js"],
			commandsRun: [{ command: "bun test", exit_code: 0, output_excerpt: "pass" }],
			existingEvidencePaths: new Set(),
		});

		expect(record.status).toBe("repair_required");
		expect(record.findings).toContainEqual(
			expect.objectContaining({ severity: "must_fix", title_zh: "角色越权修改测试代码" }),
		);
	});

	it("requires evidence for each reviewer must_fix/should_fix finding", () => {
		const record = evaluateAdvisorGate({
			runId: "run-advisor",
			promptPack: reviewerPack,
			gate: "after_stage",
			stageOutput: {
				schema_version: "superpowers.stage_output.spec_reviewer.v1",
				evidence_paths: [],
				findings: [
					{ severity: "must_fix", evidence: "specific evidence" },
					{ severity: "must_fix", evidence: "" },
				],
			},
			changedFiles: [],
			commandsRun: [],
			existingEvidencePaths: new Set(),
		});

		expect(record.status).toBe("repair_required");
		expect(record.findings).toContainEqual(
			expect.objectContaining({ severity: "must_fix", title_zh: "Reviewer 缺少证据引用" }),
		);
	});

	it("accepts reviewer findings when all must_fix/should_fix have evidence", () => {
		const record = evaluateAdvisorGate({
			runId: "run-advisor",
			promptPack: reviewerPack,
			gate: "after_stage",
			stageOutput: {
				schema_version: "superpowers.stage_output.spec_reviewer.v1",
				evidence_paths: [],
				findings: [
					{ severity: "must_fix", evidence: "specific evidence" },
					{ severity: "should_fix", evidence: "other evidence" },
				],
			},
			changedFiles: [],
			commandsRun: [],
			existingEvidencePaths: new Set(),
		});

		expect(record.status).toBe("accepted");
	});

	it("blocks read-only role with full changed_files containing production code", () => {
		const record = evaluateAdvisorGate({
			runId: "run-advisor",
			promptPack: reviewerPack,
			gate: "after_stage",
			stageOutput: { schema_version: "superpowers.stage_output.spec_reviewer.v1" },
			changedFiles: ["src/production.ts", "test/unittest.ts"],
			commandsRun: [],
			existingEvidencePaths: new Set(),
		});

		expect(record.status).toBe("repair_required");
		expect(record.findings).toContainEqual(
			expect.objectContaining({ severity: "must_fix", title_zh: "角色越权修改生产代码" }),
		);
	});

	it("before_stage passes when required outputs are configured", () => {
		const record = evaluateAdvisorGate({
			runId: "run-advisor",
			promptPack: tddPack,
			gate: "before_stage",
			stageOutput: { schema_version: "superpowers.stage_output.tdd_writer.v1" },
			changedFiles: [],
			commandsRun: [],
			existingEvidencePaths: new Set(),
		});

		expect(record.status).toBe("accepted");
	});

	it("before_global_impact accepts with note when no files changed", () => {
		const record = evaluateAdvisorGate({
			runId: "run-advisor",
			promptPack: tddPack,
			gate: "before_global_impact",
			stageOutput: { schema_version: "superpowers.stage_output.tdd_writer.v1" },
			changedFiles: [],
			commandsRun: [{ command: "bun test", exit_code: 0, output_excerpt: "pass" }],
			existingEvidencePaths: new Set(["tasks/T01/red-evidence.md"]),
		});

		expect(record.status).toBe("accepted");
		expect(record.findings).toContainEqual(
			expect.objectContaining({ severity: "note", title_zh: "无文件变更用于全局影响评估" }),
		);
	});

	it("before_global_impact accepts when files changed", () => {
		const record = evaluateAdvisorGate({
			runId: "run-advisor",
			promptPack: tddPack,
			gate: "before_global_impact",
			stageOutput: { schema_version: "superpowers.stage_output.tdd_writer.v1" },
			changedFiles: ["src/feature.ts"],
			commandsRun: [{ command: "bun test", exit_code: 0, output_excerpt: "pass" }],
			existingEvidencePaths: new Set(["tasks/T01/red-evidence.md"]),
		});

		expect(record.status).toBe("accepted");
		expect(record.findings).toHaveLength(0);
	});

	it("before_final_acceptance blocks when todo status is not accepted", () => {
		const record = evaluateAdvisorGate({
			runId: "run-advisor",
			promptPack: tddPack,
			gate: "before_final_acceptance",
			stageOutput: { schema_version: "superpowers.stage_output.tdd_writer.v1" },
			changedFiles: ["src/feature.ts"],
			commandsRun: [{ command: "bun test", exit_code: 0, output_excerpt: "pass" }],
			existingEvidencePaths: new Set(["tasks/T01/red-evidence.md"]),
			todoStageStatus: "blocked",
		});

		expect(record.status).toBe("repair_required");
		expect(record.findings).toContainEqual(
			expect.objectContaining({ severity: "must_fix", title_zh: "Final acceptance 前任务状态未就绪" }),
		);
	});

	it("before_final_acceptance accepts when todo status and runtime evidence are accepted", () => {
		const record = evaluateAdvisorGate({
			runId: "run-advisor",
			promptPack: tddPack,
			gate: "before_final_acceptance",
			stageOutput: {
				schema_version: "superpowers.stage_output.tdd_writer.v1",
				evidence_paths: ["real-runtime-simulation-report.json", "runtime-cleanup-report.md"],
			},
			changedFiles: ["src/feature.ts"],
			commandsRun: [{ command: "bun test", exit_code: 0, output_excerpt: "pass" }],
			existingEvidencePaths: new Set(["real-runtime-simulation-report.json", "runtime-cleanup-report.md"]),
			todoStageStatus: "accepted",
		});

		expect(record.status).toBe("accepted");
		expect(record.findings).toHaveLength(0);
	});

	it("before_final_acceptance with missing evidence and non-accepted todo blocks", () => {
		const record = evaluateAdvisorGate({
			runId: "run-advisor",
			promptPack: tddPack,
			gate: "before_final_acceptance",
			stageOutput: { schema_version: "superpowers.stage_output.tdd_writer.v1" },
			changedFiles: ["src/feature.ts"],
			commandsRun: [],
			existingEvidencePaths: new Set(),
			todoStageStatus: "in_progress",
		});

		expect(record.status).toBe("repair_required");
	});

	it("before_stage requires required_outputs for non-read-only roles", () => {
		const pack = {
			...prodImplPack,
			required_outputs: [],
			role_contract: { ...prodImplPack.role_contract, read_only: false },
		};
		const record = evaluateAdvisorGate({
			runId: "run-advisor",
			promptPack: pack,
			gate: "before_stage",
			stageOutput: { schema_version: "superpowers.stage_output.implementer.v1" },
			changedFiles: [],
			commandsRun: [],
			existingEvidencePaths: new Set(),
		});

		expect(record.status).toBe("repair_required");
		expect(record.findings).toContainEqual(
			expect.objectContaining({ severity: "must_fix", title_zh: "缺少阶段输出定义" }),
		);
	});

	it("returns repair_required with security-reviewer owner when task classification requires security but evidence paths lack security evidence", () => {
		const pack: PromptPack = {
			...reviewerPack,
			context_bundle: {
				...reviewerPack.context_bundle,
				task: {
					id: "T01",
					title_zh: "安全审查任务",
					intent: "task needing security review",
					acceptance_criteria: [],
					allowed_paths: [],
					forbidden_paths: [],
					dependency_task_ids: [],
					affected_capabilities: [],
					business_paths: [],
					classification: {
						requires_frontend_design: false,
						requires_security_review: true,
						requires_payment_review: false,
						requires_data_migration_review: false,
						requires_destructive_operation_review: false,
						runtime_surface: "none",
						signals: [],
					},
					stages: [],
				} as SpecTask,
			},
		};
		const record = evaluateAdvisorGate({
			runId: "run-advisor",
			promptPack: pack,
			gate: "after_stage",
			stageOutput: { schema_version: "superpowers.stage_output.spec_reviewer.v1" },
			changedFiles: [],
			commandsRun: [],
			existingEvidencePaths: new Set(),
		});

		expect(record.status).toBe("repair_required");
		expect(record.findings).toContainEqual(
			expect.objectContaining({
				severity: "must_fix",
				suggested_owner_role_id: "superpowers:security-reviewer",
			}),
		);
	});

	it("returns repair_required with release-auditor owner when task classification requires destructive operation review but evidence paths lack destructive evidence", () => {
		const pack: PromptPack = {
			...reviewerPack,
			context_bundle: {
				...reviewerPack.context_bundle,
				task: {
					id: "T01",
					title_zh: "破坏性操作审查任务",
					intent: "task needing destructive operation review",
					acceptance_criteria: [],
					allowed_paths: [],
					forbidden_paths: [],
					dependency_task_ids: [],
					affected_capabilities: [],
					business_paths: [],
					classification: {
						requires_frontend_design: false,
						requires_security_review: false,
						requires_payment_review: false,
						requires_data_migration_review: false,
						requires_destructive_operation_review: true,
						runtime_surface: "none",
						signals: [],
					},
					stages: [],
				} as SpecTask,
			},
		};
		const record = evaluateAdvisorGate({
			runId: "run-advisor",
			promptPack: pack,
			gate: "after_stage",
			stageOutput: { schema_version: "superpowers.stage_output.spec_reviewer.v1" },
			changedFiles: [],
			commandsRun: [],
			existingEvidencePaths: new Set(),
		});

		expect(record.status).toBe("repair_required");
		expect(record.findings).toContainEqual(
			expect.objectContaining({
				severity: "must_fix",
				suggested_owner_role_id: "superpowers:release-auditor",
			}),
		);
	});

	it("before_final_acceptance accepts when evidence paths are full paths ending with required filenames", () => {
		const record = evaluateAdvisorGate({
			runId: "run-advisor",
			promptPack: tddPack,
			gate: "before_final_acceptance",
			stageOutput: {
				schema_version: "superpowers.stage_output.tdd_writer.v1",
				evidence_paths: ["/tmp/run/real-runtime-simulation-report.json"],
			},
			changedFiles: ["src/feature.ts"],
			commandsRun: [{ command: "bun test", exit_code: 0, output_excerpt: "pass" }],
			existingEvidencePaths: new Set(["/tmp/run/runtime-cleanup-report.md"]),
			todoStageStatus: "accepted",
		});

		expect(record.status).toBe("accepted");
		expect(record.findings).toHaveLength(0);
	});
});
