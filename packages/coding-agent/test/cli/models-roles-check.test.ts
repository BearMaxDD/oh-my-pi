/**
 * `omp models roles --check` CLI — role-model health check.
 *
 * Contract (Task5 plan + Main spec review):
 * 1. resolveModelsArgs("roles", ...) resolves via KNOWN_ACTIONS.
 * 2. roles + check flag: JSON { entries } to stdout, process.exitCode 0/1.
 * 3. TRD §15.2: exit 0 when all required roles are valid (subagent-capable).
 * 4. roles without --check: error to stderr, exit 1.
 * 5. roles with extra positional arg: exit 1.
 * 6. Legacy resolveModelsArgs ls/find/refresh/provider-name unchanged.
 * 7. ModelsCommand declares --check flag.
 */

import { describe, expect, it, spyOn } from "bun:test";
import { runModelsCommand, resolveModelsArgs } from "../../src/cli/models-cli";
import { Settings } from "../../src/config/settings";
import { getKnownRoleIds, getRoleInfo } from "../../src/config/model-roles";
import { ModelRegistry } from "../../src/config/model-registry";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import type { Model } from "@oh-my-pi/pi-ai";
import ModelsCommand from "../../src/commands/models";
import { TempDir } from "@oh-my-pi/pi-utils";
import { AuthStorage } from "@oh-my-pi/pi-ai";
import * as fs from "node:fs/promises";

function modelFixture(provider: string, id: string): Model {
	return buildModel({
		id,
		provider,
		api: "openai-completions",
		name: `${provider}/${id}`,
		baseUrl: "https://example.invalid",
		reasoning: false,
		input: ["text"] as ("text" | "image")[],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 16_000,
		maxTokens: 4_096,
	});
}

function fakeRegistry(models: Model[]): ModelRegistry {
	return {
		getAvailable: () => models,
		syncExtensionSources: () => {},
		clearSourceRegistrations: () => {},
		registerProvider: () => {},
		refreshRuntimeProviders: async () => {},
	} as unknown as ModelRegistry;
}

/**
 * Build settings + registry where every known role has a valid concrete selector.
 */
function allValidFixture(): { settings: Settings; registry: ModelRegistry } {
	const model = modelFixture("openai-completions", "gpt-4o");
	const registry = fakeRegistry([model]);
	const settings = Settings.isolated({
		modelRoles: Object.fromEntries(
			getKnownRoleIds(Settings.isolated({})).map(roleId => [roleId, "openai-completions/gpt-4o"]),
		),
	});
	return { settings, registry };
}

/** Test-local harness: captures stdout + stderr + process.exitCode + thrown errors. */
async function runModelsCommandForTest(args: {
	action: string;
	flags: Record<string, boolean>;
	pattern?: string;
	settings?: Settings;
	registry: ModelRegistry;
}): Promise<{ exitCode: number; stdout: string; stderr: string; thrown: unknown }> {
	const stdoutChunks: string[] = [];
	const stderrChunks: string[] = [];
	const origStdout = process.stdout.write.bind(process.stdout);
	const origStderr = process.stderr.write.bind(process.stderr);
	process.stdout.write = ((c: any) => { stdoutChunks.push(String(c)); return true; }) as typeof process.stdout.write;
	process.stderr.write = ((c: any) => { stderrChunks.push(String(c)); return true; }) as typeof process.stderr.write;
	const origExitCode = process.exitCode;
	process.exitCode = 0;
	let thrown: unknown = undefined;
	let exitCode: number;

	try {
		await runModelsCommand({
			action: args.action as any,
			pattern: args.pattern,
			flags: { ...args.flags } as any,
			settings: args.settings,
			modelRegistry: args.registry,
		} as any);
	} catch (e) {
		thrown = e;
	} finally {
		exitCode = process.exitCode ?? 0;
		process.stdout.write = origStdout;
		process.stderr.write = origStderr;
		process.exitCode = origExitCode;
	}
	return { exitCode, stdout: stdoutChunks.join(""), stderr: stderrChunks.join(""), thrown };
}
describe("resolveModelsArgs roles resolution", () => {
	it("resolves 'roles' as roles action via KNOWN_ACTIONS", () => {
		expect(resolveModelsArgs("roles", undefined)).toEqual({ action: "roles", pattern: undefined });
	});

	it("resolves 'roles' with --check pattern", () => {
		expect(resolveModelsArgs("roles", "--check")).toEqual({ action: "roles", pattern: "--check" });
	});
});

describe("roles --check exit code", () => {
	it("exits 0 when all subagent-capable roles are valid (TRD §15.2 — requires CLI filtering)", async () => {
		const { settings, registry } = allValidFixture();

		const result = await runModelsCommandForTest({
			action: "roles",
			flags: { check: true, json: true },
			settings,
			registry,
		});

		// TRD §15.2: exit 0 when all required roles are valid.
		// Currently entries.every checks ALL roles including default/tiny/title (non-subagent).
		// RED until CLI filters to required-only entries before evaluating executability.
		const parsed = JSON.parse(result.stdout);
		const subagentRoles = parsed.entries.filter((e: any) => getRoleInfo(e.roleId, settings).canRunAsSubagent === true);
		expect(subagentRoles.every((e: any) => e.executable)).toBe(true);
		expect(result.exitCode).toBe(0);
	});

	it("exits 1 when any subagent-capable role has invalid entries", async () => {
		const settings = Settings.isolated({});
		const registry = fakeRegistry([]);

		const result = await runModelsCommandForTest({
			action: "roles",
			flags: { check: true, json: true },
			settings,
			registry,
		});

		expect(result.exitCode).toBe(1);
		const parsed = JSON.parse(result.stdout);
		expect(parsed).toHaveProperty("entries");
		expect(Array.isArray(parsed.entries)).toBe(true);
		expect(parsed.entries.some((e: any) => !e.executable)).toBe(true);
	});

	it("exits 1 when a role is not_concrete (alias)", async () => {
		const settings = Settings.isolated({ modelRoles: { smol: "pi/smol" } });
		const registry = fakeRegistry([modelFixture("openai-completions", "gpt-4o")]);

		const result = await runModelsCommandForTest({
			action: "roles",
			flags: { check: true, json: true },
			settings,
			registry,
		});

		expect(result.exitCode).toBe(1);
	});

	it("exits 1 when a role's model is unavailable", async () => {
		const settings = Settings.isolated({ modelRoles: { smol: "openai-completions/gpt-4o" } });
		const registry = fakeRegistry([modelFixture("openai-completions", "gpt-4o-mini")]);

		const result = await runModelsCommandForTest({
			action: "roles",
			flags: { check: true, json: true },
			settings,
			registry,
		});

		expect(result.exitCode).toBe(1);
	});

	it("exits 1 when roles action has extra positional argument", async () => {
		const { settings, registry } = allValidFixture();

		const result = await runModelsCommandForTest({
			action: "roles",
			pattern: "extra-arg",
			flags: { check: true, json: true },
			settings,
			registry,
		});

		expect(result.exitCode).toBe(1);
	});
});

describe("roles --check --json output shape", () => {
	it("emits parseable JSON with entries array", async () => {
		const { settings, registry } = allValidFixture();
		const result = await runModelsCommandForTest({ action: "roles", flags: { check: true, json: true }, settings, registry });
		const parsed = JSON.parse(result.stdout);
		expect(parsed).toHaveProperty("entries");
		expect(Array.isArray(parsed.entries)).toBe(true);
	});

	it("JSON entries have stable per-role keys", async () => {
		const { settings, registry } = allValidFixture();
		const result = await runModelsCommandForTest({ action: "roles", flags: { check: true, json: true }, settings, registry });
		for (const e of JSON.parse(result.stdout).entries) {
			expect(e).toHaveProperty("roleId");
			expect(e).toHaveProperty("contractStatus");
			expect(e).toHaveProperty("modelStatus");
			expect(e).toHaveProperty("executable");
		}
	});

	it("default --check without --json emits text", async () => {
		const { settings, registry } = allValidFixture();
		const result = await runModelsCommandForTest({ action: "roles", flags: { check: true, json: false }, settings, registry });
		expect(() => JSON.parse(result.stdout)).toThrow();
	});
});

describe("roles without --check", () => {
	it("sets exit code 1", async () => {
		const { settings, registry } = allValidFixture();
		const result = await runModelsCommandForTest({ action: "roles", flags: { check: false, json: false }, settings, registry });
		expect(result.exitCode).toBe(1);
	});
});

describe("models command declaration accepts --check flag", () => {
	it("declares check flag in Models command static flags", () => {
		expect(ModelsCommand.flags).toHaveProperty("check");
	});

	it("describes roles in action arg", () => {
		expect(ModelsCommand.args.action.description).toContain("roles");
	});
});

describe("legacy resolveModelsArgs unchanged", () => {
	it("resolves 'ls' as ls action", () => {
		expect(resolveModelsArgs("ls", undefined)).toEqual({ action: "ls", pattern: undefined });
	});
	it("resolves 'list' as ls action", () => {
		expect(resolveModelsArgs("list", undefined)).toEqual({ action: "ls", pattern: undefined });
	});
	it("resolves 'find' with pattern", () => {
		expect(resolveModelsArgs("find", "gpt-4")).toEqual({ action: "find", pattern: "gpt-4" });
	});
	it("resolves 'refresh' as refresh action", () => {
		expect(resolveModelsArgs("refresh", undefined)).toEqual({ action: "refresh", pattern: undefined });
	});
	it("passes unknown tokens as ls with filter", () => {
		expect(resolveModelsArgs("openai-codex", undefined)).toEqual({ action: "ls", pattern: "openai-codex" });
	});
	it("returns ls default when no args provided", () => {
		expect(resolveModelsArgs(undefined, undefined)).toEqual({ action: "ls", pattern: undefined });
	});
});

describe("roles --check with extension-provided models", () => {
	/**
	 * The roles path must call loadCliExtensionProviders before the audit
	 * so that extension-provided models are available.  These tests inject an
	 * empty ModelRegistry with the extension flag; the assertion is "valid" when
	 * the flag is honoured (RED until roles path loads extensions internally).
	 */

	/** Write a minimal extension file that registers an ext-prov provider. */
	async function createExtensionFile(tmp: TempDir): Promise<string> {
		const extPath = tmp.join("ext.ts");
		await fs.writeFile(
			extPath,
			`export default function (pi) {
	pi.registerProvider("ext-prov", {
		baseUrl: "https://example.invalid/ext",
		apiKey: "test-key",
		api: "openai-completions",
		models: [{ id: "alpha", name: "Alpha", reasoning: false, input: ["text"], cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 }, contextWindow: 8_000, maxTokens: 4_096 }],
	});
}`,
		);
		return extPath;
	}

	it("honours explicit --extension flag: ext-prov model is valid", async () => {
		const tmp = await TempDir.create("@roles-ext-");
		try {
			const extPath = await createExtensionFile(tmp);
			const dbPath = tmp.join("auth.db");
			const authStorage = await AuthStorage.create(dbPath);
			try {
				const settings = await Settings.loadIsolated({
					inMemory: true,
					cwd: tmp.path(),
					overrides: { extensions: [], disabledExtensions: [], modelRoles: { smol: "ext-prov/alpha" } },
				});
				const modelRegistry = new ModelRegistry(authStorage);

				const result = await runModelsCommandForTest({
					action: "roles",
					flags: { check: true, json: true, extensions: [extPath] },
					settings,
					registry: modelRegistry,
				});

				const parsed = JSON.parse(result.stdout);
				const smol = parsed.entries.find((e: any) => e.roleId === "smol");
				// RED: without loadCliExtensionProviders in the roles path, the
				// extension model is unavailable.
				expect(smol.modelStatus).toBe("valid");
				expect(smol.executable).toBe(true);
			} finally {
				authStorage.close();
			}
		} finally {
			await tmp.remove();
		}
	});

	it("honours settings-configured extensions: ext-prov model is valid", async () => {
		const tmp = await TempDir.create("@roles-ext-");
		try {
			const extPath = await createExtensionFile(tmp);
			const dbPath = tmp.join("auth.db");
			const authStorage = await AuthStorage.create(dbPath);
			try {
				const settings = await Settings.loadIsolated({
					inMemory: true,
					cwd: tmp.path(),
					overrides: { extensions: [extPath], disabledExtensions: [], modelRoles: { smol: "ext-prov/alpha" } },
				});
				const modelRegistry = new ModelRegistry(authStorage);

				const result = await runModelsCommandForTest({
					action: "roles",
					flags: { check: true, json: true, extensions: [] },
					settings,
					registry: modelRegistry,
				});

				const parsed = JSON.parse(result.stdout);
				const smol = parsed.entries.find((e: any) => e.roleId === "smol");
				expect(smol.modelStatus).toBe("valid");
				expect(smol.executable).toBe(true);
			} finally {
				authStorage.close();
			}
		} finally {
			await tmp.remove();
		}
	});

	it("respects no-extensions flag: extension model is unavailable", async () => {
		const tmp = await TempDir.create("@roles-ext-");
		try {
			const extPath = await createExtensionFile(tmp);
			const dbPath = tmp.join("auth.db");
			const authStorage = await AuthStorage.create(dbPath);
			try {
				const settings = await Settings.loadIsolated({
					inMemory: true,
					cwd: tmp.path(),
					overrides: { extensions: [extPath], disabledExtensions: [], modelRoles: { smol: "ext-prov/alpha" } },
				});
				const modelRegistry = new ModelRegistry(authStorage);

				const result = await runModelsCommandForTest({
					action: "roles",
					flags: { check: true, json: true, extensions: [], noExtensions: true },
					settings,
					registry: modelRegistry,
				});

				const parsed = JSON.parse(result.stdout);
				const smol = parsed.entries.find((e: any) => e.roleId === "smol");
				expect(smol.modelStatus).toBe("unavailable");
			} finally {
				authStorage.close();
			}
		} finally {
			await tmp.remove();
		}
	});

	it("--no-extensions still loads explicit -e extension path", async () => {
		const tmp = await TempDir.create("@roles-ext-");
		try {
			const extPath = await createExtensionFile(tmp);
			const dbPath = tmp.join("auth.db");
			const authStorage = await AuthStorage.create(dbPath);
			try {
				const settings = await Settings.loadIsolated({
					inMemory: true,
					cwd: tmp.path(),
					overrides: { extensions: [], disabledExtensions: [], modelRoles: { smol: "ext-prov/alpha" } },
				});
				const modelRegistry = new ModelRegistry(authStorage);

				const result = await runModelsCommandForTest({
					action: "roles",
					flags: { check: true, json: true, extensions: [extPath], noExtensions: true },
					settings,
					registry: modelRegistry,
				});

				const parsed = JSON.parse(result.stdout);
				const smol = parsed.entries.find((e: any) => e.roleId === "smol");
				// --no-extensions disables discovery only; explicit -e paths still load.
				expect(smol.modelStatus).toBe("valid");
				expect(smol.executable).toBe(true);
			} finally {
				authStorage.close();
			}
		} finally {
			await tmp.remove();
		}
	});

	it("exits 2 on extension-load failure (no throw, stderr diagnostic)", async () => {
		const tmp = await TempDir.create("@roles-ext-");
		try {
			const extPath = tmp.join("broken.ts");
			await fs.writeFile(extPath, `export default function (pi) { throw new Error("boom"); }`);
			const dbPath = tmp.join("auth.db");
			const authStorage = await AuthStorage.create(dbPath);
			try {
				const settings = await Settings.loadIsolated({
					inMemory: true,
					cwd: tmp.path(),
					overrides: { extensions: [], disabledExtensions: [], modelRoles: { smol: "openai-completions/gpt-4o" } },
				});
				const modelRegistry = new ModelRegistry(authStorage);

				const result = await runModelsCommandForTest({
					action: "roles",
					flags: { check: true, json: true, extensions: [extPath] },
					settings,
					registry: modelRegistry,
				});

				// Infrastructure failure → clean catch, exit 2, no throw.
				expect(result.thrown).toBeUndefined();
				expect(result.exitCode).toBe(2);
				expect(result.stderr.length).toBeGreaterThan(0);
			} finally {
				authStorage.close();
			}
		} finally {
			await tmp.remove();
		}
	});

	it("exits 2 on Settings.init failure (no throw, stderr diagnostic)", async () => {
		const tmp = await TempDir.create("@roles-settings-");
		try {
			const spy = spyOn(Settings, "init");
			spy.mockRejectedValue(new Error("simulated settings init failure"));
			const authStorage = await AuthStorage.create(tmp.join("auth.db"));
			try {
				const modelRegistry = new ModelRegistry(authStorage);

				const result = await runModelsCommandForTest({
					action: "roles",
					flags: { check: true, json: true },
					registry: modelRegistry,
					// settings deliberately omitted to trigger Settings.init()
				});

				expect(result.thrown).toBeUndefined();
				expect(result.exitCode).toBe(2);
				expect(result.stderr.length).toBeGreaterThan(0);
			} finally {
				authStorage.close();
				spy.mockRestore();
			}
		} finally {
			await tmp.remove();
		}
	});

	it("exits 2 on registry runtime operation failure (no throw, stderr diagnostic)", async () => {
		const tmp = await TempDir.create("@roles-reg-");
	let syncSpy: { mockRestore(): void } | undefined;
		try {
			const extPath = await createExtensionFile(tmp);
			const dbPath = tmp.join("auth.db");
			const authStorage = await AuthStorage.create(dbPath);
			try {
				const settings = await Settings.loadIsolated({
					inMemory: true,
					cwd: tmp.path(),
					overrides: { extensions: [extPath], disabledExtensions: [], modelRoles: { smol: "ext-prov/alpha" } },
				});
				const modelRegistry = new ModelRegistry(authStorage);
				syncSpy = spyOn(modelRegistry, "syncExtensionSources");
				syncSpy.mockImplementation(() => { throw new Error("registry sync failed"); });

				const result = await runModelsCommandForTest({
					action: "roles",
					flags: { check: true, json: true, extensions: [extPath] },
					settings,
					registry: modelRegistry,
				});

				expect(result.thrown).toBeUndefined();
				expect(result.exitCode).toBe(2);
				expect(result.stderr.length).toBeGreaterThan(0);
			} finally {
				if (syncSpy) syncSpy.mockRestore();
				authStorage.close();
			}
		} finally {
			await tmp.remove();
		}
	});
});
