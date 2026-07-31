import { Router } from "express";
import * as c from "./auth.controller";
import { authenticate } from "../../middleware/authenticate";

export const authRoutes = Router();
authRoutes.post("/login", c.login);
authRoutes.post("/demo-link", c.demoLinkLogin);
authRoutes.post("/refresh", c.refresh);
authRoutes.post("/logout", c.logout);
authRoutes.post("/activate", c.activate);
authRoutes.post("/password/forgot", c.forgotPassword);
authRoutes.post("/password/reset", c.resetPassword);
// Unlike the token-based reset flow above, changing your own password requires
// a live session — `authenticate` is applied per-route since /v1/auth is
// otherwise mounted unauthenticated.
authRoutes.post("/password/change", authenticate, c.changePassword);
