/**
 * SOF-381 — seeds OD's master business-process catalog (`db.bpCatalog`, 385
 * rows) into an org's `business_processes` register, transcribed verbatim
 * from `bpCatSeedIfNeeded()` (open-design modules.js:2026, see
 * `businessProcess.data.ts`). Mirrors the live `syncCatalog()` merge
 * (`process.service.ts`) — `sourceType: "Catalog"`, `catalogKey` set — but
 * keyed on the OD catalog id rather than a name-derived slug, since two
 * catalog names repeat across different groups ("Configuration Management",
 * "Network Administration") and only the OD id is unique per row.
 *
 * Idempotency: upsert by natural key `(orgId, catalogKey)` — the same pair
 * the `business_processes_org_catalog_key` unique index enforces.
 */
import { BusinessProcess } from "../models";
import { BP_CATALOG } from "./businessProcess.data";

export async function seedBpCatalog(orgId: string): Promise<void> {
  const existing = await BusinessProcess.findAll({ where: { orgId }, attributes: ["code"] });
  let maxCode = 0;
  for (const r of existing) {
    const m = /^BP-(\d+)$/.exec(r.code);
    if (m) maxCode = Math.max(maxCode, parseInt(m[1], 10));
  }

  for (const entry of BP_CATALOG) {
    const [, created] = await BusinessProcess.findOrCreate({
      where: { orgId, catalogKey: entry.odId },
      defaults: {
        orgId,
        code: `BP-${String(maxCode + 1).padStart(4, "0")}`,
        catalogKey: entry.odId,
        name: entry.name,
        group: entry.group,
        subgroup: entry.subgroup,
        description: entry.desc,
        status: "Active",
        sourceType: "Catalog",
        createdBy: "System",
      },
    });
    if (created) maxCode++;
  }
}
