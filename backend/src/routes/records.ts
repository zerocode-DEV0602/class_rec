import { Router } from "express";
import { z } from "zod";
import {
  Assessment,
  Attendance,
  AttendanceSession,
  ClassOffering,
  Enrollment,
  GradeSummary,
  GradingCategory,
  Intervention,
  Notification,
  ReviewRequest,
  StudentScore,
  SystemSetting,
  User,
} from "../models/index";
import { allowRoles, requireAuth, sameInstitution } from "../middleware/auth";
import { notifyUser, recordAudit } from "../services/audit";
import { calculateWeightedGrade } from "../services/grading";
import { storedFileExists } from "../services/storage";
import { pageParams, tenantFilter } from "../utils/http";

const router = Router();
router.use(requireAuth);
async function canManage(
  req: import("express").Request,
  offeringId: string,
): Promise<boolean> {
  const offering = await ClassOffering.findById(offeringId)
    .select("institutionId facultyId")
    .lean();
  if (!offering) return false;
  if (req.user?.role === "faculty")
    return String(offering.facultyId) === req.user.id;
  return (
    req.user?.role === "super_admin" ||
    (req.user?.role === "administrator" &&
      req.user.institutionId === String(offering.institutionId))
  );
}
const categoryInput = z.object({
  name: z.string().trim().min(2).max(80),
  weight: z.number().min(0).max(100),
  calculationMethod: z.enum(["points", "equal_average"]).default("points"),
  sortOrder: z.number().int().optional(),
});
const assessmentInput = z.object({
  categoryId: z.string(),
  title: z.string().trim().min(2).max(180),
  kind: z
    .enum(["assignment", "quiz", "exam", "performance_task"])
    .default("assignment"),
  description: z.string().max(5000).optional(),
  referenceFile: z
    .object({
      key: z.string().regex(/^file_[a-f0-9]{32}$/),
      name: z.string().max(255),
      mimeType: z.enum([
        "application/pdf",
        "image/jpeg",
        "image/png",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      ]),
      size: z.number().int().positive(),
    })
    .optional(),
  maxScore: z.number().positive().max(100000),
  dueAt: z.string().datetime().optional(),
  allowSubmission: z.boolean().default(false),
});

router.get(
  "/class-offerings/:id/gradebook",
  allowRoles("faculty", "administrator", "super_admin"),
  async (req, res, next) => {
    try {
      if (!(await canManage(req, req.params.id))) {
        res.status(404).json({ error: "Class offering not found." });
        return;
      }
      const [categories, assessments, roster] = await Promise.all([
        GradingCategory.find({ offeringId: req.params.id })
          .sort({ sortOrder: 1 })
          .lean(),
        Assessment.find({ offeringId: req.params.id, archivedAt: null })
          .sort({ createdAt: 1 })
          .lean(),
        Enrollment.find({ offeringId: req.params.id, status: "approved" })
          .populate("studentId", "name email studentNumber")
          .lean(),
      ]);
      const studentIds = roster.map((entry) =>
        String(
          entry.studentId &&
            typeof entry.studentId === "object" &&
            "_id" in entry.studentId
            ? entry.studentId._id
            : entry.studentId,
        ),
      );
      const scores = await StudentScore.find({
        offeringId: req.params.id,
        studentId: { $in: studentIds },
      }).lean();
      res.json({ categories, assessments, roster, scores });
    } catch (error) {
      next(error);
    }
  },
);
router.post(
  "/class-offerings/:id/grading-categories",
  allowRoles("faculty"),
  async (req, res, next) => {
    try {
      if (!(await canManage(req, req.params.id))) {
        res.status(404).json({ error: "Class offering not found." });
        return;
      }
      const input = categoryInput.parse(req.body);
      const existing = await GradingCategory.find({ offeringId: req.params.id })
        .select("weight")
        .lean();
      if (
        existing.reduce((sum, item) => sum + (item.weight ?? 0), input.weight) >
        100.001
      ) {
        res
          .status(400)
          .json({ error: "Grading category weights cannot exceed 100%." });
        return;
      }
      const offering = await ClassOffering.findById(req.params.id)
        .select("institutionId")
        .lean();
      const item = await GradingCategory.create({
        ...input,
        institutionId: offering?.institutionId,
        offeringId: req.params.id,
      });
      await recordAudit(
        req,
        "grading_category.create",
        "grading_category",
        item.id,
      );
      res.status(201).json({ item });
    } catch (error) {
      next(error);
    }
  },
);
router.put(
  "/grading-categories/:id",
  allowRoles("faculty"),
  async (req, res, next) => {
    try {
      const current = await GradingCategory.findById(req.params.id);
      if (!current || !(await canManage(req, String(current.offeringId)))) {
        res.status(404).json({ error: "Grading category not found." });
        return;
      }
      const input = categoryInput.partial().parse(req.body);
      const categories = await GradingCategory.find({
        offeringId: current.offeringId,
        _id: { $ne: current._id },
      })
        .select("weight")
        .lean();
      const total =
        categories.reduce((sum, item) => sum + (item.weight ?? 0), 0) +
        (input.weight ?? current.weight ?? 0);
      if (total > 100.001) {
        res
          .status(400)
          .json({ error: "Grading category weights cannot exceed 100%." });
        return;
      }
      const item = await GradingCategory.findByIdAndUpdate(
        current._id,
        { $set: input },
        { new: true, runValidators: true },
      );
      await recordAudit(
        req,
        "grading_category.update",
        "grading_category",
        current.id,
      );
      res.json({ item });
    } catch (error) {
      next(error);
    }
  },
);
router.post("/assessments", allowRoles("faculty"), async (req, res, next) => {
  try {
    const input = assessmentInput
      .extend({ offeringId: z.string() })
      .parse(req.body);
    if (!(await canManage(req, input.offeringId))) {
      res.status(404).json({ error: "Class offering not found." });
      return;
    }
    const category = await GradingCategory.findById(input.categoryId)
      .select("offeringId institutionId")
      .lean();
    if (!category || String(category.offeringId) !== input.offeringId) {
      res
        .status(400)
        .json({ error: "Choose a grading category from this offering." });
      return;
    }
    if (
      input.referenceFile &&
      !(await storedFileExists(input.referenceFile.key))
    ) {
      res
        .status(400)
        .json({ error: "The activity reference file is unavailable." });
      return;
    }
    const item = await Assessment.create({
      ...input,
      dueAt: input.dueAt ? new Date(input.dueAt) : undefined,
      institutionId: category.institutionId,
    });
    await recordAudit(req, "assessment.create", "assessment", item.id);
    res.status(201).json({ item });
  } catch (error) {
    next(error);
  }
});
router.get("/assessments", async (req, res, next) => {
  try {
    const offeringId =
      typeof req.query.offeringId === "string"
        ? req.query.offeringId
        : undefined;
    if (!offeringId) {
      res.status(400).json({ error: "offeringId is required." });
      return;
    }
    if (req.user?.role === "faculty" && !(await canManage(req, offeringId))) {
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
    const filter: Record<string, unknown> = { offeringId, archivedAt: null };
    if (req.user?.role === "student") filter.published = true;
    res.json({
      items: await Assessment.find(filter).sort({ dueAt: 1 }).lean(),
    });
  } catch (error) {
    next(error);
  }
});
router.post("/scores", allowRoles("faculty"), async (req, res, next) => {
  try {
    const input = z
      .object({
        assessmentId: z.string(),
        studentId: z.string(),
        score: z.number().min(0),
        remarks: z.string().max(1000).optional(),
        reason: z.string().max(500).optional(),
      })
      .parse(req.body);
    const assessment = await Assessment.findById(input.assessmentId).lean();
    if (!assessment || !(await canManage(req, String(assessment.offeringId)))) {
      res.status(404).json({ error: "Assessment not found." });
      return;
    }
    if (input.score > (assessment.maxScore ?? 0)) {
      res
        .status(400)
        .json({ error: "Score cannot exceed the assessment maximum." });
      return;
    }
    if (
      !(await Enrollment.exists({
        offeringId: assessment.offeringId,
        studentId: input.studentId,
        status: "approved",
      }))
    ) {
      res.status(400).json({
        error:
          "Scores can only be entered for approved students on the roster.",
      });
      return;
    }
    const existing = await StudentScore.findOne({
      assessmentId: assessment._id,
      studentId: input.studentId,
    });
    const previous = existing?.score;
    if (existing && !input.reason?.trim()) {
      res.status(400).json({
        error: "A reason is required when changing an existing score.",
      });
      return;
    }
    const item = await StudentScore.findOneAndUpdate(
      { assessmentId: assessment._id, studentId: input.studentId },
      {
        $set: {
          institutionId: assessment.institutionId,
          offeringId: assessment.offeringId,
          score: input.score,
          remarks: input.remarks,
        },
        $setOnInsert: {
          assessmentId: assessment._id,
          studentId: input.studentId,
        },
        ...(existing
          ? {
              $push: {
                history: {
                  score: previous,
                  remarks: existing.remarks,
                  changedBy: req.user?.id,
                  changedAt: new Date(),
                  reason: input.reason,
                },
              },
            }
          : {}),
      },
      { new: true, upsert: true, runValidators: true },
    );
    await recordAudit(req, "student_score.save", "student_score", item.id, {
      assessmentId: input.assessmentId,
      studentId: input.studentId,
      previous,
      score: input.score,
    });
    res.json({ item });
  } catch (error) {
    next(error);
  }
});
router.get("/students/:id/grades", async (req, res, next) => {
  try {
    if (req.user?.role === "student" && req.user.id !== req.params.id) {
      res
        .status(403)
        .json({ error: "Students can only view their own grades." });
      return;
    }
    if (
      !["student", "faculty", "administrator", "super_admin"].includes(
        req.user?.role ?? "",
      )
    ) {
      res.status(403).json({ error: "Not authorized." });
      return;
    }
    const query: Record<string, unknown> = { studentId: req.params.id };
    if (req.user?.role === "student")
      query.status = { $in: ["published", "finalized"] };
    if (req.user?.role === "faculty") {
      const assigned = await ClassOffering.find({
        facultyId: req.user.id,
      }).distinct("_id");
      query.offeringId = { $in: assigned };
    }
    if (req.user?.role === "administrator" || req.user?.role === "super_admin")
      query.institutionId =
        req.user?.role === "super_admin"
          ? { $exists: true }
          : req.user.institutionId;
    const items = await GradeSummary.find(query)
      .populate({
        path: "offeringId",
        populate: { path: "subjectId", select: "code name" },
      })
      .sort({ updatedAt: -1 })
      .lean();
    res.json({ items });
  } catch (error) {
    next(error);
  }
});
router.get("/students/:id/scores", async (req, res, next) => {
  try {
    if (req.user?.role === "student" && req.user.id !== req.params.id) {
      res
        .status(403)
        .json({ error: "Students can only view their own scores." });
      return;
    }
    const student = await User.findById(req.params.id)
      .select("institutionId")
      .lean();
    if (!student) {
      res.status(404).json({ error: "Student not found." });
      return;
    }
    if (
      req.user?.role === "administrator" &&
      String(student.institutionId) !== req.user.institutionId
    ) {
      res.status(404).json({ error: "Student not found." });
      return;
    }
    const offeringIds =
      req.user?.role === "faculty"
        ? await ClassOffering.find({ facultyId: req.user.id }).distinct("_id")
        : undefined;
    const scores = await StudentScore.find({
      studentId: req.params.id,
      ...(offeringIds ? { offeringId: { $in: offeringIds } } : {}),
    })
      .populate({
        path: "assessmentId",
        select: "title maxScore published kind dueAt categoryId",
        populate: { path: "categoryId", select: "name" },
      })
      .sort({ updatedAt: -1 })
      .lean();
    res.json({
      items:
        req.user?.role === "student"
          ? scores.filter((score) =>
              Boolean(
                score.assessmentId &&
                typeof score.assessmentId === "object" &&
                "published" in score.assessmentId &&
                score.assessmentId.published,
              ),
            )
          : scores,
    });
  } catch (error) {
    next(error);
  }
});
router.post(
  "/assessments/:id/publish",
  allowRoles("faculty"),
  async (req, res, next) => {
    try {
      const assessment = await Assessment.findById(req.params.id);
      if (
        !assessment ||
        !(await canManage(req, String(assessment.offeringId)))
      ) {
        res.status(404).json({ error: "Assessment not found." });
        return;
      }
      assessment.published = true;
      await assessment.save();
      const students = await Enrollment.find({
        offeringId: assessment.offeringId,
        status: "approved",
      }).distinct("studentId");
      for (const studentId of students)
        await notifyUser(
          String(studentId),
          "activity",
          "New class activity",
          `${assessment.title} is now available.`,
          {
            assessmentId: assessment.id,
            offeringId: String(assessment.offeringId),
          },
        );
      await recordAudit(req, "assessment.publish", "assessment", assessment.id);
      res.json({ item: assessment, notified: students.length });
    } catch (error) {
      next(error);
    }
  },
);
router.post(
  "/grades/publish",
  allowRoles("faculty"),
  async (req, res, next) => {
    try {
      const { offeringId, period } = z
        .object({
          offeringId: z.string(),
          period: z.string().trim().min(2).max(60).default("final"),
        })
        .parse(req.body);
      const storedPolicy = await SystemSetting.findOne({
        institutionId: req.user?.institutionId,
        key: "gradingPolicy",
      })
        .select("value")
        .lean();
      const policy = z
        .object({
          decimals: z.number().int().min(0).max(4).default(2),
          missingScorePolicy: z.enum(["exclude", "zero"]).default("exclude"),
        })
        .parse(storedPolicy?.value ?? {});
      const { decimals, missingScorePolicy } = policy;
      if (!(await canManage(req, offeringId))) {
        res.status(404).json({ error: "Class offering not found." });
        return;
      }
      const [categories, assessments, students] = await Promise.all([
        GradingCategory.find({ offeringId }).sort({ sortOrder: 1 }).lean(),
        Assessment.find({ offeringId }).lean(),
        Enrollment.find({ offeringId, status: "approved" }).distinct(
          "studentId",
        ),
      ]);
      if (
        !categories.length ||
        Math.abs(
          categories.reduce(
            (sum, category) => sum + (category.weight ?? 0),
            0,
          ) - 100,
        ) > 0.001
      ) {
        res.status(400).json({
          error: "Grading category weights must total 100% before publication.",
        });
        return;
      }
      const published: { studentId: string; finalGrade: number | null }[] = [];
      for (const studentId of students) {
        const scores = await StudentScore.find({
          offeringId,
          studentId,
        }).lean();
        const calculations = calculateWeightedGrade(
          categories.map((category) => ({
            categoryId: String(category._id),
            weight: category.weight ?? 0,
            method:
              category.calculationMethod === "equal_average"
                ? "equal_average"
                : "points",
            assessments: assessments
              .filter(
                (assessment) =>
                  String(assessment.categoryId) === String(category._id),
              )
              .map((assessment) => ({
                maxScore: assessment.maxScore ?? 0,
                score: scores.find(
                  (score) =>
                    String(score.assessmentId) === String(assessment._id),
                )?.score,
              })),
          })),
          { decimals, missingScorePolicy },
        );
        const status =
          calculations.finalGrade === null ? "calculated" : "published";
        await GradeSummary.findOneAndUpdate(
          { offeringId, studentId, period },
          {
            $set: {
              institutionId: req.user?.institutionId,
              categoryResults: calculations.categoryResults,
              finalGrade: calculations.finalGrade,
              status,
              publishedAt: status === "published" ? new Date() : undefined,
            },
          },
          { upsert: true, new: true, runValidators: true },
        );
        if (status === "published")
          await notifyUser(
            String(studentId),
            "grade_published",
            "Grades published",
            "Your class grade has been published.",
            { offeringId, period },
          );
        published.push({
          studentId: String(studentId),
          finalGrade: calculations.finalGrade,
        });
      }
      await recordAudit(req, "grades.publish", "grade_summary", undefined, {
        offeringId,
        period,
        count: published.length,
      });
      res.json({
        published: published.filter((item) => item.finalGrade !== null).length,
        incomplete: published.filter((item) => item.finalGrade === null).length,
        results: published,
      });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/grades/finalize",
  allowRoles("faculty"),
  async (req, res, next) => {
    try {
      const { offeringId, period } = z
        .object({
          offeringId: z.string(),
          period: z.string().trim().min(2).max(60).default("final"),
        })
        .parse(req.body);
      if (!(await canManage(req, offeringId))) {
        res.status(404).json({ error: "Class offering not found." });
        return;
      }
      const result = await GradeSummary.updateMany(
        { offeringId, period, status: "published" },
        { $set: { status: "finalized" } },
      );
      await recordAudit(req, "grades.finalize", "grade_summary", undefined, {
        offeringId,
        period,
        count: result.modifiedCount,
      });
      res.json({ finalized: result.modifiedCount });
    } catch (error) {
      next(error);
    }
  },
);
router.post(
  "/attendance-sessions",
  allowRoles("faculty"),
  async (req, res, next) => {
    try {
      const input = z
        .object({
          offeringId: z.string(),
          date: z.string().datetime(),
          topic: z.string().max(300).optional(),
        })
        .parse(req.body);
      if (!(await canManage(req, input.offeringId))) {
        res.status(404).json({ error: "Class offering not found." });
        return;
      }
      const offering = await ClassOffering.findById(input.offeringId)
        .select("institutionId")
        .lean();
      const item = await AttendanceSession.create({
        institutionId: offering?.institutionId,
        offeringId: input.offeringId,
        date: new Date(input.date),
        topic: input.topic,
        createdBy: req.user?.id,
      });
      await recordAudit(
        req,
        "attendance_session.create",
        "attendance_session",
        item.id,
      );
      res.status(201).json({ item });
    } catch (error) {
      next(error);
    }
  },
);
router.post(
  "/attendance/bulk",
  allowRoles("faculty"),
  async (req, res, next) => {
    try {
      const input = z
        .object({
          sessionId: z.string(),
          records: z
            .array(
              z
                .object({
                  studentId: z.string(),
                  status: z.enum(["present", "absent", "late", "excused"]),
                  reason: z.string().max(500).optional(),
                })
                .strict(),
            )
            .min(1)
            .max(500),
        })
        .parse(req.body);
      if (
        new Set(input.records.map((record) => record.studentId)).size !==
        input.records.length
      ) {
        res.status(400).json({
          error: "Duplicate student attendance entries are not allowed.",
        });
        return;
      }
      const session = await AttendanceSession.findById(input.sessionId).lean();
      if (!session || !(await canManage(req, String(session.offeringId)))) {
        res.status(404).json({ error: "Attendance session not found." });
        return;
      }
      const studentIds = input.records.map((record) => record.studentId);
      const enrolled = await Enrollment.find({
        offeringId: session.offeringId,
        studentId: { $in: studentIds },
        status: "approved",
      }).distinct("studentId");
      if (enrolled.length !== studentIds.length) {
        res.status(400).json({
          error: "Attendance may only be saved for approved roster students.",
        });
        return;
      }
      const saved = [];
      for (const record of input.records) {
        const existing = await Attendance.findOne({
          sessionId: input.sessionId,
          studentId: record.studentId,
        });
        if (
          existing &&
          existing.status !== record.status &&
          !record.reason?.trim()
        ) {
          res.status(400).json({
            error: "A reason is required when changing an attendance record.",
          });
          return;
        }
        const update = existing
          ? {
              $set: { status: record.status },
              $push: {
                history: {
                  status: existing.status,
                  changedBy: req.user?.id,
                  changedAt: new Date(),
                  reasonForEdit: record.reason,
                },
              },
            }
          : {
              $set: {
                status: record.status,
                institutionId: session.institutionId,
                offeringId: session.offeringId,
              },
            };
        const item = await Attendance.findOneAndUpdate(
          { sessionId: input.sessionId, studentId: record.studentId },
          {
            ...update,
            $setOnInsert: {
              sessionId: input.sessionId,
              studentId: record.studentId,
            },
          },
          { new: true, upsert: true, runValidators: true },
        );
        saved.push(item);
      }
      await recordAudit(
        req,
        "attendance.bulk_save",
        "attendance_session",
        input.sessionId,
        { count: saved.length },
      );
      res.json({ items: saved });
    } catch (error) {
      next(error);
    }
  },
);
router.get(
  "/attendance/class/:classOfferingId",
  allowRoles("faculty", "administrator", "super_admin"),
  async (req, res, next) => {
    try {
      if (!(await canManage(req, req.params.classOfferingId))) {
        res.status(404).json({ error: "Class offering not found." });
        return;
      }
      const items = await AttendanceSession.find({
        offeringId: req.params.classOfferingId,
      })
        .sort({ date: -1 })
        .lean();
      const records = await Attendance.find({
        offeringId: req.params.classOfferingId,
      })
        .populate("studentId", "name studentNumber")
        .sort({ createdAt: -1 })
        .lean();
      res.json({ sessions: items, records });
    } catch (error) {
      next(error);
    }
  },
);
router.get("/attendance/student/:studentId", async (req, res, next) => {
  try {
    if (req.user?.role === "student" && req.user.id !== req.params.studentId) {
      res
        .status(403)
        .json({ error: "Students can only view their own attendance." });
      return;
    }
    if (req.user?.role === "faculty") {
      const offeringIds = await ClassOffering.find({
        facultyId: req.user.id,
      }).distinct("_id");
      const items = await Attendance.find({
        studentId: req.params.studentId,
        offeringId: { $in: offeringIds },
      })
        .populate("sessionId", "date topic")
        .sort({ createdAt: -1 })
        .lean();
      res.json({ items });
      return;
    }
    if (
      req.user?.role === "administrator" ||
      req.user?.role === "super_admin"
    ) {
      const student = await User.findById(req.params.studentId)
        .select("institutionId")
        .lean();
      if (!student || !sameInstitution(req, res, String(student.institutionId)))
        return;
    }
    const items = await Attendance.find({ studentId: req.params.studentId })
      .populate("sessionId", "date topic")
      .sort({ createdAt: -1 })
      .lean();
    res.json({ items });
  } catch (error) {
    next(error);
  }
});

router.get("/interventions", async (req, res, next) => {
  try {
    const filter: Record<string, unknown> =
      req.user?.role === "student"
        ? { studentId: req.user.id }
        : req.user?.role === "faculty"
          ? { facultyId: req.user.id }
          : req.user?.role === "administrator"
            ? { institutionId: req.user.institutionId }
            : {};
    res.json({
      items: await Intervention.find(filter)
        .populate("studentId", "name studentNumber")
        .populate("offeringId", "subjectId")
        .sort({ updatedAt: -1 })
        .limit(200)
        .lean(),
    });
  } catch (error) {
    next(error);
  }
});
router.post("/interventions", allowRoles("faculty"), async (req, res, next) => {
  try {
    const input = z
      .object({
        offeringId: z.string(),
        studentId: z.string(),
        note: z.string().trim().min(3).max(2000),
        recommendation: z.string().max(2000).optional(),
        followUpAt: z.string().datetime().optional(),
      })
      .parse(req.body);
    if (
      !(await canManage(req, input.offeringId)) ||
      !(await Enrollment.exists({
        offeringId: input.offeringId,
        studentId: input.studentId,
        status: "approved",
      }))
    ) {
      res.status(404).json({ error: "Approved student record not found." });
      return;
    }
    const offering = await ClassOffering.findById(input.offeringId)
      .select("institutionId")
      .lean();
    const item = await Intervention.create({
      ...input,
      institutionId: offering?.institutionId,
      facultyId: req.user?.id,
      followUpAt: input.followUpAt ? new Date(input.followUpAt) : undefined,
    });
    await notifyUser(
      input.studentId,
      "intervention",
      "Faculty follow-up",
      input.recommendation ?? input.note,
      { interventionId: item.id },
    );
    await recordAudit(req, "intervention.create", "intervention", item.id);
    res.status(201).json({ item });
  } catch (error) {
    next(error);
  }
});
router.patch(
  "/interventions/:id",
  allowRoles("faculty"),
  async (req, res, next) => {
    try {
      const input = z
        .object({
          note: z.string().trim().min(3).max(2000).optional(),
          recommendation: z.string().max(2000).optional(),
          followUpAt: z.string().datetime().nullable().optional(),
          needsAssistance: z.boolean().optional(),
        })
        .strict()
        .parse(req.body);
      const item = await Intervention.findOneAndUpdate(
        { _id: req.params.id, facultyId: req.user?.id },
        {
          $set: {
            ...input,
            ...(input.followUpAt
              ? { followUpAt: new Date(input.followUpAt) }
              : {}),
          },
        },
        { new: true, runValidators: true },
      );
      if (!item) {
        res.status(404).json({ error: "Intervention not found." });
        return;
      }
      await recordAudit(req, "intervention.update", "intervention", item.id);
      res.json({ item });
    } catch (error) {
      next(error);
    }
  },
);
router.get("/notifications", async (req, res, next) => {
  try {
    const { page, limit, skip } = pageParams(req);
    const [items, total] = await Promise.all([
      Notification.find({ userId: req.user?.id })
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      Notification.countDocuments({ userId: req.user?.id }),
    ]);
    res.json({ items, page, limit, total });
  } catch (error) {
    next(error);
  }
});
router.patch("/notifications/:id/read", async (req, res, next) => {
  try {
    const item = await Notification.findOneAndUpdate(
      { _id: req.params.id, userId: req.user?.id },
      { readAt: new Date() },
      { new: true },
    );
    if (!item) {
      res.status(404).json({ error: "Notification not found." });
      return;
    }
    res.json({ item });
  } catch (error) {
    next(error);
  }
});
router.post(
  "/review-requests",
  allowRoles("student"),
  async (req, res, next) => {
    try {
      const input = z
        .object({
          offeringId: z.string(),
          recordType: z.enum(["grade", "attendance"]),
          recordId: z.string(),
          reason: z.string().trim().min(10).max(2000),
        })
        .parse(req.body);
      if (
        !(await Enrollment.exists({
          offeringId: input.offeringId,
          studentId: req.user?.id,
          status: "approved",
        }))
      ) {
        res
          .status(403)
          .json({ error: "This class is not on your approved subject list." });
        return;
      }
      const validRecord =
        input.recordType === "attendance"
          ? await Attendance.exists({
              _id: input.recordId,
              offeringId: input.offeringId,
              studentId: req.user?.id,
            })
          : (await StudentScore.exists({
              _id: input.recordId,
              offeringId: input.offeringId,
              studentId: req.user?.id,
            })) ||
            (await GradeSummary.exists({
              _id: input.recordId,
              offeringId: input.offeringId,
              studentId: req.user?.id,
              status: { $in: ["published", "finalized"] },
            }));
      if (!validRecord) {
        res.status(404).json({
          error: "The grade or attendance record is unavailable for review.",
        });
        return;
      }
      const offering = await ClassOffering.findById(input.offeringId)
        .select("facultyId institutionId")
        .lean();
      if (!offering) {
        res.status(404).json({ error: "Class offering not found." });
        return;
      }
      const item = await ReviewRequest.create({
        institutionId: offering.institutionId,
        studentId: req.user?.id,
        facultyId: offering.facultyId,
        offeringId: input.offeringId,
        recordType: input.recordType,
        recordId: input.recordId,
        reason: input.reason,
        status: "pending",
      });
      await notifyUser(
        String(offering.facultyId),
        "review_request",
        "Record review requested",
        "A student requested a grade or attendance review.",
        { requestId: item.id },
      );
      await recordAudit(
        req,
        "review_request.create",
        "review_request",
        item.id,
      );
      res.status(201).json({ item });
    } catch (error) {
      next(error);
    }
  },
);
router.get("/review-requests", async (req, res, next) => {
  try {
    const filter: Record<string, unknown> =
      req.user?.role === "student"
        ? { studentId: req.user.id }
        : req.user?.role === "faculty"
          ? { facultyId: req.user.id }
          : tenantFilter(req);
    const items = await ReviewRequest.find(filter)
      .sort({ createdAt: -1 })
      .lean();
    res.json({ items });
  } catch (error) {
    next(error);
  }
});
router.patch(
  "/review-requests/:id",
  allowRoles("faculty"),
  async (req, res, next) => {
    try {
      const { status, response } = z
        .object({
          status: z.enum(["under_review", "resolved", "rejected"]),
          response: z.string().trim().min(2).max(2000),
        })
        .parse(req.body);
      const item = await ReviewRequest.findOneAndUpdate(
        {
          _id: req.params.id,
          facultyId: req.user?.id,
          status: { $in: ["pending", "under_review"] },
        },
        { status, response },
        { new: true },
      );
      if (!item) {
        res
          .status(404)
          .json({ error: "Review request not found or already resolved." });
        return;
      }
      await notifyUser(
        String(item.studentId),
        "review_response",
        "Review request updated",
        response,
        { requestId: item.id, status },
      );
      await recordAudit(
        req,
        "review_request.update",
        "review_request",
        item.id,
        { status },
      );
      res.json({ item });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
