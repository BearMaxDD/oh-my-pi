import type { PlanExecutionBook } from "./execution-book";
import type { PromptPack } from "./prompt-pack";

export interface StageOutputRef {
	taskId: string;
	stageId: string;
	outputPath: string;
}

export interface RoleBoundStageRunInput {
	book: PlanExecutionBook;
	acceptingDir: string;
	taskId: string;
	stageId: string;
	promptPack: PromptPack;
	modelRole: string;
	previousStageOutputs: StageOutputRef[];
}

export interface BuildRoleBoundStageRunInputsOptions {
	book: PlanExecutionBook;
	acceptingDir: string;
	taskId: string;
	promptPacks: readonly PromptPack[];
	previousStageOutputs: readonly StageOutputRef[];
}

const STAGE_ORDER = [
	"tdd-writer",
	"implementer",
	"test-runner",
	"spec-reviewer",
	"quality-reviewer",
	"acceptance",
] as const;

function orderIndex(stageId: string): number {
	const index = STAGE_ORDER.indexOf(stageId as (typeof STAGE_ORDER)[number]);
	return index === -1 ? STAGE_ORDER.length : index;
}

export function buildRoleBoundStageRunInputs(options: BuildRoleBoundStageRunInputsOptions): RoleBoundStageRunInput[] {
	return [...options.promptPacks]
		.filter(pack => pack.task_id === options.taskId)
		.sort((left, right) => orderIndex(left.stage_id) - orderIndex(right.stage_id))
		.map(pack => ({
			book: options.book,
			acceptingDir: options.acceptingDir,
			taskId: options.taskId,
			stageId: pack.stage_id,
			promptPack: pack,
			modelRole: pack.role_id,
			previousStageOutputs: [...options.previousStageOutputs],
		}));
}
