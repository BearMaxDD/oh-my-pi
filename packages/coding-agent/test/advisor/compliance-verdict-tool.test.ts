/**
 * ComplianceVerdictTool — unit tests for the tool class itself.
 *
 * These test the tool in isolation: schema validation (pass/remediate/invalid),
 * sink integration, and the bridge convention (sink gate).
 */

import { describe, expect, it, vi } from "bun:test";
import { ComplianceVerdictTool } from "../../src/advisor/compliance-verdict-tool";

const validPass = { task: "code-review-3", hash: "abc123", action: "pass" as const };
const validRemediate = {
	task: "code-review-3",
	hash: "abc123",
	action: "remediate" as const,
	requiredFix: "Add input validation to createUser()",
};

describe("ComplianceVerdictTool", () => {
	describe("schema validation", () => {
		it("accepts a valid pass verdict", async () => {
			const sink = vi.fn().mockResolvedValue({ success: true });
			const tool = new ComplianceVerdictTool(sink);
			const result = await tool.execute("test", validPass);

			expect(result.isError).toBeFalsy();
			expect(sink).toHaveBeenCalledWith(validPass);
			expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("pass") });
		});

		it("accepts a valid remediate with requiredFix", async () => {
			const sink = vi.fn().mockResolvedValue({ success: true });
			const tool = new ComplianceVerdictTool(sink);
			const result = await tool.execute("test", validRemediate);

			expect(result.isError).toBeFalsy();
			expect(sink).toHaveBeenCalledWith(validRemediate);
			expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("remediate") });
		});

		it("rejects remediate without requiredFix", async () => {
			const sink = vi.fn();
			const tool = new ComplianceVerdictTool(sink);
			const promise = tool.execute("test", {
				task: "review-1",
				hash: "def456",
				action: "remediate",
				// requiredFix intentionally missing
			} as any);

			await expect(promise).rejects.toThrow();
			expect(sink).not.toHaveBeenCalled();
		});

		it("rejects pass with requiredFix present", async () => {
			const sink = vi.fn();
			const tool = new ComplianceVerdictTool(sink);
			const promise = tool.execute("test", {
				task: "review-1",
				hash: "def456",
				action: "pass",
				requiredFix: "nonsense",
			} as any);

			await expect(promise).rejects.toThrow();
			expect(sink).not.toHaveBeenCalled();
		});

		it("rejects unknown action", async () => {
			const sink = vi.fn();
			const tool = new ComplianceVerdictTool(sink);
			const promise = tool.execute("test", {
				task: "review-1",
				hash: "def456",
				action: "unknown",
			} as any);

			await expect(promise).rejects.toThrow();
			expect(sink).not.toHaveBeenCalled();
		});

		it("rejects empty task", async () => {
			const sink = vi.fn();
			const tool = new ComplianceVerdictTool(sink);
			const promise = tool.execute("test", { task: "", hash: "x", action: "pass" } as any);

			await expect(promise).rejects.toThrow();
			expect(sink).not.toHaveBeenCalled();
		});

		it("rejects empty hash", async () => {
			const sink = vi.fn();
			const tool = new ComplianceVerdictTool(sink);
			const promise = tool.execute("test", { task: "x", hash: "", action: "pass" } as any);

			await expect(promise).rejects.toThrow();
			expect(sink).not.toHaveBeenCalled();
		});
	});

	describe("sink integration", () => {
		it("returns isError when sink rejects", async () => {
			const sink = vi.fn().mockResolvedValue({ success: false, error: "Task already closed" });
			const tool = new ComplianceVerdictTool(sink);
			const result = await tool.execute("test", validPass);

			expect(result.isError).toBe(true);
			expect(result.content[0]).toMatchObject({ type: "text", text: expect.stringContaining("Task already closed") });
		});

		it("forwards the sink error text when no explicit message", async () => {
			const sink = vi.fn().mockResolvedValue({ success: false }); // no error field
			const tool = new ComplianceVerdictTool(sink);
			const result = await tool.execute("test", validPass);

			expect(result.isError).toBe(true);
		});

		it("handles sink throwing", async () => {
			const sink = vi.fn().mockRejectedValue(new Error("db error"));
			const tool = new ComplianceVerdictTool(sink);
			await expect(tool.execute("test", validPass)).rejects.toThrow("db error");
		});

		it("passes task and hash to sink", async () => {
			const sink = vi.fn().mockResolvedValue({ success: true });
			const tool = new ComplianceVerdictTool(sink);

			await tool.execute("test", {
				task: "custom-review-42",
				hash: "sha256:deadbeef",
				action: "pass",
			});

			expect(sink).toHaveBeenCalledWith({
				task: "custom-review-42",
				hash: "sha256:deadbeef",
				action: "pass",
				requiredFix: undefined,
			});
		});

		it("supports repeated calls with different verdicts", async () => {
			const sink = vi.fn().mockResolvedValue({ success: true });
			const tool = new ComplianceVerdictTool(sink);

			await tool.execute("test", validPass);
			await tool.execute("test", validRemediate);

			expect(sink).toHaveBeenCalledTimes(2);
		});
	});

	describe("tool metadata", () => {
		it("exposes expected tool identity", () => {
			const sink = vi.fn();
			const tool = new ComplianceVerdictTool(sink);

			expect(tool.name).toBe("compliance_verdict");
			expect(tool.label).toBe("Compliance Verdict");
			expect(tool.description).toBeTruthy();
			expect(tool.parameters).toBeTruthy();
		});
	});
});
