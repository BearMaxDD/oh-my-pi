export const SEGMENTED_WRITE_STATES = [
	"INIT",
	"SKELETON_WRITTEN",
	"CHUNKS_IN_PROGRESS",
	"CHUNKS_COMPLETE",
	"SELF_CHECK_COMPLETE",
	"PATCHED_COMPLETE",
] as const;

export type SegmentedWriteState = (typeof SEGMENTED_WRITE_STATES)[number];

export type WriteBlockStatus = "pending" | "complete" | "corrupted";

export interface WriteBlockInfo {
	id: string;
	title: string;
	status: WriteBlockStatus;
	lineStart: number;
	lineEnd: number;
	sha256?: string;
}

export interface WriteManifest {
	planPath: string;
	state: SegmentedWriteState;
	writerRole: string;
	sections: WriteBlockInfo[];
	taskIds: string[];
	lineCount: number;
	sha256: string;
	tailMarker: string;
	codeFenceBalanced: boolean;
	timestamps: {
		created: string;
		skeletonWritten?: string;
		chunksComplete?: string;
		selfCheckComplete?: string;
		patchedComplete?: string;
	};
	recovery?: {
		resumeCount: number;
		lastRecoveredFrom: string | null;
		corruptedBlocks: string[];
	};
}

export function createInitManifest(planPath: string, writerRole: string): WriteManifest {
	return {
		planPath,
		state: "INIT",
		writerRole,
		sections: [],
		taskIds: [],
		lineCount: 0,
		sha256: "",
		tailMarker: "<!-- segmented-write-complete -->",
		codeFenceBalanced: false,
		timestamps: {
			created: new Date().toISOString(),
		},
	};
}
