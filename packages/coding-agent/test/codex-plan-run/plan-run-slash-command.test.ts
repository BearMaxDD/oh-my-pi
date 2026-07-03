import { describe, expect, it } from "bun:test";
import { Settings } from "../../src/config/settings";
import { lookupBuiltinSlashCommand } from "../../src/slash-commands/builtin-registry";
import type { SlashCommandRuntime } from "../../src/slash-commands/types";

function createRuntime(output: string[] = []): SlashCommandRuntime {
	return {
		session: {} as SlashCommandRuntime["session"],
		sessionManager: {} as SlashCommandRuntime["sessionManager"],
		settings: Settings.isolated(),
		cwd: "/repo",
		output: text => {
			output.push(text);
		},
		refreshCommands: () => {},
		reloadPlugins: async () => {},
	};
}

describe("/plan-run", () => {
	it("is registered as a builtin slash command", () => {
		const command = lookupBuiltinSlashCommand("plan-run");
		expect(command?.name).toBe("plan-run");
		expect(command?.description).toContain("autonomous");
		expect(command?.inlineHint).toBe("<request>");
		expect(command?.allowArgs).toBe(true);
	});

	it("queues an autonomous plan_execution_book prompt", async () => {
		const output: string[] = [];
		const command = lookupBuiltinSlashCommand("plan-run");
		const result = await command?.handle?.(
			{ name: "plan-run", args: "Add billing export", text: "plan-run Add billing export" },
			createRuntime(output),
		);

		expect(output).toEqual(["Autonomous plan run request queued."]);
		expect(result).toEqual({
			prompt: [
				"Create an autonomous plan run for this request using plan_execution_book: Add billing export",
				"When any task review or main acceptance review fails, call plan_repair_loop before spawning repair subagents.",
				"Do not re-run writing-plans unless plan_repair_loop returns PLAN_DEFECT_REPLAN_REQUIRED.",
			].join("\n"),
		});
	});

	it("prints usage when the request is empty", async () => {
		const output: string[] = [];
		const command = lookupBuiltinSlashCommand("plan-run");
		const result = await command?.handle?.(
			{ name: "plan-run", args: "   ", text: "plan-run" },
			createRuntime(output),
		);

		expect(output.join("\n")).toContain("Usage: /plan-run <request>");
		expect(result).toEqual({ consumed: true });
	});
});
