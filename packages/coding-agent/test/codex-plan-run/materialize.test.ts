import { afterEach, describe, expect, it } from "bun:test";
import { constants } from "node:fs";
import { mkdir, mkdtemp, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { materializePlanIntoWorktree, sha256Text } from "../../src/codex-plan-run/materialize";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "omp-plan-run-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) {
		await rm(dir, { recursive: true, force: true });
	}
});

describe("materializePlanIntoWorktree", () => {
	it("copies the source plan into the worktree and validates sha256", async () => {
		const root = await makeTempDir();
		const sourcePlanPath = join(root, "source-plan.md");
		const worktree = join(root, "worktree");
		const text = "# Demo plan\n\nBody\n";
		await Bun.write(sourcePlanPath, text);

		const result = await materializePlanIntoWorktree({
			sourcePlanPath,
			worktreePath: worktree,
			expectedSha256: sha256Text(text),
		});

		expect(result.worktreePlanPath.endsWith(`docs/superpowers/plans/${basename(sourcePlanPath)}`)).toBe(true);
		expect(result.actualSha256).toBe(sha256Text(text));
		expect(await Bun.file(result.worktreePlanPath).text()).toBe(text);
	});

	it("throws when the source plan hash does not match", async () => {
		const root = await makeTempDir();
		const sourcePlanPath = join(root, "source-plan.md");
		await Bun.write(sourcePlanPath, "# Demo\n");

		await expect(
			materializePlanIntoWorktree({
				sourcePlanPath,
				worktreePath: join(root, "worktree"),
				expectedSha256: "bad-sha",
			}),
		).rejects.toThrow("Plan SHA-256 mismatch");
	});

	it("rejects targetRelativePath values that escape the worktree", async () => {
		const root = await makeTempDir();
		const sourcePlanPath = join(root, "source-plan.md");
		const text = "# Demo\n";
		await Bun.write(sourcePlanPath, text);

		await expect(
			materializePlanIntoWorktree({
				sourcePlanPath,
				worktreePath: join(root, "worktree"),
				expectedSha256: sha256Text(text),
				targetRelativePath: "../outside.md",
			}),
		).rejects.toThrow("targetRelativePath must stay inside worktree");
	});

	it("rejects absolute targetRelativePath values", async () => {
		const root = await makeTempDir();
		const sourcePlanPath = join(root, "source-plan.md");
		const text = "# Demo\n";
		await Bun.write(sourcePlanPath, text);

		await expect(
			materializePlanIntoWorktree({
				sourcePlanPath,
				worktreePath: join(root, "worktree"),
				expectedSha256: sha256Text(text),
				targetRelativePath: join(root, "outside.md"),
			}),
		).rejects.toThrow("targetRelativePath must stay inside worktree");
	});

	it("rejects empty targetRelativePath values", async () => {
		const root = await makeTempDir();
		const sourcePlanPath = join(root, "source-plan.md");
		const text = "# Demo\n";
		await Bun.write(sourcePlanPath, text);

		await expect(
			materializePlanIntoWorktree({
				sourcePlanPath,
				worktreePath: join(root, "worktree"),
				expectedSha256: sha256Text(text),
				targetRelativePath: "",
			}),
		).rejects.toThrow("targetRelativePath must stay inside worktree");
	});

	it("allows custom targetRelativePath values inside the worktree", async () => {
		const root = await makeTempDir();
		const sourcePlanPath = join(root, "source-plan.md");
		const worktree = join(root, "worktree");
		const text = "# Demo\n";
		await Bun.write(sourcePlanPath, text);

		const result = await materializePlanIntoWorktree({
			sourcePlanPath,
			worktreePath: worktree,
			expectedSha256: sha256Text(text),
			targetRelativePath: ".omp/runs/run-1/plan.md",
		});

		expect(result.worktreePlanPath).toBe(join(worktree, ".omp/runs/run-1/plan.md"));
		expect(await Bun.file(result.worktreePlanPath).text()).toBe(text);
	});

	it("initializes autonomous evidence artifacts in the accepting directory", async () => {
		const root = await makeTempDir();
		const sourcePlanPath = join(root, "source-plan.md");
		const worktree = join(root, "worktree");
		const acceptingDir = join(worktree, "docs", "superpowers", "accepting", "demo");
		const text = "# Demo\n";
		await Bun.write(sourcePlanPath, text);

		await materializePlanIntoWorktree({
			sourcePlanPath,
			worktreePath: worktree,
			expectedSha256: sha256Text(text),
			acceptingDir,
			taskIds: ["T01", "T02"],
			skillDiscoveryReport: { ok: true, found: ["using-superpowers"], missing: [] },
			superpowersBootstrapEvidence: { loaded: true, package: "superpowers-zh" },
		});

		expect(await Bun.file(join(acceptingDir, "tdd-evidence-matrix.json")).json()).toEqual({
			tasks: { T01: [], T02: [] },
		});
		expect(await Bun.file(join(acceptingDir, "skill-evidence-matrix.json")).json()).toEqual({
			tasks: { T01: [], T02: [] },
		});
		expect(await Bun.file(join(acceptingDir, "advisor-summary.json")).json()).toEqual({ items: [] });
		expect(await Bun.file(join(acceptingDir, "skill-discovery-report.json")).json()).toEqual({
			ok: true,
			found: ["using-superpowers"],
			missing: [],
		});
		expect(await Bun.file(join(acceptingDir, "superpowers-bootstrap-evidence.json")).json()).toEqual({
			loaded: true,
			package: "superpowers-zh",
		});
	});

	it("does not overwrite existing autonomous evidence artifacts", async () => {
		const root = await makeTempDir();
		const sourcePlanPath = join(root, "source-plan.md");
		const worktree = join(root, "worktree");
		const acceptingDir = join(worktree, "docs", "superpowers", "accepting", "demo");
		const text = "# Demo\n";
		await Bun.write(sourcePlanPath, text);
		await materializePlanIntoWorktree({
			sourcePlanPath,
			worktreePath: worktree,
			expectedSha256: sha256Text(text),
			acceptingDir,
			taskIds: ["T01"],
		});

		await Bun.write(
			join(acceptingDir, "tdd-evidence-matrix.json"),
			`${JSON.stringify({ tasks: { T01: [{ kind: "RED_EVIDENCE" }] } }, null, 2)}\n`,
		);
		await Bun.write(
			join(acceptingDir, "advisor-summary.json"),
			`${JSON.stringify({ items: [{ severity: "blocker", status: "open", message: "keep me", turn_id: 1 }] }, null, 2)}\n`,
		);

		await materializePlanIntoWorktree({
			sourcePlanPath,
			worktreePath: worktree,
			expectedSha256: sha256Text(text),
			acceptingDir,
			taskIds: ["T01"],
		});

		expect(await Bun.file(join(acceptingDir, "tdd-evidence-matrix.json")).json()).toEqual({
			tasks: { T01: [{ kind: "RED_EVIDENCE" }] },
		});
		expect(await Bun.file(join(acceptingDir, "advisor-summary.json")).json()).toEqual({
			items: [{ severity: "blocker", status: "open", message: "keep me", turn_id: 1 }],
		});
	});

	it("rejects targetRelativePath values that escape through a worktree symlink", async () => {
		const root = await makeTempDir();
		const sourcePlanPath = join(root, "source-plan.md");
		const worktree = join(root, "worktree");
		const outside = join(root, "outside");
		const text = "# Demo\n";
		await Bun.write(sourcePlanPath, text);
		await mkdir(worktree);
		await mkdir(outside);
		await symlink(outside, join(worktree, "link"), "dir");

		await expect(
			materializePlanIntoWorktree({
				sourcePlanPath,
				worktreePath: worktree,
				expectedSha256: sha256Text(text),
				targetRelativePath: "link/plan.md",
			}),
		).rejects.toThrow("targetRelativePath must stay inside worktree");
		expect(await Bun.file(join(outside, "plan.md")).exists()).toBe(false);
	});

	it("rejects the default target path when the final file is a symlink outside the worktree", async () => {
		const root = await makeTempDir();
		const sourcePlanPath = join(root, "source-plan.md");
		const worktree = join(root, "worktree");
		const outside = join(root, "outside");
		const text = "# Demo\n";
		await Bun.write(sourcePlanPath, text);
		await mkdir(join(worktree, "docs", "superpowers", "plans"), { recursive: true });
		await mkdir(outside);
		await symlink(
			join(outside, "escaped.md"),
			join(worktree, "docs", "superpowers", "plans", basename(sourcePlanPath)),
		);

		await expect(
			materializePlanIntoWorktree({
				sourcePlanPath,
				worktreePath: worktree,
				expectedSha256: sha256Text(text),
			}),
		).rejects.toThrow("targetRelativePath must stay inside worktree");
		expect(await Bun.file(join(outside, "escaped.md")).exists()).toBe(false);
	});

	it("uses a no-follow final file open when the platform supports it", async () => {
		if (typeof constants.O_NOFOLLOW !== "number") return;

		const source = await Bun.file(new URL("../../src/codex-plan-run/materialize.ts", import.meta.url)).text();

		expect(source).toContain("open(");
		expect(source).toContain("O_NOFOLLOW");
	});

	it("uses parent directory fd-relative writes when the platform supports directory fds", async () => {
		if (typeof constants.O_DIRECTORY !== "number") return;

		const source = await Bun.file(new URL("../../src/codex-plan-run/materialize.ts", import.meta.url)).text();

		expect(source).toContain("O_DIRECTORY");
		expect(source).toContain("/dev/fd");
		expect(source).toContain("/proc/self/fd");
	});

	it("opens and verifies the parent directory fd before final writes", async () => {
		if (typeof constants.O_DIRECTORY !== "number" || typeof constants.O_NOFOLLOW !== "number") return;

		const source = await Bun.file(new URL("../../src/codex-plan-run/materialize.ts", import.meta.url)).text();

		expect(source).toContain("parentOpenFlags");
		expect(source).toMatch(/parentOpenFlags[\s\S]*O_DIRECTORY[\s\S]*O_NOFOLLOW/);
		expect(source).toContain("realpathFd");
		expect(source).toContain("parentFdRealPath !== parentRealPath");
	});
});
