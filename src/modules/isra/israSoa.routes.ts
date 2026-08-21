import { Router } from "express";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";
import * as controller from "./israSoa.controller";

const read = requireAction(ACTIONS.ISRA_LIBRARY_READ);
const manage = requireAction(ACTIONS.ISRA_LIBRARY_MANAGE);

export const israSoaRoutes = Router();

israSoaRoutes.get("/", read, controller.getSoa);
israSoaRoutes.put("/:annexRef/justification", manage, controller.saveSoaJustification);
