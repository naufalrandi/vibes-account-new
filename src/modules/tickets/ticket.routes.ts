import { Router } from "express";
import * as c from "./ticket.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

export const ticketRoutes = Router();
ticketRoutes.get("/", requireAction(ACTIONS.TICKET_READ), c.list);
ticketRoutes.post("/", requireAction(ACTIONS.TICKET_CREATE), c.create);
// `/agents` before `/:id` so the literal wins over the param.
ticketRoutes.get("/agents", requireAction(ACTIONS.TICKET_MANAGE), c.agents);
ticketRoutes.get("/:id", requireAction(ACTIONS.TICKET_READ), c.get);
ticketRoutes.post("/:id/reply", requireAction(ACTIONS.TICKET_REPLY), c.reply);
ticketRoutes.post("/:id/attach", requireAction(ACTIONS.TICKET_REPLY), c.attach);
// Status + assignment are support-desk (SP) controls.
ticketRoutes.post("/:id/status", requireAction(ACTIONS.TICKET_MANAGE), c.status);
ticketRoutes.post("/:id/assign", requireAction(ACTIONS.TICKET_MANAGE), c.assign);
