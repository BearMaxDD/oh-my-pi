export interface SelfCheckViolation {
	line: number;
	pattern: string;
	message: string;
}

export interface SelfCheckResult {
	passed: boolean;
	checkName: string;
	violations: SelfCheckViolation[];
}

/**
 * Placeholder detection patterns.
 * Uses non-global regexes to avoid stateful `lastIndex` bugs
 * when testing individual lines in a loop.
 */
const PLACEHOLDER_PATTERNS = [
	{ pattern: "TODO", regex: /\bTODO\b/i },
	{ pattern: "TBD", regex: /\bTBD\b/i },
	{ pattern: "FIXME", regex: /\bFIXME\b/i },
	{ pattern: "待补充", regex: /待补充/ },
	{ pattern: "placeholder", regex: /\bplaceholder\b/i },
];

export function checkNoPlaceholders(content: string): SelfCheckResult {
	const violations: SelfCheckViolation[] = [];
	const lines = content.split("\n");

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i]!;
		const lineNumber = i + 1;
		for (const { pattern, regex } of PLACEHOLDER_PATTERNS) {
			if (regex.test(line)) {
				violations.push({
					line: lineNumber,
					pattern,
					message: `Line ${lineNumber}: contains "${pattern}" placeholder`,
				});
			}
		}
	}

	return {
		passed: violations.length === 0,
		checkName: "no-placeholders",
		violations,
	};
}

export function checkTaskNumbering(content: string): SelfCheckResult {
	const violations: SelfCheckViolation[] = [];
	const taskRegex = /^### Task (\d+):/gm;
	const numbers: Array<{ num: number; line: number }> = [];

	let match: RegExpExecArray | null = taskRegex.exec(content);
	while (match !== null) {
		const lineNum = content.substring(0, match.index).split("\n").length;
		numbers.push({ num: parseInt(match[1]!, 10), line: lineNum });
		match = taskRegex.exec(content);
	}

	if (numbers.length > 0) {
		for (let i = 0; i < numbers.length - 1; i++) {
			const current = numbers[i]!;
			const next = numbers[i + 1]!;
			if (next.num !== current.num + 1) {
				violations.push({
					line: next.line,
					pattern: "task-numbering",
					message: `Task number gap: Task ${current.num} → Task ${next.num}, expected Task ${current.num + 1}`,
				});
			}
		}
	}

	return {
		passed: violations.length === 0,
		checkName: "task-numbering",
		violations,
	};
}

export function checkFenceBalance(content: string): SelfCheckResult {
	const fenceRegex = /^( {0,3})```/gm;
	const matches = content.match(fenceRegex);
	const count = matches ? matches.length : 0;
	const balanced = count % 2 === 0;

	return {
		passed: balanced,
		checkName: "fence-balance",
		violations: balanced
			? []
			: [{ line: 0, pattern: "fence-imbalance", message: `Unbalanced fences: ${count} openings (not even)` }],
	};
}

export function checkHeadingPresence(content: string): SelfCheckResult {
	const violations: SelfCheckViolation[] = [];
	const lines = content.split("\n");

	// Check H1 on first non-empty line
	const firstContentLine = lines.find(l => l.trim().length > 0);
	if (!firstContentLine || !/^#\s/.test(firstContentLine!)) {
		violations.push({
			line: 1,
			pattern: "missing-h1",
			message: "Document must start with an H1 heading (# Title)",
		});
	}

	return {
		passed: violations.length === 0,
		checkName: "heading-presence",
		violations,
	};
}

export interface FullSelfCheckResult {
	passed: boolean;
	checks: SelfCheckResult[];
}

export function runAllChecks(content: string): FullSelfCheckResult {
	const checks = [
		checkNoPlaceholders(content),
		checkTaskNumbering(content),
		checkFenceBalance(content),
		checkHeadingPresence(content),
	];

	return {
		passed: checks.every(c => c.passed),
		checks,
	};
}
