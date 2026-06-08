import { Router } from "express";
import * as c from "./billing.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const billingRoutes = Router();

// Plans — full CRUD (the configurable billing entity).
billingRoutes.get("/plans", requireAction(ACTIONS.PLAN_READ), c.listPlans);
billingRoutes.post("/plans", requireAction(ACTIONS.PLAN_CREATE), c.createPlan);
billingRoutes.put("/plans/:id", requireAction(ACTIONS.PLAN_UPDATE), c.updatePlan);

// Read aggregations (derived from invoices + partner agreements).
billingRoutes.get("/dashboard", requireAction(ACTIONS.BILLING_READ), c.dashboard);
billingRoutes.get("/subscriptions", requireAction(ACTIONS.BILLING_READ), c.listSubscriptions);
billingRoutes.get("/invoices", requireAction(ACTIONS.BILLING_READ), c.listInvoices);
billingRoutes.get("/payments", requireAction(ACTIONS.BILLING_READ), c.listPayments);
billingRoutes.get("/receipts", requireAction(ACTIONS.BILLING_READ), c.listReceipts);
billingRoutes.get("/revenue-share", requireAction(ACTIONS.BILLING_READ), c.listRevenueShare);
billingRoutes.get("/payouts", requireAction(ACTIONS.BILLING_READ), c.listPayouts);
