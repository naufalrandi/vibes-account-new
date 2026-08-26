import { describe, expect, it } from "vitest";
import { BUSINESS_DATA_SCHEMAS } from "./dataSchemas";

/**
 * FE/BE business module-key parity (SOF-47), in the spirit of
 * `implementation/registry.snapshot.test.ts`: the frontend's set of module
 * keys must be a subset of the backend's registered `BUSINESS_DATA_SCHEMAS`
 * keys, or a request to that module can never reach a registered handler.
 *
 * `fe-vibes-new` has no single exported module-key list — keys are scattered
 * as `const MODULE = "..."` literals per page component, all routed through
 * `lib/api/realClient.ts`'s generic `listBusiness`/`createBusiness`/
 * `updateBusiness`/`deleteBusiness`. This list is a manually-maintained
 * mirror of every such literal (grep the FE repo for `MODULE = "` under
 * `fe-vibes-new/app` / `components` to refresh it) — update it whenever a FE
 * page starts or stops posting to a business module.
 */
const FE_POSTED_MODULE_KEYS = [
  "dn-clients",
  "dn-pentest",
  "dn-software",
  "ent-inq",
  "ent-leads",
  "ent-leads-people",
  "ent-projects",
  "ent-proposals",
  "ent-comp",
  "ent-minwage",
  "ent-orgstructure",
  "ent-payroll",
  "ent-doa",
  "ent-po",
  "ent-pr",
  "ent-recruitment",
  "ent-ss",
  "ent-suppliers",
  "ent-db-courses",
  "ex-cab",
  "mb-booking",
  "mb-support",
  "mb-vehicle",
] as const;

/**
 * Known drift as of SOF-47: these FE module keys have no backend
 * `BUSINESS_DATA_SCHEMAS` entry yet, so requests to them 404/fall through to
 * unvalidated writes. Tracked here (not silently ignored) so this test stays
 * green while still failing loudly the moment a *new*, unacknowledged key
 * drifts. Shrink this list — never grow it — as each module gets a real
 * backend registration; don't add newly-discovered drift here without
 * filing a follow-up to close it.
 */
const KNOWN_UNREGISTERED_FE_KEYS = new Set([
  "dn-pentest",
  "dn-software",
  "ent-orgstructure",
  "ent-doa",
  "ent-suppliers",
]);

describe("FE/BE business module-key drift (SOF-47)", () => {
  it("every FE-posted module key is either backend-registered or a tracked known gap", () => {
    const unregistered = FE_POSTED_MODULE_KEYS.filter((key) => !(key in BUSINESS_DATA_SCHEMAS));
    expect(new Set(unregistered)).toEqual(KNOWN_UNREGISTERED_FE_KEYS);
  });

  it("does not carry a known-gap entry that's actually already registered", () => {
    const stale = [...KNOWN_UNREGISTERED_FE_KEYS].filter((key) => key in BUSINESS_DATA_SCHEMAS);
    expect(stale).toEqual([]);
  });
});
