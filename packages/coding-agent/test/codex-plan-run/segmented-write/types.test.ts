import { describe, expect, it } from "bun:test";
import {
	SEGMENTED_WRITE_STATES,
	type SegmentedWriteState,
	type WriteBlockInfo,
	type WriteManifest,
} from "../../../src/codex-plan-run/segmented-write/types";

describe("SegmentedWriteTypes", () => {
	it("defines states in correct order", () => {
		expect(SEGMENTED_WRITE_STATES).toEqual([
			"INIT",
			"SKELETON_WRITTEN",
			"CHUNKS_IN_PROGRESS",
			"CHUNKS_COMPLETE",
			"SELF_CHECK_COMPLETE",
			"PATCHED_COMPLETE",
		] as const);
	});

	it("defines WriteBlockInfo with required fields", () => {
		const block: WriteBlockInfo = {
			id: "goal",
			title: "Goal",
			status: "pending",
			lineStart: 0,
			lineEnd: 0,
		};
		expect(block.id).toBe("goal");
		expect(block.status).toBe("pending");
	});

	it("defines WriteManifest with all fields", () => {
		const manifest: WriteManifest = {
			planPath: "test.md",
			state: "INIT" as SegmentedWriteState,
			writerRole: "SegmentedPlanWriter",
			sections: [],
			taskIds: [],
			lineCount: 0,
			sha256: "",
			tailMarker: "<!-- segmented-write-complete -->",
			codeFenceBalanced: true,
			timestamps: {
				created: "2026-06-28T10:00:00Z",
			},
		};
		expect(manifest.planPath).toBe("test.md");
		expect(manifest.state).toBe("INIT");
	});
});
