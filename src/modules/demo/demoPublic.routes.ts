import { Router } from "express";
import * as c from "./demo.controller";
import { rateLimit } from "../../middleware/rateLimit";

// PUBLIC router — mounted at /v1/demo-requests WITHOUT authenticate/tenantScope
// (the OD anonymous demo funnel: business-operations form → Pending DemoTenant
// row the SP reviews in Demo Access). Everything else in this module stays
// behind auth on /v1/demo-tenants.
//
// Abuse controls, in order:
//   1. per-IP rate limit below (same middleware the /v1/auth mount uses);
//   2. zod length caps + module enum in demo.controller.ts (payload bound);
//   3. honeypot `website` field (silently dropped in the controller);
//   4. same-email Pending dedupe in demo.service.ts.

/** Tighter than the auth limiter — a human requests a demo a handful of times, ever. */
const PUBLIC_DEMO_WINDOW_MS = 15 * 60_000;
const PUBLIC_DEMO_MAX_PER_WINDOW = 5;

export const demoPublicRoutes = Router();
demoPublicRoutes.post(
  "/",
  rateLimit({ windowMs: PUBLIC_DEMO_WINDOW_MS, max: PUBLIC_DEMO_MAX_PER_WINDOW, keyPrefix: "demo-public" }),
  c.createPublic,
);
