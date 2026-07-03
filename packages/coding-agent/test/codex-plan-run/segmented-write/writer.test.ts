import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { manifestPathFor, readWriteManifest } from "../../../src/codex-plan-run/segmented-write/manifest";
import { SegmentedPlanWriter } from "../../../src/codex-plan-run/segmented-write/writer";

const SKELETON = "# Test Plan\n\nGoal: test\n\n## 任务\n\n- Task 1\n\n";

describe("SegmentedPlanWriter", () => {
	let tmpDir: string;
	let planPath: string;
	let manifestPath: string;

	beforeEach(() => {
		tmpDir = mkdtempSync(join(tmpdir(), "writer-test-"));
		planPath = join(tmpDir, "plan.md");
		manifestPath = manifestPathFor(planPath);
	});

	afterEach(() => {
		rmSync(tmpDir, { recursive: true, force: true });
	});

	it("writes skeleton and advances state to SKELETON_WRITTEN", async () => {
		const writer = new SegmentedPlanWriter(planPath, "TestWriter");
		await writer.writeSkeleton(SKELETON);

		expect(existsSync(planPath)).toBe(true);
		expect(existsSync(manifestPath)).toBe(true);
		const manifest = await readWriteManifest(manifestPath);
		expect(manifest.state).toBe("SKELETON_WRITTEN");
		expect(manifest.lineCount).toBeGreaterThan(0);
		expect(manifest.sha256).toBeTruthy();
		expect(manifest.codeFenceBalanced).toBe(true);
	});

	it("appends a block and advances progress", async () => {
		const writer = new SegmentedPlanWriter(planPath, "TestWriter");
		await writer.writeSkeleton(SKELETON);

		const block = {
			id: "task-1",
			title: "### Task 1: Test",
			content: "\n\n### Task 1: Test\n\nContent here\n\n",
		};
		await writer.appendBlock(block);

		const content = readFileSync(planPath, "utf8");
		expect(content).toContain("Task 1: Test");

		const manifest = await readWriteManifest(manifestPath);
		const section = manifest.sections.find(s => s.id === "task-1");
		expect(section).toBeDefined();
		expect(section!.status).toBe("complete");
		expect(manifest.lineCount).toBeGreaterThan(0);
		expect(manifest.codeFenceBalanced).toBe(true);
	});

	it("fence balance check detects imbalance", () => {
		const writer = new SegmentedPlanWriter(planPath, "TestWriter");

		const badContent = "\n```typescript\nconst x = 1;\n```\n```bash\necho hello\n";
		const balanced = writer.areFencesBalanced(badContent);
		expect(balanced).toBe(false);

		const goodContent = "\n```typescript\nconst x = 1;\n```\n```bash\necho hello\n```\n";
		const balanced2 = writer.areFencesBalanced(goodContent);
		expect(balanced2).toBe(true);
	});

	it("rejects block write when fence imbalance detected in block content", async () => {
		const writer = new SegmentedPlanWriter(planPath, "TestWriter");
		await writer.writeSkeleton(SKELETON);

		const imbalancedBlock = {
			id: "bad-block",
			title: "Bad",
			content: "\n```js\ncode\n```\n```\nunclosed\n",
		};
		await expect(writer.appendBlock(imbalancedBlock)).rejects.toThrow(/fence imbalance/);
	});

	it("rejects block write when combined fences become imbalanced", async () => {
		const writer = new SegmentedPlanWriter(planPath, "TestWriter");
		// Skeleton with imbalanced fences (3 backtick sequences = odd)
		const imbalancedSkeleton = "# Plan\n\n```typescript\nconst x = 1;\n```\n```\norphan\n";
		await writer.writeSkeleton(imbalancedSkeleton);

		// Block individually is balanced (2 fences)
		const balancedBlock = {
			id: "even-block",
			title: "Even",
			content: "\n```typescript\nconst y = 2;\n```\n",
		};
		// Combined = 5 fences -> imbalanced
		await expect(writer.appendBlock(balancedBlock)).rejects.toThrow(/fence imbalance/);
	});

	it("finalize advances state to CHUNKS_COMPLETE with balanced fences", async () => {
		const writer = new SegmentedPlanWriter(planPath, "TestWriter");
		await writer.writeSkeleton(SKELETON);
		await writer.finalizeWrites();

		const manifest = await readWriteManifest(manifestPath);
		expect(manifest.state).toBe("CHUNKS_COMPLETE");
		expect(manifest.timestamps.chunksComplete).toBeTruthy();
		expect(manifest.codeFenceBalanced).toBe(true);
	});

	it("runSelfCheck advances state to SELF_CHECK_COMPLETE for clean content", async () => {
		const writer = new SegmentedPlanWriter(planPath, "TestWriter");
		await writer.writeSkeleton(SKELETON);
		await writer.finalizeWrites();

		const result = await writer.runSelfCheck();

		expect(result.passed).toBe(true);

		const manifest = await readWriteManifest(manifestPath);
		expect(manifest.state).toBe("SELF_CHECK_COMPLETE");
		expect(manifest.timestamps.selfCheckComplete).toBeTruthy();
	});

	it("runSelfCheck throws for content with TODO placeholder", async () => {
		const writer = new SegmentedPlanWriter(planPath, "TestWriter");
		const todoContent = "# Test Plan\n\nTODO: implement this later\n";
		await writer.writeSkeleton(todoContent);
		await writer.finalizeWrites();

		await expect(writer.runSelfCheck()).rejects.toThrow(/Self-check failed/);

		const manifest = await readWriteManifest(manifestPath);
		expect(manifest.state).toBe("CHUNKS_COMPLETE");
		expect(manifest.timestamps.selfCheckComplete).toBeUndefined();
	});

	it("runSelfCheck throws for content missing H1 heading", async () => {
		const writer = new SegmentedPlanWriter(planPath, "TestWriter");
		const noH1Content = "Some content without an H1 heading.\n";
		await writer.writeSkeleton(noH1Content);
		await writer.finalizeWrites();

		await expect(writer.runSelfCheck()).rejects.toThrow(/Self-check failed/);

		const manifest = await readWriteManifest(manifestPath);
		expect(manifest.state).toBe("CHUNKS_COMPLETE");
	});

	it("markPatchedComplete advances state to PATCHED_COMPLETE after self-check", async () => {
		const writer = new SegmentedPlanWriter(planPath, "TestWriter");
		await writer.writeSkeleton(SKELETON);
		await writer.finalizeWrites();
		await writer.runSelfCheck();

		await writer.markPatchedComplete();

		const manifest = await readWriteManifest(manifestPath);
		expect(manifest.state).toBe("PATCHED_COMPLETE");
		expect(manifest.timestamps.patchedComplete).toBeTruthy();
	});

	it("markPatchedComplete throws if called before SELF_CHECK_COMPLETE", async () => {
		const writer = new SegmentedPlanWriter(planPath, "TestWriter");
		await writer.writeSkeleton(SKELETON);
		await writer.finalizeWrites();

		await expect(writer.markPatchedComplete()).rejects.toThrow(/PATCHED_COMPLETE|SELF_CHECK_COMPLETE/);
	});
});
