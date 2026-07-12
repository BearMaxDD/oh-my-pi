import { describe, test, expect } from "bun:test";
import { withAdvisorRunAugmentation } from "../../src/advisor/run-augmentation";

test("adds context/tools for one run and restores state", async () => {
  const state = { systemPrompt: ["base"], tools: [{ name: "advise" }] };
  const seen: Array<{ systemPrompt: string[]; tools: { name: string }[] }> = [];
  await withAdvisorRunAugmentation(state, {
    additionalSystemContext: ["rules", "evidence"],
    additionalTools: [{ name: "compliance_verdict" }],
  }, async () => seen.push(structuredClone(state)));
  expect(seen[0]?.systemPrompt).toEqual(["base", "rules", "evidence"]);
  expect(state.systemPrompt).toEqual(["base"]);
  expect(state.tools.map(t => t.name)).toEqual(["advise"]);
});

test("rejects duplicate tool name", async () => {
  const state = { systemPrompt: ["base"], tools: [{ name: "advise" }, { name: "compliance_verdict" }] };
  await expect(withAdvisorRunAugmentation(state, {
    additionalSystemContext: [],
    additionalTools: [{ name: "compliance_verdict" }],
  }, async () => {})).rejects.toThrow("duplicate advisor tool");
});

test("restores state even on callback throw", async () => {
  const state = { systemPrompt: ["base"], tools: [{ name: "advise" }] };
  const original = structuredClone(state);
  await expect(withAdvisorRunAugmentation(state, {
    additionalSystemContext: ["crash"],
    additionalTools: [],
  }, async () => { throw new Error("boom"); })).rejects.toThrow("boom");
  expect(state).toEqual(original);
});
