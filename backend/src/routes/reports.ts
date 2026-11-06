import { Router } from "express";
import ExcelJS from "exceljs";
import PDFDocument from "pdfkit";
import {
  Assessment,
  Attendance,
  ClassOffering,
  Enrollment,
  GradeSummary,
  Submission,
  User,
} from "../models/index";
import { allowRoles, requireAuth } from "../middleware/auth";
const router = Router();
router.use(requireAuth);

router.get(
  "/reports/enrollment",
  allowRoles("faculty", "administrator", "super_admin"),
  async (req, res, next) => {
    try {
      const offeringId =
        typeof req.query.offeringId === "string" ? req.query.offeringId : "";
      if (!offeringId || !(await owned(req, offeringId)))
        return res.status(404).json({ error: "Class offering not found." });
      const rows = await Enrollment.find({ offeringId })
        .populate("studentId", "name studentNumber email")
        .sort({ createdAt: -1 })
        .lean();
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Enrollment");
      sheet.columns = [
        { header: "Student number", key: "studentNumber", width: 22 },
        { header: "Student", key: "name", width: 32 },
        { header: "Email", key: "email", width: 32 },
        { header: "Status", key: "status", width: 18 },
        { header: "Requested", key: "createdAt", width: 24 },
        { header: "Decision reason", key: "reason", width: 40 },
      ];
      for (const row of rows) {
        const person =
          typeof row.studentId === "object" &&
          row.studentId &&
          "name" in row.studentId
            ? (row.studentId as {
                name?: string;
                studentNumber?: string;
                email?: string;
              })
            : {};
        sheet.addRow({
          studentNumber: person.studentNumber ?? "",
          name: person.name ?? "",
          email: person.email ?? "",
          status: row.status,
          createdAt: row.createdAt,
          reason: row.reason ?? "",
        });
      }
      xlsxResponse(res, workbook, "classtrack-enrollment");
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/reports/missing-activities",
  allowRoles("faculty", "administrator", "super_admin"),
  async (req, res, next) => {
    try {
      const offeringId =
        typeof req.query.offeringId === "string" ? req.query.offeringId : "";
      if (!offeringId || !(await owned(req, offeringId)))
        return res.status(404).json({ error: "Class offering not found." });
      const [activities, roster] = await Promise.all([
        Assessment.find({ offeringId, published: true, archivedAt: null })
          .sort({ dueAt: 1 })
          .lean(),
        Enrollment.find({ offeringId, status: "approved" })
          .populate("studentId", "name studentNumber")
          .lean(),
      ]);
      const submissions = await Submission.find({
        assessmentId: { $in: activities.map((activity) => activity._id) },
      }).lean();
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Missing Activities");
      sheet.columns = [
        { header: "Student number", key: "studentNumber", width: 22 },
        { header: "Student", key: "name", width: 32 },
        { header: "Activity", key: "activity", width: 32 },
        { header: "Type", key: "kind", width: 20 },
        { header: "Deadline", key: "dueAt", width: 24 },
        { header: "Status", key: "status", width: 18 },
      ];
      for (const enrollment of roster) {
        const person =
          typeof enrollment.studentId === "object" &&
          enrollment.studentId &&
          "name" in enrollment.studentId
            ? (enrollment.studentId as {
                _id: unknown;
                name?: string;
                studentNumber?: string;
              })
            : undefined;
        if (!person) continue;
        for (const activity of activities) {
          const submission = submissions.find(
            (item) =>
              String(item.assessmentId) === String(activity._id) &&
              String(item.studentId) === String(person._id),
          );
          if (!submission)
            sheet.addRow({
              studentNumber: person.studentNumber ?? "",
              name: person.name ?? "",
              activity: activity.title,
              kind: activity.kind,
              dueAt: activity.dueAt ?? "",
              status:
                activity.dueAt && activity.dueAt < new Date()
                  ? "Missing / overdue"
                  : "Not submitted",
            });
        }
      }
      xlsxResponse(res, workbook, "classtrack-missing-activities");
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/reports/grade-submission",
  allowRoles("faculty", "administrator", "super_admin"),
  async (req, res, next) => {
    try {
      const offeringId =
        typeof req.query.offeringId === "string" ? req.query.offeringId : "";
      if (!offeringId || !(await owned(req, offeringId)))
        return res.status(404).json({ error: "Class offering not found." });
      const [roster, grades] = await Promise.all([
        Enrollment.find({ offeringId, status: "approved" })
          .populate("studentId", "name studentNumber")
          .lean(),
        GradeSummary.find({ offeringId }).lean(),
      ]);
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Grade Submission");
      sheet.columns = [
        { header: "Student number", key: "studentNumber", width: 22 },
        { header: "Student", key: "name", width: 32 },
        { header: "Period", key: "period", width: 20 },
        { header: "Final grade", key: "grade", width: 16 },
        { header: "Submission state", key: "status", width: 20 },
      ];
      for (const row of roster) {
        const person =
          typeof row.studentId === "object" &&
          row.studentId &&
          "name" in row.studentId
            ? (row.studentId as {
                _id: unknown;
                name?: string;
                studentNumber?: string;
              })
            : undefined;
        if (!person) continue;
        const summaries = grades.filter(
          (grade) => String(grade.studentId) === String(person._id),
        );
        if (!summaries.length)
          sheet.addRow({
            studentNumber: person.studentNumber ?? "",
            name: person.name ?? "",
            period: "final",
            grade: "",
            status: "Not calculated",
          });
        else
          summaries.forEach((grade) =>
            sheet.addRow({
              studentNumber: person.studentNumber ?? "",
              name: person.name ?? "",
              period: grade.period ?? "final",
              grade: grade.finalGrade ?? "",
              status: grade.status,
            }),
          );
      }
      xlsxResponse(res, workbook, "classtrack-grade-submission");
    } catch (error) {
      next(error);
    }
  },
);

router.get(
  "/reports/faculty-workload",
  allowRoles("administrator", "super_admin"),
  async (req, res, next) => {
    try {
      const institutionId =
        req.user?.role === "super_admin" &&
        typeof req.query.institutionId === "string"
          ? req.query.institutionId
          : req.user?.institutionId;
      if (req.user?.role === "administrator" && !institutionId)
        return res
          .status(403)
          .json({ error: "Institution scope is required." });
      const filter = institutionId
        ? { institutionId, archivedAt: null }
        : { archivedAt: null };
      const [offerings, faculty] = await Promise.all([
        ClassOffering.find(filter)
          .populate("subjectId", "code name")
          .populate("facultyId", "name email")
          .lean(),
        User.find({
          ...(institutionId ? { institutionId } : {}),
          role: "faculty",
          active: true,
        })
          .select("name email")
          .lean(),
      ]);
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Faculty Workload");
      sheet.columns = [
        { header: "Faculty", key: "name", width: 32 },
        { header: "Email", key: "email", width: 34 },
        { header: "Active offerings", key: "offerings", width: 20 },
        { header: "Approved students", key: "students", width: 22 },
        { header: "Subjects", key: "subjects", width: 48 },
      ];
      for (const person of faculty) {
        const assigned = offerings.filter(
          (item) =>
            String(
              item.facultyId &&
                typeof item.facultyId === "object" &&
                "_id" in item.facultyId
                ? item.facultyId._id
                : item.facultyId,
            ) === String(person._id),
        );
        let students = 0;
        for (const offering of assigned)
          students += await Enrollment.countDocuments({
            offeringId: offering._id,
            status: "approved",
          });
        sheet.addRow({
          name: person.name,
          email: person.email,
          offerings: assigned.length,
          students,
          subjects: assigned
            .map((item) => {
              const subject = item.subjectId as
                | { code?: string; name?: string }
                | undefined;
              return `${subject?.code ?? ""} ${subject?.name ?? ""}`.trim();
            })
            .join(", "),
        });
      }
      xlsxResponse(res, workbook, "classtrack-faculty-workload");
    } catch (error) {
      next(error);
    }
  },
);
async function owned(
  req: import("express").Request,
  offeringId: string,
): Promise<boolean> {
  const offering = await ClassOffering.findById(offeringId)
    .select("institutionId facultyId")
    .lean();
  if (!offering) return false;
  return (
    req.user?.role === "super_admin" ||
    (req.user?.role === "faculty" &&
      String(offering.facultyId) === req.user.id) ||
    (req.user?.role === "administrator" &&
      String(offering.institutionId) === req.user.institutionId)
  );
}
function xlsxResponse(
  res: import("express").Response,
  workbook: ExcelJS.Workbook,
  filename: string,
): void {
  void workbook.xlsx
    .writeBuffer()
    .then((buffer) => {
      res.setHeader(
        "Content-Type",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      );
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="${filename}.xlsx"`,
      );
      res.send(Buffer.from(buffer));
    })
    .catch(() => {
      if (!res.headersSent)
        res.status(500).json({ error: "Report could not be generated." });
    });
}
router.get(
  "/reports/class-record",
  allowRoles("faculty", "administrator", "super_admin"),
  async (req, res, next) => {
    try {
      const offeringId =
        typeof req.query.offeringId === "string" ? req.query.offeringId : "";
      if (!offeringId || !(await owned(req, offeringId))) {
        res.status(404).json({ error: "Class offering not found." });
        return;
      }
      const roster = await Enrollment.find({ offeringId, status: "approved" })
        .populate("studentId", "name studentNumber")
        .lean();
      const grades = await GradeSummary.find({
        offeringId,
        status: { $in: ["published", "finalized"] },
      }).lean();
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Class Record");
      sheet.columns = [
        { header: "Student number", key: "studentNumber", width: 22 },
        { header: "Student", key: "name", width: 32 },
        { header: "Final grade", key: "grade", width: 18 },
        { header: "Status", key: "status", width: 18 },
      ];
      for (const record of roster) {
        const student =
          typeof record.studentId === "object" &&
          record.studentId &&
          "_id" in record.studentId
            ? (record.studentId as {
                _id: unknown;
                name?: string;
                studentNumber?: string;
              })
            : undefined;
        const grade = grades.find(
          (item) => String(item.studentId) === String(student?._id),
        );
        sheet.addRow({
          studentNumber: student?.studentNumber ?? "",
          name: student?.name ?? "",
          grade: grade?.finalGrade ?? "",
          status: grade?.status ?? "Not published",
        });
      }
      sheet.getRow(1).font = { bold: true, color: { argb: "FFFFFFFF" } };
      sheet.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF142B4A" },
      };
      xlsxResponse(res, workbook, "classtrack-class-record");
    } catch (error) {
      next(error);
    }
  },
);
router.get(
  "/reports/attendance",
  allowRoles("faculty", "administrator", "super_admin"),
  async (req, res, next) => {
    try {
      const offeringId =
        typeof req.query.offeringId === "string" ? req.query.offeringId : "";
      if (!offeringId || !(await owned(req, offeringId))) {
        res.status(404).json({ error: "Class offering not found." });
        return;
      }
      const records = await Attendance.find({ offeringId })
        .populate("studentId", "name studentNumber")
        .populate("sessionId", "date")
        .sort({ createdAt: 1 })
        .lean();
      const doc = new PDFDocument({ margin: 44, size: "A4" });
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader(
        "Content-Disposition",
        "attachment; filename=classtrack-attendance.pdf",
      );
      doc.pipe(res);
      doc
        .fontSize(18)
        .fillColor("#142B4A")
        .text("ClassTrack · Attendance Report");
      doc.moveDown().fontSize(10).fillColor("#334155");
      for (const row of records) {
        const student =
          typeof row.studentId === "object" &&
          row.studentId &&
          "name" in row.studentId
            ? (row.studentId as { name?: string; studentNumber?: string })
            : undefined;
        const session =
          typeof row.sessionId === "object" &&
          row.sessionId &&
          "date" in row.sessionId
            ? (row.sessionId as { date?: Date })
            : undefined;
        doc.text(
          `${student?.studentNumber ?? ""}  ${student?.name ?? "Student"}  ·  ${row.status ?? "—"}  ·  ${session?.date ? new Date(session.date).toLocaleDateString() : "Meeting"}`,
        );
      }
      doc.end();
    } catch (error) {
      next(error);
    }
  },
);
router.get(
  "/reports/student-performance",
  allowRoles("faculty", "administrator", "super_admin"),
  async (req, res, next) => {
    try {
      const offeringId =
        typeof req.query.offeringId === "string" ? req.query.offeringId : "";
      if (!offeringId || !(await owned(req, offeringId))) {
        res.status(404).json({ error: "Class offering not found." });
        return;
      }
      const roster = await Enrollment.find({ offeringId, status: "approved" })
        .populate("studentId", "name studentNumber")
        .lean();
      const grades = await GradeSummary.find({
        offeringId,
        status: { $in: ["published", "finalized"] },
      }).lean();
      const performance = roster.map((record) => {
        const student =
          typeof record.studentId === "object" &&
          record.studentId &&
          "_id" in record.studentId
            ? (record.studentId as {
                _id: unknown;
                name?: string;
                studentNumber?: string;
              })
            : undefined;
        const grade = grades.find(
          (item) => String(item.studentId) === String(student?._id),
        );
        return {
          studentNumber: student?.studentNumber ?? "",
          name: student?.name ?? "",
          finalGrade: grade?.finalGrade ?? null,
          status: grade?.status ?? "not_published",
          needsAttention: (grade?.finalGrade ?? 100) < 60,
        };
      });
      if (req.query.format === "json") {
        res.json({ items: performance, count: performance.length });
        return;
      }
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Performance");
      sheet.columns = [
        { header: "Student number", key: "studentNumber", width: 22 },
        { header: "Student", key: "name", width: 32 },
        { header: "Published grade", key: "finalGrade", width: 20 },
        { header: "Status", key: "status", width: 20 },
        { header: "Needs attention", key: "needsAttention", width: 20 },
      ];
      performance.forEach((item) => sheet.addRow(item));
      xlsxResponse(res, workbook, "classtrack-student-performance");
    } catch (error) {
      next(error);
    }
  },
);
router.get(
  "/reports/final-grades",
  allowRoles("faculty", "administrator", "super_admin"),
  async (req, res, next) => {
    try {
      const offeringId =
        typeof req.query.offeringId === "string" ? req.query.offeringId : "";
      if (!offeringId || !(await owned(req, offeringId))) {
        res.status(404).json({ error: "Class offering not found." });
        return;
      }
      const items = await GradeSummary.find({
        offeringId,
        status: { $in: ["published", "finalized"] },
      })
        .populate("studentId", "name studentNumber")
        .sort({ finalGrade: -1 })
        .lean();
      if (req.query.format === "json") {
        res.json({ items, count: items.length });
        return;
      }
      const workbook = new ExcelJS.Workbook();
      const sheet = workbook.addWorksheet("Final Grades");
      sheet.columns = [
        { header: "Student number", key: "studentNumber", width: 22 },
        { header: "Student", key: "name", width: 32 },
        { header: "Final grade", key: "grade", width: 18 },
        { header: "State", key: "status", width: 18 },
      ];
      for (const item of items) {
        const student =
          typeof item.studentId === "object" &&
          item.studentId &&
          "name" in item.studentId
            ? (item.studentId as { name?: string; studentNumber?: string })
            : undefined;
        sheet.addRow({
          studentNumber: student?.studentNumber ?? "",
          name: student?.name ?? "",
          grade: item.finalGrade ?? "",
          status: item.status,
        });
      }
      xlsxResponse(res, workbook, "classtrack-final-grades");
    } catch (error) {
      next(error);
    }
  },
);
export default router;
