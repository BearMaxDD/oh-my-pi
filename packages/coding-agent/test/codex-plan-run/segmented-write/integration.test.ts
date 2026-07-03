import { afterAll, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	shouldUseSegmentedWrite,
	splitAtFenceBalancedBoundaries,
	writeSegmentedMarkdownIfNeeded,
} from "../../../src/codex-plan-run/segmented-write/integration";
import { manifestPathFor, readWriteManifest } from "../../../src/codex-plan-run/segmented-write/manifest";

// ---------------------------------------------------------------------------
// RED_EVIDENCE — must-resolve paths that should fail / return false / short-circuit
// ---------------------------------------------------------------------------

describe("shouldUseSegmentedWrite — RED_EVIDENCE", () => {
	it("returns false for short content regardless of eligible path", () => {
		expect(shouldUseSegmentedWrite("/docs/superpowers/plans/plan.md", 10, 200)).toBe(false);
	});

	it("returns false when path does not end with .md", () => {
		expect(shouldUseSegmentedWrite("/docs/superpowers/plans/plan.txt", 300, 200)).toBe(false);
	});

	it("returns false for long .md outside eligible paths", () => {
		expect(shouldUseSegmentedWrite("/tmp/random.md", 300, 200)).toBe(false);
	});

	it("returns true when lineCount equals minChunkLines (>= threshold)", () => {
		expect(shouldUseSegmentedWrite("/docs/superpowers/plans/plan.md", 200, 200)).toBe(true);
	});

	it("returns false for negative or zero line count", () => {
		expect(shouldUseSegmentedWrite("/docs/superpowers/plans/plan.md", 0, 200)).toBe(false);
		expect(shouldUseSegmentedWrite("/docs/superpowers/plans/plan.md", -1, 200)).toBe(false);
	});
});

describe("writeSegmentedMarkdownIfNeeded — RED_EVIDENCE", () => {
	const cleanups: string[] = [];

	afterAll(() => {
		for (const d of cleanups) {
			rmSync(d, { recursive: true, force: true });
		}
	});

	it("short content returns direct and does not create manifest", async () => {
		const dir = mkdtempSync(join(tmpdir(), "segwrite-red-"));
		cleanups.push(dir);
		const path = join(dir, "plan-execution-book.md");
		const content = "# Short\n\nJust a few lines to test direct path.";

		const result = await writeSegmentedMarkdownIfNeeded(path, content, {
			minChunkLines: 200,
		});

		expect(result).toBe("direct");
		expect(existsSync(path)).toBe(true);
		expect(readFileSync(path, "utf8")).toContain("# Short");

		const mPath = manifestPathFor(path);
		expect(existsSync(mPath)).toBe(false);
	});

	it("short content in non-eligible path returns direct", async () => {
		const dir = mkdtempSync(join(tmpdir(), "segwrite-red2-"));
		cleanups.push(dir);
		const path = join(dir, "notes.md");
		const content = "# A\n\nB\n".repeat(300); // 600+ lines but non-eligible path

		const result = await writeSegmentedMarkdownIfNeeded(path, content, {
			minChunkLines: 200,
		});

		expect(result).toBe("direct");
		const mPath = manifestPathFor(path);
		expect(existsSync(mPath)).toBe(false);
	});
});

// ---------------------------------------------------------------------------
// GREEN_EVIDENCE — happy paths that exercise every code path
// ---------------------------------------------------------------------------

describe("shouldUseSegmentedWrite — GREEN_EVIDENCE", () => {
	it("returns true for eligible path with long content", () => {
		expect(shouldUseSegmentedWrite("/docs/superpowers/plans/plan-execution-book.md", 300, 200)).toBe(true);
	});

	it("returns true for bare plan-execution-book.md filename", () => {
		expect(shouldUseSegmentedWrite("/any/path/plan-execution-book.md", 300, 200)).toBe(true);
	});
});

describe("splitAtFenceBalancedBoundaries — GREEN_EVIDENCE", () => {
	it("splits long content at fence-balanced boundaries", () => {
		const lines: string[] = [];
		for (let i = 0; i < 500; i++) lines.push(`Line ${i}`);
		const chunks = splitAtFenceBalancedBoundaries(lines, 200);
		expect(chunks.length).toBe(2);
		expect(chunks[0].split("\n").length).toBeGreaterThanOrEqual(200);
	});

	it("preserves balanced fenced code blocks across chunk boundary", () => {
		const lines: string[] = [];
		for (let i = 0; i < 100; i++) lines.push(`Before ${i}`);
		lines.push("```typescript");
		for (let i = 0; i < 250; i++) lines.push(`const x${i} = ${i};`);
		lines.push("```");
		for (let i = 0; i < 100; i++) lines.push(`After ${i}`);

		const chunks = splitAtFenceBalancedBoundaries(lines, 200);
		// The fenced block should not be split — the cut delayed past the closing fence
		expect(chunks.length).toBeGreaterThanOrEqual(1);
		for (const chunk of chunks) {
			const opening = (chunk.match(/```/g) || []).length;
			expect(opening % 2 === 0).toBe(true);
		}
	});

	it("returns a single chunk when content fits within minChunkLines", () => {
		const lines: string[] = [];
		for (let i = 0; i < 50; i++) lines.push(`Line ${i}`);
		const chunks = splitAtFenceBalancedBoundaries(lines, 200);
		expect(chunks.length).toBe(1);
	});

	it("handles content where trailing chunk is smaller than threshold", () => {
		const lines: string[] = [];
		for (let i = 0; i < 400; i++) lines.push(`Line ${i}`);
		// Add just a few lines at the end
		for (let i = 0; i < 10; i++) lines.push(`Trailer ${i}`);
		const chunks = splitAtFenceBalancedBoundaries(lines, 200);
		// Should be exactly 2 chunks: first 200+ lines and the remaining 210
		expect(chunks.length).toBe(2);
	});

	it("returns empty array for empty input", () => {
		const chunks = splitAtFenceBalancedBoundaries([], 200);
		expect(chunks).toEqual([]);
	});
});

describe("writeSegmentedMarkdownIfNeeded — GREEN_EVIDENCE", () => {
	const cleanups: string[] = [];

	afterAll(() => {
		for (const d of cleanups) {
			rmSync(d, { recursive: true, force: true });
		}
	});

	it("long plan-execution-book.md returns segmented, creates manifest, CHUNKS_COMPLETE, lineCount > 200", async () => {
		const dir = mkdtempSync(join(tmpdir(), "segwrite-green-"));
		cleanups.push(dir);
		const path = join(dir, "plan-execution-book.md");

		// Generate long content (> 200 lines)
		const parts: string[] = ["# Execution Book", "", "## Task 1", ""];
		for (let i = 0; i < 250; i++) {
			parts.push(`Step ${i}: do something interesting with enough text to make this realistic.`);
		}
		const content = parts.join("\n");

		const result = await writeSegmentedMarkdownIfNeeded(path, content, {
			minChunkLines: 200,
			writerRole: "TestWriter",
		});

		expect(result).toBe("segmented");
		expect(existsSync(path)).toBe(true);

		// Manifest present and has correct state
		const mPath = manifestPathFor(path);
		expect(existsSync(mPath)).toBe(true);
		const manifest = await readWriteManifest(mPath);
		expect(manifest.state).toBe("CHUNKS_COMPLETE");
		expect(manifest.lineCount).toBeGreaterThan(200);
		expect(manifest.writerRole).toBe("TestWriter");

		// Final content has tail marker
		const finalContent = readFileSync(path, "utf8");
		expect(finalContent).toContain("<!-- segmented-write-complete -->");
	});

	it("long plan-execution-book.md with multiple chunks preserves full content", async () => {
		const dir = mkdtempSync(join(tmpdir(), "segwrite-green2-"));
		cleanups.push(dir);
		const path = join(dir, "plan-execution-book.md");

		// Enough lines for multiple chunks (600 lines, threshold 200)
		const parts: string[] = ["# Plan Book", ""];
		for (let i = 0; i < 600; i++) {
			parts.push(`Item ${i}: some detail to fill the page with content.`);
		}
		const content = parts.join("\n");

		const result = await writeSegmentedMarkdownIfNeeded(path, content, {
			minChunkLines: 200,
			writerRole: "MultiChunkTest",
		});

		expect(result).toBe("segmented");

		// Content preserved
		const finalContent = readFileSync(path, "utf8");
		expect(finalContent).toContain("# Plan Book");
		expect(finalContent).toContain("Item 599:");
		expect(finalContent).toContain("<!-- segmented-write-complete -->");
	});
});

// ---------------------------------------------------------------------------
// REGRESSION_EVIDENCE — edge cases, boundary conditions, fenced code blocks
// ---------------------------------------------------------------------------

describe("splitAtFenceBalancedBoundaries — REGRESSION_EVIDENCE", () => {
	it("preserves fenced code blocks without splitting inside them", () => {
		// Build content where a large code block sits right at the threshold boundary
		const lines: string[] = [];

		// Add lines before the fence to push the fence past the threshold
		for (let i = 0; i < 150; i++) lines.push(`Before fence ${i}`);
		lines.push("```");
		for (let i = 0; i < 100; i++) lines.push(`Inside fence ${i}`);
		lines.push("```");
		for (let i = 0; i < 50; i++) lines.push(`After fence ${i}`);

		const chunks = splitAtFenceBalancedBoundaries(lines, 200);
		// The fence should not be cut mid-way; each chunk should have balanced fences
		for (const c of chunks) {
			const opens = (c.match(/```/g) || []).length;
			expect(opens % 2 === 0).toBe(true);
		}
	});

	it("handles multiple fences across chunk boundaries", () => {
		const lines: string[] = [];
		for (let i = 0; i < 100; i++) lines.push(`A${i}`);
		lines.push("```");
		for (let i = 0; i < 100; i++) lines.push(`B${i}`);
		lines.push("```");
		for (let i = 0; i < 100; i++) lines.push(`C${i}`);
		lines.push("```");
		for (let i = 0; i < 100; i++) lines.push(`D${i}`);
		lines.push("```");
		for (let i = 0; i < 100; i++) lines.push(`E${i}`);

		const chunks = splitAtFenceBalancedBoundaries(lines, 200);
		for (const c of chunks) {
			const opens = (c.match(/```/g) || []).length;
			expect(opens % 2 === 0).toBe(true);
		}
	});

	it("handles completely empty lines gracefully", () => {
		const lines = new Array(500).fill("");
		const chunks = splitAtFenceBalancedBoundaries(lines, 200);
		// All-empty lines should still produce balanced chunks
		expect(chunks.length).toBeGreaterThanOrEqual(2);
	});
});

describe("writeSegmentedMarkdownIfNeeded — REGRESSION_EVIDENCE", () => {
	const cleanups: string[] = [];

	afterAll(() => {
		for (const d of cleanups) {
			rmSync(d, { recursive: true, force: true });
		}
	});

	it("handles long markdown with fenced code block spanning chunk threshold without throwing", async () => {
		const dir = mkdtempSync(join(tmpdir(), "segwrite-reg-"));
		cleanups.push(dir);
		const path = join(dir, "plan-execution-book.md");

		// Build content where a fenced code block sits at the chunk threshold.
		// The fence must not be split — the algorithm should delay the cut until
		// after the closing fence.
		const lines: string[] = [];
		for (let i = 0; i < 50; i++) lines.push(`Intro paragraph ${i}.`);

		lines.push("```typescript");
		// Large code block well past the 200-line threshold
		for (let i = 0; i < 200; i++) {
			lines.push(`const x${i} = ${i}; // Code content that spans the chunk boundary`);
		}
		lines.push("```");

		for (let i = 0; i < 200; i++) lines.push(`After fence paragraph ${i}.`);

		const content = lines.join("\n");

		// Should not throw despite the fence spanning the cut threshold
		let result: "direct" | "segmented" = "direct";
		try {
			result = await writeSegmentedMarkdownIfNeeded(path, content, {
				minChunkLines: 200,
				writerRole: "TestWriter",
			});
		} catch (e) {
			throw new Error(
				`writeSegmentedMarkdownIfNeeded should not throw when fence spans chunk threshold, but got: ${e}`,
			);
		}

		expect(result).toBe("segmented");

		// Content should still contain the fenced code block
		const finalContent = readFileSync(path, "utf8");
		expect(finalContent).toContain("```typescript");
		expect(finalContent).toContain("const x0 = 0;");
		expect(finalContent).toContain("```");
		expect(finalContent).toContain("After fence paragraph 199.");
		expect(finalContent).toContain("<!-- segmented-write-complete -->");

		// Overall line count preserved (plus tail marker lines)
		const finalLines = finalContent.split("\n");
		expect(finalLines.length).toBeGreaterThanOrEqual(452);
	});

	it("writes directly to non-eligible path even with long content", async () => {
		const dir = mkdtempSync(join(tmpdir(), "segwrite-reg2-"));
		cleanups.push(dir);
		const path = join(dir, "random.md");
		const content = "x\n".repeat(500).trim();

		const result = await writeSegmentedMarkdownIfNeeded(path, content, {
			minChunkLines: 200,
		});

		expect(result).toBe("direct");
		expect(existsSync(path)).toBe(true);

		// No manifest for direct writes
		const mPath = manifestPathFor(path);
		expect(existsSync(mPath)).toBe(false);
	});

	it("does not throw when content with fenced code block is shorter than threshold (falls to direct)", async () => {
		const dir = mkdtempSync(join(tmpdir(), "segwrite-reg3-"));
		cleanups.push(dir);
		const path = join(dir, "plan-execution-book.md");

		// Short content with a fence
		const content = ["# Short", "", "```js", "const a = 1;", "```", "", "Done."].join("\n");

		const result = await writeSegmentedMarkdownIfNeeded(path, content, {
			minChunkLines: 200,
		});

		expect(result).toBe("direct");
		const finalContent = readFileSync(path, "utf8");
		expect(finalContent).toContain("```js");
		expect(finalContent).toContain("const a = 1;");
	});
});
