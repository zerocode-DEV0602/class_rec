# ClassTrack

ClassTrack is an Android/iOS online class-record and academic-performance mobile app. It uses the requested core stack: React Native + Expo + TypeScript for mobile and Node.js + Express + TypeScript + MongoDB/Mongoose for the REST API. The Expo project keeps its fixed SDK 57 starter/runtime ports: Metro on `8081` and the API on `3000`.

## Included role workflows

- **Super Admin:** institution creation/edit/activation, cross-institution user search and account actions, global settings, system announcements, dashboard, audit/login events and system reports.
- **Administrator:** institution-scoped user and academic setup, faculty/student account creation and editing, class monitoring (read-only by default), audit/settings, announcements and reports. Academic CRUD APIs deny writes unless the Super Admin has explicitly set the global `allowAcademicRecordEditing` system setting to the JSON boolean `true`.
- **Faculty:** class offerings and schedules, enrollment codes/requests/roster, weighted gradebook and score history, grade publication/finalization, attendance, assignments and submissions, interventions, communication, announcements and exports.
- **Student:** enrollment-code requests and cancellation, approved subjects, published scores and feedback, attendance, activity submissions, messages, notifications and grade/attendance review requests.

All permissions are enforced server-side. MongoDB includes separate academic collections and object-reference schemas. Assignment uploads are stored as chunked objects using MongoDB GridFS in the same MongoDB deployment; MongoDB holds the file metadata and references, not a single large binary document. The API currently accepts PDF, JPEG, PNG and DOCX files up to `MAX_UPLOAD_MB` (10 MB by default).

Native iOS/Android builds use Expo SQLite for selected cached records and offline attendance/score drafts. The optional Expo web preview uses an in-memory adapter only; its drafts disappear when the page session ends and do not provide durable offline storage.

## Requirements

- Node.js 22+ (use a currently supported LTS release), pnpm 9, and the repository lockfile.
- A reachable MongoDB database (local MongoDB for development or MongoDB Atlas for hosted deployments).
- EAS account/credentials for remote native Android/iOS builds and notification delivery.

## Local setup

```bash
pnpm install --frozen-lockfile
cp .env.example .env
```

Edit `.env`: provide `MONGODB_URI`, unique random `JWT_ACCESS_SECRET` and `JWT_REFRESH_SECRET` values (at least 32 characters each), permitted `CORS_ORIGINS`, and a one-time `SEED_ADMIN_EMAIL` plus a unique `SEED_ADMIN_PASSWORD` of at least 12 characters. If the app is being opened from a physical phone, set `EXPO_PUBLIC_API_BASE_URL` to an API address reachable from that phone (for example, your development computer's LAN IP), not `localhost`. Do not place server secrets in any `EXPO_PUBLIC_*` variable.

Create the first Super Admin account once:

```bash
pnpm db:seed
```

The seed command refuses to overwrite an existing account. Remove or unset the seed password after it succeeds. Then start both Metro and the API:

```bash
pnpm dev
```

Open the Expo Go QR code or choose a platform from the Expo CLI. The API health endpoint is `GET http://localhost:3000/api/health`; `database: connected` indicates MongoDB connectivity. If Metro and the API need to be run separately, use `pnpm dev:mobile` and `pnpm dev:server` in separate terminals.

## Commands

| Command             | Purpose                                                                 |
| ------------------- | ----------------------------------------------------------------------- |
| `pnpm check`        | Strict TypeScript checks for the mobile app and backend                 |
| `pnpm test`         | Run the automated Vitest suite                                          |
| `pnpm lint`         | Run Expo lint                                                           |
| `pnpm build`        | Export the Expo app for supported platforms                             |
| `pnpm build:server` | Bundle the Node/Express API to `dist/api`                               |
| `pnpm start:server` | Start the compiled API (uses `PORT`, default `3000`)                    |
| `pnpm db:seed`      | Create the first Super Admin from the protected seed environment values |

There are no SQL migrations or `db:push` step: Mongoose creates/validates collections and indexes from its schemas when the application connects. Set `NODE_ENV=production` in hosted deployments and create indexes as part of deployment preparation; automatic index creation is disabled in production.

## EAS builds

`eas.json` defines internal-preview and production build profiles. Configure the API URL as a public Expo environment value for each EAS environment; the production app must use a reachable HTTPS API URL.

```bash
eas build --platform android --profile preview
eas build --platform ios --profile preview
eas build --platform all --profile production
```

Before real push notifications can be delivered, configure the Android FCM and Apple APNs credentials for the EAS project, install the app through a build that supports push, and grant notification permission on the device. Development/browser previews do not prove device push delivery. Store submission needs the appropriate store credentials and a completed EAS build; this repository does not claim an already-built APK/AAB/TestFlight artifact.

## Backend deployment

Deploy the Node API as a Node.js service (for example, Render, Railway or a VPS) using:

```bash
pnpm install --frozen-lockfile
pnpm build:server
pnpm start:server
```

Provide `MONGODB_URI` for MongoDB Atlas, both JWT secrets, `PORT`, production `CORS_ORIGINS`, `MAX_UPLOAD_MB`, and any optional password-reset webhook. Use HTTPS, restrict Atlas network access, protect logs and credentials, configure Atlas backup/restore verification, and set EAS push credentials. The Management panel explicitly reports that backups are not configured until an operational backup/restore monitor is provided; it does not claim a backup job is running. File storage is the `class_files` GridFS bucket in MongoDB; use MongoDB Atlas storage/backups and monitor its limits.

### Password reset and external delivery

Forgot-password requests use an enumeration-safe response. When configured, `PASSWORD_RESET_WEBHOOK_URL` receives a one-time reset token payload so a deployment can connect its own authorized delivery channel. Configure the webhook over HTTPS and protect its access. Without a delivery integration, the API does not claim that reset messages were emailed. Expo push delivery likewise requires the EAS provider credentials described above.

## Source layout

- `app/`, `components/`, `services/`, `store/`, `types/`: Expo Router screens, API/offline/push/realtime clients, Zustand auth and app contracts.
- `backend/src/app.ts`, `server.ts`: Express security, API registration, socket server and listener.
- `backend/src/routes/`: auth, academic, offerings/enrollment, records, activities/messaging and exports.
- `backend/src/models/`, `services/`, `middleware/`, `config/`, `utils/`: Mongoose schemas, grading/audit/notification/GridFS/realtime services, access control and connection utilities.
- `backend/src/scripts/seed.ts`: initial Super Admin bootstrap.
- `assets/images/`, `app.config.ts`: native icon/splash files and Expo/EAS-ready application configuration.

See [`API.md`](./API.md) for route groups, permission boundaries and implementation notes. Do not use production customer records for manual testing; use a dedicated development MongoDB database.
