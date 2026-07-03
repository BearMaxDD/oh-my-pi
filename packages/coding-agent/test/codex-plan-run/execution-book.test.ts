import { describe, expect, it } from "bun:test";
import {
	createPlanExecutionBook,
	renderPlanExecutionBook,
	validatePlanExecutionBookGate,
} from "../../src/codex-plan-run/execution-book";

const loadedSkills = [
	{
		name: "omp-executing-codex-plan",
		filePath: "/skills/omp-executing-codex-plan/SKILL.md",
		content: "Execute one exact Codex plan. Require strict TDD, evidence, completion doc, and review packet.",
	},
	{
		name: "test-driven-development",
		filePath: "/skills/test-driven-development/SKILL.md",
		content: "Write a failing test first. Run the test and verify it fails before production code.",
	},
	{
		name: "verification-before-completion",
		filePath: "/skills/verification-before-completion/SKILL.md",
		content: "Run verification commands before claiming completion. Cite command evidence.",
	},
	{
		name: "requesting-code-review",
		filePath: "/skills/requesting-code-review/SKILL.md",
		content: "Review completed work against acceptance criteria. Findings lead the response.",
	},
];

describe("PlanExecutionBook gate", () => {
	it("creates one skill-guided task card per Codex plan task", () => {
		const book = createPlanExecutionBook({
			runId: "run-123",
			planPath: "/repo/docs/superpowers/plans/demo.md",
			planSha256: "abc123",
			repoPath: "/repo",
			acceptingDir: "/repo/docs/superpowers/accepting/demo",
			intakeGate: [
				{ gate: "plan_path_exists", result: "PASS", evidence: "/repo/docs/superpowers/plans/demo.md" },
				{ gate: "plan_sha256_matches", result: "PASS", evidence: "abc123" },
				{ gate: "repo_path_valid", result: "PASS", evidence: "/repo" },
				{ gate: "skills_resolved", result: "PASS", evidence: "4 skills" },
				{ gate: "project_recon_done", result: "PASS", evidence: "manual fixture" },
			],
			projectRecon: {
				repo_path: "/repo",
				relevant_modules: ["src/parser", "test"],
				likely_files: ["src/parser/index.ts", "test/parser.test.ts"],
				existing_patterns: ["Parser tests live beside test/parser.test.ts"],
				test_commands: ["bun test test/parser.test.ts"],
				build_commands: ["bun run check:types"],
				style_conventions: ["Keep parser changes local"],
				risk_areas: ["Parser behavior affects callers"],
				forbidden_changes: ["Do not rewrite CLI"],
				task_file_map: { T01: ["test/parser.test.ts"], T02: ["src/parser/index.ts"] },
			},
			requiredExecutionSkills: ["omp-executing-codex-plan", "test-driven-development"],
			requiredReviewSkills: ["requesting-code-review"],
			finalTailSkills: ["verification-before-completion"],
			finalAcceptanceCommands: ["bun test", "bun run check", "bun run build"],
			tasks: [
				{
					id: "T01",
					title: "Add parser contract tests",
					source: "Plan section 2",
					todo: "Cover parser edge cases before implementation.",
					acceptance: ["Parser rejects empty input", "Parser keeps current success path"],
					smokeCommands: ["bun test test/parser.test.ts"],
				},
				{
					id: "T02",
					title: "Implement parser change",
					source: "Plan section 3",
					todo: "Implement the parser behavior after the failing tests exist.",
					executionSkills: ["test-driven-development"],
					reviewSkills: ["requesting-code-review"],
					acceptance: ["All parser tests pass"],
					smokeCommands: ["bun test test/parser.test.ts", "bun run check:types"],
				},
			],
			now: new Date("2026-06-23T00:00:00.000Z"),
			skills: loadedSkills,
		});

		expect(book.schema_version).toBe(1);
		expect(book.tasks).toHaveLength(2);
		expect(book.tasks[0]).toMatchObject({
			id: "T01",
			title: "Add parser contract tests",
			execution_skills: ["omp-executing-codex-plan", "test-driven-development"],
			review_skills: ["requesting-code-review"],
			source: "Plan section 2",
			todo: "Cover parser edge cases before implementation.",
		});
		expect(book.tasks[0]?.implementation_analysis).toContain("test-driven-development");
		expect(book.tasks[0]?.review_gate.acceptance_criteria).toContain("Parser rejects empty input");
		expect(book.tasks[0]?.review_gate.smoke_commands).toEqual(["bun test test/parser.test.ts"]);
		expect(book.tasks[1]?.execution_skills).toEqual(["test-driven-development"]);
		expect(book.final_tail_skills.map(skill => skill.name)).toEqual(["verification-before-completion"]);
		expect(book.final_acceptance_commands).toEqual(["bun test", "bun run check", "bun run build"]);

		const rendered = renderPlanExecutionBook(book);
		expect(rendered).toContain("# OMP Plan Execution Book");
		expect(rendered).toContain("## Source Plan Contract");
		expect(rendered).toContain("## Intake Gate Result");
		expect(rendered).toContain("## Skill Binding Matrix");
		expect(rendered).toContain("## Project Recon");
		expect(rendered).toContain("## Task Execution Cards");
		expect(rendered).toContain("## Review Protocol");
		expect(rendered).toContain("Use plan_repair_loop after TASK_FIX_REQUIRED");
		expect(rendered).toContain("## Completion Evidence Contract");
		expect(rendered).toContain("## Final Acceptance Commands");
		expect(rendered).toContain("- bun run build");
		expect(rendered).toContain("## MainThreadAcceptanceReview Gate");
		expect(rendered).toContain("Use plan_repair_loop after MAIN_ACCEPTANCE_FIX_REQUIRED");
		expect(rendered).toContain(
			"Only re-enter writing-plans when plan_repair_loop returns PLAN_DEFECT_REPLAN_REQUIRED",
		);
		expect(rendered).toContain("- Generate CodexReviewRequestPacket only after MAIN_ACCEPTANCE_ACCEPTED.");
		expect(rendered).toContain("### Task Card: T01 - Add parser contract tests");
		expect(rendered).toContain("#### Source");
		expect(rendered).toContain("- Codex plan section: Plan section 2");
		expect(rendered).toContain("- Original TODO: Cover parser edge cases before implementation.");
		expect(rendered).toContain(
			"- Original acceptance criteria: Parser rejects empty input; Parser keeps current success path",
		);
		expect(rendered).toContain("#### Skill-Guided Implementation Analysis");
		expect(rendered).toContain("- execution skills read:");
		expect(rendered).toContain("- relevant guidance extracted:");
		expect(rendered).toContain("- implementation approach:");
		expect(rendered).toContain("- risks:");
		expect(rendered).toContain("- smallest acceptable change:");
		expect(rendered).toContain("#### Execution Scope");
		expect(rendered).toContain("#### Implementation Steps");
		expect(rendered).toContain("#### Skill-Guided Acceptance Criteria");
		expect(rendered).toContain("- review skills read:");
		expect(rendered).toContain("- acceptance checks:");
		expect(rendered).toContain("- smoke tests:");
		expect(rendered).toContain("- required commands:");
		expect(rendered).toContain("- evidence format:");
		expect(rendered).toContain("- must-fix conditions:");
		expect(rendered).toContain("#### Evidence Required");
		expect(rendered).toContain("- changed files:");
		expect(rendered).toContain("- tests run:");
		expect(rendered).toContain("- command outputs:");
		expect(rendered).toContain("- completion note:");
		expect(rendered).toContain("#### Main Thread Review Gate");
		expect(rendered).toContain("- compare against Codex plan:");
		expect(rendered).toContain("- compare against this task card:");
		expect(rendered).toContain("- verify command evidence:");
		expect(rendered).toContain("- verify scope control:");
		expect(rendered).toContain("- verify no over-implementation:");
		expect(rendered).toContain("- result:");
		expect(rendered).toContain("bun run check:types");
	});

	it("blocks when any required task or tail skill has no load evidence", () => {
		expect(() =>
			createPlanExecutionBook({
				runId: "run-123",
				planPath: "/repo/docs/superpowers/plans/demo.md",
				planSha256: "abc123",
				repoPath: "/repo",
				acceptingDir: "/repo/docs/superpowers/accepting/demo",
				projectRecon: {
					repo_path: "/repo",
					relevant_modules: ["src"],
					likely_files: ["src/parser.ts"],
					existing_patterns: ["existing tests"],
					test_commands: ["bun test"],
					build_commands: ["bun run check:types"],
					style_conventions: ["local style"],
					risk_areas: ["parser"],
					forbidden_changes: ["unrelated files"],
					task_file_map: { T01: ["src/parser.ts"] },
				},
				requiredExecutionSkills: ["omp-executing-codex-plan", "missing-execution-skill"],
				requiredReviewSkills: ["requesting-code-review"],
				finalTailSkills: ["verification-before-completion"],
				tasks: [
					{
						id: "T01",
						title: "Add parser contract tests",
						source: "Plan section 2",
						todo: "Cover parser edge cases before implementation.",
						acceptance: ["Parser contract tests are present"],
					},
				],
				skills: loadedSkills,
			}),
		).toThrow('Required skill "missing-execution-skill" was not loaded');

		expect(() =>
			createPlanExecutionBook({
				runId: "run-123",
				planPath: "/repo/docs/superpowers/plans/demo.md",
				planSha256: "abc123",
				repoPath: "/repo",
				acceptingDir: "/repo/docs/superpowers/accepting/demo",
				projectRecon: {
					repo_path: "/repo",
					relevant_modules: ["src"],
					likely_files: ["src/parser.ts"],
					existing_patterns: ["existing tests"],
					test_commands: ["bun test"],
					build_commands: ["bun run check:types"],
					style_conventions: ["local style"],
					risk_areas: ["parser"],
					forbidden_changes: ["unrelated files"],
					task_file_map: { T01: ["src/parser.ts"] },
				},
				requiredExecutionSkills: ["omp-executing-codex-plan"],
				requiredReviewSkills: ["requesting-code-review"],
				finalTailSkills: ["missing-tail-skill"],
				tasks: [
					{
						id: "T01",
						title: "Add parser contract tests",
						source: "Plan section 2",
						todo: "Cover parser edge cases before implementation.",
						acceptance: ["Parser contract tests are present"],
					},
				],
				skills: loadedSkills,
			}),
		).toThrow('Required skill "missing-tail-skill" was not loaded');
	});

	it("validates the gate and rejects model role leakage in task cards", () => {
		const book = createPlanExecutionBook({
			runId: "run-123",
			planPath: "/repo/docs/superpowers/plans/demo.md",
			planSha256: "abc123",
			repoPath: "/repo",
			acceptingDir: "/repo/docs/superpowers/accepting/demo",
			projectRecon: {
				repo_path: "/repo",
				relevant_modules: ["src"],
				likely_files: ["src/parser.ts"],
				existing_patterns: ["existing tests"],
				test_commands: ["bun test"],
				build_commands: ["bun run check:types"],
				style_conventions: ["local style"],
				risk_areas: ["parser"],
				forbidden_changes: ["unrelated files"],
				task_file_map: { T01: ["src/parser.ts"] },
			},
			requiredExecutionSkills: ["omp-executing-codex-plan", "test-driven-development"],
			requiredReviewSkills: ["requesting-code-review"],
			finalTailSkills: ["verification-before-completion"],
			tasks: [
				{
					id: "T01",
					title: "Implement without model fields",
					source: "Plan section 4",
					todo: "Keep execution model selection out of the task card.",
					acceptance: ["Task card has no model field"],
					smokeCommands: ["bun test"],
				},
			],
			skills: loadedSkills,
		});

		const rendered = renderPlanExecutionBook(book);
		expect(rendered).not.toContain("execution_model");
		expect(rendered).not.toContain("review_model");
		expect(rendered).not.toContain("用哪个执行模型");
		expect(rendered).not.toContain("用哪个验收模型");
		expect(validatePlanExecutionBookGate(book)).toEqual([]);

		expect(
			validatePlanExecutionBookGate({
				...book,
				tasks: [
					{
						...book.tasks[0]!,
						review_gate: {
							...book.tasks[0]!.review_gate,
							smoke_commands: [],
						},
					},
				],
			}),
		).toContain("task T01 review_gate.smoke_commands must not be empty");

		expect(
			validatePlanExecutionBookGate({
				...book,
				tasks: [
					{
						...book.tasks[0]!,
						implementation_analysis: "test-driven-development",
					},
				],
			}),
		).toContain("task T01 implementation_analysis must include relevant guidance extracted");
	});

	it("rejects duplicate task ids and missing project recon evidence", () => {
		expect(() =>
			createPlanExecutionBook({
				runId: "run-123",
				planPath: "/repo/docs/superpowers/plans/demo.md",
				planSha256: "abc123",
				repoPath: "/repo",
				acceptingDir: "/repo/docs/superpowers/accepting/demo",
				requiredExecutionSkills: ["omp-executing-codex-plan"],
				requiredReviewSkills: ["requesting-code-review"],
				finalTailSkills: ["verification-before-completion"],
				tasks: [
					{ id: "T01", title: "One", source: "Plan 1", todo: "Do one" },
					{ id: "T01", title: "Two", source: "Plan 2", todo: "Do two" },
				],
				skills: loadedSkills,
			}),
		).toThrow("project_recon is required");
	});

	it("rejects Codex plan tasks without explicit acceptance requirements", () => {
		expect(() =>
			createPlanExecutionBook({
				runId: "run-123",
				planPath: "/repo/docs/superpowers/plans/demo.md",
				planSha256: "abc123",
				repoPath: "/repo",
				acceptingDir: "/repo/docs/superpowers/accepting/demo",
				projectRecon: {
					repo_path: "/repo",
					relevant_modules: ["src"],
					likely_files: ["src/parser.ts"],
					existing_patterns: ["existing tests"],
					test_commands: ["bun test"],
					build_commands: ["bun run check:types"],
					style_conventions: ["local style"],
					risk_areas: ["parser"],
					forbidden_changes: ["unrelated files"],
					task_file_map: { T01: ["src/parser.ts"] },
				},
				requiredExecutionSkills: ["omp-executing-codex-plan"],
				requiredReviewSkills: ["requesting-code-review"],
				finalTailSkills: ["verification-before-completion"],
				tasks: [
					{
						id: "T01",
						title: "Missing acceptance",
						source: "Plan section 5",
						todo: "Do the task.",
					},
				],
				skills: loadedSkills,
			}),
		).toThrow("task T01 acceptance is required");
	});

	it("blocks execution books without final acceptance commands", () => {
		const book = createPlanExecutionBook({
			runId: "run-123",
			planPath: "/repo/docs/superpowers/plans/demo.md",
			planSha256: "abc123",
			repoPath: "/repo",
			acceptingDir: "/repo/docs/superpowers/accepting/demo",
			projectRecon: {
				repo_path: "/repo",
				relevant_modules: ["src"],
				likely_files: ["src/parser.ts"],
				existing_patterns: ["existing tests"],
				test_commands: ["bun test"],
				build_commands: ["bun run check:types"],
				style_conventions: ["local style"],
				risk_areas: ["parser"],
				forbidden_changes: ["unrelated files"],
				task_file_map: { T01: ["src/parser.ts"] },
			},
			requiredExecutionSkills: ["omp-executing-codex-plan"],
			requiredReviewSkills: ["requesting-code-review"],
			finalTailSkills: ["verification-before-completion"],
			finalAcceptanceCommands: ["bun test"],
			tasks: [
				{
					id: "T01",
					title: "Parser task",
					source: "Plan section 5",
					todo: "Do the task.",
					acceptance: ["Task is done"],
				},
			],
			skills: loadedSkills,
		});

		expect(validatePlanExecutionBookGate({ ...book, final_acceptance_commands: [] })).toContain(
			"final_acceptance_commands must not be empty",
		);
	});
});

describe("autonomous execution book requirements", () => {
	function createAutonomousBook() {
		return createPlanExecutionBook({
			runId: "run-autonomous",
			planPath: "autonomous://user-request",
			planSha256: "autonomous-request",
			repoPath: "/repo",
			acceptingDir: "/repo",
			projectRecon: {
				summary: "demo repo",
				relevant_files: ["src/demo.ts"],
				test_commands: ["bun test test/demo.test.ts"],
				build_commands: ["bun run check:types"],
				risks: ["missing TDD evidence"],
			},
			tasks: [
				{
					id: "T1",
					title: "Add demo behavior",
					goal: "Implement demo behavior with TDD",
					allowedFiles: ["src/demo.ts", "test/demo.test.ts"],
					forbiddenFiles: ["package.json"],
					smokeCommands: ["bun test test/demo.test.ts"],
				},
			],
			requiredExecutionSkills: ["test-driven-development"],
			requiredReviewSkills: ["requesting-code-review"],
			finalTailSkills: ["verification-before-completion"],
			mode: "autonomous",
		});
	}

	it("requires TDD gates, advisor watch points, and skill evidence requirements on every task", () => {
		const book = createAutonomousBook();
		expect(book.tasks[0]?.tdd_gates.red.evidence_required).toBe("RED_EVIDENCE");
		expect(book.tasks[0]?.advisor_watch_points).toContain("missing_red_evidence");
		expect(book.tasks[0]?.required_skill_evidence).toContain("test-driven-development");

		const rendered = renderPlanExecutionBook(book);
		expect(rendered).toContain("#### TDD Gates");
		expect(rendered).toContain("RED_EVIDENCE");
		expect(rendered).toContain("GREEN_EVIDENCE");
		expect(rendered).toContain("REGRESSION_EVIDENCE");
		expect(rendered).toContain("#### Advisor Watch Points");
		expect(rendered).toContain("missing_red_evidence");
		expect(rendered).toContain("unresolved_advisor_blocker");
		expect(rendered).toContain("#### Required Skill Evidence");
		expect(rendered).toContain("test-driven-development");
	});

	it("validates autonomous task card gates restored from JSON", () => {
		const book = createAutonomousBook();

		const missingRedCommand = structuredClone(book);
		missingRedCommand.tasks[0]!.tdd_gates.red.command = "";
		expect(validatePlanExecutionBookGate(missingRedCommand)).toContain("task T1 tdd_gates.red.command is required");

		const wrongGreenExpected = structuredClone(book);
		(wrongGreenExpected.tasks[0]!.tdd_gates.green as { expected: string }).expected = "FAIL";
		expect(validatePlanExecutionBookGate(wrongGreenExpected)).toContain(
			"task T1 tdd_gates.green.expected must be PASS",
		);

		const wrongGreenEvidence = structuredClone(book);
		(wrongGreenEvidence.tasks[0]!.tdd_gates.green as { evidence_required: string }).evidence_required =
			"RED_EVIDENCE";
		expect(validatePlanExecutionBookGate(wrongGreenEvidence)).toContain(
			"task T1 tdd_gates.green.evidence_required must be GREEN_EVIDENCE",
		);

		const missingWatchPoints = structuredClone(book);
		missingWatchPoints.tasks[0]!.advisor_watch_points = [];
		expect(validatePlanExecutionBookGate(missingWatchPoints)).toContain(
			"task T1 advisor_watch_points must not be empty",
		);

		const missingSkillEvidence = structuredClone(book);
		missingSkillEvidence.tasks[0]!.required_skill_evidence = [];
		expect(validatePlanExecutionBookGate(missingSkillEvidence)).toContain(
			"task T1 required_skill_evidence must not be empty",
		);

		const incompleteSkillEvidence = structuredClone(book);
		incompleteSkillEvidence.tasks[0]!.required_skill_evidence = ["test-driven-development"];
		expect(validatePlanExecutionBookGate(incompleteSkillEvidence)).toContain(
			"task T1 required_skill_evidence must include requesting-code-review",
		);
	});

	it("escapes task card markdown table and list content", () => {
		const book = createPlanExecutionBook({
			runId: "run-markdown",
			planPath: "autonomous://user-request",
			planSha256: "autonomous-request",
			repoPath: "/repo",
			acceptingDir: "/repo",
			projectRecon: {
				summary: "demo | repo\n### injected",
				relevant_files: ["src/demo.ts"],
				test_commands: ["bun test test/demo.test.ts"],
				build_commands: ["bun run check:types"],
				risks: ["risk | one\n### injected"],
			},
			tasks: [
				{
					id: "T1",
					title: "Add demo | behavior\n### injected",
					goal: "Implement | demo\n### injected",
					allowedFiles: ["src/demo.ts"],
					forbiddenFiles: ["package.json"],
					smokeCommands: ["bun test | tee\n### injected"],
				},
			],
			requiredExecutionSkills: ["test-driven-development"],
			requiredReviewSkills: ["requesting-code-review"],
			finalTailSkills: ["verification-before-completion"],
			mode: "autonomous",
		});

		const rendered = renderPlanExecutionBook(book);
		expect(rendered).toContain("Add demo \\| behavior ### injected");
		expect(rendered).toContain("bun test \\| tee ### injected");
		expect(rendered).not.toContain("\n### injected\n");

		const redGateRow = rendered.split("\n").find(line => line.startsWith("| red |"));
		expect(redGateRow?.match(/(?<!\\)\|/g)).toHaveLength(5);
	});
});
