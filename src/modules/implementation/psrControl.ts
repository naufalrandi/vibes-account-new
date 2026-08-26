/**
 * Product & Service Requirements (`psr`, OD app.html:11507-11938) — the one
 * piece the generic `implementation_records` create/update path can't cover
 * on its own: an offering's `spec` is typed per its spec template's
 * `attributes[]` (OD `psrAttrForm`'s `PSR_ATTR_TYPES`:
 * text/number/enum(select)/boolean/textarea), not free-form JSON. Everything
 * else about the 3 OD collections (`db.psrRecords`/`psrCatalog`/
 * `psrSpecTemplates`) is already modeled as the 3 `data.kind` values
 * (`record`/`offering`/`template`) documented in registry.ts's `psr` entry —
 * this file only owns the typed-spec gate.
 */
import { ImplementationRecord } from "../../db/models";
import { BadRequestError } from "../../lib/errors";

export interface PsrSpecAttribute {
  id: string;
  name: string;
  type: "text" | "number" | "boolean" | "select" | "textarea";
  required?: boolean;
  options?: string[];
}

const BOOLEAN_VALUES = new Set(["true", "false", "yes", "no", ""]);

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || (typeof v === "string" && v.trim() === "");
}

/**
 * Validates a `psr` offering's `spec` values against its template's
 * attribute schema. Pure/synchronous so it can be exercised without a
 * database — the async lookup of the template lives in
 * `assertPsrOfferingSpec` below.
 */
export function validatePsrSpec(attributes: PsrSpecAttribute[], spec: Record<string, unknown>): void {
  const errors: string[] = [];
  for (const attr of attributes) {
    const value = spec[attr.id];
    if (attr.required && isEmpty(value)) {
      errors.push(`"${attr.name}" is required`);
      continue;
    }
    if (isEmpty(value)) continue;
    switch (attr.type) {
      case "number":
        if (typeof value !== "number" && Number.isNaN(Number(value))) {
          errors.push(`"${attr.name}" must be a number`);
        }
        break;
      case "boolean":
        if (!BOOLEAN_VALUES.has(typeof value === "boolean" ? String(value) : String(value).toLowerCase())) {
          errors.push(`"${attr.name}" must be a boolean`);
        }
        break;
      case "select":
        if (!(attr.options ?? []).includes(String(value))) {
          errors.push(`"${attr.name}" must be one of: ${(attr.options ?? []).join(", ")}`);
        }
        break;
      case "text":
      case "textarea":
        if (typeof value !== "string") errors.push(`"${attr.name}" must be text`);
        break;
    }
  }
  if (errors.length) throw new BadRequestError(`Invalid specification: ${errors.join("; ")}`, "INVALID_PSR_SPEC");
}

/**
 * Looks up the offering's linked spec template (a `psr` record with
 * `data.kind === "template"`) and validates `spec` against it. A missing/
 * stale `templateId` is swallowed, not rejected — same convention as
 * `trainingLifecycle.ts`'s `withOptionalGap` for a stale `gapId`: the
 * offering form lets a template be unset entirely, so a dangling reference
 * must degrade to "no schema to check against", not a hard error.
 */
export async function assertPsrOfferingSpec(orgId: string, data: Record<string, unknown>): Promise<void> {
  if (data.kind !== "offering") return;
  const templateId = data.templateId;
  if (typeof templateId !== "string" || !templateId) return;
  const tpl = await ImplementationRecord.findOne({ where: { id: templateId, module: "psr", orgId } });
  if (!tpl || (tpl.data as Record<string, unknown> | null)?.kind !== "template") return;
  const attributes = ((tpl.data as Record<string, unknown>).attributes ?? []) as PsrSpecAttribute[];
  const spec = (data.spec ?? {}) as Record<string, unknown>;
  validatePsrSpec(attributes, spec);
}
