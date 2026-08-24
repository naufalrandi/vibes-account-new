import { describe, expect, it } from "vitest";
import { resolveSaasSubState, resolveSaasWsState, resolveSaasAccess, pickRepresentativeWorkspace } from "./lifecycle.service";

const DAY_MS = 86400000;
const NOW = Date.parse("2026-08-24T00:00:00.000Z");
const daysAgo = (n: number) => new Date(NOW - n * DAY_MS);
const daysFromNow = (n: number) => new Date(NOW + n * DAY_MS);

describe("resolveSaasSubState (1:1 with OD's saasSubState, app.html:5977)", () => {
  it("treats a null subscription as Active (no SaaS record -> unrestricted)", () => {
    expect(resolveSaasSubState(null, NOW)).toEqual({ state: "Active" });
  });

  it("treats a subscription with no renewalDate as Active", () => {
    expect(resolveSaasSubState({ status: "Active", renewalDate: null }, NOW)).toEqual({ state: "Active" });
  });

  it("is Active while now <= renewalDate", () => {
    const r = resolveSaasSubState({ status: "Active", renewalDate: daysFromNow(5) }, NOW);
    expect(r.state).toBe("Active");
    expect(r.daysLeft).toBe(5);
  });

  it("is Grace 1 for the first 30 days past renewal", () => {
    const r1 = resolveSaasSubState({ status: "Active", renewalDate: daysAgo(1) }, NOW);
    expect(r1.state).toBe("Grace 1");
    expect(r1.phase).toBe("Read-only");

    const r30 = resolveSaasSubState({ status: "Active", renewalDate: daysAgo(30) }, NOW);
    expect(r30.state).toBe("Grace 1"); // boundary: now === g1

    const r31 = resolveSaasSubState({ status: "Active", renewalDate: daysAgo(31) }, NOW);
    expect(r31.state).toBe("Grace 2"); // one day past the g1 boundary
  });

  it("is Grace 2 for the following 30 days (30-60 days past renewal)", () => {
    const r = resolveSaasSubState({ status: "Active", renewalDate: daysAgo(45) }, NOW);
    expect(r.state).toBe("Grace 2");
    expect(r.phase).toBe("Locked");
  });

  it("is Archived after Grace 2 ends, until the 12-month retention window from Grace 1's end closes", () => {
    const r = resolveSaasSubState({ status: "Active", renewalDate: daysAgo(100) }, NOW);
    expect(r.state).toBe("Archived");
    expect(r.retentionEndsAt).toBeDefined();
  });

  it("is Purged once the retention window has closed", () => {
    const r = resolveSaasSubState({ status: "Active", renewalDate: daysAgo(500) }, NOW);
    expect(r.state).toBe("Purged");
  });

  it("status overrides (Purged, Provisioning) short-circuit the date math", () => {
    expect(resolveSaasSubState({ status: "Purged", renewalDate: daysFromNow(100) }, NOW).state).toBe("Purged");
    expect(resolveSaasSubState({ status: "Provisioning", renewalDate: null }, NOW).state).toBe("Provisioning");
  });
});

describe("resolveSaasWsState (1:1 with OD's saasWsState, app.html:5985)", () => {
  it("is Active with no workspace", () => {
    expect(resolveSaasWsState(null, null, NOW)).toBe("Active");
  });

  it("local Provisioning/Failed workspace status overrides the subscription state", () => {
    const sub = { status: "Active", renewalDate: daysAgo(45) }; // would otherwise be Grace 2 -> Locked
    expect(resolveSaasWsState({ status: "Provisioning" }, sub, NOW)).toBe("Provisioning");
    expect(resolveSaasWsState({ status: "Failed" }, sub, NOW)).toBe("Failed");
  });

  it("maps subscription state to workspace state for a normal (Active-status) workspace", () => {
    const cases: [number | null, string][] = [
      [5, "Active"], // 5 days left
      [-10, "Read-only"], // Grace 1
      [-45, "Locked"], // Grace 2
      [-100, "Archived"],
      [-500, "Archived"], // Purged sub -> Archived workspace (OD collapses both)
    ];
    for (const [daysOffset, expected] of cases) {
      const renewalDate = daysOffset === null ? null : new Date(NOW + daysOffset * DAY_MS);
      expect(resolveSaasWsState({ status: "Active" }, { status: "Active", renewalDate }, NOW)).toBe(expected);
    }
  });
});

describe("resolveSaasAccess (1:1 with OD's saasWsAccess, app.html:5988)", () => {
  it("full for Active only", () => {
    expect(resolveSaasAccess("Active")).toBe("full");
  });
  it("read for Read-only only", () => {
    expect(resolveSaasAccess("Read-only")).toBe("read");
  });
  it("none for every other state", () => {
    for (const s of ["Locked", "Archived", "Failed", "Provisioning"] as const) {
      expect(resolveSaasAccess(s)).toBe("none");
    }
  });
});

describe("pickRepresentativeWorkspace", () => {
  const ws = (product: string, daysAgoProvisioned: number) =>
    ({ product, provisionedAt: daysAgo(daysAgoProvisioned) }) as never;

  it("returns null for an empty list", () => {
    expect(pickRepresentativeWorkspace([])).toBeNull();
  });

  it("prefers the 'ms' product workspace", () => {
    const lab = ws("lab", 10);
    const ms = ws("ms", 5);
    expect(pickRepresentativeWorkspace([lab, ms])).toBe(ms);
  });

  it("falls back to the earliest-provisioned workspace when there is no 'ms' workspace", () => {
    const newer = ws("lab", 5);
    const older = ws("cab", 20);
    expect(pickRepresentativeWorkspace([newer, older])).toBe(older);
  });
});
