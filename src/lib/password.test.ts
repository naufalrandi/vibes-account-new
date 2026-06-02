import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword, isPasswordValid } from "./password";

describe("password", () => {
  it("hashes and verifies", async () => {
    const h = await hashPassword("Str0ngPass");
    expect(h).not.toBe("Str0ngPass");
    expect(await verifyPassword("Str0ngPass", h)).toBe(true);
    expect(await verifyPassword("wrong", h)).toBe(false);
  });

  it("enforces the policy", () => {
    expect(isPasswordValid("Str0ngPass")).toBe(true);
    expect(isPasswordValid("short")).toBe(false);
    expect(isPasswordValid("alllowercase1")).toBe(false);
    expect(isPasswordValid("ALLUPPER1")).toBe(false);
    expect(isPasswordValid("NoDigitsHere")).toBe(false);
  });
});
