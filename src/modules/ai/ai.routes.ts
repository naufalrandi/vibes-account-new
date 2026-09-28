import { Router } from "express";
import * as c from "./ai.controller";
import * as f from "./features/features.controller";
import { rateLimit } from "../../middleware/rateLimit";
import { requireAction } from "../../middleware/requireAction";
import { ACTIONS } from "../iam/actions.catalog";

// The platform AI connection (Organization Settings → AI). `/status` is open to
// any authenticated user; everything else is Service-Owner settings.
export const aiRoutes = Router();
aiRoutes.get("/status", c.status);
aiRoutes.get("/connection", requireAction(ACTIONS.AI_SETTINGS_READ), c.getConnection);
aiRoutes.put("/connection", requireAction(ACTIONS.AI_SETTINGS_MANAGE), c.saveConnection);
aiRoutes.delete("/connection", requireAction(ACTIONS.AI_SETTINGS_MANAGE), c.deleteConnection);
aiRoutes.post("/connection/test", requireAction(ACTIONS.AI_SETTINGS_MANAGE), c.testConnection);
aiRoutes.post("/connection/models", requireAction(ACTIONS.AI_SETTINGS_MANAGE), c.listModels);

// AI feature framework (src/modules/ai/features/README.md). Feature actions
// carry their own permissions; flags are Service-Owner settings.
const invokeLimit = rateLimit({ windowMs: 60_000, max: 60, keyPrefix: "ai-feature-invoke" });
aiRoutes.get("/features", f.listFeatures);
aiRoutes.post("/features/:feature/:action", invokeLimit, f.invoke);
aiRoutes.get("/jobs/:id", f.getJob);
aiRoutes.post("/generations/:id/feedback", f.feedback);
aiRoutes.get("/usage", requireAction(ACTIONS.AI_SETTINGS_READ), f.usage);
aiRoutes.get("/feature-flags", requireAction(ACTIONS.AI_SETTINGS_MANAGE), f.getFlags);
aiRoutes.put("/feature-flags", requireAction(ACTIONS.AI_SETTINGS_MANAGE), f.setFlag);
