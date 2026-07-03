import { createHash } from "node:crypto";
import { readdir, readFile, stat } from "node:fs/promises";
import { isAbsolute, join, relative, resolve } from "node:path";
import {
	createPlanExecutionBook,
	type PlanExecutionBook,
	type PlanExecutionBookTaskInput,
	type ProjectRecon,
	readPlanExecutionBookMarkdown,
	type SkillLike,
	writePlanExecutionBook,
} from "../codex-plan-run";
import {
	type CodebaseMemoryReconOptions,
	mergeCodebaseMemoryProjectRecon,
	runCodebaseMemoryExecutionRecon,
} from "../codex-plan-run/codebase-memory-recon";
import type { PlanRunManifest } from "../codex-plan-run/manifest";
import { createTodoSnapshotForExecutionBook } from "../codex-plan-run/todo-snapshot";
import type { TodoSnapshot } from "../codex-plan-run/types";
import * as git from "../utils/git";

export const REQUIRED_AUTONOMOUS_ARTIFACTS = [
	"plan-execution-book.md",
	"plan-run-manifest.json",
	"todo-snapshot.json",
	"events.jsonl",
	"task-review-records.json",
	"tdd-evidence-matrix.json",
	"skill-discovery-report.json",
	"skill-evidence-matrix.json",
	"superpowers-bootstrap-evidence.json",
	"advisor-summary.json",
	"omp-completion.md",
] as const;

export interface AutonomousArtifactSetValidation {
	ok: boolean;
	missing: string[];
}

export function validateAutonomousArtifactSet(artifacts: Iterable<string>): AutonomousArtifactSetValidation {
	const available = new Set([...artifacts].map(artifact => artifact.trim()).filter(Boolean));
	const missing = REQUIRED_AUTONOMOUS_ARTIFACTS.filter(artifact => !available.has(artifact));
	return { ok: missing.length === 0, missing };
}

export interface PlanExecutionBookGateRequest {
	runId: string;
	planPath: string;
	planSha256: string;
	repoPath: string;
	acceptingDir: string;
	requiredExecutionSkills: string[];
	requiredReviewSkills: string[];
	finalTailSkills: string[];
	finalAcceptanceCommands?: string[];
	tasks: PlanExecutionBookTaskInput[];
	skills: readonly SkillLike[];
	codebaseMemory?: CodebaseMemoryReconOptions;
	now?: Date;
}

export interface PlanExecutionBookGateResult {
	status: "passed";
	nextAllowed: true;
	bookPath: string;
	bookSha256: string;
	book: PlanExecutionBook;
	manifest: PlanRunManifest;
	todoSnapshot: TodoSnapshot;
}

function sha256(text: string): string {
	return createHash("sha256").update(text).digest("hex");
}

function isInside(root: string, candidate: string): boolean {
	const rel = relative(root, candidate);
	return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

async function assertDir(path: string, label: string): Promise<void> {
	const stats = await stat(path).catch(() => null);
	if (!stats?.isDirectory()) throw new Error(`${label} must exist and be a directory: ${path}`);
}

async function readPackageScripts(repoPath: string): Promise<Record<string, string>> {
	const packageJsonPath = join(repoPath, "package.json");
	try {
		const parsed = JSON.parse(await readFile(packageJsonPath, "utf8")) as { scripts?: Record<string, string> };
		return parsed.scripts ?? {};
	} catch {
		return {};
	}
}

async function captureGitState(repoPath: string): Promise<NonNullable<PlanRunManifest["git_state"]>> {
	return {
		branch: (await git.branch.current(repoPath)) ?? "unknown",
		head_commit: (await git.head.sha(repoPath)) ?? "unknown",
		status_short: (await git.status(repoPath, { porcelainV1: true }).catch(() => "")).trim(),
	};
}

function unique(values: readonly string[]): string[] {
	return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

async function topLevelDirs(repoPath: string): Promise<string[]> {
	const entries = await readdir(repoPath, { withFileTypes: true }).catch(() => []);
	return entries
		.filter(entry => entry.isDirectory() && !entry.name.startsWith(".") && entry.name !== "node_modules")
		.map(entry => entry.name)
		.sort();
}

export async function deriveProjectRecon(
	repoPath: string,
	tasks: readonly PlanExecutionBookTaskInput[],
): Promise<ProjectRecon> {
	const scripts = await readPackageScripts(repoPath);
	const dirs = await topLevelDirs(repoPath);
	const likelyFiles = unique(tasks.flatMap(task => task.likelyFiles ?? []));
	const taskFileMap = Object.fromEntries(tasks.map(task => [task.id, unique(task.likelyFiles ?? [])]));
	const testCommands = unique([
		...Object.entries(scripts)
			.filter(([name]) => /test/i.test(name))
			.map(([, command]) => command),
		"bun test",
	]);
	const buildCommands = unique(
		Object.entries(scripts)
			.filter(([name]) => /build|type|check|lint/i.test(name))
			.map(([, command]) => command),
	);

	return {
		repo_path: repoPath,
		relevant_modules: unique([
			...dirs.filter(dir => /src|test|packages|apps|lib|cmd|internal/i.test(dir)),
			...likelyFiles.map(file => file.split(/[\\/]/)[0] ?? file),
		]),
		likely_files: likelyFiles.length > 0 ? likelyFiles : unique(tasks.flatMap(task => task.source ?? [])),
		existing_patterns: ["Follow existing files and tests closest to each task card."],
		test_commands: testCommands,
		build_commands: buildCommands.length > 0 ? buildCommands : ["bun run check:types"],
		style_conventions: ["Keep changes scoped to files identified by the task card and current repository patterns."],
		risk_areas: tasks.map(task => `${task.id}: ${task.title}`),
		forbidden_changes: ["Do not expand beyond the Codex source plan.", "Do not edit unrelated generated artifacts."],
		task_file_map: taskFileMap,
	};
}

export async function runPlanExecutionBookGate(
	request: PlanExecutionBookGateRequest,
): Promise<PlanExecutionBookGateResult> {
	const repoPath = resolve(request.repoPath);
	const planPath = resolve(request.planPath);
	const acceptingDir = resolve(request.acceptingDir);
	await assertDir(repoPath, "repo_path");
	if (!isInside(repoPath, acceptingDir)) throw new Error("accepting_dir must stay inside repo_path");

	const planText = await readFile(planPath, "utf8");
	const actualPlanSha256 = sha256(planText);
	if (actualPlanSha256 !== request.planSha256) {
		throw new Error(`Plan SHA-256 mismatch: expected ${request.planSha256}, got ${actualPlanSha256}`);
	}

	let projectRecon = await deriveProjectRecon(repoPath, request.tasks);
	const intakeGate = [
		{ gate: "plan_path_exists", result: "PASS" as const, evidence: planPath },
		{ gate: "plan_sha256_matches", result: "PASS" as const, evidence: actualPlanSha256 },
		{ gate: "repo_path_valid", result: "PASS" as const, evidence: repoPath },
		{
			gate: "skills_resolved",
			result: "PASS" as const,
			evidence: request.skills.map(skill => skill.name).join(", "),
		},
		{
			gate: "project_recon_done",
			result: "PASS" as const,
			evidence: "Project Recon generated from repo scripts and task file map.",
		},
	];
	if (request.codebaseMemory?.enabled) {
		if (!request.codebaseMemory.provider) {
			throw new Error("Codebase Memory recon is enabled but no provider was supplied");
		}
		const codebaseMemoryRecon = await runCodebaseMemoryExecutionRecon({
			repoPath,
			acceptingDir,
			tasks: request.tasks,
			provider: request.codebaseMemory.provider,
			now: request.now,
		});
		projectRecon = mergeCodebaseMemoryProjectRecon(projectRecon, codebaseMemoryRecon);
		intakeGate.push({
			gate: "codebase_memory_recon_done",
			result: "PASS",
			evidence: codebaseMemoryRecon.evidencePath,
		});
	}
	const book = createPlanExecutionBook({
		runId: request.runId,
		planPath,
		planSha256: request.planSha256,
		repoPath,
		acceptingDir,
		intakeGate,
		projectRecon,
		requiredExecutionSkills: request.requiredExecutionSkills,
		requiredReviewSkills: request.requiredReviewSkills,
		finalTailSkills: request.finalTailSkills,
		finalAcceptanceCommands: request.finalAcceptanceCommands,
		tasks: request.tasks,
		skills: request.skills,
		now: request.now,
	});
	const bookPath = join(acceptingDir, "plan-execution-book.md");
	await writePlanExecutionBook(bookPath, book);
	const { sha256: bookSha256 } = await readPlanExecutionBookMarkdown(bookPath);
	const now = request.now ?? new Date();
	const gitState = await captureGitState(repoPath);
	const manifest: PlanRunManifest = {
		schema_version: 1,
		run_id: request.runId,
		state: "execution_book_ready",
		source_repo: repoPath,
		worktree: repoPath,
		git_state: gitState,
		plan: {
			original_path: planPath,
			worktree_path: planPath,
			sha256: request.planSha256,
		},
		skill: {
			required: request.requiredExecutionSkills[0] ?? "omp-executing-codex-plan",
			loaded: true,
			loaded_at: now.toISOString(),
		},
		execution_book: {
			path: bookPath,
			exists: true,
			task_count: book.tasks.length,
			required_execution_skills: book.required_execution_skills.map(skill => skill.name),
			required_review_skills: book.required_review_skills.map(skill => skill.name),
			final_tail_skills: book.final_tail_skills.map(skill => skill.name),
			content_sha256: bookSha256,
		},
		todos: {
			version: 1,
			state: "synced",
			source: "state-machine",
			pending_required_tasks: 0,
		},
		completion: {
			path: join(acceptingDir, "omp-completion.md"),
			exists: false,
		},
		packet: {
			valid: false,
		},
		gate_errors: [],
	};
	const todoSnapshot = createTodoSnapshotForExecutionBook({
		runId: request.runId,
		version: 1,
		state: "execution_book_ready",
		tasks: book.tasks.map(task => ({ id: task.id, title: task.title })),
		now,
	});
	manifest.todos.pending_required_tasks = todoSnapshot.phases.reduce(
		(count, phase) => count + phase.tasks.filter(task => task.status !== "completed").length,
		0,
	);

	return {
		status: "passed",
		nextAllowed: true,
		bookPath,
		bookSha256,
		book,
		manifest,
		todoSnapshot,
	};
}
