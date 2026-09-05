import { Organization, PartnerAgreement, PartnerProfile, Role, User } from "../models";
import type { PartnerAgreementStatus } from "../models/partnerAgreement.model";
import type { PartnerStatus, PartnerTier } from "../models/partnerProfile.model";
import type { UserStatus } from "../models/user.model";

/**
 * OD `seedPartners()` (js/core.js) — the five-partner commercial demo set.
 *
 * Only `PRT-1001` was seeded before this (the Nusantara Partners fixture in
 * `seed.ts`), so against a real API the Partners list held a single Active Gold
 * row: no Draft, no Pending Approval, no Suspended partner, no Silver or Bronze
 * tier, and no Terminated agreement. The FE mock client has carried all five
 * since it was written (`lib/api/mockClient.ts` `PARTNERS`), which is the worse
 * shape of the gap — the screen looks complete in mock and near-empty for real.
 *
 * Names follow this codebase's existing partner branding (the FE mock's), not
 * OD's Marvel company names, which were deliberately renamed here; the OD codes,
 * statuses, tiers, countries, agreement numbers and audit trails are verbatim.
 * Partner *people* keep their OD names, as the rest of this codebase's seeds do.
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
  status: PartnerStatus;
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

/**
 * OD `idpr2`-`idpr5`. `idpr1` is the Nusantara Partners fixture `seed.ts`
 * already creates (it carries OD's `PRT-1001` Active/Gold slot), so it is not
 * restated here — seeding it again would collide on the unique partner code.
 */
export const OD_PARTNERS: readonly OdPartner[] = [
  {
    odId: "idpr2", code: "PRT-1002", name: "SecureEdge Pte Ltd", orgCode: "SECEDGE",
    email: "hello@secureedge.sg", phone: "+65 6555 2000", website: "secureedge.sg",
    country: "SG", address: "1 Raffles Place, Singapore",
    status: "Pending Approval", tier: "Silver",
    createdAt: "2026-04-14T10:00:00.000Z", updatedAt: "2026-04-15T10:00:00.000Z",
    admin: { fullName: "Robert Bruce Banner", username: "christian.admin", email: "christian@secureedge.sg", status: "Pending Activation" },
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
    odId: "idpr3", code: "PRT-1003", name: "Andes Compliance SpA", orgCode: "ANDESC",
    email: "contacto@andescompliance.cl", phone: "+56 2 2555 3000", website: "andescompliance.cl",
    country: "CL", address: "Av. Apoquindo 4500, Las Condes, Santiago",
    status: "Draft", tier: "Bronze",
    createdAt: "2026-04-18T10:00:00.000Z", updatedAt: "2026-04-18T10:00:00.000Z",
    admin: { fullName: "Susan Storm", username: "charlize.admin", email: "charlize@andescompliance.cl", status: "Pending Activation" },
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
    odId: "idpr4", code: "PRT-1004", name: "Rhein Governance GmbH", orgCode: "RHEING",
    email: "kontakt@rheingov.de", phone: "+49 30 5555 4000", website: "rheingov.de",
    country: "DE", address: "Friedrichstraße 88, Berlin",
    status: "Suspended", tier: "Silver",
    createdAt: "2026-04-04T10:00:00.000Z", updatedAt: "2026-04-20T10:00:00.000Z",
    admin: { fullName: "Scott Summers", username: "robert.admin", email: "robert@rheingov.de", status: "Suspended" },
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
  {
    odId: "idpr5", code: "PRT-1005", name: "ABC Consulting", orgCode: "ABCCON",
    email: "partners@abc.co", phone: "+62 21 5555 5000", website: "abc.co",
    country: "ID", address: "Jl. Thamrin 5, Jakarta",
    status: "Active", tier: "Gold",
    createdAt: "2026-04-01T10:00:00.000Z", updatedAt: "2026-04-15T10:00:00.000Z",
    admin: { fullName: "Peter Benjamin Parker", username: "zinedine.admin", email: "zinedine@abc.co", status: "Active" },
    team: [{ fullName: "Kamala Khan", email: "anne@abc.co", roleGroup: "Billing Manager", status: "Active" }],
    agreement: {
      templateName: "Distributor Agreement", number: "AGR-2026-0024", version: "v1.4",
      status: "Approved", effectiveDate: "2026-01-01", expirationDate: "2027-12-31",
      currency: "IDR", governingLaw: "Indonesia", jurisdiction: "Jakarta", partnerSignatory: "Peter Benjamin Parker",
    },
    audit: [
      { ts: "2026-04-15T10:00:00.000Z", msg: 'Tenant "PT Hammer Industries" provisioned' },
      { ts: "2026-04-02T10:00:00.000Z", msg: "Partner Administrator activated account" },
      { ts: "2026-04-01T10:00:00.000Z", msg: "Partner organization created" },
    ],
  },
];

/**
 * Seeds OD's remaining partners under the Service Owner. Idempotent on the
 * organization code / partner code / email natural keys.
 *
 * No child Tenant organizations are created here, but `idpr4`'s is no longer
 * missing: OD gives `idpr4` and `idpr5` one tenant each, and `seed.ts` step
 * 12d-2 now seeds `idpr4`'s (`TEN-1004` PT Cross Technological Enterprises)
 * under this partner's org, so its `tenantCount` reads 1 as OD's does.
 * `idpr5`'s tenant is OD `idtn5` PT Hammer Industries, which this backend
 * already provisions as `TEN-1005` (Garuda Manufacturing) under the Nusantara
 * Partners fixture — re-parenting it here would break the revenue-share and
 * cross-partner ticket-isolation seeds built on that pairing, so `PRT-1005`
 * still reads 0.
 */
export async function seedOdPartners(soOrgId: string): Promise<void> {
  for (const p of OD_PARTNERS) {
    const [org] = await Organization.findOrCreate({
      where: { code: p.orgCode },
      defaults: {
        name: p.name, code: p.orgCode, type: "Distributor",
        // A Suspended partner's organization is suspended with it; the others
        // stay Active regardless of where their agreement has got to.
        status: p.status === "Suspended" ? "Suspended" : "Active",
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
