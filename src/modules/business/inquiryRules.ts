/**
 * AXI-42 server-side guards for the Inquiries module (`enterprise/ent-inq`), wired into
 * `createBusiness`/`updateBusiness` the same conditional-by-module way `assertNoDuplicateLead`
 * is scoped to `ent-leads` (business.service.ts). Two checks, both cheap allowlist membership —
 * no business-rule engine warranted for this:
 *
 *  - `data.service`/`data.variant` must be a real (service, variant) pair from OD's
 *    `SERVICE_CATALOG` (modules.js ~L1414-1428) — **scoped to this issue's 4 in-scope services**
 *    (impl/audit/assess/comp). `cert` (Certification) is intentionally excluded per the issue
 *    brief; a client sending `service:'cert'` is rejected here same as any other unknown id.
 *  - `data.lifecycle` must be one of the issue's stated 4-state lifecycle
 *    (Unassigned/Open/In Application Review/AR Approved). OD's own `INQ_LIFECYCLE` also lists
 *    `Converted`/`AR Declined` (modules.js ~L2180) but the issue brief scopes this ticket to the
 *    first 4 states only — see the runtime brief's "treat Converted/AR Declined as ... out of
 *    this issue's stated lifecycle scope" note. Not enforcing those two here is a deliberate
 *    scope cut, not an oversight.
 *
 * Both checks are skipped when the field is simply absent (undefined) — a partial `data` patch
 * that doesn't touch service/variant/lifecycle shouldn't be forced to also carry them.
 */
import { BadRequestError } from "../../lib/errors";

export interface InquiryServiceDef {
  id: string;
  name: string;
  variants: readonly string[];
}

/** Mirrors OD's `SERVICE_CATALOG` ids/names/variants — scoped to this issue's 4 services (no `cert`). */
export const SERVICE_CATALOG: readonly InquiryServiceDef[] = [
  { id: "impl", name: "Framework Implementation", variants: ["Full Consultancy", "Facilitated (client-led)"] },
  { id: "audit", name: "Framework Audit", variants: ["1st-party (internal)", "2nd-party (supplier)"] },
  { id: "assess", name: "Framework Assessment", variants: ["Maturity Assessment"] },
  { id: "comp", name: "Competence Development", variants: ["In-house training", "Public training", "Personnel certification"] },
] as const;

export function serviceById(id: string): InquiryServiceDef | undefined {
  return SERVICE_CATALOG.find((s) => s.id === id);
}

/** Issue-scoped subset of OD's `INQ_LIFECYCLE` (Converted/AR Declined excluded — see header note). */
export const INQ_LIFECYCLE = ["Unassigned", "Open", "In Application Review", "AR Approved"] as const;

export function assertValidInquiryData(data: Record<string, unknown> | undefined): void {
  if (!data) return;
  if (data.service !== undefined) {
    const svc = serviceById(String(data.service));
    if (!svc) throw new BadRequestError(`Unknown inquiry service: ${String(data.service)}`, "INVALID_SERVICE");
    if (data.variant !== undefined && data.variant !== "" && !svc.variants.includes(String(data.variant))) {
      throw new BadRequestError(`Unknown variant "${String(data.variant)}" for service "${svc.id}"`, "INVALID_VARIANT");
    }
  }
  if (data.lifecycle !== undefined && !(INQ_LIFECYCLE as readonly string[]).includes(String(data.lifecycle))) {
    throw new BadRequestError(`Unknown inquiry lifecycle: ${String(data.lifecycle)}`, "INVALID_LIFECYCLE");
  }
}
