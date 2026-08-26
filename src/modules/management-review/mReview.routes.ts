import { Router } from "express";
import * as c from "./mReview.controller";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

const read = requireAction(ACTIONS.MREVIEW_READ);
const manage = requireAction(ACTIONS.MREVIEW_MANAGE);

export const mReviewRoutes = Router();

mReviewRoutes.get("/", read, c.list);
mReviewRoutes.post("/", manage, c.create);
mReviewRoutes.get("/:id", read, c.get);
mReviewRoutes.put("/:id", manage, c.update);
mReviewRoutes.post("/:id/status", manage, c.setStatus);
mReviewRoutes.post("/:id/record", manage, c.record);
