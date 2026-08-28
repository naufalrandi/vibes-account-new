import { describe, expect, it } from "vitest";
import { IMPLEMENTATION_DATA_SCHEMAS } from "./dataSchemas";
import snapshot from "./registry.snapshot.json";

/**
 * Payload-contract coverage gate.
 *
 * `dataSchemas.ts` gives 30 of the 47 implementation modules a `.strict()` zod
 * schema. The other 17 stay on the open `data` JSONB **because OD gives them no
 * field contract to derive** — they reach OD's generic `renderTenantModule()`
 * fallback (js/core.js:8957), which renders an intent line, a card grid of
 * `TN_MODULES[key].sub` labels and an empty register whose New Record button is
 * wired to `toast('New record (scaffold)')`. Verified against the OD source:
 * none of the 17 has a dedicated renderer.
 *
 * That reasoning currently lives only in a comment, so nothing notices when it
 * stops being true. This pins it:
 *
 * - a *new* module without a schema fails, so the "it's a scaffold" claim has to
 *   be made deliberately rather than by omission;
 * - a scaffold that *gains* a schema has to be removed from the list here, which
 *   is the moment to confirm OD actually grew a field contract for it.
 *
 * When an OD scaffold does get built out, the order is: derive the field list
 * from OD's new renderer, add the schema, drop the key from `OD_SCAFFOLDS`.
 */

/** Modules OD renders through the scaffold fallback — no field contract exists to port. */
const OD_SCAFFOLDS = [
  "cab-appeals",
  "cab-audits",
  "cab-decisions",
  "cab-impartiality",
  "cab-schemes",
  "capa",
  "hira",
  "lab-equipment",
  "lab-methods",
  "lab-pt",
  "lab-uncertainty",
  "mmr",
  "pcb-appeals",
  "pcb-candidates",
  "pcb-decisions",
  "pcb-exams",
  "pcb-schemes",
].sort();

describe("implementation payload-schema coverage", () => {
  const modules = Object.keys(snapshot as Record<string, unknown>).sort();
  const withSchema = new Set(Object.keys(IMPLEMENTATION_DATA_SCHEMAS));

  it("gives every non-scaffold module a strict payload schema", () => {
    const unscheduled = modules.filter((m) => !withSchema.has(m) && !OD_SCAFFOLDS.includes(m));
    expect(unscheduled).toEqual([]);
  });

  it("keeps the scaffold list honest — a module with a schema is no longer a scaffold", () => {
    expect(OD_SCAFFOLDS.filter((m) => withSchema.has(m))).toEqual([]);
  });

  it("lists no scaffold that the registry no longer has", () => {
    expect(OD_SCAFFOLDS.filter((m) => !modules.includes(m))).toEqual([]);
  });
});
