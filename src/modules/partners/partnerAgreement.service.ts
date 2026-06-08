import type { Transaction } from "sequelize";
import { sequelize } from "../../db/sequelize";
import { Organization, AgreementTemplate, PartnerAgreement, OrgSignatory } from "../../db/models";
import type { AgreementBlock } from "../../db/models/agreementTemplate.model";
import type { AgreementHistoryEntry, AgreementVars, PartnerAgreementStatus } from "../../db/models/partnerAgreement.model";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { BadRequestError, NotFoundError } from "../../lib/errors";
import { assertServiceOwner, requirePartner } from "./partner.service";
import { defaultAgreementVars } from "../agreements/variables.catalog";

export interface PartnerAgreementView {
  id: string;
  orgId: string;
  templateId: string;
  templateName: string;
  number: string | null;
  version: string;
  status: PartnerAgreementStatus;
  effectiveDate: string | null;
  expirationDate: string | null;
  vars: AgreementVars;
  renderedBlocks: AgreementBlock[];
  history: AgreementHistoryEntry[];
}

export interface GenerateAgreementInput {
  templateId: string;
  vars?: AgreementVars;
}

const today = () => new Date().toISOString().slice(0, 10);

/** Format a YYYY-MM-DD date as "1 Jul 2026" for document tokens. */
function humanDate(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" });
}

/** effectiveDate + durationMonths → expiration date (one day before, AXIA-style). */
function computeExpiration(effective: string, months: number): string {
  const d = new Date(`${effective}T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + months);
  d.setUTCDate(d.getUTCDate() - 1);
  return d.toISOString().slice(0, 10);
}

/** Next agreement number for the current year: AGR-YYYY-#### (zero-padded). */
async function nextAgreementNumber(tx?: Transaction): Promise<string> {
  const year = new Date().getUTCFullYear();
  const prefix = `AGR-${year}-`;
  const rows = await PartnerAgreement.findAll({ attributes: ["number"], transaction: tx });
  let max = 0;
  for (const r of rows) {
    if (r.number?.startsWith(prefix)) {
      const n = parseInt(r.number.slice(prefix.length), 10);
      if (!Number.isNaN(n) && n > max) max = n;
    }
  }
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

/**
 * Build the full snake_case token map for document substitution from the stored
 * camelCase vars plus computed values (partner org, SO org, Active signatory).
 */
async function buildTokens(
  partner: Organization,
  vars: AgreementVars,
  number: string | null,
  effectiveDate: string | null,
  expirationDate: string | null,
  auth: AuthContext,
): Promise<Record<string, string>> {
  const so = await Organization.findByPk(auth.orgId);
  const signatory = await OrgSignatory.findOne({ where: { orgId: auth.orgId, status: "Active" }, order: [["createdAt", "ASC"]] });
  const v = (k: string) => vars[k] ?? "";
  return {
    partner_name: partner.name,
    partner_code: partner.partnerCode ?? "",
    partner_email: partner.email ?? "",
    partner_phone: partner.phone ?? "",
    partner_address: partner.address ?? "",
    partner_country: partner.country ?? "",
    agreement_number: number ?? "",
    agreement_date: humanDate(effectiveDate),
    effective_date: humanDate(effectiveDate),
    expiration_date: humanDate(expirationDate),
    agreement_duration_months: v("durationMonths"),
    revenue_share_percentage: v("revenueShare") ? `${v("revenueShare")}%` : "",
    partner_discount_percentage: v("discount") ? `${v("discount")}%` : "",
    minimum_sales_target: v("minimumSalesTarget"),
    minimum_subscription_quantity: v("minimumSubscriptionQuantity"),
    minimum_revenue_commitment: v("minimumRevenueCommitment"),
    payment_due_days: v("paymentDueDays"),
    currency: v("currency"),
    service_provider_name: so?.name ?? "",
    service_provider_address: so?.address ?? "",
    service_provider_email: so?.email ?? "",
    service_provider_signatory_name: signatory?.fullName ?? v("spSignatory"),
    service_provider_signatory_title: signatory?.title ?? "",
    partner_signatory_name: v("partnerSignatory"),
    partner_signatory_title: v("partnerSignatoryTitle"),
    governing_law: v("governingLaw"),
    jurisdiction: v("jurisdiction"),
    termination_notice_days: v("terminationNoticeDays"),
  };
}

/** Substitute {{key}} tokens in a block's text. Unknown tokens are left intact. */
export function fillVars(text: string, tokens: Record<string, string>): string {
  return text.replace(/\{\{\s*([a-z0-9_]+)\s*\}\}/gi, (m, key: string) =>
    Object.prototype.hasOwnProperty.call(tokens, key) ? tokens[key] : m,
  );
}

function toView(pa: PartnerAgreement, templateName: string): PartnerAgreementView {
  return {
    id: pa.id,
    orgId: pa.orgId,
    templateId: pa.agreementTemplateId,
    templateName,
    number: pa.number,
    version: pa.version,
    status: pa.status,
    effectiveDate: pa.effectiveDate,
    expirationDate: pa.expirationDate,
    vars: pa.vars,
    renderedBlocks: pa.renderedBlocks,
    history: pa.history,
  };
}

/** The partner's current agreement instance, or null if none generated yet. */
export async function getForPartner(auth: AuthContext, orgId: string): Promise<PartnerAgreementView | null> {
  assertServiceOwner(auth);
  await requirePartner(orgId);
  const pa = await PartnerAgreement.findOne({ where: { orgId }, include: [AgreementTemplate], order: [["createdAt", "DESC"]] });
  if (!pa) return null;
  const tpl = pa.get("AgreementTemplate") as AgreementTemplate | undefined;
  return toView(pa, tpl?.name ?? "");
}

async function loadOwned(orgId: string): Promise<PartnerAgreement> {
  const pa = await PartnerAgreement.findOne({ where: { orgId }, order: [["createdAt", "DESC"]] });
  if (!pa) throw new NotFoundError("Partner has no agreement", "PARTNER_AGREEMENT_NOT_FOUND");
  return pa;
}

/**
 * Generate (or re-generate) the partner's agreement from a template: assigns a
 * number, snapshots the template blocks with variables filled, computes the
 * expiration date, sets Pending Approval, and moves the partner to Pending Approval.
 */
export async function generate(
  auth: AuthContext,
  orgId: string,
  input: GenerateAgreementInput,
  ip: string | null,
): Promise<PartnerAgreementView> {
  assertServiceOwner(auth);
  const partner = await requirePartner(orgId);
  const template = await AgreementTemplate.findByPk(input.templateId);
  if (!template) throw new BadRequestError("Agreement template does not exist", "TEMPLATE_NOT_FOUND");

  const vars: AgreementVars = { ...defaultAgreementVars(), ...(input.vars ?? {}) };
  const effectiveDate = vars.effectiveDate || today();
  const months = parseInt(vars.durationMonths || "24", 10) || 24;
  const expirationDate = computeExpiration(effectiveDate, months);
  const tokens = await buildTokens(partner, vars, null, effectiveDate, expirationDate, auth);

  // All writes (number assignment, agreement upsert, partner status, audit) run in
  // one transaction so a mid-sequence failure can't leave the coupled partner/
  // agreement state inconsistent. The number is derived inside the tx.
  const pa = await sequelize.transaction(async (tx) => {
    const number = await nextAgreementNumber(tx);
    const renderedBlocks = template.blocks.map((b) => ({ ...b, text: fillVars(b.text, { ...tokens, agreement_number: number }) }));
    const history: AgreementHistoryEntry[] = [
      { date: today(), event: "Agreement Generated" },
      { date: today(), event: "Agreement Sent to Partner" },
    ];
    const existing = await PartnerAgreement.findOne({ where: { orgId }, transaction: tx });
    let row: PartnerAgreement;
    if (existing) {
      existing.set({ agreementTemplateId: template.id, number, version: template.version, status: "Pending Approval", effectiveDate, expirationDate, vars, renderedBlocks, history });
      await existing.save({ transaction: tx });
      row = existing;
    } else {
      row = await PartnerAgreement.create(
        { orgId, agreementTemplateId: template.id, number, version: template.version, status: "Pending Approval", effectiveDate, expirationDate, vars, renderedBlocks, history },
        { transaction: tx },
      );
    }
    partner.partnerStatus = "Pending Approval";
    partner.partnerAudit = [{ ts: new Date().toISOString(), msg: `Partnership agreement ${number} generated & sent` }, ...(partner.partnerAudit ?? [])];
    await partner.save({ transaction: tx });
    await writeAudit(
      { actorUserId: auth.userId, organizationId: orgId, tenantId: null, action: "partnerAgreement.generated", entityType: "PartnerAgreement", entityId: row.id, sourceIp: ip, result: "Success", metadata: { number } },
      tx,
    );
    return row;
  });
  return toView(pa, template.name);
}

/** Re-issue a fresh copy with a new number (same Pending Approval flow). */
export async function regenerate(auth: AuthContext, orgId: string, ip: string | null): Promise<PartnerAgreementView> {
  assertServiceOwner(auth);
  const pa = await loadOwned(orgId);
  if (pa.status === "Terminated") throw new BadRequestError("Agreement is terminated", "AGREEMENT_TERMINATED");
  return generate(auth, orgId, { templateId: pa.agreementTemplateId, vars: pa.vars }, ip);
}

/** Append a "resent" history event (no status change). */
export async function resend(auth: AuthContext, orgId: string, ip: string | null): Promise<PartnerAgreementView> {
  assertServiceOwner(auth);
  const pa = await loadOwned(orgId);
  pa.history = [...pa.history, { date: today(), event: "Agreement Resent to Partner" }];
  await pa.save();
  await writeAudit({
    actorUserId: auth.userId, organizationId: orgId, tenantId: null,
    action: "partnerAgreement.resent", entityType: "PartnerAgreement", entityId: pa.id, sourceIp: ip, result: "Success",
  });
  const tpl = await AgreementTemplate.findByPk(pa.agreementTemplateId);
  return toView(pa, tpl?.name ?? "");
}

/** Approve the partner's agreement (Pending Approval → Approved). */
export async function approve(auth: AuthContext, orgId: string, ip: string | null): Promise<PartnerAgreementView> {
  assertServiceOwner(auth);
  const partner = await requirePartner(orgId);
  const pa = await loadOwned(orgId);
  if (pa.status !== "Pending Approval") throw new BadRequestError("Agreement is not pending approval", "INVALID_STATE");
  // Agreement + partner status + audit move together in one transaction.
  await sequelize.transaction(async (tx) => {
    pa.status = "Approved";
    pa.history = [...pa.history, { date: today(), event: "Agreement Approved by Partner" }];
    await pa.save({ transaction: tx });
    partner.partnerStatus = "Approved";
    partner.partnerAudit = [{ ts: new Date().toISOString(), msg: "Partnership agreement approved" }, ...(partner.partnerAudit ?? [])];
    await partner.save({ transaction: tx });
    await writeAudit(
      { actorUserId: auth.userId, organizationId: orgId, tenantId: null, action: "partnerAgreement.approved", entityType: "PartnerAgreement", entityId: pa.id, sourceIp: ip, result: "Success" },
      tx,
    );
  });
  const tpl = await AgreementTemplate.findByPk(pa.agreementTemplateId);
  return toView(pa, tpl?.name ?? "");
}
