import { describe, expect, it } from "bun:test";
import {
	buildModelUsageSummaryLineForSessions,
	createAdvisorModelUiRefreshCoordinator,
	createMainModelUiRefreshCoordinator,
	createModelUsageSummaryLineRenderer,
	formatModelBadge,
	formatModelDisplayName,
	formatModelUsageSummaryLine,
	type ModelAssignment,
	summarizeModelUsage,
} from "@oh-my-pi/pi-coding-agent/modes/model-visibility";

describe("model visibility helpers", () => {
	it("formats short display names from provider selectors and thinking suffixes", () => {
		expect(formatModelDisplayName("deepseek/deepseek-r1")).toBe("deepseek-r1");
		expect(formatModelDisplayName("openai/gpt-5.5:xhigh")).toBe("gpt-5.5");
		expect(formatModelDisplayName("anthropic/claude-opus-4-5@fast")).toBe("claude-opus-4-5");
	});

	it("formats execution and advisor badges with fallback and override markers", () => {
		const execution: ModelAssignment = {
			role: "task",
			model: "deepseek/deepseek-r1",
			displayName: "deepseek-r1",
			source: "modelRoles",
			scope: "current-run",
		};
		const fallback: ModelAssignment = {
			role: "task",
			model: "openai/gpt-5.5",
			displayName: "gpt-5.5",
			source: "fallback",
			scope: "current-task",
		};
		const advisorOverride: ModelAssignment = {
			role: "advisor",
			model: "openai/gpt-5.5",
			displayName: "gpt-5.5",
			source: "runtimeOverride",
			scope: "current-run",
		};

		expect(formatModelBadge("task", execution)).toBe("task deepseek-r1");
		expect(formatModelBadge("task", fallback)).toBe("task gpt-5.5 fallback");
		expect(formatModelBadge("advisor", advisorOverride)).toBe("advisor gpt-5.5*");
		expect(formatModelBadge("advisor", { state: "off" })).toBe("advisor off");
		expect(formatModelBadge("advisor", { state: "unavailable" })).toBe("advisor unavailable");
		expect(formatModelBadge("task", { state: "resolving" })).toBe("task resolving");
	});

	it("groups active consumers by actual resolved model", () => {
		const summary = summarizeModelUsage([
			{ kind: "main", label: "planner", model: "openai/gpt-5.5" },
			{ kind: "advisor", label: "advisor(Task5)", taskId: "Task5", model: "openai/gpt-5.5" },
			{
				kind: "subagent",
				label: "task(Task5)",
				taskId: "Task5",
				subagentId: "Task5",
				model: "deepseek/deepseek-r1",
			},
		]);

		expect(summary).toEqual([
			{
				model: "openai/gpt-5.5",
				displayName: "gpt-5.5",
				consumers: [
					{ kind: "main", label: "planner" },
					{ kind: "advisor", label: "advisor(Task5)", taskId: "Task5" },
				],
			},
			{
				model: "deepseek/deepseek-r1",
				displayName: "deepseek-r1",
				consumers: [{ kind: "subagent", label: "task(Task5)", taskId: "Task5", subagentId: "Task5" }],
			},
		]);
	});

	it("formats a compact model usage summary line", () => {
		const line = formatModelUsageSummaryLine([
			{
				model: "openai/gpt-5.5",
				displayName: "gpt-5.5",
				consumers: [
					{ kind: "main", label: "planner" },
					{ kind: "acceptance", label: "acceptance" },
					{ kind: "advisor", label: "advisor(Task5)", taskId: "Task5" },
				],
			},
			{
				model: "deepseek/deepseek-r1",
				displayName: "deepseek-r1",
				consumers: [
					{ kind: "subagent", label: "task(Task5)", taskId: "Task5", subagentId: "Task5" },
					{ kind: "subagent", label: "task(Task6)", taskId: "Task6", subagentId: "Task6" },
				],
			},
		]);

		expect(line).toBe("Models  gpt-5.5: planner, acceptance, advisor(Task5) · deepseek-r1: task(Task5), task(Task6)");
	});

	it("builds model usage summary from main and active detached sessions", () => {
		const line = buildModelUsageSummaryLineForSessions("openai/gpt-5.5", [
			{
				id: "Task5LatencyShards",
				kind: "subagent",
				status: "active",
				agent: "task",
				detached: true,
				modelAssignment: {
					executionModel: {
						role: "task",
						model: "deepseek/deepseek-r1",
						displayName: "deepseek-r1",
						source: "modelRoles",
						scope: "current-run",
					},
					advisorModel: {
						role: "advisor",
						model: "openai/gpt-5.5",
						displayName: "gpt-5.5",
						source: "runtimeOverride",
						scope: "current-run",
					},
				},
			},
			{
				id: "InlineWorker",
				kind: "subagent",
				status: "active",
				agent: "task",
				detached: false,
				progress: { modelRole: "task", resolvedModel: "deepseek/deepseek-r1" },
			},
			{
				id: "FinishedWorker",
				kind: "subagent",
				status: "completed",
				agent: "task",
				detached: true,
				progress: { modelRole: "task", resolvedModel: "deepseek/deepseek-r1" },
			},
		]);

		expect(line).toBe(
			"Models  gpt-5.5: planner, advisor(Task5LatencyShards) · deepseek-r1: task(Task5LatencyShards)",
		);
	});

	it("refreshes model usage summary when the main model changes", () => {
		let mainModel = "openai/gpt-5.5";
		const renderer = createModelUsageSummaryLineRenderer({
			getMainModel: () => mainModel,
			getSessions: () => [],
		});

		expect(renderer.refresh()).toBe("Models  gpt-5.5: planner");
		mainModel = "anthropic/claude-sonnet-4-5";

		expect(renderer.refresh()).toBe("Models  claude-sonnet-4-5: planner");
	});

	it("coordinates main model UI refresh by rebuilding the summary from the current model", () => {
		let mainModel = "openai/gpt-5.5";
		const summaryRenderer = createModelUsageSummaryLineRenderer({
			getMainModel: () => mainModel,
			getSessions: () => [],
		});
		const renderedSummaries: Array<string | undefined> = [];
		let statusInvalidations = 0;
		let borderRefreshes = 0;
		let renderRequests = 0;
		const coordinator = createMainModelUiRefreshCoordinator({
			invalidateStatusLine: () => {
				statusInvalidations += 1;
			},
			updateEditorBorderColor: () => {
				borderRefreshes += 1;
			},
			refreshModelUsageSummary: () => {
				renderedSummaries.push(summaryRenderer.refresh());
			},
			requestRender: () => {
				renderRequests += 1;
			},
		});

		coordinator.refresh();
		mainModel = "anthropic/claude-sonnet-4-5";
		coordinator.refresh();

		expect(renderedSummaries).toEqual(["Models  gpt-5.5: planner", "Models  claude-sonnet-4-5: planner"]);
		expect(statusInvalidations).toBe(2);
		expect(borderRefreshes).toBe(2);
		expect(renderRequests).toBe(2);
	});

	it("coordinates advisor model UI refresh without the main model border refresh", () => {
		const calls: string[] = [];
		const coordinator = createAdvisorModelUiRefreshCoordinator({
			invalidateStatusLine: () => {
				calls.push("statusLine");
			},
			syncRunningSubagentBadge: () => {
				calls.push("subagentBadge");
			},
			refreshModelUsageSummary: () => {
				calls.push("modelsSummary");
			},
			requestRender: () => {
				calls.push("requestRender");
			},
		});

		coordinator.refresh();

		expect(calls).toEqual(["statusLine", "subagentBadge", "modelsSummary", "requestRender"]);
	});
});
