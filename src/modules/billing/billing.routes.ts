import { Router } from "express";
import * as c from "./billing.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const billingRoutes = Router();

billingRoutes.get("/plans", requireAction(ACTIONS.BILLING_READ), c.listPlans);
billingRoutes.post("/plans", requireAction(ACTIONS.BILLING_MANAGE), c.createPlan);
billingRoutes.put("/plans/:id", requireAction(ACTIONS.BILLING_MANAGE), c.updatePlan);

billingRoutes.get("/dashboard", requireAction(ACTIONS.BILLING_READ), c.dashboard);
billingRoutes.get("/subscriptions", requireAction(ACTIONS.BILLING_READ), c.listSubscriptions);
billingRoutes.get("/invoices", requireAction(ACTIONS.BILLING_READ), c.listInvoices);
billingRoutes.post("/invoices/:id/pay", requireAction(ACTIONS.BILLING_MANAGE), c.payInvoice);
billingRoutes.get("/payments", requireAction(ACTIONS.BILLING_READ), c.listPayments);
billingRoutes.get("/receipts", requireAction(ACTIONS.BILLING_READ), c.listReceipts);
billingRoutes.get("/revenue-share", requireAction(ACTIONS.BILLING_READ), c.listRevenueShare);
billingRoutes.get("/payouts", requireAction(ACTIONS.BILLING_READ), c.listPayouts);
billingRoutes.post("/payouts/:id/mark-paid", requireAction(ACTIONS.BILLING_MANAGE), c.markPayoutPaid);
