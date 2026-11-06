import "dotenv/config";
import { createServer } from "node:http";
import express from "express";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import multer from "multer";
import { Server } from "socket.io";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { connectDatabase, databaseReady } from "./config/database";
import { ClassOffering, Enrollment, Message, User } from "./models/index";
import authRoutes from "./routes/auth";
import academicRoutes from "./routes/academic";
import classRoutes from "./routes/classes";
import recordRoutes from "./routes/records";
import engagementRoutes from "./routes/engagement";
import reportRoutes from "./routes/reports";
import offlineRoutes from "./routes/offline";
import { requireAuth, requireDatabase } from "./middleware/auth";
import { sendError } from "./utils/http";
import { notifyUser } from "./services/audit";
import { setRealtimeServer } from "./services/realtime";
import { hasSupportedSignature, storeFile } from "./services/storage";

const app = express();
const httpServer = createServer(app);
const origins = (process.env.CORS_ORIGINS ?? "http://localhost:8081")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);
const io = new Server(httpServer, {
  cors: {
    origin: process.env.NODE_ENV !== "production" ? true : origins,
    methods: ["GET", "POST"],
  },
});
setRealtimeServer(io);
const apiLimiter = rateLimit({
  windowMs: 15 * 60_000,
  limit: 300,
  standardHeaders: "draft-8",
  legacyHeaders: false,
});
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: Number(process.env.MAX_UPLOAD_MB ?? 10) * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    const allowed = new Set([
      "application/pdf",
      "image/jpeg",
      "image/png",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ]);
    if (!allowed.has(file.mimetype)) {
      cb(new Error("Unsupported file type."));
      return;
    }
    cb(null, true);
  },
});

app.disable("x-powered-by");
app.use(helmet());
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (
    !origin ||
    origins.includes(origin) ||
    process.env.NODE_ENV !== "production"
  ) {
    res.header(
      "Access-Control-Allow-Origin",
      origin && origins.includes(origin) ? origin : "*",
    );
    res.header("Vary", "Origin");
  }
  res.header("Access-Control-Allow-Headers", "Authorization, Content-Type");
  res.header(
    "Access-Control-Allow-Methods",
    "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  );
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});
app.use(express.json({ limit: "1mb" }));
app.get("/api/health", (_req, res) =>
  res.json({
    ok: true,
    service: "classtrack-api",
    database: databaseReady() ? "connected" : "not_configured",
    timestamp: new Date().toISOString(),
  }),
);
app.use("/api", apiLimiter, requireDatabase);
app.use("/api/auth", authRoutes);
app.use("/api", academicRoutes);
app.use("/api", classRoutes);
app.use("/api", recordRoutes);
app.use("/api", engagementRoutes);
app.use("/api", reportRoutes);
app.use("/api", offlineRoutes);
app.post(
  "/api/uploads",
  requireAuth,
  upload.single("file"),
  async (req, res, next) => {
    if (!req.file) {
      res.status(400).json({ error: "A supported file is required." });
      return;
    }
    if (!req.user || !["student", "faculty"].includes(req.user.role)) {
      res
        .status(403)
        .json({ error: "Only students and faculty can upload class files." });
      return;
    }
    if (!hasSupportedSignature(req.file.buffer, req.file.mimetype)) {
      res
        .status(400)
        .json({
          error:
            "File content does not match its declared PDF, JPEG, PNG or DOCX type.",
        });
      return;
    }
    try {
      res.status(201).json({ file: await storeFile(req.file) });
    } catch (error) {
      next(error);
    }
  },
);
app.use(sendError);

io.use(async (socket, next) => {
  try {
    const token = socket.handshake.auth.token;
    const secret = process.env.JWT_ACCESS_SECRET;
    if (typeof token !== "string" || !secret)
      return next(new Error("Unauthorized"));
    const payload = jwt.verify(token, secret) as jwt.JwtPayload;
    if (!payload.sub) return next(new Error("Unauthorized"));
    const user = await User.findById(payload.sub).select(
      "active role institutionId",
    );
    if (!user?.active) return next(new Error("Unauthorized"));
    socket.data.userId = String(user._id);
    socket.data.institutionId = user.institutionId
      ? String(user.institutionId)
      : undefined;
    next();
  } catch {
    next(new Error("Unauthorized"));
  }
});
io.on("connection", (socket) => {
  socket.on(
    "message:send",
    async (
      input: unknown,
      acknowledge?: (result: { ok: boolean; error?: string }) => void,
    ) => {
      try {
        if (!input || typeof input !== "object")
          throw new Error("Invalid message");
        const data = input as {
          recipientId?: unknown;
          body?: unknown;
          offeringId?: unknown;
        };
        if (
          typeof data.recipientId !== "string" ||
          typeof data.body !== "string" ||
          !data.body.trim() ||
          data.body.length > 5000
        )
          throw new Error("A recipient and message are required.");
        const recipient = await User.findById(data.recipientId).select(
          "active institutionId",
        );
        if (
          !recipient?.active ||
          String(recipient.institutionId ?? "") !==
            String(socket.data.institutionId ?? "")
        )
          throw new Error("Recipient is not available.");
        if (typeof data.offeringId !== "string")
          throw new Error("Messages must be linked to a class offering.");
        const offering = await ClassOffering.findOne({
          _id: data.offeringId,
          institutionId: socket.data.institutionId,
        })
          .select("facultyId")
          .lean();
        if (!offering) throw new Error("Class offering is not available.");
        const senderIsFaculty =
          String(offering.facultyId) === String(socket.data.userId);
        const senderIsStudent = await Enrollment.exists({
          offeringId: data.offeringId,
          studentId: socket.data.userId,
          status: "approved",
        });
        const recipientIsFaculty =
          String(offering.facultyId) === data.recipientId;
        const recipientIsStudent = await Enrollment.exists({
          offeringId: data.offeringId,
          studentId: data.recipientId,
          status: "approved",
        });
        if (
          !(senderIsFaculty || senderIsStudent) ||
          !(recipientIsFaculty || recipientIsStudent) ||
          data.recipientId === socket.data.userId
        )
          throw new Error("Both people must be active members of this class.");
        const message = await Message.create({
          institutionId: socket.data.institutionId,
          senderId: socket.data.userId,
          recipientId: data.recipientId,
          offeringId: data.offeringId,
          body: data.body.trim(),
        });
        const event = {
          _id: String(message._id),
          senderId: socket.data.userId,
          recipientId: data.recipientId,
          offeringId: data.offeringId,
          body: data.body.trim(),
          createdAt: message.createdAt,
        };
        io.to(`user:${data.recipientId}`).emit("message:new", event);
        await notifyUser(
          data.recipientId,
          "message",
          "New message",
          data.body.trim().slice(0, 160),
          { messageId: String(message._id), offeringId: data.offeringId },
        );
        acknowledge?.({ ok: true });
      } catch (error) {
        acknowledge?.({
          ok: false,
          error: error instanceof Error ? error.message : "Message failed.",
        });
      }
    },
  );
  socket.join(`user:${socket.data.userId as string}`);
});

export async function startServer(): Promise<void> {
  try {
    await connectDatabase();
  } catch {
    console.error(
      "[database] Connection failed; API will report database unavailable.",
    );
  }
  const port = Number(process.env.PORT ?? 3000);
  httpServer.listen(port, "0.0.0.0", () =>
    console.info(`[api] listening on ${port}`),
  );
}
export { app, httpServer, io };
