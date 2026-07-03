import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, dirname, extname, join } from "node:path";
import type { SegmentedWriteState, WriteManifest } from "./types";
import { SEGMENTED_WRITE_STATES } from "./types";

export function manifestPathFor(planPath: string): string {
	const dir = dirname(planPath);
	const base = basename(planPath, extname(planPath));
	return join(dir, `.${base}.write-manifest.json`);
}

function isSegmentedWriteState(value: unknown): value is SegmentedWriteState {
	return typeof value === "string" && (SEGMENTED_WRITE_STATES as readonly string[]).includes(value);
}

export async function validateWriteManifest(manifest: WriteManifest): Promise<string[]> {
	const errors: string[] = [];
	if (!manifest.planPath) errors.push("planPath is required");
	if (!isSegmentedWriteState(manifest.state)) errors.push("state must be a valid SegmentedWriteState");
	if (!manifest.writerRole) errors.push("writerRole is required");
	if (!manifest.timestamps?.created) errors.push("timestamps.created is required");
	return errors;
}

export async function writeWriteManifest(manifest: WriteManifest): Promise<void> {
	const errors = await validateWriteManifest(manifest);
	if (errors.length > 0) {
		throw new Error(`Invalid WriteManifest: ${errors.join("; ")}`);
	}
	const mPath = manifestPathFor(manifest.planPath);
	await mkdir(dirname(mPath), { recursive: true });
	await writeFile(mPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

export async function readWriteManifest(manifestPath: string): Promise<WriteManifest> {
	return JSON.parse(await readFile(manifestPath, "utf8")) as WriteManifest;
}

export async function updateWriteManifestState(
	manifest: WriteManifest,
	newState: SegmentedWriteState,
): Promise<WriteManifest> {
	const updated: WriteManifest = { ...manifest, state: newState };
	await writeWriteManifest(updated);
	return updated;
}
