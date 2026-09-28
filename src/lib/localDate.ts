import { Organization } from "../db/models";

/** Platform default when an org has no (or an invalid) timezone configured. */
export const DEFAULT_TZ = "Asia/Jakarta";

/**
 * Today's calendar date (`YYYY-MM-DD`) in `tz`. `toISOString().slice(0, 10)`
 * is the UTC date, which in Jakarta is still "yesterday" until 07:00 local.
 */
export function todayInTz(tz: string = DEFAULT_TZ, now: Date = new Date()): string {
  let parts: Intl.DateTimeFormatPart[];
  try {
    parts = new Intl.DateTimeFormat("en-US", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  } catch {
    if (tz === DEFAULT_TZ) throw new Error(`Timezone ${DEFAULT_TZ} is not supported by this runtime`);
    return todayInTz(DEFAULT_TZ, now); // an org saved an unknown zone name
  }
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

/** Today in the org's configured timezone (Org Profile → System Defaults), else the platform default. */
export async function orgToday(orgId: string): Promise<string> {
  const org = await Organization.findByPk(orgId, { attributes: ["id", "systemDefaults"] });
  return todayInTz(org?.systemDefaults?.timezone || DEFAULT_TZ);
}
