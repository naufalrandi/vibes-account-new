import { Router } from "express";
import * as c from "./auth.controller";
import { authenticate } from "../../middleware/authenticate";
import { rateLimit } from "../../middleware/rateLimit";
import { env } from "../../config/env";

// Credential-guessing and reset-mail endpoints get a much tighter per-IP budget
// than the blanket /v1/auth limiter in app.ts (account lockout covers the
// per-account side, auth.service `login`).
const strict = (keyPrefix: string) =>
  rateLimit({ windowMs: env.AUTH_LOGIN_RATE_LIMIT_WINDOW_MS, max: env.AUTH_LOGIN_RATE_LIMIT_MAX, keyPrefix });

export const authRoutes = Router();
authRoutes.post("/login", strict("auth-login"), c.login);
authRoutes.post("/refresh", c.refresh);
authRoutes.post("/logout", c.logout);
authRoutes.post("/activate", c.activate);
authRoutes.post("/password/forgot", strict("auth-forgot"), c.forgotPassword);
authRoutes.post("/password/reset", c.resetPassword);
// Unlike the token-based reset flow above, changing your own password requires
// a live session — `authenticate` is applied per-route since /v1/auth is
// otherwise mounted unauthenticated.
authRoutes.post("/password/change", authenticate, c.changePassword);
