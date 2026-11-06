# ClassTrack implementation plan

## Scope and technical approach

Build the requested Android/iOS ClassTrack application while preserving the initialized Expo Router/React Native starter and its fixed 8081 Metro / 3000 API ports. Keep the frontend and backend in TypeScript. Replace the starter's incompatible Drizzle/MySQL and tRPC application paths with Node.js + Express REST and Mongoose + MongoDB, without adding another application framework or database. Use JWT authentication, bcrypt password hashing, server-enforced role/institution/resource authorization, Zod request and form validation, Helmet, rate limiting, and environment-only secrets. The mobile app uses NativeWind, Expo Router, Zustand, TanStack Query, Axios, React Hook Form, Zod, Expo SecureStore, Expo Notifications and Expo SQLite. The backend uses Socket.IO, Multer, PDFKit and ExcelJS as needed.

MongoDB collections use timestamps, ObjectId references, validation, uniqueness/indexes, institution ownership, audit history and soft archives where applicable. Store protected uploaded objects in MongoDB GridFS (file bytes as chunks, application metadata as references on submissions/activities) to preserve the MongoDB-only backend constraint. Implement auth/account setup; institutional and academic administration; distinct subject/offering/enrollment workflows; authoritative grade computation, score history, publication/finalization; attendance; activities/submissions/reference files; review/intervention tracking; announcements, notifications and messaging; PDF/Excel exports; and selected offline drafts with server-side validation and conflict detection. A pending enrollment is never the official roster; only approved students are. Students can only retrieve their own published grades. Admin monitoring does not grant grade-edit permission.

MongoDB URI, JWT signing secrets, push credentials and the optional password-reset delivery integration must be supplied by the deployer through environment configuration. No production database or third-party delivery credentials were supplied; a production connection, push delivery, external password-reset delivery and native device interaction must not be claimed without configuration and successful verification.

## Project structure

- `app/`: Expo Router auth, role tabs, dashboard, management, reports, enrollment, announcements, messaging, intervention, class/gradebook/attendance/activity screens.
- `services/`: typed Axios API, push registration, Socket.IO, and platform-specific offline adapters: Expo SQLite cache/queue/synchronization on Android/iOS plus a transient in-memory adapter for Web Preview only.
- `store/`, `types/`: secure authentication state and shared typed contracts.
- `backend/src/`: Express app/server, configuration, middleware, REST routes, Mongoose models, grading/audit/storage services, seed script, and tests; `backend/src/routes/` separates academic, class, record, engagement, offline and report modules.
- `assets/images/`, `app.config.ts`: native icon, splash/adaptive assets, Expo configuration and literal project-logo metadata.
- Root `README.md`, `API.md`, `.env.example`, `eas.json`, `plan.md` and `TODO.md`: onboarding, API contracts, runtime configuration, native-build profiles, approved design/implementation approach and acceptance criteria.

## Design direction

Three candidate directions: Swiss academic editorial (probability 0.07); soft neo-skeuomorphic planner (0.04); dark-academia registrar console (0.03). Choose **Swiss academic editorial**: crisp, calm, trustworthy interfaces with strong typographic hierarchy and precise academic data presentation.

- **Core principles:** clarity before decoration; role-specific focus; status is always legible; frequent actions are thumb-reachable.
- **Color philosophy:** navy `#142B4A` conveys institutional trust, blue `#2563EB` anchors actions, yellow `#F5C542` marks attention; use `#F8FAFC` and white for calm surfaces, with restrained green/orange/red states.
- **Layout paradigm:** portrait-first vertical dashboard, compact summary strip, then prioritized task and record cards; place role navigation at the bottom.
- **Signature elements:** slim academic-blue section rules, quiet grade/status chips, and a recurring rounded “record sheet” card motif.
- **Interaction and motion:** direct, forgiving touch controls; confirm consequential grade/status changes; short 160–220 ms fades/slides for state changes; no decorative motion that delays data entry.
- **Typography:** system sans-serif (SF Pro on iOS / Roboto on Android), with weight/size distinctions for dashboard totals, section headers, labels and metadata; favor tabular figures for scores.
- **Brand essence:** a dependable class-record companion for educators and learners; precise, reassuring, practical.
- **Brand voice:** concise and specific; examples: “Your classes, at a glance.” “Grades stay private until they’re published.”
- **Wordmark/icon:** a simple navy academic folio with a vivid blue check/grade line; no small text inside the launcher mark.
- **Signature brand color:** ClassTrack blue `#2563EB`.

## Delivery workflow

Maintain the criteria in `TODO.md`, implement against the supplied brief, and retain the fixed Expo mobile starter. Validate with TypeScript, ESLint, automated tests and native JavaScript bundle exports; build the Node API bundle separately. Start Expo/API on their fixed ports and verify readiness without writing to the shared application database. Report which code and builds were verified, which integrations need deployment configuration, and any unresolved requirement gaps. Do not claim the app is production-deployed, connected to Atlas, or installed on a device unless that has actually completed.
