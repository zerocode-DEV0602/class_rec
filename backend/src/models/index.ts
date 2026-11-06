import mongoose, { Schema, Types } from "mongoose";

export type Role = "super_admin" | "administrator" | "faculty" | "student";
export type EnrollmentStatus =
  | "pending"
  | "approved"
  | "rejected"
  | "cancelled"
  | "dropped";
export type AttendanceStatus = "present" | "absent" | "late" | "excused";
export type DatabaseRecord = Record<string, unknown> & {
  _id?: Types.ObjectId;
  institutionId?: Types.ObjectId;
  facultyId?: Types.ObjectId;
  subjectId?: Types.ObjectId;
  sectionId?: Types.ObjectId;
  academicYearId?: Types.ObjectId;
  semesterId?: Types.ObjectId;
  offeringId?: Types.ObjectId;
  studentId?: Types.ObjectId;
  assessmentId?: Types.ObjectId;
  categoryId?: Types.ObjectId;
  capacity?: number;
  approvedCount?: number;
  enrollmentCode?: string;
  codeExpiresAt?: Date;
  enrollmentEnabled?: boolean;
  status?: string;
  active?: boolean;
  name?: string;
  email?: string;
  role?: Role;
  score?: number;
  maxScore?: number;
  weight?: number;
  finalGrade?: number;
  dueAt?: Date;
  published?: boolean;
  readAt?: Date;
  createdAt?: Date;
  updatedAt?: Date;
};
export type UserRecord = {
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  institutionId?: Types.ObjectId;
  departmentId?: Types.ObjectId;
  programId?: Types.ObjectId;
  sectionId?: Types.ObjectId;
  studentNumber?: string;
  active: boolean;
  pushTokens?: string[];
  refreshTokenHash?: string;
  resetTokenHash?: string;
  resetExpiresAt?: Date;
  lastSignedInAt?: Date;
};

const objectId = Schema.Types.ObjectId;
const timestamps = { timestamps: true, versionKey: false } as const;
const model = <T>(name: string, collection: string, schema: Schema<T>) =>
  (mongoose.models[name] as mongoose.Model<T> | undefined) ??
  mongoose.model<T>(name, schema, collection);

const userSchema = new Schema<UserRecord>(
  {
    name: { type: String, required: true, trim: true, maxlength: 120 },
    email: { type: String, required: true, lowercase: true, trim: true },
    passwordHash: { type: String, required: true, select: false },
    role: {
      type: String,
      enum: ["super_admin", "administrator", "faculty", "student"],
      required: true,
    },
    institutionId: { type: objectId, ref: "Institution", index: true },
    departmentId: { type: objectId, ref: "Department" },
    programId: { type: objectId, ref: "Program" },
    sectionId: { type: objectId, ref: "Section" },
    studentNumber: { type: String, trim: true },
    active: { type: Boolean, default: true, index: true },
    pushTokens: { type: [String], default: [] },
    refreshTokenHash: { type: String, select: false },
    resetTokenHash: { type: String, select: false },
    resetExpiresAt: { type: Date, select: false },
    lastSignedInAt: Date,
  },
  timestamps,
);
userSchema.index({ email: 1 }, { unique: true });
userSchema.index({ institutionId: 1, role: 1, active: 1 });
userSchema.index(
  { institutionId: 1, studentNumber: 1 },
  { unique: true, sparse: true },
);

const institutionSchema = new Schema<DatabaseRecord>(
  {
    name: { type: String, required: true, trim: true },
    code: { type: String, required: true, uppercase: true, trim: true },
    address: String,
    active: { type: Boolean, default: true },
    settings: Schema.Types.Mixed,
  },
  timestamps,
);
institutionSchema.index({ code: 1 }, { unique: true });
const departmentSchema = new Schema<DatabaseRecord>(
  {
    institutionId: {
      type: objectId,
      ref: "Institution",
      required: true,
      index: true,
    },
    name: { type: String, required: true },
    code: String,
    headId: { type: objectId, ref: "User" },
    archivedAt: Date,
  },
  timestamps,
);
departmentSchema.index({ institutionId: 1, name: 1 }, { unique: true });
const programSchema = new Schema<DatabaseRecord>(
  {
    institutionId: {
      type: objectId,
      ref: "Institution",
      required: true,
      index: true,
    },
    departmentId: { type: objectId, ref: "Department", required: true },
    name: { type: String, required: true },
    code: { type: String, required: true },
    archivedAt: Date,
  },
  timestamps,
);
programSchema.index({ institutionId: 1, code: 1 }, { unique: true });
const sectionSchema = new Schema<DatabaseRecord>(
  {
    institutionId: {
      type: objectId,
      ref: "Institution",
      required: true,
      index: true,
    },
    programId: { type: objectId, ref: "Program", required: true },
    name: { type: String, required: true },
    academicYearId: { type: objectId, ref: "AcademicYear" },
    capacity: { type: Number, min: 1 },
    archivedAt: Date,
  },
  timestamps,
);
sectionSchema.index(
  { institutionId: 1, programId: 1, name: 1 },
  { unique: true },
);
const academicYearSchema = new Schema<DatabaseRecord>(
  {
    institutionId: {
      type: objectId,
      ref: "Institution",
      required: true,
      index: true,
    },
    label: { type: String, required: true },
    startsAt: Date,
    endsAt: Date,
    current: { type: Boolean, default: false },
  },
  timestamps,
);
academicYearSchema.index({ institutionId: 1, label: 1 }, { unique: true });
const semesterSchema = new Schema<DatabaseRecord>(
  {
    institutionId: {
      type: objectId,
      ref: "Institution",
      required: true,
      index: true,
    },
    academicYearId: { type: objectId, ref: "AcademicYear", required: true },
    name: { type: String, required: true },
    startsAt: Date,
    endsAt: Date,
    enrollmentOpen: { type: Boolean, default: true },
    enrollmentStartsAt: Date,
    enrollmentEndsAt: Date,
  },
  timestamps,
);
const subjectSchema = new Schema<DatabaseRecord>(
  {
    institutionId: {
      type: objectId,
      ref: "Institution",
      required: true,
      index: true,
    },
    code: { type: String, required: true, uppercase: true },
    name: { type: String, required: true },
    description: String,
    units: { type: Number, min: 0, default: 3 },
    prerequisiteIds: [{ type: objectId, ref: "Subject" }],
    archivedAt: Date,
  },
  timestamps,
);
subjectSchema.index({ institutionId: 1, code: 1 }, { unique: true });
const offeringSchema = new Schema<DatabaseRecord>(
  {
    institutionId: {
      type: objectId,
      ref: "Institution",
      required: true,
      index: true,
    },
    subjectId: { type: objectId, ref: "Subject", required: true },
    facultyId: { type: objectId, ref: "User", required: true, index: true },
    sectionId: { type: objectId, ref: "Section" },
    academicYearId: { type: objectId, ref: "AcademicYear", required: true },
    semesterId: { type: objectId, ref: "Semester", required: true },
    schedule: [{ day: String, startsAt: String, endsAt: String }],
    location: String,
    capacity: { type: Number, min: 1, required: true },
    approvedCount: { type: Number, min: 0, default: 0 },
    enrollmentCode: { type: String, unique: true, sparse: true, index: true },
    enrollmentEnabled: { type: Boolean, default: true },
    codeExpiresAt: Date,
    archivedAt: Date,
  },
  timestamps,
);
offeringSchema.index({
  institutionId: 1,
  facultyId: 1,
  academicYearId: 1,
  semesterId: 1,
});
const enrollmentSchema = new Schema<DatabaseRecord>(
  {
    institutionId: {
      type: objectId,
      ref: "Institution",
      required: true,
      index: true,
    },
    offeringId: { type: objectId, ref: "ClassOffering", required: true },
    studentId: { type: objectId, ref: "User", required: true },
    status: {
      type: String,
      enum: ["pending", "approved", "rejected", "cancelled", "dropped"],
      default: "pending",
      index: true,
    },
    decidedBy: { type: objectId, ref: "User" },
    decidedAt: Date,
    reason: String,
  },
  timestamps,
);
enrollmentSchema.index({ offeringId: 1, studentId: 1 }, { unique: true });
const categorySchema = new Schema<DatabaseRecord>(
  {
    institutionId: {
      type: objectId,
      ref: "Institution",
      required: true,
      index: true,
    },
    offeringId: { type: objectId, ref: "ClassOffering", required: true },
    name: { type: String, required: true },
    weight: { type: Number, min: 0, max: 100, required: true },
    calculationMethod: {
      type: String,
      enum: ["points", "equal_average"],
      default: "points",
    },
    sortOrder: Number,
  },
  timestamps,
);
categorySchema.index({ offeringId: 1, name: 1 }, { unique: true });
const assessmentSchema = new Schema<DatabaseRecord>(
  {
    institutionId: {
      type: objectId,
      ref: "Institution",
      required: true,
      index: true,
    },
    offeringId: { type: objectId, ref: "ClassOffering", required: true },
    categoryId: { type: objectId, ref: "GradingCategory", required: true },
    title: { type: String, required: true },
    kind: {
      type: String,
      enum: ["assignment", "quiz", "exam", "performance_task"],
      default: "assignment",
    },
    description: String,
    referenceFile: {
      key: String,
      name: String,
      mimeType: String,
      size: Number,
    },
    maxScore: { type: Number, required: true, min: 0.01 },
    dueAt: Date,
    allowSubmission: { type: Boolean, default: false },
    published: { type: Boolean, default: false },
    archivedAt: Date,
  },
  timestamps,
);
const scoreSchema = new Schema<DatabaseRecord>(
  {
    institutionId: {
      type: objectId,
      ref: "Institution",
      required: true,
      index: true,
    },
    offeringId: { type: objectId, ref: "ClassOffering", required: true },
    assessmentId: { type: objectId, ref: "Assessment", required: true },
    studentId: { type: objectId, ref: "User", required: true },
    score: { type: Number, min: 0 },
    remarks: String,
    history: [
      {
        score: Number,
        remarks: String,
        changedBy: { type: objectId, ref: "User" },
        changedAt: Date,
        reason: String,
      },
    ],
  },
  timestamps,
);
scoreSchema.index({ assessmentId: 1, studentId: 1 }, { unique: true });
const gradeSummarySchema = new Schema<DatabaseRecord>(
  {
    institutionId: {
      type: objectId,
      ref: "Institution",
      required: true,
      index: true,
    },
    offeringId: { type: objectId, ref: "ClassOffering", required: true },
    studentId: { type: objectId, ref: "User", required: true },
    period: { type: String, default: "final" },
    categoryResults: [
      {
        categoryId: { type: objectId, ref: "GradingCategory" },
        average: Number,
        weight: Number,
      },
    ],
    finalGrade: Number,
    status: {
      type: String,
      enum: ["draft", "calculated", "published", "finalized"],
      default: "draft",
    },
    publishedAt: Date,
    remarks: String,
  },
  timestamps,
);
gradeSummarySchema.index(
  { offeringId: 1, studentId: 1, period: 1 },
  { unique: true },
);
const attendanceSessionSchema = new Schema<DatabaseRecord>(
  {
    institutionId: {
      type: objectId,
      ref: "Institution",
      required: true,
      index: true,
    },
    offeringId: { type: objectId, ref: "ClassOffering", required: true },
    date: { type: Date, required: true },
    topic: String,
    createdBy: { type: objectId, ref: "User", required: true },
  },
  timestamps,
);
const attendanceSchema = new Schema<DatabaseRecord>(
  {
    institutionId: {
      type: objectId,
      ref: "Institution",
      required: true,
      index: true,
    },
    offeringId: { type: objectId, ref: "ClassOffering", required: true },
    sessionId: { type: objectId, ref: "AttendanceSession", required: true },
    studentId: { type: objectId, ref: "User", required: true },
    status: {
      type: String,
      enum: ["present", "absent", "late", "excused"],
      required: true,
    },
    history: [
      {
        status: String,
        reason: String,
        changedBy: { type: objectId, ref: "User" },
        changedAt: Date,
        reasonForEdit: String,
      },
    ],
  },
  timestamps,
);
attendanceSchema.index({ sessionId: 1, studentId: 1 }, { unique: true });
const submissionSchema = new Schema<DatabaseRecord>(
  {
    institutionId: {
      type: objectId,
      ref: "Institution",
      required: true,
      index: true,
    },
    assessmentId: { type: objectId, ref: "Assessment", required: true },
    studentId: { type: objectId, ref: "User", required: true },
    file: { key: String, name: String, mimeType: String, size: Number },
    submittedAt: Date,
    status: {
      type: String,
      enum: ["submitted", "late", "missing", "reviewed"],
      default: "submitted",
    },
    score: Number,
    feedback: String,
  },
  timestamps,
);
submissionSchema.index({ assessmentId: 1, studentId: 1 }, { unique: true });
const announcementSchema = new Schema<DatabaseRecord>(
  {
    institutionId: { type: objectId, ref: "Institution", index: true },
    offeringId: { type: objectId, ref: "ClassOffering" },
    authorId: { type: objectId, ref: "User", required: true },
    audience: [
      { type: String, enum: ["faculty", "student", "administrator", "all"] },
    ],
    title: { type: String, required: true },
    body: { type: String, required: true },
    publishedAt: Date,
  },
  timestamps,
);
const messageSchema = new Schema<DatabaseRecord>(
  {
    institutionId: {
      type: objectId,
      ref: "Institution",
      required: true,
      index: true,
    },
    senderId: { type: objectId, ref: "User", required: true },
    recipientId: { type: objectId, ref: "User", required: true },
    offeringId: { type: objectId, ref: "ClassOffering" },
    body: { type: String, required: true, maxlength: 5000 },
    readAt: Date,
  },
  timestamps,
);
const notificationSchema = new Schema<DatabaseRecord>(
  {
    institutionId: { type: objectId, ref: "Institution", index: true },
    userId: { type: objectId, ref: "User", required: true, index: true },
    kind: { type: String, required: true },
    title: { type: String, required: true },
    body: { type: String, required: true },
    data: Schema.Types.Mixed,
    readAt: Date,
  },
  timestamps,
);
notificationSchema.index({ userId: 1, createdAt: -1 });
const reviewSchema = new Schema<DatabaseRecord>(
  {
    institutionId: {
      type: objectId,
      ref: "Institution",
      required: true,
      index: true,
    },
    studentId: { type: objectId, ref: "User", required: true },
    facultyId: { type: objectId, ref: "User", required: true },
    offeringId: { type: objectId, ref: "ClassOffering", required: true },
    recordType: { type: String, enum: ["grade", "attendance"], required: true },
    recordId: { type: objectId, required: true },
    reason: { type: String, required: true },
    response: String,
    status: {
      type: String,
      enum: ["pending", "under_review", "resolved", "rejected"],
      default: "pending",
    },
  },
  timestamps,
);
const interventionSchema = new Schema<DatabaseRecord>(
  {
    institutionId: {
      type: objectId,
      ref: "Institution",
      required: true,
      index: true,
    },
    offeringId: { type: objectId, ref: "ClassOffering", required: true },
    studentId: { type: objectId, ref: "User", required: true },
    facultyId: { type: objectId, ref: "User", required: true },
    note: { type: String, required: true },
    recommendation: String,
    followUpAt: Date,
    needsAssistance: { type: Boolean, default: true },
  },
  timestamps,
);
const auditSchema = new Schema<DatabaseRecord>(
  {
    institutionId: { type: objectId, ref: "Institution", index: true },
    actorId: { type: objectId, ref: "User", required: true },
    action: { type: String, required: true, index: true },
    resourceType: String,
    resourceId: objectId,
    details: Schema.Types.Mixed,
    ip: String,
  },
  { ...timestamps, collection: "audit_logs" },
);
auditSchema.index({ createdAt: -1 });
const settingsSchema = new Schema<DatabaseRecord>(
  {
    institutionId: { type: objectId, ref: "Institution", index: true },
    key: { type: String, required: true },
    value: Schema.Types.Mixed,
  },
  timestamps,
);
settingsSchema.index({ institutionId: 1, key: 1 }, { unique: true });

export const User = model("User", "users", userSchema);
export const Institution = model(
  "Institution",
  "institutions",
  institutionSchema,
);
export const Department = model("Department", "departments", departmentSchema);
export const Program = model("Program", "programs", programSchema);
export const Section = model("Section", "sections", sectionSchema);
export const AcademicYear = model(
  "AcademicYear",
  "academic_years",
  academicYearSchema,
);
export const Semester = model("Semester", "semesters", semesterSchema);
export const Subject = model("Subject", "subjects", subjectSchema);
export const ClassOffering = model(
  "ClassOffering",
  "class_offerings",
  offeringSchema,
);
export const Enrollment = model("Enrollment", "enrollments", enrollmentSchema);
export const GradingCategory = model(
  "GradingCategory",
  "grading_categories",
  categorySchema,
);
export const Assessment = model("Assessment", "assessments", assessmentSchema);
export const StudentScore = model(
  "StudentScore",
  "student_scores",
  scoreSchema,
);
export const GradeSummary = model(
  "GradeSummary",
  "grade_summaries",
  gradeSummarySchema,
);
export const AttendanceSession = model(
  "AttendanceSession",
  "attendance_sessions",
  attendanceSessionSchema,
);
export const Attendance = model("Attendance", "attendance", attendanceSchema);
export const Submission = model("Submission", "submissions", submissionSchema);
export const Announcement = model(
  "Announcement",
  "announcements",
  announcementSchema,
);
export const Message = model("Message", "messages", messageSchema);
export const Notification = model(
  "Notification",
  "notifications",
  notificationSchema,
);
export const ReviewRequest = model(
  "ReviewRequest",
  "review_requests",
  reviewSchema,
);
export const Intervention = model(
  "Intervention",
  "interventions",
  interventionSchema,
);
export const AuditLog = model("AuditLog", "audit_logs", auditSchema);
export const SystemSetting = model(
  "SystemSetting",
  "system_settings",
  settingsSchema,
);

export const toObjectId = (id: string) => new Types.ObjectId(id);
