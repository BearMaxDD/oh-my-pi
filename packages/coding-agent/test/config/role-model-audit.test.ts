/**
 * Strict role model audit — auditStrictRoleBindings.
 *
 * Contract (Task5 plan + Main spec review):
 * 1. auditStrictRoleBindings(settings, registry): RoleModelAuditEntry[]
 * 2. Each entry: { roleId, selector?, contractStatus, modelStatus, executable, message }
 *    - contractStatus: "complete" | "incomplete"
 *    - modelStatus: "unconfigured" | "not_concrete" | "unavailable" | "thinking_unsupported" | "valid"
 *    - executable = modelStatus === "valid" && contractStatus === "complete"
 * 3. All getKnownRoleIds roles are included.
 * 4. Built-in roles with canRunAsSubagent=false get contractStatus incomplete.
 * 5. Must reuse Task1 validateRoleContractForTask (src/task/role-contract-validator).
 */

import { describe, expect, it } from "bun:test";
import type { Model } from "@oh-my-pi/pi-ai";
import { buildModel } from "@oh-my-pi/pi-catalog/build";
import type { ModelRegistry } from "../../src/config/model-registry";
import { auditStrictRoleBindings } from "../../src/config/role-model-audit";
import { Settings } from "../../src/config/settings";

function modelFixture(p: string, id: string, o?: { reasoning?: boolean }): Model {
	return buildModel({
		id,
		provider: p,
		api: "openai-completions",
		name: `${p}/${id}`,
		baseUrl: "https://example.invalid",
		reasoning: o?.reasoning ?? false,
		input: ["text"] as ("text" | "image")[],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow: 16_000,
		maxTokens: 4_096,
	});
}

function fakeRegistry(m: Model[]): ModelRegistry {
	return { getAvailable: () => m } as unknown as ModelRegistry;
}

describe("auditStrictRoleBindings", () => {
	it("returns an array", () => {
		expect(Array.isArray(auditStrictRoleBindings(Settings.isolated({}), fakeRegistry([])))).toBe(true);
	});

	it("reports valid for a subagent-capable role with exact available model", () => {
		const s = Settings.isolated({ modelRoles: { smol: "openai-completions/gpt-4o" } });
		const e = auditStrictRoleBindings(s, fakeRegistry([modelFixture("openai-completions", "gpt-4o")])).find(
			x => x.roleId === "smol",
		)!;
		expect(e.contractStatus).toBe("complete");
		expect(e.modelStatus).toBe("valid");
		expect(e.executable).toBe(true);
		expect(typeof e.message).toBe("string");
	});

	it("marks alias (pi/) as not_concrete", () => {
		const s = Settings.isolated({ modelRoles: { smol: "pi/smol" } });
		const e = auditStrictRoleBindings(s, fakeRegistry([modelFixture("openai-completions", "gpt-4o")])).find(
			x => x.roleId === "smol",
		)!;
		expect(e.modelStatus).toBe("not_concrete");
		expect(e.executable).toBe(false);
	});

	it("marks glob pattern as not_concrete", () => {
		const s = Settings.isolated({ modelRoles: { smol: "openai-completions/*" } });
		const e = auditStrictRoleBindings(s, fakeRegistry([modelFixture("openai-completions", "gpt-4o")])).find(
			x => x.roleId === "smol",
		)!;
		expect(e.modelStatus).toBe("not_concrete");
		expect(e.executable).toBe(false);
	});

	it("marks bare id (no provider) as not_concrete", () => {
		const s = Settings.isolated({ modelRoles: { smol: "gpt-4o" } });
		const e = auditStrictRoleBindings(s, fakeRegistry([modelFixture("openai-completions", "gpt-4o")])).find(
			x => x.roleId === "smol",
		)!;
		expect(e.modelStatus).toBe("not_concrete");
		expect(e.executable).toBe(false);
	});

	it("marks unavailable when concrete selector has no matching model", () => {
		const s = Settings.isolated({ modelRoles: { smol: "openai-completions/gpt-4o" } });
		const e = auditStrictRoleBindings(s, fakeRegistry([modelFixture("openai-completions", "gpt-4o-mini")])).find(
			x => x.roleId === "smol",
		)!;
		expect(e.modelStatus).toBe("unavailable");
		expect(e.executable).toBe(false);
	});

	it("marks unconfigured when role has no modelRoles entry", () => {
		const s = Settings.isolated({ modelRoles: { smol: "openai-completions/gpt-4o" } });
		const e = auditStrictRoleBindings(s, fakeRegistry([modelFixture("openai-completions", "gpt-4o")])).find(
			x => x.roleId === "vision",
		)!;
		expect(e.modelStatus).toBe("unconfigured");
		expect(e.executable).toBe(false);
	});

	it("marks thinking_unsupported when thinking suffix on non-reasoning model", () => {
		const s = Settings.isolated({ modelRoles: { smol: "openai-completions/gpt-4o:high" } });
		const e = auditStrictRoleBindings(s, fakeRegistry([modelFixture("openai-completions", "gpt-4o")])).find(
			x => x.roleId === "smol",
		)!;
		expect(e.modelStatus).toBe("thinking_unsupported");
		expect(e.executable).toBe(false);
	});

	it("marks custom role without contract as contractStatus incomplete", () => {
		const s = Settings.isolated({
			modelRoles: { "custom:r": "openai-completions/gpt-4o" },
			modelTags: { "custom:r": { name: "R" } },
		});
		const e = auditStrictRoleBindings(s, fakeRegistry([modelFixture("openai-completions", "gpt-4o")])).find(
			x => x.roleId === "custom:r",
		)!;
		expect(e.modelStatus).toBe("valid");
		expect(e.contractStatus).toBe("incomplete");
		expect(e.executable).toBe(false);
	});

	it("marks default (canRunAsSubagent=false) as contractStatus incomplete", () => {
		const s = Settings.isolated({ modelRoles: { default: "openai-completions/gpt-4o" } });
		const e = auditStrictRoleBindings(s, fakeRegistry([modelFixture("openai-completions", "gpt-4o")])).find(
			x => x.roleId === "default",
		)!;
		expect(e.modelStatus).toBe("valid");
		expect(e.contractStatus).toBe("incomplete");
		expect(e.executable).toBe(false);
	});

	it("marks tiny (canRunAsSubagent=false) as contractStatus incomplete", () => {
		const s = Settings.isolated({ modelRoles: { tiny: "openai-completions/gpt-4o" } });
		const e = auditStrictRoleBindings(s, fakeRegistry([modelFixture("openai-completions", "gpt-4o")])).find(
			x => x.roleId === "tiny",
		)!;
		expect(e.modelStatus).toBe("valid");
		expect(e.contractStatus).toBe("incomplete");
		expect(e.executable).toBe(false);
	});

	it("reports a mix of roles with distinct statuses", () => {
		const s = Settings.isolated({ modelRoles: { smol: "openai-completions/gpt-4o-mini", slow: "pi/slow" } });
		const es = auditStrictRoleBindings(s, fakeRegistry([modelFixture("openai-completions", "gpt-4o")]));
		expect(es.find(x => x.roleId === "smol")!.executable).toBe(false);
		expect(es.find(x => x.roleId === "slow")!.executable).toBe(false);
		expect(es.find(x => x.roleId === "vision")!.executable).toBe(false);
	});

	it("includes every known built-in role", () => {
		const ids = auditStrictRoleBindings(Settings.isolated({}), fakeRegistry([])).map(x => x.roleId);
		expect(ids).toContain("smol");
		expect(ids).toContain("superpowers:implementer");
		expect(ids).toContain("superpowers:spec-reviewer");
	});

	it("includes roles from modelRoles even without modelTags", () => {
		const s = Settings.isolated({ modelRoles: { bogus: "openai-completions/gpt-4o" } });
		const ids = auditStrictRoleBindings(s, fakeRegistry([modelFixture("openai-completions", "gpt-4o")])).map(
			x => x.roleId,
		);
		expect(ids).toContain("bogus");
	});

	it("shapes each entry with stable keys including message", () => {
		const s = Settings.isolated({ modelRoles: { smol: "openai-completions/gpt-4o" } });
		const e = auditStrictRoleBindings(s, fakeRegistry([modelFixture("openai-completions", "gpt-4o")])).find(
			x => x.roleId === "smol",
		)!;
		expect(Object.keys(e).sort()).toEqual(
			["contractStatus", "executable", "message", "modelStatus", "roleId", "selector"].sort(),
		);
		expect(typeof e.message).toBe("string");
	});

	it("delegates to Task1 validateRoleContractForTask from role-contract-validator", () => {
		// Module does not exist yet → import fails RED.
		const { validateRoleContractForTask } = require("../../src/task/role-contract-validator");
		const { getRoleInfo } = require("../../src/config/model-roles");
		const info = getRoleInfo("default", Settings.isolated({}));
		const result = validateRoleContractForTask({
			roleId: "default",
			roleInfo: info,
			requirements: { needsProductionWrite: false, needsTestWrite: false, readOnly: false },
		});
		expect(result.passed).toBe(false);
	});
});
