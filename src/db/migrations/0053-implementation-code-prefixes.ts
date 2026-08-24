import type { QueryInterface } from "sequelize";
import type { Migration } from "../migrate";

/**
 * Realigns `implementation_records.code` prefixes with OD 1:1 (they drifted
 * during the initial port). New codes already come out right once
 * registry.ts / implementation.service.ts / awarenessControl.ts ship
 * alongside this migration — this rewrites EXISTING rows so the register
 * reads consistently (no row is left stuck under the old prefix while every
 * new sibling gets the new one).
 *
 *   module            old prefix   new prefix   OD source
 *   parties            IPX          IP           index.html:8663-8664 (orphaned register — see registry.ts)
 *   work-units         WKU          WU           index.html:9070      (orphaned register — see registry.ts)
 *   risks              RSK          RISK         index.html:8121
 *   concerns           CNC          CON          index.html:11336
 *   nonconformities    NCR          NC           index.html:11364
 *   reviews            MRV          MR           index.html:10882
 *   training           TRN          TP           index.html tpForm region (~13932-14225)
 *   awareness          AWR          AWP          index.html:14365 (awNewId(db.awPrograms,'AWP-'))
 *
 * `context` is separate: its prefix is DYNAMIC (the code of the
 * "Organizational Context" framework element, falling back to "FWE-001"),
 * and — unlike every other register — its numeric suffix is NOT zero-padded
 * (OD `ocNewId`, app.html:12332). Existing "OCX-####" rows are
 * renumbered GLOBALLY (across every org, in creation order) as "<prefix>-<n>"
 * — `implementation_records` has a UNIQUE constraint on (module, code) alone
 * (migration 0015), with no org_id in it, so a per-org restart-at-1 would
 * mint the same code for two different orgs' first row and fail the
 * constraint. This matches `contextCode()` in implementation.service.ts,
 * which counts the same way for the same reason.
 *
 * Cross-reference rewrite: three JSONB fields elsewhere in the table store
 * ANOTHER record's `code` verbatim and would otherwise dangle after the
 * rename above:
 *   - `data.sourceConcernCode` (routeConcern) — a concerns code (CNC → CON)
 *   - `data.routedRecordCode` (routeConcern, on the concerns row itself) —
 *     the routed nonconformity's code (NCR → NC); incidents/improvements
 *     targets are untouched since their prefixes didn't change
 *   - `data.evals[].followupActionId` (awarenessControl `evalToTrainingPlan`)
 *     — a training code (TRN → TP) when a real Training Plan record was
 *     raised from a failed evaluation; the same field can also hold a plain
 *     "AWF-####" follow-up id, which is left alone
 *
 * Every step is idempotent, including resumption after a partial failure: the
 * `context` counter always starts from the highest number already present in
 * the target format rather than from zero, so re-running (whether nothing
 * changed or a previous attempt died halfway through) never re-mints a number
 * that collides with an already-migrated row; every other rewrite only
 * matches rows still under the OLD prefix/pattern, so a full re-run touches
 * zero rows once complete. `down` reverses the static-prefix swaps exactly
 * (they're lossless) and best-effort reverses `context` (renumbering back to
 * zero-padded "OCX-####" in the same global creation order) — precise
 * reversal of a dynamic, unpadded scheme is inherently approximate if the
 * prefix element's own code has since changed, but functionally equivalent
 * immediately after `up`.
 */

const STATIC_PREFIX_RENAMES: { module: string; from: string; to: string }[] = [
  { module: "parties", from: "IPX", to: "IP" },
  { module: "work-units", from: "WKU", to: "WU" },
  { module: "risks", from: "RSK", to: "RISK" },
  { module: "concerns", from: "CNC", to: "CON" },
  { module: "nonconformities", from: "NCR", to: "NC" },
  { module: "reviews", from: "MRV", to: "MR" },
  { module: "training", from: "TRN", to: "TP" },
  { module: "awareness", from: "AWR", to: "AWP" },
];

interface JsonbCodeRow {
  id: string;
  // Selected as `::text` and parsed explicitly (rather than relying on the
  // driver's default JSONB→object coercion for raw queries) so this doesn't
  // depend on pg type-parser registration.
  data_text: string;
}

export const up: Migration = async ({ context: q }) => {
  // --- 1. Static prefix swaps (code column only — numeric suffix untouched) ---
  for (const { module, from, to } of STATIC_PREFIX_RENAMES) {
    await q.sequelize.query(
      `UPDATE "implementation_records"
       SET "code" = regexp_replace("code", :fromPattern, :toPrefix)
       WHERE "module" = :module AND "code" ~ :matchPattern`,
      { replacements: { module, fromPattern: `^${from}-`, toPrefix: `${to}-`, matchPattern: `^${from}-\\d+$` } },
    );
  }

  // --- 2. `context`: dynamic prefix, unpadded, renumbered GLOBALLY -----------
  // `implementation_records` has a UNIQUE constraint on (module, code) alone
  // (migration 0015 `implementation_module_code_unique`) — no org_id — so
  // renumbering "restart at 1 per org" would mint the same code for two
  // different orgs' first row and fail the constraint. Numbering globally
  // across every org (ordered by creation time) sidesteps that and matches
  // `contextCode()` in implementation.service.ts, which counts the same way.
  const [fweRows] = await q.sequelize.query(
    `SELECT "code" FROM "framework_elements" WHERE "name" = 'Organizational Context' LIMIT 1`,
  );
  const contextPrefix = (fweRows as { code?: string }[])[0]?.code ?? "FWE-001";
  const contextPattern = `^${contextPrefix.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}-(\\d+)$`;

  // Start the counter from the highest number already in the new format
  // (not 0) so a re-run after a partial failure resumes instead of
  // re-minting numbers that collide with rows a previous attempt already
  // renumbered — true idempotency, not just "first full run is safe".
  const [already] = await q.sequelize.query(
    `SELECT "code" FROM "implementation_records" WHERE "module" = 'context' AND "code" ~ :contextPattern`,
    { replacements: { contextPattern } },
  );
  const contextSuffixRe = new RegExp(contextPattern);
  let ctxSeq = 0;
  for (const row of already as { code: string }[]) {
    const m = row.code.match(contextSuffixRe);
    const n = m ? Number.parseInt(m[1], 10) : NaN;
    if (Number.isFinite(n) && n > ctxSeq) ctxSeq = n;
  }

  const [ctxRows] = await q.sequelize.query(
    `SELECT "id" FROM "implementation_records"
     WHERE "module" = 'context' AND "code" !~ :contextPattern
     ORDER BY "created_at" ASC`,
    { replacements: { contextPattern } },
  );
  for (const row of ctxRows as { id: string }[]) {
    ctxSeq += 1;
    await q.sequelize.query(`UPDATE "implementation_records" SET "code" = :code WHERE "id" = :id`, {
      replacements: { code: `${contextPrefix}-${ctxSeq}`, id: row.id },
    });
  }

  // --- 3. Cross-references: `data.sourceConcernCode` (any module) -----------
  await q.sequelize.query(
    `UPDATE "implementation_records"
     SET "data" = jsonb_set("data", '{sourceConcernCode}', to_jsonb(regexp_replace("data"->>'sourceConcernCode', '^CNC-', 'CON-')))
     WHERE "data"->>'sourceConcernCode' ~ '^CNC-\\d+$'`,
  );

  // --- 4. Cross-reference: `data.routedRecordCode` (concerns rows only) -----
  await q.sequelize.query(
    `UPDATE "implementation_records"
     SET "data" = jsonb_set("data", '{routedRecordCode}', to_jsonb(regexp_replace("data"->>'routedRecordCode', '^NCR-', 'NC-')))
     WHERE "module" = 'concerns' AND "data"->>'routedRecordCode' ~ '^NCR-\\d+$'`,
  );

  // --- 5. Cross-reference: `data.evals[].followupActionId` (awareness-campaigns) ---
  await rewriteEvalFollowupCodes(q, /^TRN-\d+$/, (code) => code.replace(/^TRN-/, "TP-"));
};

export const down: Migration = async ({ context: q }) => {
  // --- Reverse step 5: evals[].followupActionId back to TRN- -----------------
  await rewriteEvalFollowupCodes(q, /^TP-\d+$/, (code) => code.replace(/^TP-/, "TRN-"));

  // --- Reverse step 4: routedRecordCode back to NCR- --------------------------
  await q.sequelize.query(
    `UPDATE "implementation_records"
     SET "data" = jsonb_set("data", '{routedRecordCode}', to_jsonb(regexp_replace("data"->>'routedRecordCode', '^NC-', 'NCR-')))
     WHERE "module" = 'concerns' AND "data"->>'routedRecordCode' ~ '^NC-\\d+$'`,
  );

  // --- Reverse step 3: sourceConcernCode back to CNC- -------------------------
  await q.sequelize.query(
    `UPDATE "implementation_records"
     SET "data" = jsonb_set("data", '{sourceConcernCode}', to_jsonb(regexp_replace("data"->>'sourceConcernCode', '^CON-', 'CNC-')))
     WHERE "data"->>'sourceConcernCode' ~ '^CON-\\d+$'`,
  );

  // --- Reverse step 2: context back to zero-padded OCX-#### (global sequence,
  // same (module, code) uniqueness reasoning — and same resume-from-max
  // idempotency — as `up` above) ----------------------------------------------
  const [alreadyOcx] = await q.sequelize.query(
    `SELECT "code" FROM "implementation_records" WHERE "module" = 'context' AND "code" ~ '^OCX-\\d+$'`,
  );
  let ctxSeq = 0;
  for (const row of alreadyOcx as { code: string }[]) {
    const n = Number.parseInt(row.code.slice("OCX-".length), 10);
    if (Number.isFinite(n) && n > ctxSeq) ctxSeq = n;
  }

  const [ctxRows] = await q.sequelize.query(
    `SELECT "id" FROM "implementation_records"
     WHERE "module" = 'context' AND "code" !~ '^OCX-\\d+$'
     ORDER BY "created_at" ASC`,
  );
  for (const row of ctxRows as { id: string }[]) {
    ctxSeq += 1;
    await q.sequelize.query(`UPDATE "implementation_records" SET "code" = :code WHERE "id" = :id`, {
      replacements: { code: `OCX-${String(ctxSeq).padStart(4, "0")}`, id: row.id },
    });
  }

  // --- Reverse step 1: static prefix swaps ------------------------------------
  for (const { module, from, to } of STATIC_PREFIX_RENAMES) {
    await q.sequelize.query(
      `UPDATE "implementation_records"
       SET "code" = regexp_replace("code", :toPattern, :fromPrefix)
       WHERE "module" = :module AND "code" ~ :matchPattern`,
      { replacements: { module, toPattern: `^${to}-`, fromPrefix: `${from}-`, matchPattern: `^${to}-\\d+$` } },
    );
  }
};

/**
 * `data.evals[]` is a JSONB array nested inside `awareness-campaigns` rows —
 * there's no single-expression Postgres rewrite for "patch one field inside
 * every matching array element", so this loads each campaign row, patches the
 * array in JS, and writes it back whole. Only rows with at least one matching
 * `followupActionId` are written.
 */
async function rewriteEvalFollowupCodes(
  q: QueryInterface,
  matches: RegExp,
  rewrite: (code: string) => string,
): Promise<void> {
  const [rows] = await q.sequelize.query(
    `SELECT "id", "data"::text AS data_text FROM "implementation_records" WHERE "module" = 'awareness-campaigns'`,
  );
  for (const row of rows as JsonbCodeRow[]) {
    const data = JSON.parse(row.data_text) as Record<string, unknown>;
    const evals = Array.isArray(data.evals) ? (data.evals as Record<string, unknown>[]) : [];
    let changed = false;
    const nextEvals = evals.map((e) => {
      const fid = e.followupActionId;
      if (typeof fid === "string" && matches.test(fid)) {
        changed = true;
        return { ...e, followupActionId: rewrite(fid) };
      }
      return e;
    });
    if (!changed) continue;
    await q.sequelize.query(`UPDATE "implementation_records" SET "data" = jsonb_set("data", '{evals}', :evals::jsonb) WHERE "id" = :id`, {
      replacements: { evals: JSON.stringify(nextEvals), id: row.id },
    });
  }
}
