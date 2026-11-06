import { randomBytes, createHash } from "node:crypto";
import { Router } from "express";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { User } from "../models/index";
import { requireAuth } from "../middleware/auth";
import { recordAudit } from "../services/audit";

const router = Router();
const credentials = z.object({
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
});
const accessSecret = () => process.env.JWT_ACCESS_SECRET;
const refreshSecret = () => process.env.JWT_REFRESH_SECRET;
type TokenUser = {
  _id: { toString(): string };
  name: string;
  email: string;
  role: string;
  institutionId?: unknown;
};
const publicUser = (user: TokenUser) => ({
  id: user._id.toString(),
  name: user.name,
  email: user.email,
  role: user.role,
  institutionId: user.institutionId ? String(user.institutionId) : undefined,
});
function issueTokens(user: TokenUser) {
  const access = accessSecret();
  const refresh = refreshSecret();
  if (!access || !refresh)
    throw new Error("JWT_ACCESS_SECRET and JWT_REFRESH_SECRET are required.");
  const payload = {
    role: user.role,
    name: user.name,
    institutionId: user.institutionId ? String(user.institutionId) : undefined,
  };
  return {
    accessToken: jwt.sign(payload, access, {
      subject: user._id.toString(),
      expiresIn: "15m",
    }),
    refreshToken: jwt.sign({}, refresh, {
      subject: user._id.toString(),
      expiresIn: "30d",
    }),
  };
}
const hashToken = (token: string) =>
  createHash("sha256").update(token).digest("hex");

router.post("/login", async (req, res, next) => {
  try {
    const input = credentials.parse(req.body);
    const user = await User.findOne({
      email: input.email.toLowerCase(),
    }).select("+passwordHash");
    if (
      !user ||
      !user.active ||
      !(await bcrypt.compare(input.password, user.passwordHash))
    ) {
      res.status(401).json({ error: "Email or password is incorrect." });
      return;
    }
    const tokens = issueTokens(user);
    user.refreshTokenHash = hashToken(tokens.refreshToken);
    user.lastSignedInAt = new Date();
    await user.save();
    req.user = {
      id: String(user._id),
      role: user.role,
      institutionId: user.institutionId
        ? String(user.institutionId)
        : undefined,
      name: user.name,
    };
    await recordAudit(req, "auth.login", "user", String(user._id));
    res.json({ user: publicUser(user), ...tokens });
  } catch (error) {
    next(error);
  }
});

router.post("/refresh", async (req, res) => {
  const token = z
    .object({ refreshToken: z.string().min(1) })
    .safeParse(req.body);
  if (!token.success || !refreshSecret() || !accessSecret()) {
    res.status(400).json({ error: "A valid refresh token is required." });
    return;
  }
  try {
    const payload = jwt.verify(
      token.data.refreshToken,
      refreshSecret() as string,
    ) as jwt.JwtPayload;
    if (!payload.sub) throw new Error("Missing subject");
    const user = await User.findById(payload.sub).select("+refreshTokenHash");
    if (
      !user ||
      !user.active ||
      user.refreshTokenHash !== hashToken(token.data.refreshToken)
    ) {
      res
        .status(401)
        .json({ error: "Refresh token has expired or been revoked." });
      return;
    }
    const tokens = issueTokens(user);
    user.refreshTokenHash = hashToken(tokens.refreshToken);
    await user.save();
    res.json({ user: publicUser(user), ...tokens });
  } catch {
    res.status(401).json({ error: "Refresh token has expired or is invalid." });
  }
});

router.post("/logout", requireAuth, async (req, res, next) => {
  try {
    await User.findByIdAndUpdate(req.user?.id, {
      $unset: { refreshTokenHash: 1 },
    });
    await recordAudit(req, "auth.logout", "user", req.user?.id);
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});

router.get("/me", requireAuth, async (req, res, next) => {
  try {
    const user = await User.findById(req.user?.id)
      .select(
        "name email role institutionId departmentId programId sectionId studentNumber active",
      )
      .lean();
    if (!user || !user.active) {
      res.status(401).json({ error: "Account is unavailable." });
      return;
    }
    res.json({
      user: {
        id: String(user._id),
        name: user.name,
        email: user.email,
        role: user.role,
        institutionId: user.institutionId
          ? String(user.institutionId)
          : undefined,
        departmentId: user.departmentId ? String(user.departmentId) : undefined,
        programId: user.programId ? String(user.programId) : undefined,
        sectionId: user.sectionId ? String(user.sectionId) : undefined,
        studentNumber: user.studentNumber,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.patch("/profile", requireAuth, async (req, res, next) => {
  try {
    const { name } = z
      .object({ name: z.string().trim().min(2).max(120) })
      .strict()
      .parse(req.body);
    const user = await User.findOne({ _id: req.user?.id, active: true });
    if (!user) {
      res.status(404).json({ error: "Account is unavailable." });
      return;
    }
    user.name = name;
    await user.save();
    await recordAudit(req, "profile.update", "user", user.id);
    res.json({
      item: {
        id: user.id,
        name: user.name,
        email: user.email,
        role: user.role,
        institutionId: user.institutionId
          ? String(user.institutionId)
          : undefined,
      },
    });
  } catch (error) {
    next(error);
  }
});

router.patch("/change-password", requireAuth, async (req, res, next) => {
  try {
    const input = z
      .object({
        currentPassword: z.string().min(8).max(128),
        newPassword: z.string().min(8).max(128),
      })
      .strict()
      .parse(req.body);
    const user = await User.findOne({ _id: req.user?.id, active: true }).select(
      "+passwordHash +refreshTokenHash",
    );
    if (
      !user ||
      !(await bcrypt.compare(input.currentPassword, user.passwordHash))
    ) {
      res.status(400).json({ error: "Current password is incorrect." });
      return;
    }
    if (input.currentPassword === input.newPassword) {
      res
        .status(400)
        .json({
          error: "Choose a new password different from your current password.",
        });
      return;
    }
    user.passwordHash = await bcrypt.hash(input.newPassword, 12);
    user.refreshTokenHash = undefined;
    await user.save();
    await recordAudit(req, "auth.password_changed", "user", user.id);
    res.json({ success: true, requireSignIn: true });
  } catch (error) {
    next(error);
  }
});

router.post("/forgot-password", async (req, res, next) => {
  try {
    const email = z
      .object({ email: z.string().email() })
      .parse(req.body)
      .email.toLowerCase();
    const user = await User.findOne({ email, active: true });
    if (user) {
      const resetToken = randomBytes(32).toString("hex");
      user.resetTokenHash = hashToken(resetToken);
      user.resetExpiresAt = new Date(Date.now() + 30 * 60_000);
      await user.save();
      const webhook = process.env.PASSWORD_RESET_WEBHOOK_URL;
      if (webhook) {
        const secret = process.env.PASSWORD_RESET_WEBHOOK_SECRET;
        const delivered = await fetch(webhook, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            ...(secret ? { Authorization: `Bearer ${secret}` } : {}),
          },
          body: JSON.stringify({
            email: user.email,
            token: resetToken,
            expiresAt: user.resetExpiresAt,
            appUrl: process.env.PUBLIC_APP_URL,
          }),
          signal: AbortSignal.timeout(8_000),
        });
        if (!delivered.ok)
          console.warn(
            `[auth] password-reset webhook returned HTTP ${delivered.status}`,
          );
      }
      req.user = {
        id: String(user._id),
        role: user.role,
        institutionId: user.institutionId
          ? String(user.institutionId)
          : undefined,
        name: user.name,
      };
      await recordAudit(
        req,
        "auth.password_reset_requested",
        "user",
        String(user._id),
      );
      if (process.env.NODE_ENV !== "production")
        res.json({
          message: "If the account exists, reset instructions are ready.",
          developmentResetToken: resetToken,
        });
      else
        res.json({
          message: "If the account exists, reset instructions will be sent.",
        });
      return;
    }
    res.json({
      message: "If the account exists, reset instructions will be sent.",
    });
  } catch (error) {
    next(error);
  }
});

router.post("/reset-password", async (req, res, next) => {
  try {
    const input = z
      .object({
        token: z.string().min(32),
        newPassword: z.string().min(8).max(128),
      })
      .parse(req.body);
    const user = await User.findOne({
      resetTokenHash: hashToken(input.token),
      resetExpiresAt: { $gt: new Date() },
      active: true,
    }).select("+passwordHash");
    if (!user) {
      res.status(400).json({ error: "Reset token is invalid or expired." });
      return;
    }
    user.passwordHash = await bcrypt.hash(input.newPassword, 12);
    user.resetTokenHash = undefined;
    user.resetExpiresAt = undefined;
    user.refreshTokenHash = undefined;
    await user.save();
    req.user = {
      id: String(user._id),
      role: user.role,
      institutionId: user.institutionId
        ? String(user.institutionId)
        : undefined,
      name: user.name,
    };
    await recordAudit(req, "auth.password_reset", "user", String(user._id));
    res.json({
      success: true,
      message: "Password updated. Sign in with your new password.",
    });
  } catch (error) {
    next(error);
  }
});

export default router;
