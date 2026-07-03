import { createHash } from "node:crypto";
import { constants } from "node:fs";
import { access, type FileHandle, lstat, mkdir, open, readFile, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";
import { createAdvisorSummary } from "./advisor-summary";
import { createSkillEvidenceMatrix } from "./skill-evidence";
import type { SuperpowersSkillDiscoveryReport } from "./skill-gate";
import { createEmptyTddEvidenceMatrix } from "./tdd-evidence";

export interface MaterializePlanRequest {
	sourcePlanPath: string;
	worktreePath: string;
	expectedSha256: string;
	targetRelativePath?: string;
	acceptingDir?: string;
	taskIds?: string[];
	skillDiscoveryReport?: SuperpowersSkillDiscoveryReport;
	superpowersBootstrapEvidence?: unknown;
}

export interface MaterializePlanResult {
	sourcePlanPath: string;
	worktreePlanPath: string;
	actualSha256: string;
}

export function sha256Text(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

const TARGET_PATH_ERROR = "targetRelativePath must stay inside worktree";

function isInsidePath(root: string, candidate: string): boolean {
	const candidateFromRoot = relative(root, candidate);
	return candidateFromRoot === "" || (!candidateFromRoot.startsWith("..") && !isAbsolute(candidateFromRoot));
}

async function ensureParentStaysInsideWorktree(worktreeRoot: string, targetPath: string): Promise<void> {
	await mkdir(worktreeRoot, { recursive: true });
	const realWorktreeRoot = await realpath(worktreeRoot);
	const parentPath = dirname(targetPath);
	const parentFromRoot = relative(worktreeRoot, parentPath);
	if (parentFromRoot === "") return;

	let currentPath = worktreeRoot;
	for (const part of parentFromRoot.split(/[\\/]+/)) {
		currentPath = join(currentPath, part);
		try {
			await lstat(currentPath);
		} catch (error) {
			const nodeError = error as { code?: string };
			if (nodeError.code !== "ENOENT") throw error;
			await mkdir(currentPath);
		}

		const realCurrentPath = await realpath(currentPath);
		if (!isInsidePath(realWorktreeRoot, realCurrentPath)) {
			throw new Error(TARGET_PATH_ERROR);
		}
	}
}

async function ensureTargetIsNotSymlink(targetPath: string): Promise<void> {
	try {
		const stats = await lstat(targetPath);
		if (stats.isSymbolicLink()) {
			throw new Error(TARGET_PATH_ERROR);
		}
	} catch (error) {
		const nodeError = error as { code?: string };
		if (nodeError.code === "ENOENT") return;
		throw error;
	}
}

async function resolveWorktreePlanPath(worktreePath: string, targetRelativePath: string): Promise<string> {
	if (!targetRelativePath || isAbsolute(targetRelativePath)) {
		throw new Error(TARGET_PATH_ERROR);
	}

	const worktreeRoot = resolve(worktreePath);
	const targetPath = resolve(worktreeRoot, targetRelativePath);
	const targetFromRoot = relative(worktreeRoot, targetPath);
	if (!targetFromRoot || targetFromRoot.startsWith("..") || isAbsolute(targetFromRoot)) {
		throw new Error(TARGET_PATH_ERROR);
	}

	await ensureParentStaysInsideWorktree(worktreeRoot, targetPath);
	await ensureTargetIsNotSymlink(targetPath);
	return targetPath;
}

async function writeFileNoFollow(worktreeRoot: string, targetPath: string, content: string): Promise<void> {
	await ensureParentStaysInsideWorktree(worktreeRoot, targetPath);
	await ensureTargetIsNotSymlink(targetPath);

	const parentPath = dirname(targetPath);
	const parentRealPath = await realpath(parentPath);
	const noFollowFlag = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
	const flags = constants.O_CREAT | constants.O_TRUNC | constants.O_WRONLY | noFollowFlag;

	const directoryFlag = typeof constants.O_DIRECTORY === "number" ? constants.O_DIRECTORY : undefined;
	if (directoryFlag) {
		const parentOpenFlags =
			constants.O_RDONLY |
			constants.O_DIRECTORY |
			(typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0);
		let parentHandle: FileHandle;
		try {
			parentHandle = await open(parentPath, parentOpenFlags);
		} catch (error) {
			const nodeError = error as { code?: string };
			if (nodeError.code === "ELOOP") throw new Error(TARGET_PATH_ERROR);
			throw error;
		}
		try {
			const parentFdRealPath = await realpathFd(parentHandle.fd);
			if (parentFdRealPath && parentFdRealPath !== parentRealPath) throw new Error(TARGET_PATH_ERROR);

			const writePaths = await resolveFdRelativeWritePaths(parentHandle.fd, basename(targetPath));
			// Some platforms do not expose fd roots in Node/Bun; parent and target checks remain as fallback.
			let wrote = false;
			for (const writePath of writePaths) {
				try {
					await writeFileHandle(writePath, flags, content);
					wrote = true;
					break;
				} catch (error) {
					if (!isUnavailableFdPathError(error)) throw error;
				}
			}
			if (!wrote) {
				if ((await realpath(parentPath)) !== parentRealPath) throw new Error(TARGET_PATH_ERROR);
				await writeFileHandle(targetPath, flags, content);
			}
		} finally {
			await parentHandle.close();
		}
	} else {
		// Some platforms do not expose O_DIRECTORY in Node/Bun; parent and target checks remain as fallback.
		await writeFileHandle(targetPath, flags, content);
	}

	await ensureTargetIsNotSymlink(targetPath);
	if ((await realpath(parentPath)) !== parentRealPath) {
		throw new Error(TARGET_PATH_ERROR);
	}
}

async function realpathFd(fd: number): Promise<string | undefined> {
	for (const fdRoot of ["/dev/fd", "/proc/self/fd"]) {
		const fdPath = join(fdRoot, String(fd));
		try {
			await access(fdPath);
			return await realpath(fdPath);
		} catch (error) {
			const nodeError = error as { code?: string };
			if (nodeError.code !== "ENOENT" && nodeError.code !== "ENOTDIR") throw error;
		}
	}

	return undefined;
}

async function resolveFdRelativeWritePaths(parentFd: number, targetName: string): Promise<string[]> {
	const writePaths: string[] = [];
	for (const fdRoot of ["/dev/fd", "/proc/self/fd"]) {
		const fdPath = join(fdRoot, String(parentFd));
		try {
			await access(fdPath);
			writePaths.push(join(fdPath, targetName));
		} catch (error) {
			const nodeError = error as { code?: string };
			if (nodeError.code !== "ENOENT" && nodeError.code !== "ENOTDIR") throw error;
		}
	}

	return writePaths;
}

function isUnavailableFdPathError(error: unknown): boolean {
	const nodeError = error as { code?: string };
	return nodeError.code === "ENOENT" || nodeError.code === "ENOTDIR";
}

async function writeFileHandle(path: string, flags: number, content: string): Promise<void> {
	try {
		const file = await open(path, flags, 0o666);
		try {
			await file.writeFile(content, "utf8");
		} finally {
			await file.close();
		}
	} catch (error) {
		const nodeError = error as { code?: string };
		if (nodeError.code === "ELOOP") throw new Error(TARGET_PATH_ERROR);
		throw error;
	}
}

async function writeFileNoFollowIfMissing(worktreeRoot: string, targetPath: string, content: string): Promise<void> {
	await ensureParentStaysInsideWorktree(worktreeRoot, targetPath);
	await ensureTargetIsNotSymlink(targetPath);

	const parentPath = dirname(targetPath);
	const parentRealPath = await realpath(parentPath);
	const noFollowFlag = typeof constants.O_NOFOLLOW === "number" ? constants.O_NOFOLLOW : 0;
	const flags = constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | noFollowFlag;

	try {
		await writeFileHandle(targetPath, flags, content);
	} catch (error) {
		const nodeError = error as { code?: string };
		if (nodeError.code !== "EEXIST") throw error;
	}

	await ensureTargetIsNotSymlink(targetPath);
	if ((await realpath(parentPath)) !== parentRealPath) {
		throw new Error(TARGET_PATH_ERROR);
	}
}

async function writeJsonArtifactIfMissing(worktreeRoot: string, artifactPath: string, value: unknown): Promise<void> {
	await writeFileNoFollowIfMissing(worktreeRoot, artifactPath, `${JSON.stringify(value, null, 2)}\n`);
}

async function initializeAutonomousEvidenceArtifacts(request: MaterializePlanRequest): Promise<void> {
	if (!request.acceptingDir) return;

	const worktreeRoot = resolve(request.worktreePath);
	const acceptingDir = resolve(request.acceptingDir);
	const taskIds = request.taskIds ?? [];
	await writeJsonArtifactIfMissing(
		worktreeRoot,
		join(acceptingDir, "tdd-evidence-matrix.json"),
		createEmptyTddEvidenceMatrix(taskIds),
	);
	await writeJsonArtifactIfMissing(
		worktreeRoot,
		join(acceptingDir, "skill-evidence-matrix.json"),
		createSkillEvidenceMatrix(taskIds),
	);
	await writeJsonArtifactIfMissing(worktreeRoot, join(acceptingDir, "advisor-summary.json"), createAdvisorSummary([]));
	await writeJsonArtifactIfMissing(
		worktreeRoot,
		join(acceptingDir, "skill-discovery-report.json"),
		request.skillDiscoveryReport ?? { ok: false, found: [], missing: [] },
	);
	await writeJsonArtifactIfMissing(
		worktreeRoot,
		join(acceptingDir, "superpowers-bootstrap-evidence.json"),
		request.superpowersBootstrapEvidence ?? { loaded: false },
	);
}

export async function materializePlanIntoWorktree(request: MaterializePlanRequest): Promise<MaterializePlanResult> {
	const planText = await readFile(request.sourcePlanPath, "utf8");
	const actualSha256 = sha256Text(planText);
	if (actualSha256 !== request.expectedSha256) {
		throw new Error(`Plan SHA-256 mismatch: expected ${request.expectedSha256}, got ${actualSha256}`);
	}

	const relativePath =
		request.targetRelativePath ?? join("docs", "superpowers", "plans", basename(request.sourcePlanPath));
	const worktreePlanPath = await resolveWorktreePlanPath(request.worktreePath, relativePath);
	const worktreeRoot = resolve(request.worktreePath);
	await writeFileNoFollow(worktreeRoot, worktreePlanPath, planText);
	await initializeAutonomousEvidenceArtifacts(request);

	const copiedText = await readFile(worktreePlanPath, "utf8");
	const copiedSha256 = sha256Text(copiedText);
	if (copiedSha256 !== request.expectedSha256) {
		throw new Error(`Worktree plan SHA-256 mismatch: expected ${request.expectedSha256}, got ${copiedSha256}`);
	}

	return { sourcePlanPath: request.sourcePlanPath, worktreePlanPath, actualSha256: copiedSha256 };
}
