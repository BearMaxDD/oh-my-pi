import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	manifestPathFor,
	readWriteManifest,
	validateWriteManifest,
	writeWriteManifest,
} from "../../../src/codex-plan-run/segmented-write/manifest";
import { createInitManifest } from "../../../src/codex-plan-run/segmented-write/types";

describe("WriteManifest IO", () => {
	const tmpDir = mkdtempSync(join(tmpdir(), "manifest-test-"));
	const planPath = join(tmpDir, "test-plan.md");
	const manifestPath = join(tmpDir, ".test-plan.write-manifest.json");

	afterAll(() => rmSync(tmpDir, { recursive: true, force: true }));

	it("computes manifest path from plan path", () => {
		const result = manifestPathFor(planPath);
		expect(result).toBe(join(tmpDir, ".test-plan.write-manifest.json"));
	});

	it("writes and reads manifest", async () => {
		const manifest = createInitManifest(planPath, "SegmentedPlanWriter");
		await writeWriteManifest(manifest);
		const loaded = await readWriteManifest(manifestPath);
		expect(loaded.planPath).toBe(planPath);
		expect(loaded.state).toBe("INIT");
	});

	it("rejects invalid manifest", async () => {
		const manifest = createInitManifest("", "Writer");
		const errors = await validateWriteManifest(manifest);
		expect(errors.length).toBeGreaterThan(0);
		expect(errors).toContain("planPath is required");
	});

	it("does not overwrite when manifest write fails", async () => {
		const manifest = createInitManifest(planPath, "SegmentedPlanWriter");
		manifest.state = "INVALID_STATE" as any;
		await expect(writeWriteManifest(manifest)).rejects.toThrow();
	});
});
