import type { Request, Response, NextFunction } from "express";
import { AppError } from "../lib/errors";
import { fail } from "../lib/apiResponse";

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction): void {
  if (err instanceof AppError) {
    res.status(err.status).json(fail(err.code, err.message));
    return;
  }
  // Unknown error: do not leak internals.
  // eslint-disable-next-line no-console
  console.error("Unhandled error:", err);
  res.status(500).json(fail("INTERNAL", "Internal server error"));
}
