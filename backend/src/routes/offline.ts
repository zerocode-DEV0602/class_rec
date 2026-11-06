import { Router } from "express";
import { z } from "zod";
import {
  Assessment,
  Attendance,
  AttendanceSession,
  ClassOffering,
  Enrollment,
  StudentScore,
} from "../models/index";
import { allowRoles, requireAuth } from "../middleware/auth";
import { recordAudit } from "../services/audit";
const router = Router();
router.post(
  "/offline-sync",
  requireAuth,
  allowRoles("faculty"),
  async (req, res, next) => {
    try {
      const input = z
        .object({
          changes: z
            .array(
              z
                .object({
                  id: z.string().min(1).max(120),
                  kind: z.enum(["score", "attendance"]),
                  baseUpdatedAt: z.string().datetime().nullable().optional(),
                  payload: z.unknown(),
                })
                .strict(),
            )
            .min(1)
            .max(100),
        })
        .parse(req.body);
      const results: {
        id: string;
        status: "synced" | "conflict" | "rejected";
        message?: string;
      }[] = [];
      for (const change of input.changes) {
        try {
          if (change.kind === "score") {
            const data = z
              .object({
                assessmentId: z.string(),
                studentId: z.string(),
                score: z.number().min(0),
                remarks: z.string().max(1000).optional(),
                reason: z.string().max(500).optional(),
              })
              .parse(change.payload);
            const assessment = await Assessment.findById(
              data.assessmentId,
            ).lean();
            if (
              !assessment ||
              !(await ClassOffering.exists({
                _id: assessment.offeringId,
                facultyId: req.user?.id,
              })) ||
              data.score > (assessment.maxScore ?? 0) ||
              !(await Enrollment.exists({
                offeringId: assessment.offeringId,
                studentId: data.studentId,
                status: "approved",
              }))
            ) {
              results.push({
                id: change.id,
                status: "rejected",
                message: "Assessment, score or roster access is invalid.",
              });
              continue;
            }
            const existing = await StudentScore.findOne({
              assessmentId: data.assessmentId,
              studentId: data.studentId,
            });
            if (
              existing &&
              change.baseUpdatedAt &&
              existing.updatedAt &&
              existing.updatedAt.getTime() >
                new Date(change.baseUpdatedAt).getTime()
            ) {
              results.push({
                id: change.id,
                status: "conflict",
                message: "A newer server score already exists.",
              });
              continue;
            }
            if (existing && !data.reason?.trim()) {
              results.push({
                id: change.id,
                status: "rejected",
                message:
                  "A reason is required when changing an existing score.",
              });
              continue;
            }
            const item = await StudentScore.findOneAndUpdate(
              { assessmentId: data.assessmentId, studentId: data.studentId },
              {
                $set: {
                  institutionId: assessment.institutionId,
                  offeringId: assessment.offeringId,
                  score: data.score,
                  remarks: data.remarks,
                },
                $setOnInsert: {
                  assessmentId: assessment._id,
                  studentId: data.studentId,
                },
                ...(existing
                  ? {
                      $push: {
                        history: {
                          score: existing.score,
                          remarks: existing.remarks,
                          changedBy: req.user?.id,
                          changedAt: new Date(),
                          reason: data.reason,
                        },
                      },
                    }
                  : {}),
              },
              { upsert: true, new: true, runValidators: true },
            );
            await recordAudit(
              req,
              "student_score.offline_sync",
              "student_score",
              item.id,
              { assessmentId: data.assessmentId, studentId: data.studentId },
            );
            results.push({ id: change.id, status: "synced" });
          } else {
            const data = z
              .object({
                sessionId: z.string(),
                studentId: z.string(),
                status: z.enum(["present", "absent", "late", "excused"]),
                reason: z.string().max(500).optional(),
              })
              .parse(change.payload);
            const session = await AttendanceSession.findById(
              data.sessionId,
            ).lean();
            if (
              !session ||
              !(await ClassOffering.exists({
                _id: session.offeringId,
                facultyId: req.user?.id,
              })) ||
              !(await Enrollment.exists({
                offeringId: session.offeringId,
                studentId: data.studentId,
                status: "approved",
              }))
            ) {
              results.push({
                id: change.id,
                status: "rejected",
                message: "Attendance session or roster access is invalid.",
              });
              continue;
            }
            const existing = await Attendance.findOne({
              sessionId: data.sessionId,
              studentId: data.studentId,
            });
            if (
              existing &&
              change.baseUpdatedAt &&
              existing.updatedAt &&
              existing.updatedAt.getTime() >
                new Date(change.baseUpdatedAt).getTime()
            ) {
              results.push({
                id: change.id,
                status: "conflict",
                message: "A newer server attendance record already exists.",
              });
              continue;
            }
            if (
              existing &&
              existing.status !== data.status &&
              !data.reason?.trim()
            ) {
              results.push({
                id: change.id,
                status: "rejected",
                message: "A reason is required when changing attendance.",
              });
              continue;
            }
            const item = await Attendance.findOneAndUpdate(
              { sessionId: data.sessionId, studentId: data.studentId },
              {
                $set: {
                  status: data.status,
                  institutionId: session.institutionId,
                  offeringId: session.offeringId,
                },
                ...(existing
                  ? {
                      $push: {
                        history: {
                          status: existing.status,
                          changedBy: req.user?.id,
                          changedAt: new Date(),
                          reasonForEdit: data.reason,
                        },
                      },
                    }
                  : {}),
                $setOnInsert: {
                  sessionId: data.sessionId,
                  studentId: data.studentId,
                },
              },
              { upsert: true, new: true, runValidators: true },
            );
            await recordAudit(
              req,
              "attendance.offline_sync",
              "attendance",
              item.id,
              { sessionId: data.sessionId, studentId: data.studentId },
            );
            results.push({ id: change.id, status: "synced" });
          }
        } catch (error) {
          results.push({
            id: change.id,
            status: "rejected",
            message: error instanceof Error ? error.message : "Invalid change.",
          });
        }
      }
      res.json({ results });
    } catch (error) {
      next(error);
    }
  },
);
export default router;
