import { PLAN_RUN_STATES, type PlanRunGateState, type PlanRunState, type TodoSnapshot } from "./types";

type TodoStatus = TodoSnapshot["phases"][number]["tasks"][number]["status"];
type TodoPhase = TodoSnapshot["phases"][number];

interface CreateTodoSnapshotForStateOptions {
	runId: string;
	version: number;
	state: PlanRunState;
	blockedAt?: PlanRunGateState;
	now?: Date;
}

interface ProtocolTask {
	content: string;
	doneAt: PlanRunState;
}

const PROTOCOL_PHASE_NAME = "Codex Plan Protocol";
const EXECUTION_BOOK_TASKS_PHASE_NAME = "Plan Execution Book Tasks";
const MAIN_ACCEPTANCE_PHASE_NAME = "Main Acceptance";

const PROTOCOL_TASKS: readonly ProtocolTask[] = [
	{
		content: "T01 初始化 worktree 与计划镜像",
		doneAt: "project_recon_done",
	},
	{
		content: "T02 写入 PlanRunManifest",
		doneAt: "project_recon_done",
	},
	{
		content: "T03 注入 omp-executing-codex-plan skill",
		doneAt: "main_plan_ready",
	},
	{
		content: "T04 生成 Plan Execution Book 与 Task Execution Cards",
		doneAt: "execution_book_ready",
	},
	{
		content: "T05 执行实现与验证",
		doneAt: "implementation_verified",
	},
	{
		content: "T06 写入 completion 文档",
		doneAt: "completion_doc_written",
	},
	{
		content: "T07 主线程终审验收",
		doneAt: "main_acceptance_accepted",
	},
	{
		content: "T08 生成 CodexReviewRequestPacket",
		doneAt: "review_packet_validated",
	},
];

const MAIN_ACCEPTANCE_TASKS: readonly ProtocolTask[] = [
	{
		content: "Run main-thread acceptance review",
		doneAt: "main_acceptance_review_running",
	},
	{
		content: "Fix main acceptance findings",
		doneAt: "fix_tasks_running",
	},
	{
		content: "Re-run final acceptance commands",
		doneAt: "main_acceptance_accepted",
	},
	{
		content: "Generate CodexReviewRequestPacket",
		doneAt: "review_packet_validated",
	},
];

const STATE_RANK = new Map<PlanRunState, number>(PLAN_RUN_STATES.map((state, index) => [state, index]));

function isTaskComplete(state: PlanRunState, task: ProtocolTask): boolean {
	const currentRank = STATE_RANK.get(state) ?? -1;
	const doneRank = STATE_RANK.get(task.doneAt) ?? Number.POSITIVE_INFINITY;
	return currentRank >= doneRank;
}

function createTaskStatusForState(state: PlanRunState, blockedAt: PlanRunGateState | undefined): TodoStatus[] {
	let inProgressAssigned = false;
	const blockedRank = blockedAt ? (STATE_RANK.get(blockedAt) ?? -1) : undefined;
	return PROTOCOL_TASKS.map(task => {
		const doneRank = STATE_RANK.get(task.doneAt) ?? Number.POSITIVE_INFINITY;
		if (blockedRank !== undefined) {
			if (doneRank < blockedRank) return "completed";
			if (!inProgressAssigned) {
				inProgressAssigned = true;
				return "in_progress";
			}
			return "pending";
		}
		if (isTaskComplete(state, task)) return "completed";
		if (!inProgressAssigned) {
			inProgressAssigned = true;
			return "in_progress";
		}
		return "pending";
	});
}

function createMainAcceptanceStatuses(state: PlanRunState): TodoStatus[] {
	switch (state) {
		case "main_acceptance_review_running":
			return ["in_progress", "pending", "pending", "pending"];
		case "main_acceptance_fix_required":
		case "fix_tasks_running":
			return ["completed", "in_progress", "pending", "pending"];
		case "main_acceptance_accepted":
			return ["completed", "completed", "completed", "pending"];
		case "review_packet_validated":
		case "ready_for_user":
			return ["completed", "completed", "completed", "completed"];
		default:
			return ["pending", "pending", "pending", "pending"];
	}
}

export function createTodoSnapshotForState({
	runId,
	version,
	state,
	blockedAt,
	now = new Date(),
}: CreateTodoSnapshotForStateOptions): TodoSnapshot {
	const statuses = createTaskStatusForState(state, blockedAt);
	const tasks = PROTOCOL_TASKS.map((task, index) => {
		return {
			content: task.content,
			status: statuses[index] ?? "pending",
		};
	});
	const phases: TodoPhase[] = [
		{
			name: PROTOCOL_PHASE_NAME,
			tasks,
		},
	];
	if (
		state === "main_acceptance_review_running" ||
		state === "main_acceptance_fix_required" ||
		state === "fix_tasks_running" ||
		state === "main_acceptance_accepted" ||
		state === "review_packet_validated" ||
		state === "ready_for_user"
	) {
		const mainStatuses = createMainAcceptanceStatuses(state);
		phases.push({
			name: MAIN_ACCEPTANCE_PHASE_NAME,
			tasks: MAIN_ACCEPTANCE_TASKS.map((task, index) => ({
				content: task.content,
				status: mainStatuses[index] ?? "pending",
			})),
		});
	}

	return {
		runId,
		version,
		state,
		phases,
		updatedAt: now.toISOString(),
		source: "state-machine",
	};
}

export interface ExecutionBookTodoTask {
	id: string;
	title: string;
	modelAssignment?: TodoSnapshot["phases"][number]["tasks"][number]["modelAssignment"];
}

export interface CreateTodoSnapshotForExecutionBookOptions {
	runId?: string;
	version?: number;
	state?: PlanRunState;
	tasks?: readonly ExecutionBookTodoTask[];
	book?: { run_id: string; tasks: readonly ExecutionBookTodoTask[] };
	acceptedTaskIds?: ReadonlySet<string>;
	fixRequiredTaskIds?: ReadonlySet<string>;
	taskStatuses?: Record<string, string>;
	now?: Date;
}

export function createTodoSnapshotForExecutionBook(options: CreateTodoSnapshotForExecutionBookOptions): TodoSnapshot {
	const runId = options.runId ?? options.book?.run_id;
	if (!runId) throw new Error("createTodoSnapshotForExecutionBook requires runId");
	const version = options.version ?? 1;
	const state = options.state ?? "tasks_running";
	const tasks = options.tasks ?? options.book?.tasks ?? [];
	const acceptedTaskIds = options.acceptedTaskIds ?? new Set();
	const fixRequiredTaskIds = options.fixRequiredTaskIds ?? new Set();
	const now = options.now ?? new Date();
	const base = createTodoSnapshotForState({ runId, version, state, now });
	const executionTasks: TodoSnapshot["tasks"] = tasks.map(task => {
		const explicitStatus = options.taskStatuses?.[task.id];
		const blocked = explicitStatus?.startsWith("blocked_") === true;
		const status: TodoStatus = blocked
			? "blocked"
			: acceptedTaskIds.has(task.id)
				? "completed"
				: fixRequiredTaskIds.has(task.id)
					? "in_progress"
					: "pending";
		return {
			id: task.id,
			content: `${task.id} ${task.title}`,
			status,
			...(blocked && explicitStatus ? { blockers: [explicitStatus] } : {}),
			...(task.modelAssignment ? { modelAssignment: task.modelAssignment } : {}),
		};
	});
	return {
		...base,
		tasks: executionTasks,
		phases: [
			...base.phases,
			{
				name: EXECUTION_BOOK_TASKS_PHASE_NAME,
				tasks: executionTasks,
			},
		],
	};
}

export function countPendingRequiredTasks(phases: readonly TodoPhase[]): number {
	return phases.reduce(
		(count, phase) =>
			count +
			phase.tasks.filter(
				task => task.status === "pending" || task.status === "in_progress" || task.status === "blocked",
			).length,
		0,
	);
}
