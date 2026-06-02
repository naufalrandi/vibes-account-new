import { Router } from "express";
import * as c from "./auth.controller";

export const authRoutes = Router();
authRoutes.post("/login", c.login);
authRoutes.post("/refresh", c.refresh);
authRoutes.post("/logout", c.logout);
authRoutes.post("/activate", c.activate);
authRoutes.post("/password/forgot", c.forgotPassword);
authRoutes.post("/password/reset", c.resetPassword);
