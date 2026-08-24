import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { MS_MODULES, type RegisterModule } from "./registry";

/**
 * `registry.snapshot.json` is a manually-regenerated (`npm run
 * registry:snapshot`, `scripts/emit-registry-snapshot.ts`) committed
 * artifact — fe-vibes-new's `test/parity/registryParity.test.ts` gates the
 * frontend's `IMPLEMENTATION_CONFIG` against this file, NOT against
 * `MS_MODULES` directly. That means the FE↔BE gate only catches drift
 * between the frontend and the snapshot; it can never catch drift between
 * `registry.ts` and the snapshot itself, because nothing on the backend
 * checked that the two stay in sync (mutation-proved during the Wave P P-9
 * hand-off fix pass, finding F3: adding a bogus module to `MS_MODULES`
 * without regenerating the snapshot left the FE parity test green).
 *
 * This test closes that hole from the backend side: it re-derives the exact
 * same shape `emit-registry-snapshot.ts` writes and asserts it against the
 * committed file byte-for-shape, so a `registry.ts` edit that skips
 * `npm run registry:snapshot` fails loudly here instead of shipping a stale
 * snapshot that both "parity" gates read as ground truth.
 */
const SNAPSHOT_PATH = path.resolve(__dirname, "registry.snapshot.json");

type SnapshotEntry = { prefix: string; statuses: string[]; createStatuses?: string[] };

function deriveSnapshot(modules: Record<string, RegisterModule>): Record<string, SnapshotEntry> {
  const out: Record<string, SnapshotEntry> = {};
  for (const [key, def] of Object.entries(modules)) {
    out[key] = {
      prefix: def.prefix,
      statuses: [...def.statuses],
      ...(def.createStatuses ? { createStatuses: [...def.createStatuses] } : {}),
    };
  }
  return out;
}

describe("registry.snapshot.json matches MS_MODULES", () => {
  it("is exactly what emit-registry-snapshot.ts would produce right now", () => {
    const committed = JSON.parse(readFileSync(SNAPSHOT_PATH, "utf8")) as Record<string, SnapshotEntry>;
    const derived = deriveSnapshot(MS_MODULES);

    expect(
      committed,
      'registry.snapshot.json is stale — run "npm run registry:snapshot" and commit the result ' +
        "in the same change as the registry.ts edit that caused this diff.",
    ).toEqual(derived);
  });
});
