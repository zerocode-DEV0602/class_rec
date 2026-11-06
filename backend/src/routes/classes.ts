import { randomBytes } from "node:crypto";
import { Router } from "express";
import mongoose from "mongoose";
import { z } from "zod";
import {
  AcademicYear,
  ClassOffering,
  Enrollment,
  GradingCategory,
  Institution,
  Section,
  Semester,
  Subject,
  User,
} from "../models/index";
import { allowRoles, requireAuth, sameInstitution } from "../middleware/auth";
import { notifyUser, recordAudit } from "../services/audit";
import { pageParams, tenantFilter } from "../utils/http";

const router = Router();
router.use(requireAuth);
const offerSchema = z.object({
  subjectId: z.string(),
  sectionId: z.string().optional(),
  academicYearId: z.string(),
  semesterId: z.string(),
  schedule: z
    .array(
      z.object({
        day: z.string().min(2).max(12),
        startsAt: z.string(),
        endsAt: z.string(),
      }),
    )
    .default([]),
  location: z.string().max(160).optional(),
  capacity: z.number().int().min(1).max(500),
  codeExpiresAt: z.string().datetime().optional(),
});
async function canManageOffering(
  req: import("express").Request,
  offeringId: string,
): Promise<boolean> {
  const offering = await ClassOffering.findById(offeringId)
    .select("institutionId facultyId")
    .lean();
  if (!offering) return false;
  if (
    req.user?.role === "faculty" &&
    String(offering.facultyId) !== req.user.id
  )
    return false;
  return (
    req.user?.role === "super_admin" ||
    req.user?.institutionId === String(offering.institutionId)
  );
}

router.get("/class-offerings", async (req, res, next) => {
  try {
    const { page, limit, skip } = pageParams(req);
    let filter: Record<string, unknown> = {
      ...tenantFilter(req),
      archivedAt: null,
    };
    if (req.user?.role === "faculty") filter.facultyId = req.user.id;
    if (req.user?.role === "student") {
      const enrolled = await Enrollment.find({
        studentId: req.user.id,
        status: "approved",
      }).distinct("offeringId");
      filter = { _id: { $in: enrolled }, archivedAt: null };
    }
    const [items, total] = await Promise.all([
      ClassOffering.find(filter)
        .populate("subjectId", "code name units")
        .populate("facultyId", "name email")
        .populate("sectionId", "name")
        .populate("academicYearId", "label")
        .populate("semesterId", "name")
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      ClassOffering.countDocuments(filter),
    ]);
    res.json({ items, page, limit, total });
  } catch (error) {
    next(error);
  }
});
router.post(
  "/class-offerings",
  allowRoles("faculty"),
  async (req, res, next) => {
    try {
      const input = offerSchema.parse(req.body);
      const [subject, section, academicYear, semester] = await Promise.all([
        Subject.findOne({ _id: input.subjectId, archivedAt: null })
          .select("institutionId")
          .lean(),
        input.sectionId
          ? Section.findOne({ _id: input.sectionId, archivedAt: null })
              .select("institutionId")
              .lean()
          : Promise.resolve(null),
        AcademicYear.findById(input.academicYearId)
          .select("institutionId")
          .lean(),
        Semester.findById(input.semesterId)
          .select("institutionId academicYearId")
          .lean(),
      ]);
      if (
        !subject ||
        String(subject.institutionId) !== req.user?.institutionId
      ) {
        res
          .status(404)
          .json({ error: "Subject is not available in your institution." });
        return;
      }
      if (
        input.sectionId &&
        (!section || String(section.institutionId) !== req.user?.institutionId)
      ) {
        res
          .status(404)
          .json({ error: "Section is not available in your institution." });
        return;
      }
      if (
        !academicYear ||
        String(academicYear.institutionId) !== req.user?.institutionId ||
        !semester ||
        String(semester.institutionId) !== req.user?.institutionId ||
        String(semester.academicYearId) !== input.academicYearId
      ) {
        res
          .status(400)
          .json({
            error:
              "Select a matching academic year and semester from your institution.",
          });
        return;
      }
      const institution = await Institution.findById(req.user?.institutionId)
        .select("_id")
        .lean();
      if (!institution) {
        res.status(400).json({ error: "Your institution is unavailable." });
        return;
      }
      const code = randomBytes(4).toString("hex").toUpperCase();
      const item = await ClassOffering.create({
        ...input,
        institutionId: req.user?.institutionId,
        facultyId: req.user?.id,
        capacity: input.capacity,
        codeExpiresAt: input.codeExpiresAt
          ? new Date(input.codeExpiresAt)
          : undefined,
        enrollmentCode: code,
        enrollmentEnabled: true,
      });
      await GradingCategory.insertMany([
        {
          institutionId: req.user?.institutionId,
          offeringId: item._id,
          name: "Written Works",
          weight: 30,
          calculationMethod: "points",
          sortOrder: 1,
        },
        {
          institutionId: req.user?.institutionId,
          offeringId: item._id,
          name: "Performance Tasks",
          weight: 50,
          calculationMethod: "points",
          sortOrder: 2,
        },
        {
          institutionId: req.user?.institutionId,
          offeringId: item._id,
          name: "Major Examinations",
          weight: 20,
          calculationMethod: "points",
          sortOrder: 3,
        },
      ]);
      await recordAudit(
        req,
        "class_offering.create",
        "class_offering",
        item.id,
      );
      res.status(201).json({ item });
    } catch (error) {
      next(error);
    }
  },
);
router.get("/class-offerings/:id", async (req, res, next) => {
  try {
    const item = await ClassOffering.findById(req.params.id)
      .populate("subjectId", "code name units description")
      .populate("facultyId", "name email")
      .populate("sectionId", "name")
      .populate("academicYearId", "label")
      .populate("semesterId", "name")
      .lean();
    if (!item) {
      res.status(404).json({ error: "Class offering not found." });
      return;
    }
    const isStudent =
      req.user?.role === "student" &&
      (await Enrollment.exists({
        offeringId: req.params.id,
        studentId: req.user.id,
        status: "approved",
      }));
    if (
      req.user?.role === "faculty" &&
      String(item.facultyId) !== req.user.id
    ) {
      res.status(403).json({ error: "This is not your class offering." });
      return;
    }
    if (req.user?.role === "student" && !isStudent) {
      res
        .status(403)
        .json({ error: "This class is not on your approved subject list." });
      return;
    }
    if (
      !["super_admin", "student"].includes(req.user?.role ?? "") &&
      !sameInstitution(req, res, String(item.institutionId))
    )
      return;
    const enrollmentCode =
      req.user?.role === "faculty" && String(item.facultyId) === req.user.id
        ? item.enrollmentCode
        : undefined;
    res.json({ item: { ...item, enrollmentCode } });
  } catch (error) {
    next(error);
  }
});
router.put(
  "/class-offerings/:id",
  allowRoles("faculty"),
  async (req, res, next) => {
    try {
      if (!(await canManageOffering(req, req.params.id))) {
        res.status(404).json({ error: "Class offering not found." });
        return;
      }
      const input = offerSchema.partial().strict().parse(req.body);
      const offering = await ClassOffering.findById(req.params.id);
      if (!offering) {
        res.status(404).json({ error: "Class offering not found." });
        return;
      }
      if (
        input.capacity !== undefined &&
        input.capacity < (offering.approvedCount ?? 0)
      ) {
        res
          .status(409)
          .json({
            error: "Capacity cannot be lower than the approved roster.",
          });
        return;
      }
      const { codeExpiresAt, ...fields } = input;
      Object.assign(offering, fields);
      if (codeExpiresAt !== undefined)
        offering.codeExpiresAt = codeExpiresAt
          ? new Date(codeExpiresAt)
          : undefined;
      await offering.save();
      await recordAudit(
        req,
        "class_offering.update",
        "class_offering",
        offering.id,
      );
      res.json({ item: offering });
    } catch (error) {
      next(error);
    }
  },
);
router.patch(
  "/class-offerings/:id/archive",
  allowRoles("faculty"),
  async (req, res, next) => {
    try {
      if (!(await canManageOffering(req, req.params.id))) {
        res.status(404).json({ error: "Class offering not found." });
        return;
      }
      const offering = await ClassOffering.findByIdAndUpdate(
        req.params.id,
        { archivedAt: new Date(), enrollmentEnabled: false },
        { new: true },
      );
      if (!offering) {
        res.status(404).json({ error: "Class offering not found." });
        return;
      }
      await recordAudit(
        req,
        "class_offering.archive",
        "class_offering",
        offering.id,
      );
      res.json({ success: true, archivedAt: offering.archivedAt });
    } catch (error) {
      next(error);
    }
  },
);
router.post(
  "/class-offerings/:id/generate-code",
  allowRoles("faculty"),
  async (req, res, next) => {
    try {
      if (!(await canManageOffering(req, req.params.id))) {
        res.status(404).json({ error: "Class offering not found." });
        return;
      }
      const offering = await ClassOffering.findById(req.params.id);
      if (!offering) {
        res.status(404).json({ error: "Class offering not found." });
        return;
      }
      const { expiresAt } = z
        .object({ expiresAt: z.string().datetime().optional() })
        .parse(req.body ?? {});
      const code = randomBytes(4).toString("hex").toUpperCase();
      offering.enrollmentCode = code;
      offering.codeExpiresAt = expiresAt ? new Date(expiresAt) : undefined;
      offering.enrollmentEnabled = true;
      await offering.save();
      await recordAudit(
        req,
        "enrollment_code.regenerate",
        "class_offering",
        offering.id,
      );
      res.json({ enrollmentCode: code, expiresAt: offering.codeExpiresAt });
    } catch (error) {
      next(error);
    }
  },
);
router.patch(
  "/class-offerings/:id/enrollment-status",
  allowRoles("faculty"),
  async (req, res, next) => {
    try {
      if (!(await canManageOffering(req, req.params.id))) {
        res.status(404).json({ error: "Class offering not found." });
        return;
      }
      const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
      const item = await ClassOffering.findByIdAndUpdate(
        req.params.id,
        { enrollmentEnabled: enabled },
        { new: true },
      );
      await recordAudit(
        req,
        enabled ? "enrollment.enabled" : "enrollment.disabled",
        "class_offering",
        req.params.id,
      );
      res.json({ enrollmentEnabled: item?.enrollmentEnabled });
    } catch (error) {
      next(error);
    }
  },
);
router.get(
  "/class-offerings/:id/roster",
  allowRoles("faculty", "administrator", "super_admin"),
  async (req, res, next) => {
    try {
      if (!(await canManageOffering(req, req.params.id))) {
        res.status(404).json({ error: "Class offering not found." });
        return;
      }
      const approved = await Enrollment.find({
        offeringId: req.params.id,
        status: "approved",
      })
        .populate("studentId", "name email studentNumber sectionId")
        .sort({ createdAt: 1 })
        .lean();
      res.json({ items: approved });
    } catch (error) {
      next(error);
    }
  },
);

router.post(
  "/enrollments/request",
  allowRoles("student"),
  async (req, res, next) => {
    try {
      const { enrollmentCode } = z
        .object({ enrollmentCode: z.string().trim().min(4).max(32) })
        .parse(req.body);
      const offering = await ClassOffering.findOne({
        enrollmentCode: enrollmentCode.toUpperCase(),
        enrollmentEnabled: true,
        archivedAt: null,
      }).lean();
      if (
        !offering ||
        (offering.codeExpiresAt &&
          offering.codeExpiresAt.getTime() <= Date.now())
      ) {
        res
          .status(404)
          .json({
            error: "The enrollment code is invalid, disabled or expired.",
          });
        return;
      }
      if ((offering.approvedCount ?? 0) >= (offering.capacity ?? 0)) {
        res.status(409).json({ error: "This class has reached capacity." });
        return;
      }
      const semester = await Semester.findById(offering.semesterId)
        .select("enrollmentOpen enrollmentStartsAt enrollmentEndsAt")
        .lean();
      const enrollmentStartsAt = semester?.enrollmentStartsAt
        ? new Date(String(semester.enrollmentStartsAt)).getTime()
        : undefined;
      const enrollmentEndsAt = semester?.enrollmentEndsAt
        ? new Date(String(semester.enrollmentEndsAt)).getTime()
        : undefined;
      if (
        !semester ||
        semester.enrollmentOpen === false ||
        (enrollmentStartsAt && enrollmentStartsAt > Date.now()) ||
        (enrollmentEndsAt && enrollmentEndsAt < Date.now())
      ) {
        res
          .status(409)
          .json({ error: "Enrollment is not open for this semester." });
        return;
      }
      if (String(offering.institutionId) !== req.user?.institutionId) {
        res
          .status(403)
          .json({ error: "This offering belongs to another institution." });
        return;
      }
      const student = await User.findById(req.user?.id)
        .select("sectionId programId")
        .lean();
      if (
        offering.sectionId &&
        String(offering.sectionId) !== String(student?.sectionId ?? "")
      ) {
        res
          .status(403)
          .json({ error: "You are not eligible for this section." });
        return;
      }
      const existing = await Enrollment.findOne({
        offeringId: offering._id,
        studentId: req.user?.id,
      });
      if (
        existing &&
        ["pending", "approved", "dropped"].includes(existing.status ?? "")
      ) {
        res
          .status(409)
          .json({
            error:
              "You already have an active or completed enrollment for this class.",
          });
        return;
      }
      const enrollment = existing
        ? await Enrollment.findOneAndUpdate(
            { _id: existing._id, status: { $in: ["rejected", "cancelled"] } },
            {
              $set: {
                status: "pending",
                decidedBy: undefined,
                decidedAt: undefined,
                reason: undefined,
              },
            },
            { new: true, runValidators: true },
          )
        : await Enrollment.create({
            institutionId: offering.institutionId,
            offeringId: offering._id,
            studentId: req.user?.id,
            status: "pending",
          });
      if (!enrollment) {
        res
          .status(409)
          .json({
            error: "Enrollment request changed. Refresh and try again.",
          });
        return;
      }
      await notifyUser(
        String(offering.facultyId),
        "enrollment_request",
        "Enrollment request",
        `${req.user?.name} requested to join your class.`,
        { enrollmentId: enrollment.id, offeringId: String(offering._id) },
      );
      await recordAudit(req, "enrollment.request", "enrollment", enrollment.id);
      res.status(201).json({ item: enrollment });
    } catch (error) {
      next(error);
    }
  },
);
router.get(
  "/enrollments/student",
  allowRoles("student"),
  async (req, res, next) => {
    try {
      const items = await Enrollment.find({ studentId: req.user?.id })
        .populate({
          path: "offeringId",
          populate: [
            { path: "subjectId", select: "code name" },
            { path: "facultyId", select: "name" },
            { path: "sectionId", select: "name" },
          ],
        })
        .sort({ createdAt: -1 })
        .lean();
      res.json({ items });
    } catch (error) {
      next(error);
    }
  },
);
router.get(
  "/enrollments/pending",
  allowRoles("faculty"),
  async (req, res, next) => {
    try {
      const offeringIds = await ClassOffering.find({
        facultyId: req.user?.id,
        archivedAt: null,
      }).distinct("_id");
      const { page, limit, skip } = pageParams(req);
      const [items, total] = await Promise.all([
        Enrollment.find({ offeringId: { $in: offeringIds }, status: "pending" })
          .populate("studentId", "name email studentNumber")
          .populate({
            path: "offeringId",
            populate: { path: "subjectId", select: "code name" },
          })
          .sort({ createdAt: 1 })
          .skip(skip)
          .limit(limit)
          .lean(),
        Enrollment.countDocuments({
          offeringId: { $in: offeringIds },
          status: "pending",
        }),
      ]);
      res.json({ items, page, limit, total });
    } catch (error) {
      next(error);
    }
  },
);
router.patch("/enrollments/:id/:action", async (req, res, next) => {
  try {
    const action = req.params.action;
    if (!["approve", "reject", "cancel", "drop"].includes(action)) {
      res.status(404).json({ error: "Unknown enrollment action." });
      return;
    }
    const enrollment = await Enrollment.findById(req.params.id);
    if (!enrollment) {
      res.status(404).json({ error: "Enrollment request not found." });
      return;
    }
    const offering = await ClassOffering.findById(enrollment.offeringId);
    if (!offering) {
      res.status(404).json({ error: "Class offering not found." });
      return;
    }
    if (action === "cancel") {
      if (
        req.user?.role !== "student" ||
        String(enrollment.studentId) !== req.user.id ||
        enrollment.status !== "pending"
      ) {
        res
          .status(403)
          .json({
            error: "Only the requesting student can cancel a pending request.",
          });
        return;
      }
    } else {
      if (
        req.user?.role !== "faculty" ||
        String(offering.facultyId) !== req.user.id
      ) {
        res
          .status(403)
          .json({
            error: "Only the assigned faculty member can review this request.",
          });
        return;
      }
    }
    const { reason } = z
      .object({ reason: z.string().max(500).optional() })
      .parse(req.body ?? {});
    if (action === "drop" && !reason?.trim()) {
      res
        .status(400)
        .json({ error: "A reason is required to drop an enrolled student." });
      return;
    }
    const requiredStatus = action === "drop" ? "approved" : "pending";
    if (enrollment.status !== requiredStatus) {
      res
        .status(409)
        .json({
          error: "This enrollment cannot transition from its current status.",
        });
      return;
    }
    if (action === "approve") {
      const capacity = await ClassOffering.updateOne(
        { _id: offering._id, $expr: { $lt: ["$approvedCount", "$capacity"] } },
        { $inc: { approvedCount: 1 } },
      );
      if (capacity.modifiedCount !== 1) {
        res.status(409).json({ error: "This class has reached capacity." });
        return;
      }
      const decision = await Enrollment.updateOne(
        { _id: enrollment._id, status: "pending" },
        {
          $set: {
            status: "approved",
            decidedBy: req.user?.id,
            decidedAt: new Date(),
          },
        },
      );
      if (decision.modifiedCount !== 1) {
        await ClassOffering.updateOne(
          { _id: offering._id },
          { $inc: { approvedCount: -1 } },
        );
        res
          .status(409)
          .json({ error: "The request has already been reviewed." });
        return;
      }
      await notifyUser(
        String(enrollment.studentId),
        "enrollment_approved",
        "Enrollment approved",
        "Your enrollment request was approved.",
        { offeringId: offering.id },
      );
    } else {
      const status =
        action === "reject"
          ? "rejected"
          : action === "cancel"
            ? "cancelled"
            : "dropped";
      const decision = await Enrollment.updateOne(
        { _id: enrollment._id, status: requiredStatus },
        {
          $set: {
            status,
            decidedBy: req.user?.id,
            decidedAt: new Date(),
            reason,
          },
        },
      );
      if (decision.modifiedCount !== 1) {
        res.status(409).json({ error: "The request has already changed." });
        return;
      }
      if (action === "drop")
        await ClassOffering.updateOne(
          { _id: offering._id, approvedCount: { $gt: 0 } },
          { $inc: { approvedCount: -1 } },
        );
      if (action !== "cancel")
        await notifyUser(
          String(enrollment.studentId),
          `enrollment_${status}`,
          `Enrollment ${status}`,
          reason ?? `Your enrollment request was ${status}.`,
          { offeringId: offering.id },
        );
    }
    await recordAudit(
      req,
      `enrollment.${action}`,
      "enrollment",
      enrollment.id,
      { reason },
    );
    res.json({
      success: true,
      status:
        action === "approve"
          ? "approved"
          : action === "reject"
            ? "rejected"
            : action === "cancel"
              ? "cancelled"
              : "dropped",
    });
  } catch (error) {
    next(error);
  }
});

export default router;
