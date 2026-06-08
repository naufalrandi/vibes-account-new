import { Router } from "express";
import * as c from "./business.controller";

// Business Unit registers (Enterprise / Datana / Motoran), keyed by :area/:module.
// Service-Owner-only is enforced in the service (assertServiceOwner), so these
// routes only require authentication (applied at mount).
export const businessRoutes = Router();
businessRoutes.get("/:area/:module", c.list);
businessRoutes.get("/:area/:module/:id", c.get);
businessRoutes.post("/:area/:module", c.create);
businessRoutes.put("/:area/:module/:id", c.update);
businessRoutes.delete("/:area/:module/:id", c.remove);
