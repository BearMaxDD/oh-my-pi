import { afterEach, describe, expect, test, vi } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import type { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { AgentDashboard } from "@oh-my-pi/pi-coding-agent/modes/components/agent-dashboard";
import { initTheme } from "@oh-my-pi/pi-coding-agent/modes/theme/theme";
import type { SuperpowersAgentSyncResult } from "@oh-my-pi/pi-coding-agent/superpowers/agent-bridge";

const tempDirs: string[] = [];

const settingsStub = {
	get: (_key: string) => undefined,
	set: (_key: string, _value: unknown) => {},
	getModelRole: (_role: string) => undefined,
} as unknown as Settings;

async function makeTempCwd(): Promise<string> {
	const dir = await fs.mkdtemp(path.join(os.tmpdir(), "omp-agent-dashboard-sync-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) {
		await fs.rm(dir, { recursive: true, force: true }).catch(() => {});
	}
	vi.restoreAllMocks();
});

describe("AgentDashboard superpowers sync", () => {
	test("lowercase 's' does not invoke sync stub", async () => {
		initTheme(false);
		const cwd = await makeTempCwd();

		const stub = vi.fn().mockResolvedValue({
			targetDir: cwd,
			written: [],
			updated: [],
			skipped: [],
			conflicts: [],
		} as SuperpowersAgentSyncResult);

		const dashboard = await AgentDashboard.create(cwd, settingsStub, 24, {
			syncSuperpowersAgentsForDashboard: stub,
		});

		dashboard.handleInput("s");

		// Lowercase s is a searchable char, not a sync command — sync is never invoked.
		expect(stub).toHaveBeenCalledTimes(0);
	});

	test("uppercase S invokes syncSuperpowersAgentsForDashboard and sets notice", async () => {
		initTheme(false);
		const cwd = await makeTempCwd();

		const syncResult: SuperpowersAgentSyncResult = {
			targetDir: cwd,
			written: ["tdd-writer.md", "implementer.md"],
			updated: ["reviewer.md"],
			skipped: [],
			conflicts: [],
		};
		const stub = vi.fn().mockResolvedValue(syncResult);

		const dashboard = await AgentDashboard.create(cwd, settingsStub, 24, {
			syncSuperpowersAgentsForDashboard: stub,
		});

		// Wire a promise that resolves when the sync's render request fires
		const { promise: syncRenderDone, resolve: markSyncRenderDone } = Promise.withResolvers<void>();
		dashboard.onRequestRender = () => markSyncRenderDone();

		dashboard.handleInput("S");

		// Wait for the async sync method chain to complete (it calls #rebuildAndRender)
		await syncRenderDone;

		expect(stub).toHaveBeenCalledTimes(1);
		const rendered = dashboard.render(80).join("");
		expect(rendered).toContain("Superpowers agents synced");
	});

	test("disabled bridge via setting shows notice and does not invoke sync stub", async () => {
		initTheme(false);
		const cwd = await makeTempCwd();

		const disabledSettings = {
			get: (key: string) => {
				if (key === "superpowers.agents.enabled") return false;
				return undefined;
			},
			set: (_key: string, _value: unknown) => {},
			getModelRole: (_role: string) => undefined,
		} as unknown as Settings;

		const stub = vi.fn().mockResolvedValue({
			targetDir: cwd,
			written: [],
			updated: [],
			skipped: [],
			conflicts: [],
		} as SuperpowersAgentSyncResult);

		const dashboard = await AgentDashboard.create(cwd, disabledSettings, 24, {
			syncSuperpowersAgentsForDashboard: stub,
		});

		const { promise: syncRenderDone, resolve: markSyncRenderDone } = Promise.withResolvers<void>();
		dashboard.onRequestRender = () => markSyncRenderDone();

		dashboard.handleInput("S");

		// Wait for the async sync method chain to complete (it calls #rebuildAndRender)
		await syncRenderDone;

		expect(stub).toHaveBeenCalledTimes(0);
		const rendered = dashboard.render(80).join("");
		expect(rendered).toContain("Superpowers agent bridge is disabled");
	});
});
