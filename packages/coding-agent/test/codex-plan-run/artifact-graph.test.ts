import { describe, expect, it } from "bun:test";
import {
	createAutonomousPlanRunArtifactGraph,
	getBlockedArtifacts,
	getReadyArtifacts,
	isArtifactGraphComplete,
} from "../../src/codex-plan-run/artifact-graph";

describe("autonomous plan run artifact graph", () => {
	it("requires execution book before task cards and evidence", () => {
		const graph = createAutonomousPlanRunArtifactGraph();

		expect(getReadyArtifacts(graph, new Set())).toEqual(["plan-execution-book.md"]);
		expect(getBlockedArtifacts(graph, new Set())["task-cards.json"]).toEqual(["plan-execution-book.md"]);
		expect(getBlockedArtifacts(graph, new Set())["tdd-evidence-matrix.json"]).toEqual([
			"plan-execution-book.md",
			"task-cards.json",
		]);
	});

	it("is complete only when all required artifacts exist", () => {
		const graph = createAutonomousPlanRunArtifactGraph();
		const completed = new Set(graph.map(artifact => artifact.path));

		expect(isArtifactGraphComplete(graph, completed)).toBe(true);
		completed.delete("codex-review-request.json");
		expect(isArtifactGraphComplete(graph, completed)).toBe(false);
	});
});
