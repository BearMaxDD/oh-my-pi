/**
 * Task 5 — Closure evidence matrix verification.
 *
 * Asserts the closure TRD contains the 100% Evidence Matrix section
 * with all six closure gate labels and no `not_started` status values.
 */
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Path resolution
// ---------------------------------------------------------------------------

/**
 * import.meta.dir is the directory containing this test file:
 *   oh-my-pi-16.2.1/packages/coding-agent/test/codex-plan-run
 *
 * Five levels up reaches the workspace root (Code/super).
 */
const WORKSPACE_ROOT = join(import.meta.dir, "..", "..", "..", "..", "..");

const TRD_PATH = join(
	WORKSPACE_ROOT,
	"docs",
	"superpowers",
	"specs",
	"2026-07-02-plan-run-productized-loop-closure-trd.md",
);

// ---------------------------------------------------------------------------
// Closure gate labels
// ---------------------------------------------------------------------------

const CLOSURE_GATE_LABELS = [
	"CLI bridge runtime",
	"TUI live status",
	"Production E2E",
	"Evidence chain",
	"Blocker search",
	"codebase-memory-mcp",
] as const;

// ---------------------------------------------------------------------------
// Matrix section helper
// ---------------------------------------------------------------------------

/**
 * Read the TRD and return only the §14 Evidence Matrix section slice.
 * Throws a readable assertion error if the heading is missing.
 */
function readEvidenceMatrixSection(): string {
	const trd = readFileSync(TRD_PATH, "utf-8");
	const marker = "## 14. 100% Evidence Matrix";
	const start = trd.indexOf(marker);
	if (start < 0) {
		throw new Error(`TRD is missing the "${marker}" section`);
	}
	return trd.slice(start);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("Closure TRD — 100% Evidence Matrix", () => {
	it("contains the section heading `## 14. 100% Evidence Matrix`", () => {
		expect(readFileSync(TRD_PATH, "utf-8")).toContain("## 14. 100% Evidence Matrix");
	});

	for (const label of CLOSURE_GATE_LABELS) {
		it(`includes closure gate label in §14 matrix: "${label}"`, () => {
			const section = readEvidenceMatrixSection();
			expect(section).toContain(label);
		});
	}

	it("does not contain `not_started` status in the evidence matrix", () => {
		const section = readEvidenceMatrixSection();
		expect(section).not.toContain("not_started");
	});
});
