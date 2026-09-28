import { describe, expect, it } from "vitest";
import { ROLE_SUGGESTIONS } from "../../reference/reference.data";
import {
  closestArchetypes, fewShotFromBank, newLines, sanitizeGrades, sanitizeRoleDraft, toAwarenessQuestions, toExamQuestions,
} from "./competence-assist.context";

describe("competence-assist context", () => {
  it("newLines drops blanks, repeats and lines already in the draft", () => {
    expect(newLines([" Plan audits ", "plan audits", "", "Old line.", "Report  results"], ["old line."])).toEqual(["Plan audits", "Report results"]);
  });

  it("closestArchetypes ranks the curated role that matches the name first", () => {
    expect(closestArchetypes("QA Manager", ROLE_SUGGESTIONS)[0]?.name).toBe("Quality Manager");
    expect(closestArchetypes("zzz", ROLE_SUGGESTIONS)).toEqual([]);
  });

  it("sanitizeRoleDraft never duplicates the draft and maps skills/codes onto the libraries", () => {
    const out = sanitizeRoleDraft(
      {
        description: "Owns quality.",
        responsibilities: ["Lead audits.", "lead audits.", "Existing duty"],
        authorities: ["Stop the line."],
        skills: [{ name: "internal auditing", level: 7 }, { name: "Juggling", level: 0 }, { name: "Internal Auditing", level: 2 }],
        eduFields: ["0413", "9999", "0413"],
        expReqs: [{ sector: "c", years: 3.4 }, { sector: "ZZ", years: 1 }],
      },
      { description: "owns quality.", responsibilities: ["existing duty"] },
      { skillNames: ["Internal Auditing"], eduCodes: new Set(["0413"]), sectorCodes: new Set(["C"]) },
    );
    expect(out).toEqual({
      description: "",
      responsibilities: ["Lead audits."],
      authorities: ["Stop the line."],
      skills: [{ name: "Internal Auditing", level: 4, inLibrary: true }, { name: "Juggling", level: 1, inLibrary: false }],
      eduFields: ["0413"],
      expReqs: [{ sector: "C", years: "3" }],
    });
  });

  it("toExamQuestions keeps only well-formed items of the requested type", () => {
    const items = [
      { type: "single", question: "Q1?", options: [{ text: "a", correct: true }, { text: "b", correct: false }], sourceIds: ["r1", "bogus"] },
      { type: "single", question: "Two correct?", options: [{ text: "a", correct: true }, { text: "b", correct: true }] },
      { type: "multi", question: "Q2?", options: [{ text: "a", correct: true }, { text: "b", correct: true }] },
      { type: "tf", question: "Q3?", answerTrue: false },
      { type: "short", question: "Explain.", modelAnswer: "Because." },
      { type: "short", question: "No model." },
      { type: "single", question: "q1?", options: [{ text: "a", correct: true }, { text: "b", correct: false }] },
      { type: "single", question: "Existing", options: [{ text: "a", correct: true }, { text: "b", correct: false }] },
    ];
    const mcq = toExamQuestions(items, "mcq", new Set(["r1"]), ["existing"]);
    expect(mcq.map((q) => [q.type, q.text])).toEqual([["single", "Q1?"], ["multi", "Q2?"], ["truefalse", "Q3?"]]);
    expect(mcq[0].sourceIds).toEqual(["r1"]);
    expect(mcq[0].options?.every((o) => o.id)).toBe(true);
    expect(mcq[2].answerTrue).toBe(false);
    expect(toExamQuestions(items, "short", new Set()).map((q) => q.model)).toEqual(["Because."]);
  });

  it("fewShotFromBank picks bank questions of the wanted type, nearest level first", () => {
    const levels = {
      "1": [{ t: "single" as const, q: "a", p: 1 }, { t: "short" as const, q: "b", p: 2, m: "x" }],
      "2": [{ t: "tf" as const, q: "c", p: 1, a: true }],
    };
    expect(fewShotFromBank(levels, 2, "mcq", 2).map((q) => q.q)).toEqual(["c", "a"]);
    expect(fewShotFromBank(levels, 2, "short").map((q) => q.q)).toEqual(["b"]);
    expect(fewShotFromBank(undefined, 1, "mixed")).toEqual([]);
  });

  it("sanitizeGrades clamps to the question's points and ignores unknown or repeated ids", () => {
    const out = sanitizeGrades(
      [{ questionId: "q2", suggestedScore: 9, rationale: " Covers all. " }, { questionId: "x", suggestedScore: 1, rationale: "" }, { questionId: "q1", suggestedScore: -1, rationale: "Empty" }, { questionId: "q1", suggestedScore: 1, rationale: "dup" }],
      [{ id: "q1", points: 2 }, { id: "q2", points: 3 }],
    );
    expect(out).toEqual([
      { questionId: "q1", suggestedScore: 0, maxScore: 2, rationale: "Empty" },
      { questionId: "q2", suggestedScore: 3, maxScore: 3, rationale: "Covers all." },
    ]);
  });

  it("toAwarenessQuestions builds the quiz shape and drops broken questions", () => {
    const out = toAwarenessQuestions([
      { type: "single", question: "Report phishing to?", options: [{ text: "IT", correct: true }, { text: "Nobody", correct: false }] },
      { type: "single", question: "No answer", options: [{ text: "a", correct: false }, { text: "b", correct: false }] },
      { type: "truefalse", question: "Share passwords?", answerTrue: false },
      { type: "truefalse", question: "Missing key" },
    ]);
    expect(out.map((q) => [q.type, q.text, q.points])).toEqual([["single", "Report phishing to?", 1], ["truefalse", "Share passwords?", 1]]);
    expect(out[0].options?.map((o) => o.correct)).toEqual([true, false]);
  });
});
