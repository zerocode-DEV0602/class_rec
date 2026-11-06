import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { User, type Role } from "../models/index";

export type AuthUser = {
  id: string;
  role: Role;
  institutionId?: string;
  name: string;
};
declare global {
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

export async function requireAuth(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  const token = req.headers.authorization?.replace(/^Bearer\s+/i, "");
  const secret = process.env.JWT_ACCESS_SECRET;
  if (!token || !secret) {
    res
      .status(token ? 503 : 401)
      .json({
        error: token
          ? "Authentication is not configured."
          : "Authentication required.",
      });
    return;
  }
  try {
    const payload = jwt.verify(token, secret) as jwt.JwtPayload;
    if (typeof payload.sub !== "string" || typeof payload.role !== "string")
      throw new Error("Invalid token");
    if (mongoose.connection.readyState !== 1) {
      res.status(503).json({ error: "MongoDB is unavailable." });
      return;
    }
    const activeUser = await User.findById(payload.sub)
      .select("role institutionId name active")
      .lean()
      .exec();
    if (!activeUser || !activeUser.active || activeUser.role !== payload.role) {
      res.status(401).json({ error: "Account is unavailable." });
      return;
    }
    req.user = {
      id: payload.sub,
      role: activeUser.role,
      institutionId: activeUser.institutionId
        ? String(activeUser.institutionId)
        : undefined,
      name: activeUser.name,
    };
    next();
  } catch {
    res.status(401).json({ error: "Session expired or invalid." });
  }
}

export function allowRoles(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res
        .status(403)
        .json({ error: "You do not have permission to perform this action." });
      return;
    }
    next();
  };
}

export function sameInstitution(
  req: Request,
  res: Response,
  institutionId: string | undefined,
): boolean {
  if (req.user?.role === "super_admin") return true;
  if (req.user?.institutionId && req.user.institutionId === institutionId)
    return true;
  res.status(403).json({ error: "This record is outside your institution." });
  return false;
}

export function requireDatabase(
  _req: Request,
  res: Response,
  next: NextFunction,
): void {
  if (mongoose.connection.readyState !== 1) {
    res
      .status(503)
      .json({
        error: "MongoDB is unavailable. Configure MONGODB_URI and retry.",
      });
    return;
  }
  next();
}
