import { describe, expect, it } from "bun:test";
import { Settings } from "@oh-my-pi/pi-coding-agent/config/settings";
import { createSubagentSettings } from "@oh-my-pi/pi-coding-agent/task/executor";

describe("subagent advisor visibility", () => {
	it("defaults subagent advisors on while leaving the main advisor off", () => {
		const settings = Settings.isolated();

		expect(settings.get("advisor.enabled")).toBe(false);
		expect(settings.get("advisor.subagents")).toBe(true);
	});

	it("inherits advisor enabled and subagent visibility settings into isolated subagent settings", () => {
		const parent = Settings.isolated({
			"advisor.enabled": true,
			"advisor.subagents": true,
			"advisor.syncBacklog": "3",
			"advisor.immuneTurns": 2,
		});

		const child = createSubagentSettings(parent);

		expect(child.get("advisor.enabled")).toBe(true);
		expect(child.get("advisor.subagents")).toBe(true);
		expect(child.get("advisor.syncBacklog")).toBe("3");
		expect(child.get("advisor.immuneTurns")).toBe(2);
	});
});
