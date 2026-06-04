import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { AppError } from "../lib/errors";
import { fail } from "../lib/apiResponse";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.status).json(fail(err.code, err.message));
    return;
  }
  // Request body/schema validation failures are client errors, not 500s.
  if (err instanceof ZodError) {
    const first = err.issues[0];
    const where = first?.path.length ? `${first.path.join(".")}: ` : "";
    res.status(400).json(fail("VALIDATION_ERROR", `${where}${first?.message ?? "Invalid request"}`));
    return;
  }
  // Unknown error: do not leak internals.
  // eslint-disable-next-line no-console
  console.error("Unhandled error:", err);
  res.status(500).json(fail("INTERNAL", "Internal server error"));
}
