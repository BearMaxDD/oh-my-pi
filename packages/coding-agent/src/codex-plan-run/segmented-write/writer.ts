import { createHash } from "node:crypto";
import { appendFile, readFile, writeFile } from "node:fs/promises";
import { type FullSelfCheckResult, runAllChecks } from "./checker";
import { manifestPathFor, readWriteManifest, validateWriteManifest, writeWriteManifest } from "./manifest";
import type { WriteBlockInfo, WriteManifest } from "./types";
import { createInitManifest } from "./types";

export interface AppendBlockInput {
	id: string;
	title: string;
	content: string;
}

interface ContentStats {
	sha256: string;
	lineCount: number;
	codeFenceBalanced: boolean;
}

export class SegmentedPlanWriter {
	private manifest: WriteManifest;
	private manifestPath: string;

	constructor(
		public readonly planPath: string,
		public readonly writerRole: string = "SegmentedPlanWriter",
	) {
		this.manifestPath = manifestPathFor(planPath);
		this.manifest = createInitManifest(planPath, writerRole);
	}

	async loadExistingManifest(): Promise<boolean> {
		try {
			const manifest = await readWriteManifest(this.manifestPath);
			const errors = await validateWriteManifest(manifest);
			if (errors.length > 0) return false;
			this.manifest = manifest;
			return true;
		} catch {
			return false;
		}
	}

	private computeContentStats(content: string): ContentStats {
		const sha256 = createHash("sha256").update(content, "utf8").digest("hex");
		const lineCount = content.split("\n").length;
		const codeFenceBalanced = this.areFencesBalanced(content);
		return { sha256, lineCount, codeFenceBalanced };
	}

	getManifest(): WriteManifest {
		return {
			...this.manifest,
			sections: this.manifest.sections.map(s => ({ ...s })),
			timestamps: { ...this.manifest.timestamps },
			recovery: this.manifest.recovery
				? { ...this.manifest.recovery, corruptedBlocks: [...this.manifest.recovery.corruptedBlocks] }
				: undefined,
		};
	}

	async writeSkeleton(content: string): Promise<void> {
		await writeFile(this.planPath, content, "utf8");

		const { sha256, lineCount, codeFenceBalanced } = this.computeContentStats(content);

		this.manifest.sections = [];
		this.manifest.taskIds = [];
		this.manifest.state = "SKELETON_WRITTEN";
		this.manifest.lineCount = lineCount;
		this.manifest.sha256 = sha256;
		this.manifest.codeFenceBalanced = codeFenceBalanced;
		this.manifest.timestamps.skeletonWritten = new Date().toISOString();

		await writeWriteManifest(this.manifest);
	}

	async appendBlock(block: AppendBlockInput): Promise<void> {
		const existingContent = await readFile(this.planPath, "utf8");
		const oldStats = this.computeContentStats(existingContent);

		// Validate fence balance in new block alone
		if (!this.areFencesBalanced(block.content)) {
			throw new Error(`Code fence imbalance detected in block "${block.id}"`);
		}

		// Append
		const newContent = existingContent + block.content;

		// Validate combined fence balance
		const combinedBalanced = this.areFencesBalanced(newContent);
		if (!combinedBalanced) {
			throw new Error(`Combined content fence imbalance detected after appending block "${block.id}"`);
		}

		await writeFile(this.planPath, newContent, "utf8");

		// Post-write verification
		const { sha256: newSha256, lineCount: newLineCount } = this.computeContentStats(newContent);

		if (newSha256 === oldStats.sha256) {
			throw new Error(`Block "${block.id}" did not change file content`);
		}
		if (newLineCount <= oldStats.lineCount) {
			throw new Error(`Block "${block.id}" did not add lines`);
		}

		// Update manifest with block info
		const blockInfo: WriteBlockInfo = {
			id: block.id,
			title: block.title,
			status: "complete",
			lineStart: oldStats.lineCount + 1,
			lineEnd: newLineCount,
			sha256: createHash("sha256").update(block.content).digest("hex"),
		};

		this.manifest.state = "CHUNKS_IN_PROGRESS";
		this.manifest.sections.push(blockInfo);
		this.manifest.lineCount = newLineCount;
		this.manifest.sha256 = newSha256;
		this.manifest.codeFenceBalanced = combinedBalanced;

		await writeWriteManifest(this.manifest);
	}

	areFencesBalanced(content: string): boolean {
		const fenceRegex = /^( {0,3})```/gm;
		const matches = content.match(fenceRegex);
		const count = matches ? matches.length : 0;
		return count % 2 === 0;
	}

	async finalizeWrites(): Promise<void> {
		// Append tail marker
		await appendFile(this.planPath, `\n${this.manifest.tailMarker}\n`, "utf8");

		// Read final content for integrity checks
		const finalContent = await readFile(this.planPath, "utf8");
		const { sha256, lineCount, codeFenceBalanced } = this.computeContentStats(finalContent);

		this.manifest.state = "CHUNKS_COMPLETE";
		this.manifest.timestamps.chunksComplete = new Date().toISOString();
		this.manifest.lineCount = lineCount;
		this.manifest.sha256 = sha256;
		this.manifest.codeFenceBalanced = codeFenceBalanced;

		await writeWriteManifest(this.manifest);
	}

	async runSelfCheck(): Promise<FullSelfCheckResult> {
		const content = await readFile(this.planPath, "utf8");
		const result = runAllChecks(content);

		if (!result.passed) {
			const violations = result.checks.flatMap(c => c.violations);
			const detail = violations.map(v => `Line ${v.line}: ${v.message}`).join("; ");
			throw new Error(`Self-check failed: ${detail}`);
		}

		this.manifest.state = "SELF_CHECK_COMPLETE";
		this.manifest.timestamps.selfCheckComplete = new Date().toISOString();
		await writeWriteManifest(this.manifest);

		return result;
	}

	async markPatchedComplete(): Promise<void> {
		if (this.manifest.state !== "SELF_CHECK_COMPLETE") {
			throw new Error(
				`Cannot mark PATCHED_COMPLETE from state "${this.manifest.state}"; required state is "SELF_CHECK_COMPLETE"`,
			);
		}

		this.manifest.state = "PATCHED_COMPLETE";
		this.manifest.timestamps.patchedComplete = new Date().toISOString();
		await writeWriteManifest(this.manifest);
	}
	getCompletedBlockIds(): string[] {
		return this.manifest.sections.filter(s => s.status === "complete").map(s => s.id);
	}

	getIncompleteBlocks(): WriteBlockInfo[] {
		return this.manifest.sections.filter(s => s.status !== "complete");
	}

	async reconstructFromFile(): Promise<boolean> {
		try {
			const content = await readFile(this.planPath, "utf8");
			const { sha256, lineCount, codeFenceBalanced } = this.computeContentStats(content);

			const lines = content.split("\n");
			const sections: WriteBlockInfo[] = [];
			const headingRegex = /^(#{1,3})\s+.+$/;
			const fenceRegex = /^ {0,3}```/;
			let inFence = false;

			for (let i = 0; i < lines.length; i++) {
				const line = lines[i];
				if (fenceRegex.test(line)) {
					inFence = !inFence;
					continue;
				}
				if (inFence) continue;

				const match = line.match(headingRegex);
				if (match) {
					const id = `recovered-${sections.length + 1}`;
					sections.push({
						id,
						title: match[0],
						status: "pending",
						lineStart: i + 1,
						lineEnd: i + 1,
					});
				}
			}

			// Adjust lineEnd: each section ends before the next heading (or at file end)
			for (let i = 0; i < sections.length; i++) {
				if (i < sections.length - 1) {
					sections[i].lineEnd = sections[i + 1].lineStart - 1;
				} else {
					sections[i].lineEnd = lineCount;
				}
			}

			this.manifest.state = content.includes(this.manifest.tailMarker) ? "CHUNKS_COMPLETE" : "CHUNKS_IN_PROGRESS";
			this.manifest.sections = sections;
			this.manifest.lineCount = lineCount;
			this.manifest.sha256 = sha256;
			this.manifest.codeFenceBalanced = codeFenceBalanced;

			await writeWriteManifest(this.manifest);
			return true;
		} catch {
			return false;
		}
	}

	async verifyFileIntegrity(): Promise<boolean> {
		try {
			const content = await readFile(this.planPath, "utf8");
			const { sha256 } = this.computeContentStats(content);
			return sha256 === this.manifest.sha256;
		} catch {
			return false;
		}
	}

	getResumeAdvice(): { nextBlockId: string | null; completedCount: number; totalCount: number } {
		const completeIds = this.getCompletedBlockIds();
		const totalCount = this.manifest.sections.length;
		const completedCount = completeIds.length;

		const nextBlock = this.manifest.sections.find(s => s.status !== "complete");
		return {
			nextBlockId: nextBlock?.id ?? null,
			completedCount,
			totalCount,
		};
	}
}
