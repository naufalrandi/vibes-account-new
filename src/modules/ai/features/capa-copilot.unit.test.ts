import { describe, expect, it } from "vitest";
import type { RecordView } from "../../implementation/implementation.service";
import { findSimilar, recordForPrompt } from "./capa-copilot.context";

const rec = (id: string, title: string, data: Record<string, unknown> = {}, orgId = "o1"): RecordView => ({
  id, orgId, module: "nonconformities", code: `NC-${id}`, title, status: "Open", owner: null, data,
  elementId: null, frameworks: [], createdAt: new Date(0), updatedAt: new Date(0),
});

describe("capa-copilot context builders", () => {
  it("finds similar past records by text overlap, best first, and drops unrelated ones", () => {
    const target = rec("1", "Calibration of pressure gauge overdue", { description: "Pressure gauge calibration certificate expired in lab 2" });
    const peers = [
      rec("2", "Invoice paid late", { description: "Supplier invoice payment delayed" }),
      rec("3", "Pressure gauge calibration expired", { description: "Gauge calibration certificate expired" }),
      rec("4", "Lab 2 thermometer calibration overdue", { description: "Calibration certificate missing" }),
    ];
    expect(findSimilar(target, peers).map((r) => r.id)).toEqual(["3", "4"]);
  });

  it("builds the prompt record without activity/comments and with PII redacted", () => {
    const out = recordForPrompt(rec("1", "NC", { description: "Call budi@example.com on +62 812-3456-7890", activity: [{ x: 1 }], comments: ["c"] }));
    expect(out).toContain("[redacted]");
    expect(out).not.toContain("budi@example.com");
    expect(out).not.toContain("activity");
    expect(out).not.toContain("comments");
  });
});
