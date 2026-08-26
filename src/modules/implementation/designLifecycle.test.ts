import { assertDesignTransition, DND_STAGES } from "./designLifecycle";

describe("assertDesignTransition", () => {
  it("allows staying at the same stage", () => {
    expect(() => assertDesignTransition("Concept", "Concept")).not.toThrow();
  });

  it("allows advancing exactly one stage", () => {
    expect(() => assertDesignTransition("Concept", "In Design")).not.toThrow();
    expect(() => assertDesignTransition("Design Review", "Verification")).not.toThrow();
  });

  it("rejects skipping ahead", () => {
    expect(() => assertDesignTransition("Concept", "Design Review")).toThrow(/one step at a time/);
    expect(() => assertDesignTransition("Concept", "Released")).toThrow(/one step at a time/);
  });

  it("rejects moving backward", () => {
    expect(() => assertDesignTransition("Verification", "In Design")).toThrow(/one step at a time/);
  });

  it("refuses to advance past the final stage", () => {
    const last = DND_STAGES[DND_STAGES.length - 1];
    expect(() => assertDesignTransition(last, "Concept")).toThrow(/one step at a time/);
  });

  it("leaves On Hold / Retired unrestricted in either direction", () => {
    expect(() => assertDesignTransition("Verification", "On Hold")).not.toThrow();
    expect(() => assertDesignTransition("On Hold", "Concept")).not.toThrow();
    expect(() => assertDesignTransition("Released", "Retired")).not.toThrow();
    expect(() => assertDesignTransition("Retired", "Design Review")).not.toThrow();
  });
});
