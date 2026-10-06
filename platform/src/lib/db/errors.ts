import { Prisma } from "@prisma/client";
import { AppError, ConflictError, InternalError, NotFoundError, ValidationError } from "@/lib/errors";

/**
 * Translate known Prisma failures into typed domain errors. Anything else
 * becomes an InternalError whose public message reveals nothing about SQL.
 */
export function mapPrismaError(err: unknown, notFoundMessage = "Not found."): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    switch (err.code) {
      case "P2002":
        return new ConflictError("That already exists.", { prismaCode: err.code, target: err.meta?.target });
      case "P2003":
        return new ValidationError("A referenced record is invalid.");
      case "P2025":
        return new NotFoundError(notFoundMessage);
      default:
        return new InternalError(undefined, { prismaCode: err.code });
    }
  }
  return new InternalError(undefined, { cause: err instanceof Error ? err.name : typeof err });
}

export function isUniqueViolation(err: unknown): boolean {
  return err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002";
}
