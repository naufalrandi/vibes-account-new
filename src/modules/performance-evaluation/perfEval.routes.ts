import { Router } from "express";
import * as c from "./perfEval.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

const read = requireAction(ACTIONS.PERFEVAL_READ);
const manage = requireAction(ACTIONS.PERFEVAL_MANAGE);

export const perfEvalRoutes = Router();

perfEvalRoutes.get("/", read, c.list);
perfEvalRoutes.post("/", manage, c.create);
perfEvalRoutes.get("/indicators", read, c.indicators);
perfEvalRoutes.get("/:id", read, c.get);
perfEvalRoutes.put("/:id", manage, c.update);
