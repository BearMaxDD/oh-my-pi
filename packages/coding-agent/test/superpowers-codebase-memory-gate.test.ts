import { describe, expect, test } from "bun:test";
import { getDefault } from "../src/config/settings-schema";
import {
	resolveSuperpowersCodebaseMemoryGate,
	SUPERPOWERS_CODEBASE_MEMORY_GATE_MARKER,
} from "../src/superpowers/codebase-memory-gate";

describe("superpowers codebase-memory gate", () => {
	test.each([
		"brainstorming",
		"writing-plans",
		"executing-plans",
		"subagent-driven-development",
		"test-driven-development",
		"systematic-debugging",
		"requesting-code-review",
		"receiving-code-review",
		"verification-before-completion",
	])("injects guidance for code-sensitive skill %s", skillName => {
		const result = resolveSuperpowersCodebaseMemoryGate({
			skillName,
			userPrompt: "分析 OMP 代码并规划实现",
			status: { state: "ready", message: "ready", toolCount: 4 },
			mode: "advisory",
		});

		expect(result.shouldInject).toBe(true);
		expect(result.contextMessage).toContain(SUPERPOWERS_CODEBASE_MEMORY_GATE_MARKER);
		expect(result.contextMessage).toContain("search_graph");
		expect(result.contextMessage).toContain("trace_path");
		expect(result.contextMessage).toContain("get_code_snippet");
		expect(result.contextMessage).toContain("只有在查找字符串、配置、非代码文件、文档文件或图谱结果不足时");
	});

	test.each([
		"chinese-documentation",
		"chinese-commit-conventions",
		"finishing-a-development-branch",
	])("does not inject guidance for non-code skill %s", skillName => {
		const result = resolveSuperpowersCodebaseMemoryGate({
			skillName,
			userPrompt: "整理中文文档格式",
			status: { state: "ready", message: "ready", toolCount: 4 },
			mode: "advisory",
		});

		expect(result.shouldInject).toBe(false);
		expect(result.contextMessage).toBeUndefined();
		expect(result.reason).toBe("non_code_skill");
	});

	test("does not inject twice when marker already exists", () => {
		const result = resolveSuperpowersCodebaseMemoryGate({
			skillName: "writing-plans",
			userPrompt: SUPERPOWERS_CODEBASE_MEMORY_GATE_MARKER,
			status: { state: "ready", message: "ready", toolCount: 4 },
			mode: "advisory",
		});

		expect(result.shouldInject).toBe(false);
		expect(result.reason).toBe("already_injected");
	});

	test("keeps degraded status visible when MCP tools are unavailable", () => {
		const result = resolveSuperpowersCodebaseMemoryGate({
			skillName: "systematic-debugging",
			userPrompt: "修复测试失败",
			status: { state: "mcp_unavailable", message: "no graph tools", toolCount: 0 },
			mode: "required",
		});

		expect(result.shouldInject).toBe(true);
		expect(result.required).toBe(true);
		expect(result.contextMessage).toContain("当前 codebase-memory 状态：mcp_unavailable");
		expect(result.contextMessage).toContain("如果图谱不可用，必须说明降级限制");
	});
});

describe("superpowers codebase-memory gate settings", () => {
	test("settings defaults enable the gate in advisory mode", () => {
		expect(getDefault("superpowers.codebaseMemoryGate.enabled")).toBe(true);
		expect(getDefault("superpowers.codebaseMemoryGate.mode")).toBe("advisory");
	});
});
