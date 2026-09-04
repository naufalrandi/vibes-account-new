import { describe, expect, it } from "vitest";
import { ONBOARD_TEMPLATE, onboardTemplateFor, personCategory } from "./personnelOnboarding.service";

describe("ONBOARD_TEMPLATE — OD parity", () => {
  it("matches OD's fourteen tasks, in order, with their groups and required flags", () => {
    expect(ONBOARD_TEMPLATE.map((t) => [t.key, t.label, t.group, t.required])).toEqual([
      ["contract", "Signed contract / agreement on file", "Documentation", true],
      ["idtax", "ID & tax documents collected", "Documentation", true],
      ["bank", "Bank / payment details confirmed", "Documentation", true],
      ["emergency", "Emergency contact recorded", "Documentation", false],
      ["email", "Email account created", "Accounts & Access", true],
      ["access", "System access & permissions granted", "Accounts & Access", true],
      ["badge", "Building / badge access issued", "Accounts & Access", false],
      ["laptop", "Laptop / workstation issued", "Equipment", false],
      ["comms", "Phone / SIM / comms set up", "Equipment", false],
      ["welcome", "Welcome & orientation session", "Orientation", true],
      ["policy", "Policy & code-of-conduct acknowledgement", "Orientation", true],
      ["manager1on1", "Manager 1:1 / expectations set", "Orientation", false],
      ["role", "Role assigned", "Role & Competence", true],
      ["competence", "Competence baseline assessment scheduled", "Role & Competence", false],
    ]);
  });

  it("marks exactly OD's three internal-only tasks", () => {
    expect(ONBOARD_TEMPLATE.filter((t) => t.internalOnly).map((t) => t.key)).toEqual(["badge", "comms", "welcome"]);
  });

  it("drops the internal-only tasks for External personnel and keeps them otherwise", () => {
    expect(onboardTemplateFor(false)).toHaveLength(14);
    const external = onboardTemplateFor(true);
    expect(external).toHaveLength(11);
    expect(external.map((t) => t.key)).not.toContain("badge");
    expect(external.map((t) => t.key)).not.toContain("comms");
    expect(external.map((t) => t.key)).not.toContain("welcome");
  });

  it("derives External only for Contractors — OD personCategory", () => {
    expect(personCategory("Contractor")).toBe("External");
    for (const t of ["Permanent", "Fixed Duration", "Intern", null, undefined]) {
      expect(personCategory(t)).toBe("Internal");
    }
  });
});
