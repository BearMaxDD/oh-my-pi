/**
 * Built-in model roles and role metadata helpers.
 */

import type { ThemeColor } from "../modes/theme/theme";
import type { Settings } from "./settings";

export type ModelRole =
	| "default"
	| "smol"
	| "slow"
	| "vision"
	| "plan"
	| "acceptance"
	| "designer"
	| "commit"
	| "title"
	| "task"
	| "advisor"
	| "superpowers:tdd-writer"
	| "superpowers:implementer"
	| "superpowers:test-runner"
	| "superpowers:spec-reviewer"
	| "superpowers:quality-reviewer"
	| "superpowers:acceptance"
	| "superpowers:advisor"
	| "superpowers:prompt-engineer"
	| "superpowers:impact-reviewer"
	| "superpowers:runtime-simulator"
	| "superpowers:business-scenario-reviewer"
	| "superpowers:frontend-designer"
	| "superpowers:security-reviewer"
	| "superpowers:release-auditor"
	| "superpowers:payment-reviewer"
	| "superpowers:data-migration-reviewer";

export type RecommendedModelTier = "fast" | "balanced" | "high" | "xhigh";

const MODEL_ROLE_THEME_COLORS: ReadonlySet<string> = new Set([
	"accent",
	"border",
	"borderAccent",
	"borderMuted",
	"success",
	"error",
	"warning",
	"muted",
	"dim",
	"text",
	"thinkingText",
	"userMessageText",
	"customMessageText",
	"customMessageLabel",
	"toolTitle",
	"toolOutput",
	"mdHeading",
	"mdLink",
	"mdLinkUrl",
	"mdCode",
	"mdCodeBlock",
	"mdCodeBlockBorder",
	"mdQuote",
	"mdQuoteBorder",
	"mdHr",
	"mdListBullet",
	"toolDiffAdded",
	"toolDiffRemoved",
	"toolDiffContext",
	"syntaxComment",
	"syntaxKeyword",
	"syntaxFunction",
	"syntaxVariable",
	"syntaxString",
	"syntaxNumber",
	"syntaxType",
	"syntaxOperator",
	"syntaxPunctuation",
	"thinkingOff",
	"thinkingMinimal",
	"thinkingLow",
	"thinkingMedium",
	"thinkingHigh",
	"thinkingXhigh",
	"bashMode",
	"pythonMode",
	"statusLineSep",
	"statusLineModel",
	"statusLinePath",
	"statusLineGitClean",
	"statusLineGitDirty",
	"statusLineContext",
	"statusLineSpend",
	"statusLineStaged",
	"statusLineDirty",
	"statusLineUntracked",
	"statusLineOutput",
	"statusLineCost",
	"statusLineSubagents",
]);

function isValidThemeColor(color: string): color is ThemeColor {
	return MODEL_ROLE_THEME_COLORS.has(color);
}

export type RoleCapability =
	| "planning"
	| "test_authoring"
	| "implementation"
	| "test_running"
	| "spec_review"
	| "quality_review"
	| "acceptance"
	| "advisory"
	| "runtime_simulation"
	| "business_review"
	| "impact_review"
	| "frontend_design"
	| "security_review"
	| "release_audit"
	| "commit"
	| "payment_review"
	| "data_migration_review";

export interface ModelRoleInfo {
	tag?: string;
	name: string;
	description?: string;
	color?: ThemeColor;
	/** If true, the role is functional but not shown in the model selector UI. */
	hidden?: boolean;

	zhLabel?: string;
	zhDescription?: string;

	/**
	 * Chinese hint rendered in the model-selector context menu.
	 * When present, formatRoleInfoForMenu displays `${prefix} (${menuHintZh})`.
	 */
	menuHintZh?: string;

	/** Recommended model tier for internal role routing. */
	recommendedTier?: RecommendedModelTier;

	/** Whether this role benefits from the most advanced model available. */
	recommendAdvancedModel?: boolean;

	/** Ordered list of fallback roles when the primary role assignment fails. */
	fallbackRoleIds?: string[];

	/** Capabilities that this role is designed for. */
	capabilities?: RoleCapability[];

	/** Whether the role can be executed as a subagent. */
	canRunAsSubagent?: boolean;

	/** If true, the role is restricted to read-only access. */
	readOnly?: boolean;

	/** Whether the role can modify production code. */
	canEditProductionCode?: boolean;

	/** Whether the role can modify test code. */
	canEditTestCode?: boolean;

	/** If true, the role requires an advisor subagent. */
	requiresAdvisor?: boolean;
}

export const MODEL_ROLES: Record<ModelRole, ModelRoleInfo> = {
	default: {
		tag: "DEFAULT",
		name: "Default",
		zhDescription: "默认主对话和未指定角色",
		menuHintZh: "默认主对话/未指定角色，建议高级模型",
		recommendedTier: "high",
		recommendAdvancedModel: true,
		fallbackRoleIds: [],
		capabilities: [],
		canRunAsSubagent: false,
		readOnly: false,
		canEditProductionCode: true,
		canEditTestCode: true,
		requiresAdvisor: false,
		color: "success",
	},
	smol: {
		tag: "SMOL",
		name: "Fast",
		zhDescription: "快速小任务、轻量查询、格式转换",
		menuHintZh: "快速小任务/轻量查询，建议轻量模型",
		recommendedTier: "fast",
		recommendAdvancedModel: false,
		fallbackRoleIds: ["default"],
		capabilities: [],
		canRunAsSubagent: true,
		readOnly: false,
		canEditProductionCode: false,
		canEditTestCode: false,
		requiresAdvisor: false,
		color: "warning",
	},
	slow: {
		tag: "SLOW",
		name: "Thinking",
		zhDescription: "深度思考、复杂推理、疑难问题",
		menuHintZh: "深度推理/疑难问题，建议最高质量模型",
		recommendedTier: "xhigh",
		recommendAdvancedModel: true,
		fallbackRoleIds: ["default"],
		capabilities: ["planning"],
		canRunAsSubagent: true,
		readOnly: false,
		canEditProductionCode: true,
		canEditTestCode: true,
		requiresAdvisor: false,
		color: "accent",
	},
	vision: {
		tag: "VISION",
		name: "Vision",
		zhDescription: "图片、截图、视觉理解",
		menuHintZh: "图片/截图/视觉理解，建议高级模型",
		recommendedTier: "high",
		recommendAdvancedModel: true,
		fallbackRoleIds: ["default"],
		capabilities: [],
		canRunAsSubagent: true,
		readOnly: true,
		canEditProductionCode: false,
		canEditTestCode: false,
		requiresAdvisor: false,
		color: "error",
	},
	plan: {
		tag: "PLAN",
		name: "Architect",
		zhDescription: "架构设计、PRD/TRD、执行计划",
		menuHintZh: "架构/PRD/TRD/执行计划，建议最高质量模型",
		recommendedTier: "xhigh",
		recommendAdvancedModel: true,
		fallbackRoleIds: ["slow", "default"],
		capabilities: ["planning"],
		canRunAsSubagent: true,
		readOnly: false,
		canEditProductionCode: false,
		canEditTestCode: false,
		requiresAdvisor: false,
		color: "muted",
	},
	acceptance: {
		tag: "ACCEPT",
		name: "Acceptance",
		description: "Model role used for final acceptance review and must-fix decisions.",
		zhDescription: "最终验收、must-fix 判定、通过/拒绝",
		menuHintZh: "Acceptance，最终验收/must-fix 判定，建议最高质量模型",
		recommendedTier: "xhigh",
		recommendAdvancedModel: true,
		fallbackRoleIds: ["slow", "default"],
		capabilities: ["acceptance"],
		canRunAsSubagent: true,
		readOnly: true,
		canEditProductionCode: false,
		canEditTestCode: false,
		requiresAdvisor: false,
		color: "accent",
	},
	designer: {
		tag: "DESIGNER",
		name: "Designer",
		zhDescription: "产品设计、前端体验、视觉方案",
		menuHintZh: "产品设计/前端体验，建议高级模型",
		recommendedTier: "high",
		recommendAdvancedModel: true,
		fallbackRoleIds: ["default"],
		capabilities: ["frontend_design"],
		canRunAsSubagent: true,
		readOnly: true,
		canEditProductionCode: false,
		canEditTestCode: false,
		requiresAdvisor: false,
		color: "muted",
	},
	commit: {
		tag: "COMMIT",
		name: "Commit",
		zhDescription: "commit message、变更归纳、收尾",
		menuHintZh: "提交信息/变更归纳，建议平衡模型",
		recommendedTier: "balanced",
		recommendAdvancedModel: false,
		fallbackRoleIds: ["smol", "default"],
		capabilities: ["commit"],
		canRunAsSubagent: true,
		readOnly: true,
		canEditProductionCode: false,
		canEditTestCode: false,
		requiresAdvisor: false,
		color: "dim",
	},
	title: {
		tag: "TITLE",
		name: "Title",
		zhDescription: "会话标题生成",
		menuHintZh: "会话标题生成，建议轻量模型",
		recommendedTier: "fast",
		recommendAdvancedModel: false,
		fallbackRoleIds: ["smol", "default"],
		capabilities: [],
		canRunAsSubagent: false,
		readOnly: true,
		canEditProductionCode: false,
		canEditTestCode: false,
		requiresAdvisor: false,
		color: "dim",
		hidden: true,
	},
	task: {
		tag: "TASK",
		name: "Subtask",
		zhDescription: "一般子任务执行",
		menuHintZh: "一般子任务执行，建议高质量模型",
		recommendedTier: "high",
		recommendAdvancedModel: true,
		fallbackRoleIds: ["default"],
		capabilities: ["implementation"],
		canRunAsSubagent: true,
		readOnly: false,
		canEditProductionCode: true,
		canEditTestCode: true,
		requiresAdvisor: false,
		color: "muted",
	},
	advisor: {
		tag: "ADVISOR",
		name: "Advisor",
		zhDescription: "监管、风险提示、偏航检测",
		menuHintZh: "监管偏航/证据/风险，建议最高质量模型",
		recommendedTier: "xhigh",
		recommendAdvancedModel: true,
		fallbackRoleIds: ["slow", "default"],
		capabilities: ["advisory"],
		canRunAsSubagent: true,
		readOnly: true,
		canEditProductionCode: false,
		canEditTestCode: false,
		requiresAdvisor: false,
		color: "accent",
	},
	"superpowers:tdd-writer": {
		tag: "TDD",
		name: "TDD Writer",
		description: "读任务规格，写失败测试，提交 red evidence",
		color: "accent",
		zhDescription: "TDD Writer：读任务规格，写失败测试，提交 red evidence",
		menuHintZh: "TDD Writer，写失败测试和 red evidence，建议高级模型",
		recommendedTier: "high",
		recommendAdvancedModel: true,
		fallbackRoleIds: ["task", "default"],
		capabilities: ["test_authoring"],
		canRunAsSubagent: true,
		readOnly: false,
		canEditProductionCode: false,
		canEditTestCode: true,
		requiresAdvisor: true,
	},
	"superpowers:implementer": {
		tag: "DEV",
		name: "Implementer",
		description: "只改生产代码，让 red 测试变绿",
		color: "success",
		zhDescription: "Implementer：只改生产代码，让 red 测试变绿",
		menuHintZh: "Implementer，只改生产代码让测试变绿，建议高级模型",
		recommendedTier: "high",
		recommendAdvancedModel: true,
		fallbackRoleIds: ["task", "default"],
		capabilities: ["implementation"],
		canRunAsSubagent: true,
		readOnly: false,
		canEditProductionCode: true,
		canEditTestCode: false,
		requiresAdvisor: true,
	},
	"superpowers:test-runner": {
		tag: "TEST",
		name: "Test Runner",
		description: "独立运行测试和 smoke，产出 green evidence",
		color: "warning",
		zhDescription: "Test Runner：独立运行测试和 smoke，产出 green evidence",
		menuHintZh: "Test Runner，独立运行测试和 smoke，建议平衡模型",
		recommendedTier: "balanced",
		recommendAdvancedModel: false,
		fallbackRoleIds: ["task", "default"],
		capabilities: ["test_running"],
		canRunAsSubagent: true,
		readOnly: true,
		canEditProductionCode: false,
		canEditTestCode: false,
		requiresAdvisor: true,
	},
	"superpowers:spec-reviewer": {
		tag: "SPEC",
		name: "Spec Reviewer",
		description: "对照计划/规格审查实现是否不多不少",
		color: "muted",
		zhDescription: "Spec Reviewer：对照计划/规格审查实现是否不多不少",
		menuHintZh: "Spec Reviewer，对照计划/规格审查，建议最高质量模型",
		recommendedTier: "xhigh",
		recommendAdvancedModel: true,
		fallbackRoleIds: ["advisor", "slow", "default"],
		capabilities: ["spec_review"],
		canRunAsSubagent: true,
		readOnly: true,
		canEditProductionCode: false,
		canEditTestCode: false,
		requiresAdvisor: true,
	},
	"superpowers:quality-reviewer": {
		tag: "REVIEW",
		name: "Quality Reviewer",
		description: "审查代码质量和测试质量",
		color: "accent",
		zhDescription: "Quality Reviewer：审查代码质量和测试质量",
		menuHintZh: "Quality Reviewer，审查代码质量和测试质量，建议最高质量模型",
		recommendedTier: "xhigh",
		recommendAdvancedModel: true,
		fallbackRoleIds: ["advisor", "slow", "default"],
		capabilities: ["quality_review"],
		canRunAsSubagent: true,
		readOnly: true,
		canEditProductionCode: false,
		canEditTestCode: false,
		requiresAdvisor: true,
	},
	"superpowers:acceptance": {
		tag: "ACCEPT",
		name: "Acceptance",
		description: "只处理 must-fix 和最终通过/拒绝",
		color: "error",
		zhDescription: "Acceptance：只处理 must-fix 和最终通过/拒绝",
		menuHintZh: "Acceptance，只处理 must-fix 和最终通过/拒绝，建议最高质量模型",
		recommendedTier: "xhigh",
		recommendAdvancedModel: true,
		fallbackRoleIds: ["acceptance", "slow", "default"],
		capabilities: ["acceptance"],
		canRunAsSubagent: true,
		readOnly: true,
		canEditProductionCode: false,
		canEditTestCode: false,
		requiresAdvisor: true,
	},
	"superpowers:advisor": {
		tag: "SP-ADV",
		name: "Advisor",
		zhDescription: "Advisor：监管执行链路、发现偷懒、证据不足和偏航",
		menuHintZh: "Advisor，监管偏航/证据/风险，建议最高质量模型",
		recommendedTier: "xhigh",
		recommendAdvancedModel: true,
		fallbackRoleIds: ["advisor", "slow", "default"],
		capabilities: ["advisory"],
		canRunAsSubagent: true,
		readOnly: true,
		canEditProductionCode: false,
		canEditTestCode: false,
		requiresAdvisor: false,
		color: "accent",
	},
	"superpowers:prompt-engineer": {
		tag: "PROMPT",
		name: "Prompt Engineer",
		zhDescription: "Prompt Engineer：为子代理生成结构化 Prompt Pack",
		menuHintZh: "Prompt Engineer，编译子代理任务包，建议最高质量模型",
		recommendedTier: "xhigh",
		recommendAdvancedModel: true,
		fallbackRoleIds: ["plan", "slow", "default"],
		capabilities: ["planning"],
		canRunAsSubagent: true,
		readOnly: false,
		canEditProductionCode: false,
		canEditTestCode: false,
		requiresAdvisor: true,
		color: "muted",
	},
	"superpowers:impact-reviewer": {
		tag: "IMPACT",
		name: "Impact Reviewer",
		zhDescription: "Impact Reviewer：分析本次修改影响哪些功能和联动测试",
		menuHintZh: "Impact Reviewer，分析影响面和联动测试，建议最高质量模型",
		recommendedTier: "xhigh",
		recommendAdvancedModel: true,
		fallbackRoleIds: ["advisor", "slow", "default"],
		capabilities: ["impact_review"],
		canRunAsSubagent: true,
		readOnly: true,
		canEditProductionCode: false,
		canEditTestCode: false,
		requiresAdvisor: true,
		color: "warning",
	},
	"superpowers:runtime-simulator": {
		tag: "RUNTIME",
		name: "Runtime Simulator",
		zhDescription: "Runtime Simulator：启动真实环境并执行真实业务路径模拟",
		menuHintZh: "Runtime Simulator，真实环境业务路径模拟，建议高质量模型",
		recommendedTier: "high",
		recommendAdvancedModel: true,
		fallbackRoleIds: ["task", "default"],
		capabilities: ["runtime_simulation"],
		canRunAsSubagent: true,
		readOnly: true,
		canEditProductionCode: false,
		canEditTestCode: false,
		requiresAdvisor: true,
		color: "success",
	},
	"superpowers:business-scenario-reviewer": {
		tag: "BUSINESS",
		name: "Business Scenario Reviewer",
		zhDescription: "Business Scenario Reviewer：审查真实业务场景覆盖是否足够",
		menuHintZh: "Business Scenario Reviewer，审查业务场景覆盖，建议最高质量模型",
		recommendedTier: "xhigh",
		recommendAdvancedModel: true,
		fallbackRoleIds: ["advisor", "slow", "default"],
		capabilities: ["business_review"],
		canRunAsSubagent: true,
		readOnly: true,
		canEditProductionCode: false,
		canEditTestCode: false,
		requiresAdvisor: true,
		color: "muted",
	},
	"superpowers:frontend-designer": {
		tag: "FE-DESIGN",
		name: "Frontend Designer",
		zhDescription: "Frontend Designer：前端改动自动附带设计审查和交互质量建议",
		menuHintZh: "Frontend Designer，前端/UI/TUI 设计审查，建议高级模型",
		recommendedTier: "high",
		recommendAdvancedModel: true,
		fallbackRoleIds: ["designer", "default"],
		capabilities: ["frontend_design"],
		canRunAsSubagent: true,
		readOnly: true,
		canEditProductionCode: false,
		canEditTestCode: false,
		requiresAdvisor: true,
		color: "muted",
	},
	"superpowers:security-reviewer": {
		tag: "SEC",
		name: "Security Reviewer",
		zhDescription: "Security Reviewer：审查权限、鉴权、密钥、危险命令和数据破坏风险",
		menuHintZh: "Security Reviewer，安全权限审查，建议最高质量模型",
		recommendedTier: "xhigh",
		recommendAdvancedModel: true,
		fallbackRoleIds: ["advisor", "slow", "default"],
		capabilities: ["security_review"],
		canRunAsSubagent: true,
		readOnly: true,
		canEditProductionCode: false,
		canEditTestCode: false,
		requiresAdvisor: true,
		color: "error",
	},
	"superpowers:release-auditor": {
		tag: "RELEASE",
		name: "Release Auditor",
		zhDescription: "Release Auditor：最终发布前检查证据、文档、迁移和回滚口径",
		menuHintZh: "Release Auditor，发布前证据和回滚审查，建议最高质量模型",
		recommendedTier: "xhigh",
		recommendAdvancedModel: true,
		fallbackRoleIds: ["acceptance", "slow", "default"],
		capabilities: ["release_audit"],
		canRunAsSubagent: true,
		readOnly: true,
		canEditProductionCode: false,
		canEditTestCode: false,
		requiresAdvisor: true,
		color: "accent",
	},
	"superpowers:payment-reviewer": {
		tag: "PAY",
		name: "Payment Reviewer",
		description: "审查涉及支付、计费、发票和结账流程的变更",
		color: "warning",
		zhDescription: "Payment Reviewer：审查涉及支付、计费、发票和结账流程的变更",
		menuHintZh: "Payment Reviewer，审查支付和计费相关变更，建议最高质量模型",
		recommendedTier: "xhigh",
		recommendAdvancedModel: true,
		fallbackRoleIds: ["advisor", "slow", "default"],
		capabilities: ["payment_review"],
		canRunAsSubagent: true,
		readOnly: true,
		canEditProductionCode: false,
		canEditTestCode: false,
		requiresAdvisor: true,
	},
	"superpowers:data-migration-reviewer": {
		tag: "DM",
		name: "Data Migration Reviewer",
		description: "审查涉及数据迁移、数据库 schema、SQL 和 ORM 变更",
		color: "success",
		zhDescription: "Data Migration Reviewer：审查涉及数据迁移、数据库 schema、SQL 和 ORM 变更",
		menuHintZh: "Data Migration Reviewer，审查数据迁移和 schema 变更，建议最高质量模型",
		recommendedTier: "xhigh",
		recommendAdvancedModel: true,
		fallbackRoleIds: ["advisor", "slow", "default"],
		capabilities: ["data_migration_review"],
		canRunAsSubagent: true,
		readOnly: true,
		canEditProductionCode: false,
		canEditTestCode: false,
		requiresAdvisor: true,
	},
};

export const MODEL_ROLE_IDS: ModelRole[] = [
	"default",
	"smol",
	"slow",
	"vision",
	"plan",
	"acceptance",
	"designer",
	"commit",
	"title",
	"task",
	"advisor",
	"superpowers:tdd-writer",
	"superpowers:implementer",
	"superpowers:test-runner",
	"superpowers:spec-reviewer",
	"superpowers:quality-reviewer",
	"superpowers:acceptance",
	"superpowers:advisor",
	"superpowers:prompt-engineer",
	"superpowers:impact-reviewer",
	"superpowers:runtime-simulator",
	"superpowers:business-scenario-reviewer",
	"superpowers:frontend-designer",
	"superpowers:security-reviewer",
	"superpowers:release-auditor",
	"superpowers:payment-reviewer",
	"superpowers:data-migration-reviewer",
];

export type RoleInfo = ModelRoleInfo;

/**
 * Return the canonical set of known roles for selector/carousel UI.
 *
 * Built-ins always come first. Configured cycle order, model assignments, and
 * tag metadata can introduce additional custom roles without requiring duplicate
 * entries across settings.
 */
export function getKnownRoleIds(settings: Settings): string[] {
	const roles = MODEL_ROLE_IDS.filter(role => !getRoleInfo(role, settings).hidden) as string[];
	const seen = new Set<string>(roles);
	const addRole = (role: string) => {
		if (seen.has(role)) return;
		if (getRoleInfo(role, settings).hidden) return;
		seen.add(role);
		roles.push(role);
	};

	for (const role of settings.get("cycleOrder")) addRole(role);
	for (const role in settings.getModelRoles()) addRole(role);
	for (const role in settings.get("modelTags")) addRole(role);

	return roles;
}

export function getRoleInfo(role: string, settings: Settings): RoleInfo {
	const builtIn = role in MODEL_ROLES ? MODEL_ROLES[role as ModelRole] : undefined;
	const configured = settings.get("modelTags")[role];

	if (configured) {
		return {
			...builtIn,
			tag: builtIn?.tag,
			name: configured.name ?? builtIn?.name ?? role,
			color: configured.color && isValidThemeColor(configured.color) ? configured.color : builtIn?.color,
			description: configured.description ?? builtIn?.description,
			hidden: configured.hidden ?? builtIn?.hidden,
		};
	}

	if (builtIn) return builtIn;

	return { name: role, color: "muted" };
}
