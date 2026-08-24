export class AppError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly status: number,
  ) {
    super(message);
    this.name = "AppError";
  }
}

export class BadRequestError extends AppError {
  constructor(message: string, code = "BAD_REQUEST") {
    super(code, message, 400);
  }
}
export class UnauthorizedError extends AppError {
  constructor(message = "Authentication required", code = "UNAUTHORIZED") {
    super(code, message, 401);
  }
}
export class ForbiddenError extends AppError {
  constructor(message = "Forbidden", code = "FORBIDDEN") {
    super(code, message, 403);
  }
}
export class NotFoundError extends AppError {
  constructor(message = "Not found", code = "NOT_FOUND") {
    super(code, message, 404);
  }
}
export class ConflictError extends AppError {
  constructor(message: string, code = "CONFLICT") {
    super(code, message, 409);
  }
}
export class TooManyRequestsError extends AppError {
  constructor(message = "Too many requests", code = "RATE_LIMITED") {
    super(code, message, 429);
  }
}
/**
 * SaaS lifecycle lockout (G-75): the tenant's workspace subscription is in
 * Grace 2 / Archived / Purged. 423 (WebDAV "Locked") distinguishes a
 * lifecycle lockout from an ordinary permission failure (403) so callers can
 * tell "you don't have this grant" apart from "nobody on this tenant has any
 * grant right now — the subscription lapsed."
 */
export class LockedError extends AppError {
  constructor(message = "This workspace is locked", code = "SUBSCRIPTION_LOCKED") {
    super(code, message, 423);
  }
}
