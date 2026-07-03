import type { ApiStep, BrowserStep, DatabaseStep } from "./runtime-scenarios";

// ── Result types ─────────────────────────────────────────────────────────────

export interface ExecutorResult {
	status: "passed" | "failed" | "blocked";
	evidence: string;
	evidencePath?: string;
}

export interface ApiResult extends ExecutorResult {
	/** Parsed JSON body when available and parseable */
	parsedBody?: unknown;
}

export interface BrowserResult extends ExecutorResult {
	screenshotPath?: string;
}

export interface DatabaseResult extends ExecutorResult {
	rows?: number;
}

// ── Executor interfaces ──────────────────────────────────────────────────────

export interface IApiExecutor {
	execute(step: ApiStep): Promise<ApiResult>;
}

export interface IBrowserExecutor {
	execute(step: BrowserStep): Promise<BrowserResult>;
}

export interface IDatabaseExecutor {
	execute(step: DatabaseStep): Promise<DatabaseResult>;
}

// ── Production-like URL guard ────────────────────────────────────────────────

/**
 * Returns true for URLs that look like a production (non-local/staging/test) host.
 * Used as a safety guard to prevent accidental API calls to production endpoints.
 */
export function isProductionLikeUrl(url: string): boolean {
	try {
		const parsed = new URL(url);
		const hostname = parsed.hostname.toLowerCase();

		// Local and test domains are always safe
		if (
			hostname === "localhost" ||
			hostname === "127.0.0.1" ||
			hostname === "0.0.0.0" ||
			hostname === "::1" ||
			hostname.endsWith(".local") ||
			hostname.endsWith(".test")
		) {
			return false;
		}

		// Subdomains containing "staging", "test", "dev", "qa" are safe
		if (
			hostname.startsWith("staging.") ||
			hostname.startsWith("test.") ||
			hostname.startsWith("dev.") ||
			hostname.startsWith("qa.")
		) {
			return false;
		}

		// Everything else is considered production-like
		return true;
	} catch {
		// Unparseable URL — treat as production to be safe
		return true;
	}
}

// ── Sensitive header redaction ───────────────────────────────────────────────

const SENSITIVE_HEADER_NAMES: Record<string, true> = {
	authorization: true,
	"x-api-key": true,
	"x-auth-token": true,
	"api-key": true,
	cookie: true,
	"set-cookie": true,
	"x-session-id": true,
	"x-csrf-token": true,
	"x-xsrf-token": true,
	token: true,
	secret: true,
};

/**
 * Creates a redacted copy of headers, masking values for known sensitive keys.
 */
function redactHeaders(headers: Record<string, string>): Record<string, string> {
	const redacted: Record<string, string> = {};
	for (const [key, value] of Object.entries(headers)) {
		if (SENSITIVE_HEADER_NAMES[key.toLowerCase()]) {
			redacted[key] = value.length > 0 ? "[REDACTED]" : "";
		} else {
			redacted[key] = value;
		}
	}
	return redacted;
}

// ── SQL read-only guard ──────────────────────────────────────────────────────
const WRITE_STATEMENT_PATTERN =
	/\b(INSERT\s+INTO|UPDATE|DELETE\s+FROM|DROP\s+(TABLE|VIEW|INDEX|DATABASE|SCHEMA)|ALTER\s+(TABLE|VIEW|INDEX|DATABASE|SCHEMA)|TRUNCATE|CREATE\s+(TABLE|VIEW|INDEX|DATABASE|SCHEMA|PROCEDURE|FUNCTION)|REPLACE\s+INTO|MERGE\s+INTO|SELECT\b[^'";]*?\s+INTO)\b/i;
const READ_ONLY_START_PATTERN = /^\s*(SELECT|WITH|EXPLAIN)\b/i;

/**
 * Asserts that a SQL query is read-only (single SELECT, WITH, or EXPLAIN statement).
 * Throws if the query contains write statements, multiple statements, unrecognized commands, or is empty.
 */
export function assertReadOnlySql(query: string): void {
	const trimmed = query.trim();
	if (!trimmed) {
		throw new Error("read-only sql violation: query is empty");
	}

	// Reject multiple statements separated by semicolons
	const statements = trimmed
		.split(/;/)
		.map(s => s.trim())
		.filter(Boolean);
	if (statements.length > 1) {
		throw new Error(`read-only sql violation: multiple statements detected (${statements.length})`);
	}

	// Check for write statements
	if (WRITE_STATEMENT_PATTERN.test(trimmed)) {
		throw new Error(`read-only sql violation: write statement detected: ${trimmed.slice(0, 80)}`);
	}

	// Require recognized read-only command prefix
	if (!READ_ONLY_START_PATTERN.test(trimmed)) {
		throw new Error(
			`read-only sql violation: unrecognized command (only SELECT/WITH/EXPLAIN allowed): ${trimmed.slice(0, 80)}`,
		);
	}
}

// ── Evidence formatting ──────────────────────────────────────────────────────

const MAX_BODY_EXCERPT_LENGTH = 1024;

// ── API step executor ────────────────────────────────────────────────────────

type RuntimeFetch = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

export function createApiStepExecutor(options?: { fetch?: RuntimeFetch }): IApiExecutor {
	const doFetch = options?.fetch ?? fetch;
	return {
		async execute(step: ApiStep): Promise<ApiResult> {
			// Safety: block production-like URLs
			if (isProductionLikeUrl(step.url)) {
				return {
					status: "blocked",
					evidence: `production-like url blocked: ${step.url}. use a localhost, staging, or test domain instead.`,
					evidencePath: step.evidence_path,
				};
			}

			try {
				const headers: Record<string, string> = { ...step.headers };
				const fetchOptions: RequestInit = {
					method: step.method,
					headers,
				};

				if (step.body && (step.method === "POST" || step.method === "PUT" || step.method === "PATCH")) {
					fetchOptions.body = step.body;
				}

				const controller = new AbortController();
				const timeout = setTimeout(() => controller.abort(), step.timeout_ms);
				try {
					const response = await doFetch(step.url, {
						...fetchOptions,
						signal: controller.signal,
					} as RequestInit & { signal: AbortSignal });
					const bodyText = await response.text();

					const statusOk = response.status === step.expected_status;
					const bodyOk = !step.expected_body_contains || bodyText.includes(step.expected_body_contains);
					const passed = statusOk && bodyOk;

					const bodyExcerpt =
						bodyText.length > MAX_BODY_EXCERPT_LENGTH
							? `${bodyText.slice(0, MAX_BODY_EXCERPT_LENGTH)}...`
							: bodyText;

					// Redact sensitive headers for evidence
					const redactedHeaders = redactHeaders(headers);
					const redactedHeadersStr = Object.entries(redactedHeaders)
						.map(([k, v]) => `${k}: ${v}`)
						.join(", ");

					const evidence = `api ${step.method} ${step.url} -> ${response.status}\nbody: ${bodyExcerpt}\nheaders: ${redactedHeadersStr}`;

					return {
						status: passed ? "passed" : "failed",
						evidence,
						evidencePath: step.evidence_path,
					};
				} finally {
					clearTimeout(timeout);
				}
			} catch (err: unknown) {
				const errorMessage = err instanceof Error ? err.message : String(err);
				return {
					status: "failed",
					evidence: `api ${step.method} ${step.url} -> error: ${errorMessage}`,
					evidencePath: step.evidence_path,
				};
			}
		},
	};
}
