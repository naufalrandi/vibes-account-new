import { describe, expect, it } from "vitest";
import { queryCoverage, textSimilarity, tokens, topMatches } from "./triage.similarity";

describe("triage text similarity", () => {
  it("tokenizes without stopwords or short words", () => {
    expect([...tokens("The calibration of the Balance is overdue!")]).toEqual(["calibration", "balance", "overdue"]);
  });

  it("scores near-duplicates high and unrelated text zero", () => {
    expect(textSimilarity("Balance calibration overdue in lab 2", "Lab 2 balance calibration is overdue")).toBeGreaterThan(0.8);
    expect(textSimilarity("Balance calibration overdue", "Invoice address wrong")).toBe(0);
    expect(textSimilarity("", "anything")).toBe(0);
  });

  it("measures how much of a short query a long article covers", () => {
    expect(queryCoverage("reset password", "How to reset your password from the login page")).toBe(1);
    expect(queryCoverage("reset password invoice", "How to reset your password")).toBeCloseTo(2 / 3);
    expect(queryCoverage("the and", "anything")).toBe(0);
  });

  it("keeps matches above the threshold, best first, limited", () => {
    const out = topMatches([0.1, 0.9, 0.5, 0.7], (n) => n, 0.5, 2);
    expect(out.map((m) => m.item)).toEqual([0.9, 0.7]);
  });
});
