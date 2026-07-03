import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildGlobalImpactReport, writeGlobalImpactReport } from "../../src/codex-plan-run/global-impact";
import { emptySpecTaskClassification, type SpecTaskFramework } from "../../src/codex-plan-run/spec-task-framework";

const tempDirs: string[] = [];
async function makeTempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "omp-global-impact-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

const framework: SpecTaskFramework = {
	schema_version: "superpowers.spec_task_framework.v1",
	run_id: "run-impact",
	generated_at: "2026-06-30T00:00:00.000Z",
	source_documents: [],
	role_registry_version: "superpowers.role_registry.v1",
	tasks: [
		{
			id: "T01",
			title_zh: "驱动角色绑定执行",
			intent: "driver writes prompt packs",
			acceptance_criteria: ["prompt packs exist"],
			allowed_paths: ["src/codex-plan-run/driver.ts"],
			forbidden_paths: [],
			expected_changed_paths: ["src/codex-plan-run/driver.ts"],
			dependency_task_ids: [],
			affected_capabilities: ["codex-plan-run", "acceptance"],
			business_paths: [
				{
					id: "planrun-primary",
					title_zh: "PlanRun 完整执行",
					user_story: "用户运行 PlanRun 并得到验收证据",
					runtime_required: true,
					suggested_environment: "local",
				},
			],
			classification: emptySpecTaskClassification(),
			stages: [],
		},
	],
	global_gates: [],
};

describe("global impact gate", () => {
	it("maps changed files to affected capabilities and linked tests", () => {
		const report = buildGlobalImpactReport({
			runId: "run-impact",
			framework,
			changedFiles: ["src/codex-plan-run/driver.ts"],
			testEvidence: [{ command: "bun test T01", exit_code: 0 }],
			reviewFindings: [],
		});

		expect(report.schema_version).toBe("superpowers.global_impact.v1");
		expect(report.status).toBe("accepted");
		expect(report.affected_capabilities).toContainEqual(
			expect.objectContaining({ id: "codex-plan-run", confidence: "high" }),
		);
		expect(report.required_linked_tests).toContainEqual(
			expect.objectContaining({ command: "bun test T01", required: true }),
		);
		expect(report.runtime_business_paths[0].id).toBe("planrun-primary");
	});

	it("reports unmapped same-directory files when task lists specific file", () => {
		const report = buildGlobalImpactReport({
			runId: "run-impact",
			framework,
			changedFiles: ["src/codex-plan-run/driver.ts", "src/codex-plan-run/main-acceptance-review.ts"],
			testEvidence: [{ command: "bun test T01", exit_code: 0 }],
			reviewFindings: [],
		});

		expect(report.status).toBe("blocked");
		expect(report.findings.some(f => f.description.includes("main-acceptance-review.ts"))).toBe(true);
		expect(report.affected_capabilities).toContainEqual(expect.objectContaining({ id: "codex-plan-run" }));
	});

	it("maps files under explicit directory path", () => {
		const dirFramework: SpecTaskFramework = {
			schema_version: "superpowers.spec_task_framework.v1",
			run_id: "run-impact",
			generated_at: "2026-06-30T00:00:00.000Z",
			source_documents: [],
			role_registry_version: "superpowers.role_registry.v1",
			tasks: [
				{
					id: "T01",
					title_zh: "驱动角色绑定执行",
					intent: "driver writes prompt packs",
					acceptance_criteria: ["prompt packs exist"],
					allowed_paths: ["src/codex-plan-run/"],
					forbidden_paths: [],
					expected_changed_paths: ["src/codex-plan-run/"],
					dependency_task_ids: [],
					affected_capabilities: ["codex-plan-run"],
					business_paths: [],
					classification: emptySpecTaskClassification(),
					stages: [],
				},
			],
			global_gates: [],
		};
		const report = buildGlobalImpactReport({
			runId: "run-impact",
			framework: dirFramework,
			changedFiles: ["src/codex-plan-run/driver.ts", "src/codex-plan-run/main-acceptance-review.ts"],
			testEvidence: [{ command: "bun test T01", exit_code: 0 }],
			reviewFindings: [],
		});

		expect(report.status).toBe("accepted");
		expect(report.affected_capabilities[0].related_files).toContain("src/codex-plan-run/driver.ts");
		expect(report.affected_capabilities[0].related_files).toContain("src/codex-plan-run/main-acceptance-review.ts");
	});

	it("maps files under directory-like path by convention", () => {
		const noSlashFramework: SpecTaskFramework = {
			schema_version: "superpowers.spec_task_framework.v1",
			run_id: "run-impact",
			generated_at: "2026-06-30T00:00:00.000Z",
			source_documents: [],
			role_registry_version: "superpowers.role_registry.v1",
			tasks: [
				{
					id: "T01",
					title_zh: "驱动角色绑定执行",
					intent: "driver writes prompt packs",
					acceptance_criteria: ["prompt packs exist"],
					allowed_paths: ["src/codex-plan-run"],
					forbidden_paths: [],
					expected_changed_paths: ["src/codex-plan-run"],
					dependency_task_ids: [],
					affected_capabilities: ["codex-plan-run"],
					business_paths: [],
					classification: emptySpecTaskClassification(),
					stages: [],
				},
			],
			global_gates: [],
		};
		const report = buildGlobalImpactReport({
			runId: "run-impact",
			framework: noSlashFramework,
			changedFiles: [
				"src/codex-plan-run/driver.ts",
				"src/codex-plan-run/main-acceptance-review.ts",
				"src/codex-plan-run/sub/deep.ts",
			],
			testEvidence: [{ command: "bun test T01", exit_code: 0 }],
			reviewFindings: [],
		});

		expect(report.status).toBe("accepted");
		expect(report.affected_capabilities[0].related_files).toContain("src/codex-plan-run/driver.ts");
		expect(report.affected_capabilities[0].related_files).toContain("src/codex-plan-run/main-acceptance-review.ts");
		expect(report.affected_capabilities[0].related_files).toContain("src/codex-plan-run/sub/deep.ts");
	});

	it("flags missing linked test evidence per task", () => {
		const twoTaskFramework: SpecTaskFramework = {
			schema_version: "superpowers.spec_task_framework.v1",
			run_id: "run-impact",
			generated_at: "2026-06-30T00:00:00.000Z",
			source_documents: [],
			role_registry_version: "superpowers.role_registry.v1",
			tasks: [
				{
					id: "T01",
					title_zh: "驱动角色绑定执行",
					intent: "driver writes prompt packs",
					acceptance_criteria: ["prompt packs exist"],
					allowed_paths: ["src/codex-plan-run/driver.ts"],
					forbidden_paths: [],
					expected_changed_paths: ["src/codex-plan-run/driver.ts"],
					dependency_task_ids: [],
					affected_capabilities: ["codex-plan-run"],
					business_paths: [],
					classification: emptySpecTaskClassification(),
					stages: [],
				},
				{
					id: "T02",
					title_zh: "验收审查功能",
					intent: "review produces report",
					acceptance_criteria: ["review completes"],
					allowed_paths: ["src/codex-plan-run/main-acceptance-review.ts"],
					forbidden_paths: [],
					expected_changed_paths: ["src/codex-plan-run/main-acceptance-review.ts"],
					dependency_task_ids: [],
					affected_capabilities: ["acceptance"],
					business_paths: [],
					classification: emptySpecTaskClassification(),
					stages: [],
				},
			],
			global_gates: [],
		};
		const report = buildGlobalImpactReport({
			runId: "run-impact",
			framework: twoTaskFramework,
			changedFiles: ["src/codex-plan-run/driver.ts", "src/codex-plan-run/main-acceptance-review.ts"],
			testEvidence: [{ command: "bun test T01", exit_code: 0 }],
			reviewFindings: [],
		});

		expect(report.status).toBe("repair_required");
		const t01Test = report.required_linked_tests.find(t => t.id.startsWith("T01"));
		expect(t01Test?.command).toBe("bun test T01");
		const t02Test = report.required_linked_tests.find(t => t.id.startsWith("T02"));
		expect(t02Test?.command).toBeUndefined();
		expect(report.findings.some(f => f.description.includes("T02"))).toBe(true);
	});

	it("reports missing evidence when directory allowed_paths produce empty basename", () => {
		const dirTaskFramework: SpecTaskFramework = {
			schema_version: "superpowers.spec_task_framework.v1",
			run_id: "run-impact",
			generated_at: "2026-06-30T00:00:00.000Z",
			source_documents: [],
			role_registry_version: "superpowers.role_registry.v1",
			tasks: [
				{
					id: "T01",
					title_zh: "驱动角色绑定执行",
					intent: "driver writes prompt packs",
					acceptance_criteria: ["prompt packs exist"],
					allowed_paths: ["src/codex-plan-run/"],
					forbidden_paths: [],
					expected_changed_paths: ["src/codex-plan-run/"],
					dependency_task_ids: [],
					affected_capabilities: ["codex-plan-run"],
					business_paths: [],
					classification: emptySpecTaskClassification(),
					stages: [],
				},
			],
			global_gates: [],
		};
		const report = buildGlobalImpactReport({
			runId: "run-impact",
			framework: dirTaskFramework,
			changedFiles: ["src/codex-plan-run/driver.ts"],
			testEvidence: [{ command: "bun test test/unrelated.test.ts", exit_code: 0 }],
			reviewFindings: [],
		});

		expect(report.status).toBe("repair_required");
		const t01Test = report.required_linked_tests.find(t => t.id.startsWith("T01"));
		expect(t01Test?.command).toBeUndefined();
		expect(report.findings.some(f => f.description.includes("T01"))).toBe(true);
	});

	it("requires repair when review findings contain must_fix", () => {
		const report = buildGlobalImpactReport({
			runId: "run-impact",
			framework,
			changedFiles: ["src/codex-plan-run/driver.ts"],
			testEvidence: [],
			reviewFindings: [
				{ severity: "must_fix", description: "driver skipped advisor gate", evidence: "events.jsonl" },
			],
		});

		expect(report.status).toBe("repair_required");
		expect(report.findings[0]).toMatchObject({ severity: "must_fix" });
	});

	it("blocks when changed files cannot be mapped to framework capabilities", () => {
		const report = buildGlobalImpactReport({
			runId: "run-impact",
			framework,
			changedFiles: ["src/unmapped/feature.ts"],
			testEvidence: [],
			reviewFindings: [],
		});

		expect(report.status).toBe("blocked");
		expect(report.findings[0].description).toContain("src/unmapped/feature.ts");
	});

	it("writes json and markdown reports", async () => {
		const acceptingDir = await makeTempDir();
		const report = buildGlobalImpactReport({
			runId: "run-impact",
			framework,
			changedFiles: ["src/codex-plan-run/driver.ts"],
			testEvidence: [],
			reviewFindings: [],
		});
		const paths = await writeGlobalImpactReport({ acceptingDir, report });

		expect((await stat(paths.jsonPath)).isFile()).toBe(true);
		expect((await stat(paths.markdownPath)).isFile()).toBe(true);
		expect(await readFile(paths.markdownPath, "utf8")).toContain("# Global Impact Report");
	});

	it("blocks code-sensitive changes when required codebase memory evidence is absent", () => {
		const report = buildGlobalImpactReport({
			runId: "run-impact-test",
			framework,
			changedFiles: ["src/codex-plan-run/driver.ts"],
			testEvidence: [{ command: "bun test test/codex-plan-run/driver.test.ts", exit_code: 0 }],
			reviewFindings: [],
			codebaseMemoryMode: "required",
		});

		expect(report.status).toBe("blocked");
		expect(report.findings).toContainEqual(
			expect.objectContaining({
				severity: "must_fix",
				evidence: "Codebase Memory impact evidence is missing",
			}),
		);
	});

	it("blocks empty codebase memory impact evidence for code-sensitive changes in required mode", () => {
		const report = buildGlobalImpactReport({
			runId: "run-impact-test",
			framework,
			changedFiles: ["src/codex-plan-run/driver.ts"],
			testEvidence: [{ command: "bun test test/codex-plan-run/driver.test.ts", exit_code: 0 }],
			reviewFindings: [],
			codebaseMemory: { trace_paths: [] },
			codebaseMemoryMode: "required",
		});

		expect(report.status).toBe("blocked");
		expect(report.findings.some(finding => finding.evidence.includes("src/codex-plan-run/driver.ts"))).toBe(true);
	});

	it("blocks code-sensitive changes when codebase memory evidence is unavailable in required mode", () => {
		const report = buildGlobalImpactReport({
			runId: "run-impact-test",
			framework,
			changedFiles: ["src/codex-plan-run/driver.ts"],
			testEvidence: [{ command: "bun test test/codex-plan-run/driver.test.ts", exit_code: 0 }],
			reviewFindings: [],
			codebaseMemory: { trace_paths: [], unavailable_reason: "graph index missing" },
			codebaseMemoryMode: "required",
		});

		expect(report.status).toBe("blocked");
		expect(report.findings).toContainEqual(
			expect.objectContaining({ severity: "must_fix", evidence: "graph index missing" }),
		);
	});

	it("uses graph risk to raise affected capability confidence and linked tests", () => {
		const report = buildGlobalImpactReport({
			runId: "run-impact-test",
			framework,
			changedFiles: ["src/codex-plan-run/driver.ts"],
			testEvidence: [{ command: "bun test test/codex-plan-run/driver.test.ts", exit_code: 0 }],
			reviewFindings: [],
			codebaseMemory: {
				reindex_summary_path: "codebase-memory-reindex-summary.json",
				trace_paths: [
					{
						changed_file: "src/codex-plan-run/driver.ts",
						symbol: "runPlanRunDriver",
						callers: ["test/codex-plan-run/driver.test.ts"],
						callees: ["evaluateAdvisorGate"],
						risk: "high",
						evidence_path: "impact/driver-trace.json",
					},
				],
			},
			codebaseMemoryMode: "required",
		});

		expect(report.status).toBe("accepted");
		expect(report.affected_capabilities.some(capability => capability.confidence === "high")).toBe(true);
		expect(
			report.required_linked_tests.some(test => test.command === "bun test test/codex-plan-run/driver.test.ts"),
		).toBe(true);
	});
});
