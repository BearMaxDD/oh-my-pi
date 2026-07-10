/**
 * Model role batch atomic write — Settings.setModelRolesAtomic.
 *
 * Contract:
 * 1. Atomic batch: one persist write, runtime override for batch roles updated,
 *    override for unbatch roles preserved.
 * 2. Rename failure: restores in-memory global, override layer, and original
 *    file; throws SettingsPersistenceError.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "bun:test";
import * as fs from "node:fs";
import * as path from "node:path";
import { Settings } from "../../src/config/settings";
import { AgentStorage } from "@oh-my-pi/pi-coding-agent/session/agent-storage";
import { getProjectAgentDir, TempDir } from "@oh-my-pi/pi-utils";
import { YAML } from "bun";
import { beginSettingsTest, restoreSettingsTestState, type SettingsTestState } from "../helpers/settings-test-state";

describe("Settings.setModelRolesAtomic", () => {
	let settingsState: SettingsTestState | undefined;
	let tempDir: TempDir;
	let agentDir: string;
	let projectDir: string;

	const getConfigPath = () => path.join(agentDir, "config.yml");

	const writeSettings = async (s: Record<string, unknown>) => {
		await Bun.write(getConfigPath(), YAML.stringify(s, null, 2));
	};

	const readConfigRole = async (role: string): Promise<string | undefined> => {
		const file = Bun.file(getConfigPath());
		if (!(await file.exists())) return undefined;
		const parsed = YAML.parse(await file.text()) as Record<string, unknown> | null;
		if (!parsed || typeof parsed !== "object") return undefined;
		const modelRoles = parsed.modelRoles as Record<string, string> | undefined;
		return modelRoles?.[role];
	};

	beforeEach(() => {
		settingsState = beginSettingsTest();
		tempDir = TempDir.createSync("@batch-settings-test-");
		agentDir = tempDir.join("agent");
		projectDir = tempDir.join("project");
		fs.mkdirSync(agentDir, { recursive: true });
		fs.mkdirSync(getProjectAgentDir(projectDir), { recursive: true });
	});

	afterEach(async () => {
		AgentStorage.resetInstance();
		restoreSettingsTestState(settingsState);
		settingsState = undefined;
		await Bun.sleep(0);
		await tempDir?.remove();
	});

	it("一次批量更新只持久化一次并保留既有 runtime override", async () => {
		await writeSettings({
			modelRoles: { "superpowers:implementer": "old/a" },
		});

		const settings = await Settings.loadIsolated({ cwd: projectDir, agentDir });

		// Override a batch role to shadow persisted value
		settings.override("modelRoles", { "superpowers:implementer": "old/a" });

		// Spy on rename — the atomic commit indicator, called exactly once
		// per successful atomic save regardless of how the temp file is written.
		const renameSpy = vi.spyOn(fs.promises, "rename");

		const result = await settings.setModelRolesAtomic({
			"superpowers:implementer": "openai/gpt-5.2-codex:high",
			"superpowers:test-runner": "openai/gpt-5.2-codex:high",
		});

		expect(result.changedRoleIds).toEqual(["superpowers:implementer", "superpowers:test-runner"]);
		expect(renameSpy).toHaveBeenCalledTimes(1);

		// Runtime override updated for batch roles
		expect(settings.getModelRole("superpowers:implementer")).toBe("openai/gpt-5.2-codex:high");
		expect(settings.getModelRole("superpowers:test-runner")).toBe("openai/gpt-5.2-codex:high");

		// Override layer updated for batch roles
		expect(settings.getModelRoleOverride("superpowers:implementer")).toBe("openai/gpt-5.2-codex:high");

		// Both assignments persisted to disk
		const saved = YAML.parse(await Bun.file(getConfigPath()).text()) as Record<string, unknown>;
		const savedRoles = saved.modelRoles as Record<string, string>;
		expect(savedRoles["superpowers:implementer"]).toBe("openai/gpt-5.2-codex:high");
		expect(savedRoles["superpowers:test-runner"]).toBe("openai/gpt-5.2-codex:high");

		renameSpy.mockRestore();
	});

	it("rename 失败时恢复内存、override 与磁盘原文件", async () => {
		await writeSettings({
			modelRoles: { default: "old/model", smol: "old/smol" },
		});

		const settings = await Settings.loadIsolated({ cwd: projectDir, agentDir });

		// Seed a runtime override distinct from the persisted value
		settings.override("modelRoles", { default: "override/model" });

		// Capture pre-failure state
		const preOverride = settings.getModelRoleOverride("default");
		const preEffective = settings.getModelRole("default");

		// Force rename to reject
		const renameSpy = vi.spyOn(fs.promises, "rename").mockRejectedValue(new Error("disk full"));

		await expect(settings.setModelRolesAtomic({ default: "new/model" })).rejects.toThrow("SettingsPersistenceError");

		renameSpy.mockRestore();

		// Override restored
		expect(settings.getModelRoleOverride("default")).toBe(preOverride);
		// Effective value restored
		expect(settings.getModelRole("default")).toBe(preEffective);
		// File unchanged on disk
		expect(await readConfigRole("default")).toBe("old/model");
		// Unchanged role intact
		expect(await readConfigRole("smol")).toBe("old/smol");
	});

	it("pending set('modelRoles') changes survive concurrent atomic save", async () => {
		await writeSettings({
			modelRoles: { default: "old/default" },
		});

		const settings = await Settings.loadIsolated({ cwd: projectDir, agentDir });

		// Set via generic API — enqueued in debounced save but not yet flushed
		settings.set("modelRoles", { ...settings.getModelRoles(), default: "new/default" });

		// Atomic save of a different role
		await settings.setModelRolesAtomic({ smol: "anthropic/claude-haiku-4-5" });

		// Flush any pending debounced saves
		await settings.flush();

		// Both changes must be on disk: generic set's default update AND atomic smol
		expect(await readConfigRole("default")).toBe("new/default");
		expect(await readConfigRole("smol")).toBe("anthropic/claude-haiku-4-5");
	});

	it("concurrent atomic transactions do not roll back a prior success", async () => {
		await writeSettings({
			modelRoles: { roleA: "old/A" },
		});

		const settings = await Settings.loadIsolated({ cwd: projectDir, agentDir });

		// Mock rename: first call executes the real rename; second call rejects.
		// This simulates one transaction committing while a concurrent one fails.
		const realRename = fs.promises.rename.bind(fs.promises);
		const renameSpy = vi
			.spyOn(fs.promises, "rename")
			.mockImplementationOnce((from: string, to: string) => realRename(from, to))
			.mockRejectedValueOnce(new Error("disk full"));
		const p1 = settings.setModelRolesAtomic({ roleA: "new/A" });
		const p2 = settings.setModelRolesAtomic({ roleB: "new/B" });

		const [r1, r2] = await Promise.allSettled([p1, p2]);

		renameSpy.mockRestore();

		expect(r1.status).toBe("fulfilled");
		expect(r2.status).toBe("rejected");
		if (r2.status === "rejected") {
			expect(r2.reason).toBeInstanceOf(Error);
		}

		// First transaction's changes must survive on disk
		expect(await readConfigRole("roleA")).toBe("new/A");
		expect(settings.getModelRole("roleA")).toBe("new/A");
	});

	it("atomic save does not resurrect a role removed by pending generic set", async () => {
		await writeSettings({
			modelRoles: { default: "old/model", smol: "old/smol" },
		});

		const settings = await Settings.loadIsolated({ cwd: projectDir, agentDir });

		// Remove "default" via generic set — enqueued but not flushed
		const { default: _, ...remainingRoles } = settings.getModelRoles();
		settings.set("modelRoles", remainingRoles as Record<string, string>);

		// Atomic save of a different role
		await settings.setModelRolesAtomic({ smol: "new/smol" });

		// Flush pending debounced save
		await settings.flush();

		// The removed role must not be resurrected by the atomic path
		const saved = YAML.parse(await Bun.file(getConfigPath()).text()) as Record<string, unknown>;
		const savedRoles = saved.modelRoles as Record<string, string> | undefined;
		expect(savedRoles?.default).toBeUndefined();
		expect(savedRoles?.smol).toBe("new/smol");
	});

	it("empty overlay model role value does not cause atomic rename to throw", async () => {
		await writeSettings({
			modelRoles: { default: "old/model" },
		});

		const settings = await Settings.loadIsolated({ cwd: projectDir, agentDir });

		// Simulate empty overlay value for the SAME role being atomically assigned
		settings.override("modelRoles", { default: "" });

		// Atomic save must succeed despite empty overlay value
		await expect(
			settings.setModelRolesAtomic({ default: "new/model" }),
		).resolves.toBeDefined();

		// Effective value must be the assigned one, not the empty overlay
		expect(settings.getModelRole("default")).toBe("new/model");
		expect(settings.getModelRoleOverride("default")).toBe("new/model");
		// Disk must also reflect the assignment
		expect(await readConfigRole("default")).toBe("new/model");
	});

	it("deterministic interleaving: generic set then atomic save on overlapping roles", async () => {
		await writeSettings({
			modelRoles: { roleA: "old/A", roleB: "old/B" },
		});

		const settings = await Settings.loadIsolated({ cwd: projectDir, agentDir });

		// Generic set: disjoint roleA + overlapping roleB
		settings.set("modelRoles", { roleA: "gen/A", roleB: "gen/B" });

		// Atomic set: overlapping roleB + disjoint roleC
		await settings.setModelRolesAtomic({ roleB: "atomic/B", roleC: "atomic/C" });

		await settings.flush();

		// Generic's disjoint role preserved
		expect(await readConfigRole("roleA")).toBe("gen/A");
		// Overlapping role — atomic (latest write) wins
		expect(await readConfigRole("roleB")).toBe("atomic/B");
		// Atomic's disjoint role persisted
		expect(await readConfigRole("roleC")).toBe("atomic/C");
	});

	it("secure file mode preserved after atomic write", async () => {
		await writeSettings({
			modelRoles: { default: "old/model" },
		});

		const settings = await Settings.loadIsolated({ cwd: projectDir, agentDir });

		// Seed a restrictive mode that differs from the default umask
		await fs.promises.chmod(getConfigPath(), 0o600);
		const beforeMode = (await fs.promises.stat(getConfigPath())).mode & 0o777;
		expect(beforeMode).toBe(0o600);

		await settings.setModelRolesAtomic({ default: "new/model" });

		// Atomic write (temp + rename) must preserve the restrictive mode
		const afterMode = (await fs.promises.stat(getConfigPath())).mode & 0o777;
		expect(afterMode).toBe(0o600);

		expect(await readConfigRole("default")).toBe("new/model");
	});

	it("temp file created at restrictive mode before content write (wx 0o600 pattern)", async () => {
		await writeSettings({
			modelRoles: { default: "old/model" },
		});

		const settings = await Settings.loadIsolated({ cwd: projectDir, agentDir });
		await fs.promises.chmod(getConfigPath(), 0o600);

		// Spy on open calls — temp file creation must use wx flag and 0o600 mode.
		// try/finally ensures cleanup even when the RED assertion throws.
		const openSpy = vi.spyOn(fs.promises, "open");
		try {
			await settings.setModelRolesAtomic({ default: "new/model" });

			// Find open calls that target the atomic temp file (same dir, starts
			// with .<config-basename>., ends .tmp) and use exclusive creation + 0o600.
			const configBasename = path.basename(getConfigPath());
			const configDir = path.dirname(getConfigPath());
			const tempOpenCalls = openSpy.mock.calls.filter(
				([pathArg, flag, mode]) => {
					if (typeof pathArg !== "string" || flag !== "wx" || mode !== 0o600) return false;
					const dir = path.dirname(pathArg);
					const base = path.basename(pathArg);
					return dir === configDir && base.startsWith(`.${configBasename}.`) && base.endsWith(".tmp");
				},
			);
			expect(tempOpenCalls.length).toBeGreaterThanOrEqual(1);
		} finally {
			openSpy.mockRestore();
		}
	});
});
