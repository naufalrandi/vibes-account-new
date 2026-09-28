import { randomUUID } from "node:crypto";
import type { Request, Response, NextFunction } from "express";

// A client-supplied id is echoed into logs and response headers, so only a
// short, header-safe token is accepted; anything else gets a fresh UUID.
const VALID_ID = /^[A-Za-z0-9._-]{1,128}$/;

export function requestId(req: Request, res: Response, next: NextFunction): void {
  const incoming = req.header("x-request-id");
  const id = incoming && VALID_ID.test(incoming) ? incoming : randomUUID();
  req.requestId = id;
  res.setHeader("x-request-id", id);
  next();
}
