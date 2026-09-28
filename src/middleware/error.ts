import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";
import { AppError } from "../lib/errors";
import { fail } from "../lib/apiResponse";

/** JSON 404 for any route nothing else claimed. */
export function notFound(req: Request, res: Response): void {
  res.status(404).json(fail("NOT_FOUND", `Route ${req.method} ${req.path} not found`));
}

/** body-parser / multer errors carry a `type` / `code` + `status` rather than being AppErrors. */
function clientError(err: unknown): { status: number; code: string; message: string } | null {
  const e = err as { type?: unknown; name?: unknown; code?: unknown; status?: unknown };
  if (e?.type === "entity.parse.failed") return { status: 400, code: "BAD_REQUEST", message: "Malformed request body" };
  if (e?.type === "entity.too.large") return { status: 413, code: "PAYLOAD_TOO_LARGE", message: "Request body too large" };
  if (e?.name === "MulterError") {
    return e.code === "LIMIT_FILE_SIZE"
      ? { status: 413, code: "PAYLOAD_TOO_LARGE", message: "File too large" }
      : { status: 400, code: "BAD_UPLOAD", message: "Invalid upload" };
  }
  // Any other body-parser rejection (bad charset/encoding, …) is still the client's fault.
  if (typeof e?.type === "string" && typeof e.status === "number" && e.status >= 400 && e.status < 500) {
    return { status: e.status, code: "BAD_REQUEST", message: "Invalid request body" };
  }
  return null;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction): void {
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
  const client = clientError(err);
  if (client) {
    res.status(client.status).json(fail(client.code, client.message));
    return;
  }
  // Unknown error: log it server-side with the request id, never leak internals.
  // eslint-disable-next-line no-console
  console.error(`[${req.requestId ?? "-"}] Unhandled error on ${req.method} ${req.originalUrl.split("?")[0]}:`, err);
  res.status(500).json(fail("INTERNAL", "Internal server error"));
}
