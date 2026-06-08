import { describe, it, expect } from "vitest";
import { parsePageQuery, paginate } from "./pagination";

const rows = Array.from({ length: 25 }, (_, i) => i + 1);

describe("parsePageQuery", () => {
  it("returns limit null (return-all) when no limit is given", () => {
    expect(parsePageQuery({})).toEqual({ page: 1, limit: null });
  });

  it("parses page + limit and clamps to sane bounds", () => {
    expect(parsePageQuery({ page: "2", limit: "10" })).toEqual({ page: 2, limit: 10 });
    expect(parsePageQuery({ page: "0", limit: "0" })).toEqual({ page: 1, limit: 1 });
    expect(parsePageQuery({ page: "x", limit: "9999" })).toEqual({ page: 1, limit: 200 });
  });
});

describe("paginate", () => {
  it("returns everything (backward compatible) when no limit is passed", () => {
    const { items, meta } = paginate(rows, {});
    expect(items).toHaveLength(25);
    expect(meta).toEqual({ page: 1, limit: 25, total: 25 });
  });

  it("slices the requested page and reports real meta", () => {
    const { items, meta } = paginate(rows, { page: "2", limit: "10" });
    expect(items).toEqual([11, 12, 13, 14, 15, 16, 17, 18, 19, 20]);
    expect(meta).toEqual({ page: 2, limit: 10, total: 25 });
  });

  it("handles the trailing partial page", () => {
    const { items } = paginate(rows, { page: "3", limit: "10" });
    expect(items).toEqual([21, 22, 23, 24, 25]);
  });
});
