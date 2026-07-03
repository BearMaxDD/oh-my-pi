/**
 * Pure PlanRun entry point — reads an execution book JSON from disk and
 * delegates to launchPlanRunDriver with injected settings/deps/runDriver.
 *
 * Designed for both CLI usage and programmatic integration:
 * - `readPlanExecutionBook` validates the JSON schema and loads PlanExecutionBook.
 * - `runPlanRunEntry` constructs the launcher input from the parsed book and
 *   injected dependencies, then calls launchPlanRunDriver.
 */

import { readFile } from "node:fs/promises";
import type { PlanRunDriverDeps, PlanRunDriverInput, PlanRunDriverResult } from "./driver";
import { launchPlanRunDriver } from "./driver-launcher";
import type { PlanExecutionBook } from "./execution-book";
import type { ExecutionLoopSettingsReader } from "./execution-loop-settings";
import type { PlanRunStatusUpdate } from "./plan-run-status-sink";

// ---------------------------------------------------------------------------
// Re-exported types (convenience aliases)
// ---------------------------------------------------------------------------

export type PlanRunEntrySettingsReader = ExecutionLoopSettingsReader;

// ---------------------------------------------------------------------------
// Input
// ---------------------------------------------------------------------------

export interface PlanRunEntryInput {
	/** Path to the execution book JSON file on disk. */
	bookPath: string;
	/** Absolute path to the accepting directory for runtime artifacts. */
	acceptingDir: string;
	/** Absolute path to the repository root. */
	repoPath: string;
	/** Human-friendly project label (e.g. "oh-my-pi"). */
	project: string;
	/** Settings reader matching ExecutionLoopSettingsReader interface. */
	settings: ExecutionLoopSettingsReader;
	/** Driver dependencies (spawnTask, reviewTask, runMainAcceptance, createRepairDecision, spawnStage). */
	deps: PlanRunDriverDeps;
	/** Optional injected run driver (defaults to runPlanRunDriver from "./driver"). */
	runDriver?: (input: PlanRunDriverInput, deps: PlanRunDriverDeps) => Promise<PlanRunDriverResult>;
	/** Optional overrides for driver input fields. */
	overrides?: Partial<Pick<PlanRunDriverInput, "runtimeCommandTimeoutMs">>;
	/** Optional status sink for publishing PlanRun session snapshot updates. */
	statusSink?: { update(update: PlanRunStatusUpdate): void | Promise<void> };
}

// ---------------------------------------------------------------------------
// Execution book reader
// ---------------------------------------------------------------------------

/**
 * Read and validate an execution book JSON file.
 *
 * Validates:
 * - Parses as valid JSON
 * - `schema_version` is exactly 1
 * - `run_id` is a non-empty string
 */
export async function readPlanExecutionBook(path: string): Promise<PlanExecutionBook> {
	const raw = await readFile(path, "utf8");
	const book: PlanExecutionBook = JSON.parse(raw);
	if (book.schema_version !== 1) {
		throw new Error(`Unsupported schema_version: ${book.schema_version} (expected 1)`);
	}
	if (!book.run_id || book.run_id.trim().length === 0) {
		throw new Error("run_id must be a non-empty string in the execution book");
	}
	return book;
}

// ---------------------------------------------------------------------------
// Entry runner
// ---------------------------------------------------------------------------

/**
 * Read the execution book from disk and launch the PlanRun driver.
 *
 * Orchestrates:
 * 1. Read & validate the execution book JSON via `readPlanExecutionBook`.
 * 2. Call `launchPlanRunDriver` with the parsed book + injected inputs.
 *
 * Returns the driver result (final state, optional decision, etc.).
 */
export async function runPlanRunEntry(input: PlanRunEntryInput): Promise<PlanRunDriverResult> {
	const { bookPath, acceptingDir, repoPath, project, settings, deps, runDriver, overrides, statusSink } = input;
	const executionBook = await readPlanExecutionBook(bookPath);
	const result = await launchPlanRunDriver({
		acceptingDir,
		executionBook,
		repoPath,
		project,
		settings,
		deps,
		overrides,
		runDriver,
	});

	if (statusSink) {
		await statusSink.update({
			todoSnapshot: result.roleBoundTodoSnapshots?.at(-1),
			gateFailureSummaryPath: result.decision ? `${acceptingDir}/gate-failure-summary.json` : undefined,
			runtimeSimulationReportPath: result.realRuntimeSimulationReportPath,
		});
	}

	return result;
}
