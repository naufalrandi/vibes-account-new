import { describe, expect, it, vi } from "vitest";
import { randomBytes } from "node:crypto";

vi.hoisted(() => {
  (globalThis as { __SKIP_DB_SETUP__?: boolean }).__SKIP_DB_SETUP__ = true;
});

import { open, seal } from "./secretBox";

const key = randomBytes(32);
const flip = (b64: string) => {
  const buf = Buffer.from(b64, "base64");
  buf[0] ^= 0x01;
  return buf.toString("base64");
};

describe("secretBox", () => {
  it("round-trips a secret and never stores it in the clear", () => {
    const sealed = seal("sk-ant-secret-value-1234", key);
    expect(sealed.ciphertext).not.toContain("secret");
    expect(open(sealed, key)).toBe("sk-ant-secret-value-1234");
  });

  it("uses a fresh IV per seal", () => {
    expect(seal("same", key).iv).not.toBe(seal("same", key).iv);
  });

  it("detects tampering with the ciphertext, IV or tag", () => {
    const sealed = seal("sk-test", key);
    expect(() => open({ ...sealed, ciphertext: flip(sealed.ciphertext) }, key)).toThrow();
    expect(() => open({ ...sealed, iv: flip(sealed.iv) }, key)).toThrow();
    expect(() => open({ ...sealed, tag: flip(sealed.tag) }, key)).toThrow();
  });

  it("refuses to open with the wrong key", () => {
    expect(() => open(seal("sk-test", key), randomBytes(32))).toThrow();
  });
});
