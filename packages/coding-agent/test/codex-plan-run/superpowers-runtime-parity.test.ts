import { describe, expect, it } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AgentMessage } from "@oh-my-pi/pi-agent-core";
import { clearCache } from "@oh-my-pi/pi-coding-agent/capability/fs";
import { validateSuperpowersSkillDiscovery } from "@oh-my-pi/pi-coding-agent/codex-plan-run/skill-gate";
import { ModelRegistry } from "@oh-my-pi/pi-coding-agent/config/model-registry";
import { discoverAndLoadExtensions } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/loader";
import { ExtensionRunner } from "@oh-my-pi/pi-coding-agent/extensibility/extensions/runner";
import { loadSkills } from "@oh-my-pi/pi-coding-agent/extensibility/skills";
import { AuthStorage } from "@oh-my-pi/pi-coding-agent/session/auth-storage";
import { SessionManager } from "@oh-my-pi/pi-coding-agent/session/session-manager";

async function createSkill(root: string, name: string): Promise<void> {
	const dir = join(root, "skills", name);
	await mkdir(dir, { recursive: true });
	await writeFile(join(dir, "SKILL.md"), `---\nname: ${name}\ndescription: ${name} test skill\n---\n\n# ${name}\n`);
}

function textFromMessages(messages: AgentMessage[]): string {
	return JSON.stringify(messages);
}

describe("superpowers runtime parity", () => {
	it("discovers superpowers skills from a configured OMP extension package root", async () => {
		clearCache();
		const tempRoot = await mkdtemp(join(tmpdir(), "superpowers-omp-package-"));
		try {
			const project = join(tempRoot, "project");
			const packageRoot = join(tempRoot, "superpowers-zh");
			await mkdir(join(project, ".git"), { recursive: true });
			await mkdir(join(project, ".omp"), { recursive: true });
			await mkdir(join(packageRoot, ".pi", "extensions"), { recursive: true });
			await writeFile(join(project, ".omp", "settings.json"), JSON.stringify({ extensions: [packageRoot] }));
			await writeFile(
				join(packageRoot, "package.json"),
				JSON.stringify({ name: "superpowers-zh", pi: { extensions: ["./.pi/extensions/superpowers.ts"] } }),
			);
			await writeFile(join(packageRoot, ".pi", "extensions", "superpowers.ts"), "export default function () {}\n");
			for (const name of [
				"using-superpowers",
				"brainstorming",
				"test-driven-development",
				"systematic-debugging",
				"requesting-code-review",
				"verification-before-completion",
			]) {
				await createSkill(packageRoot, name);
			}

			const result = await loadSkills({ cwd: project });

			expect(validateSuperpowersSkillDiscovery(result.skills).ok).toBe(true);
		} finally {
			clearCache();
			await rm(tempRoot, { recursive: true, force: true });
		}
	});

	it("keeps superpowers provider context active across session_start and session_compact", async () => {
		clearCache();
		const tempRoot = await mkdtemp(join(tmpdir(), "superpowers-omp-runtime-"));
		let authStorage: AuthStorage | undefined;
		try {
			const project = join(tempRoot, "project");
			const packageRoot = join(tempRoot, "superpowers-zh");
			await mkdir(join(project, ".git"), { recursive: true });
			await mkdir(join(project, ".omp"), { recursive: true });
			await mkdir(join(packageRoot, ".pi", "extensions"), { recursive: true });
			await writeFile(join(project, ".omp", "settings.json"), JSON.stringify({ extensions: [packageRoot] }));
			await writeFile(
				join(packageRoot, "package.json"),
				JSON.stringify({ name: "superpowers-zh", pi: { extensions: ["./.pi/extensions/superpowers.ts"] } }),
			);
			await writeFile(
				join(packageRoot, ".pi", "extensions", "superpowers.ts"),
				`
let lifecycle = "boot";
let revision = 0;

function message() {
	return {
		role: "developer",
		content: [
			{
				type: "text",
				text: "You have superpowers. Superpowers-ZH runtime active. lifecycle=" + lifecycle + " revision=" + revision,
			},
		],
		timestamp: Date.now(),
		synthetic: true,
	};
}

export default function(pi) {
	pi.on("session_start", async () => {
		lifecycle = "session_start";
		revision += 1;
	});
	pi.on("session_compact", async () => {
		lifecycle = "session_compact";
		revision += 1;
	});
	pi.on("context", async event => {
		return { messages: [message(), ...event.messages] };
	});
}
`,
			);

			const loaded = await discoverAndLoadExtensions([packageRoot], project);
			authStorage = await AuthStorage.create(join(tempRoot, "auth.db"));
			const runner = new ExtensionRunner(
				loaded.extensions,
				loaded.runtime,
				project,
				SessionManager.inMemory(),
				new ModelRegistry(authStorage),
			);
			runner.initialize(
				{
					sendMessage: () => {},
					sendUserMessage: () => {},
					appendEntry: () => {},
					setLabel: () => {},
					getActiveTools: () => [],
					getAllTools: () => [],
					setActiveTools: async () => {},
					getCommands: () => [],
					setModel: async () => false,
					getThinkingLevel: () => undefined,
					setThinkingLevel: () => {},
					getSessionName: () => undefined,
					setSessionName: async () => {},
				} as never,
				{
					getModel: () => undefined,
					isIdle: () => true,
					abort: () => {},
					hasPendingMessages: () => false,
					shutdown: () => {},
					getSystemPrompt: () => [],
				} as never,
			);

			expect(runner.hasHandlers("session_start")).toBe(true);
			expect(runner.hasHandlers("session_compact")).toBe(true);
			expect(runner.hasHandlers("context")).toBe(true);

			const initialContext = await runner.emitContext([]);
			expect(textFromMessages(initialContext)).toContain("lifecycle=boot revision=0");

			await runner.emit({ type: "session_start" });
			const afterStartContext = await runner.emitContext([]);
			expect(textFromMessages(afterStartContext)).toContain("You have superpowers");
			expect(textFromMessages(afterStartContext)).toContain("lifecycle=session_start revision=1");

			await runner.emit({
				type: "session_compact",
				compactionEntry: {
					type: "compaction",
					id: "compact-1",
					parentId: null,
					timestamp: new Date().toISOString(),
					summary: "summary",
					firstKeptEntryId: "entry-1",
					tokensBefore: 1,
				},
				fromExtension: false,
			});
			const afterCompactContext = await runner.emitContext([]);
			expect(textFromMessages(afterCompactContext)).toContain("lifecycle=session_compact revision=2");
		} finally {
			authStorage?.close();
			clearCache();
			await rm(tempRoot, { recursive: true, force: true });
		}
	});
});
