import type { Request } from "express";
import { AuditLog, Notification, User } from "../models/index";

export async function recordAudit(
  req: Request,
  action: string,
  resourceType: string,
  resourceId?: string,
  details?: Record<string, unknown>,
): Promise<void> {
  if (!req.user) return;
  await AuditLog.create({
    institutionId: req.user.institutionId,
    actorId: req.user.id,
    action,
    resourceType,
    resourceId,
    details,
    ip: req.ip,
  });
}

export async function notifyUser(
  userId: string,
  kind: string,
  title: string,
  body: string,
  data?: Record<string, unknown>,
): Promise<void> {
  const [notification, user] = await Promise.all([
    Notification.create({ userId, kind, title, body, data }),
    User.findById(userId).select("institutionId pushTokens active").lean(),
  ]);
  const tokens = user?.active ? (user.pushTokens ?? []) : [];
  if (tokens.length === 0) return;
  try {
    const response = await fetch("https://exp.host/--/api/v2/push/send", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify(
        tokens.map((to) => ({
          to,
          sound: "default",
          title,
          body,
          data: { ...data, notificationId: String(notification._id), kind },
        })),
      ),
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok)
      console.warn(
        `[notifications] push delivery returned HTTP ${response.status}`,
      );
  } catch (error) {
    console.warn(
      "[notifications] push delivery failed",
      error instanceof Error ? error.message : "unknown error",
    );
  }
}
