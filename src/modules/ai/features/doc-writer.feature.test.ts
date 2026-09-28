import { describe, expect, it } from "vitest";
import { firstSentences, keywordsOf, pickRequirements, toDocBlocks } from "./doc-writer.feature";

describe("doc-writer pure helpers", () => {
  it("picks policy requirements by clause code or subject keyword", () => {
    const reqs = [
      { code: "4.1", subject: "Understanding the organization" },
      { code: "5.2", subject: "Policy" },
      { code: "5.2.1", subject: "Establishing the quality policy" },
      { code: "A.5.1", subject: "Policies for information security" },
      { code: "7.5", subject: "Documented information" },
      { code: "8.1", subject: "Operational planning" },
    ];
    expect(pickRequirements(reqs, ["polic"], /^(A\.)?5\.[123](\.|$)/).map((r) => r.code)).toEqual(["5.2", "5.2.1", "A.5.1"]);
    expect(pickRequirements(reqs, ["documented"]).map((r) => r.code)).toEqual(["7.5"]);
    expect(pickRequirements(reqs, ["ab"])).toEqual([]); // short keywords ignored
    expect(pickRequirements(reqs, ["o"], /./, 2)).toHaveLength(2);
  });

  it("extracts significant title keywords", () => {
    expect(keywordsOf("Supplier Evaluation Procedure")).toEqual(["supplier", "evaluation"]);
  });

  it("limits a summary to n sentences", () => {
    expect(firstSentences("One. Two! Three? Four.", 3)).toBe("One. Two! Three?");
    expect(firstSentences("No terminator", 3)).toBe("No terminator");
  });

  it("validates block kinds and normalises to the editor's block shape", () => {
    const blocks = toDocBlocks([
      { kind: "h1", text: "# Purchasing Procedure" },
      { kind: "p", text: "Line one\n\nLine two" },
      { kind: "ol", items: ["1. Raise request", "2) Approve", " "] },
      { kind: "ul", text: "- QA — checks\n- Buyer — orders" },
      { kind: "table", text: "not supported" },
      { kind: "image", text: "x" },
      { kind: "h2", text: "  " },
      { kind: "divider" },
    ]);
    expect(blocks).toEqual([
      { kind: "h1", text: "Purchasing Procedure" },
      { kind: "p", lines: ["Line one", "Line two"] },
      { kind: "ol", items: ["Raise request", "Approve"] },
      { kind: "ul", items: ["QA — checks", "Buyer — orders"] },
      { kind: "divider" },
    ]);
  });
});
