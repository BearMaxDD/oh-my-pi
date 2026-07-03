import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export type WorkspaceState =
	| {
			kind: "git";
			root: string;
			branch: string;
			head: string;
			status_short: string;
			changed_files: string[];
			hash: string;
	  }
	| {
			kind: "non_git";
			root: string;
			changed_files: string[];
			hash: string;
	  };

function sha256(value: unknown): string {
	return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

async function git(cwd: string, args: string[]): Promise<string> {
	const result = await execFileAsync("git", args, { cwd });
	return result.stdout.trim();
}

export async function collectWorkspaceState(cwd: string): Promise<WorkspaceState> {
	try {
		const root = await git(cwd, ["rev-parse", "--show-toplevel"]);
		const branch = await git(root, ["branch", "--show-current"]);
		const head = await git(root, ["rev-parse", "HEAD"]);
		const status_short = await git(root, ["status", "--short"]);
		const changed_files = status_short
			.split("\n")
			.map(line => line.slice(3).trim())
			.filter(Boolean);
		const state = { kind: "git" as const, root, branch, head, status_short, changed_files };
		return { ...state, hash: sha256(state) };
	} catch {
		const state = { kind: "non_git" as const, root: cwd, changed_files: [] };
		return { ...state, hash: sha256(state) };
	}
}
