import type { PlanRunArtifact } from "./types";

export function createAutonomousPlanRunArtifactGraph(): PlanRunArtifact[] {
	return [
		{ path: "plan-execution-book.md", requires: [] },
		{ path: "task-cards.json", requires: ["plan-execution-book.md"] },
		{ path: "tdd-evidence-matrix.json", requires: ["plan-execution-book.md", "task-cards.json"] },
		{ path: "skill-evidence-matrix.json", requires: ["plan-execution-book.md", "task-cards.json"] },
		{ path: "omp-completion.md", requires: ["tdd-evidence-matrix.json", "skill-evidence-matrix.json"] },
		{ path: "main-acceptance-review.json", requires: ["omp-completion.md"] },
		{ path: "codex-review-request.json", requires: ["main-acceptance-review.json"] },
	];
}

export function getReadyArtifacts(graph: PlanRunArtifact[], completed: ReadonlySet<string>): string[] {
	return graph
		.filter(artifact => !completed.has(artifact.path))
		.filter(artifact => artifact.requires.every(dep => completed.has(dep)))
		.map(artifact => artifact.path)
		.sort();
}

export function getBlockedArtifacts(
	graph: PlanRunArtifact[],
	completed: ReadonlySet<string>,
): Record<string, string[]> {
	const blocked: Record<string, string[]> = {};
	for (const artifact of graph) {
		if (completed.has(artifact.path)) continue;
		const missing = artifact.requires.filter(dep => !completed.has(dep)).sort();
		if (missing.length > 0) blocked[artifact.path] = missing;
	}
	return blocked;
}

export function isArtifactGraphComplete(graph: PlanRunArtifact[], completed: ReadonlySet<string>): boolean {
	return graph.every(artifact => completed.has(artifact.path));
}
