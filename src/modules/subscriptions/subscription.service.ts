import type { Transaction } from "sequelize";
import { Subscription } from "../../db/models";

export async function assignSubscription(orgId: string, plan: string, tx?: Transaction): Promise<Subscription> {
  return Subscription.create(
    { orgId, plan, entitlements: { userManagement: true }, status: "Active", startDate: new Date(), endDate: null },
    { transaction: tx },
  );
}
