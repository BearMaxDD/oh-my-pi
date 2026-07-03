import { describe, expect, it } from "bun:test";
import {
	advancePlanRunState,
	createAutonomousPlanRunArtifactGraph,
	getBlockedArtifacts,
	runCodebaseMemoryExecutionRecon,
} from "@oh-my-pi/pi-coding-agent/codex-plan-run";

describe("codex plan run package export", () => {
	it("exposes the codex-plan-run barrel as a package subpath", () => {
		expect(advancePlanRunState("created", "project_recon_done")).toBe("project_recon_done");
		const blocked = getBlockedArtifacts(createAutonomousPlanRunArtifactGraph(), new Set(["plan-execution-book.md"]));
		expect(blocked["omp-completion.md"]).toContain("tdd-evidence-matrix.json");
		expect(typeof runCodebaseMemoryExecutionRecon).toBe("function");
	});
});
