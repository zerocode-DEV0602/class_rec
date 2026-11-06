# ClassTrack implementation checklist

Source of truth: the attached Class Record System development brief. All items remain open until there is evidence of the working outcome.

Implementation update: major role-specific screens, REST modules, enrollment/class-record workflows, intervention tracking, reporting, protected GridFS attachments, SQLite queue conflict handling, and role-scoped administrative tools are present. Verification currently includes strict TypeScript checks, 13 unit tests, lint, Node API bundle, native JavaScript bundle exports for iOS/Android, a static Expo Web export covering 26 routes, and a mobile-size Preview rendering of Login. Native uses Expo SQLite; Web Preview uses a non-persistent session adapter. This is not production sign-off: no MongoDB URI or EAS push/reset-delivery credentials are configured, API/database acceptance and real-device workflows remain unverified, and there is no completed EAS binary or deployment. Continue to treat each criteria group below as open until its complete outcome is evidenced.

## 1. Mobile application foundation and shared experience — OPEN

- Deliver one React Native + Expo + TypeScript codebase that supports Android and iOS, using Expo Router for navigation, NativeWind for styling, Zustand for client state, TanStack Query for API fetching/caching, Axios for HTTP, React Hook Form and Zod for validated forms, Expo SecureStore for tokens, Expo Notifications for push notifications, and Expo SQLite for selected offline data.
- Use reusable components, professional mobile-first portrait layouts, readable typography, intuitive icons, rounded cards/buttons, consistent spacing, skeleton/loading states, empty/error states, confirmation dialogs and success/error feedback. Use navy `#142B4A`, blue `#2563EB`, yellow `#F5C542`, `#F8FAFC`, white surfaces and green/orange/red status colors.
- Include functional Login, Forgot Password, Notifications, Messaging, User Profile and Settings screens, role-resolved navigation, real API-backed forms/actions, and clear loading, success, error and empty states. Do not use hardcoded sample data as a replacement for backend integration or leave important features as nonfunctional placeholders.
- Provide a distinct native launcher icon and coordinated splash/adaptive icon assets, preserve the existing app slug, scheme and generated Android/iOS identifiers, and keep server-only credentials out of the mobile bundle.

## 2. Backend, database, authentication and authorization — OPEN

- Use only the requested core stack: Node.js, Express.js, TypeScript, REST APIs, Mongoose, MongoDB, JWT authentication, bcrypt password hashing and Zod validation. Include Helmet, Express rate limiting, Multer, Socket.IO, PDFKit and ExcelJS in the relevant backend capabilities. Replace starter MySQL/Drizzle/tRPC application paths rather than introducing an alternate database or backend framework.
- Implement secure authentication, password reset, short-lived access tokens, refresh-token rotation/revocation, logout, current-user retrieval, secure token storage in Expo SecureStore, validation/sanitization, rate limiting, security headers, environment-based configuration, CORS, file size/type checks and protected file access. Never expose secrets, database credentials or private tokens in the mobile app.
- Enforce backend role-based access on every authenticated request, including identity, role, institution, resource ownership and record visibility. Scope Administrators to their assigned institution; preserve institution isolation; allow Super Admin cross-institution visibility but keep all actions audited. Do not treat monitoring a class record as grade-edit permission; edits require explicit authorization.
- Define Mongoose collections with timestamps, ObjectId relationships, schema validation, suitable indexes and unique indexes, pagination, archival/soft deletion where appropriate and audit history. Required collections: `users`, `institutions`, `departments`, `programs`, `sections`, `academic_years`, `semesters`, `subjects`, `class_offerings`, `enrollments`, `grading_categories`, `assessments`, `student_scores`, `grade_summaries`, `attendance_sessions`, `attendance`, `submissions`, `announcements`, `messages`, `notifications`, `review_requests`, `interventions`, `audit_logs`, and `system_settings`.
- Supply environment examples, development seed scripts/accounts, API documentation, local setup and deployment instructions. No real MongoDB Atlas URI or signing credentials were supplied; configuration must fail transparently until the deployer supplies valid environment values.

## 3. Role-specific access, dashboards and administration — OPEN

- Implement four roles with separate dashboards, navigation, permissions and accessible features: Super Admin, Administrator, Faculty and Student.
- Super Admin dashboard shows registered institutions, administrators, faculty, students, active/inactive accounts, subjects, system usage and recent activity. Super Admin can create/edit/view/activate/deactivate institutions, assign institutional administrators, create/edit/activate/deactivate administrators, reset their passwords, view/search/filter faculty and students across institutions, manage global settings and academic year defaults, publish system-wide announcements, monitor audit and login activity, generate system-wide reports and monitor backup/recovery procedures. Super Admin actions remain audited.
- Administrator dashboard shows faculty, students, departments, programs, sections, subjects, current academic year/semester and academic statistics. Within its institution, Administrator can register/edit/activate/deactivate/search/filter faculty and assign departments; register/edit students, assign student numbers/departments/programs/sections, activate/deactivate and import where supported; create/edit/archive safe-to-delete departments, programs and program codes, sections with programs/year/capacity, and subjects with code/description/units/prerequisites/offerings; configure academic years, semesters, grading periods/policies and enrollment periods; monitor offerings, rosters, attendance, submitted/published grades and class reports; publish announcements to faculty/students; and generate enrollment, faculty workload, attendance, performance and grade-submission reports in PDF/Excel. Academic record changes require explicit permission.
- Faculty dashboard shows assigned subjects, enrolled students, pending enrollment requests, upcoming assessments, missing activities, low performers, attendance summaries, notifications and recent class activity. Faculty navigation includes Dashboard, Subjects, Class Records and Profile.
- Student dashboard shows enrolled subjects, overall standing, recent grades, attendance summary, missing activities, deadlines, announcements and notifications. Student navigation includes Dashboard, My Subjects, Notifications and Profile.

## 4. Subject offerings and enrollment — OPEN

- Keep Subject separate from Class Offering. A Class Offering identifies a subject taught by a faculty member for a section, academic year, semester and schedule.
- Faculty can create/manage/archive offerings; select a subject and section; set academic year, semester, schedule, classroom/location, capacity, a unique enrollment code and enabled/disabled enrollment; view the approved roster; and share the code.
- Student can enter a code, request enrollment, view pending/approved/rejected requests and approved subjects, and cancel pending requests. Backend validates code, active/enabled/expiry, eligibility, enrollment period, duplicate requests/enrollment and capacity. Create requests as PENDING and notify faculty in-app/push. Faculty may approve/reject; notify student of decision. Only approved students enter the official class record. Expired/disabled codes cannot be used; prevent duplicate enrollment; use atomic operations/transactions or equivalent to prevent over-capacity. Faculty drop requires a reason and audit history.

## 5. Class records, grading engine and grade publication — OPEN

- Faculty can view the official roster; configure grading categories; create assessments; enter/edit scores and remarks; view individual performance; identify missing/low grades; publish grades; and generate class-record reports.
- Default categories are Written Works, Performance Tasks and Major Examinations. Example weights are 30%, 50% and 20%; category weights must total 100%. Faculty may configure policies. Use a reusable dedicated backend grading service as authoritative source; support multiple assessments per category, different maximum scores, category calculation methods, configurable weights and rounding, institutional grading scales, midterm/final periods when configured, score validation against maximum scores, and an institutional missing-score policy.
- Calculate category averages under the configured method and the weighted final grade (example: Written Works average × 0.30 + Performance Tasks average × 0.50 + Major Examination average × 0.20); do not hardcode one formula throughout the application. Clearly distinguish draft, calculated, published and finalized grades. Students never see unpublished grades or another student's grades. Keep complete score/grade modification history; gate publication and finalization appropriately; notify students when grades are published.

## 6. Attendance — OPEN

- Faculty can create a session for a class meeting; mark approved roster students Present, Absent, Late or Excused; save attendance; view history and summaries; calculate attendance percentages and identify frequent absences.
- Prevent duplicate records for the same student/session. Edits require a reason and create attendance modification history/audit records. Students can view only their attendance history, present days, absences, late records, excused absences and attendance percentage. Faculty class attendance reports and student attendance summaries are available.

## 7. Activities, submissions and student performance — OPEN

- Faculty can create assignments, quizzes, examinations and performance tasks; enter descriptions/instructions, attachments/reference files, maximum score and deadline; control submissions; view/download submissions; review, score and provide feedback; and mark work missing or late.
- Students can view activity instructions/deadlines, upload required files, submit work, track submission status, and view feedback and scores. Use protected, type/size-validated file handling and store file references/metadata rather than large binaries in MongoDB.
- Identify low grades, missing activities, frequent absences, incomplete requirements and declining performance. Faculty can inspect individual performance, add academic remarks, create interventions/recommendations, track improvement and flag academic assistance. Students can see their own subject performance, scores, progress, attendance, missing work and low-performance indicators.

## 8. Announcements, messages, reviews and notifications — OPEN

- Faculty can create subject-specific announcements, notify enrolled students about examinations/deadlines/published grades, send individual messages and receive student messages. Administrators can target institutional announcements to faculty or students; Super Admin can send system-wide announcements.
- Implement real-time communication with Socket.IO and durable message records/authorization. Implement in-app notifications and Expo push delivery/device registration for enrollment decisions, published grades, new activities/upcoming deadlines, announcements, attendance updates, faculty messages and review responses. Handle notification read state.
- Students can request review of a grade or attendance entry with a reason. Workflow: Pending → Under Review → Resolved or Rejected; faculty receives a notification, reviews and responds or makes an explicitly authorized correction, and student receives the response. Record audit/history.

## 9. Reports and exports — OPEN

- Provide class record, individual student grade, attendance, missing activities, academic performance, final grade, enrollment, faculty workload and grade-submission reports as applicable to role/institution permissions.
- Support PDF and Excel exports using PDFKit and ExcelJS, with institution isolation, authorization, sensible pagination and protected records.

## 10. Offline access and synchronization — OPEN

- Use Expo SQLite for selected offline access: previously synchronized records/class information remain viewable; selected attendance records and score entries can be drafted offline and queued for synchronization when connectivity returns.
- Clearly mark unsynchronized changes, detect conflicting updates, do not silently overwrite newer server data, validate every queued change on the backend before synchronization, and never publish official grades offline.

## 11. REST API, operational quality, tests and deployment documentation — OPEN

- Organize REST modules for authentication (`POST /api/auth/login`, logout, refresh, forgot-password, reset-password; `GET /api/auth/me`), institutions CRUD/status, users CRUD, CRUD departments/programs/sections/academic-years/semesters/subjects, offerings CRUD/code-generation/enrollment-status, enrollment request/student/pending/approve/reject/cancel/drop, assessments/scores/gradebook/publish/grade reports, attendance sessions/bulk/class/student, activities/submissions/grading, notifications/read/device registration and class-record/attendance/performance/final-grade reports.
- All APIs use proper request validation, response formatting, error handling, pagination, role/institution/resource authorization and ownership checks. Forms and buttons must connect to application logic.
- Implement automated tests for authentication, role-based access, institution isolation, subject creation, enrollment approval/rejection and duplicate prevention, grade computation, score validation, attendance, grade publication, student privacy, uploads and report generation.
- Prepare Expo EAS Android/iOS builds and store deployment guidance; document backend deployment to Node.js hosting, Atlas configuration, HTTPS, production logging, backups, file storage and notification services. Do not claim an EAS artifact or production deployment unless it has actually completed.
