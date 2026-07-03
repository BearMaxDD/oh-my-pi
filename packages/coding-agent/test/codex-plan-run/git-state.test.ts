import { describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectWorkspaceState } from "../../src/codex-plan-run/git-state";

describe("workspace state collection", () => {
	it("returns non_git state outside a git repository", async () => {
		const dir = await mkdtemp(join(tmpdir(), "omp-plan-run-non-git-"));
		try {
			const state = await collectWorkspaceState(dir);
			expect(state.kind).toBe("non_git");
			expect(state.root).toBe(dir);
			expect(state.changed_files).toEqual([]);
			expect(state.hash).toHaveLength(64);
		} finally {
			await rm(dir, { recursive: true, force: true });
		}
	});
});
