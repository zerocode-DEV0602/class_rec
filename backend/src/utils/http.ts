import type { Request, Response, NextFunction } from "express";
import { ZodError } from "zod";

export function pageParams(req: Request): {
  page: number;
  limit: number;
  skip: number;
} {
  const page = Math.max(1, Math.floor(Number(req.query.page) || 1));
  const limit = Math.min(
    100,
    Math.max(1, Math.floor(Number(req.query.limit) || 25)),
  );
  return { page, limit, skip: (page - 1) * limit };
}

export function tenantFilter(req: Request): Record<string, unknown> {
  if (req.user?.role === "super_admin") return {};
  return { institutionId: req.user?.institutionId };
}

export function sendError(
  error: unknown,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  if (error instanceof ZodError) {
    res
      .status(400)
      .json({
        error: "Validation failed.",
        details: error.issues.map((issue) => ({
          path: issue.path.join("."),
          message: issue.message,
        })),
      });
    return;
  }
  const value = error as {
    name?: string;
    code?: number;
    message?: string;
    keyValue?: Record<string, unknown>;
  };
  if (value.name === "ValidationError") {
    res.status(400).json({ error: value.message });
    return;
  }
  if (value.code === 11000) {
    res
      .status(409)
      .json({ error: "A record with this unique value already exists." });
    return;
  }
  const status = value.name === "CastError" ? 400 : 500;
  res
    .status(status)
    .json({
      error:
        status === 500
          ? "The request could not be completed."
          : "The requested record identifier is invalid.",
    });
}
