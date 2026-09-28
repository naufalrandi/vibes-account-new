import { describe, expect, it } from "vitest";
import { buildAnswerPrompt, finalizeAnswer, NOT_COVERED, type KbSource } from "./kbAssistant.context";

const sources: KbSource[] = [
  { title: "Reset your password", summary: "Self-service reset", content: "Use Forgot password.", ref: { articleId: "a1" } },
  { title: "Invoices", content: "x".repeat(5000), ref: { articleId: "a2" } },
];
const cite = (s: KbSource) => ({ articleId: s.ref.articleId, title: s.title });

describe("kb-assistant context", () => {
  it("numbers sources from 1 and truncates long ones", () => {
    const p = buildAnswerPrompt("How to reset?", sources, "Ticket TKT-1");
    expect(p).toContain("Question: How to reset?");
    expect(p).toContain("Context:\nTicket TKT-1");
    expect(p).toContain("[1] Reset your password — Self-service reset Use Forgot password.");
    expect(p).toContain("[2] Invoices");
    expect(p).toContain("truncated");
  });

  it("keeps only citations to known sources, accepting [n] spelling", () => {
    const out = finalizeAnswer({ answer: " Use it [1]. ", answered: true, sourceIds: ["[1]", "1", "9", "abc"] }, sources, cite);
    expect(out).toEqual({ answer: "Use it [1].", answered: true, citations: [{ articleId: "a1", title: "Reset your password" }] });
  });

  it("drops an answer that cites nothing", () => {
    const out = finalizeAnswer({ answer: "Invented", answered: true, sourceIds: [] }, sources, cite);
    expect(out).toEqual({ answer: NOT_COVERED, answered: false, citations: [] });
  });

  it("keeps the model's own not-covered wording", () => {
    const out = finalizeAnswer({ answer: "The KB has nothing on refunds.", answered: false, sourceIds: ["1"] }, sources, cite);
    expect(out).toEqual({ answer: "The KB has nothing on refunds.", answered: false, citations: [] });
  });
});
