/**
 * PlanRun status sink — reads runtime artifacts from disk and writes
 * PlanRunSessionSnapshot updates to the agent session for TUI display.
 */

import type { GateFailureSummary } from "./gate-failure-summary";
import type { RealRuntimeSimulationReport } from "./real-runtime-simulation";
import type { PlanRunSessionSnapshot, TodoSnapshot } from "./types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PlanRunStatusUpdate {
	todoSnapshot?: TodoSnapshot;
	gateFailureSummaryPath?: string;
	runtimeSimulationReportPath?: string;
}

export interface CreatePlanRunStatusSinkOptions {
	readText: (path: string) => Promise<string>;
	writeSnapshot: (snapshot: PlanRunSessionSnapshot) => void;
	now?: () => Date;
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createPlanRunStatusSink(options: CreatePlanRunStatusSinkOptions): {
	update(update: PlanRunStatusUpdate): Promise<void>;
} {
	const { readText, writeSnapshot } = options;
	const nowFn = options.now ?? (() => new Date());

	async function readAndParse<T>(path: string, label: string, degradedReasons: string[]): Promise<T | undefined> {
		try {
			const raw = await readText(path);
			return JSON.parse(raw) as T;
		} catch (error) {
			const detail = error instanceof Error ? error.message : String(error);
			degradedReasons.push(`Failed to read or parse ${label} at ${path}: ${detail}`);
			return undefined;
		}
	}

	return {
		async update(update: PlanRunStatusUpdate): Promise<void> {
			const degradedReasons: string[] = [];

			const gateSummary = update.gateFailureSummaryPath
				? await readAndParse<GateFailureSummary>(
						update.gateFailureSummaryPath,
						"gate-failure-summary",
						degradedReasons,
					)
				: undefined;

			const runtimeReport = update.runtimeSimulationReportPath
				? await readAndParse<RealRuntimeSimulationReport>(
						update.runtimeSimulationReportPath,
						"runtime-simulation-report",
						degradedReasons,
					)
				: undefined;

			const hasDegraded = degradedReasons.length > 0;

			const snapshot: PlanRunSessionSnapshot = {
				todoSnapshot: update.todoSnapshot,
				panel: {
					todoSnapshot: update.todoSnapshot,
					gateSummary,
					runtimeReport,
					degradedReasons: hasDegraded ? [...degradedReasons] : undefined,
				},
				updatedAt: nowFn().toISOString(),
				degradedReasons: hasDegraded ? [...degradedReasons] : undefined,
			};

			writeSnapshot(snapshot);
		},
	};
}

// ---------------------------------------------------------------------------
// Session-scoped helper
// ---------------------------------------------------------------------------

export interface PlanRunSnapshotSessionTarget {
	setPlanRunSnapshot(snapshot: PlanRunSessionSnapshot): void;
}

export interface CreatePlanRunSessionStatusSinkOptions {
	readText: (path: string) => Promise<string>;
	session: PlanRunSnapshotSessionTarget;
	now?: () => Date;
}

export function createPlanRunSessionStatusSink(options: CreatePlanRunSessionStatusSinkOptions): {
	update(update: PlanRunStatusUpdate): Promise<void>;
} {
	return createPlanRunStatusSink({
		readText: options.readText,
		writeSnapshot: options.session.setPlanRunSnapshot.bind(options.session),
		now: options.now,
	});
}
