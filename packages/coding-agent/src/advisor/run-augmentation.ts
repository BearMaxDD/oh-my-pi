export interface AdvisorRunAugmentation {
	readonly additionalSystemContext?: readonly string[];
	readonly additionalTools?: readonly { name: string }[];
}

export async function withAdvisorRunAugmentation<T>(
	state: { systemPrompt: string[]; tools: { name: string }[] },
	augmentation: AdvisorRunAugmentation | undefined,
	run: () => Promise<T>,
): Promise<T> {
	if (!augmentation) return run();
	const context = Object.freeze([...(augmentation.additionalSystemContext ?? [])]);
	const tools = Object.freeze([...(augmentation.additionalTools ?? [])]);
	const names = new Set(state.tools.map(t => t.name));
	for (const tool of tools) {
		if (names.has(tool.name)) throw new Error(`duplicate advisor tool "${tool.name}"`);
		names.add(tool.name);
	}
	const originalPrompt = state.systemPrompt;
	const originalTools = state.tools;
	state.systemPrompt = [...originalPrompt, ...context];
	state.tools = [...originalTools, ...tools];
	try {
		return await run();
	} finally {
		state.systemPrompt = originalPrompt;
		state.tools = originalTools;
	}
}
