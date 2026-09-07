import { describe, it, expect } from "vitest";
import { ISIC } from "./isic";
import { NACE } from "./nace";
import { KBLI } from "./kbli";
import { ISCEDF } from "./iscedf";

const tally = (values: (string | number)[]) =>
  values.reduce<Record<string, number>>((acc, v) => ({ ...acc, [String(v)]: (acc[String(v)] ?? 0) + 1 }), {});

/**
 * The four classification trees are generated verbatim from OD's js/ sources,
 * so they keep OD's own encoding: ISIC's string level enum with a null root
 * (js/isic-rev4.js:4) and the 0-based `lv` / `parent:""` / `isic:"isic-<code>"`
 * shape of NACE, KBLI and ISCED-F (js/nace.js:4, js/kbli-id.js:4, js/iscedf.js:3).
 */
describe("OD classification datasets keep OD's record encoding", () => {
  it("ISIC uses the section|division|group|class enum with a null root", () => {
    expect(ISIC).toHaveLength(766);
    expect(tally(ISIC.map((n) => n.level))).toEqual({ section: 21, division: 88, group: 238, class: 419 });
    expect(ISIC[0]).toEqual({ code: "A", label: "Agriculture, forestry and fishing", level: "section", parent: null });
    expect(ISIC.filter((n) => n.parent === null)).toHaveLength(21);
  });

  it("NACE uses 0-based `lv`, an empty-string root and the prefixed ISIC node id", () => {
    expect(NACE).toHaveLength(996);
    expect(tally(NACE.map((n) => n.lv))).toEqual({ 0: 21, 1: 88, 2: 272, 3: 615 });
    expect(NACE[0]).toEqual({ code: "A", label: "Agriculture, Forestry And Fishing", lv: 0, parent: "", isic: "isic-A" });
    expect(NACE.every((n) => n.isic.startsWith("isic-"))).toBe(true);
    expect(NACE.filter((n) => n.parent === "")).toHaveLength(21);
  });

  it("KBLI uses 0-based `lv`, an empty-string root and the prefixed ISIC node id", () => {
    expect(KBLI).toHaveLength(2443);
    expect(tally(KBLI.map((n) => n.lv))).toEqual({ 0: 21, 1: 88, 2: 240, 3: 520, 4: 1574 });
    expect(KBLI[0]).toEqual({ code: "A", label: "Pertanian, Kehutanan dan Perikanan", lv: 0, parent: "", isic: "isic-A" });
    expect(KBLI.every((n) => n.isic.startsWith("isic-"))).toBe(true);
    expect(KBLI.filter((n) => n.parent === "")).toHaveLength(21);
  });

  it("ISCED-F uses 0-based `lv` and an empty-string root", () => {
    expect(ISCEDF).toHaveLength(116);
    expect(tally(ISCEDF.map((n) => n.lv))).toEqual({ 0: 11, 1: 28, 2: 77 });
    expect(ISCEDF[0]).toEqual({ code: "00", label: "Generic programmes and qualifications", lv: 0, parent: "" });
    expect(ISCEDF.filter((n) => n.parent === "")).toHaveLength(11);
  });

  it("every non-root parent resolves to a code in its own tree", () => {
    for (const tree of [ISIC as { code: string; parent: string | null }[], NACE, KBLI, ISCEDF]) {
      const codes = new Set(tree.map((n) => n.code));
      expect(tree.filter((n) => n.parent && !codes.has(n.parent))).toEqual([]);
    }
  });
});
