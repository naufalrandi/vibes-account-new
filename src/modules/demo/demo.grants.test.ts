import { describe, expect, it } from "vitest";
import { demoAllowsFrameworks, demoAllowsTesting, demoAllowsCalibration, demoActionKeysForModules } from "./demo.grants";
import { ACTIONS } from "../iam/actions.catalog";

/**
 * Task item 6 (2026-08-18 gap analysis): "Assessment & Gap Analysis" is a
 * `DEMO_MODULES` option (fe-vibes-new `DemoModals.tsx`) with no OD-native
 * counterpart, and previously matched neither `demoAllowsFrameworks` here nor
 * `navConfig.ts`'s mirror — a requester choosing it got CORE-only grants
 * (`demoActionKeysForModules` = `CORE_ACTION_KEYS` only). OD's demo gating
 * (index.html:4826-4836) keys on framework-implementation entitlement, so it
 * now belongs in the same FW matcher set as "Framework Management"/"Not sure yet".
 */
describe("demoAllowsFrameworks", () => {
  it("matches 'Assessment & Gap Analysis' (the previously-unmatched DEMO_MODULES option)", () => {
    expect(demoAllowsFrameworks(["Assessment & Gap Analysis"])).toBe(true);
  });

  it("still matches the OD-native module choices", () => {
    expect(demoAllowsFrameworks(["Framework Management"])).toBe(true);
    expect(demoAllowsFrameworks(["Not sure yet"])).toBe(true);
  });

  it("does not match lab-only module choices", () => {
    expect(demoAllowsFrameworks(["Testing Services"])).toBe(false);
    expect(demoAllowsFrameworks(["Calibration Services"])).toBe(false);
    expect(demoAllowsFrameworks(["Laboratory Services"])).toBe(false);
  });

  it("leaves the lab matchers unaffected by the fix", () => {
    expect(demoAllowsTesting(["Assessment & Gap Analysis"])).toBe(false);
    expect(demoAllowsCalibration(["Assessment & Gap Analysis"])).toBe(false);
  });

  it("grants the Framework Implementation action set, not just CORE, for 'Assessment & Gap Analysis'", () => {
    const keys = demoActionKeysForModules(["Assessment & Gap Analysis"]);
    expect(keys).toContain(ACTIONS.MS_READ);
    expect(keys).toContain(ACTIONS.IAUDIT_READ);
    expect(keys).toContain(ACTIONS.COMPETENCE_READ);
    // Lab actions stay ungranted — this module choice implies frameworks only.
    expect(keys).not.toContain(ACTIONS.LIMS_READ);
  });
});
