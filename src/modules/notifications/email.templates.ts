/**
 * Transactional email bodies: a plain-text part plus an HTML part in which
 * every interpolated value is escaped. Links are built by the caller
 * (notification.service.ts) from APP_BASE_URL.
 */
export interface EmailContent {
  subject: string;
  text: string;
  html: string;
}

export type ActivationVariant = "user" | "partner" | "tenant" | "registration" | "saas";

export const ACTIVATION_TTL_DAYS = 7;

const PRODUCT = "Vibes";

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** One call-to-action email: intro paragraphs, a button, then closing lines. */
function compose(subject: string, intro: string[], cta: { label: string; href: string }, outro: string[]): EmailContent {
  const text = [...intro, `${cta.label}: ${cta.href}`, ...outro].join("\n\n");
  const p = (s: string) => `<p style="margin:0 0 16px">${escapeHtml(s)}</p>`;
  const href = escapeHtml(cta.href);
  const html = [
    `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#1f2937;max-width:560px">`,
    ...intro.map(p),
    `<p style="margin:0 0 16px"><a href="${href}" style="display:inline-block;padding:10px 18px;background:#2563eb;color:#ffffff;text-decoration:none;border-radius:6px">${escapeHtml(cta.label)}</a></p>`,
    `<p style="margin:0 0 16px;font-size:12px;color:#6b7280">If the button does not work, paste this link into your browser:<br>${href}</p>`,
    ...outro.map(p),
    `</div>`,
  ].join("\n");
  return { subject, text, html };
}

const ACTIVATION_COPY: Record<ActivationVariant, { subject: string; intro: string }> = {
  user: {
    subject: `You've been invited to ${PRODUCT}`,
    intro: `An account has been created for you on ${PRODUCT}.`,
  },
  partner: {
    subject: `Your ${PRODUCT} partner account is ready`,
    intro: `You have been set up as the Partner Administrator for your organization on ${PRODUCT}.`,
  },
  tenant: {
    subject: `Your ${PRODUCT} workspace is ready`,
    intro: `You have been set up as the administrator of your organization's ${PRODUCT} workspace.`,
  },
  registration: {
    subject: `Your ${PRODUCT} registration has been approved`,
    intro: `Your organization's registration request has been approved and its ${PRODUCT} workspace is ready. You are its administrator.`,
  },
  saas: {
    subject: `Your ${PRODUCT} subscription is active`,
    intro: `Your ${PRODUCT} subscription has been provisioned and you are the administrator of its workspace.`,
  },
};

export function activationEmail(link: string, opts: { variant?: ActivationVariant; resend?: boolean } = {}): EmailContent {
  const copy = ACTIVATION_COPY[opts.variant ?? "user"];
  return compose(
    opts.resend ? `Reminder: ${copy.subject}` : copy.subject,
    [
      copy.intro,
      "Set your password to activate your account.",
      ...(opts.resend ? ["This link replaces any activation link sent to you earlier."] : []),
    ],
    { label: "Activate account", href: link },
    [`The link expires in ${ACTIVATION_TTL_DAYS} days. If you were not expecting this email, you can ignore it.`],
  );
}

export function passwordResetEmail(link: string): EmailContent {
  return compose(
    `Reset your ${PRODUCT} password`,
    [`We received a request to reset the password for your ${PRODUCT} account.`],
    { label: "Reset password", href: link },
    ["If you did not ask for this, ignore this email — your password will not change."],
  );
}

export function poConfirmationEmail(link: string, po: { code: string; supplierName?: string; title?: string }): EmailContent {
  const about = po.title ? `Purchase order ${po.code} (${po.title})` : `Purchase order ${po.code}`;
  return compose(
    `Purchase order ${po.code}`,
    [
      po.supplierName ? `Dear ${po.supplierName},` : "Hello,",
      `${about} has been issued to you. Please review it and acknowledge or decline it using the link below.`,
    ],
    { label: "Review purchase order", href: link },
    ["The link is personal to your organization; please do not forward it."],
  );
}
