import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { SegmentedPlanWriter } from "./writer";

export interface SegmentedWriteOptions {
	/** Minimum lines before considering segmented writing (default 200). */
	minChunkLines?: number;
	/** Role label written into the manifest (default "SegmentedPlanWriter"). */
	writerRole?: string;
	/** When true, runs the writer self-check after finalizeWrites (default false). */
	enableSelfCheck?: boolean;
}

/**
 * Returns true when the content is large enough and the path matches the
 * eligible segment-writing patterns:
 * - `lineCount >= minChunkLines`
 * - path ends with `.md`
 * - path includes `/docs/superpowers/plans/` or ends with `plan-execution-book.md`
 */
export function shouldUseSegmentedWrite(planPath: string, lineCount: number, minChunkLines = 200): boolean {
	if (lineCount < minChunkLines) return false;
	if (!planPath.endsWith(".md")) return false;
	return planPath.includes("/docs/superpowers/plans/") || planPath.endsWith("plan-execution-book.md");
}

const FENCE_RE = /^( {0,3})```/;

/**
 * Split content lines into chunks at fence-balanced boundaries.
 *
 * Tracks triple-backtick fence lines and only cuts when **outside** a fenced
 * code block.  The cut also requires that enough content remains for a
 * non-trivial trailing chunk, avoiding degenerate single-line leftovers.
 *
 * Every chunk returned has balanced fences (each opening ``` has a matching
 * closer within the same chunk), which keeps `SegmentedPlanWriter.appendBlock`
 * from rejecting the content.
 */
export function splitAtFenceBalancedBoundaries(lines: string[], minChunkLines: number): string[] {
	const chunks: string[] = [];
	let currentChunk: string[] = [];
	let insideFence = false;

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i];

		// Toggle fence state on every triple-backtick line
		if (FENCE_RE.test(line)) {
			insideFence = !insideFence;
		}

		currentChunk.push(line);

		// Only cut when we are OUTSIDE a fence and we have accumulated enough lines.
		// Also require that remaining content is large enough to form its own chunk.
		if (!insideFence && currentChunk.length >= minChunkLines) {
			const remaining = lines.length - i - 1;
			if (remaining >= minChunkLines) {
				chunks.push(`${currentChunk.join("\n")}\n`);
				currentChunk = [];
			}
		}
	}

	// Remaining lines become the final chunk (empty content produces no chunks).
	if (currentChunk.length > 0) {
		chunks.push(currentChunk.join("\n"));
	}

	return chunks;
}

/**
 * Write markdown content to a file, automatically choosing between a plain
 * direct write and segmented writing via `SegmentedPlanWriter`.
 *
 * **Direct** branch — when the content is short or the path does not match the
 * eligible patterns: creates the parent directory and writes the file.
 *
 * **Segmented** branch — splits the content into fence-balanced chunks and
 * writes them through the `SegmentedPlanWriter` pipeline (skeleton → append
 * blocks → finalize with tail marker). A sidecar manifest is created alongside
 * the target file.
 *
 * @returns `"direct"` or `"segmented"` indicating which branch was taken.
 */
export async function writeSegmentedMarkdownIfNeeded(
	planPath: string,
	content: string,
	options?: SegmentedWriteOptions,
): Promise<"direct" | "segmented"> {
	const minChunkLines = options?.minChunkLines ?? 200;
	const writerRole = options?.writerRole ?? "SegmentedPlanWriter";
	const lines = content.split("\n");
	const lineCount = lines.length;

	// Short or non-eligible path → direct write
	if (!shouldUseSegmentedWrite(planPath, lineCount, minChunkLines)) {
		await mkdir(dirname(planPath), { recursive: true });
		await writeFile(planPath, content, "utf8");
		return "direct";
	}

	// Split content into fence-balanced chunks
	const chunks = splitAtFenceBalancedBoundaries(lines, minChunkLines);
	const writer = new SegmentedPlanWriter(planPath, writerRole);

	// Ensure parent directory exists (writeSkeleton does not create parents)
	await mkdir(dirname(planPath), { recursive: true });

	// First chunk → skeleton
	await writer.writeSkeleton(chunks[0]);

	// Remaining chunks → appended blocks
	for (let i = 1; i < chunks.length; i++) {
		await writer.appendBlock({
			id: `chunk-${i + 1}`,
			title: `Chunk ${i + 1}`,
			content: chunks[i],
		});
	}
	await writer.finalizeWrites();

	if (options?.enableSelfCheck) {
		await writer.runSelfCheck();
	}

	return "segmented";
}
