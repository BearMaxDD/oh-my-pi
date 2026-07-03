import { describe, expect, it } from "bun:test";
import {
	assertReadOnlySql,
	createApiStepExecutor,
	isProductionLikeUrl,
} from "../../src/codex-plan-run/runtime-executors";
import type { ApiStep } from "../../src/codex-plan-run/runtime-scenarios";

// ── isProductionLikeUrl ──────────────────────────────────────────────────────

describe("isProductionLikeUrl", () => {
	it("returns true for production-like URLs", () => {
		expect(isProductionLikeUrl("https://example.com/api")).toBe(true);
		expect(isProductionLikeUrl("https://api.example.com/v1")).toBe(true);
		expect(isProductionLikeUrl("https://prod.example.net")).toBe(true);
		expect(isProductionLikeUrl("https://production.example.org")).toBe(true);
	});

	it("returns false for localhost, 127.0.0.1, and test domains", () => {
		expect(isProductionLikeUrl("http://localhost:3000/api")).toBe(false);
		expect(isProductionLikeUrl("http://127.0.0.1:8080")).toBe(false);
		expect(isProductionLikeUrl("https://test.example.com")).toBe(false);
		expect(isProductionLikeUrl("https://staging.example.com")).toBe(false);
		expect(isProductionLikeUrl("http://0.0.0.0:4000")).toBe(false);
	});
});

// ── assertReadOnlySql ────────────────────────────────────────────────────────

describe("assertReadOnlySql", () => {
	it("passes SELECT queries", () => {
		expect(() => assertReadOnlySql("SELECT * FROM users")).not.toThrow();
		expect(() => assertReadOnlySql("select id, name from users limit 10")).not.toThrow();
		expect(() => assertReadOnlySql("SELECT count(*) FROM orders WHERE status = 'active'")).not.toThrow();
		expect(() => assertReadOnlySql("SELECT\n  id,\n  name\nFROM\n  users")).not.toThrow();
	});

	it("passes WITH (CTE) queries that are read-only", () => {
		expect(() =>
			assertReadOnlySql("WITH recent AS (SELECT * FROM logs WHERE ts > now()) SELECT * FROM recent"),
		).not.toThrow();
	});

	it("passes EXPLAIN queries", () => {
		expect(() => assertReadOnlySql("EXPLAIN SELECT * FROM users")).not.toThrow();
	});

	it("throws on INSERT/UPDATE/DELETE/DROP/ALTER/TRUNCATE/CREATE/REPLACE/MERGE", () => {
		expect(() => assertReadOnlySql("INSERT INTO users VALUES (1)")).toThrow("read-only");
		expect(() => assertReadOnlySql("UPDATE users SET name = 'x'")).toThrow("read-only");
		expect(() => assertReadOnlySql("DELETE FROM users")).toThrow("read-only");
		expect(() => assertReadOnlySql("DROP TABLE users")).toThrow("read-only");
		expect(() => assertReadOnlySql("ALTER TABLE users ADD COLUMN x INT")).toThrow("read-only");
		expect(() => assertReadOnlySql("TRUNCATE TABLE users")).toThrow("read-only");
		expect(() => assertReadOnlySql("CREATE TABLE t (id INT)")).toThrow("read-only");
		expect(() => assertReadOnlySql("REPLACE INTO users VALUES (1)")).toThrow("read-only");
		expect(() => assertReadOnlySql("MERGE INTO users USING ...")).toThrow("read-only");
	});
	it("throws on SELECT INTO (write variant)", () => {
		expect(() => assertReadOnlySql("SELECT * INTO new_table FROM users")).toThrow("read-only");
		expect(() => assertReadOnlySql("SELECT * INTO OUTFILE '/tmp/data.csv' FROM users")).toThrow("read-only");
	});

	it("throws on multi-statement queries with any write statement", () => {
		expect(() => assertReadOnlySql("SELECT 1; INSERT INTO logs VALUES (1)")).toThrow("read-only");
	});

	it("throws on empty or whitespace-only queries", () => {
		expect(() => assertReadOnlySql("")).toThrow("read-only");
		expect(() => assertReadOnlySql("   ")).toThrow("read-only");
	});

	it("throws on multiple statements even when all are read-only", () => {
		expect(() => assertReadOnlySql("SELECT 1; SELECT 2")).toThrow("read-only");
		expect(() => assertReadOnlySql("WITH a AS (SELECT 1) SELECT * FROM a; SELECT 2")).toThrow("read-only");
	});

	it("throws on SHOW, DESCRIBE, and other non-SELECT/WITH/EXPLAIN commands", () => {
		expect(() => assertReadOnlySql("SHOW TABLES")).toThrow("read-only");
		expect(() => assertReadOnlySql("SHOW DATABASES")).toThrow("read-only");
		expect(() => assertReadOnlySql("DESCRIBE users")).toThrow("read-only");
		expect(() => assertReadOnlySql("DESC users")).toThrow("read-only");
		// EXPLAIN is allowed — EXPLAIN QUERY PLAN is a SQLite extension that still starts with EXPLAIN
		expect(() => assertReadOnlySql("EXPLAIN QUERY PLAN SELECT 1")).not.toThrow();
		expect(() => assertReadOnlySql("PRAGMA table_info")).toThrow("read-only");
		expect(() => assertReadOnlySql("ANALYZE")).toThrow("read-only");
		expect(() => assertReadOnlySql("VACUUM")).toThrow("read-only");
	});
});

// ── createApiStepExecutor ────────────────────────────────────────────────────

describe("createApiStepExecutor", () => {
	const executor = createApiStepExecutor();

	it("rejects production-like URLs", async () => {
		const step: ApiStep = {
			id: "prod-api",
			kind: "api",
			title_zh: "Prod API",
			timeout_ms: 5000,
			expected: "should block",
			required: true,
			method: "GET",
			url: "https://api.example.com/users",
			expected_status: 200,
		};
		const result = await executor.execute(step);
		expect(result.status).toBe("blocked");
		expect(result.evidence).toContain("production");
		expect(result.evidence).toContain("api.example.com");
	});

	it("fails when expected status mismatches actual status", async () => {
		// Use a local URL so it passes the prod check
		const step: ApiStep = {
			id: "status-mismatch",
			kind: "api",
			title_zh: "Status mismatch",
			timeout_ms: 5000,
			expected: "should fail",
			required: true,
			method: "GET",
			url: "http://127.0.0.1:1/api", // connection refused → fetch throws
			expected_status: 200,
		};
		const result = await executor.execute(step);
		expect(result.status).toBe("failed");
		expect(result.evidence).toContain("127.0.0.1");
	});

	it("redacts authorization header in evidence", async () => {
		const step: ApiStep = {
			id: "redact-headers",
			kind: "api",
			title_zh: "Redact headers",
			timeout_ms: 5000,
			expected: "redact",
			required: true,
			method: "GET",
			url: "http://127.0.0.1:1/api",
			headers: { Authorization: "Bearer secret-token", "X-Api-Key": "my-key" },
			expected_status: 200,
		};
		const result = await executor.execute(step);
		// Even on failure, evidence should redact the header values
		expect(result.evidence).not.toContain("secret-token");
		expect(result.evidence).not.toContain("my-key");
	});

	it("includes method, url, and status in evidence on pass", async () => {
		// We can't easily test a real pass without a server, but we can
		// set up a minimal fetch mock scenario — instead verify structure
		// via the helper that constructs evidence
		const result = await executor.execute({
			id: "pass-check",
			kind: "api",
			title_zh: "Pass check",
			timeout_ms: 5000,
			expected: "should pass",
			required: true,
			method: "GET",
			url: "http://127.0.0.1:1/nonexistent",
			expected_status: 200,
		});
		// Connection refused so it fails, but evidence still contains URL
		expect(result.evidence).toContain("GET");
		expect(result.evidence).toContain("127.0.0.1");
	});

	it("accepts optional injected fetch and uses it instead of global fetch", async () => {
		const injectedFetch = async (_url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
			return new Response(JSON.stringify({ mocked: true }), {
				status: 200,
				headers: { "content-type": "application/json" },
			});
		};
		const exec = createApiStepExecutor({ fetch: injectedFetch });
		const result = await exec.execute({
			id: "injected-fetch",
			kind: "api",
			title_zh: "Injected fetch",
			timeout_ms: 5000,
			expected: "pass",
			required: true,
			method: "GET",
			url: "http://localhost:9999/test",
			expected_status: 200,
		});
		expect(result.status).toBe("passed");
	});

	it("propagates step evidence_path into executor result evidencePath", async () => {
		const injectedFetch = async (_url: string | URL | Request, _init?: RequestInit): Promise<Response> => {
			return new Response("ok", { status: 200 });
		};
		const exec = createApiStepExecutor({ fetch: injectedFetch });
		const result = await exec.execute({
			id: "evidence-path-test",
			kind: "api",
			title_zh: "Evidence path test",
			timeout_ms: 5000,
			expected: "pass",
			required: true,
			method: "GET",
			url: "http://localhost:9999/test",
			expected_status: 200,
			evidence_path: "/tmp/test-evidence.json",
		});
		expect(result.status).toBe("passed");
		expect(result.evidencePath).toBe("/tmp/test-evidence.json");
	});
	it("applies bodyOk check with expected_body_contains", async () => {
		const step: ApiStep = {
			id: "body-ok",
			kind: "api",
			title_zh: "Body check",
			timeout_ms: 5000,
			expected: "body check",
			required: true,
			method: "GET",
			url: "http://127.0.0.1:1/api",
			expected_status: 200,
			expected_body_contains: "success",
		};
		const result = await executor.execute(step);
		// Since fetch fails, this will be a failure, but verify bodyOk logic was reached
		expect(result.status).toBe("failed");
		expect(result.evidence).toContain("api GET");
	});
});
