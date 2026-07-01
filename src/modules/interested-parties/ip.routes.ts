import { Router } from "express";
import * as c from "./ip.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

const read = requireAction(ACTIONS.IP_READ);
const manage = requireAction(ACTIONS.IP_MANAGE);

export const interestedPartyRoutes = Router();

// Parties
interestedPartyRoutes.get("/parties", read, c.listParties);
interestedPartyRoutes.post("/parties", manage, c.createParty);
interestedPartyRoutes.get("/parties/:id", read, c.getParty);
interestedPartyRoutes.put("/parties/:id", manage, c.updateParty);
interestedPartyRoutes.post("/parties/:id/archive", manage, c.archiveParty);

// Requirements
interestedPartyRoutes.get("/requirements", read, c.listRequirements);
interestedPartyRoutes.post("/requirements", manage, c.createRequirement);
interestedPartyRoutes.put("/requirements/:id", manage, c.updateRequirement);
interestedPartyRoutes.post("/requirements/:id/status", manage, c.setRequirementStatus);
interestedPartyRoutes.post("/requirements/:id/raise-risk", manage, c.raiseRisk);
interestedPartyRoutes.post("/requirements/:id/obligations", manage, c.linkObligations);
interestedPartyRoutes.post("/requirements/:id/archive", manage, c.archiveRequirement);
