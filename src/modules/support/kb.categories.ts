/** Fixed Knowledge Base category catalog (display metadata; articles store the id). */
export interface KbCategory {
  id: string;
  name: string;
  desc: string;
}

export const KB_CATEGORIES: KbCategory[] = [
  { id: "platform", name: "Platform Guides", desc: "Getting started and day-to-day platform tasks." },
  { id: "framework", name: "Framework Guides", desc: "Working with frameworks, requirements, and elements." },
  { id: "billing", name: "Billing", desc: "Subscriptions, invoices, payments, and receipts." },
  { id: "partner", name: "Partner Program", desc: "Partner tiers, revenue share, and onboarding." },
  { id: "troubleshooting", name: "Troubleshooting", desc: "Fixes for common issues." },
  { id: "faq", name: "FAQs", desc: "Frequently asked questions." },
  { id: "release", name: "Release Notes", desc: "What's new in AXIA." },
];

const BY_ID = new Map(KB_CATEGORIES.map((c) => [c.id, c]));

export function categoryName(id: string): string {
  return BY_ID.get(id)?.name ?? id;
}

export function isValidCategory(id: string): boolean {
  return BY_ID.has(id);
}
