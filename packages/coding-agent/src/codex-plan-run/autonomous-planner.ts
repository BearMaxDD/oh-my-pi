import type { CreatePlanExecutionBookOptions } from "./execution-book";

export interface AutonomousProjectRecon {
	summary: string;
	relevant_files: string[];
	test_commands: string[];
	build_commands: string[];
	risks: string[];
}

export interface CreateAutonomousPlanExecutionBookInputOptions {
	runId: string;
	userRequest: string;
	repoPath: string;
	recon: AutonomousProjectRecon;
}

export function createAutonomousPlanExecutionBookInput(
	options: CreateAutonomousPlanExecutionBookInputOptions,
): CreatePlanExecutionBookOptions {
	return {
		mode: "autonomous",
		runId: options.runId,
		planPath: "autonomous://user-request",
		planSha256: `user-request:${Buffer.from(options.userRequest).toString("base64url")}`,
		repoPath: options.repoPath,
		acceptingDir: options.repoPath,
		projectRecon: options.recon,
		requiredExecutionSkills: ["brainstorming", "test-driven-development"],
		requiredReviewSkills: ["requesting-code-review"],
		finalTailSkills: ["verification-before-completion"],
		tasks: [
			{
				id: "T1",
				title: options.userRequest.slice(0, 80),
				goal: options.userRequest,
				allowedFiles: options.recon.relevant_files,
				forbiddenFiles: [],
				smokeCommands: options.recon.test_commands,
			},
		],
		finalAcceptanceCommands: [...options.recon.test_commands, ...options.recon.build_commands],
	};
}
