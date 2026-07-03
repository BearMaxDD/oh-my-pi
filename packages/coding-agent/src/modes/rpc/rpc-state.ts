import type { ToolExample } from "@oh-my-pi/pi-ai";
import type { AgentSession } from "../../session/agent-session";
import type { RpcSessionState } from "./rpc-types";

export type RpcStateSession = Pick<
	AgentSession,
	| "autoCompactionEnabled"
	| "followUpMode"
	| "getContextUsage"
	| "getPlanRunSnapshot"
	| "getTodoPhases"
	| "interruptMode"
	| "isCompacting"
	| "isStreaming"
	| "messages"
	| "model"
	| "queuedMessageCount"
	| "sessionFile"
	| "sessionId"
	| "sessionName"
	| "steeringMode"
	| "systemPrompt"
	| "thinkingLevel"
> & {
	agent: {
		state: {
			tools: Array<{
				name: string;
				description: string;
				parameters: unknown;
				examples?: readonly ToolExample[];
			}>;
		};
	};
};

export function buildRpcSessionState(
	session: RpcStateSession,
	serializeToolParameters: (parameters: unknown) => unknown = parameters => parameters,
): RpcSessionState {
	return {
		model: session.model,
		thinkingLevel: session.thinkingLevel,
		isStreaming: session.isStreaming,
		isCompacting: session.isCompacting,
		steeringMode: session.steeringMode,
		followUpMode: session.followUpMode,
		interruptMode: session.interruptMode,
		sessionFile: session.sessionFile,
		sessionId: session.sessionId,
		sessionName: session.sessionName,
		autoCompactionEnabled: session.autoCompactionEnabled,
		messageCount: session.messages.length,
		queuedMessageCount: session.queuedMessageCount,
		todoPhases: session.getTodoPhases(),
		planRun: session.getPlanRunSnapshot(),
		systemPrompt: session.systemPrompt,
		dumpTools: session.agent.state.tools.map(tool => ({
			name: tool.name,
			description: tool.description,
			parameters: serializeToolParameters(tool.parameters),
			examples: tool.examples,
		})),
		contextUsage: session.getContextUsage(),
	};
}
