export const SUPERPOWERS_CODEBASE_MEMORY_GATE_MARKER = "[Superpowers Codebase-Memory Gate]";

export type SuperpowersCodebaseMemoryGateMode = "off" | "advisory" | "required";

export interface SuperpowersCodebaseMemoryStatus {
	state: "ready" | "not_configured" | "binary_missing" | "mcp_unavailable" | "index_missing" | "query_failed";
	message: string;
	toolCount?: number;
}

export interface ResolveSuperpowersCodebaseMemoryGateInput {
	skillName: string;
	userPrompt?: string;
	status?: SuperpowersCodebaseMemoryStatus;
	mode?: SuperpowersCodebaseMemoryGateMode;
	enabled?: boolean;
}

export interface ResolveSuperpowersCodebaseMemoryGateResult {
	shouldInject: boolean;
	required: boolean;
	reason: "mode_off" | "disabled" | "non_code_skill" | "already_injected" | "inject";
	contextMessage?: string;
}

const CODE_SENSITIVE_SUPERPOWERS_SKILLS = new Set([
	"brainstorming",
	"writing-plans",
	"executing-plans",
	"subagent-driven-development",
	"test-driven-development",
	"systematic-debugging",
	"requesting-code-review",
	"receiving-code-review",
	"verification-before-completion",
]);

export function isCodeSensitiveSuperpowersSkill(skillName: string): boolean {
	const normalized = skillName.replace(/^superpowers:/, "").replace(/^skill:/, "");
	return CODE_SENSITIVE_SUPERPOWERS_SKILLS.has(normalized);
}

export function resolveSuperpowersCodebaseMemoryGate(
	input: ResolveSuperpowersCodebaseMemoryGateInput,
): ResolveSuperpowersCodebaseMemoryGateResult {
	const enabled = input.enabled ?? true;
	const mode = input.mode ?? "advisory";
	if (!enabled) return { shouldInject: false, required: false, reason: "disabled" };
	if (mode === "off") return { shouldInject: false, required: false, reason: "mode_off" };
	if (!isCodeSensitiveSuperpowersSkill(input.skillName)) {
		return { shouldInject: false, required: false, reason: "non_code_skill" };
	}
	if (input.userPrompt?.includes(SUPERPOWERS_CODEBASE_MEMORY_GATE_MARKER)) {
		return { shouldInject: false, required: mode === "required", reason: "already_injected" };
	}

	const status = input.status ?? { state: "ready" as const, message: "ready" };
	const required = mode === "required";
	return {
		shouldInject: true,
		required,
		reason: "inject",
		contextMessage: buildSuperpowersCodebaseMemoryGateMessage(status, required),
	};
}

function buildSuperpowersCodebaseMemoryGateMessage(status: SuperpowersCodebaseMemoryStatus, required: boolean): string {
	const strength = required ? "必须先尝试" : "优先尝试";
	return [
		SUPERPOWERS_CODEBASE_MEMORY_GATE_MARKER,
		`当前 codebase-memory 状态：${status.state}。${status.message}`,
		`当前 superpowers skill 涉及代码理解、规划、调试、实现或审查时，${strength}使用 codebase-memory MCP 图谱工具获取真实代码上下文。`,
		"1. search_graph：定位函数、类、路由、变量、模块或关键符号。",
		"2. trace_path：分析调用方、被调用方、依赖和影响范围。",
		"3. get_code_snippet：在图谱定位后读取精确源码片段。",
		"4. query_graph/get_architecture：需要跨模块关系或架构概览时使用。",
		"只有在查找字符串、配置、非代码文件、文档文件或图谱结果不足时，再使用 rg / 文件读取。",
		"如果图谱不可用，必须说明降级限制，并继续使用现有工具完成任务。",
	].join("\n");
}
