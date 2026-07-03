import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { MODEL_ROLES } from "../config/model-roles";
import type { AdvisorFinding } from "./advisor-findings";
import { writeAdvisorFindings } from "./advisor-findings";
import { type AdvisorGateRecord, evaluateAdvisorGate, writeAdvisorGateRecord } from "./advisor-gate";
import type { AdvisorSummary } from "./advisor-summary";
import type { CodebaseMemoryExecutionRecon } from "./codebase-memory-recon";
import type { CodebaseMemoryReindexProvider } from "./codebase-memory-reindex";
import { mergeCodebaseMemoryReindexSummary, runCodebaseMemoryTaskReindex } from "./codebase-memory-reindex";
import { createDefaultRuntimeSimulationRunner } from "./default-runtime-runner";
import { appendPlanRunEvent } from "./events";
import type { PlanExecutionBook } from "./execution-book";
import { buildGlobalImpactReport, writeGlobalImpactReport } from "./global-impact";
import type {
	CodebaseMemoryReconOptions,
	GitDiffSummary,
	MainThreadAcceptanceReviewRequest,
	MainThreadAcceptanceReviewResult,
	TaskExecutionOutput,
} from "./main-acceptance-review";
import { createModelRoutingEvidence, writeModelRoutingEvidence } from "./model-routing-evidence";
import {
	type ArtifactRef,
	compilePromptPacksForFramework,
	type PromptPack,
	withPromptPackPreviousStageOutputs,
	writePromptPackArtifacts,
} from "./prompt-pack";
import {
	type RuntimeSimulationRunner,
	runRealRuntimeSimulation,
	writeRealRuntimeSimulationArtifacts,
} from "./real-runtime-simulation";
import type { CreatePlanRunRepairDecisionInput, PlanRunRepairDecision } from "./repair-loop";
import {
	buildRoleBoundStageRunInputs,
	type RoleBoundStageRunInput,
	type StageOutputRef,
} from "./role-bound-stage-scheduler";
import {
	buildBusinessSimulationScenarios,
	buildRuntimeEnvironmentPlan,
	writeRuntimeScenarioArtifacts,
} from "./runtime-scenarios";
import type { SkillEvidenceMatrix } from "./skill-evidence";
import { buildSpecTaskFramework, type SpecTaskFramework, writeSpecTaskFrameworkArtifacts } from "./spec-task-framework";
import {
	type StageManifestEntry,
	sha256Json,
	writeRoleRegistrySnapshot,
	writeStageLedgerEntry,
	writeTodoSnapshotArtifact,
} from "./stage-ledger";
import {
	resolveSuperpowersCodebaseMemoryExecutionGate,
	writeSuperpowersCodebaseMemoryGateEvidence,
} from "./superpowers-codebase-memory-execution-gate";
import type { SubagentTaskOutput, TaskCommandEvidence, TaskReviewRequest, TaskReviewResult } from "./task-review";
import type { TddEvidenceMatrix } from "./tdd-evidence";
import type { PlanRunState } from "./types";

export type { RoleBoundStageRunInput, StageOutputRef } from "./role-bound-stage-scheduler";
export { buildRoleBoundStageRunInputs } from "./role-bound-stage-scheduler";

import { projectFrameworkStagesToRoleBoundTodoSnapshot } from "./role-bound-todo-snapshot";
// ---- Public types ----

/**
 * Extended subagent task output that carries agent/model/advisor metadata
 * returned by the injected spawnTask dependency.
 */
export interface SpawnTaskOutput extends SubagentTaskOutput {
	agentId?: string;
	modelRole?: string;
	resolvedModel?: string;
	modelOverrides?: string[];
	advisorFindings?: AdvisorFinding[];
}

/**
 * Extended stage output that carries stage-specific metadata
 * returned by the injected spawnStage dependency.
 */
export interface RoleBoundStageRunOutput extends SpawnTaskOutput {
	task_id: string;
	stage_id: string;
	role_id: string;
	schema_version?: string;
	output_path: string;
	evidence_paths: string[];
}

/**
 * Dependency-injected interfaces for the PlanRun driver.
 * Unit tests substitute these with mocks so real subagents and MCP are never touched.
 */
export interface PlanRunDriverDeps {
	spawnTask(input: { book: PlanExecutionBook; acceptingDir: string; taskId: string }): Promise<SpawnTaskOutput>;
	reviewTask(request: TaskReviewRequest): Promise<TaskReviewResult>;
	runMainAcceptance(input: MainThreadAcceptanceReviewRequest): Promise<MainThreadAcceptanceReviewResult>;
	spawnStage?(input: RoleBoundStageRunInput): Promise<RoleBoundStageRunOutput>;
	createRepairDecision(input: CreatePlanRunRepairDecisionInput): PlanRunRepairDecision;
}

export interface PlanRunDriverInput {
	acceptingDir: string;
	executionBook: PlanExecutionBook;
	repoPath: string;
	project: string;
	reindexProvider: CodebaseMemoryReindexProvider | null;
	reconEvidence?: CodebaseMemoryExecutionRecon | null;
	superpowersSkillName?: string;
	superpowersGateMode?: "off" | "advisory" | "required";
	now?: Date;
	tddEvidenceMatrix?: TddEvidenceMatrix;
	skillEvidenceMatrix?: SkillEvidenceMatrix;
	commands?: TaskCommandEvidence[];
	verificationCommands?: MainThreadAcceptanceReviewRequest["verificationCommands"];
	worktreePath?: string;
	manifestPath?: string;
	completionDocPath?: string;
	gitDiffSummary?: GitDiffSummary;
	codebaseMemoryReconOptions?: CodebaseMemoryReconOptions;
	advisorSummary?: AdvisorSummary;
	repairRound?: number;
	maxRepairRounds?: number;
	specTaskFrameworkPath?: string;
	roleRegistryVersion?: string;
	enableRoleBoundExecution?: boolean;
	enableAdvisorGate?: boolean;
	enableGlobalImpactGate?: boolean;
	runtimeCommandTimeoutMs?: number;
	enableRealBusinessSimulationGate?: boolean;
	runtimeSimulationRunner?: RuntimeSimulationRunner;
	runtimeScenario?: {
		browser: { enabled: boolean };
		api: { enabled: boolean };
		database: { enabled: boolean };
	};
	classification?: {
		enabled: boolean;
		requireReviewerEvidence: boolean;
	};
}

export interface PlanRunDriverResult {
	state: PlanRunState;
	decision?: PlanRunRepairDecision;
	specTaskFramework?: SpecTaskFramework;
	promptPacksByStage?: Record<string, PromptPack>;
	roleBoundTodoSnapshots?: MainThreadAcceptanceReviewRequest["todoSnapshot"][];
	advisorGateRecords?: AdvisorGateRecord[];
	globalImpactReportPath?: string;
	realRuntimeSimulationReportPath?: string;
}

// ---- Internal helpers ----

function buildTodoSnapshot(
	executionBook: PlanExecutionBook,
	state: PlanRunState,
): MainThreadAcceptanceReviewRequest["todoSnapshot"] {
	return {
		runId: executionBook.run_id,
		version: 1,
		state,
		updatedAt: new Date().toISOString(),
		source: "state-machine",
		phases: [
			{
				name: "tasks",
				tasks: executionBook.tasks.map(task => ({
					content: task.todo || task.title,
					status: "completed" as const,
				})),
			},
		],
	};
}

async function sha256File(path: string): Promise<string> {
	return createHash("sha256")
		.update(await readFile(path))
		.digest("hex");
}

function buildTaskExecutionOutput(spawnOutput: SpawnTaskOutput, reviewResult: TaskReviewResult): TaskExecutionOutput {
	return {
		task_id: spawnOutput.task_id,
		result: spawnOutput.result === "blocked" ? "failed" : "completed",
		subagent_id: spawnOutput.agentId ?? "",
		summary: "",
		files_changed: spawnOutput.changed_files,
		commands_run: [],
		evidence_files: spawnOutput.evidence,
		review_skills_used: reviewResult.review_skills_used,
		final_tail_skills_used: reviewResult.final_tail_skills_used,
	};
}

function isTestChange(path: string): boolean {
	return (
		path.startsWith("test/") ||
		path.includes("/test/") ||
		path.includes("/tests/") ||
		path.includes("/__tests__/") ||
		path.endsWith(".test.ts") ||
		path.endsWith(".spec.ts") ||
		path.includes("_test.") ||
		path.includes("_spec.")
	);
}

function changedFilesForPromptPack(pack: PromptPack, changedFiles: readonly string[]): string[] {
	return changedFiles.filter(file => {
		const testChange = isTestChange(file);
		return testChange ? pack.role_contract.may_edit_test_code : pack.role_contract.may_edit_production_code;
	});
}

function stageOutputRefsToArtifacts(outputs: readonly StageOutputRef[]): ArtifactRef[] {
	return outputs.map(output => ({
		path: output.outputPath,
		description: `${output.taskId}/${output.stageId} stage output`,
	}));
}

function isGraphTestPath(path: string): boolean {
	return /(^|\/)test(s)?\/|\.(test|spec)\./.test(path);
}

function graphRiskToImpactRisk(risk: string | undefined): "low" | "medium" | "high" {
	if (risk === "CRITICAL" || risk === "HIGH" || risk === "high") return "high";
	if (risk === "LOW" || risk === "low") return "low";
	return "medium";
}

function uniqueStrings(values: readonly (string | undefined)[]): string[] {
	return [...new Set(values.filter((value): value is string => typeof value === "string" && value.length > 0))];
}

function advisorCheckpointPromptPack(options: { taskId: string; stageId: string; roleId?: string }): PromptPack {
	const roleId = options.roleId ?? "superpowers:advisor";
	return {
		schema_version: "superpowers.prompt_pack.v1",
		run_id: "advisor-checkpoint",
		task_id: options.taskId,
		stage_id: options.stageId,
		role_id: roleId,
		role_contract: {
			zh_name: roleId,
			zh_description: roleId,
			may_edit_production_code: false,
			may_edit_test_code: false,
			read_only: true,
			success_definition: ["checkpoint accepted"],
			failure_definition: ["checkpoint has must-fix findings"],
		},
		context_bundle: {
			source_documents: [],
			relevant_code_snippets: [],
			previous_stage_outputs: [],
			known_constraints: [],
		},
		allowed_operations: [{ id: "read-files", title_zh: "读取文件" }],
		forbidden_operations: [],
		required_outputs: [],
		return_schema: { id: `superpowers.advisor_checkpoint.${options.stageId}.v1` },
		advisor_checkpoints: [],
	};
}

// ---- Driver ----

/**
 * Drive a PlanRun from task execution through codebase memory reindex,
 * advisor findings, model routing evidence, superpowers gate, task review,
 * and main acceptance review.
 *
 * The driver writes artifacts under {@link input.acceptingDir} and returns a
 * {@link PlanRunDriverResult} that indicates the terminal state and, on
 * failure paths, a repair decision.
 */
export async function runPlanRunDriver(
	input: PlanRunDriverInput,
	deps: PlanRunDriverDeps,
): Promise<PlanRunDriverResult> {
	const { acceptingDir, executionBook, repoPath, project, reindexProvider, now } = input;

	const taskOutputs: TaskExecutionOutput[] = [];
	const taskReviewRecords: TaskReviewResult[] = [];
	const commands = input.commands ?? [];
	const reindexEvidenceByTask: Record<
		string,
		{ status?: string; jsonPath?: string; degraded_reason?: string | null }
	> = {};
	const allReindexEvidence: Awaited<ReturnType<typeof runCodebaseMemoryTaskReindex>>[] = [];
	const modelRoutingTasks: Record<
		string,
		{ resolved_model?: string | null; model_role?: string | null; evidence_path?: string }
	> = {};
	let advisorSummaryPath: string | undefined;

	// ---- Role-bound execution setup (spec framework + prompt packs) ----

	const roleBoundEnabled = input.enableRoleBoundExecution === true;
	const framework = roleBoundEnabled
		? buildSpecTaskFramework({
				executionBook,
				sourceDocuments: [{ type: "plan", path: executionBook.plan.path, sha256: executionBook.plan.sha256 }],
				roleRegistryVersion: input.roleRegistryVersion,
				now,
				classification: input.classification,
			})
		: undefined;
	const frameworkPaths = framework ? await writeSpecTaskFrameworkArtifacts({ acceptingDir, framework }) : undefined;
	const roleRegistrySnapshot = roleBoundEnabled
		? await writeRoleRegistrySnapshot({ acceptingDir, registry: { roles: MODEL_ROLES } })
		: undefined;
	const specTaskFrameworkSha256 = framework ? sha256Json(framework) : undefined;
	const roleBoundStages: Record<string, StageManifestEntry> = {};
	const promptPacks = framework
		? compilePromptPacksForFramework({
				framework,
				codebaseMemorySummary: input.reconEvidence?.evidencePath,
			})
		: [];
	const promptPackPaths =
		promptPacks.length > 0 ? await writePromptPackArtifacts({ acceptingDir, packs: promptPacks }) : [];
	const promptPacksByStage = Object.fromEntries(promptPacks.map(pack => [`${pack.task_id}:${pack.stage_id}`, pack]));
	const advisorGateRecords: AdvisorGateRecord[] = [];
	const submittedStageOutputs = new Set<string>();
	const existingStageEvidencePaths = new Set<string>();
	const acceptedAdvisorGates = new Set<string>();
	const repairRequiredStages = new Set<string>();
	const blockedStages = new Set<string>();
	const abandonedStages = new Set<string>();
	const stageAssignedModels: Record<string, string> = {};
	const roleBoundTodoSnapshots: MainThreadAcceptanceReviewRequest["todoSnapshot"][] = [];
	const writeCurrentRoleBoundTodoSnapshot = async (state: PlanRunState) => {
		if (!roleBoundEnabled || !framework) return undefined;
		const roleBoundTodo = projectFrameworkStagesToRoleBoundTodoSnapshot({
			runId: executionBook.run_id,
			state,
			framework,
			promptPackPaths: new Set(promptPackPaths),
			submittedStageOutputs,
			acceptedAdvisorGates,
			repairRequiredStages,
			blockedStages,
			abandonedStages,
			existingEvidencePaths: existingStageEvidencePaths,
			assignedModels: stageAssignedModels,
			now,
		});
		await writeTodoSnapshotArtifact({ acceptingDir, snapshot: roleBoundTodo });
		roleBoundTodoSnapshots.push(roleBoundTodo);
		return roleBoundTodo;
	};

	// ---- Phase 1: Execute each task through the pipeline ----

	for (const task of executionBook.tasks) {
		const taskId = task.id;

		// -- Spawn the task (or role-bound stages) via injected dependency --

		let spawnOutput: SpawnTaskOutput;
		let stageBlocked: RoleBoundStageRunOutput | undefined;
		const previousStageOutputs: StageOutputRef[] = [];
		if (roleBoundEnabled && framework) {
			if (!deps.spawnStage) {
				throw new Error("Role-bound execution requires PlanRunDriverDeps.spawnStage");
			}
			const stageInputs = buildRoleBoundStageRunInputs({
				book: executionBook,
				acceptingDir,
				taskId,
				promptPacks,
				previousStageOutputs,
			});
			const stageOutputs: RoleBoundStageRunOutput[] = [];
			for (const stageInput of stageInputs) {
				// Assign cumulative previous outputs to both the scheduler input and the persisted prompt pack.
				stageInput.previousStageOutputs = [...previousStageOutputs];
				stageInput.promptPack = withPromptPackPreviousStageOutputs(
					stageInput.promptPack,
					stageOutputRefsToArtifacts(previousStageOutputs),
				);
				promptPacksByStage[`${stageInput.taskId}:${stageInput.stageId}`] = stageInput.promptPack;
				await writePromptPackArtifacts({ acceptingDir, packs: [stageInput.promptPack] });
				const stageAdvisorGates: Array<{
					gate: string;
					status: "accepted" | "repair_required" | "blocked";
					path: string;
				}> = [];
				if (input.enableAdvisorGate === true) {
					// before_stage: evaluate stage prompt pack config BEFORE running the stage
					const beforeStageAdvisorRecord = evaluateAdvisorGate({
						runId: executionBook.run_id,
						promptPack: stageInput.promptPack,
						gate: "before_stage",
						stageOutput: { schema_version: stageInput.promptPack.return_schema.id },
						changedFiles: [],
						commandsRun: commands.map(command => ({
							command: command.command,
							exit_code: command.exit_code ?? undefined,
							output_excerpt: command.evidence,
						})),
						existingEvidencePaths: existingStageEvidencePaths,
					});
					advisorGateRecords.push(beforeStageAdvisorRecord);
					const beforeStagePath = await writeAdvisorGateRecord({ acceptingDir, record: beforeStageAdvisorRecord });
					stageAdvisorGates.push({
						gate: beforeStageAdvisorRecord.gate,
						status: beforeStageAdvisorRecord.status,
						path: beforeStagePath,
					});
				}
				const stageOutput = await deps.spawnStage(stageInput);
				if (input.enableAdvisorGate === true) {
					// after_stage: evaluate stage output using FULL changed_files (not filtered)
					const stageEvidenceSet = new Set(stageOutput.evidence_paths);
					const stageAdvisorRecord = evaluateAdvisorGate({
						runId: executionBook.run_id,
						promptPack: stageInput.promptPack,
						gate: "after_stage",
						stageOutput: {
							schema_version: stageOutput.schema_version,
							evidence_paths: stageOutput.evidence_paths,
						},
						changedFiles: stageOutput.changed_files,
						commandsRun: commands.map(command => ({
							command: command.command,
							exit_code: command.exit_code ?? undefined,
							output_excerpt: command.evidence,
						})),
						existingEvidencePaths: stageEvidenceSet,
					});
					advisorGateRecords.push(stageAdvisorRecord);
					const stageAdvisorPath = await writeAdvisorGateRecord({ acceptingDir, record: stageAdvisorRecord });
					stageAdvisorGates.push({
						gate: stageAdvisorRecord.gate,
						status: stageAdvisorRecord.status,
						path: stageAdvisorPath,
					});
				}
				const stageModelEvidence = createModelRoutingEvidence({
					runId: executionBook.run_id,
					taskId,
					agentId: stageOutput.agentId,
					modelRole: stageOutput.modelRole,
					resolvedModel: stageOutput.resolvedModel,
					modelOverrides: stageOutput.modelOverrides,
				});
				const stageLedgerStatus =
					stageOutput.result !== "completed"
						? "blocked"
						: stageAdvisorGates.some(gate => gate.status === "blocked")
							? "blocked"
							: stageAdvisorGates.some(gate => gate.status === "repair_required")
								? "repair_required"
								: "accepted";
				const stageLedger = await writeStageLedgerEntry({
					acceptingDir,
					runId: executionBook.run_id,
					taskId,
					stageId: stageInput.stageId,
					status: stageLedgerStatus,
					output: stageOutput,
					modelRouting: { ...stageModelEvidence, stage_id: stageInput.stageId, role_id: stageOutput.role_id },
					advisorGates: stageAdvisorGates,
				});
				roleBoundStages[stageLedger.key] = stageLedger.manifest;
				for (const evidencePath of stageOutput.evidence_paths) existingStageEvidencePaths.add(evidencePath);
				submittedStageOutputs.add(stageLedger.key);
				stageAssignedModels[stageLedger.key] = stageOutput.resolvedModel ?? "";
				if (stageLedgerStatus === "accepted") acceptedAdvisorGates.add(stageLedger.key);
				if (stageLedgerStatus === "repair_required") repairRequiredStages.add(stageLedger.key);
				if (stageLedgerStatus === "blocked") {
					blockedStages.add(stageLedger.key);
					// Mark remaining stages in this task as abandoned
					const taskFw = framework?.tasks.find(t => t.id === taskId);
					if (taskFw) {
						let foundBlocked = false;
						for (const st of taskFw.stages) {
							const sk = `${taskId}:${st.id}`;
							if (foundBlocked) abandonedStages.add(sk);
							if (sk === stageLedger.key) foundBlocked = true;
						}
					}
				}
				previousStageOutputs.push({
					taskId,
					stageId: stageInput.stageId,
					outputPath: stageOutput.output_path,
				});
				stageOutputs.push(stageOutput);
				if (stageOutput.result !== "completed") {
					stageBlocked = stageOutput;
					break;
				}
			}
			// Merge all stage outputs so downstream consumers (reindex, advisor, review)
			// see the union of changed files, evidence, tests, skills, and findings.
			// If a stage blocked, use that stage's result — do not let later stages overwrite it.
			const base = stageBlocked ?? stageOutputs[stageOutputs.length - 1];
			spawnOutput = {
				...base,
				changed_files: [...new Set(stageOutputs.flatMap(o => o.changed_files))],
				evidence: [...new Set(stageOutputs.flatMap(o => o.evidence))],
				tests_run: [...new Set(stageOutputs.flatMap(o => o.tests_run))],
				execution_skills_used: [...new Set(stageOutputs.flatMap(o => o.execution_skills_used))],
				final_tail_skills_used: [...new Set(stageOutputs.flatMap(o => o.final_tail_skills_used))],
				scope_notes: stageOutputs.flatMap(o => o.scope_notes),
				advisorFindings: stageOutputs.flatMap(o => o.advisorFindings ?? []),
			};
		} else {
			spawnOutput = await deps.spawnTask({
				book: executionBook,
				acceptingDir,
				taskId,
			});
		}

		await appendPlanRunEvent({
			acceptingDir,
			event: {
				schema_version: 1,
				run_id: executionBook.run_id,
				state: "task_green_evidence_pending",
				type: "task_green_evidence_passed",
				task_id: taskId,
				created_at: (now ?? new Date()).toISOString(),
			},
		});

		await appendPlanRunEvent({
			acceptingDir,
			event: {
				schema_version: 1,
				run_id: executionBook.run_id,
				state: "codebase_memory_reindex_pending",
				type: "codebase_memory_reindex_started",
				task_id: taskId,
				created_at: (now ?? new Date()).toISOString(),
			},
		});

		const reindexEvidence = await runCodebaseMemoryTaskReindex({
			runId: executionBook.run_id,
			taskId,
			repoPath,
			project,
			acceptingDir,
			changedFiles: spawnOutput.changed_files,
			provider: reindexProvider,
			now,
		});

		allReindexEvidence.push(reindexEvidence);
		reindexEvidenceByTask[taskId] = {
			status: reindexEvidence.status,
			jsonPath: reindexEvidence.jsonPath,
			degraded_reason: reindexEvidence.degraded_reason,
		};

		await mergeCodebaseMemoryReindexSummary({
			acceptingDir,
			evidence: allReindexEvidence,
		});

		await appendPlanRunEvent({
			acceptingDir,
			event: {
				schema_version: 1,
				run_id: executionBook.run_id,
				state: "codebase_memory_reindex_done",
				type:
					reindexEvidence.status === "degraded"
						? "codebase_memory_reindex_degraded"
						: "codebase_memory_reindex_completed",
				task_id: taskId,
				created_at: (now ?? new Date()).toISOString(),
			},
		});

		// -- Advisor findings --

		const advisorPaths = await writeAdvisorFindings({
			acceptingDir,
			taskId,
			findings: spawnOutput.advisorFindings ?? [],
		});
		advisorSummaryPath = advisorPaths.summaryPath;

		// -- Model routing evidence --

		const modelEvidence = createModelRoutingEvidence({
			runId: executionBook.run_id,
			taskId,
			agentId: spawnOutput.agentId,
			modelRole: spawnOutput.modelRole,
			resolvedModel: spawnOutput.resolvedModel,
			modelOverrides: spawnOutput.modelOverrides,
		});

		const modelEvidencePath = await writeModelRoutingEvidence(modelEvidence, acceptingDir);
		modelRoutingTasks[taskId] = {
			resolved_model: modelEvidence.resolved_model,
			model_role: modelEvidence.model_role,
			evidence_path: modelEvidencePath,
		};

		// -- Superpowers codebase-memory execution gate --

		const gateEvidence = resolveSuperpowersCodebaseMemoryExecutionGate({
			run_id: executionBook.run_id,
			task_id: taskId,
			skillName: input.superpowersSkillName ?? "",
			mode: input.superpowersGateMode,
			reconEvidence: input.reconEvidence,
		});

		await writeSuperpowersCodebaseMemoryGateEvidence(acceptingDir, gateEvidence);

		if (gateEvidence.blocked) {
			const reviewResult: TaskReviewResult = {
				task_id: taskId,
				review_skills_used: [],
				final_tail_skills_used: [],
				plan_compliance: "FAIL",
				scope_control: "PASS",
				smoke_tests: "PASS",
				evidence_quality: "FAIL",
				over_implementation_check: "PASS",
				result: "TASK_FIX_REQUIRED",
				must_fix_items: [
					{
						id: "superpowers_codebase_memory_gate_blocked",
						description:
							gateEvidence.degraded_reason || "Required Codebase Memory execution gate blocked the task",
						evidence: `tasks/${taskId}/superpowers-codebase-memory-gate.json`,
					},
				],
			};
			taskReviewRecords.push(reviewResult);
			const decision = deps.createRepairDecision({
				book: executionBook,
				taskReview: reviewResult,
				repairRound: input.repairRound ?? 0,
				maxRepairRounds: input.maxRepairRounds ?? 3,
				acceptingDir,
				repoPath,
				worktreePath: input.worktreePath,
				planPath: executionBook.plan.path,
				planSha256: executionBook.plan.sha256,
			});

			await appendPlanRunEvent({
				acceptingDir,
				event: {
					schema_version: 1,
					run_id: executionBook.run_id,
					state: "task_fix_required",
					type: "task_fix_required",
					task_id: taskId,
					created_at: (now ?? new Date()).toISOString(),
				},
			});

			return { state: "task_fix_required", decision };
		}

		// -- Advisor gate evaluation --

		if (!roleBoundEnabled && input.enableAdvisorGate === true && framework) {
			const taskPacks = promptPacks.filter(pack => pack.task_id === taskId);
			const evidenceSet = new Set(spawnOutput.evidence);
			for (const pack of taskPacks) {
				const record = evaluateAdvisorGate({
					runId: executionBook.run_id,
					promptPack: pack,
					gate: "after_stage",
					stageOutput: { schema_version: pack.return_schema.id, evidence_paths: spawnOutput.evidence },
					changedFiles: changedFilesForPromptPack(pack, spawnOutput.changed_files),
					commandsRun: commands.map(command => ({
						command: command.command,
						exit_code: command.exit_code ?? undefined,
						output_excerpt: command.evidence,
					})),
					existingEvidencePaths: evidenceSet,
				});
				advisorGateRecords.push(record);
				await writeAdvisorGateRecord({ acceptingDir, record });
			}
		}

		// -- Role-bound stage blocked: route through repair without task review --
		if (stageBlocked) {
			await writeCurrentRoleBoundTodoSnapshot("task_fix_required");
			const reviewResult: TaskReviewResult = {
				task_id: taskId,
				review_skills_used: [],
				final_tail_skills_used: [],
				plan_compliance: "FAIL",
				scope_control: "PASS",
				smoke_tests: "PASS",
				evidence_quality: "FAIL",
				over_implementation_check: "PASS",
				result: "TASK_FIX_REQUIRED",
				must_fix_items: [
					{
						id: "role_bound_stage_blocked",
						description: `Role-bound stage "${stageBlocked.stage_id}" returned result "${stageBlocked.result}"`,
						evidence: `tasks/${taskId}/stages/${stageBlocked.stage_id}/output.json`,
					},
				],
			};
			taskReviewRecords.push(reviewResult);
			const decision = deps.createRepairDecision({
				book: executionBook,
				taskReview: reviewResult,
				repairRound: input.repairRound ?? 0,
				maxRepairRounds: input.maxRepairRounds ?? 3,
				acceptingDir,
				repoPath,
				worktreePath: input.worktreePath,
				planPath: executionBook.plan.path,
				planSha256: executionBook.plan.sha256,
			});

			await appendPlanRunEvent({
				acceptingDir,
				event: {
					schema_version: 1,
					run_id: executionBook.run_id,
					state: "task_fix_required",
					type: "task_fix_required",
					task_id: taskId,
					created_at: (now ?? new Date()).toISOString(),
				},
			});

			return { state: "task_fix_required", decision };
		}

		if (roleBoundEnabled && input.enableAdvisorGate === true) {
			const afterTaskRecord = evaluateAdvisorGate({
				runId: executionBook.run_id,
				promptPack: advisorCheckpointPromptPack({ taskId, stageId: "after_task" }),
				gate: "after_task",
				stageOutput: {
					schema_version: "superpowers.advisor_checkpoint.after_task.v1",
					evidence_paths: spawnOutput.evidence,
					findings: spawnOutput.advisorFindings,
				},
				changedFiles: spawnOutput.changed_files,
				commandsRun: commands.map(command => ({
					command: command.command,
					exit_code: command.exit_code ?? undefined,
					output_excerpt: command.evidence,
				})),
				existingEvidencePaths: new Set(spawnOutput.evidence),
			});
			afterTaskRecord.stage_id = undefined;
			advisorGateRecords.push(afterTaskRecord);
			await writeAdvisorGateRecord({ acceptingDir, record: afterTaskRecord });
		}

		// -- Task review --

		const reviewResult = await deps.reviewTask({
			book: executionBook,
			taskId,
			tddEvidenceMatrix: input.tddEvidenceMatrix,
			skillEvidenceMatrix: input.skillEvidenceMatrix,
			changedFiles: spawnOutput.changed_files,
			advisorFindings: spawnOutput.advisorFindings,
			codebaseMemoryReindex: reindexEvidence,
			commands,
			subagentOutput: spawnOutput,
		});

		taskReviewRecords.push(reviewResult);

		// -- Task review failure path: early return with repair decision --

		if (reviewResult.result === "TASK_FIX_REQUIRED") {
			const decision = deps.createRepairDecision({
				book: executionBook,
				taskReview: reviewResult,
				repairRound: input.repairRound ?? 0,
				maxRepairRounds: input.maxRepairRounds ?? 3,
				acceptingDir,
				repoPath,
				worktreePath: input.worktreePath,
				planPath: executionBook.plan.path,
				planSha256: executionBook.plan.sha256,
			});

			await appendPlanRunEvent({
				acceptingDir,
				event: {
					schema_version: 1,
					run_id: executionBook.run_id,
					state: "task_fix_required",
					type: "task_fix_required",
					task_id: taskId,
					created_at: (now ?? new Date()).toISOString(),
				},
			});

			return { state: "task_fix_required", decision };
		}

		// Task accepted — record output for main acceptance
		taskOutputs.push(buildTaskExecutionOutput(spawnOutput, reviewResult));
	}

	// ---- Phase 1b: Global impact and runtime simulation gates ----

	const changedFiles = taskOutputs.flatMap(output => output.files_changed);
	if (roleBoundEnabled && input.enableAdvisorGate === true) {
		const beforeGlobalRecord = evaluateAdvisorGate({
			runId: executionBook.run_id,
			promptPack: advisorCheckpointPromptPack({ taskId: "GLOBAL", stageId: "before_global_impact" }),
			gate: "before_global_impact",
			stageOutput: {
				findings: taskReviewRecords.flatMap(record =>
					record.must_fix_items.map(item => ({ severity: "must_fix", evidence: item.evidence })),
				),
			},
			changedFiles,
			commandsRun: commands.map(command => ({
				command: command.command,
				exit_code: command.exit_code ?? undefined,
				output_excerpt: command.evidence,
			})),
			existingEvidencePaths: new Set(taskOutputs.flatMap(output => output.evidence_files)),
		});
		beforeGlobalRecord.task_id = undefined;
		beforeGlobalRecord.stage_id = undefined;
		advisorGateRecords.push(beforeGlobalRecord);
		await writeAdvisorGateRecord({ acceptingDir, record: beforeGlobalRecord });
		if (beforeGlobalRecord.status !== "accepted") {
			const decision = deps.createRepairDecision({
				book: executionBook,
				repairRound: input.repairRound ?? 0,
				maxRepairRounds: input.maxRepairRounds ?? 3,
				acceptingDir,
				repoPath,
				worktreePath: input.worktreePath,
				planPath: executionBook.plan.path,
				planSha256: executionBook.plan.sha256,
			});
			return { state: "main_acceptance_fix_required", decision };
		}
	}
	const codebaseMemoryImpact = input.reconEvidence
		? {
				reindex_summary_path: join(acceptingDir, "codebase-memory-reindex-summary.json"),
				trace_paths: input.reconEvidence.task_contexts.flatMap(context => {
					const graphTestFiles = context.graph.nodes
						.map(node => node.file_path)
						.filter((file): file is string => typeof file === "string" && isGraphTestPath(file));
					const symbolTestFiles = context.symbols
						.map(symbol => symbol.file)
						.filter((file): file is string => typeof file === "string" && isGraphTestPath(file));
					const seedTestFiles = context.graph.seed_files.filter(isGraphTestPath);
					const callers = uniqueStrings([...graphTestFiles, ...symbolTestFiles, ...seedTestFiles]);
					const graphTraceNames = context.graph.trace_paths.flatMap(trace => [trace.start, trace.end]);
					const callees = uniqueStrings([...context.patterns, ...graphTraceNames]);
					const graphRisk = context.graph.trace_paths.find(trace => trace.risk)?.risk;
					const risk = context.risks.length > 0 ? ("high" as const) : graphRiskToImpactRisk(graphRisk);
					return context.files.map(file => ({
						changed_file: file,
						callers,
						callees,
						risk,
						evidence_path: input.reconEvidence!.evidencePath,
					}));
				}),
			}
		: {
				trace_paths: [],
				unavailable_reason: input.reindexProvider
					? "Codebase Memory execution recon not provided"
					: "Codebase Memory provider not configured",
			};
	const globalImpact =
		framework && input.enableGlobalImpactGate === true
			? buildGlobalImpactReport({
					runId: executionBook.run_id,
					framework,
					changedFiles,
					testEvidence: commands.map(command => ({
						command: command.command,
						exit_code: command.exit_code ?? undefined,
					})),
					reviewFindings: taskReviewRecords.flatMap(record =>
						record.must_fix_items.map(item => ({
							severity: "must_fix" as const,
							description: item.description,
							evidence: item.evidence,
						})),
					),
					codebaseMemory: codebaseMemoryImpact,
					codebaseMemoryMode: input.superpowersGateMode,
				})
			: undefined;
	const globalImpactPaths = globalImpact
		? await writeGlobalImpactReport({ acceptingDir, report: globalImpact })
		: undefined;

	// If global impact is repair_required or blocked, route through repair decision
	if (globalImpact && (globalImpact.status === "repair_required" || globalImpact.status === "blocked")) {
		const decision = deps.createRepairDecision({
			book: executionBook,
			repairRound: input.repairRound ?? 0,
			maxRepairRounds: input.maxRepairRounds ?? 3,
			acceptingDir,
			repoPath,
			worktreePath: input.worktreePath,
			planPath: executionBook.plan.path,
			planSha256: executionBook.plan.sha256,
		});

		return { state: "main_acceptance_fix_required", decision };
	}

	let runtimePaths: { jsonPath: string; markdownPath: string; cleanupPath: string } | undefined;
	let runtimeReportStatus: "passed" | "repair_required" | "blocked" | undefined;
	if (roleBoundEnabled && input.enableAdvisorGate === true && input.enableRealBusinessSimulationGate === true) {
		const beforeRuntimeRecord = evaluateAdvisorGate({
			runId: executionBook.run_id,
			promptPack: advisorCheckpointPromptPack({ taskId: "GLOBAL", stageId: "before_real_runtime" }),
			gate: "before_real_runtime",
			stageOutput: { evidence_paths: globalImpactPaths?.jsonPath ? [globalImpactPaths.jsonPath] : [] },
			changedFiles,
			commandsRun: commands.map(command => ({
				command: command.command,
				exit_code: command.exit_code ?? undefined,
				output_excerpt: command.evidence,
			})),
			existingEvidencePaths: new Set(globalImpactPaths?.jsonPath ? [globalImpactPaths.jsonPath] : []),
		});
		beforeRuntimeRecord.task_id = undefined;
		beforeRuntimeRecord.stage_id = undefined;
		advisorGateRecords.push(beforeRuntimeRecord);
		await writeAdvisorGateRecord({ acceptingDir, record: beforeRuntimeRecord });
	}
	if (framework && input.enableRealBusinessSimulationGate === true) {
		const runner =
			input.runtimeSimulationRunner ??
			createDefaultRuntimeSimulationRunner({
				cwd: repoPath,
				timeoutMs: input.runtimeCommandTimeoutMs ?? 120000,
			});
		const businessPaths =
			globalImpact?.runtime_business_paths ??
			framework.tasks.flatMap(task => task.business_paths.filter(path => path.runtime_required));
		const environment = buildRuntimeEnvironmentPlan({ runId: executionBook.run_id, repoPath, businessPaths });
		const scenarios = buildBusinessSimulationScenarios({ businessPaths, runtimeScenario: input.runtimeScenario });
		await writeRuntimeScenarioArtifacts({ acceptingDir, environment, scenarios });
		const runtimeReport = await runRealRuntimeSimulation({
			runId: executionBook.run_id,
			environment,
			scenarios,
			runner,
			now,
		});
		runtimeReportStatus = runtimeReport.status;
		runtimePaths = await writeRealRuntimeSimulationArtifacts({ acceptingDir, report: runtimeReport });
	}

	if (roleBoundEnabled && input.enableAdvisorGate === true && input.enableRealBusinessSimulationGate === true) {
		const runtimeEvidence = [
			...(runtimePaths?.jsonPath ? [runtimePaths.jsonPath, "real-runtime-simulation-report.json"] : []),
			...(runtimePaths?.cleanupPath ? [runtimePaths.cleanupPath, "runtime-cleanup-report.md"] : []),
		];
		const beforeFinalRecord = evaluateAdvisorGate({
			runId: executionBook.run_id,
			promptPack: advisorCheckpointPromptPack({ taskId: "GLOBAL", stageId: "before_final_acceptance" }),
			gate: "before_final_acceptance",
			stageOutput: { evidence_paths: runtimeEvidence },
			changedFiles,
			commandsRun: commands.map(command => ({
				command: command.command,
				exit_code: command.exit_code ?? undefined,
				output_excerpt: command.evidence,
			})),
			existingEvidencePaths: new Set(runtimeEvidence),
			todoStageStatus: runtimeReportStatus === "passed" ? "accepted" : "blocked",
		});
		beforeFinalRecord.task_id = undefined;
		beforeFinalRecord.stage_id = undefined;
		advisorGateRecords.push(beforeFinalRecord);
		await writeAdvisorGateRecord({ acceptingDir, record: beforeFinalRecord });
	}

	// ---- Phase 2: Main acceptance review ----

	let todoSnapshot = buildTodoSnapshot(executionBook, "main_acceptance_review_running");
	const roleBoundTodo = await writeCurrentRoleBoundTodoSnapshot("main_acceptance_review_running");
	if (roleBoundTodo) todoSnapshot = roleBoundTodo;

	await appendPlanRunEvent({
		acceptingDir,
		event: {
			schema_version: 1,
			run_id: executionBook.run_id,
			state: "main_acceptance_review_running",
			type: "main_acceptance_pending",
			created_at: (now ?? new Date()).toISOString(),
		},
	});

	// Build the acceptance request and hold a reference so it can be
	// passed to createRepairDecision on the failure branch below.
	const verificationCommands =
		input.verificationCommands ??
		commands.map(command => ({
			command: command.command,
			cwd: repoPath,
			exit_code: command.exit_code ?? 1,
			started_at: (now ?? new Date()).toISOString(),
			completed_at: (now ?? new Date()).toISOString(),
			output_excerpt: command.evidence,
			evidence_file_path: command.evidence,
		}));

	const actualSpecTaskFrameworkSha256 = frameworkPaths?.jsonPath
		? await sha256File(frameworkPaths.jsonPath)
		: undefined;
	const classificationSummary = framework
		? {
				tasks: Object.fromEntries(
					framework.tasks.map(task => {
						const evidencePaths = taskOutputs
							.filter(output => output.task_id === task.id)
							.flatMap(output => output.evidence_files);
						return [
							task.id,
							{
								runtime_surface: task.classification.runtime_surface,
								requires_frontend_design: task.classification.requires_frontend_design,
								requires_security_review: task.classification.requires_security_review,
								requires_payment_review: task.classification.requires_payment_review,
								requires_data_migration_review: task.classification.requires_data_migration_review,
								requires_destructive_operation_review:
									task.classification.requires_destructive_operation_review,
								evidence_paths: evidencePaths,
							},
						];
					}),
				),
				specialized_reviews: framework.tasks.flatMap(task => {
					const evidencePaths = taskOutputs
						.filter(output => output.task_id === task.id)
						.flatMap(output => output.evidence_files);
					const reviews: Array<{ type: string; evidence_paths: string[] }> = [];
					if (task.classification.requires_frontend_design)
						reviews.push({ type: "requires_frontend_design", evidence_paths: evidencePaths });
					if (task.classification.requires_security_review)
						reviews.push({ type: "requires_security_review", evidence_paths: evidencePaths });
					if (task.classification.requires_payment_review)
						reviews.push({ type: "requires_payment_review", evidence_paths: evidencePaths });
					if (task.classification.requires_data_migration_review)
						reviews.push({ type: "requires_data_migration_review", evidence_paths: evidencePaths });
					if (task.classification.requires_destructive_operation_review)
						reviews.push({ type: "requires_destructive_operation_review", evidence_paths: evidencePaths });
					return reviews;
				}),
			}
		: undefined;
	const acceptanceRequest: MainThreadAcceptanceReviewRequest = {
		runId: executionBook.run_id,
		reviewRound: input.repairRound ?? 0,
		repoPath,
		worktreePath: input.worktreePath ?? "",
		planPath: executionBook.plan.path,
		planSha256: executionBook.plan.sha256,
		acceptingDir,
		executionBookPath: join(acceptingDir, "execution-book.json"),
		manifestPath: input.manifestPath ?? "",
		completionDocPath: input.completionDocPath ?? "",
		todoSnapshot,
		executionBook,
		taskOutputs,
		taskReviewRecords,
		verificationCommands,
		finalAcceptanceCommands: executionBook.final_acceptance_commands,
		gitDiffSummary: input.gitDiffSummary,
		codebaseMemory: input.codebaseMemoryReconOptions,
		tddEvidenceMatrix: input.tddEvidenceMatrix,
		skillEvidenceMatrix: input.skillEvidenceMatrix,
		advisorSummary: input.advisorSummary,
		manifestExtensions: {
			codebase_memory: {
				execution_recon: input.reconEvidence?.evidencePath,
				reindex_summary: join(acceptingDir, "codebase-memory-reindex-summary.json"),
				tasks: reindexEvidenceByTask,
			},
			advisor: {
				subagents_enabled: true,
				summary: advisorSummaryPath,
			},
			model_routing: { tasks: modelRoutingTasks },
			superpowers: { codebase_memory_gate_mode: input.superpowersGateMode ?? "off" },
			settings: {
				execution_loop: {
					runtimeScenario: input.runtimeScenario,
					classification: input.classification,
				},
			},
			role_bound_execution:
				framework && frameworkPaths && roleRegistrySnapshot && specTaskFrameworkSha256
					? {
							enabled: true,
							role_registry_snapshot_path: roleRegistrySnapshot.path,
							role_registry_snapshot_sha256: roleRegistrySnapshot.sha256,
							spec_task_framework_path: frameworkPaths.jsonPath,
							spec_task_framework_sha256: specTaskFrameworkSha256,
							actual_spec_task_framework_sha256: actualSpecTaskFrameworkSha256,
							classification_summary: classificationSummary,
							classification_summary_json: classificationSummary
								? JSON.stringify(classificationSummary)
								: undefined,
							stages: roleBoundStages,
						}
					: undefined,
			prompt_packs: {
				generated: promptPackPaths.length > 0,
				prompt_pack_paths: promptPackPaths,
			},
			advisor_gate: input.enableAdvisorGate
				? {
						enabled: true,
						records_path: join(acceptingDir, "tasks"),
						blocking_findings: advisorGateRecords.reduce(
							(count, record) =>
								count + record.findings.filter(finding => finding.severity === "must_fix").length,
							0,
						),
					}
				: undefined,
			global_impact: globalImpact
				? { enabled: true, report_path: globalImpactPaths?.jsonPath, status: globalImpact.status }
				: undefined,
			real_business_simulation: input.enableRealBusinessSimulationGate
				? {
						enabled: true,
						environment_plan_path: join(acceptingDir, "runtime-environment-plan.md"),
						scenario_plan_path: join(acceptingDir, "business-simulation-scenarios.md"),
						report_path: runtimePaths?.jsonPath,
						cleanup_report_path: runtimePaths?.cleanupPath,
						status: runtimeReportStatus,
						runtimeScenario: input.runtimeScenario,
					}
				: undefined,
		},
	};

	const acceptanceResult = await deps.runMainAcceptance(acceptanceRequest);

	// -- Main acceptance failure path --

	if (acceptanceResult.result === "MAIN_ACCEPTANCE_FIX_REQUIRED") {
		const decision = deps.createRepairDecision({
			book: executionBook,
			mainAcceptanceReview: acceptanceResult,
			mainAcceptanceRequest: acceptanceRequest,
			repairRound: input.repairRound ?? 0,
			maxRepairRounds: input.maxRepairRounds ?? 3,
			acceptingDir,
			repoPath,
			worktreePath: input.worktreePath,
			planPath: executionBook.plan.path,
			planSha256: executionBook.plan.sha256,
		});

		await appendPlanRunEvent({
			acceptingDir,
			event: {
				schema_version: 1,
				run_id: executionBook.run_id,
				state: "main_acceptance_fix_required",
				type: "main_acceptance_fix_required",
				created_at: (now ?? new Date()).toISOString(),
			},
		});

		return { state: "main_acceptance_fix_required", decision };
	}

	// ---- Phase 3: Terminal — ready for codex review ----

	await appendPlanRunEvent({
		acceptingDir,
		event: {
			schema_version: 1,
			run_id: executionBook.run_id,
			state: "ready_for_user",
			type: "ready_for_codex_review",
			created_at: (now ?? new Date()).toISOString(),
		},
	});

	// Write codex-review-request.md
	const reviewRequestPath = join(acceptingDir, "codex-review-request.md");
	await mkdir(acceptingDir, { recursive: true });
	await writeFile(
		reviewRequestPath,
		[
			"# Codex Review Request",
			"",
			`Run ID: ${executionBook.run_id}`,
			`Plan: ${executionBook.plan.path}`,
			`Tasks: ${executionBook.tasks.length}`,
			`Status: Ready for Codex Review`,
			"",
		].join("\n"),
		"utf8",
	);

	return {
		state: "ready_for_user",
		specTaskFramework: framework,
		promptPacksByStage: promptPacksByStage,
		roleBoundTodoSnapshots: roleBoundTodoSnapshots.length > 0 ? roleBoundTodoSnapshots : undefined,
		advisorGateRecords,
		globalImpactReportPath: globalImpactPaths?.jsonPath,
		realRuntimeSimulationReportPath: runtimePaths?.jsonPath,
	};
}
