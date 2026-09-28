import { afterEach, describe, expect, it } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

(globalThis as { __SKIP_DB_SETUP__?: boolean }).__SKIP_DB_SETUP__ = true;

import { getFeature, listFeatures, loadFeatures, registerFeature, resetFeatureRegistry } from "./registry";
import { citeList, jsonForPrompt, redactPii, truncateForPrompt } from "./context";
import { buildSystemPrompt, hasActionPermission } from "./runtime";

const featureSrc = (key: string, exportStyle: "default" | "named" = "default") => `
const def = { key: "${key}", label: "L", description: "D",
  actions: { go: { permission: "*", input: { parse: (x) => x }, run: async () => ({}) } },
  schedules: [{ key: "${key}:tick", everyMinutes: 5, run: async () => {} }] };
${exportStyle === "default" ? "module.exports = { default: def };" : "module.exports = { feature: def };"}
`;

function fixtureDir(files: Record<string, string>): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "ai-features-"));
  for (const [name, src] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), src);
  return dir;
}

describe("feature registry", () => {
  afterEach(() => resetFeatureRegistry());

  it("loads the real features directory (summarize ships as the example)", async () => {
    await loadFeatures();
    expect(getFeature("summarize")?.actions.text.permission).toBe("*");
    expect(listFeatures().map((f) => f.key)).toContain("summarize");
  });

  it("loads only *.feature.js files, default or `feature` export", async () => {
    const dir = fixtureDir({
      "alpha.feature.js": featureSrc("alpha"),
      "beta.feature.js": featureSrc("beta", "named"),
      "helper.js": "throw new Error('must not be loaded')",
      "gamma.feature.test.js": "throw new Error('must not be loaded')",
    });
    await loadFeatures(dir);
    expect(listFeatures().map((f) => f.key)).toEqual(["alpha", "beta"]);
  });

  it("rejects duplicate feature and schedule keys", async () => {
    await loadFeatures(fixtureDir({ "alpha.feature.js": featureSrc("alpha") }));
    const def = { key: "alpha", label: "", description: "", actions: {} };
    expect(() => registerFeature(def)).toThrow(/duplicate AI feature key "alpha"/);
    expect(() => registerFeature({ ...def, key: "other", schedules: [{ key: "alpha:tick", everyMinutes: 1, run: async () => {} }] }))
      .toThrow(/duplicate AI schedule key/);
    expect(() => registerFeature({ ...def, key: "Bad Key" })).toThrow(/lowercase key/);
  });

  it("refuses lookups before loading", () => {
    expect(() => listFeatures()).toThrow(/await loadFeatures/);
  });
});

describe("prompt helpers", () => {
  it("redacts PII but keeps dates and codes", () => {
    const text =
      "Mail budi.s@corp.co.id or call +62 812-3456-7890 / 081234567890. NIK 3171234567890001, " +
      "NPWP 01.234.567.8-901.000, acct 1234567890. Due 2026-09-27 for RSK-0001 clause 6.1.2.";
    const out = redactPii(text);
    for (const secret of ["budi.s@", "812-3456", "081234567890", "3171234567890001", "01.234.567.8-901.000", "1234567890"]) {
      expect(out).not.toContain(secret);
    }
    expect(out).toContain("2026-09-27");
    expect(out).toContain("RSK-0001");
    expect(out).toContain("6.1.2");
  });

  it("truncates, stable-stringifies and formats citations", () => {
    expect(truncateForPrompt("abcdef", 10)).toBe("abcdef");
    expect(truncateForPrompt("abcdef", 3)).toBe("abc\n…[truncated 3 characters]");
    expect(jsonForPrompt({ b: 1, a: { d: 2, c: [3] } }, 1000)).toBe('{"a":{"c":[3],"d":2},"b":1}');
    expect(citeList([{ id: "R-1", text: "Risk  one\nline" }, { id: "C-2", text: "Control" }])).toBe("[R-1] Risk one line\n[C-2] Control");
  });

  it("appends language and the safety paragraph", () => {
    const p = buildSystemPrompt("Draft a policy.", "Indonesian");
    expect(p).toMatch(/^Draft a policy\.\n\nWrite in Indonesian\.\n\n/);
    expect(p).toContain("Never invent clause numbers, record codes");
    expect(p).toContain("say what is missing instead of guessing");
  });

  it("checks any-of permissions", () => {
    const auth = { userId: "u", orgId: "o", tenantId: null, orgType: "Tenant" as const, isSuperAdmin: false, actions: ["risk.read"] };
    expect(hasActionPermission(auth, "*")).toBe(true);
    expect(hasActionPermission(auth, ["risk.update", "risk.read"])).toBe(true);
    expect(hasActionPermission(auth, "risk.update")).toBe(false);
    expect(hasActionPermission({ ...auth, isSuperAdmin: true }, "risk.update")).toBe(true);
  });
});
