import { Router } from "express";
import bcrypt from "bcrypt";
import mongoose from "mongoose";
import { z } from "zod";
import {
  AcademicYear,
  Announcement,
  Assessment,
  Attendance,
  AuditLog,
  ClassOffering,
  Department,
  Enrollment,
  GradeSummary,
  Institution,
  Notification,
  Program,
  ReviewRequest,
  Section,
  Semester,
  StudentScore,
  Subject,
  Submission,
  SystemSetting,
  User,
} from "../models/index";
import { allowRoles, requireAuth, sameInstitution } from "../middleware/auth";
import { recordAudit } from "../services/audit";
import { pageParams, tenantFilter } from "../utils/http";

const router = Router();
router.use(requireAuth);
const createUserSchema = z.object({
  name: z.string().trim().min(2).max(120),
  email: z.string().email().max(254),
  password: z.string().min(8).max(128),
  role: z.enum(["administrator", "faculty", "student"]),
  institutionId: z.string().optional(),
  departmentId: z.string().optional(),
  programId: z.string().optional(),
  sectionId: z.string().optional(),
  studentNumber: z.string().max(50).optional(),
});
const institutionInput = z.object({
  name: z.string().trim().min(2).max(180),
  code: z.string().trim().min(2).max(20),
  address: z.string().max(500).optional(),
  active: z.boolean().optional(),
});
const academicModels = new Map<string, mongoose.Model<Record<string, unknown>>>(
  [
    [
      "departments",
      Department as unknown as mongoose.Model<Record<string, unknown>>,
    ],
    ["programs", Program as unknown as mongoose.Model<Record<string, unknown>>],
    ["sections", Section as unknown as mongoose.Model<Record<string, unknown>>],
    [
      "academic-years",
      AcademicYear as unknown as mongoose.Model<Record<string, unknown>>,
    ],
    [
      "semesters",
      Semester as unknown as mongoose.Model<Record<string, unknown>>,
    ],
    ["subjects", Subject as unknown as mongoose.Model<Record<string, unknown>>],
  ],
);

async function mayEditAcademicRecords(
  req: import("express").Request,
): Promise<boolean> {
  if (req.user?.role === "super_admin") return true;
  if (req.user?.role !== "administrator") return false;
  const grant = await SystemSetting.findOne({
    key: "allowAcademicRecordEditing",
    institutionId: { $exists: false },
  })
    .select("value")
    .lean();
  return grant?.value === true;
}

router.get(
  "/institutions",
  allowRoles("super_admin"),
  async (_req, res, next) => {
    try {
      res.json({
        items: await Institution.find().sort({ createdAt: -1 }).lean(),
      });
    } catch (error) {
      next(error);
    }
  },
);
router.post(
  "/institutions",
  allowRoles("super_admin"),
  async (req, res, next) => {
    try {
      const input = institutionInput.parse(req.body);
      const institution = await Institution.create(input);
      await recordAudit(
        req,
        "institution.create",
        "institution",
        String(institution._id),
      );
      res.status(201).json({ item: institution });
    } catch (error) {
      next(error);
    }
  },
);
router.get(
  "/institutions/:id",
  allowRoles("super_admin"),
  async (req, res, next) => {
    try {
      const item = await Institution.findById(req.params.id).lean();
      if (!item) {
        res.status(404).json({ error: "Institution not found." });
        return;
      }
      const administrators = await User.find({
        institutionId: item._id,
        role: "administrator",
      })
        .select("name email active")
        .lean();
      res.json({ item, administrators });
    } catch (error) {
      next(error);
    }
  },
);
router.put(
  "/institutions/:id",
  allowRoles("super_admin"),
  async (req, res, next) => {
    try {
      const item = await Institution.findByIdAndUpdate(
        req.params.id,
        { $set: institutionInput.partial().parse(req.body) },
        { new: true, runValidators: true },
      );
      if (!item) {
        res.status(404).json({ error: "Institution not found." });
        return;
      }
      await recordAudit(
        req,
        "institution.update",
        "institution",
        String(item._id),
      );
      res.json({ item });
    } catch (error) {
      next(error);
    }
  },
);
router.patch(
  "/institutions/:id/status",
  allowRoles("super_admin"),
  async (req, res, next) => {
    try {
      const { active } = z.object({ active: z.boolean() }).parse(req.body);
      const item = await Institution.findByIdAndUpdate(
        req.params.id,
        { active },
        { new: true },
      );
      if (!item) {
        res.status(404).json({ error: "Institution not found." });
        return;
      }
      await recordAudit(
        req,
        active ? "institution.activate" : "institution.deactivate",
        "institution",
        String(item._id),
      );
      res.json({ item });
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/users",
  allowRoles("super_admin", "administrator"),
  async (req, res, next) => {
    try {
      const { page, limit, skip } = pageParams(req);
      const filter: Record<string, unknown> =
        req.user?.role === "super_admin"
          ? {}
          : { institutionId: req.user?.institutionId };
      if (
        typeof req.query.role === "string" &&
        ["administrator", "faculty", "student"].includes(req.query.role)
      )
        filter.role = req.query.role;
      if (
        req.user?.role === "super_admin" &&
        typeof req.query.institutionId === "string"
      ) {
        if (!mongoose.isValidObjectId(req.query.institutionId)) {
          res.status(400).json({ error: "Invalid institution filter." });
          return;
        }
        filter.institutionId = req.query.institutionId;
      }
      if (typeof req.query.search === "string")
        filter.$or = [
          { name: { $regex: req.query.search, $options: "i" } },
          { email: { $regex: req.query.search, $options: "i" } },
          { studentNumber: { $regex: req.query.search, $options: "i" } },
        ];
      const [items, total] = await Promise.all([
        User.find(filter)
          .select(
            "name email role institutionId departmentId programId sectionId studentNumber active createdAt",
          )
          .sort({ name: 1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        User.countDocuments(filter),
      ]);
      res.json({ items, page, limit, total });
    } catch (error) {
      next(error);
    }
  },
);
router.get(
  "/users/:id",
  allowRoles("super_admin", "administrator"),
  async (req, res, next) => {
    try {
      const item = await User.findById(req.params.id)
        .select(
          "name email role institutionId departmentId programId sectionId studentNumber active lastSignedInAt createdAt",
        )
        .lean();
      if (!item) {
        res.status(404).json({ error: "User not found." });
        return;
      }
      if (
        req.user?.role !== "super_admin" &&
        !sameInstitution(req, res, String(item.institutionId))
      )
        return;
      res.json({ item });
    } catch (error) {
      next(error);
    }
  },
);
router.post(
  "/users",
  allowRoles("super_admin", "administrator"),
  async (req, res, next) => {
    try {
      const input = createUserSchema.parse(req.body);
      if (
        req.user?.role === "administrator" &&
        input.role === "administrator"
      ) {
        res.status(403).json({
          error: "Administrators cannot create other administrator accounts.",
        });
        return;
      }
      const institutionId =
        req.user?.role === "super_admin"
          ? input.institutionId
          : req.user?.institutionId;
      if (!institutionId) {
        res.status(400).json({ error: "An institution is required." });
        return;
      }
      if (req.user?.role === "super_admin" && !institutionId) {
        res
          .status(400)
          .json({ error: "Choose an institution for this account." });
        return;
      }
      if (
        req.user?.role !== "super_admin" &&
        !sameInstitution(req, res, institutionId)
      )
        return;
      const user = await User.create({
        name: input.name,
        email: input.email.toLowerCase(),
        passwordHash: await bcrypt.hash(input.password, 12),
        role: input.role,
        institutionId,
        departmentId: input.departmentId,
        programId: input.programId,
        sectionId: input.sectionId,
        studentNumber: input.studentNumber,
        active: true,
      });
      await recordAudit(req, "user.create", "user", String(user._id), {
        role: user.role,
      });
      res.status(201).json({
        item: {
          id: user.id,
          name: user.name,
          email: user.email,
          role: user.role,
          institutionId: user.institutionId,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);
router.put(
  "/users/:id",
  allowRoles("super_admin", "administrator"),
  async (req, res, next) => {
    try {
      const input = z
        .object({
          name: z.string().trim().min(2).max(120).optional(),
          email: z.string().email().max(254).optional(),
          institutionId: z.string().optional(),
          departmentId: z.string().optional(),
          programId: z.string().optional(),
          sectionId: z.string().optional(),
          studentNumber: z.string().max(50).optional(),
        })
        .strict()
        .parse(req.body);
      const user = await User.findById(req.params.id);
      if (!user) {
        res.status(404).json({ error: "User not found." });
        return;
      }
      if (req.user?.role !== "super_admin") {
        if (
          !sameInstitution(
            req,
            res,
            user.institutionId ? String(user.institutionId) : undefined,
          )
        )
          return;
        if (user.role === "administrator") {
          res
            .status(403)
            .json({ error: "You cannot edit administrator accounts." });
          return;
        }
        if (input.email !== undefined || input.institutionId !== undefined) {
          res
            .status(403)
            .json({
              error:
                "Only Super Admin can change administrator email or institution assignment.",
            });
          return;
        }
      }
      if (
        user.role === "administrator" &&
        req.user?.role === "super_admin" &&
        !input.institutionId &&
        !user.institutionId
      ) {
        res
          .status(400)
          .json({ error: "Choose an institution for this administrator." });
        return;
      }
      const nextEmail = input.email?.trim().toLowerCase();
      if (
        nextEmail &&
        (await User.exists({ email: nextEmail, _id: { $ne: user._id } }))
      ) {
        res
          .status(409)
          .json({
            error: "That email address is already assigned to an account.",
          });
        return;
      }
      if (input.institutionId) {
        const institution = await Institution.findById(input.institutionId)
          .select("_id")
          .lean();
        if (!institution) {
          res.status(400).json({ error: "Select a valid institution." });
          return;
        }
      }
      Object.assign(user, input);
      if (nextEmail) user.email = nextEmail;
      if (input.institutionId)
        user.institutionId = new mongoose.Types.ObjectId(input.institutionId);
      await user.save();
      await recordAudit(req, "user.update", "user", String(user._id), {
        emailChanged: Boolean(nextEmail),
        institutionChanged: Boolean(input.institutionId),
      });
      res.json({
        item: {
          id: String(user._id),
          name: user.name,
          email: user.email,
          role: user.role,
          institutionId: user.institutionId,
          departmentId: user.departmentId,
          programId: user.programId,
          sectionId: user.sectionId,
          studentNumber: user.studentNumber,
        },
      });
    } catch (error) {
      next(error);
    }
  },
);
router.patch(
  "/users/:id/status",
  allowRoles("super_admin", "administrator"),
  async (req, res, next) => {
    try {
      const { active } = z.object({ active: z.boolean() }).parse(req.body);
      const user = await User.findById(req.params.id);
      if (!user) {
        res.status(404).json({ error: "User not found." });
        return;
      }
      if (
        req.user?.role !== "super_admin" &&
        (!sameInstitution(
          req,
          res,
          user.institutionId ? String(user.institutionId) : undefined,
        ) ||
          user.role === "administrator")
      ) {
        res.status(403).json({ error: "You cannot manage this account." });
        return;
      }
      user.active = active;
      if (!active) user.refreshTokenHash = undefined;
      await user.save();
      await recordAudit(
        req,
        active ? "user.activate" : "user.deactivate",
        "user",
        user.id,
      );
      res.json({ item: { id: user.id, name: user.name, active } });
    } catch (error) {
      next(error);
    }
  },
);
router.patch(
  "/users/:id/reset-password",
  allowRoles("super_admin", "administrator"),
  async (req, res, next) => {
    try {
      const { password } = z
        .object({ password: z.string().min(8).max(128) })
        .parse(req.body);
      const user = await User.findById(req.params.id);
      if (!user) {
        res.status(404).json({ error: "User not found." });
        return;
      }
      if (req.user?.role !== "super_admin") {
        if (
          !sameInstitution(
            req,
            res,
            user.institutionId ? String(user.institutionId) : undefined,
          )
        )
          return;
        if (user.role === "administrator") {
          res
            .status(403)
            .json({ error: "You cannot manage administrator accounts." });
          return;
        }
      }
      user.passwordHash = await bcrypt.hash(password, 12);
      user.refreshTokenHash = undefined;
      await user.save();
      await recordAudit(req, "user.password_reset", "user", user.id);
      res.json({ success: true });
    } catch (error) {
      next(error);
    }
  },
);

router.delete(
  "/users/:id",
  allowRoles("super_admin", "administrator"),
  async (req, res, next) => {
    try {
      const user = await User.findById(req.params.id);
      if (!user) {
        res.status(404).json({ error: "User not found." });
        return;
      }
      if (req.user?.role !== "super_admin") {
        if (
          !sameInstitution(
            req,
            res,
            user.institutionId ? String(user.institutionId) : undefined,
          )
        )
          return;
        if (user.role === "administrator") {
          res
            .status(403)
            .json({ error: "You cannot deactivate administrator accounts." });
          return;
        }
      }
      user.active = false;
      user.refreshTokenHash = undefined;
      await user.save();
      await recordAudit(req, "user.deactivate", "user", String(user._id));
      res.json({ success: true, active: false });
    } catch (error) {
      next(error);
    }
  },
);
router.get(
  "/audit-logs",
  allowRoles("super_admin", "administrator"),
  async (req, res, next) => {
    try {
      const { page, limit, skip } = pageParams(req);
      const filter: Record<string, unknown> =
        req.user?.role === "super_admin"
          ? {}
          : { institutionId: req.user?.institutionId };
      if (req.query.action === "login")
        filter.action = {
          $in: [
            "auth.login",
            "auth.logout",
            "auth.password_reset",
            "auth.password_reset_requested",
          ],
        };
      const [items, total] = await Promise.all([
        AuditLog.find(filter)
          .populate("actorId", "name email role")
          .sort({ createdAt: -1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        AuditLog.countDocuments(filter),
      ]);
      res.json({ items, page, limit, total });
    } catch (error) {
      next(error);
    }
  },
);
router.get(
  "/system-settings",
  allowRoles("super_admin", "administrator"),
  async (req, res, next) => {
    try {
      const filter =
        req.user?.role === "super_admin"
          ? { institutionId: { $exists: false } }
          : { institutionId: req.user?.institutionId };
      const [items, editGrant] = await Promise.all([
        SystemSetting.find(filter).sort({ key: 1 }).lean(),
        SystemSetting.findOne({
          key: "allowAcademicRecordEditing",
          institutionId: { $exists: false },
        })
          .select("value")
          .lean(),
      ]);
      res.json({
        items,
        academicRecordEditingEnabled: editGrant?.value === true,
      });
    } catch (error) {
      next(error);
    }
  },
);
router.put(
  "/system-settings/:key",
  allowRoles("super_admin", "administrator"),
  async (req, res, next) => {
    try {
      const key = z.string().min(2).max(80).parse(req.params.key);
      const { value } = z.object({ value: z.unknown() }).parse(req.body);
      if (
        key === "allowAcademicRecordEditing" &&
        req.user?.role !== "super_admin"
      ) {
        res.status(403).json({
          error:
            "Only Super Admin can grant academic-record editing permission.",
        });
        return;
      }
      const institutionId =
        req.user?.role === "super_admin" ? undefined : req.user?.institutionId;
      const item = await SystemSetting.findOneAndUpdate(
        { key, institutionId },
        { $set: { value } },
        { upsert: true, new: true, runValidators: true },
      );
      await recordAudit(
        req,
        "system_setting.update",
        "system_setting",
        String(item._id),
        { key },
      );
      res.json({ item });
    } catch (error) {
      next(error);
    }
  },
);
router.get("/dashboard/summary", async (req, res, next) => {
  try {
    const user = req.user;
    if (!user) {
      res.status(401).json({ error: "Authentication required." });
      return;
    }
    const tenant = tenantFilter(req);
    if (user.role === "super_admin") {
      const [
        institutions,
        administrators,
        faculty,
        students,
        subjects,
        activeUsers,
        inactiveUsers,
        offerings,
        activityCount,
        logs,
      ] = await Promise.all([
        Institution.countDocuments(),
        User.countDocuments({ role: "administrator" }),
        User.countDocuments({ role: "faculty" }),
        User.countDocuments({ role: "student" }),
        Subject.countDocuments(),
        User.countDocuments({ active: true }),
        User.countDocuments({ active: false }),
        ClassOffering.countDocuments({ archivedAt: null }),
        AuditLog.countDocuments(),
        AuditLog.find()
          .populate("actorId", "name")
          .sort({ createdAt: -1 })
          .limit(4)
          .lean(),
      ]);
      const recent = logs.map((log) => ({
        title: `${typeof log.actorId === "object" && log.actorId && "name" in log.actorId ? String(log.actorId.name) : "System"} · ${log.action}`,
        body: log.createdAt
          ? new Date(log.createdAt).toLocaleString()
          : "Recent activity",
      }));
      res.json({
        role: user.role,
        metrics: [
          { label: "Institutions", value: institutions },
          { label: "Administrators", value: administrators },
          { label: "Faculty", value: faculty },
          { label: "Students", value: students },
          { label: "Subjects", value: subjects },
          { label: "Active accounts", value: activeUsers },
          { label: "Inactive accounts", value: inactiveUsers },
          { label: "Class offerings", value: offerings },
          { label: "System audit events", value: activityCount },
        ],
        recent,
      });
      return;
    }
    if (user.role === "administrator") {
      const [
        faculty,
        students,
        departments,
        programs,
        sections,
        subjects,
        offerings,
        currentYear,
        currentSemester,
      ] = await Promise.all([
        User.countDocuments({ ...tenant, role: "faculty" }),
        User.countDocuments({ ...tenant, role: "student" }),
        Department.countDocuments(tenant),
        Program.countDocuments(tenant),
        Section.countDocuments(tenant),
        Subject.countDocuments(tenant),
        ClassOffering.countDocuments({ ...tenant, archivedAt: null }),
        AcademicYear.findOne({ ...tenant, current: true, archivedAt: null })
          .select("label")
          .lean(),
        Semester.findOne({ ...tenant, archivedAt: null })
          .sort({ startsAt: -1 })
          .select("name enrollmentOpen")
          .lean(),
      ]);
      res.json({
        role: user.role,
        currentAcademicYear: currentYear?.label ?? null,
        currentSemester: currentSemester?.name ?? null,
        enrollmentOpen: currentSemester?.enrollmentOpen ?? false,
        metrics: [
          { label: "Faculty", value: faculty },
          { label: "Students", value: students },
          { label: "Departments", value: departments },
          { label: "Programs", value: programs },
          { label: "Sections", value: sections },
          { label: "Subjects", value: subjects },
          { label: "Class offerings", value: offerings },
          { label: "Academic year", value: currentYear?.label ?? "Not set" },
          { label: "Semester", value: currentSemester?.name ?? "Not set" },
        ],
      });
      return;
    }
    if (user.role === "faculty") {
      const offerings = await ClassOffering.find({
        facultyId: user.id,
        archivedAt: null,
      })
        .select("_id capacity approvedCount")
        .lean();
      const offeringIds = offerings.map((item) => item._id);
      const [
        students,
        pending,
        assessments,
        notifications,
        announcements,
        overdue,
        lowPerformers,
        attendanceCount,
        reviews,
      ] = await Promise.all([
        Enrollment.countDocuments({
          offeringId: { $in: offeringIds },
          status: "approved",
        }),
        Enrollment.countDocuments({
          offeringId: { $in: offeringIds },
          status: "pending",
        }),
        Assessment.countDocuments({
          offeringId: { $in: offeringIds },
          dueAt: { $gte: new Date() },
          archivedAt: null,
        }),
        Notification.countDocuments({ userId: user.id, readAt: null }),
        Announcement.find({
          offeringId: { $in: offeringIds },
          publishedAt: { $ne: null },
        })
          .sort({ publishedAt: -1 })
          .limit(3)
          .lean(),
        Assessment.find({
          offeringId: { $in: offeringIds },
          dueAt: { $lt: new Date() },
          published: true,
          allowSubmission: true,
          archivedAt: null,
        })
          .select("_id")
          .lean(),
        GradeSummary.countDocuments({
          offeringId: { $in: offeringIds },
          finalGrade: { $lt: 60 },
          status: { $in: ["published", "finalized"] },
        }),
        Attendance.countDocuments({ offeringId: { $in: offeringIds } }),
        ReviewRequest.countDocuments({
          facultyId: user.id,
          status: { $in: ["pending", "under_review"] },
        }),
      ]);
      const submitted = await Submission.distinct("assessmentId", {
        assessmentId: { $in: overdue.map((item) => item._id) },
      });
      const missingActivities = Math.max(
        0,
        overdue.length * Math.max(students, 1) - submitted.length,
      );
      res.json({
        role: user.role,
        metrics: [
          { label: "Assigned subjects", value: offerings.length },
          { label: "Enrolled students", value: students },
          { label: "Pending requests", value: pending },
          { label: "Upcoming assessments", value: assessments },
          { label: "Missing activities", value: missingActivities },
          { label: "Students needing support", value: lowPerformers },
          { label: "Attendance records", value: attendanceCount },
          { label: "Review requests", value: reviews },
          { label: "Unread notifications", value: notifications },
        ],
        recent: announcements,
      });
      return;
    }
    const enrollments = await Enrollment.find({
      studentId: user.id,
      status: "approved",
    })
      .select("offeringId")
      .lean();
    const offeringIds = enrollments.map((item) => item.offeringId);
    const [grades, attendance, overdue, notifications, announcements] =
      await Promise.all([
        GradeSummary.find({
          studentId: user.id,
          offeringId: { $in: offeringIds },
          status: { $in: ["published", "finalized"] },
        })
          .select("finalGrade")
          .lean(),
        Attendance.find({
          studentId: user.id,
          offeringId: { $in: offeringIds },
        })
          .select("status")
          .lean(),
        Assessment.find({
          offeringId: { $in: offeringIds },
          published: true,
          allowSubmission: true,
          dueAt: { $lt: new Date() },
          archivedAt: null,
        })
          .select("_id")
          .lean(),
        Notification.countDocuments({ userId: user.id, readAt: null }),
        Announcement.find({
          institutionId: user.institutionId,
          audience: { $in: ["all", "student"] },
          offeringId: { $exists: false },
          publishedAt: { $ne: null },
        })
          .sort({ publishedAt: -1 })
          .limit(3)
          .lean(),
      ]);
    const submitted = await Submission.distinct("assessmentId", {
      studentId: user.id,
      assessmentId: { $in: overdue.map((item) => item._id) },
    });
    const missingActivities = overdue.length - submitted.length;
    const attendancePercent = attendance.length
      ? Math.round(
          (attendance.filter(
            (item) => item.status === "present" || item.status === "late",
          ).length /
            attendance.length) *
            100,
        )
      : null;
    const average = grades.length
      ? Math.round(
          (grades.reduce((sum, item) => sum + (item.finalGrade ?? 0), 0) /
            grades.length) *
            10,
        ) / 10
      : null;
    res.json({
      role: user.role,
      metrics: [
        { label: "Enrolled subjects", value: offeringIds.length },
        {
          label: "Overall standing",
          value: average === null ? "—" : `${average}%`,
        },
        {
          label: "Attendance",
          value: attendancePercent === null ? "—" : `${attendancePercent}%`,
        },
        { label: "Missing activities", value: missingActivities },
        { label: "Unread notifications", value: notifications },
      ],
      recent: announcements,
    });
  } catch (error) {
    next(error);
  }
});

router.get("/:resource", async (req, res, next) => {
  const target = academicModels.get(req.params.resource);
  if (!target) {
    next();
    return;
  }
  const facultyCatalog = new Set([
    "subjects",
    "sections",
    "academic-years",
    "semesters",
  ]);
  if (
    req.user?.role !== "super_admin" &&
    req.user?.role !== "administrator" &&
    !(req.user?.role === "faculty" && facultyCatalog.has(req.params.resource))
  ) {
    res.status(403).json({ error: "Academic management access required." });
    return;
  }
  try {
    const { page, limit, skip } = pageParams(req);
    const filter: Record<string, unknown> = {
      ...tenantFilter(req),
      archivedAt: null,
    };
    if (typeof req.query.search === "string")
      filter.name = { $regex: req.query.search, $options: "i" };
    const [items, total] = await Promise.all([
      target
        .find(filter)
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      target.countDocuments(filter),
    ]);
    res.json({ items, page, limit, total });
  } catch (error) {
    next(error);
  }
});
router.post(
  "/:resource",
  allowRoles("super_admin", "administrator"),
  async (req, res, next) => {
    const target = academicModels.get(req.params.resource);
    if (!target) {
      next();
      return;
    }
    if (!(await mayEditAcademicRecords(req))) {
      res.status(403).json({
        error:
          "Academic record editing has not been explicitly enabled by Super Admin.",
      });
      return;
    }
    try {
      const input = z.record(z.string(), z.unknown()).parse(req.body);
      const institutionId =
        req.user?.role === "super_admin"
          ? input.institutionId
          : req.user?.institutionId;
      if (req.user?.role !== "super_admin" && !institutionId) {
        res.status(400).json({ error: "Institution scope is missing." });
        return;
      }
      const data = { ...input, institutionId };
      const item = await target.create(data);
      await recordAudit(
        req,
        `${req.params.resource}.create`,
        req.params.resource,
        String(item._id),
      );
      res.status(201).json({ item });
    } catch (error) {
      next(error);
    }
  },
);
router.put(
  "/:resource/:id",
  allowRoles("super_admin", "administrator"),
  async (req, res, next) => {
    const target = academicModels.get(req.params.resource);
    if (!target) {
      next();
      return;
    }
    if (!(await mayEditAcademicRecords(req))) {
      res.status(403).json({
        error:
          "Academic record editing has not been explicitly enabled by Super Admin.",
      });
      return;
    }
    if (!mongoose.isValidObjectId(req.params.id)) {
      res.status(400).json({ error: "Invalid record ID." });
      return;
    }
    try {
      const input = z.record(z.string(), z.unknown()).parse(req.body);
      delete input.institutionId;
      delete input._id;
      delete input.createdAt;
      delete input.updatedAt;
      const item = await target.findOneAndUpdate(
        { _id: req.params.id, ...tenantFilter(req) },
        { $set: input },
        { new: true, runValidators: true },
      );
      if (!item) {
        res.status(404).json({ error: "Record not found." });
        return;
      }
      await recordAudit(
        req,
        `${req.params.resource}.update`,
        req.params.resource,
        req.params.id,
      );
      res.json({ item });
    } catch (error) {
      next(error);
    }
  },
);
router.delete(
  "/:resource/:id",
  allowRoles("super_admin", "administrator"),
  async (req, res, next) => {
    const target = academicModels.get(req.params.resource);
    if (!target) {
      next();
      return;
    }
    if (!(await mayEditAcademicRecords(req))) {
      res.status(403).json({
        error:
          "Academic record editing has not been explicitly enabled by Super Admin.",
      });
      return;
    }
    try {
      const item = await target.findOneAndUpdate(
        { _id: req.params.id, ...tenantFilter(req) },
        { $set: { archivedAt: new Date() } },
        { new: true },
      );
      if (!item) {
        res.status(404).json({ error: "Record not found." });
        return;
      }
      await recordAudit(
        req,
        `${req.params.resource}.archive`,
        req.params.resource,
        req.params.id,
      );
      res.json({ success: true, archived: true });
    } catch (error) {
      next(error);
    }
  },
);

export default router;
