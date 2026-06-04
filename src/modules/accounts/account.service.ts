import { Op, type WhereOptions } from "sequelize";
import { Account } from "../../db/models";
import type { AccountStatus } from "../../db/models/account.model";
import type { AuthContext } from "../../lib/scope";
import { writeAudit } from "../audit/audit.service";
import { NotFoundError } from "../../lib/errors";

export interface CreateAccountInput {
  name: string;
  description?: string | null;
  provider?: string | null;
  externalId?: string | null;
  role?: string | null;
  status?: AccountStatus;
}

export type UpdateAccountInput = Partial<CreateAccountInput>;

export interface ListAccountFilters {
  search?: string;
  status?: AccountStatus;
  role?: string;
}

export interface ListAccountsResult {
  rows: Account[];
  total: number;
}

/**
 * Build the WHERE clause for a list query. The org filter is always taken from
 * the authenticated context — never from request input — so a caller can only
 * ever see its own organization's accounts. `search` matches name, description,
 * provider, or external identifier case-insensitively; `status` and `role`
 * filter on their respective columns.
 */
function listWhere(auth: AuthContext, filters: ListAccountFilters): WhereOptions {
  const and: WhereOptions[] = [{ orgId: auth.orgId }];
  if (filters.status) and.push({ status: filters.status });
  if (filters.role) and.push({ role: filters.role });
  if (filters.search) {
    const term = `%${filters.search}%`;
    and.push({
      [Op.or]: [
        { name: { [Op.iLike]: term } },
        { description: { [Op.iLike]: term } },
        { provider: { [Op.iLike]: term } },
        { externalId: { [Op.iLike]: term } },
      ],
    });
  }
  return { [Op.and]: and };
}

export async function listAccounts(
  auth: AuthContext,
  filters: ListAccountFilters = {},
): Promise<ListAccountsResult> {
  const { rows, count } = await Account.findAndCountAll({
    where: listWhere(auth, filters),
    order: [["createdAt", "DESC"]],
  });
  return { rows, total: count };
}

/** Resolve a single account owned by the actor's org, or 404. */
async function requireOwnedAccount(auth: AuthContext, id: string): Promise<Account> {
  const account = await Account.findOne({ where: { id, orgId: auth.orgId } });
  if (!account) throw new NotFoundError("Account does not exist", "ACCOUNT_NOT_FOUND");
  return account;
}

export async function createAccount(
  auth: AuthContext,
  input: CreateAccountInput,
  ip: string | null,
): Promise<Account> {
  const account = await Account.create({
    orgId: auth.orgId,
    name: input.name,
    description: input.description ?? null,
    provider: input.provider ?? null,
    externalId: input.externalId ?? null,
    role: input.role ?? null,
    status: input.status ?? "Active",
  });
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    action: "account.created",
    entityType: "Account",
    entityId: account.id,
    sourceIp: ip,
    result: "Success",
  });
  return account;
}

export async function updateAccount(
  auth: AuthContext,
  id: string,
  input: UpdateAccountInput,
  ip: string | null,
): Promise<Account> {
  const account = await requireOwnedAccount(auth, id);
  if (input.name !== undefined) account.name = input.name;
  if (input.description !== undefined) account.description = input.description ?? null;
  if (input.provider !== undefined) account.provider = input.provider ?? null;
  if (input.externalId !== undefined) account.externalId = input.externalId ?? null;
  if (input.role !== undefined) account.role = input.role ?? null;
  if (input.status !== undefined) account.status = input.status;
  await account.save();

  await writeAudit({
    actorUserId: auth.userId,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    action: "account.updated",
    entityType: "Account",
    entityId: account.id,
    sourceIp: ip,
    result: "Success",
  });
  return account;
}

export async function deleteAccount(auth: AuthContext, id: string, ip: string | null): Promise<void> {
  const account = await requireOwnedAccount(auth, id);
  await account.destroy();
  await writeAudit({
    actorUserId: auth.userId,
    organizationId: auth.orgId,
    tenantId: auth.tenantId,
    action: "account.deleted",
    entityType: "Account",
    entityId: id,
    sourceIp: ip,
    result: "Success",
  });
}
