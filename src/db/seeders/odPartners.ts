import { Organization, PartnerAgreement, PartnerProfile, Role, User } from "../models";
import type { OrgStatus } from "../models/organization.model";
import type { PartnerAgreementStatus } from "../models/partnerAgreement.model";
import type { PartnerStatus, PartnerTier } from "../models/partnerProfile.model";
import type { UserStatus } from "../models/user.model";

/**
 * OD `seedPartners()` (js/core.js:187-221) — the five-partner commercial demo set.
 *
 * Only one partner was seeded before this (the `seed.ts` fixture org), so against
 * a real API the Partners list held a single Active Gold row: no Draft, no
 * Pending Approval, no Suspended partner, no Silver or Bronze tier, and no
 * Terminated agreement. The FE mock client has carried all five since it was
 * written (`lib/api/mockClient.ts` `PARTNERS`), which is the worse shape of the
 * gap — the screen looks complete in mock and near-empty for real.
 *
 * Names, emails, phones, websites, countries, addresses, codes, statuses, tiers,
 * agreement numbers and audit trails are all OD-verbatim.
 *
 * `idpr5` / `PRT-1005` (PT Parker Industries) is the one partner NOT restated
 * here: it is the `seed.ts` fixture org, which owns OD's `idtn5` PT Hammer
 * Industries tenant — the demo tenant every other seed hangs off — exactly as OD
 * pairs them. Seeding it again would collide on the unique partner code.
 */

/** OD `PARTNER_AG_HISTORY` — the agreement timeline, sliced by partner status. */
export const PARTNER_AG_HISTORY = [
  { date: "2025-12-15", event: "Agreement Generated" },
  { date: "2025-12-16", event: "Agreement Sent to Partner" },
  { date: "2025-12-18", event: "Agreement Approved by Partner" },
  { date: "2026-01-01", event: "Agreement Became Effective" },
  { date: "2026-02-01", event: "First Billing Period Started" },
  { date: "2026-03-01", event: "Second Billing Period Started" },
  { date: "2026-04-01", event: "Third Billing Period Started" },
  { date: "2026-05-01", event: "Fourth Billing Period Started" },
  { date: "2026-06-01", event: "Fifth Billing Period Started" },
];

/**
 * OD slices the timeline by how far the partnership actually got: a Draft
 * partner has only been created, a Pending Approval one has been generated,
 * sent and is awaiting signature, and anything further along shows the run.
 */
export function agreementHistoryFor(status: PartnerStatus): typeof PARTNER_AG_HISTORY {
  if (status === "Draft") return PARTNER_AG_HISTORY.slice(0, 1);
  if (status === "Pending Approval") return PARTNER_AG_HISTORY.slice(0, 3);
  return PARTNER_AG_HISTORY.slice();
}

/**
 * The four statuses OD seeds — each spelled identically on `PartnerStatus` and
 * `OrgStatus`, which is what lets the organization row carry the partner's own
 * status instead of a coarser Active/Suspended split.
 */
type SeededPartnerStatus = Extract<PartnerStatus, OrgStatus>;

interface OdPartner {
  odId: string;
  code: string;
  name: string;
  orgCode: string;
  email: string;
  phone: string;
  website: string;
  country: string;
  address: string;
  status: SeededPartnerStatus;
  tier: PartnerTier;
  createdAt: string;
  updatedAt: string;
  admin: { fullName: string; username: string; email: string; status: UserStatus };
  /** Additional partner-org staff (OD `partners[].team[]` beyond the admin). */
  team: { fullName: string; email: string; roleGroup: string; status: UserStatus }[];
  agreement: {
    templateName: string; number: string | null; version: string;
    status: PartnerAgreementStatus; effectiveDate: string | null; expirationDate: string | null;
    currency: string; governingLaw: string; jurisdiction: string; partnerSignatory: string | null;
  };
  audit: { ts: string; msg: string }[];
}

/** OD `idpr1`-`idpr4` (`idpr5` is the `seed.ts` fixture — see the header note). */
export const OD_PARTNERS: readonly OdPartner[] = [
  {
    odId: "idpr1", code: "PRT-1001", name: "PT Stark Industries", orgCode: "STARKIND",
    email: "partners@starkindustries.com", phone: "+62 21 5555 1200", website: "starkindustries.com",
    country: "ID", address: "Jl. Sudirman Kav. 52, Jakarta",
    status: "Active", tier: "Gold",
    createdAt: "2026-04-02T10:00:00.000Z", updatedAt: "2026-04-12T10:00:00.000Z",
    admin: { fullName: "Anthony Edward Stark", username: "leonardo.admin", email: "leonardo@starkindustries.com", status: "Active" },
    team: [{ fullName: "Wanda Maximoff", email: "natalie@starkindustries.com", roleGroup: "Billing Manager", status: "Active" }],
    agreement: {
      templateName: "Distributor Agreement", number: "AGR-2026-0001", version: "v1.4",
      status: "Approved", effectiveDate: "2026-04-01", expirationDate: "2028-03-31",
      currency: "IDR", governingLaw: "Indonesia", jurisdiction: "Jakarta", partnerSignatory: "Anthony Edward Stark",
    },
    audit: [
      { ts: "2026-04-12T10:00:00.000Z", msg: "Partner Administrator activated account" },
      { ts: "2026-04-10T10:00:00.000Z", msg: "Activation email sent to andi@starkindustries.com" },
      { ts: "2026-04-09T10:00:00.000Z", msg: "Partnership agreement approved" },
      { ts: "2026-04-05T10:00:00.000Z", msg: "Partnership agreement AGR-2026-0001 generated & sent" },
      { ts: "2026-04-02T10:00:00.000Z", msg: "Partner organization created" },
    ],
  },
  {
    odId: "idpr2", code: "PRT-1002", name: "Oscorp Industries Pte Ltd", orgCode: "OSCORP",
    email: "hello@oscorp.com", phone: "+65 6555 8800", website: "oscorp.com",
    country: "SG", address: "10 Anson Road, #20-01, Singapore",
    status: "Pending Approval", tier: "Silver",
    createdAt: "2026-04-14T10:00:00.000Z", updatedAt: "2026-04-15T10:00:00.000Z",
    admin: { fullName: "Robert Bruce Banner", username: "christian.admin", email: "christian@oscorp.com", status: "Pending Activation" },
    team: [],
    agreement: {
      templateName: "Standard Reseller Agreement", number: "AGR-2026-0002", version: "v2.1",
      status: "Pending Approval", effectiveDate: "2026-07-01", expirationDate: "2028-06-30",
      currency: "IDR", governingLaw: "Singapore", jurisdiction: "Singapore", partnerSignatory: "Robert Bruce Banner",
    },
    audit: [
      { ts: "2026-04-15T10:00:00.000Z", msg: "Partnership agreement AGR-2026-0002 generated & sent" },
      { ts: "2026-04-14T10:00:00.000Z", msg: "Partner organization created" },
    ],
  },
  {
    odId: "idpr3", code: "PRT-1003", name: "Pym Technologies SpA", orgCode: "PYMTECH",
    email: "contacto@pymtech.com", phone: "+56 2 2555 4400", website: "pymtech.com",
    country: "CL", address: "Av. Apoquindo 4500, Las Condes, Santiago",
    status: "Draft", tier: "Bronze",
    createdAt: "2026-04-18T10:00:00.000Z", updatedAt: "2026-04-18T10:00:00.000Z",
    admin: { fullName: "Susan Storm", username: "charlize.admin", email: "charlize@pymtech.com", status: "Pending Activation" },
    team: [],
    agreement: {
      // OD leaves a Draft partner's agreement unnumbered and undated — it has
      // been started, not issued.
      templateName: "Principal Partner Agreement", number: null, version: "v1.0",
      status: "Draft", effectiveDate: null, expirationDate: null,
      currency: "USD", governingLaw: "Chile", jurisdiction: "Santiago", partnerSignatory: null,
    },
    audit: [{ ts: "2026-04-18T10:00:00.000Z", msg: "Partner organization created" }],
  },
  {
    odId: "idpr4", code: "PRT-1004", name: "Roxxon Energy GmbH", orgCode: "ROXXON",
    email: "kontakt@roxxon.com", phone: "+49 30 5555 7700", website: "roxxon.com",
    country: "DE", address: "Friedrichstraße 88, Berlin",
    status: "Suspended", tier: "Silver",
    createdAt: "2026-04-04T10:00:00.000Z", updatedAt: "2026-04-20T10:00:00.000Z",
    admin: { fullName: "Scott Summers", username: "robert.admin", email: "robert@roxxon.com", status: "Suspended" },
    team: [],
    agreement: {
      templateName: "Distributor Agreement", number: "AGR-2025-0019", version: "v1.4",
      status: "Terminated", effectiveDate: "2025-02-01", expirationDate: "2027-01-31",
      currency: "EUR", governingLaw: "Germany", jurisdiction: "Berlin", partnerSignatory: "Scott Summers",
    },
    audit: [
      { ts: "2026-04-20T10:00:00.000Z", msg: "Partner suspended — payment overdue" },
      { ts: "2026-04-06T10:00:00.000Z", msg: "Partner Administrator activated account" },
      { ts: "2026-04-04T10:00:00.000Z", msg: "Partner organization created" },
    ],
  },
];

/**
 * Seeds OD's remaining partners under the Service Owner. Idempotent on the
 * organization code / partner code / email natural keys.
 *
 * No child Tenant organizations are created here — `seed.ts` owns those, and
 * seeds them against OD's own pairing: `idpr1`'s four (`TEN-1001` PT Damage
 * Control plus the three assigned-tenant rows OD lists only on the partner
 * record), `idpr4`'s `TEN-1004` PT Cross Technological Enterprises, and
 * `idpr5`'s `TEN-1005` PT Hammer Industries.
 */
export async function seedOdPartners(soOrgId: string): Promise<void> {
  for (const p of OD_PARTNERS) {
    const [org] = await Organization.findOrCreate({
      where: { code: p.orgCode },
      defaults: {
        name: p.name, code: p.orgCode, type: "Distributor",
        // OD carries exactly one status per partner record (js/core.js:190/196/
        // 203/210/217), so the organization row takes the profile's own status
        // rather than a coarser Active/Suspended split — otherwise a Pending
        // Approval or Draft partner reads "Active" wherever a screen happens to
        // read the org instead of the profile. `OrgStatus` carries both literals.
        status: p.status,
        parentOrgId: soOrgId, tenantId: null,
        email: p.email, phone: p.phone, website: p.website, country: p.country, address: p.address,
        createdAt: new Date(p.createdAt), updatedAt: new Date(p.updatedAt),
      },
    });

    // Partner staff are org members, not platform logins: seeded without a
    // password, the same way the AXIA roster is (see `axiaTeam.ts`).
    const [adminRole] = await Role.findOrCreate({
      where: { name: "Administrator", orgId: org.id },
      defaults: { name: "Administrator", tierScope: "Distributor", orgId: org.id, isSuperAdmin: false, status: true },
    });
    const members: { fullName: string; username: string; email: string; status: UserStatus; roleGroup: string }[] = [
      { ...p.admin, roleGroup: "Administrator" },
      ...p.team.map((m) => ({ ...m, username: m.email.split("@")[0] })),
    ];
    let adminUserId: string | null = null;
    for (const m of members) {
      const [user] = await User.findOrCreate({
        where: { email: m.email },
        defaults: {
          orgId: org.id, tenantId: null, fullName: m.fullName,
          username: m.username,
          email: m.email, passwordHash: null, status: m.status,
          position: m.roleGroup, workUnit: null, lastLogin: null,
          activationToken: null, resetToken: null, resetExpires: null,
          provisioned: true,
        },
      });
      if (m.roleGroup === "Administrator") {
        adminUserId = user.id;
        await (user as unknown as { setRoles(roles: Role[]): Promise<void> }).setRoles([adminRole]);
      }
    }

    await PartnerProfile.findOrCreate({
      where: { orgId: org.id },
      defaults: {
        orgId: org.id, code: p.code, tier: p.tier, status: p.status, adminUserId,
        commercialSummary: { revenueSharePct: 20, currency: p.agreement.currency },
        audit: p.audit,
        agreement: {
          number: p.agreement.number ?? "", name: "Standard Partner Agreement",
          version: p.agreement.version, status: p.agreement.status,
          subscriptionType: "Annual", billingCycle: "Annual",
          effectiveDate: p.agreement.effectiveDate, expirationDate: p.agreement.expirationDate,
          currency: p.agreement.currency, paymentDueDays: 30, history: agreementHistoryFor(p.status),
        },
        createdAt: new Date(p.createdAt), updatedAt: new Date(p.updatedAt),
      },
    });

    await PartnerAgreement.findOrCreate({
      where: { orgId: org.id },
      defaults: {
        orgId: org.id, templateId: null, templateName: p.agreement.templateName,
        number: p.agreement.number, version: p.agreement.version, status: p.agreement.status,
        effectiveDate: p.agreement.effectiveDate, expirationDate: p.agreement.expirationDate,
        vars: {
          currency: p.agreement.currency, governing_law: p.agreement.governingLaw,
          jurisdiction: p.agreement.jurisdiction,
          partner_name: p.name, partner_code: p.code,
          partner_signatory_name: p.agreement.partnerSignatory ?? "",
        },
        renderedBlocks: [],
        history: agreementHistoryFor(p.status),
      },
    });
  }
}
