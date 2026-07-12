/**
 * ComplianceVerdictTool — bridge tool that wires the compliance extension's
 * verdict sink into the advisor toolset without touching AdvisorRuntime,
 * AdviseTool, or Agent.
 *
 * v16.4.6 has no `registerAdvisorTool()`.  This tool is created directly in
 * #buildAdvisorRuntime when the session carries a compliance verdict sink.
 */

import type { AgentTool, AgentToolResult, AgentToolUpdateCallback, AgentToolContext } from "@oh-my-pi/pi-agent-core";
import { type } from "arktype";

// ---------------------------------------------------------------------------
// Types shared with the compliance extension
// ---------------------------------------------------------------------------

export type ComplianceVerdictAction = "pass" | "remediate";

export interface ComplianceVerdict {
	/** Managed-task identifier (e.g. "code-review-3"). */
	task: string;
	/** Content hash the tool was called with so the sink can verify staleness. */
	hash: string;
	/** The judgment. */
	action: ComplianceVerdictAction;
	/**
	 * When action is "remediate", a description of what must change.
	 * MUST be present for remediate, absent for pass.
	 */
	requiredFix?: string;
}

export interface VerdictResult {
	success: boolean;
	error?: string;
}

/**
 * Callback signature the session uses to forward a parsed verdict.
 * Implemented by the compliance extension's sink.
 */
export type ComplianceVerdictSink = (verdict: ComplianceVerdict) => Promise<VerdictResult>;

// ---------------------------------------------------------------------------
// Schema — arktype, matching the v16.4.6 convention
// ---------------------------------------------------------------------------

const complianceVerdictSchema = type({
	task: "string > 0",
	hash: "string > 0",
	action: "'pass' | 'remediate'",
	"requiredFix?": "string > 0",
}).narrow((v, ctx) => {
	if (v.action === "remediate" && !v.requiredFix) {
		return ctx.mustBe("requiredFix is required when action is 'remediate'");
	}
	if (v.action === "pass" && v.requiredFix !== undefined) {
		return ctx.mustBe("requiredFix must be absent when action is 'pass'");
	}
	return true;
});

// ---------------------------------------------------------------------------
// Tool implementation
// ---------------------------------------------------------------------------

export class ComplianceVerdictTool implements AgentTool<typeof complianceVerdictSchema> {
	readonly name = "compliance_verdict";
	readonly label = "Compliance Verdict";
	readonly description =
		"Submit a compliance verdict for a managed task. " +
		"Use 'pass' when the task is satisfied, or 'remediate' with a requiredFix " +
		"describing what must change for re-verification.";
	readonly parameters = complianceVerdictSchema;
	readonly intent = "omit" as const;

	constructor(private readonly sink: ComplianceVerdictSink) {}

	async execute(
		_toolCallId: string,
		params: unknown,
		_signal?: AbortSignal,
		_onUpdate?: AgentToolUpdateCallback,
		_context?: AgentToolContext,
	): Promise<AgentToolResult> {
		// Validate against schema — arktype does NOT auto-validate at the type level
		const parsed = complianceVerdictSchema(params);
		if (parsed instanceof type.errors) {
			throw new Error(`compliance_verdict: ${parsed.summary}`);
		}
		const validArgs = parsed;

		const verdict: ComplianceVerdict = {
			task: validArgs.task,
			hash: validArgs.hash,
			action: validArgs.action,
			requiredFix: validArgs.requiredFix,
		};

		const result = await this.sink(verdict);

		if (!result.success) {
			return {
				content: [{ type: "text", text: result.error ?? "Verdict rejected." }],
				isError: true,
			};
		}

		return {
			content: [{ type: "text", text: `Verdict recorded: ${validArgs.action} for task "${validArgs.task}".` }],
		};
	}
}
