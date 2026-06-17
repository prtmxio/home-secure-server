# home-secure-server - Codex Instructions

## Purpose

Production backend for Glazia Home Secure. This is the active backend the hub firmware targets. It handles auth, homes, hub registration, sensor pairing, one-time provision-key delivery, hub events, activity logs, notifications, and SSE.

Do not confuse this with `glazia-prototype/server/`, which is an old Python mock backend.

## Run and Verify

```bash
cd home-secure-server
npm install
npm run dev
npm run typecheck
npm run build
npm test
```

Tests use `mongodb-memory-server`; local development defaults are defined in `src/config/env.ts`.

Environment defaults:
- `PORT=3000`, must match hub `SERVER_PORT`.
- `MONGODB_URI=mongodb://127.0.0.1:27017/glazia-home-secure`.
- `JWT_SECRET=glazia-home-secure-dev-secret`, `JWT_EXPIRES_IN=7d`.
- `DEVICE_API_KEY=glazia-device-dev-key`, must match hub firmware.
- `PAIRING_SESSION_TTL_SECONDS=60`.

## Stack

- Node.js, TypeScript, Express 5.
- Mongoose 9 and MongoDB.
- `tsx watch src/server.ts` for dev.
- Built-in Node test runner via `tsx --test`, with `supertest`.
- Default port `3000`, matching hub firmware.

## Architecture

`src/app.ts` is a pure app factory and should stay side-effect free for tests. `src/server.ts` connects MongoDB and listens.

Services/controllers are wired by dependency injection. Controllers use `asyncHandler`; intentional errors should be `ApiError(statusCode, message)`.

MAC input must go through `normalizeMacAddress()` and stored/query format is uppercase colon-separated.

## Navigation

- `src/server.ts`: DB connect and listen; keep out of tests.
- `src/app.ts`: pure `createApp(config)` factory, DI wiring, router mount.
- `src/config/env.ts`: defaults and `AppConfig`.
- `src/routes/index.ts`: `/api` router and `/api/health`.
- `src/common/middlewares/auth.middleware.ts`: Bearer user JWT, sets `req.user`.
- `src/common/middlewares/device.middleware.ts`: device API key check.
- `src/common/utils/mac-address.ts`: MAC normalization.
- `src/common/lib/notification-broker.ts`: SSE fan-out singleton.
- `src/modules/homes/home.service.ts`: hub setup, hub registration completion, sensor pairing.
- `src/modules/device/device.service.ts`: hub device APIs, one-time provision key fetch, event ingest.
- `src/modules/notifications/notification.service.ts`: list, mark-read, realtime publish, serialize.

## Hub API Contracts

All routes are under `/api`.

- `POST /api/device/hubs/register`: body `{hubMacAddress, provisioningToken}` returns `{home, hubSecret}`.
- `POST /api/device/hubs/sensor-pairing-mode`: uses `X-Hub-Mac-Address` and `X-Hub-Secret`.
- `GET /api/device/hubs/pending-sensor`: returns `{sensorMacAddress, provisionKey}` once, then clears `provisionKey`.
- `POST /api/device/hubs/events`: accepts hub identity from headers or body; hub sends headers.

All device routes require `X-Device-Api-Key`, default `glazia-device-dev-key`.

Other API surfaces:
- Auth: `POST /api/auth/register`, `POST /api/auth/login`, `GET /api/auth/me`.
- Homes: `POST /api/homes/setup-hub`, `GET /api/homes`, `GET /api/homes/:homeId`, `POST /api/homes/:homeId/sensors/pair`.
- Notifications: `GET /api/notifications`, `PATCH /api/notifications/:notificationId/read`, `GET /api/notifications/stream`.
- SSE stream sends ready on connect, notification events on publish, and ping heartbeats.

## Models and DTO Rules

- Core models: `User`, `Hub`, `Home`, `Sensor`, `HubSetupSession`, `SensorPairingSession`, `Notification`, `ActivityLog`.
- `Hub.macAddress` and `Sensor.macAddress` are unique normalized MAC strings.
- `Sensor.provisionKey` is nullable and cleared after the hub fetches it.
- Services should return plain DTOs, not raw Mongoose documents. Use existing serializer patterns.
- Controllers should rely on `asyncHandler`; do not add repetitive try/catch blocks for normal service errors.
- Controllers use `req.user!.id`, the Mongoose `.id` virtual.

## Do Not Auto-Modify

- `src/config/env.ts` defaults unless the task explicitly changes deployment config.
- `normalizeMacAddress()` output format.
- The `notificationBroker` singleton pattern.
- Mongoose model names and `ref` names.
- The `src/app.ts` factory purity.

## Known Pitfalls

- `SensorPairingSession` is created but not enforced by `pairSensorToHome`; sensors can be paired without an active hub button session.
- `package.json` has duplicate `devDependencies`; the later key wins.
- Hub capability fields and `pairing.qrNonce` exist but are not actively used by current routes.
- `ingestHubEvent` accepts hub identity from headers or body; hub firmware sends headers.
- `NotificationService.serialize` is loosely typed to support populated and unpopulated documents.
