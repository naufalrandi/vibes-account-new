import { writeFileSync } from "node:fs";
import path from "node:path";
import { MS_MODULES } from "../src/modules/implementation/registry";

/**
 * Emits a deterministic, git-diffable snapshot of MS_MODULES (registry.ts) so
 * fe-vibes-new's registryParity.test.ts can assert the frontend's
 * IMPLEMENTATION_CONFIG never drifts from what the backend actually accepts.
 *
 * `assertStatus()` (implementation.service.ts:84-87) turns any status the FE
 * offers but the BE doesn't know into a hard 400, and `statuses[0]` is the
 * silent create default — so both membership AND order matter here. Object.entries
 * preserves MS_MODULES's own insertion order, and JSON.stringify serializes
 * object keys in that same insertion order every run (Node does not reorder
 * string keys), so this output is stable across runs — re-running this script
 * with no registry.ts change produces byte-identical output.
 */
const out: Record<string, { prefix: string; statuses: string[]; createStatuses?: string[] }> = {};
for (const [key, def] of Object.entries(MS_MODULES)) {
  out[key] = {
    prefix: def.prefix,
    statuses: [...def.statuses],
    ...(def.createStatuses ? { createStatuses: [...def.createStatuses] } : {}),
  };
}
writeFileSync(
  path.resolve(__dirname, "../src/modules/implementation/registry.snapshot.json"),
  JSON.stringify(out, null, 2) + "\n",
);
console.log(`wrote ${Object.keys(out).length} modules`);
