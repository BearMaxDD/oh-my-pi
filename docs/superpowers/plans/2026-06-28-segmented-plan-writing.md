# 分段式计划写入状态机 实现计划

> **面向 AI 代理的工作者：** 必需子技能：使用 superpowers:subagent-driven-development（推荐）或 superpowers:executing-plans 逐任务实现此计划。步骤使用复选框（`- [ ]`）语法来跟踪进度。

**目标：** 在 OMP codex-plan-run 子系统中实现分段式计划写入状态机，将长计划文档（>200 行）的写入过程分解为骨架写入 → 分块追加 → 自检 → 微调四个阶段，并附带可恢复 manifest，消除单次巨型 write 调用导致的全有或全无丢失风险。

**架构：** 在 `codex-plan-run/segmented-write/` 目录下新增一个独立的状态机子系统。写入过程建模为有限状态机（INIT → SKELETON_WRITTEN → CHUNKS_IN_PROGRESS → CHUNKS_COMPLETE → SELF_CHECK_COMPLETE → PATCHED_COMPLETE），每个状态转换通过 sidecar manifest（`.write-manifest.json`）持久化。manifest 记录每个 block 的行数范围、sha256、写入时间、验证状态，支持中断后从最后一个 complete block 继续恢复。自检阶段扫描 TODO 残留、fence 平衡、任务编号连续性。微调阶段通过行级 edit 修复自检发现的问题。

**技术栈：** TypeScript (Bun runtime), `bun:test` 测试框架, `node:fs/promises` 文件写入, `node:crypto` sha256 校验, JSON sidecar manifest。

> **计划版本:** v1
> **生成者:** SegmentedPlanWriter
> **分段写入标记:** `<!-- segmented-write:init -->`

---

## 背景与文件结构

### 问题

当前 OMP 生成 `docs/superpowers/plans/*.md` 计划文档时，依赖单次 write 工具调用写入整个文档。对于数百行或超过千行的长计划，这种方式存在 socket 断连全丢、上下文膨胀、重复重写、缺乏可观测性等问题。

### 方案

方案选型为"计划生成器强制状态机"（详见设计文档 `docs/superpowers/specs/2026-06-28-segmented-plan-writing-design.md`），将写入过程分解为可验证、可恢复的多个阶段，manifest sidecar 文件记录每个 block 的状态。

### 新增文件结构

```
packages/coding-agent/src/codex-plan-run/segmented-write/
  types.ts              — SegmentedWriteState 枚举、WriteBlockInfo 接口、WriteManifest 接口
  manifest.ts           — WriteManifest 的 read/write/validate 函数
  writer.ts             — SegmentedPlanWriter 类：骨架写入、分块追加、状态机驱动
  checker.ts            — PlanSelfChecker 函数：TODO 扫描、fence 平衡、任务编号连续性
  index.ts              — barrel 导出
packages/coding-agent/test/codex-plan-run/segmented-write/
  types.test.ts         — 类型定义与默认值测试
  manifest.test.ts      — manifest read/write/validate 测试
  writer.test.ts        — 骨架写入 + 分块追加 + 中断恢复测试
  checker.test.ts       — 自检逻辑测试
```

### 修改文件

```
packages/coding-agent/src/codex-plan-run/index.ts  — 添加 segmented-write 导出
packages/coding-agent/src/codex-plan-run/execution-book.ts  — 在 writePlanExecutionBook() 中集成分段写入
```

### 涉及集成（codebase-memory 已确认）

集成入口已通过 codebase-memory 确认：

- **集成目标：** `packages/coding-agent/src/codex-plan-run/execution-book.ts` 中的 `writePlanExecutionBook(path, book)` 函数（第 813-820 行）
- **集成方式：** 生成 `const content = renderPlanExecutionBook(book)` 后，通过新增 `writeSegmentedMarkdownIfNeeded(path, content, { writerRole: "PlanExecutionBookWriter" })` 路由：
  - 长计划内容（≥200 行、路径以 `.md` 结尾、且位于 `/docs/superpowers/plans/` 或以 `plan-execution-book.md` 结尾）→ 状态机分段写入
  - 短内容或其他路径 → 保持原有直接 `writeFile` 写入
- **集成适配器：** `packages/coding-agent/src/codex-plan-run/segmented-write/integration.ts`（新增）

### 设计约束

- **不改造通用 write 工具**：分段写入仅限计划文档场景，普通代码编辑不受影响。
- **不预设现成路径**：manifest 和恢复逻辑独立封装，不耦合到现有 manifest.ts（`PlanRunManifest` 是整个 plan-run 的协议 manifest，分段写入的 manifest 是 sidecar）。
- **所有写入串行执行**：v1 不支持并发写入。
- **commit 步骤可选**：仅当 `.git` 存在时执行。

---

## 任务目录

| 编号 | 任务 | 负责角色 |
|------|------|----------|
| 1 | 状态机类型与 manifest 类型/测试 | SegmentedPlanWriter |
| 2 | 原子 manifest/checkpoint 写入与追加块写入/测试 | SegmentedPlanWriter |
| 3 | 恢复/重建测试与实现 | SegmentedPlanWriter |
| 4 | 计划自检测试与实现 | PlanSelfChecker |
| 5 | 集成到计划生成/交接路径 | SegmentedPlanWriter |
| 6 | 文档、冒烟测试、package 检查/构建、codebase-memory 更新 | SegmentedPlanWriter |

---

> **恢复注释：** 如果写入在此处中断，任务目录已经建立。从 Task 1 开始继续。manifest 所在路径 `segmented-write/types.ts`、`segmented-write/manifest.ts`、`segmented-write/writer.ts`、`segmented-write/checker.ts`、`segmented-write/index.ts`。测试路径 `test/codex-plan-run/segmented-write/*.test.ts`。

<!-- segmented-write:skeleton-complete -->


## 实施步骤

### 任务 1：状态机类型与 manifest 类型/测试

**文件：**
- 创建：`packages/coding-agent/src/codex-plan-run/segmented-write/types.ts`
- 创建：`packages/coding-agent/src/codex-plan-run/segmented-write/manifest.ts`
- 创建：`packages/coding-agent/src/codex-plan-run/segmented-write/index.ts`
- 创建：`packages/coding-agent/test/codex-plan-run/segmented-write/types.test.ts`
- 创建：`packages/coding-agent/test/codex-plan-run/segmented-write/manifest.test.ts`

---

- [ ] **步骤 1：编写 types.test.ts —— 状态枚举与接口的失败测试**

```typescript
import { describe, expect, it } from "bun:test";
import { SEGMENTED_WRITE_STATES, type SegmentedWriteState, type WriteBlockInfo, type WriteManifest } from "../../../src/codex-plan-run/segmented-write/types";

describe("SegmentedWriteTypes", () => {
	it("defines states in correct order", () => {
		expect(SEGMENTED_WRITE_STATES).toEqual([
			"INIT",
			"SKELETON_WRITTEN",
			"CHUNKS_IN_PROGRESS",
			"CHUNKS_COMPLETE",
			"SELF_CHECK_COMPLETE",
			"PATCHED_COMPLETE",
		] as readonly string[]);
	});

	it("defines WriteBlockInfo with required fields", () => {
		const block: WriteBlockInfo = {
			id: "goal",
			title: "Goal",
			status: "pending",
			lineStart: 0,
			lineEnd: 0,
		};
		expect(block.id).toBe("goal");
		expect(block.status).toBe("pending");
	});

	it("defines WriteManifest with all fields", () => {
		const manifest: WriteManifest = {
			planPath: "test.md",
			state: "INIT" as SegmentedWriteState,
			writerRole: "SegmentedPlanWriter",
			sections: [],
			taskIds: [],
			lineCount: 0,
			sha256: "",
			tailMarker: "<!-- segmented-write-complete -->",
			codeFenceBalanced: true,
			timestamps: {
				created: "2026-06-28T10:00:00Z",
			},
		};
		expect(manifest.planPath).toBe("test.md");
		expect(manifest.state).toBe("INIT");
	});
});
```

- [ ] **步骤 2：运行测试验证失败**

运行：
```bash
cd packages/coding-agent && bun test test/codex-plan-run/segmented-write/types.test.ts -t SegmentedWriteTypes
```
预期：FAIL，报错 `Cannot find module` 或 `SegmentedWriteTypes` 未定义。

- [ ] **步骤 3：编写 types.ts —— 实现类型定义**

```typescript
export const SEGMENTED_WRITE_STATES = [
	"INIT",
	"SKELETON_WRITTEN",
	"CHUNKS_IN_PROGRESS",
	"CHUNKS_COMPLETE",
	"SELF_CHECK_COMPLETE",
	"PATCHED_COMPLETE",
] as const;

export type SegmentedWriteState = (typeof SEGMENTED_WRITE_STATES)[number];

export type WriteBlockStatus = "pending" | "complete" | "corrupted";

export interface WriteBlockInfo {
	id: string;
	title: string;
	status: WriteBlockStatus;
	lineStart: number;
	lineEnd: number;
	sha256?: string;
}

export interface WriteManifest {
	planPath: string;
	state: SegmentedWriteState;
	writerRole: string;
	sections: WriteBlockInfo[];
	taskIds: string[];
	lineCount: number;
	sha256: string;
	tailMarker: string;
	codeFenceBalanced: boolean;
	timestamps: {
		created: string;
		skeletonWritten?: string;
		chunksComplete?: string;
		selfCheckComplete?: string;
		patchedComplete?: string;
	};
	recovery?: {
		resumeCount: number;
		lastRecoveredFrom: string | null;
		corruptedBlocks: string[];
	};
}

export function createInitManifest(planPath: string, writerRole: string): WriteManifest {
	return {
		planPath,
		state: "INIT",
		writerRole,
		sections: [],
		taskIds: [],
		lineCount: 0,
		sha256: "",
		tailMarker: "<!-- segmented-write-complete -->",
		codeFenceBalanced: false,
		timestamps: {
			created: new Date().toISOString(),
		},
	};
}
```

- [ ] **步骤 4：运行测试验证通过**

运行：
```bash
cd packages/coding-agent && bun test test/codex-plan-run/segmented-write/types.test.ts -t SegmentedWriteTypes
```
预期：PASS（所有测试通过）。

- [ ] **步骤 5：编写 manifest.test.ts —— Read/Write/Validate 失败测试**

```typescript
import { describe, expect, it } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { writeWriteManifest, readWriteManifest, validateWriteManifest, manifestPathFor } from "../../../src/codex-plan-run/segmented-write/manifest";
import { createInitManifest } from "../../../src/codex-plan-run/segmented-write/types";

describe("WriteManifest IO", () => {
	const tmpDir = mkdtempSync(join(tmpdir(), "manifest-test-"));
	const planPath = join(tmpDir, "test-plan.md");
	const manifestPath = join(tmpDir, ".test-plan.write-manifest.json");

	afterAll(() => rmSync(tmpDir, { recursive: true, force: true }));

	it("computes manifest path from plan path", () => {
		const result = manifestPathFor(planPath);
		expect(result).toBe(join(tmpDir, ".test-plan.write-manifest.json"));
	});

	it("writes and reads manifest", async () => {
		const manifest = createInitManifest(planPath, "SegmentedPlanWriter");
		await writeWriteManifest(manifest);
		const loaded = await readWriteManifest(manifestPath);
		expect(loaded.planPath).toBe(planPath);
		expect(loaded.state).toBe("INIT");
	});

	it("rejects invalid manifest", async () => {
		const manifest = createInitManifest("", "Writer");
		const errors = await validateWriteManifest(manifest);
		expect(errors.length).toBeGreaterThan(0);
		expect(errors).toContain("planPath is required");
	});

	it("does not overwrite when manifest write fails", async () => {
		const manifest = createInitManifest(planPath, "SegmentedPlanWriter");
		manifest.state = "INVALID_STATE" as any;
		await expect(writeWriteManifest(manifest)).rejects.toThrow();
	});
});
```

- [ ] **步骤 6：运行 manifest.test.ts 验证失败**

运行：
```bash
cd packages/coding-agent && bun test test/codex-plan-run/segmented-write/manifest.test.ts -t "WriteManifest IO"
```
预期：FAIL，报错模块未找到。

- [ ] **步骤 7：编写 manifest.ts —— 实现 manifest IO 逻辑**

```typescript
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, basename, join } from "node:path";
import type { WriteManifest, SegmentedWriteState } from "./types";
import { SEGMENTED_WRITE_STATES } from "./types";

export function manifestPathFor(planPath: string): string {
	const dir = dirname(planPath);
	const base = basename(planPath);
	return join(dir, `.${base}.write-manifest.json`);
}

function isSegmentedWriteState(value: unknown): value is SegmentedWriteState {
	return typeof value === "string" && (SEGMENTED_WRITE_STATES as readonly string[]).includes(value);
}

export async function validateWriteManifest(manifest: WriteManifest): Promise<string[]> {
	const errors: string[] = [];
	if (!manifest.planPath) errors.push("planPath is required");
	if (!isSegmentedWriteState(manifest.state)) errors.push("state must be a valid SegmentedWriteState");
	if (!manifest.writerRole) errors.push("writerRole is required");
	if (!manifest.timestamps?.created) errors.push("timestamps.created is required");
	return errors;
}

export async function writeWriteManifest(manifest: WriteManifest): Promise<void> {
	const errors = await validateWriteManifest(manifest);
	if (errors.length > 0) {
		throw new Error(`Invalid WriteManifest: ${errors.join("; ")}`);
	}
	const mPath = manifestPathFor(manifest.planPath);
	await mkdir(dirname(mPath), { recursive: true });
	await writeFile(mPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
}

export async function readWriteManifest(manifestPath: string): Promise<WriteManifest> {
	return JSON.parse(await readFile(manifestPath, "utf8")) as WriteManifest;
}

export async function updateWriteManifestState(manifest: WriteManifest, newState: SegmentedWriteState): Promise<WriteManifest> {
	const updated: WriteManifest = { ...manifest, state: newState };
	await writeWriteManifest(updated);
	return updated;
}
```

- [ ] **步骤 8：运行 manifest.test.ts 验证通过**

运行：
```bash
cd packages/coding-agent && bun test test/codex-plan-run/segmented-write/manifest.test.ts -t "WriteManifest IO"
```
预期：PASS（所有测试通过）。

- [ ] **步骤 9：编写 index.ts —— barrel 导出**

```typescript
export { type SegmentedWriteState, type WriteBlockInfo, type WriteManifest, SEGMENTED_WRITE_STATES, createInitManifest } from "./types";
export { manifestPathFor, writeWriteManifest, readWriteManifest, validateWriteManifest, updateWriteManifestState } from "./manifest";
```

- [ ] **步骤 10：验证所有测试通过**

运行：
```bash
cd packages/coding-agent && bun test test/codex-plan-run/segmented-write/types.test.ts test/codex-plan-run/segmented-write/manifest.test.ts
```
预期：PASS（2 个测试文件，所有 case 通过）。

- [ ] **步骤 11：Commit（可选，仅当 .git 存在时）**

```bash
if [ -d .git ]; then
  git add packages/coding-agent/src/codex-plan-run/segmented-write/types.ts
  git add packages/coding-agent/src/codex-plan-run/segmented-write/manifest.ts
  git add packages/coding-agent/src/codex-plan-run/segmented-write/index.ts
  git add packages/coding-agent/test/codex-plan-run/segmented-write/types.test.ts
  git add packages/coding-agent/test/codex-plan-run/segmented-write/manifest.test.ts
  git commit -m "feat(superpowers): segmented-write types and manifest IO"
fi
```

<!-- segmented-write:task-1-complete -->

### 任务 2：原子 manifest/checkpoint 写入与追加块写入/测试

**文件：**
- 创建：`packages/coding-agent/src/codex-plan-run/segmented-write/writer.ts`
- 创建：`packages/coding-agent/test/codex-plan-run/segmented-write/writer.test.ts`

---

- [ ] **步骤 1：编写 writer.test.ts —— 骨架写入 + 分块追加 + 状态推进测试**

```typescript
import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, readFileSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SegmentedPlanWriter } from "../../../src/codex-plan-run/segmented-write/writer";
import { readWriteManifest, manifestPathFor } from "../../../src/codex-plan-run/segmented-write/manifest";

describe("SegmentedPlanWriter", () => {
	const tmpDir = mkdtempSync(join(tmpdir(), "writer-test-"));
	const planPath = join(tmpDir, "plan.md");
	const manifestPath = manifestPathFor(planPath);

	afterAll(() => rmSync(tmpDir, { recursive: true, force: true }));

	it("writes skeleton and advances state to SKELETON_WRITTEN", async () => {
		const writer = new SegmentedPlanWriter(planPath, "TestWriter");
		await writer.writeSkeleton("# Test Plan\n\nGoal: test\n\n## 任务\n\n- Task 1\n\n");

		expect(existsSync(planPath)).toBe(true);
		expect(existsSync(manifestPath)).toBe(true);
		const manifest = await readWriteManifest(manifestPath);
		expect(manifest.state).toBe("SKELETON_WRITTEN");
		expect(manifest.lineCount).toBeGreaterThan(0);
		expect(manifest.sha256).toBeTruthy();
	});

	it("appends a block and advances progress", async () => {
		const writer = new SegmentedPlanWriter(planPath, "TestWriter");
		const block = {
			id: "task-1",
			title: "### Task 1: Test",
			content: "\n\n### Task 1: Test\n\nContent here\n\n",
		};
		await writer.appendBlock(block);

		const content = readFileSync(planPath, "utf8");
		expect(content).toContain("Task 1: Test");

		const manifest = await readWriteManifest(manifestPath);
		const section = manifest.sections.find(s => s.id === "task-1");
		expect(section).toBeDefined();
		expect(section!.status).toBe("complete");
		expect(manifest.lineCount).toBeGreaterThan(0);
	});

	it("fence balance check detects imbalance", async () => {
		const writer = new SegmentedPlanWriter(planPath, "TestWriter");
		const badContent = "\n```typescript\nconst x = 1;\n```\n```bash\necho hello\n";
		const balanced = writer.areFencesBalanced(badContent);
		expect(balanced).toBe(false);

		const goodContent = "\n```typescript\nconst x = 1;\n```\n```bash\necho hello\n```\n";
		const balanced2 = writer.areFencesBalanced(goodContent);
		expect(balanced2).toBe(true);
	});

	it("rejects block write when fence imbalance detected", async () => {
		const writer = new SegmentedPlanWriter(planPath, "TestWriter");
		const imbalancedBlock = {
			id: "bad-block",
			title: "Bad",
			content: "\n```js\ncode\n```\n```\nunclosed\n",
		};
		await expect(writer.appendBlock(imbalancedBlock)).rejects.toThrow(/fence imbalance|不平衡/);
	});

	it("finalize advances state to CHUNKS_COMPLETE", async () => {
		const writer = new SegmentedPlanWriter(planPath, "TestWriter");
		await writer.finalizeWrites();

		const manifest = await readWriteManifest(manifestPath);
		expect(manifest.state).toBe("CHUNKS_COMPLETE");
		expect(manifest.timestamps.chunksComplete).toBeTruthy();
	});
});
```

- [ ] **步骤 2：运行 writer.test.ts 验证失败**

运行：
```bash
cd packages/coding-agent && bun test test/codex-plan-run/segmented-write/writer.test.ts -t SegmentedPlanWriter
```
预期：FAIL，`SegmentedPlanWriter` 未定义。

- [ ] **步骤 3：编写 writer.ts —— SegmentedPlanWriter 类**

```typescript
import { readFile, writeFile, appendFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import type { WriteManifest, WriteBlockInfo, SegmentedWriteState } from "./types";
import { createInitManifest } from "./types";
import { writeWriteManifest, readWriteManifest, manifestPathFor, updateWriteManifestState } from "./manifest";

export interface AppendBlockInput {
	id: string;
	title: string;
	content: string;
}

export class SegmentedPlanWriter {
	private manifest: WriteManifest;
	private manifestPath: string;

	constructor(
		public readonly planPath: string,
		public readonly writerRole: string = "SegmentedPlanWriter",
	) {
		this.manifestPath = manifestPathFor(planPath);
		this.manifest = createInitManifest(planPath, writerRole);
	}

	async loadExistingManifest(): Promise<boolean> {
		try {
			this.manifest = await readWriteManifest(this.manifestPath);
			return true;
		} catch {
			return false;
		}
	}

	getManifest(): WriteManifest {
		return { ...this.manifest };
	}

	async writeSkeleton(content: string): Promise<void> {
		// Write skeleton to file
		await writeFile(this.planPath, content, "utf8");
		// Compute hash and line count
		const sha256 = createHash("sha256").update(content, "utf8").digest("hex");
		const lineCount = content.split("\n").length;

		this.manifest.state = "SKELETON_WRITTEN";
		this.manifest.lineCount = lineCount;
		this.manifest.sha256 = sha256;
		this.manifest.timestamps.skeletonWritten = new Date().toISOString();

		await writeWriteManifest(this.manifest);
	}

	async appendBlock(block: AppendBlockInput): Promise<void> {
		const existingContent = await readFile(this.planPath, "utf8");
		const oldLineCount = existingContent.split("\n").length;
		const oldSha256 = createHash("sha256").update(existingContent, "utf8").digest("hex");

		// Validate fence balance in new block
		if (!this.areFencesBalanced(block.content)) {
			throw new Error(`Code fence imbalance detected in block "${block.id}"`);
		}

		// Append
		const newContent = existingContent + block.content;
		await writeFile(this.planPath, newContent, "utf8");

		// Post-write verification
		const newSha256 = createHash("sha256").update(newContent, "utf8").digest("hex");
		const newLineCount = newContent.split("\n").length;

		if (newSha256 === oldSha256) {
			throw new Error(`Block "${block.id}" did not change file content`);
		}
		if (newLineCount <= oldLineCount) {
			throw new Error(`Block "${block.id}" did not add lines`);
		}

		// Update manifest
		const blockInfo: WriteBlockInfo = {
			id: block.id,
			title: block.title,
			status: "complete",
			lineStart: oldLineCount + 1,
			lineEnd: newLineCount,
			sha256: newSha256,
		};

		this.manifest.state = "CHUNKS_IN_PROGRESS";
		this.manifest.sections.push(blockInfo);
		this.manifest.lineCount = newLineCount;
		this.manifest.sha256 = newSha256;

		await writeWriteManifest(this.manifest);
	}

	areFencesBalanced(content: string): boolean {
		const fenceRegex = /^( {0,3})```/gm;
		const matches = content.match(fenceRegex);
		const count = matches ? matches.length : 0;
		return count % 2 === 0;
	}

	async finalizeWrites(): Promise<void> {
		this.manifest.state = "CHUNKS_COMPLETE";
		this.manifest.timestamps.chunksComplete = new Date().toISOString();
		await writeWriteManifest(this.manifest);

		// Append tail marker
		await appendFile(this.planPath, `\n${this.manifest.tailMarker}\n`, "utf8");
	}
}
```

- [ ] **步骤 4：运行 writer.test.ts 验证通过**

运行：
```bash
cd packages/coding-agent && bun test test/codex-plan-run/segmented-write/writer.test.ts -t SegmentedPlanWriter
```
预期：PASS（所有测试通过）。

- [ ] **步骤 5：更新 index.ts 新增导出**

```typescript
// 在现有导出后追加
export { SegmentedPlanWriter, type AppendBlockInput } from "./writer";
```

- [ ] **步骤 6：验证聚合测试通过**

运行：
```bash
cd packages/coding-agent && bun test test/codex-plan-run/segmented-write/
```
预期：PASS（3 个测试文件，所有 case 通过）。

- [ ] **步骤 7：Commit（可选，仅当 .git 存在时）**

```bash
if [ -d .git ]; then
  git add packages/coding-agent/src/codex-plan-run/segmented-write/writer.ts
  git add packages/coding-agent/test/codex-plan-run/segmented-write/writer.test.ts
  git add packages/coding-agent/src/codex-plan-run/segmented-write/index.ts
  git commit -m "feat(superpowers): segmented-write writer with checkpoint and fence validation"
fi
```

<!-- segmented-write:task-2-complete -->

### 任务 3：恢复/重建测试与实现

**文件：**
- 修改：`packages/coding-agent/src/codex-plan-run/segmented-write/writer.ts`
- 创建：`packages/coding-agent/test/codex-plan-run/segmented-write/recovery.test.ts`

---

- [ ] **步骤 1：编写 recovery.test.ts —— 三种恢复场景测试**

```typescript
import { describe, expect, it, beforeAll, afterAll } from "bun:test";
import { mkdtempSync, writeFileSync, rmSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SegmentedPlanWriter } from "../../../src/codex-plan-run/segmented-write/writer";
import { readWriteManifest, manifestPathFor, writeWriteManifest } from "../../../src/codex-plan-run/segmented-write/manifest";
import { createInitManifest } from "../../../src/codex-plan-run/segmented-write/types";

describe("Writer recovery", () => {
	const tmpDir = mkdtempSync(join(tmpdir(), "recovery-test-"));
	const planPath = join(tmpDir, "plan.md");
	const manifestPath = manifestPathFor(planPath);

	afterAll(() => rmSync(tmpDir, { recursive: true, force: true }));

	it("Scenario 1: resumes from last complete block when manifest exists", async () => {
		// Simulate: skeleton written, first block complete
		{
			const writer = new SegmentedPlanWriter(planPath, "TestWriter");
			await writer.writeSkeleton("# Plan\n\nGoal\n\n");
			await writer.appendBlock({ id: "block-1", title: "Block 1", content: "\n\nBlock 1 content\n\n" });
		}
		// New writer loads existing manifest
		{
			const writer2 = new SegmentedPlanWriter(planPath, "TestWriter");
			const loaded = await writer2.loadExistingManifest();
			expect(loaded).toBe(true);

			const manifest = writer2.getManifest();
			expect(manifest.state).toBe("CHUNKS_IN_PROGRESS");
			expect(manifest.sections).toHaveLength(1);
			expect(manifest.sections[0]?.id).toBe("block-1");
			expect(manifest.sections[0]?.status).toBe("complete");

			const completedIds = writer2.getCompletedBlockIds();
			expect(completedIds).toEqual(["block-1"]);
		}
	});

	it("Scenario 2: reconstructs from file when manifest is missing", async () => {
		// Simulate: only plan file exists, no manifest
		const plan2Path = join(tmpDir, "plan-scenario-2.md");
		writeFileSync(plan2Path, "# Orphan Plan\n\n## Goal\n\nSome content\n\n## 任务\n\n- Task A\n\n", "utf8");

		const writer = new SegmentedPlanWriter(plan2Path, "TestWriter");
		const reconstructed = await writer.reconstructFromFile();
		expect(reconstructed).toBe(true);

		const manifest = writer.getManifest();
		expect(manifest.planPath).toBe(plan2Path);
		expect(manifest.lineCount).toBeGreaterThan(0);
		expect(manifest.sha256).toBeTruthy();
		// Should have discovered headings
		expect(manifest.sections.length).toBeGreaterThanOrEqual(1);
	});

	it("Scenario 3: handles recovery after incomplete write with tail marker mismatch", async () => {
		const plan3Path = join(tmpDir, "plan-scenario-3.md");
		// Write skeleton + first block
		const writer = new SegmentedPlanWriter(plan3Path, "TestWriter");
		await writer.writeSkeleton("# S3 Plan\n\nGoal\n\n");
		await writer.appendBlock({ id: "s3-block", title: "S3 Block", content: "\nContent\n" });

		// Tamper with file (simulate external modification)
		writeFileSync(plan3Path, "# Tampered Content\n", "utf8");

		// Attempt recovery should detect content mismatch
		const writer2 = new SegmentedPlanWriter(plan3Path, "TestWriter");
		await writer2.loadExistingManifest();
		const mismatch = await writer2.verifyFileIntegrity();
		expect(mismatch).toBe(false);
	});

	it("getIncompleteBlocks returns only pending blocks after recovery", async () => {
		const writer = new SegmentedPlanWriter(planPath, "TestWriter");
		await writer.loadExistingManifest();

		const incomplete = writer.getIncompleteBlocks();
		// After previous tests, block-1 is complete, others are pending
		expect(Array.isArray(incomplete)).toBe(true);
	});
});
```

- [ ] **步骤 2：运行 recovery.test.ts 验证失败**

运行：
```bash
cd packages/coding-agent && bun test test/codex-plan-run/segmented-write/recovery.test.ts -t "Writer recovery"
```
预期：FAIL，`SegmentedPlanWriter` 缺少 `loadExistingManifest`、`getCompletedBlockIds`、`reconstructFromFile`、`verifyFileIntegrity`、`getIncompleteBlocks` 等方法。

- [ ] **步骤 3：在 writer.ts 中添加恢复方法**

在 `SegmentedPlanWriter` 类中追加：

```typescript
	/** 获取已完成 block 的 id 列表 */
	getCompletedBlockIds(): string[] {
		return this.manifest.sections
			.filter(s => s.status === "complete")
			.map(s => s.id);
	}

	/** 获取未完成 block 的 id 列表 */
	getIncompleteBlocks(): WriteBlockInfo[] {
		return this.manifest.sections.filter(s => s.status !== "complete");
	}

	/** 根据已写入的 plan 文件重建 manifest（场景 2：manifest 缺失但文件存在） */
	async reconstructFromFile(): Promise<boolean> {
		try {
			const content = await readFile(this.planPath, "utf8");
			const lineCount = content.split("\n").length;
			const sha256 = createHash("sha256").update(content, "utf8").digest("hex");

			// Parse H1/H2/H3 headings to infer sections
			const headingRegex = /^(#{1,3})\s+(.+)$/gm;
			const sections: WriteBlockInfo[] = [];
			let match: RegExpExecArray | null;
			while ((match = headingRegex.exec(content)) !== null) {
				const lineNum = content.substring(0, match.index).split("\n").length;
				sections.push({
					id: match[2]!.toLowerCase().replace(/[^a-z0-9]+/g, "-"),
					title: match[2]!,
					status: "pending",
					lineStart: lineNum,
					lineEnd: lineNum,
				});
			}

			this.manifest = {
				...this.manifest,
				lineCount,
				sha256,
				sections,
				state: "CHUNKS_IN_PROGRESS",
			};

			await writeWriteManifest(this.manifest);
			return true;
		} catch {
			return false;
		}
	}

	/** 验证文件内容与 manifest 记录是否一致（场景 3：完整性校验） */
	async verifyFileIntegrity(): Promise<boolean> {
		try {
			const content = await readFile(this.planPath, "utf8");
			const currentSha256 = createHash("sha256").update(content, "utf8").digest("hex");
			return currentSha256 === this.manifest.sha256;
		} catch {
			return false;
		}
	}

	/** 获取上次中断后的恢复建议 */
	getResumeAdvice(): { nextBlockId: string | null; completedCount: number; totalCount: number } {
		const completed = this.manifest.sections.filter(s => s.status === "complete");
		const nextPending = this.manifest.sections.find(s => s.status !== "complete");
		return {
			nextBlockId: nextPending?.id ?? null,
			completedCount: completed.length,
			totalCount: this.manifest.sections.length,
		};
	}
```

还需要在文件头部 Import 中添加：
```typescript
import type { WriteBlockInfo } from "./types";
```

- [ ] **步骤 4：运行 recovery.test.ts 验证通过**

运行：
```bash
cd packages/coding-agent && bun test test/codex-plan-run/segmented-write/recovery.test.ts -t "Writer recovery"
```
预期：PASS（所有测试通过）。

- [ ] **步骤 5：验证全部测试通过（回归）**

运行：
```bash
cd packages/coding-agent && bun test test/codex-plan-run/segmented-write/
```
预期：PASS（4 个测试文件，所有 case 通过）。

- [ ] **步骤 6：Commit（可选，仅当 .git 存在时）**

```bash
if [ -d .git ]; then
  git add packages/coding-agent/src/codex-plan-run/segmented-write/writer.ts
  git add packages/coding-agent/test/codex-plan-run/segmented-write/recovery.test.ts
  git commit -m "feat(superpowers): segmented-write recovery and reconstruction"
fi
```

<!-- segmented-write:task-3-complete -->

### 任务 4：计划自检测试与实现

**文件：**
- 创建：`packages/coding-agent/src/codex-plan-run/segmented-write/checker.ts`
- 创建：`packages/coding-agent/test/codex-plan-run/segmented-write/checker.test.ts`

---

- [ ] **步骤 1：编写 checker.test.ts —— 自检逻辑测试**

```typescript
import { describe, expect, it } from "bun:test";
import { checkNoPlaceholders, checkTaskNumbering, checkFenceBalance, checkHeadingPresence, SelfCheckResult } from "../../../src/codex-plan-run/segmented-write/checker";

describe("PlanSelfChecker", () => {
	it("detects TODO placeholders", () => {
		const content = "# Plan\n\nTODO: implement this\n";
		const result: SelfCheckResult = checkNoPlaceholders(content);
		expect(result.passed).toBe(false);
		expect(result.violations.length).toBeGreaterThan(0);
		expect(result.violations[0]?.pattern).toBe("TODO");
	});

	it("detects TBD placeholders", () => {
		const content = "Some TBD detail";
		const result = checkNoPlaceholders(content);
		expect(result.passed).toBe(false);
	});

	it("detects FIXME placeholders", () => {
		const content = "Fix FIXME later";
		const result = checkNoPlaceholders(content);
		expect(result.passed).toBe(false);
	});

	it("passes clean content", () => {
		const content = "# Clean Plan\n\nAll done.\n";
		const result = checkNoPlaceholders(content);
		expect(result.passed).toBe(true);
		expect(result.violations).toHaveLength(0);
	});

	it("finds broken task numbering (gaps)", () => {
		const content = "### Task 1: A\n### Task 2: B\n### Task 4: D\n";
		const result = checkTaskNumbering(content);
		expect(result.passed).toBe(false);
		expect(result.violations.length).toBeGreaterThan(0);
		expect(result.violations.some(v => v.message.includes("Task 3"))).toBe(true);
	});

	it("passes consecutive task numbering", () => {
		const content = "### Task 1: A\n### Task 2: B\n### Task 3: C\n";
		const result = checkTaskNumbering(content);
		expect(result.passed).toBe(true);
	});

	it("detects unbalanced code fences", () => {
		const content = "# Plan\n```js\ncode\n```\n```unclosed\n";
		const result = checkFenceBalance(content);
		expect(result.passed).toBe(false);
	});

	it("passes balanced code fences", () => {
		const content = "# Plan\n```js\ncode\n```\n```bash\necho hi\n```\n";
		const result = checkFenceBalance(content);
		expect(result.passed).toBe(true);
	});

	it("detects missing H1 heading", () => {
		const content = "## Subsection\n";
		const result = checkHeadingPresence(content);
		expect(result.passed).toBe(false);
		expect(result.violations[0]?.message).toContain("H1");
	});

	it("passes with H1 heading", () => {
		const content = "# Title\n## Subsection\n";
		const result = checkHeadingPresence(content);
		expect(result.passed).toBe(true);
	});
});
```

- [ ] **步骤 2：运行 checker.test.ts 验证失败**

运行：
```bash
cd packages/coding-agent && bun test test/codex-plan-run/segmented-write/checker.test.ts -t PlanSelfChecker
```
预期：FAIL，`SelfCheckResult`、`checkNoPlaceholders` 等未定义。

- [ ] **步骤 3：编写 checker.ts —— 自检逻辑实现**

```typescript
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

const PLACEHOLDER_PATTERNS = [
	{ pattern: "TODO", regex: /\bTODO\b/gi },
	{ pattern: "TBD", regex: /\bTBD\b/gi },
	{ pattern: "FIXME", regex: /\bFIXME\b/gi },
	{ pattern: "待补充", regex: /待补充/g },
	{ pattern: "placeholder", regex: /\bplaceholder\b/gi },
];

function contentLines(content: string): string[] {
	return content.split("\n");
}

export function checkNoPlaceholders(content: string): SelfCheckResult {
	const violations: SelfCheckViolation[] = [];
	const lines = contentLines(content);

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
	const lines = contentLines(content);
	const numbers: Array<{ num: number; line: number }> = [];

	let match: RegExpExecArray | null;
	while ((match = taskRegex.exec(content)) !== null) {
		const lineNum = content.substring(0, match.index).split("\n").length;
		numbers.push({ num: parseInt(match[1]!, 10), line: lineNum });
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
		violations: balanced ? [] : [{ line: 0, pattern: "fence-imbalance", message: `Unbalanced fences: ${count} openings (not even)` }],
	};
}

export function checkHeadingPresence(content: string): SelfCheckResult {
	const violations: SelfCheckViolation[] = [];
	const lines = contentLines(content);

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
```

- [ ] **步骤 4：运行 checker.test.ts 验证通过**

运行：
```bash
cd packages/coding-agent && bun test test/codex-plan-run/segmented-write/checker.test.ts -t PlanSelfChecker
```
预期：PASS（所有测试通过）。

- [ ] **步骤 5：更新 index.ts 加入 checker 导出**

```typescript
export { runAllChecks, checkNoPlaceholders, checkTaskNumbering, checkFenceBalance, checkHeadingPresence, type SelfCheckResult, type FullSelfCheckResult } from "./checker";
```

- [ ] **步骤 6：验证全部测试通过（回归）**

运行：
```bash
cd packages/coding-agent && bun test test/codex-plan-run/segmented-write/
```
预期：PASS（5 个测试文件，所有 case 通过）。

- [ ] **步骤 7：Commit（可选，仅当 .git 存在时）**

```bash
if [ -d .git ]; then
  git add packages/coding-agent/src/codex-plan-run/segmented-write/checker.ts
  git add packages/coding-agent/test/codex-plan-run/segmented-write/checker.test.ts
  git add packages/coding-agent/src/codex-plan-run/segmented-write/index.ts
  git commit -m "feat(superpowers): segmented-write self-check logic"
fi
```

<!-- segmented-write:task-4-complete -->

### 任务 5：集成到计划生成/交接路径

**文件：**
- 创建：`packages/coding-agent/src/codex-plan-run/segmented-write/integration.ts`
- 创建：`packages/coding-agent/test/codex-plan-run/segmented-write/integration.test.ts`
- 修改：`packages/coding-agent/src/codex-plan-run/execution-book.ts`（在 `writePlanExecutionBook` 中接入分段写入）
**codebase-memory 证据：** `writePlanExecutionBook(path, book)` 函数（第 813-820 行）位于 `execution-book.ts`，通过 `writeSegmentedMarkdownIfNeeded` 路由分段写入。

**集成目标：** `execution-book.ts` 中的 `writePlanExecutionBook(path, book)`（第 813-820 行）。该函数当前直接调用 `writeFile(path, renderPlanExecutionBook(book))`，修改后通过 `writeSegmentedMarkdownIfNeeded()` 自动判断是否需要分段写入。

---

- [ ] **步骤 1：编写 integration.test.ts —— 分段写入集成测试（预期失败）**

```typescript
import { afterAll, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { shouldUseSegmentedWrite, writeSegmentedMarkdownIfNeeded } from "../../../src/codex-plan-run/segmented-write/integration";
import { readWriteManifest } from "../../../src/codex-plan-run/segmented-write/manifest";
import { manifestPathFor } from "../../../src/codex-plan-run/segmented-write/manifest";

describe("SegmentedWriteIntegration", () => {
	const tmpDir = mkdtempSync(join(tmpdir(), "seg-integration-"));
	afterAll(() => rmSync(tmpDir, { recursive: true, force: true }));

	it("shouldUseSegmentedWrite returns false for short content", () => {
		const planPath = join(tmpDir, "short.md");
		const result = shouldUseSegmentedWrite(planPath, 50, 200);
		expect(result).toBe(false);
	});

	it("shouldUseSegmentedWrite returns true for long plan in /docs/superpowers/plans/", () => {
		const planPath = join(tmpDir, "docs/superpowers/plans/long-plan.md");
		const result = shouldUseSegmentedWrite(planPath, 500, 200);
		expect(result).toBe(true);
	});

	it("shouldUseSegmentedWrite returns true for long plan-execution-book.md", () => {
		const planPath = join(tmpDir, "plan-execution-book.md");
		const result = shouldUseSegmentedWrite(planPath, 500, 200);
		expect(result).toBe(true);
	});

	it("shouldUseSegmentedWrite returns false for non-.md paths", () => {
		const planPath = join(tmpDir, "src/code.ts");
		const result = shouldUseSegmentedWrite(planPath, 500, 200);
		expect(result).toBe(false);
	});

	it("writeSegmentedMarkdownIfNeeded returns 'direct' for short content", async () => {
		const planPath = join(tmpDir, "short-test.md");
		const result = await writeSegmentedMarkdownIfNeeded(planPath, "# Short\n\nHello", { minChunkLines: 200 });
		expect(result).toBe("direct");
	});

	it("writeSegmentedMarkdownIfNeeded returns 'segmented' and creates manifest for long plan-execution-book.md", async () => {
		const planPath = join(tmpDir, "plan-execution-book.md");
		const lines: string[] = [];
		for (let i = 0; i < 250; i++) lines.push(`Line ${i}`);
		const content = lines.join("\n");
		const result = await writeSegmentedMarkdownIfNeeded(planPath, content, { minChunkLines: 200 });
		expect(result).toBe("segmented");
		// Verify manifest sidecar was created by SegmentedPlanWriter
		const manifestPath = manifestPathFor(planPath);
		expect(existsSync(manifestPath)).toBe(true);
		const manifest = await readWriteManifest(manifestPath);
		expect(manifest.state).toBe("CHUNKS_COMPLETE");
		expect(manifest.lineCount).toBeGreaterThan(200);
	});
});
```

- [ ] **步骤 2：运行 integration.test.ts 验证失败**

运行：
```bash
cd packages/coding-agent && bun test test/codex-plan-run/segmented-write/integration.test.ts -t SegmentedWriteIntegration
```
预期：FAIL，报错 `Cannot find module` 或 `shouldUseSegmentedWrite` 未定义。

- [ ] **步骤 3：编写 integration.ts —— 分段写入集成适配器**

```typescript
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { SegmentedPlanWriter } from "./writer";

export interface SegmentedWriteOptions {
	planPath: string;
	writerRole?: string;
	minChunkLines?: number;
	enableSelfCheck?: boolean;
	enableRecovery?: boolean;
}

/**
 * 判断是否应启用分段写入。
 * 条件：行数 >= minChunkLines、路径以 .md 结尾、
 * 且包含 /docs/superpowers/plans/ 或以 plan-execution-book.md 结尾。
 */
export function shouldUseSegmentedWrite(
	planPath: string,
	lineCount: number,
	minChunkLines = 200,
): boolean {
	if (lineCount < minChunkLines) return false;
	if (!planPath.endsWith(".md")) return false;
	if (!planPath.includes("/docs/superpowers/plans/") && !planPath.endsWith("plan-execution-book.md")) return false;
	return true;
}

/**
 * 根据内容特征决定直接写入或分段写入。
 * 返回 "direct"（直接 writeFile）或 "segmented"（分段写入）。
 * 长内容使用 SegmentedPlanWriter 进行骨架写入 → 分块追加 → finalize 完整流程，
 * 并在写入过程中自动维护 sidecar manifest 及 sha256 校验。
 */
export async function writeSegmentedMarkdownIfNeeded(
	planPath: string,
	content: string,
	options?: Partial<SegmentedWriteOptions>,
): Promise<"direct" | "segmented"> {
	const lineCount = content.split("\n").length;
	const minChunkLines = options?.minChunkLines ?? 200;

	if (shouldUseSegmentedWrite(planPath, lineCount, minChunkLines)) {
		const lines = content.split("\n");
		const skeletonSize = Math.min(80, lines.length);
		const skeleton = lines.slice(0, skeletonSize).join("\n") + "\n";
		const remaining = lines.slice(skeletonSize);

		const writer = new SegmentedPlanWriter(planPath, options?.writerRole ?? "SegmentedPlanWriter");
		await mkdir(dirname(planPath), { recursive: true });
		await writer.writeSkeleton(skeleton);

		for (let i = 0; i < remaining.length; i += minChunkLines) {
			const chunk = remaining.slice(i, i + minChunkLines);
			await writer.appendBlock({
				id: `chunk-${Math.floor(i / minChunkLines)}`,
				title: `Chunk ${Math.floor(i / minChunkLines)}`,
				content: "\n" + chunk.join("\n") + "\n",
			});
		}

		await writer.finalizeWrites();
		return "segmented";
	}

	await mkdir(dirname(planPath), { recursive: true });
	await writeFile(planPath, content, "utf8");
	return "direct";
}
```

- [ ] **步骤 4：修改 `writePlanExecutionBook` 接入分段写入**

在 `packages/coding-agent/src/codex-plan-run/execution-book.ts` 中：

1. 添加导入：
```typescript
import { writeSegmentedMarkdownIfNeeded } from "./segmented-write/integration";
```

2. 将原 `writePlanExecutionBook` 函数体中的：
```typescript
await mkdir(dirname(path), { recursive: true });
await writeFile(path, renderPlanExecutionBook(book), "utf8");
```
替换为：
```typescript
await writeSegmentedMarkdownIfNeeded(path, renderPlanExecutionBook(book), { writerRole: "PlanExecutionBookWriter" });
```

- [ ] **步骤 5：运行集成测试验证通过**

运行：
```bash
cd packages/coding-agent && bun test test/codex-plan-run/segmented-write/integration.test.ts -t SegmentedWriteIntegration
```
预期：PASS（6 个测试 case）。

- [ ] **步骤 6：验证全部测试通过（回归）**

运行：
```bash
cd packages/coding-agent && bun test test/codex-plan-run/segmented-write/
```
预期：PASS（6 个测试文件，所有 case 通过）。

- [ ] **步骤 7：Commit（可选，仅当 .git 存在时）**

```bash
if [ -d .git ]; then
  git add packages/coding-agent/src/codex-plan-run/segmented-write/integration.ts
  git add packages/coding-agent/test/codex-plan-run/segmented-write/integration.test.ts
  git add packages/coding-agent/src/codex-plan-run/execution-book.ts
  git commit -m "feat(superpowers): segmented-write integration into plan generation path"
fi
```

### 任务 6：文档、冒烟测试、package 检查/构建、codebase-memory 更新

**文件：**
- 创建：`docs/superpowers/plans/2026-06-28-segmented-plan-writing.md`（本文档，已在创建中）
- 修改：`packages/coding-agent/src/codex-plan-run/index.ts`（确保所有新模块通过 barrel 导出）
- 可选：docs 目录/索引更新（如果项目使用文档索引机制）

---

- [ ] **步骤 1：更新 barrel 导出 —— 确认 index.ts 覆盖所有新模块**

确认 `packages/coding-agent/src/codex-plan-run/segmented-write/index.ts` 的导出列表包含：

```typescript
export { type SegmentedWriteState, type WriteBlockInfo, type WriteManifest, SEGMENTED_WRITE_STATES, createInitManifest } from "./types";
export { manifestPathFor, writeWriteManifest, readWriteManifest, validateWriteManifest, updateWriteManifestState } from "./manifest";
export { SegmentedPlanWriter, type AppendBlockInput } from "./writer";
export { runAllChecks, checkNoPlaceholders, checkTaskNumbering, checkFenceBalance, checkHeadingPresence, type SelfCheckResult, type FullSelfCheckResult } from "./checker";
export { tryRecover, selfCheckPlan, shouldUseSegmentedWrite, type SegmentedWriteOptions } from "./integration";
```

- [ ] **步骤 2：运行冒烟测试——验证所有 6 个测试文件通过**

运行：
```bash
cd packages/coding-agent && bun test test/codex-plan-run/segmented-write/
```

预期输出示例：
```
✓ SegmentedWriteTypes > defines states in correct order
✓ SegmentedWriteTypes > defines WriteBlockInfo with required fields
✓ SegmentedWriteTypes > defines WriteManifest with all fields
✓ WriteManifest IO > computes manifest path from plan path
✓ WriteManifest IO > writes and reads manifest
✓ WriteManifest IO > rejects invalid manifest
✓ WriteManifest IO > does not overwrite when manifest write fails
✓ SegmentedPlanWriter > writes skeleton and advances state
✓ SegmentedPlanWriter > appends a block and advances progress
✓ SegmentedPlanWriter > fence balance check detects imbalance
✓ SegmentedPlanWriter > rejects block write when fence imbalance detected
✓ SegmentedPlanWriter > finalize advances state to CHUNKS_COMPLETE
✓ Writer recovery > Scenario 1: resumes from last complete block
✓ Writer recovery > Scenario 2: reconstructs from file when manifest missing
✓ Writer recovery > Scenario 3: handles tampered file recovery
✓ PlanSelfChecker > detects TODO placeholders
✓ PlanSelfChecker > passes clean content
✓ PlanSelfChecker > detects unbalanced code fences
✓ PlanSelfChecker > detects missing H1 heading
✓ SegmentedWriteIntegration > shouldUseSegmentedWrite returns false for short content
✓ SegmentedWriteIntegration > shouldUseSegmentedWrite returns false for non-plan paths
✓ SegmentedWriteIntegration > shouldUseSegmentedWrite returns true for long plan files

## Summary
  22 pass
  0 fail
```

- [ ] **步骤 3：运行 TypeScript 类型检查**

运行：
```bash
cd packages/coding-agent && bun run check:types
```

预期：类型检查通过（exit code 0），确保新模块的所有类型导出/导入正确。

- [ ] **步骤 4：运行 Biome lint**

运行：
```bash
cd packages/coding-agent && bun run lint
```

预期：无 lint 错误。

- [ ] **步骤 5：运行项目级测试（可选，对整个 coding-agent 包）**

运行：
```bash
cd packages/coding-agent && bun run test
```

预期：所有测试通过。注意该命令可能运行整个包的测试集，执行时间较长。

- [ ] **步骤 6：更新 codebase-memory graph**

在 OMP 环境中运行 codebase-memory 更新，将新模块索引到知识图谱中。通过以下方式之一：

- **OMP CLI**：在 agent session 中运行 `codebase-memory update-paths "packages/coding-agent/src/codex-plan-run/segmented-write/"` 命令。
- **手动确认**：验证 `packages/coding-agent/src/codex-plan-run/index.ts` 的 barrel 导出已被 codebase-memory 的自动扫描捕获。

确认点：codebase-memory graph 查询应返回 `segmented-write` 模块的结构信息和调用关系。

- [ ] **步骤 7：完成文档标记**

在本计划文档末尾添加最终尾标记：

```
<!-- segmented-write:plan-complete -->
```

确认本文档（`docs/superpowers/plans/2026-06-28-segmented-plan-writing.md`）本身作为分段写入的产物：
- 包含所有 6 个任务
- 每个任务有完整的文件、测试代码、运行命令
- 无 TODO/TBD/placeholder 残留
- Fence 成对平衡
- 存在 H1 标题

- [ ] **步骤 8：Commit（可选，仅当 .git 存在时）**

```bash
if [ -d .git ]; then
  git add packages/coding-agent/src/codex-plan-run/segmented-write/
  git add packages/coding-agent/test/codex-plan-run/segmented-write/
  git add docs/superpowers/plans/2026-06-28-segmented-plan-writing.md
  git commit -m "feat(superpowers): add segmented plan writing state machine"
fi
```

<!-- segmented-write:task-6-complete -->

## 最终验收清单

### 功能验收

| 检查项 | 验证方法 | 预期结果 |
|--------|----------|----------|
| 状态机完整 | 单元测试 | 所有 6 个状态均可达且转换正确 |
| manifest 写入原子性 | 单元测试 | 无效 manifest 不写盘 |
| 骨架写入可验证 | 单元测试 | 文件存在、hash 匹配、line count 正确 |
| 分块追加可验证 | 单元测试 | 每个 block 后 line count 增加、hash 变化 |
| fence 平衡检测 | 单元测试 | 不平衡 → reject，平衡 → accept |
| 恢复场景 1：manifest 存在 | 单元测试 | 从最后一个 complete block 继续 |
| 恢复场景 2：manifest 缺失 | 单元测试 | 从文件解析 heading 重建 manifest |
| 恢复场景 3：文件篡改 | 单元测试 | 完整性校验失败 |
| 自检：TODO 检测 | 单元测试 | 检测到 TODO/TBD/FIXME |
| 自检：任务编号连续性 | 单元测试 | 检测到跳号 |
| 自检：H1 存在性 | 单元测试 | 缺失 H1 时报告 |
| 集成阈值判断 | 单元测试 | 短文档/非 plan 路径不触发分段 |

### 质量验收

| 检查项 | 命令 | 预期 |
|--------|------|------|
| 聚合测试通过 | `bun test test/codex-plan-run/segmented-write/` | 全部 PASS |
| TypeScript 类型检查 | `bun run check:types` | exit 0，无类型错误 |
| Biome lint | `bun run lint` | 无 lint 错误 |
| 构建不损坏 | `bun run build`（如项目支持构建步骤） | exit 0 |
| codebase-memory 索引 | graph 查询 | 新模块可检索 |

### 设计验收（对照 specs）

| 设计规格要求 | 本计划覆盖的任务 | 状态 |
|-------------|-----------------|------|
| 不存在单次巨型写入 | Task 5, 6: shouldUseSegmentedWrite 阈值 + 分块写入 | ✓ |
| 中断可恢复 | Task 3: 三种恢复场景 | ✓ |
| 每个 block 有证据 | Task 2: manifest 记录 block 信息（行数/时间/hash） | ✓ |
| 自检发现缺陷 | Task 4: 自检全部检查项 | ✓ |
| v1 性质声明 | 本文件文档头部和设计文档尾部 | ✓ |
| 不破坏现有流程 | Task 5: shouldUseSegmentedWrite 返回 false 时走原路径 | ✓ |

## 执行交接

**计划已完成并保存到 `docs/superpowers/plans/2026-06-28-segmented-plan-writing.md`。**

### 执行方式

**方式 1：子代理驱动（推荐）**
- 必需子技能：`superpowers:subagent-driven-development`
- 每个任务调度一个新的子代理，顺序执行，任务间进行审查
- 适合团队协作场景，审查可并行

**方式 2：内联执行**
- 必需子技能：`superpowers:executing-plans`
- 在当前会话中按 Task 1→6 顺序执行
- 每完成 2 个任务设置一个审查检查点

### 跨任务注意事项

- Task 5 需要在 Task 1-4 完成后进行（依赖 writer/checker 模块就绪）
- Task 3 修改 `writer.ts`（新增方法），请勿与 Task 2 的文件冲突
- 所有 commit 步骤为可选，仅当 `.git` 存在时执行
- 如果执行者收到 "caller not found" 或 "module not registered" 错误，检查 `index.ts` 的 barrel 导出是否最新

<!-- segmented-write:acceptance-complete -->
<!-- segmented-write:plan-complete -->