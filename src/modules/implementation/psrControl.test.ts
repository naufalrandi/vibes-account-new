import { validatePsrSpec, type PsrSpecAttribute } from "./psrControl";

const ATTRS: PsrSpecAttribute[] = [
  { id: "part_no", name: "Part Number", type: "text", required: true },
  { id: "length", name: "Length", type: "number" },
  { id: "material", name: "Material", type: "select", options: ["Steel", "Aluminium"] },
  { id: "rohs", name: "RoHS Compliant", type: "boolean" },
  { id: "summary", name: "Summary", type: "textarea" },
];

describe("validatePsrSpec", () => {
  it("accepts a fully valid spec", () => {
    expect(() =>
      validatePsrSpec(ATTRS, { part_no: "SEN-X-100", length: 80, material: "Steel", rohs: true, summary: "ok" }),
    ).not.toThrow();
  });

  it("accepts an optional attribute left empty", () => {
    expect(() => validatePsrSpec(ATTRS, { part_no: "SEN-X-100" })).not.toThrow();
  });

  it("rejects a missing required attribute", () => {
    expect(() => validatePsrSpec(ATTRS, { length: 80 })).toThrow(/Part Number.*required/);
  });

  it("rejects a non-numeric value for a number attribute", () => {
    expect(() => validatePsrSpec(ATTRS, { part_no: "X", length: "not-a-number" })).toThrow(/Length.*number/);
  });

  it("rejects a select value outside the template's options", () => {
    expect(() => validatePsrSpec(ATTRS, { part_no: "X", material: "Titanium" })).toThrow(/Material.*one of/);
  });

  it("accepts boolean values as real booleans or yes/no strings", () => {
    expect(() => validatePsrSpec(ATTRS, { part_no: "X", rohs: false })).not.toThrow();
    expect(() => validatePsrSpec(ATTRS, { part_no: "X", rohs: "yes" })).not.toThrow();
  });

  it("rejects a non-boolean value for a boolean attribute", () => {
    expect(() => validatePsrSpec(ATTRS, { part_no: "X", rohs: "maybe" })).toThrow(/RoHS Compliant.*boolean/);
  });
});
