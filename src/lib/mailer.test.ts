import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockEnv, transportSend, createTransport } = vi.hoisted(() => {
  (globalThis as { __SKIP_DB_SETUP__?: boolean }).__SKIP_DB_SETUP__ = true;
  const transportSend = vi.fn();
  return {
    mockEnv: {} as Record<string, unknown>,
    transportSend,
    createTransport: vi.fn(() => ({ sendMail: transportSend })),
  };
});
vi.mock("../config/env", () => ({ env: mockEnv }));
vi.mock("nodemailer", () => ({ default: { createTransport } }));

import { sendMail, testOutbox } from "./mailer";

const msg = { to: "a@x.io", subject: "Hello", text: "secret link https://app/activate?token=abc", html: "<p>hi</p>" };

describe("sendMail", () => {
  beforeEach(() => {
    for (const k of Object.keys(mockEnv)) delete mockEnv[k];
    transportSend.mockReset();
    testOutbox.length = 0;
  });

  it("sends through the SMTP transport configured from env", async () => {
    Object.assign(mockEnv, { NODE_ENV: "production", SMTP_HOST: "smtp.x.io", SMTP_PORT: 465, SMTP_SECURE: true, SMTP_USER: "u", SMTP_PASS: "p", MAIL_FROM: "Vibes <no-reply@x.io>" });
    transportSend.mockResolvedValueOnce({});
    await expect(sendMail(msg)).resolves.toBe(true);
    expect(createTransport).toHaveBeenCalledWith({ host: "smtp.x.io", port: 465, secure: true, auth: { user: "u", pass: "p" } });
    expect(transportSend).toHaveBeenCalledWith({ from: "Vibes <no-reply@x.io>", ...msg });
  });

  it("resolves false and logs only recipient + subject when the transport fails", async () => {
    Object.assign(mockEnv, { NODE_ENV: "production", SMTP_HOST: "smtp.x.io" });
    transportSend.mockRejectedValueOnce(Object.assign(new Error("boom"), { code: "EAUTH" }));
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(sendMail(msg)).resolves.toBe(false);
    const logged = err.mock.calls.flat().join(" ");
    expect(logged).toContain("a@x.io");
    expect(logged).toContain("Hello");
    expect(logged).not.toContain("token=abc");
    err.mockRestore();
  });

  it("captures mail in testOutbox under NODE_ENV=test, even with SMTP_HOST set", async () => {
    Object.assign(mockEnv, { NODE_ENV: "test", SMTP_HOST: "smtp.x.io" });
    await expect(sendMail(msg)).resolves.toBe(true);
    expect(testOutbox).toEqual([msg]);
    expect(transportSend).not.toHaveBeenCalled();
  });

  it("prints the mail (with body) in development without SMTP_HOST", async () => {
    Object.assign(mockEnv, { NODE_ENV: "development" });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    await expect(sendMail(msg)).resolves.toBe(true);
    expect(log.mock.calls.flat().join(" ")).toContain("token=abc");
    log.mockRestore();
  });

  it("never prints the body in production without SMTP_HOST, and reports failure", async () => {
    Object.assign(mockEnv, { NODE_ENV: "production" });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await expect(sendMail(msg)).resolves.toBe(false);
    expect([...log.mock.calls, ...err.mock.calls].flat().join(" ")).not.toContain("token=abc");
    log.mockRestore();
    err.mockRestore();
  });
});
