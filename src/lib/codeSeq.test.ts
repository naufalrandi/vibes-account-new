import { describe, it, expect, vi, beforeEach } from "vitest";
import type { Model, ModelStatic, Transaction } from "sequelize";

const { query, transaction } = vi.hoisted(() => {
  (globalThis as { __SKIP_DB_SETUP__?: boolean }).__SKIP_DB_SETUP__ = true;
  return {
    query: vi.fn(async () => [[], 0]),
    transaction: vi.fn(async (fn: (t: unknown) => unknown) => fn({ id: "auto-tx" })),
  };
});
vi.mock("../db/sequelize", () => ({ sequelize: { query, transaction } }));

import { maxCodeSeq, withCodeLock } from "./codeSeq";

const tx = { id: "caller-tx" } as unknown as Transaction;

describe("withCodeLock", () => {
  beforeEach(() => { query.mockClear(); transaction.mockClear(); });

  it("takes the advisory xact lock on the caller's transaction before running fn", async () => {
    const order: string[] = [];
    query.mockImplementationOnce(async () => { order.push("lock"); return [[], 0]; });
    const out = await withCodeLock("TEN", tx, async (t) => { order.push("fn"); expect(t).toBe(tx); return 42; });
    expect(out).toBe(42);
    expect(order).toEqual(["lock", "fn"]);
    expect(query).toHaveBeenCalledWith("SELECT pg_advisory_xact_lock(hashtext(:key))", { replacements: { key: "code:TEN" }, transaction: tx });
    expect(transaction).not.toHaveBeenCalled();
  });

  it("opens its own transaction when none is given", async () => {
    await withCodeLock("MR", null, async (t) => expect(t).toEqual({ id: "auto-tx" }));
    expect(transaction).toHaveBeenCalledTimes(1);
  });
});

describe("maxCodeSeq", () => {
  it("returns the highest numeric suffix for the prefix, ignoring malformed codes", async () => {
    const findAll = vi.fn(async () => [{ code: "TEN-1001" }, { code: "TEN-1042" }, { code: "TEN-abc" }, { code: null }, { code: "TEN-7-x" }]);
    const model = { findAll } as unknown as ModelStatic<Model>;
    expect(await maxCodeSeq(model, "TEN", tx, { orgId: "o1" })).toBe(1042);
    expect(findAll).toHaveBeenCalledWith(expect.objectContaining({ transaction: tx, raw: true, where: expect.objectContaining({ orgId: "o1" }) }));
  });

  it("returns 0 when there are no codes yet", async () => {
    const model = { findAll: vi.fn(async () => []) } as unknown as ModelStatic<Model>;
    expect(await maxCodeSeq(model, "PAY", tx)).toBe(0);
  });
});
