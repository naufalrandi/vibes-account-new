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
