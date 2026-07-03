import { describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	manifestPathFor,
	readWriteManifest,
	writeWriteManifest,
} from "../../../src/codex-plan-run/segmented-write/manifest";
import { createInitManifest } from "../../../src/codex-plan-run/segmented-write/types";
import { SegmentedPlanWriter } from "../../../src/codex-plan-run/segmented-write/writer";

describe("SegmentedPlanWriter recovery", () => {
	const SKELETON = "# Test Plan\n\nGoal: test\n\n## 任务\n\n- Task 1\n\n";

	// --- Test 1: getCompletedBlockIds after manifest load ---
	it("getCompletedBlockIds returns complete block IDs from loaded manifest", async () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "recovery-test-1-"));
		try {
			const planPath = join(tmpDir, "plan.md");

			// Create progress: write skeleton + append block + finalize
			const writer = new SegmentedPlanWriter(planPath, "TestWriter");
			await writer.writeSkeleton(SKELETON);
			await writer.appendBlock({
				id: "section-1",
				title: "### Section 1",
				content: "\n### Section 1\n\nContent here\n\n",
			});
			await writer.appendBlock({
				id: "section-2",
				title: "### Section 2",
				content: "\n### Section 2\n\nMore content\n\n",
			});

			// New writer loads existing manifest
			const recoveryWriter = new SegmentedPlanWriter(planPath, "TestWriter");
			const loaded = await recoveryWriter.loadExistingManifest();

			// Then
			expect(loaded).toBe(true);
			const completeIds = recoveryWriter.getCompletedBlockIds();
			expect(completeIds).toContain("section-1");
			expect(completeIds).toContain("section-2");
			expect(completeIds.length).toBe(2);
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	// --- Test 2: reconstructFromFile when manifest is missing ---
	it("reconstructFromFile creates manifest from plan file when sidecar missing", async () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "recovery-test-2-"));
		try {
			const planPath = join(tmpDir, "plan.md");
			const manifestPath = manifestPathFor(planPath);

			// Create a plan file with headings (no manifest written)
			const planContent = [
				"# My Plan",
				"",
				"Intro paragraph here.",
				"",
				"## Section A",
				"Content for section A goes here.",
				"",
				"### Task 1",
				"Details for task one.",
				"",
				"## Section B",
				"Content for section B.",
				"",
			].join("\n");
			writeFileSync(planPath, planContent, "utf8");

			// Act
			const writer = new SegmentedPlanWriter(planPath, "TestWriter");
			const result = await writer.reconstructFromFile();

			// Then
			expect(result).toBe(true);
			expect(existsSync(manifestPath)).toBe(true);
			const manifest = await readWriteManifest(manifestPath);
			expect(manifest.state).toBe("CHUNKS_IN_PROGRESS");
			expect(manifest.lineCount).toBeGreaterThan(0);
			expect(manifest.sha256).toBeTruthy();
			expect(manifest.sections.length).toBeGreaterThan(0);

			// All sections should be pending
			for (const section of manifest.sections) {
				expect(section.status).toBe("pending");
			}
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	// --- Test 3: verifyFileIntegrity detects tampered files ---
	it("verifyFileIntegrity returns false when file is tampered", async () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "recovery-test-3-"));
		try {
			const planPath = join(tmpDir, "plan.md");

			// Create and write skeleton normally
			const writer = new SegmentedPlanWriter(planPath, "TestWriter");
			await writer.writeSkeleton(SKELETON);

			// Verify before tampering
			const validBefore = await writer.verifyFileIntegrity();
			expect(validBefore).toBe(true);

			// Tamper the file
			writeFileSync(planPath, "# TAMPERED PLAN FILE\n", "utf8");

			// Verify after tampering
			const validAfter = await writer.verifyFileIntegrity();
			expect(validAfter).toBe(false);
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	// --- Test 4: getIncompleteBlocks returns only non-complete ---
	it("getIncompleteBlocks returns only pending and corrupted sections", async () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "recovery-test-4-"));
		try {
			const planPath = join(tmpDir, "plan.md");

			// Create manifest with explicit mixture of statuses
			const manifest = createInitManifest(planPath, "TestWriter");
			manifest.sections = [
				{
					id: "complete-1",
					title: "### Complete 1",
					status: "complete",
					lineStart: 1,
					lineEnd: 10,
					sha256: "abc123",
				},
				{ id: "pending-1", title: "### Pending 1", status: "pending", lineStart: 11, lineEnd: 20 },
				{ id: "corrupted-1", title: "### Corrupted 1", status: "corrupted", lineStart: 21, lineEnd: 30 },
				{
					id: "complete-2",
					title: "### Complete 2",
					status: "complete",
					lineStart: 31,
					lineEnd: 40,
					sha256: "def456",
				},
				{ id: "pending-2", title: "### Pending 2", status: "pending", lineStart: 41, lineEnd: 50 },
			];
			manifest.state = "CHUNKS_IN_PROGRESS";
			manifest.lineCount = 50;
			manifest.sha256 = "test-sha";
			await writeWriteManifest(manifest);

			// Act
			const writer = new SegmentedPlanWriter(planPath, "TestWriter");
			await writer.loadExistingManifest();
			const incomplete = writer.getIncompleteBlocks();

			// Then
			expect(incomplete.length).toBe(3);
			const ids = incomplete.map(b => b.id);
			expect(ids).toContain("pending-1");
			expect(ids).toContain("corrupted-1");
			expect(ids).toContain("pending-2");
			expect(ids).not.toContain("complete-1");
			expect(ids).not.toContain("complete-2");

			for (const block of incomplete) {
				expect(block.status).not.toBe("complete");
			}
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	// --- Test 5: getResumeAdvice ---
	it("getResumeAdvice returns correct counts and next block id", async () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "recovery-test-5-"));
		try {
			const planPath = join(tmpDir, "plan.md");

			// Mix of complete and pending
			const manifest = createInitManifest(planPath, "TestWriter");
			manifest.sections = [
				{ id: "done-1", title: "### Done 1", status: "complete", lineStart: 1, lineEnd: 10 },
				{ id: "pending-1", title: "### Pending 1", status: "pending", lineStart: 11, lineEnd: 20 },
				{ id: "pending-2", title: "### Pending 2", status: "pending", lineStart: 21, lineEnd: 30 },
			];
			manifest.state = "CHUNKS_IN_PROGRESS";
			manifest.lineCount = 30;
			manifest.sha256 = "test-sha";
			await writeWriteManifest(manifest);

			// Act
			const writer = new SegmentedPlanWriter(planPath, "TestWriter");
			await writer.loadExistingManifest();
			const advice = writer.getResumeAdvice();

			// Then
			expect(advice.completedCount).toBe(1);
			expect(advice.totalCount).toBe(3);
			expect(advice.nextBlockId).toBe("pending-1");
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	it("getResumeAdvice returns null nextBlockId when all complete", async () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "recovery-test-6-"));
		try {
			const planPath = join(tmpDir, "plan.md");

			const manifest = createInitManifest(planPath, "TestWriter");
			manifest.sections = [
				{ id: "done-1", title: "### Done 1", status: "complete", lineStart: 1, lineEnd: 10 },
				{ id: "done-2", title: "### Done 2", status: "complete", lineStart: 11, lineEnd: 20 },
			];
			manifest.state = "CHUNKS_COMPLETE";
			manifest.lineCount = 20;
			manifest.sha256 = "test-sha";
			await writeWriteManifest(manifest);

			const writer = new SegmentedPlanWriter(planPath, "TestWriter");
			await writer.loadExistingManifest();
			const advice = writer.getResumeAdvice();

			expect(advice.completedCount).toBe(2);
			expect(advice.totalCount).toBe(2);
			expect(advice.nextBlockId).toBeNull();
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	// --- Test 7: reconstructFromFile returns false when file missing ---
	it("reconstructFromFile returns false when plan file is missing", async () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "recovery-test-7-"));
		try {
			const planPath = join(tmpDir, "nonexistent.md");

			const writer = new SegmentedPlanWriter(planPath, "TestWriter");
			const result = await writer.reconstructFromFile();

			expect(result).toBe(false);
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	// --- Test 8: heading parsing creates correct sections ---
	it("reconstructFromFile parses H1/H2/H3 headings into pending sections", async () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "recovery-test-8-"));
		try {
			const planPath = join(tmpDir, "plan.md");
			const manifestPath = manifestPathFor(planPath);

			const planContent = [
				"# Overall Plan",
				"",
				"## Section A",
				"Content A",
				"",
				"### Sub Task A1",
				"Details A1",
				"",
				"## Section B",
				"Content B",
				"",
			].join("\n");
			writeFileSync(planPath, planContent, "utf8");

			const writer = new SegmentedPlanWriter(planPath, "TestWriter");
			const result = await writer.reconstructFromFile();
			expect(result).toBe(true);

			const manifest = await readWriteManifest(manifestPath);
			// # Overall Plan, ## Section A, ### Sub Task A1, ## Section B = 4 headings
			expect(manifest.sections.length).toBe(4);

			const titles = manifest.sections.map(s => s.title);
			expect(titles).toContain("# Overall Plan");
			expect(titles).toContain("## Section A");
			expect(titles).toContain("### Sub Task A1");
			expect(titles).toContain("## Section B");

			// All pending
			for (const section of manifest.sections) {
				expect(section.status).toBe("pending");
			}

			// File stats are accurate
			expect(manifest.lineCount).toBeGreaterThan(0);
			expect(manifest.sha256).toBeTruthy();
			expect(manifest.codeFenceBalanced).toBe(true);
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	// --- Test 9: fence balanced detection during reconstruction ---
	it("reconstructFromFile detects imbalanced code fences in plan file", async () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "recovery-test-9-"));
		try {
			const planPath = join(tmpDir, "plan.md");
			const manifestPath = manifestPathFor(planPath);

			// Only one opening fence (odd = imbalanced)
			const planContent = [
				"# Plan with imbalanced fences",
				"",
				"```js",
				"const x = 1;",
				"",
				"## Section",
				"Regular text",
				"",
			].join("\n");
			writeFileSync(planPath, planContent, "utf8");

			const writer = new SegmentedPlanWriter(planPath, "TestWriter");
			await writer.reconstructFromFile();
			const manifest = await readWriteManifest(manifestPath);
			expect(manifest.codeFenceBalanced).toBe(false);
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	// --- Test 10: idempotent reconstruct ---
	it("reconstructFromFile overwrites existing manifest when called", async () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "recovery-test-10-"));
		try {
			const planPath = join(tmpDir, "plan.md");
			const manifestPath = manifestPathFor(planPath);

			// Write a plan file
			const planContent = "# Plan\n\n## Section\n\nContent\n";
			writeFileSync(planPath, planContent, "utf8");

			// First reconstruction
			const writer1 = new SegmentedPlanWriter(planPath, "TestWriter");
			const result1 = await writer1.reconstructFromFile();
			expect(result1).toBe(true);

			const manifest1 = await readWriteManifest(manifestPath);
			expect(manifest1.sections.length).toBe(2); // # Plan + ## Section

			// Second reconstruction (idempotent)
			const writer2 = new SegmentedPlanWriter(planPath, "TestWriter");
			const result2 = await writer2.reconstructFromFile();
			expect(result2).toBe(true);

			const manifest2 = await readWriteManifest(manifestPath);
			expect(manifest2.sections.length).toBe(2);
			expect(manifest2.state).toBe("CHUNKS_IN_PROGRESS");
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	// --- Test 11: loadExistingManifest rejects invalid JSON shape ---
	it("loadExistingManifest returns false when manifest JSON has invalid shape", async () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "recovery-test-11-"));
		try {
			const planPath = join(tmpDir, "plan.md");
			const manifestPath = manifestPathFor(planPath);

			// Write an invalid manifest (missing required fields)
			writeFileSync(manifestPath, JSON.stringify({ planPath: "", state: "BOGUS" }), "utf8");

			// Act
			const writer = new SegmentedPlanWriter(planPath, "TestWriter");
			const loaded = await writer.loadExistingManifest();

			// Then
			expect(loaded).toBe(false);
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	// --- Test 12: headings inside fenced code blocks are ignored ---
	it("reconstructFromFile ignores headings inside fenced code blocks", async () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "recovery-test-12-"));
		try {
			const planPath = join(tmpDir, "plan.md");
			const manifestPath = manifestPathFor(planPath);

			const planContent = [
				"# Real Heading",
				"",
				"```",
				"## Heading Inside Fence",
				"### Another Inside",
				"```",
				"",
				"## Outside Heading",
				"",
				"```ts",
				"# Pseudo heading in fence",
				"### Also ignored",
				"```",
				"",
				"### Final Heading",
			].join("\n");
			writeFileSync(planPath, planContent, "utf8");

			const writer = new SegmentedPlanWriter(planPath, "TestWriter");
			const result = await writer.reconstructFromFile();
			expect(result).toBe(true);

			const manifest = await readWriteManifest(manifestPath);
			// Should only have 3 headings: # Real Heading, ## Outside Heading, ### Final Heading
			expect(manifest.sections.length).toBe(3);
			const titles = manifest.sections.map(s => s.title);
			expect(titles).toContain("# Real Heading");
			expect(titles).toContain("## Outside Heading");
			expect(titles).toContain("### Final Heading");
			expect(titles).not.toContain("## Heading Inside Fence");
			expect(titles).not.toContain("### Another Inside");
			expect(titles).not.toContain("# Pseudo heading in fence");
			expect(titles).not.toContain("### Also ignored");
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	// --- Test 13: finalized orphan file reconstructs as CHUNKS_COMPLETE ---
	it("reconstructFromFile sets CHUNKS_COMPLETE when tail marker is present", async () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "recovery-test-13-"));
		try {
			const planPath = join(tmpDir, "plan.md");
			const manifestPath = manifestPathFor(planPath);

			const tailMarker = "<!-- segmented-write-complete -->";
			const planContent = [
				"# Completed Plan",
				"",
				"## Section 1",
				"Done content",
				"",
				"## Section 2",
				"More done content",
				"",
				tailMarker,
			].join("\n");
			writeFileSync(planPath, planContent, "utf8");

			const writer = new SegmentedPlanWriter(planPath, "TestWriter");
			const result = await writer.reconstructFromFile();
			expect(result).toBe(true);

			const manifest = await readWriteManifest(manifestPath);
			expect(manifest.state).toBe("CHUNKS_COMPLETE");
			expect(manifest.sections.length).toBe(3);
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});

	// --- Test 14: writeSkeleton clears stale sections after loading manifest ---
	it("writeSkeleton clears stale sections and taskIds after loading existing manifest", async () => {
		const tmpDir = mkdtempSync(join(tmpdir(), "recovery-test-14-"));
		try {
			const planPath = join(tmpDir, "plan.md");
			const manifestPath = manifestPathFor(planPath);

			// First, create a manifest with stale data
			const initialManifest = createInitManifest(planPath, "TestWriter");
			initialManifest.sections = [
				{ id: "stale-1", title: "### Stale", status: "complete", lineStart: 1, lineEnd: 5 },
			];
			initialManifest.taskIds = ["stale-task-1"];
			initialManifest.state = "CHUNKS_IN_PROGRESS";
			initialManifest.lineCount = 5;
			initialManifest.sha256 = "stale-sha";
			await writeWriteManifest(initialManifest);

			// Act: load the stale manifest, then write a new skeleton
			const writer = new SegmentedPlanWriter(planPath, "TestWriter");
			const loaded = await writer.loadExistingManifest();
			expect(loaded).toBe(true);

			const staleSections = writer.getManifest().sections;
			expect(staleSections.length).toBeGreaterThan(0);

			await writer.writeSkeleton("# New Skeleton\n\n## Fresh\n\nContent\n");

			// Then: sections and taskIds should be reset
			const manifest = await readWriteManifest(manifestPath);
			expect(manifest.sections.length).toBe(0);
			expect(manifest.taskIds.length).toBe(0);
			expect(manifest.state).toBe("SKELETON_WRITTEN");
		} finally {
			rmSync(tmpDir, { recursive: true, force: true });
		}
	});
});
