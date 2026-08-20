import { describe, it, expect } from "vitest";
import {
  BASE_SKILLS, SKILL_LIBRARY_HARD, SKILL_LIBRARY_SOFT, TRAINING_LIBRARY, SKILL_TOPICS,
  skillTopic, skillDescription, trainingDescription,
} from "./skillLibrary";

const lower = (arr: readonly string[]) => arr.map((s) => s.toLowerCase());
const uniqueCaseInsensitive = (arr: readonly string[]) => new Set(lower(arr)).size === arr.length;

describe("compSkillLib() port — hard/soft skill library counts (index.html:13409-13441)", () => {
  it("has exactly 172 unique hard skill names and 116 unique soft skill names (288 total)", () => {
    expect(SKILL_LIBRARY_HARD).toHaveLength(172);
    expect(SKILL_LIBRARY_SOFT).toHaveLength(116);
    expect(SKILL_LIBRARY_HARD.length + SKILL_LIBRARY_SOFT.length).toBe(288);
  });

  it("is case-insensitively de-duplicated within each list, and hard/soft never overlap", () => {
    expect(uniqueCaseInsensitive(SKILL_LIBRARY_HARD)).toBe(true);
    expect(uniqueCaseInsensitive(SKILL_LIBRARY_SOFT)).toBe(true);
    const hardSet = new Set(lower(SKILL_LIBRARY_HARD));
    expect(SKILL_LIBRARY_SOFT.some((s) => hardSet.has(s.toLowerCase()))).toBe(false);
  });

  it("carries known entries from HARD/HARD2 and SOFT/SOFT2 verbatim", () => {
    expect(SKILL_LIBRARY_HARD).toContain("Audit planning");
    expect(SKILL_LIBRARY_HARD).toContain("Audit nonconformity root cause analysis"); // last HARD2 audit entry
    expect(SKILL_LIBRARY_HARD).toContain("Demand forecasting"); // last HARD2 entry overall
    expect(SKILL_LIBRARY_SOFT).toContain("Communication");
    expect(SKILL_LIBRARY_SOFT).toContain("Inclusive behaviour"); // last SOFT2 entry
  });
});

describe("db.compSkills base 8 (sk1..sk8, index.html:16741-16750)", () => {
  it("has exactly 8 base skills — 4 hard, 4 soft — with OD's own methods arrays", () => {
    expect(BASE_SKILLS).toHaveLength(8);
    expect(BASE_SKILLS.filter((s) => s.type === "hard")).toHaveLength(4);
    expect(BASE_SKILLS.filter((s) => s.type === "soft")).toHaveLength(4);
    const byName = Object.fromEntries(BASE_SKILLS.map((s) => [s.name, s]));
    expect(byName["Internal Auditing"]).toMatchObject({ type: "hard", methods: ["Written exam", "Practical assessment"] });
    expect(byName["Technical Report Writing"]).toMatchObject({ type: "hard", methods: ["Portfolio review"] });
    expect(byName["Stakeholder Management"]).toMatchObject({ type: "soft", methods: ["Interview"] });
  });

  it("names collide case-insensitively with 2 hard and 4 soft library entries (net-new: 2 hard, 0 soft)", () => {
    // This is the exact OD top-up outcome: the base skill's own casing wins,
    // and the colliding library entry is simply skipped, not duplicated.
    const hardLower = new Set(lower(SKILL_LIBRARY_HARD));
    const softLower = new Set(lower(SKILL_LIBRARY_SOFT));
    const hardCollisions = BASE_SKILLS.filter((s) => s.type === "hard" && hardLower.has(s.name.toLowerCase()));
    const softCollisions = BASE_SKILLS.filter((s) => s.type === "soft" && softLower.has(s.name.toLowerCase()));
    expect(hardCollisions.map((s) => s.name)).toEqual(["Risk Assessment", "Statistical Process Control"]);
    expect(softCollisions.map((s) => s.name)).toEqual(["Communication", "Leadership", "Problem Solving", "Stakeholder Management"]);
    // So the fully-seeded table (base 8 + top-up) totals 174 hard + 116 soft = 290 rows,
    // not a naive 8 + 288 = 296 — see competenceSkillLibrarySeed.integration.test.ts.
  });
});

describe("db.compTraining (index.html:16751-16759): 21 training courses", () => {
  it("is 6 standards x 3 tiers (18, source SP) + 3 fixed courses = 21", () => {
    expect(TRAINING_LIBRARY).toHaveLength(21);
    const sp = TRAINING_LIBRARY.filter((t) => t.source === "SP");
    const tenant = TRAINING_LIBRARY.filter((t) => t.source === "Tenant");
    expect(sp).toHaveLength(19); // 18 standard x tier + "Risk Management Fundamentals"
    expect(tenant).toHaveLength(2); // "Data Privacy Awareness" + "Root Cause Analysis"
    expect(tenant.map((t) => t.name).sort()).toEqual(["Data Privacy Awareness", "Root Cause Analysis"]);
    expect(TRAINING_LIBRARY.map((t) => t.name)).toContain("ISO/IEC 27701 Lead Implementer");
    expect(TRAINING_LIBRARY.map((t) => t.name)).toContain("Risk Management Fundamentals");
    // All 21 names unique.
    expect(new Set(TRAINING_LIBRARY.map((t) => t.name)).size).toBe(21);
  });
});

describe("SKILL_TOPICS / skillTopic() classifier (index.html:17834-17853)", () => {
  it("has exactly 12 topics in OD's display order", () => {
    expect(SKILL_TOPICS).toHaveLength(12);
    expect(SKILL_TOPICS[0]).toBe("Audit & Assurance");
    expect(SKILL_TOPICS[SKILL_TOPICS.length - 1]).toBe("Other");
  });

  it("classifies hard skills by keyword (first-match-wins branch order)", () => {
    expect(skillTopic({ name: "Audit planning", type: "hard" })).toBe("Audit & Assurance");
    expect(skillTopic({ name: "Risk assessment", type: "hard" })).toBe("Risk Management");
    expect(skillTopic({ name: "Vulnerability management", type: "hard" })).toBe("Information Security & Privacy");
    expect(skillTopic({ name: "Hazard identification", type: "hard" })).toBe("Health, Safety & Environment");
    expect(skillTopic({ name: "Statistical analysis", type: "hard" })).toBe("Data & Technology");
    expect(skillTopic({ name: "Document control", type: "hard" })).toBe("Standards & Compliance");
    expect(skillTopic({ name: "Supplier evaluation", type: "hard" })).toBe("Operations & Quality");
  });

  it("classifies soft skills by keyword", () => {
    expect(skillTopic({ name: "Active listening", type: "soft" })).toBe("Communication");
    expect(skillTopic({ name: "Leadership", type: "soft" })).toBe("Leadership & Teamwork");
    expect(skillTopic({ name: "Curiosity", type: "soft" })).toBe("Professional Conduct");
    expect(skillTopic({ name: "Self-management", type: "soft" })).toBe("Personal Effectiveness");
  });
});

describe("skillDescription() / trainingDescription() (compSkillDesc/trainDesc, index.html:17798-17822)", () => {
  it("generates a template description containing the skill name", () => {
    expect(skillDescription("Audit planning", "hard")).toMatch(/^Carrying out Audit planning/);
    expect(skillDescription("Vulnerability management", "hard")).toMatch(/^Applying Vulnerability management/);
    expect(skillDescription("Active listening", "soft")).toMatch(/^Using Active listening/);
    expect(skillDescription("Self-management", "soft")).toMatch(/^Practising Self-management/);
  });

  it("generates the exact fixed descriptions for the 3 non-standard courses", () => {
    expect(trainingDescription("Risk Management Fundamentals")).toBe(
      "Foundational training on identifying, analysing, evaluating and treating risk using a structured, criteria-based approach.",
    );
    expect(trainingDescription("Data Privacy Awareness")).toContain("personal-data protection");
    expect(trainingDescription("Root Cause Analysis")).toContain("5 Whys");
  });

  it("generates tier-specific descriptions for standard x tier courses", () => {
    expect(trainingDescription("ISO 9001 Awareness / Foundation")).toMatch(/Introductory training on ISO 9001/);
    expect(trainingDescription("ISO/IEC 27001 Lead Auditor")).toMatch(/Certified-level training.*ISO\/IEC 27001/);
    expect(trainingDescription("ISO 22301 Lead Implementer")).toMatch(/Practitioner training.*ISO 22301/);
  });
});
