import { Op, type Model, type ModelStatic, type Transaction } from "sequelize";
import { sequelize } from "../db/sequelize";

/**
 * Serialise a max+1 code generator. Takes `pg_advisory_xact_lock` on `key` so
 * two concurrent creators can't read the same max; the lock is held until the
 * transaction ends, so the INSERT that uses the code must run inside the `tx`
 * handed to `fn`. With no `tx`, opens (and commits) one around `fn`.
 */
export async function withCodeLock<T>(
  key: string,
  tx: Transaction | null | undefined,
  fn: (tx: Transaction) => Promise<T>,
): Promise<T> {
  const run = async (t: Transaction): Promise<T> => {
    await sequelize.query("SELECT pg_advisory_xact_lock(hashtext(:key))", {
      replacements: { key: `code:${key}` },
      transaction: t,
    });
    return fn(t);
  };
  return tx ? run(tx) : sequelize.transaction(run);
}

/** Highest numeric suffix among `<prefix>-<digits>` codes of `model` (0 when none). */
export async function maxCodeSeq(
  model: ModelStatic<Model>,
  prefix: string,
  tx: Transaction,
  where: Record<string, unknown> = {},
): Promise<number> {
  const rows = (await model.findAll({
    attributes: ["code"],
    where: { ...where, code: { [Op.like]: `${prefix}-%` } },
    transaction: tx,
    raw: true,
  })) as unknown as { code: string | null }[];
  const re = new RegExp(`^${prefix}-(\\d+)$`);
  let max = 0;
  for (const r of rows) {
    const m = re.exec(r.code ?? "");
    if (m) max = Math.max(max, Number(m[1]));
  }
  return max;
}
