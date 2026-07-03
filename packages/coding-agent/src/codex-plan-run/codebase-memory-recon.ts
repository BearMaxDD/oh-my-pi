import { mkdir, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve } from "node:path";
import type { PlanExecutionBookTaskInput, ProjectRecon } from "./execution-book";

export interface CodebaseMemoryProjectStatus {
	indexed: boolean;
	project: string;
	rootPath: string;
	nodeCount?: number;
	edgeCount?: number;
	stale?: boolean;
}

export interface CodebaseMemoryArchitectureContext {
	relevantModules?: string[];
	existingPatterns?: string[];
	riskAreas?: string[];
	summary?: string;
}

export interface CodebaseMemorySymbolHit {
	name: string;
	qualifiedName?: string;
	file?: string;
}

export interface CodebaseMemoryGraphNode {
	id?: string;
	label: string;
	name: string;
	qualified_name?: string;
	file_path?: string;
	start_line?: number;
	end_line?: number;
	is_test?: boolean;
}

export interface CodebaseMemoryGraphEdge {
	type: string;
	source: string;
	target: string;
	confidence?: number;
	via?: string;
	url_path?: string;
}

export interface CodebaseMemoryTracePath {
	mode?: "calls" | "data_flow" | "cross_service";
	direction?: "inbound" | "outbound" | "both";
	start: string;
	end?: string;
	edge_types?: string[];
	risk?: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
}

export interface CodebaseMemoryGraphSlice {
	seed_files: string[];
	seed_symbols: string[];
	nodes: CodebaseMemoryGraphNode[];
	edges: CodebaseMemoryGraphEdge[];
	trace_paths: CodebaseMemoryTracePath[];
	edge_types: string[];
	risk_nodes: string[];
}

export interface CodebaseMemoryTaskContextInput {
	taskId: string;
	files: string[];
	symbols: CodebaseMemorySymbolHit[];
	patterns: string[];
	risks: string[];
	graph?: Partial<CodebaseMemoryGraphSlice>;
}

export interface CodebaseMemoryTaskContext extends CodebaseMemoryTaskContextInput {
	graph: CodebaseMemoryGraphSlice;
}

export interface CodebaseMemoryReconProvider {
	getProjectStatus(input: { repoPath: string }): Promise<CodebaseMemoryProjectStatus>;
	getArchitecture(input: { project: string; repoPath: string }): Promise<CodebaseMemoryArchitectureContext>;
	searchTaskContext(input: {
		project: string;
		repoPath: string;
		task: PlanExecutionBookTaskInput;
	}): Promise<CodebaseMemoryTaskContextInput>;
}

export interface CodebaseMemoryReconOptions {
	enabled?: boolean;
	provider?: CodebaseMemoryReconProvider;
}

export interface CodebaseMemoryExecutionRecon {
	kind: "execution";
	project: string;
	repo_path: string;
	generated_at: string;
	evidencePath: string;
	markdownPath: string;
	project_status: CodebaseMemoryProjectStatus;
	architecture: CodebaseMemoryArchitectureContext;
	task_contexts: CodebaseMemoryTaskContext[];
}

function unique(values: readonly string[]): string[] {
	return [...new Set(values.map(value => value.trim()).filter(Boolean))];
}

function normalizeFile(repoPath: string, file: string): string {
	const resolved = resolve(repoPath, file);
	const rel = relative(repoPath, resolved);
	return rel && !rel.startsWith("..") ? rel : file;
}

function graphNodeKey(node: CodebaseMemoryGraphNode, index: number): string {
	if (node.id) {
		return node.id;
	}
	if (node.qualified_name) {
		return node.qualified_name;
	}
	if (node.label === "File" && node.file_path) {
		return `File:${node.file_path}`;
	}
	return `${node.label}:${node.name}:${node.file_path ?? ""}:${node.start_line ?? ""}:${node.end_line ?? ""}:${index}`;
}

function uniqueGraphNodes(nodes: readonly CodebaseMemoryGraphNode[]): CodebaseMemoryGraphNode[] {
	const seen = new Set<string>();
	const result: CodebaseMemoryGraphNode[] = [];
	for (const [index, node] of nodes.entries()) {
		const key = graphNodeKey(node, index);
		if (seen.has(key)) {
			continue;
		}
		seen.add(key);
		result.push(node);
	}
	return result;
}

function normalizeGraphNode(repoPath: string, node: CodebaseMemoryGraphNode): CodebaseMemoryGraphNode {
	return {
		...node,
		file_path: node.file_path ? normalizeFile(repoPath, node.file_path) : undefined,
	};
}

function createLegacyGraphSlice(repoPath: string, context: CodebaseMemoryTaskContextInput): CodebaseMemoryGraphSlice {
	const files = unique(context.files.map(file => normalizeFile(repoPath, file)));
	const seedSymbols = unique(context.symbols.map(symbol => symbol.qualifiedName ?? symbol.name));
	const symbolNodes = context.symbols.map((symbol, index) => ({
		id: symbol.qualifiedName ?? `symbol:${index}:${symbol.name}`,
		label: "Symbol",
		name: symbol.name,
		qualified_name: symbol.qualifiedName,
		file_path: symbol.file ? normalizeFile(repoPath, symbol.file) : undefined,
	}));
	const fileNodes = files.map(file => ({
		id: `file:${file}`,
		label: "File",
		name: file,
		file_path: file,
	}));
	return {
		seed_files: files,
		seed_symbols: seedSymbols,
		nodes: uniqueGraphNodes([...symbolNodes, ...fileNodes]),
		edges: [],
		trace_paths: [],
		edge_types: [],
		risk_nodes: [],
	};
}

function normalizeGraphSlice(repoPath: string, context: CodebaseMemoryTaskContextInput): CodebaseMemoryGraphSlice {
	const fallback = createLegacyGraphSlice(repoPath, context);
	const graph = context.graph;
	const edges = graph?.edges ?? fallback.edges;
	const tracePaths = graph?.trace_paths ?? fallback.trace_paths;
	return {
		seed_files: unique((graph?.seed_files ?? fallback.seed_files).map(file => normalizeFile(repoPath, file))),
		seed_symbols: unique(graph?.seed_symbols ?? fallback.seed_symbols),
		nodes: uniqueGraphNodes((graph?.nodes ?? fallback.nodes).map(node => normalizeGraphNode(repoPath, node))),
		edges,
		trace_paths: tracePaths,
		edge_types: unique([
			...(graph?.edge_types ?? []),
			...edges.map(edge => edge.type),
			...tracePaths.flatMap(trace => trace.edge_types ?? []),
		]),
		risk_nodes: unique(graph?.risk_nodes ?? fallback.risk_nodes),
	};
}

function validateProjectStatus(repoPath: string, status: CodebaseMemoryProjectStatus): void {
	if (!status.indexed) {
		throw new Error(`Codebase Memory index is missing for repo_path: ${repoPath}`);
	}
	if (resolve(status.rootPath) !== resolve(repoPath)) {
		throw new Error(`Codebase Memory project root must match repo_path: ${status.rootPath} !== ${repoPath}`);
	}
	if (status.stale) {
		throw new Error(`Codebase Memory index is stale for repo_path: ${repoPath}`);
	}
}

async function writeEvidence(path: string, content: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await writeFile(path, content, "utf8");
}

function renderExecutionReconMarkdown(recon: CodebaseMemoryExecutionRecon): string {
	const lines = [
		"# Codebase Memory Recon",
		"",
		`- kind: ${recon.kind}`,
		`- project: ${recon.project}`,
		`- repo_path: ${recon.repo_path}`,
		`- generated_at: ${recon.generated_at}`,
		`- nodes: ${recon.project_status.nodeCount ?? "-"}`,
		`- edges: ${recon.project_status.edgeCount ?? "-"}`,
		"",
		"## Architecture",
		"",
		`- modules: ${(recon.architecture.relevantModules ?? []).join(", ")}`,
		`- patterns: ${(recon.architecture.existingPatterns ?? []).join("; ")}`,
		`- risks: ${(recon.architecture.riskAreas ?? []).join("; ")}`,
		"",
		"## Task Context",
		"",
	];
	for (const task of recon.task_contexts) {
		lines.push(`### ${task.taskId}`, "");
		lines.push(`- files: ${task.files.join(", ")}`);
		lines.push(`- patterns: ${task.patterns.join("; ")}`);
		lines.push(`- risks: ${task.risks.join("; ")}`);
		for (const symbol of task.symbols) {
			lines.push(`- symbol: ${symbol.name}${symbol.qualifiedName ? ` (${symbol.qualifiedName})` : ""}`);
		}
		lines.push("", "## Graph Slice", "");
		lines.push(`- seeds.files: ${task.graph.seed_files.join(", ")}`);
		lines.push(`- seeds.symbols: ${task.graph.seed_symbols.join(", ")}`);
		lines.push(`- nodes: ${task.graph.nodes.length}`);
		lines.push(`- edges: ${task.graph.edges.length}`);
		lines.push(`- edge_types: ${task.graph.edge_types.join(", ")}`);
		for (const node of task.graph.nodes) {
			const id = node.id ? `${node.id} ` : "";
			lines.push(`- node: ${id}${node.label} ${node.qualified_name ?? node.name}`);
		}
		for (const edge of task.graph.edges) {
			lines.push(`- edge: ${edge.type}: ${edge.source} -> ${edge.target}`);
		}
		lines.push("");
	}
	return `${lines.join("\n").trimEnd()}\n`;
}

export async function runCodebaseMemoryExecutionRecon(input: {
	repoPath: string;
	acceptingDir: string;
	tasks: readonly PlanExecutionBookTaskInput[];
	provider: CodebaseMemoryReconProvider;
	now?: Date;
}): Promise<CodebaseMemoryExecutionRecon> {
	const repoPath = resolve(input.repoPath);
	const status = await input.provider.getProjectStatus({ repoPath });
	validateProjectStatus(repoPath, status);
	const architecture = await input.provider.getArchitecture({ project: status.project, repoPath });
	const taskContexts = await Promise.all(
		input.tasks.map(async task => {
			const context = await input.provider.searchTaskContext({ project: status.project, repoPath, task });
			const files = unique(context.files.map(file => normalizeFile(repoPath, file)));
			return {
				...context,
				taskId: task.id,
				files,
				symbols: context.symbols.map(symbol => ({
					...symbol,
					file: symbol.file ? normalizeFile(repoPath, symbol.file) : undefined,
				})),
				patterns: unique(context.patterns),
				risks: unique(context.risks),
				graph: normalizeGraphSlice(repoPath, { ...context, files }),
			};
		}),
	);
	const evidencePath = join(input.acceptingDir, "codebase-memory-recon.json");
	const markdownPath = join(input.acceptingDir, "codebase-memory-recon.md");
	const recon: CodebaseMemoryExecutionRecon = {
		kind: "execution",
		project: status.project,
		repo_path: repoPath,
		generated_at: (input.now ?? new Date()).toISOString(),
		evidencePath,
		markdownPath,
		project_status: status,
		architecture,
		task_contexts: taskContexts,
	};
	await writeEvidence(evidencePath, `${JSON.stringify(recon, null, 2)}\n`);
	await writeEvidence(markdownPath, renderExecutionReconMarkdown(recon));
	return recon;
}

export function mergeCodebaseMemoryProjectRecon(base: ProjectRecon, recon: CodebaseMemoryExecutionRecon): ProjectRecon {
	const filesForContext = (context: CodebaseMemoryTaskContext): string[] =>
		unique([
			...context.files,
			...context.graph.seed_files,
			...context.graph.nodes.flatMap(node => (node.file_path ? [node.file_path] : [])),
		]);
	const codebaseFiles = unique(recon.task_contexts.flatMap(context => filesForContext(context)));
	const taskFileMap = { ...base.task_file_map };
	for (const context of recon.task_contexts) {
		taskFileMap[context.taskId] = unique([...(taskFileMap[context.taskId] ?? []), ...filesForContext(context)]);
	}
	return {
		...base,
		relevant_modules: unique([
			...base.relevant_modules,
			...(recon.architecture.relevantModules ?? []),
			...codebaseFiles.map(file => file.split(/[\\/]/)[0] ?? file),
		]),
		likely_files: unique([...base.likely_files, ...codebaseFiles]),
		existing_patterns: unique([
			...base.existing_patterns,
			...(recon.architecture.existingPatterns ?? []),
			...recon.task_contexts.flatMap(context => context.patterns),
			...recon.task_contexts.map(
				context =>
					`Codebase Memory graph slice ${context.taskId}: ${context.graph.nodes.length} nodes, ${context.graph.edges.length} edges`,
			),
			`Codebase Memory execution recon evidence: ${recon.evidencePath}`,
		]),
		risk_areas: unique([
			...base.risk_areas,
			...(recon.architecture.riskAreas ?? []),
			...recon.task_contexts.flatMap(context => context.risks),
		]),
		task_file_map: taskFileMap,
	};
}
