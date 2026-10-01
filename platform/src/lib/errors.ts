/**
 * Typed application errors.
 *
 * Every error the domain throws on purpose is an `AppError`. Each carries a
 * stable machine `code`, an HTTP status, and a `publicMessage` that is safe to
 * show a user. Anything that is *not* an AppError (a Prisma error, a bug) is
 * mapped to a generic InternalError by `toPublicError` so SQL, stack traces
 * and provider details never reach a response.
 */

export type ErrorCode =
  | "AUTHENTICATION_REQUIRED"
  | "FORBIDDEN"
  | "TENANT_ACCESS_DENIED"
  | "VALIDATION_FAILED"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "EXTERNAL_PROVIDER_ERROR"
  | "AI_PROVIDER_ERROR"
  | "INTERNAL_ERROR";

export type FieldErrors = Record<string, string[]>;

export abstract class AppError extends Error {
  abstract readonly code: ErrorCode;
  abstract readonly status: number;
  /** Safe to display. Never include identifiers from another tenant. */
  readonly publicMessage: string;
  /** Internal-only detail for logs. Never serialised to clients. */
  readonly details?: Record<string, unknown>;

  constructor(publicMessage: string, details?: Record<string, unknown>) {
    super(publicMessage);
    this.name = new.target.name;
    this.publicMessage = publicMessage;
    this.details = details;
  }
}

export class AuthenticationError extends AppError {
  readonly code = "AUTHENTICATION_REQUIRED" as const;
  readonly status = 401;
  constructor(message = "Please sign in to continue.", details?: Record<string, unknown>) {
    super(message, details);
  }
}

export class AuthorizationError extends AppError {
  readonly code = "FORBIDDEN" as const;
  readonly status = 403;
  constructor(message = "You don't have permission to do that.", details?: Record<string, unknown>) {
    super(message, details);
  }
}

/**
 * The caller is not an active member of the organization they addressed.
 * Rendered as 404 so organization existence is not disclosed to outsiders.
 */
export class TenantAccessError extends AppError {
  readonly code = "TENANT_ACCESS_DENIED" as const;
  readonly status = 404;
  constructor(message = "Organization not found.", details?: Record<string, unknown>) {
    super(message, details);
  }
}

export class ValidationError extends AppError {
  readonly code = "VALIDATION_FAILED" as const;
  readonly status = 422;
  readonly fieldErrors: FieldErrors;
  constructor(message = "Some fields are invalid.", fieldErrors: FieldErrors = {}) {
    super(message);
    this.fieldErrors = fieldErrors;
  }
}

export class NotFoundError extends AppError {
  readonly code = "NOT_FOUND" as const;
  readonly status = 404;
  constructor(message = "Not found.", details?: Record<string, unknown>) {
    super(message, details);
  }
}

export class ConflictError extends AppError {
  readonly code = "CONFLICT" as const;
  readonly status = 409;
  constructor(message = "This was changed by someone else. Refresh and try again.", details?: Record<string, unknown>) {
    super(message, details);
  }
}

export class RateLimitError extends AppError {
  readonly code = "RATE_LIMITED" as const;
  readonly status = 429;
  readonly retryAfterSeconds: number;
  constructor(retryAfterSeconds: number, message = "Too many attempts. Please wait and try again.") {
    super(message);
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export class ExternalProviderError extends AppError {
  readonly code = "EXTERNAL_PROVIDER_ERROR" as const;
  readonly status = 502;
  constructor(message = "An external service is unavailable. Please try again.", details?: Record<string, unknown>) {
    super(message, details);
  }
}

export class AIProviderError extends AppError {
  readonly code = "AI_PROVIDER_ERROR" as const;
  readonly status = 502;
  constructor(message = "The AI service is unavailable right now.", details?: Record<string, unknown>) {
    super(message, details);
  }
}

export class InternalError extends AppError {
  readonly code = "INTERNAL_ERROR" as const;
  readonly status = 500;
  constructor(message = "Something went wrong. Please try again.", details?: Record<string, unknown>) {
    super(message, details);
  }
}

export interface PublicError {
  code: ErrorCode;
  message: string;
  fieldErrors?: FieldErrors;
  retryAfterSeconds?: number;
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

/** The only shape of error that may leave the server. */
export function toPublicError(err: unknown): PublicError {
  if (!isAppError(err)) {
    const internal = new InternalError();
    return { code: internal.code, message: internal.publicMessage };
  }
  const out: PublicError = { code: err.code, message: err.publicMessage };
  if (err instanceof ValidationError && Object.keys(err.fieldErrors).length > 0) {
    out.fieldErrors = err.fieldErrors;
  }
  if (err instanceof RateLimitError) out.retryAfterSeconds = err.retryAfterSeconds;
  return out;
}

export function httpStatusOf(err: unknown): number {
  return isAppError(err) ? err.status : 500;
}
