export {
	checkFenceBalance,
	checkHeadingPresence,
	checkNoPlaceholders,
	checkTaskNumbering,
	type FullSelfCheckResult,
	runAllChecks,
	type SelfCheckResult,
	type SelfCheckViolation,
} from "./checker";
export {
	type SegmentedWriteOptions,
	shouldUseSegmentedWrite,
	splitAtFenceBalancedBoundaries,
	writeSegmentedMarkdownIfNeeded,
} from "./integration";
export {
	manifestPathFor,
	readWriteManifest,
	updateWriteManifestState,
	validateWriteManifest,
	writeWriteManifest,
} from "./manifest";
export {
	createInitManifest,
	SEGMENTED_WRITE_STATES,
	type SegmentedWriteState,
	type WriteBlockInfo,
	type WriteBlockStatus,
	type WriteManifest,
} from "./types";
export { type AppendBlockInput, SegmentedPlanWriter } from "./writer";
