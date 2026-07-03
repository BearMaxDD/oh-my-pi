import { afterEach, describe, expect, it } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
	type PlanRunManifest,
	readPlanRunManifest,
	validatePlanRunManifest,
	writePlanRunManifest,
} from "../../src/codex-plan-run/manifest";

const tempDirs: string[] = [];

async function makeTempDir(): Promise<string> {
	const dir = await mkdtemp(join(tmpdir(), "omp-plan-manifest-"));
	tempDirs.push(dir);
	return dir;
}

afterEach(async () => {
	for (const dir of tempDirs.splice(0)) {
		await rm(dir, { recursive: true, force: true });
	}
});

function createManifest(overrides: Partial<PlanRunManifest> = {}): PlanRunManifest {
	return {
		schema_version: 1,
		run_id: "run-123",
		state: "created",
		source_repo: "/repo",
		worktree: "/worktree",
		git_state: {
			branch: "feature/demo",
			head_commit: "abc1234",
			status_short: "",
		},
		plan: {
			original_path: "/plans/source.md",
			worktree_path: "/worktree/docs/superpowers/plans/source.md",
			sha256: "abc123",
		},
		skill: {
			required: "omp-executing-codex-plan",
			loaded: true,
			loaded_at: "2026-06-21T00:00:00.000Z",
			content_sha256: "def456",
			source_path: "/skills/omp-executing-codex-plan/SKILL.md",
		},
		todos: {
			version: 1,
			state: "synced",
			source: "state-machine",
			pending_required_tasks: 0,
		},
		completion: {
			path: "/worktree/docs/superpowers/completion.md",
			exists: true,
		},
		packet: {
			valid: true,
			packet_id: "packet-123",
		},
		gate_errors: [],
		...overrides,
	};
}

describe("PlanRunManifest", () => {
	it("validates a complete manifest", () => {
		expect(validatePlanRunManifest(createManifest())).toEqual([]);
	});

	it("rejects missing or unknown plan run states from runtime JSON", () => {
		expect(
			validatePlanRunManifest({
				...createManifest(),
				state: "bad",
			} as unknown as PlanRunManifest),
		).toContain("state must be one of PLAN_RUN_STATES");

		const { state: _state, ...missingState } = createManifest();
		expect(validatePlanRunManifest(missingState as unknown as PlanRunManifest)).toContain(
			"state must be one of PLAN_RUN_STATES",
		);
	});

	it("requires a valid packet before review_packet_validated", () => {
		const errors = validatePlanRunManifest(
			createManifest({
				state: "review_packet_validated",
				packet: { valid: false },
			}),
		);

		expect(errors).toContain("review_packet_validated requires packet.valid");
	});

	it("requires main-thread acceptance before review_packet_validated", () => {
		const errors = validatePlanRunManifest(
			createManifest({
				state: "review_packet_validated",
				source_repo: "/worktree",
				execution_book: {
					path: "/worktree/docs/superpowers/accepting/demo/plan-execution-book.md",
					exists: true,
					task_count: 1,
					required_execution_skills: ["omp-executing-codex-plan"],
					required_review_skills: ["requesting-code-review"],
					final_tail_skills: ["verification-before-completion"],
				},
				main_acceptance: {
					result: "MAIN_ACCEPTANCE_FIX_REQUIRED",
					review_round: 1,
					evidence_path: "/worktree/docs/superpowers/accepting/demo/main-acceptance-review.json",
				},
			} as Partial<PlanRunManifest>),
		);

		expect(errors).toContain("review_packet_validated requires MAIN_ACCEPTANCE_ACCEPTED");
	});

	it("requires main acceptance evidence after the main acceptance gate", () => {
		const errors = validatePlanRunManifest(
			createManifest({
				state: "main_acceptance_accepted",
				main_acceptance: {
					result: "MAIN_ACCEPTANCE_ACCEPTED",
					review_round: 1,
					evidence_path: "",
				},
			} as Partial<PlanRunManifest>),
		);

		expect(errors).toContain("main_acceptance.evidence_path is required after main_acceptance_accepted");
	});

	it("requires execution book metadata after the execution book gate", () => {
		const errors = validatePlanRunManifest(
			createManifest({
				state: "execution_book_ready",
				execution_book: undefined,
			}),
		);

		expect(errors).toContain("execution_book is required after execution_book_ready");
		expect(
			validatePlanRunManifest(
				createManifest({
					state: "execution_book_ready",
					source_repo: "/worktree",
					execution_book: {
						path: "/worktree/docs/superpowers/accepting/demo/plan-execution-book.md",
						exists: true,
						task_count: 2,
						required_execution_skills: ["omp-executing-codex-plan"],
						required_review_skills: ["requesting-code-review"],
						final_tail_skills: ["verification-before-completion"],
						content_sha256: "book-sha",
					},
				}),
			),
		).toEqual([]);
	});

	it("requires source_repo to match worktree after the execution book gate", () => {
		const errors = validatePlanRunManifest(
			createManifest({
				state: "execution_book_ready",
				source_repo: "/repo",
				worktree: "/worktree",
				execution_book: {
					path: "/worktree/docs/superpowers/accepting/demo/plan-execution-book.md",
					exists: true,
					task_count: 1,
					required_execution_skills: ["omp-executing-codex-plan"],
					required_review_skills: ["requesting-code-review"],
					final_tail_skills: ["verification-before-completion"],
				},
			}),
		);

		expect(errors).toContain("source_repo must match worktree after execution_book_ready");
	});

	it("requires final git state after the execution book gate", () => {
		const errors = validatePlanRunManifest(
			createManifest({
				state: "execution_book_ready",
				source_repo: "/worktree",
				git_state: undefined,
				execution_book: {
					path: "/worktree/docs/superpowers/accepting/demo/plan-execution-book.md",
					exists: true,
					task_count: 1,
					required_execution_skills: ["omp-executing-codex-plan"],
					required_review_skills: ["requesting-code-review"],
					final_tail_skills: ["verification-before-completion"],
				},
			}),
		);

		expect(errors).toContain("git_state is required after execution_book_ready");
	});

	it("writes JSON to a parent directory and reads it back", async () => {
		const root = await makeTempDir();
		const manifestPath = join(root, "nested", "plan-run.json");
		const manifest = createManifest({ run_id: "run-written" });

		await writePlanRunManifest(manifestPath, manifest);

		expect(await Bun.file(manifestPath).json()).toEqual(manifest);
		expect((await readPlanRunManifest(manifestPath)).run_id).toBe("run-written");
	});

	it("rejects invalid manifests before writing", async () => {
		const root = await makeTempDir();
		const manifestPath = join(root, "plan-run.json");

		await expect(writePlanRunManifest(manifestPath, createManifest({ run_id: "" }))).rejects.toThrow(
			"Invalid PlanRunManifest",
		);
	});
});

describe("extension fields at task_review_pending", () => {
	function makeTaskReviewManifest(overrides: Partial<PlanRunManifest> = {}): PlanRunManifest {
		return createManifest({
			state: "task_review_pending",
			...overrides,
		});
	}

	const validExtensions = {
		codebase_memory: {
			reindex_summary: "complete",
			tasks: {},
		},
		advisor: {
			subagents_enabled: true,
			summary: "done",
		},
		model_routing: {
			tasks: { T1: {} },
		},
		superpowers: {
			codebase_memory_gate_mode: "advisory" as const,
		},
	};

	it("requires codebase_memory.reindex_summary at task_review_pending", () => {
		const errors = validatePlanRunManifest(
			makeTaskReviewManifest({
				...validExtensions,
				codebase_memory: { tasks: {} } as PlanRunManifest["codebase_memory"],
			}),
		);
		expect(errors).toContain("codebase_memory.reindex_summary is required after task_review_pending");
	});

	it("requires advisor.summary at task_review_pending", () => {
		const errors = validatePlanRunManifest(
			makeTaskReviewManifest({
				...validExtensions,
				advisor: { subagents_enabled: false } as PlanRunManifest["advisor"],
			}),
		);
		expect(errors).toContain("advisor.summary is required after task_review_pending");
	});

	it("requires non-empty model_routing.tasks at task_review_pending", () => {
		const errors = validatePlanRunManifest(
			makeTaskReviewManifest({
				...validExtensions,
				model_routing: { tasks: {} },
			}),
		);
		expect(errors).toContain("model_routing.tasks must not be empty after task_review_pending");
	});

	it("requires superpowers.codebase_memory_gate_mode at task_review_pending", () => {
		const errors = validatePlanRunManifest(
			makeTaskReviewManifest({
				...validExtensions,
				superpowers: {} as PlanRunManifest["superpowers"],
			}),
		);
		expect(errors).toContain("superpowers.codebase_memory_gate_mode is required after task_review_pending");
	});

	it("passes validation when all extension fields are present at task_review_pending", () => {
		const errors = validatePlanRunManifest(makeTaskReviewManifest(validExtensions));
		expect(errors.filter(e => /codebase_memory|advisor|model_routing|superpowers/.test(e))).toEqual([]);
	});

	it("does not require extension fields at lower states", () => {
		const errors = validatePlanRunManifest(createManifest({ state: "task_running" }));
		expect(errors.filter(e => e.includes("codebase_memory"))).toEqual([]);
		expect(errors.filter(e => e.includes("advisor"))).toEqual([]);
		expect(errors.filter(e => e.includes("model_routing"))).toEqual([]);
		expect(errors.filter(e => e.includes("superpowers"))).toEqual([]);
	});
});

describe("Task 8 extension fields at final_acceptance_reviewing", () => {
	function makeFinalManifest(overrides: Partial<PlanRunManifest> = {}): PlanRunManifest {
		return createManifest({
			state: "final_acceptance_reviewing",
			...overrides,
		});
	}

	const validExtensions = {
		role_bound_execution: {
			enabled: true,
			spec_task_framework_path: "/accept/spec-task-framework.json",
			spec_task_framework_sha256: "abc123",
			role_registry_snapshot_path: "/accept/role-registry-snapshot.json",
			stages: {
				"T01:tdd-writer": {
					output_path: "/tmp/out.json",
					model_routing_path: "/tmp/model-routing.json",
					advisor_gate_paths: ["/tmp/advisor-gate.json"],
					status: "accepted" as const,
				},
			},
			classification_summary: {
				tasks: {
					T01: {
						runtime_surface: "browser",
						requires_frontend_design: true,
						requires_security_review: false,
						requires_payment_review: false,
						requires_data_migration_review: false,
						requires_destructive_operation_review: false,
						evidence_paths: ["/accept/T01.md"],
					},
				},
				specialized_reviews: [{ type: "requires_frontend_design", evidence_paths: ["/accept/T01.md"] }],
			},
			classification_summary_json: JSON.stringify({
				tasks: {
					T01: {
						runtime_surface: "browser",
						requires_frontend_design: true,
						requires_security_review: false,
						requires_payment_review: false,
						requires_data_migration_review: false,
						requires_destructive_operation_review: false,
						evidence_paths: ["/accept/T01.md"],
					},
				},
				specialized_reviews: [{ type: "requires_frontend_design", evidence_paths: ["/accept/T01.md"] }],
			}),
		},
		advisor_gate: {
			enabled: true,
			records_path: "/accept/tasks",
			blocking_findings: 0,
		},
		global_impact: {
			enabled: true,
			report_path: "/accept/global-impact-report.json",
			status: "accepted" as const,
		},
		real_business_simulation: {
			enabled: true,
			report_path: "/accept/real-runtime-simulation-report.json",
			status: "passed" as const,
		},
	};

	it("requires role_bound_execution.spec_task_framework_path when enabled at final_acceptance_reviewing", () => {
		const errors = validatePlanRunManifest(
			makeFinalManifest({
				role_bound_execution: { enabled: true } as PlanRunManifest["role_bound_execution"],
			}),
		);
		expect(errors).toContain(
			"role_bound_execution.spec_task_framework_path is required when role_bound_execution is enabled after final_acceptance_reviewing",
		);
	});

	it("requires advisor_gate.records_path when enabled at final_acceptance_reviewing", () => {
		const errors = validatePlanRunManifest(
			makeFinalManifest({
				advisor_gate: { enabled: true } as PlanRunManifest["advisor_gate"],
			}),
		);
		expect(errors).toContain(
			"advisor_gate.records_path is required when advisor_gate is enabled after final_acceptance_reviewing",
		);
	});

	it("requires global_impact.report_path when enabled at final_acceptance_reviewing", () => {
		const errors = validatePlanRunManifest(
			makeFinalManifest({
				global_impact: { enabled: true } as PlanRunManifest["global_impact"],
			}),
		);
		expect(errors).toContain(
			"global_impact.report_path is required when global_impact is enabled after final_acceptance_reviewing",
		);
	});

	it("requires real_business_simulation.report_path when enabled at final_acceptance_reviewing", () => {
		const errors = validatePlanRunManifest(
			makeFinalManifest({
				real_business_simulation: { enabled: true } as PlanRunManifest["real_business_simulation"],
			}),
		);
		expect(errors).toContain(
			"real_business_simulation.report_path is required when real_business_simulation is enabled after final_acceptance_reviewing",
		);
	});

	it("passes validation when all Task 8 extension fields are present at final_acceptance_reviewing", () => {
		const errors = validatePlanRunManifest(makeFinalManifest(validExtensions));
		expect(
			errors.filter(e => /role_bound_execution|advisor_gate|global_impact|real_business_simulation/.test(e)),
		).toEqual([]);
	});

	it("does not require Task 8 extension fields at lower states", () => {
		const errors = validatePlanRunManifest(createManifest({ state: "task_accepted" }));
		expect(errors.filter(e => e.includes("role_bound_execution"))).toEqual([]);
		expect(errors.filter(e => e.includes("advisor_gate"))).toEqual([]);
		expect(errors.filter(e => e.includes("global_impact"))).toEqual([]);
		expect(errors.filter(e => e.includes("real_business_simulation"))).toEqual([]);
	});

	it("does not require spec_task_framework_path when role_bound_execution is disabled", () => {
		const errors = validatePlanRunManifest(
			makeFinalManifest({
				role_bound_execution: { enabled: false },
			}),
		);
		expect(errors.filter(e => e.includes("role_bound_execution"))).toEqual([]);
	});

	it("does not require report_path when global_impact is disabled", () => {
		const errors = validatePlanRunManifest(
			makeFinalManifest({
				global_impact: { enabled: false },
			}),
		);
		expect(errors.filter(e => e.includes("global_impact"))).toEqual([]);
	});

	it("requires role-bound stage map and framework hash when role-bound execution is enabled", () => {
		const manifest = createManifest({
			state: "main_acceptance_review_running",
			role_bound_execution: {
				enabled: true,
				role_registry_snapshot_path: "/worktree/docs/superpowers/accepting/demo/role-registry-snapshot.json",
				spec_task_framework_path: "/worktree/docs/superpowers/accepting/demo/spec-task-framework.json",
				spec_task_framework_sha256: "",
				stages: {},
			},
		} as Partial<PlanRunManifest>);

		const errors = validatePlanRunManifest(manifest);
		expect(errors).toContain(
			"role_bound_execution.spec_task_framework_sha256 is required when role-bound execution is enabled",
		);
		expect(errors).toContain("role_bound_execution.stages must not be empty when role-bound execution is enabled");
	});
});

describe("classification_summary validation with role_bound_execution", () => {
	it("returns error when role_bound_execution is enabled but classification_summary is missing at final state", () => {
		const errors = validatePlanRunManifest(
			createManifest({
				state: "main_acceptance_accepted",
				main_acceptance: {
					result: "MAIN_ACCEPTANCE_ACCEPTED",
					review_round: 1,
					evidence_path: "/accept/main-acceptance-review.json",
				},
				role_bound_execution: {
					enabled: true,
					spec_task_framework_path: "/accept/spec-task-framework.json",
					spec_task_framework_sha256: "abc123",
					stages: {
						"T01:tdd-writer": {
							output_path: "/tmp/out.json",
							model_routing_path: "/tmp/model.json",
							advisor_gate_paths: [],
							status: "accepted" as const,
						},
					},
				} as PlanRunManifest["role_bound_execution"],
			}),
		);
		expect(errors).toContain(
			"role_bound_execution.classification_summary is required when role-bound execution is enabled",
		);
	});

	it("rejects legacy string classification_summary when role_bound_execution is enabled", () => {
		const errors = validatePlanRunManifest(
			createManifest({
				state: "main_acceptance_accepted",
				main_acceptance: {
					result: "MAIN_ACCEPTANCE_ACCEPTED",
					review_round: 1,
					evidence_path: "/accept/main-acceptance-review.json",
				},
				role_bound_execution: {
					enabled: true,
					spec_task_framework_path: "/accept/spec-task-framework.json",
					spec_task_framework_sha256: "abc123",
					stages: {
						"T01:tdd-writer": {
							output_path: "/tmp/out.json",
							model_routing_path: "/tmp/model.json",
							advisor_gate_paths: [],
							status: "accepted" as const,
						},
					},
					classification_summary: "requires_frontend_design, requires_security_review, runtime_surface: browser",
				} as unknown as PlanRunManifest["role_bound_execution"],
			}),
		);
		expect(errors).toContain("role_bound_execution.classification_summary must be a structured object with tasks");
	});

	it("passes validation for classification_summary when present with role_bound_execution enabled", () => {
		const errors = validatePlanRunManifest(
			createManifest({
				state: "main_acceptance_accepted",
				main_acceptance: {
					result: "MAIN_ACCEPTANCE_ACCEPTED",
					review_round: 1,
					evidence_path: "/accept/main-acceptance-review.json",
				},
				role_bound_execution: {
					enabled: true,
					spec_task_framework_path: "/accept/spec-task-framework.json",
					spec_task_framework_sha256: "abc123",
					stages: {
						"T01:tdd-writer": {
							output_path: "/tmp/out.json",
							model_routing_path: "/tmp/model.json",
							advisor_gate_paths: [],
							status: "accepted" as const,
						},
					},
					classification_summary: {
						tasks: {
							T01: {
								runtime_surface: "browser",
								requires_frontend_design: true,
								requires_security_review: false,
								requires_payment_review: false,
								requires_data_migration_review: false,
								requires_destructive_operation_review: false,
								evidence_paths: ["/accept/T01.md"],
							},
						},
						specialized_reviews: [{ type: "requires_frontend_design", evidence_paths: ["/accept/T01.md"] }],
					},
					classification_summary_json: JSON.stringify({
						tasks: {
							T01: {
								runtime_surface: "browser",
								requires_frontend_design: true,
								requires_security_review: false,
								requires_payment_review: false,
								requires_data_migration_review: false,
								requires_destructive_operation_review: false,
								evidence_paths: ["/accept/T01.md"],
							},
						},
						specialized_reviews: [{ type: "requires_frontend_design", evidence_paths: ["/accept/T01.md"] }],
					}),
				} as unknown as PlanRunManifest["role_bound_execution"],
			}),
		);
		expect(errors.filter(e => e.includes("classification_summary"))).toEqual([]);
	});

	it("rejects missing classification_summary_json when role_bound_execution is enabled", () => {
		const summary = {
			tasks: {
				T01: {
					runtime_surface: "browser",
					requires_frontend_design: true,
					requires_security_review: false,
					requires_payment_review: false,
					requires_data_migration_review: false,
					requires_destructive_operation_review: false,
					evidence_paths: ["/accept/T01.md"],
				},
			},
		};
		const errors = validatePlanRunManifest(
			createManifest({
				state: "main_acceptance_accepted",
				main_acceptance: {
					result: "MAIN_ACCEPTANCE_ACCEPTED",
					review_round: 1,
					evidence_path: "/accept/main-acceptance-review.json",
				},
				role_bound_execution: {
					enabled: true,
					spec_task_framework_path: "/accept/spec-task-framework.json",
					spec_task_framework_sha256: "abc123",
					stages: {
						"T01:tdd-writer": {
							output_path: "/tmp/out.json",
							model_routing_path: "/tmp/model.json",
							advisor_gate_paths: [],
							status: "accepted" as const,
						},
					},
					classification_summary: summary,
				},
			}),
		);
		expect(errors).toContain(
			"role_bound_execution.classification_summary_json is required when role-bound execution is enabled",
		);
	});

	it("rejects stale classification_summary_json when it does not match classification_summary", () => {
		const summary = {
			tasks: {
				T01: {
					runtime_surface: "browser",
					requires_frontend_design: true,
					requires_security_review: false,
					requires_payment_review: false,
					requires_data_migration_review: false,
					requires_destructive_operation_review: false,
					evidence_paths: ["/accept/T01.md"],
				},
			},
		};
		const errors = validatePlanRunManifest(
			createManifest({
				state: "main_acceptance_accepted",
				main_acceptance: {
					result: "MAIN_ACCEPTANCE_ACCEPTED",
					review_round: 1,
					evidence_path: "/accept/main-acceptance-review.json",
				},
				role_bound_execution: {
					enabled: true,
					spec_task_framework_path: "/accept/spec-task-framework.json",
					spec_task_framework_sha256: "abc123",
					stages: {
						"T01:tdd-writer": {
							output_path: "/tmp/out.json",
							model_routing_path: "/tmp/model.json",
							advisor_gate_paths: [],
							status: "accepted" as const,
						},
					},
					classification_summary: summary,
					classification_summary_json: JSON.stringify({ tasks: { T01: { runtime_surface: "api" } } }),
				},
			}),
		);
		expect(errors).toContain("role_bound_execution.classification_summary_json must match classification_summary");
	});

	it("does not require classification_summary when role_bound_execution is disabled", () => {
		const errors = validatePlanRunManifest(
			createManifest({
				state: "main_acceptance_accepted",
				main_acceptance: {
					result: "MAIN_ACCEPTANCE_ACCEPTED",
					review_round: 1,
					evidence_path: "/accept/main-acceptance-review.json",
				},
			}),
		);
		expect(errors.filter(e => e.includes("classification_summary"))).toEqual([]);
	});
});
