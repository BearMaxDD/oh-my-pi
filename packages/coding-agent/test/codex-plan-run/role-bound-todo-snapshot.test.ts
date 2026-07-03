import { describe, expect, it } from "bun:test";
import {
	calculateRoleBoundTaskProgress,
	createRoleBoundStageSnapshots,
	projectFrameworkStagesToRoleBoundTodoSnapshot,
	projectRoleBoundStagesToTodoTasks,
	toRoleBoundStatusLabel,
} from "../../src/codex-plan-run/role-bound-todo-snapshot";

function emptyClassification() {
	return {
		requires_frontend_design: false,
		requires_security_review: false,
		requires_payment_review: false,
		requires_data_migration_review: false,
		requires_destructive_operation_review: false,
		runtime_surface: "none" as const,
		signals: [],
	};
}

describe("role-bound todo snapshots", () => {
	it("creates Chinese stage todos with modelRole metadata", () => {
		const stages = createRoleBoundStageSnapshots({ taskId: "T01", taskTitle: "新增纯函数" });

		expect(stages.map(stage => stage.title)).toEqual([
			"任务 T01：编写失败测试",
			"任务 T01：实现最小生产代码",
			"任务 T01：独立运行测试与 smoke",
			"任务 T01：规格合规审查",
			"任务 T01：代码质量审查",
			"任务 T01：最终验收",
		]);
		expect(stages[0]).toMatchObject({
			stage: "tdd-writer",
			agentRole: "TDD Writer",
			modelRole: "superpowers:tdd-writer",
			stageStatus: "pending",
			statusLabel: "未分配",
		});
	});

	it("does not complete a stage before evidence is accepted", () => {
		const tasks = projectRoleBoundStagesToTodoTasks([
			{
				taskId: "T01",
				title: "任务 T01：编写失败测试",
				stage: "tdd-writer",
				todoStatus: "in_progress",
				stageStatus: "waiting_evidence",
				agentRole: "TDD Writer",
				modelRole: "superpowers:tdd-writer",
				evidenceStatus: "pending_review",
				statusLabel: "等待证据",
			},
		]);

		expect(tasks).toEqual([
			{
				id: "T01:tdd-writer",
				content: "任务 T01：编写失败测试 — TDD Writer — 模型：待解析（superpowers:tdd-writer） — 等待证据",
				status: "in_progress",
			},
		]);
	});

	it("weights progress and caps completion before acceptance", () => {
		const stages = createRoleBoundStageSnapshots({ taskId: "T01", taskTitle: "新增纯函数" }).map(stage => ({
			...stage,
			stageStatus: stage.stage === "acceptance" ? ("pending" as const) : ("completed" as const),
			todoStatus: stage.stage === "acceptance" ? ("pending" as const) : ("completed" as const),
		}));

		expect(calculateRoleBoundTaskProgress(stages)).toBe(90);
	});

	it("keeps machine statuses in English while rendering Chinese labels", () => {
		expect(toRoleBoundStatusLabel("GREEN_VERIFIED")).toBe("绿灯已验证");
		expect(toRoleBoundStatusLabel("NEEDS_CONTEXT")).toBe("需要补充上下文");
	});

	it("derives role-bound todo lines from framework, prompt packs, advisor gates, and evidence", () => {
		const snapshot = projectFrameworkStagesToRoleBoundTodoSnapshot({
			runId: "run-todo",
			state: "tasks_running",
			now: new Date("2026-06-30T00:00:00.000Z"),
			framework: {
				schema_version: "superpowers.spec_task_framework.v1",
				run_id: "run-todo",
				generated_at: "2026-06-30T00:00:00.000Z",
				source_documents: [],
				role_registry_version: "superpowers.role_registry.v1",
				tasks: [
					{
						id: "T01",
						title_zh: "驱动角色绑定执行",
						intent: "driver writes prompt packs",
						acceptance_criteria: ["prompt packs exist"],
						allowed_paths: ["src/codex-plan-run/driver.ts"],
						forbidden_paths: [],
						dependency_task_ids: [],
						affected_capabilities: ["codex-plan-run"],
						business_paths: [],
						classification: emptyClassification(),
						stages: [
							{
								id: "tdd-writer",
								role_id: "superpowers:tdd-writer",
								title_zh: "编写失败测试",
								status: "pending",
								required_evidence: [
									{ id: "red", title_zh: "Red", artifact_path: "tasks/T01/red-evidence.md", required: true },
								],
								output_schema_ref: "superpowers.stage_output.tdd_writer.v1",
							},
							{
								id: "implementer",
								role_id: "superpowers:implementer",
								title_zh: "实现最小生产代码",
								status: "pending",
								required_evidence: [
									{
										id: "impl",
										title_zh: "Implementation",
										artifact_path: "tasks/T01/implementation-summary.md",
										required: true,
									},
								],
								output_schema_ref: "superpowers.stage_output.implementer.v1",
							},
						],
					},
				],
				global_gates: [],
			},
			promptPackPaths: new Set([
				"tasks/T01/prompt-packs/tdd-writer.json",
				"tasks/T01/prompt-packs/implementer.json",
			]),
			submittedStageOutputs: new Set(["T01:tdd-writer", "T01:implementer"]),
			acceptedAdvisorGates: new Set(["T01:tdd-writer"]),
			repairRequiredStages: new Set(["T01:implementer"]),
			existingEvidencePaths: new Set(["tasks/T01/red-evidence.md"]),
			assignedModels: { "T01:tdd-writer": "anthropic/claude-sonnet-4" },
		});

		expect(snapshot.phases[0].name).toBe("Role-Bound Execution");
		expect(snapshot.phases[0].tasks).toEqual([
			{
				id: "T01:tdd-writer",
				content:
					"任务 T01：编写失败测试 ｜ 角色：TDD Writer（TDD Writer：读任务规格，写失败测试，提交 red evidence）｜ 模型：anthropic/claude-sonnet-4 ｜ 状态：已接受 ｜ evidence：tasks/T01/red-evidence.md",
				status: "completed",
			},
			{
				id: "T01:implementer",
				content:
					"任务 T01：实现最小生产代码 ｜ 角色：Implementer（Implementer：只改生产代码，让 red 测试变绿）｜ 模型：待解析（superpowers:implementer） ｜ 状态：需要修复 ｜ evidence：tasks/T01/implementation-summary.md",
				status: "in_progress",
			},
		]);
	});

	it("projects blocked framework stages as blocked", () => {
		const snapshot = projectFrameworkStagesToRoleBoundTodoSnapshot({
			runId: "run-blocked",
			state: "tasks_running",
			now: new Date("2026-06-30T00:00:00.000Z"),
			framework: {
				schema_version: "superpowers.spec_task_framework.v1",
				run_id: "run-blocked",
				generated_at: "2026-06-30T00:00:00.000Z",
				source_documents: [],
				role_registry_version: "superpowers.role_registry.v1",
				tasks: [
					{
						id: "T01",
						title_zh: "驱动角色绑定执行",
						intent: "driver writes prompt packs",
						acceptance_criteria: ["prompt packs exist"],
						allowed_paths: ["src/codex-plan-run/driver.ts"],
						forbidden_paths: [],
						dependency_task_ids: [],
						affected_capabilities: ["codex-plan-run"],
						business_paths: [],
						classification: emptyClassification(),
						stages: [
							{
								id: "tdd-writer",
								role_id: "superpowers:tdd-writer",
								title_zh: "编写失败测试",
								status: "blocked",
								required_evidence: [
									{ id: "red", title_zh: "Red", artifact_path: "tasks/T01/red-evidence.md", required: true },
								],
								output_schema_ref: "superpowers.stage_output.tdd_writer.v1",
							},
						],
					},
				],
				global_gates: [],
			},
			promptPackPaths: new Set(),
			submittedStageOutputs: new Set(),
			acceptedAdvisorGates: new Set(),
			repairRequiredStages: new Set(),
			existingEvidencePaths: new Set(),
		});

		expect(snapshot.phases[0].tasks).toHaveLength(1);
		expect(snapshot.phases[0].tasks[0].status).toBe("in_progress");
		expect(snapshot.phases[0].tasks[0].content).toContain("状态：已阻塞");
	});

	it("projects abandoned stages as in-progress todo status with abandoned label", () => {
		const snapshot = projectFrameworkStagesToRoleBoundTodoSnapshot({
			runId: "run-abandoned",
			state: "tasks_running",
			now: new Date("2026-06-30T00:00:00.000Z"),
			framework: {
				schema_version: "superpowers.spec_task_framework.v1",
				run_id: "run-abandoned",
				generated_at: "2026-06-30T00:00:00.000Z",
				source_documents: [],
				role_registry_version: "superpowers.role_registry.v1",
				tasks: [
					{
						id: "T01",
						title_zh: "驱动角色绑定执行",
						intent: "driver writes prompt packs",
						acceptance_criteria: ["prompt packs exist"],
						allowed_paths: ["src/codex-plan-run/driver.ts"],
						forbidden_paths: [],
						dependency_task_ids: [],
						affected_capabilities: ["codex-plan-run"],
						business_paths: [],
						classification: emptyClassification(),
						stages: [
							{
								id: "tdd-writer",
								role_id: "superpowers:tdd-writer",
								title_zh: "编写失败测试",
								status: "pending",
								required_evidence: [
									{ id: "red", title_zh: "Red", artifact_path: "tasks/T01/red-evidence.md", required: true },
								],
								output_schema_ref: "superpowers.stage_output.tdd_writer.v1",
							},
							{
								id: "implementer",
								role_id: "superpowers:implementer",
								title_zh: "实现最小生产代码",
								status: "pending",
								required_evidence: [
									{
										id: "impl",
										title_zh: "Implementation",
										artifact_path: "tasks/T01/implementation-summary.md",
										required: true,
									},
								],
								output_schema_ref: "superpowers.stage_output.implementer.v1",
							},
						],
					},
				],
				global_gates: [],
			},
			promptPackPaths: new Set(["tasks/T01/prompt-packs/tdd-writer.json"]),
			submittedStageOutputs: new Set(["T01:tdd-writer"]),
			acceptedAdvisorGates: new Set(["T01:tdd-writer"]),
			repairRequiredStages: new Set(),
			abandonedStages: new Set(["T01:implementer"]),
			existingEvidencePaths: new Set(["tasks/T01/red-evidence.md"]),
		});

		expect(snapshot.phases[0].tasks).toHaveLength(2);
		expect(snapshot.phases[0].tasks[0].status).toBe("completed");
		expect(snapshot.phases[0].tasks[1].status).toBe("in_progress");
		expect(snapshot.phases[0].tasks[1].content).toContain("状态：已放弃");
	});

	it("includes runtime surface and specialized reviewer labels for classified tasks", () => {
		const snapshot = projectFrameworkStagesToRoleBoundTodoSnapshot({
			runId: "run-classified",
			state: "tasks_running",
			now: new Date("2026-06-30T00:00:00.000Z"),
			framework: {
				schema_version: "superpowers.spec_task_framework.v1",
				run_id: "run-classified",
				generated_at: "2026-06-30T00:00:00.000Z",
				source_documents: [],
				role_registry_version: "superpowers.role_registry.v1",
				tasks: [
					{
						id: "T01",
						title_zh: "需要多角色审查的任务",
						intent: "task needing frontend and security review",
						acceptance_criteria: ["works"],
						allowed_paths: [],
						forbidden_paths: [],
						dependency_task_ids: [],
						affected_capabilities: [],
						business_paths: [],
						classification: {
							requires_frontend_design: true,
							requires_security_review: true,
							requires_payment_review: false,
							requires_data_migration_review: false,
							requires_destructive_operation_review: false,
							runtime_surface: "browser",
							signals: [],
						},
						stages: [
							{
								id: "spec-reviewer",
								role_id: "superpowers:spec-reviewer",
								title_zh: "规格合规审查",
								status: "pending",
								required_evidence: [
									{
										id: "spec-review",
										title_zh: "Spec Review",
										artifact_path: "tasks/T01/spec-review.md",
										required: true,
									},
								],
								output_schema_ref: "superpowers.stage_output.spec_reviewer.v1",
							},
						],
					},
				],
				global_gates: [],
			},
			promptPackPaths: new Set(),
			submittedStageOutputs: new Set(),
			acceptedAdvisorGates: new Set(),
			repairRequiredStages: new Set(),
			existingEvidencePaths: new Set(),
		});

		const taskContent = snapshot.phases[0].tasks[0].content;
		expect(taskContent).toContain("runtime_surface");
		expect(taskContent).toContain("browser");
		expect(taskContent).toMatch(/前端|frontend/i);
		expect(taskContent).toMatch(/安全|security/i);
	});
});
