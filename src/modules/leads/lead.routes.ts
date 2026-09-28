import express, { Router, type Request, type Response, type NextFunction } from "express";
import { z } from "zod";
import { rateLimit } from "../../middleware/rateLimit";
import { NotFoundError } from "../../lib/errors";
import { createLead, LEAD_SOURCE_RE } from "./lead.service";

// PUBLIC router — mounted at /v1/public/leads WITHOUT authenticate. Accepts JSON
// (marketing site) and urlencoded (the CMS renderer's plain HTML contact form).
export const leadRoutes = Router();

const leadSchema = z.object({
  source: z.string().regex(LEAD_SOURCE_RE, "source must be a lowercase slug"),
  name: z.string().trim().min(1).max(200),
  email: z.string().trim().email().max(320),
  company: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(50).optional(),
  message: z.string().trim().max(5000).optional(),
  meta: z
    .record(z.string().max(100), z.string().max(1000))
    .refine((m) => Object.keys(m).length <= 20, "meta may carry at most 20 keys")
    .optional(),
});

const limiter = rateLimit({ windowMs: 60_000, max: 5, keyPrefix: "leads" });

leadRoutes.post(
  "/:orgId",
  limiter,
  express.urlencoded({ extended: false, limit: "100kb" }),
  async (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = (req.body ?? {}) as Record<string, unknown>;
      // Honeypot: a hidden field humans never fill. Pretend success so bots learn nothing.
      if (typeof body.website === "string" && body.website.trim() !== "") {
        res.status(202).json({ success: true, data: null, error: null });
        return;
      }
      const orgId = req.params.orgId as string;
      if (!z.guid().safeParse(orgId).success) throw new NotFoundError("Site not found", "SITE_NOT_FOUND");
      const { website: _honeypot, ...fields } = body;
      const input = leadSchema.parse(fields);
      const { id } = await createLead(orgId, input, req.ip ?? null);
      res.status(201).json({ success: true, data: { id }, error: null });
    } catch (e) {
      next(e);
    }
  },
);
