import { DataTypes } from "sequelize";
import type { Migration } from "../migrate";

/**
 * sp-tenant detail Billing tab (OD `index.html:7436-7481`): every tenant carries
 * a Subscription Agreement — number/name/version/status, subscription type,
 * billing cycle, effective/expiration dates, currency, payment-due days, and a
 * Subscription Timeline (`agreement.history`, OD 7481). None of that existed on
 * the BE schema, so the tab could only render a bare invoice table.
 *
 * Design: a single `agreement` JSONB column on `tenant_profiles` (the profile is
 * already the commercial 1:1 extension of a Tenant org and already keeps its
 * JSONB documents — `subscription_summary`, `audit`). A separate
 * `tenant_agreements` table would buy nothing: the agreement is strictly 1:1,
 * read as one document, and never queried by its parts. The "Billing Owner" row
 * is NOT a column — OD derives it (`acquisition === 'Partner'` →
 * "Partner-managed (<partner>)", else "Service Provider", OD 7452) and the
 * service view does the same.
 *
 * Backfill mirrors OD's seed (`index.html:7224`): TA-2026-NNNN numbering,
 * "VIBES Subscription Agreement" v1.0, Professional / Monthly / IDR / 14-day
 * terms, an Active agreement with the full TENANT_AG_HISTORY timeline for
 * tenants that have started (Active/Suspended), and a Draft agreement with only
 * the first two history entries for the rest — so previously provisioned
 * databases render the tab without a reseed.
 */
const FULL_HISTORY = [
  { date: "2025-12-20", event: "Agreement Generated" },
  { date: "2025-12-21", event: "Agreement Sent to Tenant" },
  { date: "2025-12-23", event: "Agreement Approved by Tenant" },
  { date: "2026-01-01", event: "Subscription Became Active" },
  { date: "2026-02-01", event: "Billing Period Closed" },
  { date: "2026-03-01", event: "Billing Period Closed" },
  { date: "2026-04-01", event: "Billing Period Closed" },
  { date: "2026-05-01", event: "Billing Period Closed" },
  { date: "2026-06-01", event: "Billing Period In Progress" },
];
const DRAFT_HISTORY = FULL_HISTORY.slice(0, 2);

export const up: Migration = async ({ context: q }) => {
  await q.addColumn("tenant_profiles", "agreement", { type: DataTypes.JSONB, allowNull: true });
  await q.sequelize.query(
    `WITH numbered AS (
       SELECT tp.id, tp.status, row_number() OVER (ORDER BY tp.created_at, tp.id) AS rn
       FROM "tenant_profiles" tp
       WHERE tp."agreement" IS NULL
     )
     UPDATE "tenant_profiles" tp
     SET "agreement" = jsonb_build_object(
       'number', 'TA-2026-' || lpad(n.rn::text, 4, '0'),
       'name', 'VIBES Subscription Agreement',
       'version', '1.0',
       'status', CASE WHEN n.status IN ('Active', 'Suspended') THEN 'Active' ELSE 'Draft' END,
       'subscriptionType', 'Professional',
       'billingCycle', 'Monthly',
       'effectiveDate', '2026-01-01',
       'expirationDate', '2026-12-31',
       'currency', 'IDR',
       'paymentDueDays', 14,
       'history', CASE WHEN n.status IN ('Active', 'Suspended') THEN :full::jsonb ELSE :draft::jsonb END
     )
     FROM numbered n
     WHERE tp.id = n.id`,
    { replacements: { full: JSON.stringify(FULL_HISTORY), draft: JSON.stringify(DRAFT_HISTORY) } },
  );
};

export const down: Migration = async ({ context: q }) => {
  await q.removeColumn("tenant_profiles", "agreement");
};
