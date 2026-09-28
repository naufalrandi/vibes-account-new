import { describe, expect, it, vi } from "vitest";

const { sendMail } = vi.hoisted(() => {
  (globalThis as { __SKIP_DB_SETUP__?: boolean }).__SKIP_DB_SETUP__ = true;
  return { sendMail: vi.fn(async () => true) };
});
vi.mock("../../config/env", () => ({ env: { NODE_ENV: "test", APP_BASE_URL: "https://app.example.com" } }));
vi.mock("../../db/models", () => ({ Notification: {} }));
vi.mock("../../lib/mailer", () => ({ sendMail }));

import { hashToken } from "../../lib/tokens";
import { issueActivationToken, sendActivationInvite, sendPasswordReset, sendPoConfirmation } from "./notification.service";

const lastMail = () => (sendMail.mock.calls.at(-1) as unknown as [{ to: string; text: string }])[0];

describe("notification email contract", () => {
  it("issues a token whose stored field is the hash of the emailed raw value, expiring in 7 days", () => {
    const { raw, fields } = issueActivationToken();
    expect(fields.activationToken).toBe(hashToken(raw));
    expect(fields.activationToken).not.toBe(raw);
    const days = (fields.activationTokenExpiresAt.getTime() - Date.now()) / 86_400_000;
    expect(days).toBeGreaterThan(6.99);
    expect(days).toBeLessThanOrEqual(7);
  });

  it("links activation, reset and PO confirmation to the FE routes", async () => {
    await sendActivationInvite("a@x.io", "raw1", { variant: "tenant" });
    expect(lastMail().to).toBe("a@x.io");
    expect(lastMail().text).toContain("https://app.example.com/activate?token=raw1");

    await sendPasswordReset("b@x.io", "raw2");
    expect(lastMail().text).toContain("https://app.example.com/reset-password?token=raw2");

    await sendPoConfirmation("s@x.io", { code: "PO 7", token: "t/k" });
    expect(lastMail().text).toContain("https://app.example.com/po-confirm/PO%207?t=t%2Fk");
  });
});
