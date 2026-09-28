import { BusinessRecord, CmsPage, Organization } from "../../db/models";
import { withCodeLock } from "../../lib/codeSeq";
import { NotFoundError } from "../../lib/errors";
import { writeAudit } from "../audit/audit.service";
import { bizCodeLockKey, nextCode } from "../business/business.service";
import { businessDefaultStatus } from "../business/prLifecycle";

/** `source` is a slug (e.g. "contact", "waitlist", "axia-contact", "exelera-application"), stored as-is. */
export const LEAD_SOURCE_RE = /^[a-z0-9-]{1,40}$/;

export interface LeadInput {
  source: string;
  name: string;
  email: string;
  company?: string;
  phone?: string;
  message?: string;
  meta?: Record<string, string>;
}

const AREA = "enterprise";
const MODULE = "ent-inq";

/**
 * Only an org that actually runs a public site may receive leads: the Service
 * Owner (the marketing site) or an org with at least one Published CMS page.
 * Anything else is a 404, same as an unknown org, so ids can't be probed.
 */
async function assertAcceptsLeads(orgId: string): Promise<void> {
  const org = await Organization.findByPk(orgId, { attributes: ["id", "type"] });
  if (org?.type === "ServiceOwner") return;
  if (org && (await CmsPage.count({ where: { orgId, status: "Published" } })) > 0) return;
  throw new NotFoundError("Site not found", "SITE_NOT_FOUND");
}

/** `meta` has no slot in the strict ent-inq `data` schema, so it is folded into `notes`. */
function notesOf(input: LeadInput): string | undefined {
  const extra = Object.entries(input.meta ?? {}).map(([k, v]) => `${k}: ${v}`);
  const parts = [input.message, extra.length ? extra.join("\n") : undefined].filter((p): p is string => !!p);
  return parts.length ? parts.join("\n\n") : undefined;
}

/**
 * Store a public-site lead as an `enterprise/ent-inq` inquiry at the pipeline's
 * entry status, in the ent-inq data shape (dataSchemas.ts `entInqDataSchema`).
 */
export async function createLead(orgId: string, input: LeadInput, ip: string | null): Promise<{ id: string }> {
  await assertAcceptsLeads(orgId);
  const leadName = input.company || input.name;
  const data: Record<string, unknown> = {
    leadName,
    contactName: input.name,
    contactEmail: input.email,
    ...(input.phone ? { contactPhone: input.phone } : {}),
    source: input.source,
    lifecycle: "Unassigned",
    ...(notesOf(input) ? { notes: notesOf(input) } : {}),
    activity: [{ ts: new Date().toISOString(), user: "Public website", action: "Record created", summary: `Lead via ${input.source} form` }],
  };
  const row = await withCodeLock(bizCodeLockKey(orgId, AREA, MODULE), null, async (tx) => BusinessRecord.create({
    orgId, area: AREA, module: MODULE,
    code: await nextCode(orgId, AREA, MODULE, data, tx),
    title: input.company ? `${input.name} (${input.company})` : input.name,
    status: businessDefaultStatus(AREA, MODULE) ?? "Cold Leads",
    owner: null,
    data,
  }, { transaction: tx }));
  await writeAudit({
    actorUserId: null, organizationId: orgId, action: "lead.received", entityType: "BusinessRecord",
    entityId: row.id, sourceIp: ip, result: "Success", metadata: { source: input.source },
  });
  return { id: row.id };
}
