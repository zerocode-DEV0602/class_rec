# ClassTrack API guide

Base path: `/api`. Authenticated routes require `Authorization: Bearer <access-token>` unless noted. JSON endpoints return structured JSON; report endpoints return PDF or XLSX files. Query endpoints support pagination where implemented (`page`, `limit`). Server-side checks enforce role, institution and class ownership; frontend role hiding is not an authorization boundary.

## Health and authentication

- `GET /health` — unauthenticated readiness response; includes MongoDB connection state.
- `POST /auth/login` — validate credentials, issue short-lived access and rotating refresh tokens.
- `POST /auth/refresh` — rotate a valid refresh token.
- `POST /auth/logout` — revoke the active refresh token.
- `GET /auth/me` — current authenticated user.
- `PATCH /auth/profile` — update the authenticated user's display name and audit the change.
- `PATCH /auth/change-password` — verify the current password, update the hash and revoke the existing refresh session.
- `POST /auth/forgot-password` — enumeration-safe reset request; development response can include a reset token, production sends to the optional `PASSWORD_RESET_WEBHOOK_URL` integration.
- `POST /auth/reset-password` — apply an unexpired one-time reset token.

## Users, institutions and academic configuration

- `GET/POST /institutions`, `GET/PUT /institutions/:id`, `PATCH /institutions/:id/status` — Super Admin institution operations; each mutation is audited.
- `GET/POST /users`, `GET/PUT /users/:id`, `PATCH /users/:id/status`, `PATCH /users/:id/reset-password`, `DELETE /users/:id` — scoped user management. Delete deactivates rather than erasing the user. Administrators are institution-scoped and cannot manage other administrators; Super Admin can manage administrator accounts, email and institution assignments across institutions.
- `GET/POST /departments`, `/programs`, `/sections`, `/academic-years`, `/semesters`, `/subjects`; `PUT/DELETE /:resource/:id` — scoped academic CRUD, with delete archival. **Writes are denied to Administrators unless the Super Admin has set the global `allowAcademicRecordEditing` JSON boolean to `true`.** Administrators cannot self-grant this setting.
- `GET /dashboard/summary` — role-filtered dashboard aggregates.
- `GET/PATCH /audit-logs` is represented by `GET /audit-logs` with optional login-action filter; `GET /system-settings`, `PUT /system-settings/:key` — audit and configuration. The global academic-edit grant is Super Admin-only.

## Class offerings and enrollment

- `GET/POST /class-offerings`, `GET/PUT /class-offerings/:id` — list/create and manage offerings; Faculty manages their own classes, Administrators/Super Admin can monitor within the permitted scope.
- `POST /class-offerings/:id/generate-code`, `PATCH /class-offerings/:id/enrollment-status` — code rotation and enrollment open/close.
- `POST /enrollments/request`, `GET /enrollments/student`, `GET /enrollments/pending`, `PATCH /enrollments/:id/:action` — request/review/cancel/drop workflow. Requests move among pending, approved, rejected, cancelled and dropped states. Only approved enrollments enter the official roster; drop needs a reason and is audited. Capacity and duplicate controls are server-side.

## Grades and attendance

- `GET /class-offerings/:id/gradebook`, `POST /class-offerings/:id/grading-categories`, `PUT /grading-categories/:id` — roster, category and assessment access; category methods are points-based or equal-average.
- `POST /assessments`, `GET /assessments`, `POST /assessments/:id/publish`, `POST /scores` — create/publish assignments, quizzes, examinations and performance tasks; activities can include an optional protected reference file; save score/remarks with history.
- `GET /students/:id/grades`, `GET /students/:id/scores`, `POST /grades/publish`, `POST /grades/finalize` — published student view and authoritative weighted computation. Students can only view their own published scores/grades; Administrators can monitor but cannot publish or modify Faculty grades.
- `POST /attendance-sessions`, `POST /attendance/bulk`, `GET /attendance/class/:classOfferingId`, `GET /attendance/student/:studentId` — sessions, attendance and scoped views. Duplicate student/session entries are prevented; edits require a reason and are historied.
- `GET/POST /interventions`, `PATCH /interventions/:id` — Faculty support plans, student-visible notes/recommendations/follow-up, and follow-up status updates; Administrators can monitor their institution's plans.
- `POST /review-requests`, `GET /review-requests`, `PATCH /review-requests/:id` — student grade/attendance review requests, faculty responses, ownership validation and audit history.

## Activities, uploads, messages and notifications

- `GET/POST /announcements` — audience and class/institution-scoped feed/publication.
- `GET /activities`, `POST /submissions`, `GET /submissions`, `PATCH /submissions/:id/grade` — published class work, student submissions and Faculty scoring/feedback.
- `POST /uploads` — authenticated PDF/JPEG/PNG/DOCX upload, signature/type checks, size limits and MongoDB GridFS storage. `GET /uploads/:key` is protected by submission ownership or the class/institution membership required to view an activity reference file.
- `GET/POST /messages` — authorized durable message history/send. Socket.IO uses authenticated `message:send` and `message:new` events for live delivery.
- `GET /notifications`, `PATCH /notifications/:id/read`, `POST /notifications/register-device` — user-scoped inbox and Expo push-token registration.
- `POST /offline-sync` — online validation and conflict/rejection results for queued Faculty drafts; official grades cannot be published offline.

## Reports

- `GET /reports/class-record`, `/reports/attendance`, `/reports/student-performance`, `/reports/final-grades`, `/reports/enrollment`, `/reports/missing-activities`, `/reports/grade-submission` — role-, tenant- and offering-scoped PDF/Excel report downloads.
- `GET /reports/faculty-workload` — institution-scoped Administrator or cross-institution Super Admin faculty workload XLSX; Super Admin may supply `institutionId` to focus one institution.

## Operational notes

MongoDB is required for all data-backed routes. Do not test writes against production records. Configure HTTPS, strong JWT secrets, `MONGODB_URI`, allowed CORS origins, Atlas access control, backup/restore checks, and EAS push credentials in the deployment environment. The repository includes weighted-grade tests and file-signature tests; external-provider behavior and full MongoDB/API acceptance require a dedicated development database and real EAS credentials.
