import { Router } from "express";
import * as c from "./poConfirmation.controller";

/** Public supplier confirmation link — no authentication by design. */
export const poConfirmationRoutes = Router();
poConfirmationRoutes.get("/:id/confirmation", c.get);
poConfirmationRoutes.post("/:id/confirmation", c.respond);
