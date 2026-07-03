import * as fs from "node:fs";
import * as path from "node:path";
import type { Settings } from "../config/settings";
import { ToolError } from "./tool-errors";

export type CodeWritePolicy = "normal" | "subagent-preferred" | "subagent-only";

const MAIN_WRITE_TOOL_BLOCKLIST = new Set(["edit", "write", "ast_edit"]);
const ALLOWED_MAIN_WRITE_PREFIXES = ["docs/superpowers/accepting/", "docs/superpowers/reviews/"];
const SNAPSHOT_SKIP_DIRECTORIES = new Set([
	".git",
	".hg",
	".svn",
	".worktrees",
	"node_modules",
	"dist",
	"build",
	"target",
	".next",
	".nuxt",
	".turbo",
	".cache",
	"coverage",
]);

type FileFingerprint = {
	mtimeMs: number;
	size: number;
};

export type FileSnapshot = Map<string, FileFingerprint>;

export function isMainAgentCodeWriteRestricted(settings: Settings, taskDepth: number | undefined): boolean {
	return (taskDepth ?? 0) === 0 && settings.get("task.codeWrites") === "subagent-only";
}

export function isMainWriteToolBlocked(toolName: string, settings: Settings, taskDepth: number | undefined): boolean {
	return isMainAgentCodeWriteRestricted(settings, taskDepth) && MAIN_WRITE_TOOL_BLOCKLIST.has(toolName);
}

function normalizeRelativePath(relativePath: string): string {
	return relativePath.split(path.sep).join("/");
}

export function isAllowedMainEvidencePath(relativePath: string): boolean {
	const normalized = normalizeRelativePath(relativePath);
	if (!normalized || normalized.startsWith("../") || path.isAbsolute(normalized)) return false;
	return ALLOWED_MAIN_WRITE_PREFIXES.some(prefix => normalized.startsWith(prefix));
}

async function walkFiles(root: string, current: string, snapshot: FileSnapshot): Promise<void> {
	const entries = await fs.promises.readdir(current, { withFileTypes: true });
	for (const entry of entries) {
		const absolutePath = path.join(current, entry.name);
		const relativePath = normalizeRelativePath(path.relative(root, absolutePath));
		if (entry.isDirectory()) {
			if (SNAPSHOT_SKIP_DIRECTORIES.has(entry.name)) continue;
			await walkFiles(root, absolutePath, snapshot);
			continue;
		}
		if (!entry.isFile()) continue;
		const stat = await fs.promises.stat(absolutePath);
		snapshot.set(relativePath, {
			mtimeMs: stat.mtimeMs,
			size: stat.size,
		});
	}
}

export async function captureFileSnapshot(root: string): Promise<FileSnapshot> {
	const snapshot: FileSnapshot = new Map();
	await walkFiles(root, root, snapshot);
	return snapshot;
}

function fingerprintsEqual(left: FileFingerprint | undefined, right: FileFingerprint | undefined): boolean {
	return Boolean(left && right && left.size === right.size && left.mtimeMs === right.mtimeMs);
}

export function findUnauthorizedMainWrites(before: FileSnapshot, after: FileSnapshot): string[] {
	const changed = new Set<string>();
	for (const [relativePath, afterFingerprint] of after.entries()) {
		if (!fingerprintsEqual(before.get(relativePath), afterFingerprint)) {
			changed.add(relativePath);
		}
	}
	for (const relativePath of before.keys()) {
		if (!after.has(relativePath)) changed.add(relativePath);
	}
	return [...changed].filter(relativePath => !isAllowedMainEvidencePath(relativePath)).sort();
}

export function assertNoUnauthorizedMainWrites(unauthorizedPaths: string[]): void {
	if (unauthorizedPaths.length === 0) return;
	const preview = unauthorizedPaths.slice(0, 8).join(", ");
	const suffix = unauthorizedPaths.length > 8 ? `, ... and ${unauthorizedPaths.length - 8} more` : "";
	throw new ToolError(
		`Main agent bash modified files outside allowed evidence paths: ${preview}${suffix}. ` +
			"In task.codeWrites=subagent-only mode, dispatch a subagent to write code/tests/config and keep the main agent focused on review, verification, and accepting evidence.",
	);
}
