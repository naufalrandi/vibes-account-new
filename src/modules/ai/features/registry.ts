import fs from "node:fs";
import path from "node:path";
import type { AiFeatureDef } from "./types";

/**
 * Every `<key>.feature.ts` (`.js` once built) in this directory is a feature.
 * Adding a feature = adding a file; nothing else registers it.
 * `loadFeatures()` is idempotent and awaited by every caller before
 * `getFeature` / `listFeatures`.
 */
const FEATURE_FILE = /^[\w-]+\.feature\.(ts|js)$/;
const KEY_RE = /^[a-z][a-z0-9-]{0,59}$/;

const features = new Map<string, AiFeatureDef>();
let loading: Promise<void> | null = null;

/** Add one feature; throws on a malformed definition or a duplicate feature/schedule key. */
export function registerFeature(def: AiFeatureDef, source = "registerFeature()"): void {
  if (!def || typeof def !== "object" || !KEY_RE.test(def.key ?? "")) {
    throw new Error(`${source}: a feature needs a lowercase key matching ${KEY_RE}`);
  }
  if (features.has(def.key)) throw new Error(`${source}: duplicate AI feature key "${def.key}"`);
  for (const [name, action] of Object.entries(def.actions ?? {})) {
    if (!KEY_RE.test(name)) throw new Error(`${source}: action "${name}" must match ${KEY_RE}`);
    if (typeof action.run !== "function" || !action.input || !action.permission) {
      throw new Error(`${source}: action "${name}" needs permission, input and run`);
    }
  }
  const scheduleKeys = new Set([...features.values()].flatMap((f) => (f.schedules ?? []).map((s) => s.key)));
  for (const s of def.schedules ?? []) {
    if (scheduleKeys.has(s.key)) throw new Error(`${source}: duplicate AI schedule key "${s.key}"`);
    if (!(s.everyMinutes >= 1)) throw new Error(`${source}: schedule "${s.key}" needs everyMinutes >= 1`);
    scheduleKeys.add(s.key);
  }
  features.set(def.key, def);
}

/** Import every feature file in `dir` (default: this directory). */
export function loadFeatures(dir = __dirname): Promise<void> {
  loading ??= (async () => {
    const files = fs.readdirSync(dir).filter((f) => FEATURE_FILE.test(f) && !f.endsWith(".d.ts")).sort();
    for (const file of files) {
      const mod = (await import(path.join(dir, file))) as { default?: AiFeatureDef; feature?: AiFeatureDef };
      // `import()` of a CommonJS build nests the exports one level deeper.
      const nested = (mod.default as { default?: AiFeatureDef; feature?: AiFeatureDef } | undefined);
      const def = mod.feature ?? nested?.feature ?? nested?.default ?? mod.default;
      registerFeature(def as AiFeatureDef, file);
    }
  })().catch((e) => {
    loading = null;
    throw e;
  });
  return loading;
}

function assertLoaded(): void {
  if (!loading) throw new Error("AI features are not loaded — await loadFeatures() first");
}

export function getFeature(key: string): AiFeatureDef | undefined {
  assertLoaded();
  return features.get(key);
}

export function listFeatures(): AiFeatureDef[] {
  assertLoaded();
  return [...features.values()].sort((a, b) => a.key.localeCompare(b.key));
}

/** Tests only: forget everything so a test can load from a fixture directory. */
export function resetFeatureRegistry(): void {
  features.clear();
  loading = null;
}
