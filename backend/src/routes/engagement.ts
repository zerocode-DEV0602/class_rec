import { Router } from "express";
import { z } from "zod";
import {
  Announcement,
  Assessment,
  ClassOffering,
  Enrollment,
  Message,
  StudentScore,
  Submission,
  User,
} from "../models/index";
import { allowRoles, requireAuth, sameInstitution } from "../middleware/auth";
import { notifyUser, recordAudit } from "../services/audit";
import { emitToUser } from "../services/realtime";
import { readStoredFile, storedFileExists } from "../services/storage";
const router = Router();
router.use(requireAuth);

async function classMember(
  offeringId: string,
  userId: string,
): Promise<boolean> {
  return Boolean(
    (await ClassOffering.exists({ _id: offeringId, facultyId: userId })) ||
    (await Enrollment.exists({
      offeringId,
      studentId: userId,
      status: "approved",
    })),
  );
}

router.get("/announcements", async (req, res, next) => {
  try {
    const filter: Record<string, unknown> = { publishedAt: { $ne: null } };
    if (req.user?.role === "student") {
      const ids = await Enrollment.find({
        studentId: req.user.id,
        status: "approved",
      }).distinct("offeringId");
      filter.$or = [
        {
          audience: { $in: ["all", "student"] },
          offeringId: { $exists: false },
          institutionId: req.user.institutionId,
        },
        { offeringId: { $in: ids } },
      ];
    } else if (req.user?.role === "faculty") {
      const ids = await ClassOffering.find({ facultyId: req.user.id }).distinct(
        "_id",
      );
      filter.$or = [
        {
          audience: { $in: ["all", "faculty"] },
          offeringId: { $exists: false },
          institutionId: req.user.institutionId,
        },
        { offeringId: { $in: ids } },
      ];
    } else if (req.user?.role === "administrator")
      filter.institutionId = req.user.institutionId;
    res.json({
      items: await Announcement.find(filter)
        .populate("authorId", "name")
        .sort({ publishedAt: -1 })
        .limit(50)
        .lean(),
    });
  } catch (error) {
    next(error);
  }
});
router.post(
  "/announcements",
  allowRoles("super_admin", "administrator", "faculty"),
  async (req, res, next) => {
    try {
      const input = z
        .object({
          title: z.string().trim().min(3).max(180),
          body: z.string().trim().min(2).max(10000),
          audience: z
            .array(z.enum(["faculty", "student", "administrator", "all"]))
            .min(1),
          offeringId: z.string().optional(),
        })
        .parse(req.body);
      let institutionId = req.user?.institutionId;
      if (req.user?.role === "faculty") {
        if (
          !input.offeringId ||
          input.audience.some((role) => role !== "student" && role !== "all")
        ) {
          res.status(400).json({
            error:
              "Faculty announcements must target students in one of your class offerings.",
          });
          return;
        }
        const offering = await ClassOffering.findOne({
          _id: input.offeringId,
          facultyId: req.user.id,
        })
          .select("institutionId")
          .lean();
        if (!offering) {
          res.status(404).json({ error: "Class offering not found." });
          return;
        }
        institutionId = String(offering.institutionId);
      }
      if (req.user?.role === "administrator" && input.offeringId) {
        const offering = await ClassOffering.findById(input.offeringId)
          .select("institutionId")
          .lean();
        if (
          !offering ||
          !sameInstitution(req, res, String(offering.institutionId))
        ) {
          res.status(404).json({ error: "Class offering not found." });
          return;
        }
      }
      if (req.user?.role === "super_admin" && input.offeringId) {
        res.status(400).json({
          error: "System announcements cannot be restricted to an offering.",
        });
        return;
      }
      const item = await Announcement.create({
        institutionId,
        offeringId: input.offeringId,
        authorId: req.user?.id,
        audience: input.audience,
        title: input.title,
        body: input.body,
        publishedAt: new Date(),
      });
      const recipients = input.offeringId
        ? await Enrollment.find({
            offeringId: input.offeringId,
            status: "approved",
          }).distinct("studentId")
        : await User.find({
            ...(req.user?.role === "super_admin" ? {} : { institutionId }),
            active: true,
            ...(input.audience.includes("all")
              ? {}
              : { role: { $in: input.audience } }),
          }).distinct("_id");
      for (const recipient of recipients)
        await notifyUser(
          String(recipient),
          "announcement",
          input.title,
          input.body,
          { announcementId: item.id },
        );
      await recordAudit(req, "announcement.publish", "announcement", item.id);
      res.status(201).json({ item, notified: recipients.length });
    } catch (error) {
      next(error);
    }
  },
);

router.get("/activities", async (req, res, next) => {
  try {
    const offeringId =
      typeof req.query.offeringId === "string"
        ? req.query.offeringId
        : undefined;
    if (!offeringId) {
      res.status(400).json({ error: "offeringId is required." });
      return;
    }
    const offering = await ClassOffering.findById(offeringId)
      .select("institutionId facultyId")
      .lean();
    if (!offering) {
      res.status(404).json({ error: "Class offering not found." });
      return;
    }
    if (
      req.user?.role === "student" &&
      !(await Enrollment.exists({
        offeringId,
        studentId: req.user.id,
        status: "approved",
      }))
    ) {
      res
        .status(403)
        .json({ error: "This class is not on your approved subject list." });
      return;
    }
    if (
      req.user?.role === "faculty" &&
      String(offering.facultyId) !== req.user.id
    ) {
      res.status(404).json({ error: "Class offering not found." });
      return;
    }
    if (
      req.user?.role === "administrator" &&
      !sameInstitution(req, res, String(offering.institutionId))
    )
      return;
    const filter: Record<string, unknown> = { offeringId, archivedAt: null };
    if (req.user?.role === "student") filter.published = true;
    res.json({
      items: await Assessment.find(filter).sort({ dueAt: 1 }).lean(),
    });
  } catch (error) {
    next(error);
  }
});
router.post("/submissions", allowRoles("student"), async (req, res, next) => {
  try {
    const input = z
      .object({
        assessmentId: z.string(),
        file: z.object({
          key: z.string().regex(/^file_[a-f0-9]{32}$/),
          name: z.string().max(255),
          mimeType: z.string().max(100),
          size: z
            .number()
            .int()
            .positive()
            .max(10 * 1024 * 1024),
        }),
      })
      .parse(req.body);
    const assessment = await Assessment.findById(input.assessmentId).lean();
    if (!assessment || !assessment.allowSubmission || !assessment.published) {
      res.status(404).json({ error: "Submission is not available." });
      return;
    }
    if (!(await storedFileExists(input.file.key))) {
      res
        .status(400)
        .json({ error: "The uploaded file reference is unavailable." });
      return;
    }
    if (
      !(await Enrollment.exists({
        offeringId: assessment.offeringId,
        studentId: req.user?.id,
        status: "approved",
      }))
    ) {
      res
        .status(403)
        .json({ error: "This class is not on your approved subject list." });
      return;
    }
    const late = Boolean(
      assessment.dueAt && assessment.dueAt.getTime() < Date.now(),
    );
    const item = await Submission.findOneAndUpdate(
      { assessmentId: assessment._id, studentId: req.user?.id },
      {
        $set: {
          institutionId: assessment.institutionId,
          file: input.file,
          submittedAt: new Date(),
          status: late ? "late" : "submitted",
        },
      },
      { new: true, upsert: true, runValidators: true },
    );
    await recordAudit(req, "submission.create", "submission", item.id, {
      assessmentId: input.assessmentId,
    });
    res.status(201).json({ item });
  } catch (error) {
    next(error);
  }
});
router.get("/submissions", async (req, res, next) => {
  try {
    const assessmentId =
      typeof req.query.assessmentId === "string"
        ? req.query.assessmentId
        : undefined;
    const offeringId =
      typeof req.query.offeringId === "string"
        ? req.query.offeringId
        : undefined;
    if (!assessmentId && !offeringId) {
      res
        .status(400)
        .json({ error: "assessmentId or offeringId is required." });
      return;
    }
    const assessments = assessmentId
      ? [
          await Assessment.findById(assessmentId)
            .select("_id offeringId institutionId")
            .lean(),
        ].filter((item) => Boolean(item))
      : await Assessment.find({ offeringId })
          .select("_id offeringId institutionId")
          .lean();
    if (!assessments.length) {
      res.status(404).json({ error: "Activity not found." });
      return;
    }
    for (const assessment of assessments) {
      if (
        req.user?.role === "student" &&
        !(await Enrollment.exists({
          offeringId: assessment!.offeringId,
          studentId: req.user.id,
          status: "approved",
        }))
      ) {
        res
          .status(403)
          .json({ error: "This class is not on your approved subject list." });
        return;
      }
      if (
        req.user?.role === "faculty" &&
        !(await ClassOffering.exists({
          _id: assessment!.offeringId,
          facultyId: req.user.id,
        }))
      ) {
        res.status(404).json({ error: "Activity not found." });
        return;
      }
      if (
        req.user?.role === "administrator" &&
        !sameInstitution(req, res, String(assessment!.institutionId))
      )
        return;
    }
    const filter: Record<string, unknown> = {
      assessmentId: { $in: assessments.map((item) => item!._id) },
    };
    if (req.user?.role === "student") filter.studentId = req.user.id;
    res.json({
      items: await Submission.find(filter)
        .populate("studentId", "name studentNumber")
        .sort({ submittedAt: -1 })
        .lean(),
    });
  } catch (error) {
    next(error);
  }
});
router.patch(
  "/submissions/:id/grade",
  allowRoles("faculty"),
  async (req, res, next) => {
    try {
      const input = z
        .object({ score: z.number().min(0), feedback: z.string().max(3000) })
        .parse(req.body);
      const submission = await Submission.findById(req.params.id);
      if (!submission) {
        res.status(404).json({ error: "Submission not found." });
        return;
      }
      const assessment = await Assessment.findById(
        submission.assessmentId,
      ).lean();
      if (
        !assessment ||
        !(await ClassOffering.exists({
          _id: assessment.offeringId,
          facultyId: req.user?.id,
        }))
      ) {
        res.status(404).json({ error: "Submission not found." });
        return;
      }
      if (input.score > (assessment.maxScore ?? 0)) {
        res
          .status(400)
          .json({ error: "Score cannot exceed the assessment maximum." });
        return;
      }
      const existing = await StudentScore.findOne({
        assessmentId: assessment._id,
        studentId: submission.studentId,
      });
      if (existing && !input.feedback.trim()) {
        res.status(400).json({
          error: "A reason is required when changing an existing score.",
        });
        return;
      }
      await StudentScore.findOneAndUpdate(
        { assessmentId: assessment._id, studentId: submission.studentId },
        {
          $set: {
            institutionId: assessment.institutionId,
            offeringId: assessment.offeringId,
            score: input.score,
            remarks: input.feedback,
          },
          $setOnInsert: {
            assessmentId: assessment._id,
            studentId: submission.studentId,
          },
          ...(existing
            ? {
                $push: {
                  history: {
                    score: existing.score,
                    remarks: existing.remarks,
                    changedBy: req.user?.id,
                    changedAt: new Date(),
                    reason: input.feedback,
                  },
                },
              }
            : {}),
        },
        { upsert: true, new: true, runValidators: true },
      );
      submission.score = input.score;
      submission.feedback = input.feedback;
      submission.status = "reviewed";
      await submission.save();
      await notifyUser(
        String(submission.studentId),
        "submission_feedback",
        "Activity reviewed",
        `Your work for ${assessment.title} has been reviewed.`,
        { submissionId: submission.id },
      );
      await recordAudit(req, "submission.grade", "submission", submission.id, {
        score: input.score,
      });
      res.json({ item: submission });
    } catch (error) {
      next(error);
    }
  },
);
router.get("/uploads/:key", async (req, res, next) => {
  try {
    const key = req.params.key;
    const submission = await Submission.findOne({ "file.key": key })
      .select("studentId assessmentId institutionId file")
      .lean();
    const reference = await Assessment.findOne({ "referenceFile.key": key })
      .select("offeringId institutionId referenceFile published")
      .lean();
    if (!submission && !reference) {
      res.status(404).json({ error: "File not found." });
      return;
    }
    const assessment =
      reference ??
      (await Assessment.findById(submission!.assessmentId)
        .select("offeringId institutionId")
        .lean());
    if (!assessment) {
      res.status(404).json({ error: "File not found." });
      return;
    }
    const studentOwner =
      req.user?.role === "student" &&
      (reference
        ? reference.published === true &&
          (await Enrollment.exists({
            offeringId: assessment.offeringId,
            studentId: req.user.id,
            status: "approved",
          }))
        : String(submission?.studentId) === req.user.id);
    const facultyOwner =
      req.user?.role === "faculty" &&
      assessment &&
      (await ClassOffering.exists({
        _id: assessment.offeringId,
        facultyId: req.user.id,
      }));
    const adminOwner =
      req.user?.role === "administrator" &&
      String(assessment.institutionId ?? submission?.institutionId) ===
        req.user.institutionId;
    if (
      !studentOwner &&
      !facultyOwner &&
      !adminOwner &&
      req.user?.role !== "super_admin"
    ) {
      res.status(403).json({ error: "Not allowed to download this file." });
      return;
    }
    const stored = await readStoredFile(key);
    const file = (reference?.referenceFile ?? submission?.file) as unknown as
      | { mimeType?: string; size?: number; name?: string }
      | undefined;
    res.setHeader("Content-Type", file?.mimeType ?? stored.mimeType);
    if (file?.size || stored.size)
      res.setHeader("Content-Length", String(file?.size ?? stored.size));
    res.setHeader(
      "Content-Disposition",
      `attachment; filename*=UTF-8''${encodeURIComponent(file?.name ?? "class-file")}`,
    );
    stored.body.pipe(res);
  } catch (error) {
    next(error);
  }
});

router.get("/messages", async (req, res, next) => {
  try {
    const peerId =
      typeof req.query.peerId === "string" ? req.query.peerId : undefined;
    const offeringId =
      typeof req.query.offeringId === "string"
        ? req.query.offeringId
        : undefined;
    if (
      !peerId ||
      !offeringId ||
      !["faculty", "student"].includes(req.user?.role ?? "")
    ) {
      res.status(400).json({
        error: "A class offering and conversation partner are required.",
      });
      return;
    }
    const peer = await User.findById(peerId)
      .select("institutionId active")
      .lean();
    const offering = await ClassOffering.findOne({
      _id: offeringId,
      institutionId: req.user?.institutionId,
    })
      .select("_id")
      .lean();
    if (
      !peer?.active ||
      String(peer.institutionId ?? "") !==
        String(req.user?.institutionId ?? "") ||
      !offering ||
      !(await classMember(offeringId, req.user!.id)) ||
      !(await classMember(offeringId, peerId))
    ) {
      res.status(404).json({ error: "Conversation not found." });
      return;
    }
    await Message.updateMany(
      {
        offeringId,
        senderId: peerId,
        recipientId: req.user?.id,
        readAt: { $exists: false },
      },
      { $set: { readAt: new Date() } },
    );
    const items = await Message.find({
      offeringId,
      $or: [
        { senderId: req.user?.id, recipientId: peerId },
        { senderId: peerId, recipientId: req.user?.id },
      ],
    })
      .sort({ createdAt: 1 })
      .limit(200)
      .lean();
    res.json({ items });
  } catch (error) {
    next(error);
  }
});
router.post(
  "/messages",
  allowRoles("faculty", "student"),
  async (req, res, next) => {
    try {
      const input = z
        .object({
          recipientId: z.string(),
          body: z.string().trim().min(1).max(5000),
          offeringId: z.string(),
        })
        .parse(req.body);
      const recipient = await User.findById(input.recipientId)
        .select("active institutionId")
        .lean();
      const offering = await ClassOffering.findOne({
        _id: input.offeringId,
        institutionId: req.user?.institutionId,
      })
        .select("_id")
        .lean();
      if (
        !recipient?.active ||
        String(recipient.institutionId ?? "") !==
          String(req.user?.institutionId ?? "") ||
        !offering ||
        !(await classMember(input.offeringId, req.user!.id)) ||
        !(await classMember(input.offeringId, input.recipientId)) ||
        input.recipientId === req.user?.id
      ) {
        res
          .status(403)
          .json({ error: "Both people must be active members of this class." });
        return;
      }
      const item = await Message.create({
        institutionId: req.user?.institutionId,
        senderId: req.user?.id,
        recipientId: input.recipientId,
        offeringId: input.offeringId,
        body: input.body,
      });
      const event = {
        _id: String(item._id),
        senderId: req.user?.id,
        recipientId: input.recipientId,
        offeringId: input.offeringId,
        body: input.body,
        createdAt: item.createdAt,
      };
      emitToUser(input.recipientId, "message:new", event);
      await notifyUser(
        input.recipientId,
        "message",
        "New message",
        input.body.slice(0, 160),
        { messageId: item.id, offeringId: input.offeringId },
      );
      res.status(201).json({ item });
    } catch (error) {
      next(error);
    }
  },
);
router.post("/notifications/register-device", async (req, res, next) => {
  try {
    const { token } = z
      .object({ token: z.string().min(10).max(512) })
      .parse(req.body);
    if (
      !token.startsWith("ExponentPushToken[") &&
      !token.startsWith("ExpoPushToken[")
    ) {
      res.status(400).json({ error: "Invalid Expo push token." });
      return;
    }
    await User.updateOne(
      { _id: req.user?.id },
      { $addToSet: { pushTokens: token } },
    );
    res.json({ success: true });
  } catch (error) {
    next(error);
  }
});
export default router;
