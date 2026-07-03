export type ModelAssignmentSource = "modelRoles" | "runtimeOverride" | "selector" | "fallback";
export type ModelAssignmentScope = "session" | "current-run" | "current-task";

export interface ModelAssignment {
	role: "plan" | "task" | "reviewer" | "advisor" | "acceptance" | string;
	model: string;
	displayName: string;
	source: ModelAssignmentSource;
	scope: ModelAssignmentScope;
}

export type ModelVisibilityValue = ModelAssignment | { state: "resolving" | "off" | "unavailable" };

export interface ModelUsageConsumer {
	kind: "main" | "subagent" | "todo" | "advisor" | "acceptance";
	label: string;
	taskId?: string;
	subagentId?: string;
	model?: string;
}

export interface ModelUsageSummary {
	model: string;
	displayName: string;
	consumers: Array<Omit<ModelUsageConsumer, "model">>;
}

export interface ModelUsageSessionLike {
	id: string;
	kind: "main" | "subagent";
	status: "active" | "completed" | "failed" | "aborted";
	agent?: string;
	detached?: boolean;
	modelAssignment?: {
		executionModel?: ModelAssignment;
		advisorModel?: ModelVisibilityValue;
	};
	progress?: {
		modelRole?: string;
		resolvedModel?: string;
	};
}

export interface ModelUsageSummaryLineRenderer {
	refresh(): string | undefined;
}

export interface MainModelUiRefreshCoordinator {
	refresh(): void;
}

export interface AdvisorModelUiRefreshCoordinator {
	refresh(): void;
}

export function formatModelDisplayName(model: string): string {
	const withoutThinking = model.split(":")[0] ?? model;
	const withoutRoute = withoutThinking.split("@")[0] ?? withoutThinking;
	const slash = withoutRoute.lastIndexOf("/");
	return slash >= 0 ? withoutRoute.slice(slash + 1) : withoutRoute;
}

export function createModelAssignment(input: {
	role: ModelAssignment["role"];
	model: string;
	source?: ModelAssignmentSource;
	scope?: ModelAssignmentScope;
}): ModelAssignment {
	return {
		role: input.role,
		model: input.model,
		displayName: formatModelDisplayName(input.model),
		source: input.source ?? "modelRoles",
		scope: input.scope ?? "current-run",
	};
}

export function formatModelBadge(role: string, value: ModelVisibilityValue | undefined): string | undefined {
	if (!value) return undefined;
	if ("state" in value) return `${role} ${value.state}`;
	const suffix = value.source === "fallback" ? " fallback" : value.source === "runtimeOverride" ? "*" : "";
	return `${role} ${value.displayName}${suffix}`;
}

export function summarizeModelUsage(consumers: ModelUsageConsumer[]): ModelUsageSummary[] {
	const byModel = new Map<string, ModelUsageSummary>();
	for (const consumer of consumers) {
		if (!consumer.model) continue;
		let entry = byModel.get(consumer.model);
		if (!entry) {
			entry = { model: consumer.model, displayName: formatModelDisplayName(consumer.model), consumers: [] };
			byModel.set(consumer.model, entry);
		}
		const { model: _model, ...rest } = consumer;
		entry.consumers.push(rest);
	}
	return [...byModel.values()];
}

export function formatModelUsageSummaryLine(summary: ModelUsageSummary[]): string | undefined {
	if (summary.length === 0) return undefined;
	const parts = summary.map(entry => `${entry.displayName}: ${entry.consumers.map(c => c.label).join(", ")}`);
	return `Models  ${parts.join(" · ")}`;
}

export function buildModelUsageSummaryLineForSessions(
	mainModel: string | undefined,
	sessions: ModelUsageSessionLike[],
): string | undefined {
	const consumers: ModelUsageConsumer[] = [];
	if (mainModel) consumers.push({ kind: "main", label: "planner", model: mainModel });
	for (const session of sessions) {
		if (session.kind !== "subagent" || session.status !== "active" || session.detached !== true) continue;
		const executionModel = session.modelAssignment?.executionModel?.model ?? session.progress?.resolvedModel;
		if (executionModel) {
			consumers.push({
				kind: "subagent",
				label: `${session.progress?.modelRole ?? session.agent ?? "task"}(${formatModelUsageTaskId(session.id)})`,
				taskId: session.id,
				subagentId: session.id,
				model: executionModel,
			});
		}
		const advisorModel = session.modelAssignment?.advisorModel;
		if (advisorModel && !("state" in advisorModel)) {
			consumers.push({
				kind: "advisor",
				label: `advisor(${formatModelUsageTaskId(session.id)})`,
				taskId: session.id,
				subagentId: session.id,
				model: advisorModel.model,
			});
		}
	}
	return formatModelUsageSummaryLine(summarizeModelUsage(consumers));
}

function formatModelUsageTaskId(id: string): string {
	return id.split(".").filter(Boolean).join(">") || id;
}

export function createModelUsageSummaryLineRenderer(source: {
	getMainModel(): string | undefined;
	getSessions(): ModelUsageSessionLike[];
}): ModelUsageSummaryLineRenderer {
	return {
		refresh: () => buildModelUsageSummaryLineForSessions(source.getMainModel(), source.getSessions()),
	};
}

export function createMainModelUiRefreshCoordinator(callbacks: {
	invalidateStatusLine(): void;
	updateEditorBorderColor(): void;
	refreshModelUsageSummary(): void;
	requestRender(): void;
}): MainModelUiRefreshCoordinator {
	return {
		refresh: () => {
			callbacks.invalidateStatusLine();
			callbacks.updateEditorBorderColor();
			callbacks.refreshModelUsageSummary();
			callbacks.requestRender();
		},
	};
}

export function createAdvisorModelUiRefreshCoordinator(callbacks: {
	invalidateStatusLine(): void;
	syncRunningSubagentBadge(): void;
	refreshModelUsageSummary(): void;
	requestRender(): void;
}): AdvisorModelUiRefreshCoordinator {
	return {
		refresh: () => {
			callbacks.invalidateStatusLine();
			callbacks.syncRunningSubagentBadge();
			callbacks.refreshModelUsageSummary();
			callbacks.requestRender();
		},
	};
}
