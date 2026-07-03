export type AdvisorSeverity = "nit" | "concern" | "blocker";
export type AdvisorItemStatus = "open" | "resolved" | "suppressed";

export interface AdvisorSummaryItem {
	severity: AdvisorSeverity;
	status: AdvisorItemStatus;
	message: string;
	turn_id: number;
}

export interface AdvisorSummary {
	items: AdvisorSummaryItem[];
}

export function createAdvisorSummary(items: AdvisorSummaryItem[]): AdvisorSummary {
	return { items };
}

export function collectUnresolvedAdvisorBlockers(summary: AdvisorSummary): AdvisorSummaryItem[] {
	return summary.items.filter(item => item.severity === "blocker" && item.status === "open");
}
