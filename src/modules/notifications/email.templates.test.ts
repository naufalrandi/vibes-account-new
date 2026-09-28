import { describe, expect, it } from "vitest";
import { activationEmail, escapeHtml, passwordResetEmail, poConfirmationEmail } from "./email.templates";

describe("email templates", () => {
  it("escapes HTML metacharacters", () => {
    expect(escapeHtml(`<a href="x">'&'</a>`)).toBe("&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  });

  it("puts the activation link in both parts", () => {
    const link = "https://app.example.com/activate?token=abc123";
    const m = activationEmail(link);
    expect(m.text).toContain(link);
    expect(m.html).toContain(`href="https://app.example.com/activate?token=abc123"`);
  });

  it("varies activation copy by variant and marks resends", () => {
    const tenant = activationEmail("https://a/activate?token=t", { variant: "tenant" });
    const partner = activationEmail("https://a/activate?token=t", { variant: "partner", resend: true });
    expect(tenant.subject).not.toBe(partner.subject);
    expect(partner.subject).toMatch(/^Reminder:/);
    expect(partner.text).toContain("replaces any activation link");
    expect(tenant.text).not.toContain("replaces any activation link");
  });

  it("escapes a hostile link and supplier name in HTML but keeps the text part verbatim", () => {
    const link = `https://a/po-confirm/PO-1?t="><script>`;
    const m = poConfirmationEmail(link, { code: "PO-1", supplierName: `<b>Evil & Co</b>` });
    expect(m.html).not.toContain("<script>");
    expect(m.html).not.toContain("<b>Evil");
    expect(m.html).toContain("&lt;b&gt;Evil &amp; Co&lt;/b&gt;");
    expect(m.text).toContain(link);
    expect(m.subject).toContain("PO-1");
  });

  it("builds the password reset email around its link", () => {
    const link = "https://app.example.com/reset-password?token=r1";
    const m = passwordResetEmail(link);
    expect(m.text).toContain(link);
    expect(m.html).toContain(link);
  });
});
