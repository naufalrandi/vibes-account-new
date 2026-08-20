import { CompetenceSkill, CompetenceTraining } from "../../db/models";
import {
  BASE_SKILLS, SKILL_LIBRARY_HARD, SKILL_LIBRARY_SOFT, DEFAULT_HARD_METHODS, DEFAULT_SOFT_METHODS,
  TRAINING_LIBRARY, skillDescription, trainingDescription,
} from "../reference/reference.data";

/**
 * Global (org_id NULL) Competence Library seed — OD's live `rolesInit()` path
 * (index.html:16740-16762): `db.compSkills` base 8 (sk1..sk8) topped up with
 * `compSkillLib()`'s 172 hard / 116 soft names, plus `db.compTraining`'s 21
 * training courses. Mirrors the global-row pattern already used for the
 * exam-bank seed (`ensureInstrumentSeed`, competence.instrument.service.ts):
 * `orgId: null` rows visible to every tenant via the existing `orgClause`
 * dual-model scoping in `competence.service.ts`.
 *
 * Unlike `ensureInstrumentSeed`'s single `count > 0 → return` gate, this seed
 * cannot key its "already ran" check off "any global CompetenceSkill row
 * exists": `ensureBankSkill` (competence.instrument.service.ts) also creates
 * global, org_id-NULL, type:"hard" `CompetenceSkill` rows (one per exam-bank
 * skill) independently of this seed, and either seeder can run first. Gating
 * on "any global row" would make this seed a permanent no-op whenever the
 * bank seed happens to run first. Instead this gates on "any global *soft*
 * skill exists" — `ensureBankSkill` never creates a `type:"soft"` row, so
 * that's a safe, cheap, order-independent proxy for "this seed has already
 * run" while staying a single indexed COUNT query on the common path.
 *
 * The seed body itself still performs OD's real top-up: it reads every
 * existing global skill (whichever seeder created it), skips any name that
 * already exists case-insensitively (OD's `have` map, index.html:16750), and
 * backfills a missing description on an existing row — so a bank-seeded
 * "Internal Auditing"/"Risk Assessment"/etc. row (created with
 * `description: null`) still gets its library description filled in here,
 * exactly like OD's own top-up would.
 */
export async function ensureSkillLibrarySeed(): Promise<void> {
  const alreadySoft = await CompetenceSkill.count({ where: { orgId: null, type: "soft" } });
  if (alreadySoft > 0) return;

  const existing = await CompetenceSkill.findAll({ where: { orgId: null } });
  const have = new Map<string, CompetenceSkill>();
  for (const row of existing) have.set(row.name.toLowerCase(), row);

  // Backfill an empty description on anything already present (OD 16750's
  // `if(!s.description)s.description=compSkillDesc(s.name,s.type)`).
  for (const row of existing) {
    if (!row.description) {
      row.description = skillDescription(row.name, row.type === "soft" ? "soft" : "hard");
      await row.save();
    }
  }

  interface NewSkillRow { orgId: null; name: string; type: "hard" | "soft"; description: string; methods: string[] }
  const toCreate: NewSkillRow[] = [];
  const addIfMissing = (name: string, type: "hard" | "soft", methods: readonly string[]) => {
    const key = name.toLowerCase();
    if (have.has(key)) return;
    have.set(key, {} as CompetenceSkill); // mark seen within this run so within-batch dup names never double-insert
    toCreate.push({ orgId: null, name, type, description: skillDescription(name, type), methods: [...methods] });
  };

  // OD seeds the 8 base skills first (their own casing/methods win any
  // case-insensitive collision with the library), then tops up the library.
  for (const b of BASE_SKILLS) addIfMissing(b.name, b.type, b.methods);
  for (const n of SKILL_LIBRARY_HARD) addIfMissing(n, "hard", DEFAULT_HARD_METHODS);
  for (const n of SKILL_LIBRARY_SOFT) addIfMissing(n, "soft", DEFAULT_SOFT_METHODS);

  if (toCreate.length) await CompetenceSkill.bulkCreate(toCreate);
}

/**
 * Global (org_id NULL) training catalog seed — OD `db.compTraining`
 * (index.html:16751-16759): 6 standards x 3 tiers (18, source 'SP') + 3 fixed
 * courses ('Risk Management Fundamentals' SP, 'Data Privacy Awareness' and
 * 'Root Cause Analysis' Tenant) = 21. No other seeder touches
 * `CompetenceTraining`, so — unlike the skill seed above — a plain
 * `count > 0 → return` gate on any global row is safe here.
 */
export async function ensureTrainingCatalogSeed(): Promise<void> {
  const already = await CompetenceTraining.count({ where: { orgId: null } });
  if (already > 0) return;
  await CompetenceTraining.bulkCreate(
    TRAINING_LIBRARY.map((t) => ({ orgId: null, name: t.name, source: t.source, description: trainingDescription(t.name) })),
  );
}
