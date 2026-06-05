# home-secure-server — Production Backend

## Purpose
The production-ready backend for Glazia Home Secure. Handles user auth, hub
registration via BLE provisioning flow, sensor pairing with cryptographic key
delivery, device event ingestion, and real-time notifications. Uses MongoDB for
persistence (not in-memory like the Python mock).

The hub firmware (`glazia_hub`) is written against this server's API shape and
port (3000). This is the server the hub talks to in production.

---

## Runtime Environment
- **Language**: TypeScript (Node.js)
- **Framework**: Express 5
- **Database**: MongoDB via Mongoose 9
- **Port**: 3000 (default; set `PORT` env var to override)
- **Package manager**: npm
- **Dev runner**: `tsx watch` (no compile step needed in development)
- **Test runner**: built-in Node.js test runner via `tsx --test`

---

## How to Run

```bash
cd home-secure-server

# Install dependencies
npm install

# Development (watch mode, auto-restart on changes)
npm run dev

# Production
npm start

# Type-check without running
npm run typecheck

# Build to dist/
npm run build

# Run tests (uses mongodb-memory-server, no real MongoDB needed for tests)
npm test
```

**Environment variables** (all have defaults, none are required for local dev):
| Variable | Default | Notes |
|----------|---------|-------|
| `PORT` | `3000` | Must match hub firmware `SERVER_PORT` |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/glazia-home-secure` | Local MongoDB |
| `JWT_SECRET` | `"glazia-home-secure-dev-secret"` | Change in production |
| `JWT_EXPIRES_IN` | `"7d"` | |
| `DEVICE_API_KEY` | `"glazia-device-dev-key"` | Must match hub firmware `DEVICE_API_KEY` |
| `PAIRING_SESSION_TTL_SECONDS` | `60` | Provisioning token expiry |

---

## Architecture

Dependency injection via constructor. All wiring happens in `app.ts`:

```
AuthService(config)
HomeService(config)
NotificationService()
DeviceService(notificationService, homeService)

AuthController(authService, homeService)
HomeController(homeService)
DeviceController(deviceService)
NotificationController(notificationService)

authMiddleware = createAuthMiddleware(config)
deviceMiddleware = createDeviceMiddleware(config)

createApiRouter({ controllers, middlewares })
```

`server.ts` connects to MongoDB, then calls `createApp(env)`.
`app.ts` is pure (no side effects) — used directly in tests with `mongodb-memory-server`.

---

## Key Files

| File | Role |
|------|------|
| `src/server.ts` | Bootstrap: connects DB, creates app, listens. Not imported in tests. |
| `src/app.ts` | Pure app factory `createApp(config)`. Wires all DI, mounts router at `/api`. |
| `src/config/env.ts` | `AppConfig` interface + `env` object. Reads `process.env` with defaults. |
| `src/config/database.ts` | `connectDatabase(uri)` and `disconnectDatabase()` via Mongoose. |
| `src/routes/index.ts` | `createApiRouter(deps)`. Mounts auth, homes, device, notifications sub-routers. `GET /api/health` returns `{status: "ok"}`. |
| `src/common/middlewares/auth.middleware.ts` | `createAuthMiddleware(config)`. Reads `Authorization: Bearer <token>`, verifies JWT (type must be `"user"`), loads user from DB, sets `req.user`. |
| `src/common/middlewares/device.middleware.ts` | `createDeviceMiddleware(config)`. Checks `X-Device-Api-Key` header. |
| `src/common/middlewares/error.middleware.ts` | Catches `ApiError` and generic errors, returns JSON error response. |
| `src/common/errors/api-error.ts` | `ApiError(statusCode, message)` class used throughout. |
| `src/common/utils/async-handler.ts` | Wraps async controller methods, forwards errors to `next`. |
| `src/common/utils/jwt.ts` | `signUserToken` / `verifyUserToken`. Token payload: `{sub, type: "user", email}`. |
| `src/common/utils/mac-address.ts` | `normalizeMacAddress(value)`: strips all non-hex, validates 12 hex chars, reformats to `AA:BB:CC:DD:EE:FF`. Throws `ApiError(400)` on invalid input. |
| `src/common/lib/notification-broker.ts` | `NotificationBroker` singleton. `Map<userId, Set<Response>>`. `subscribe`, `unsubscribe`, `publish` for SSE fan-out. Supports multiple simultaneous listeners per user. |
| `src/modules/users/user.model.ts` | `User`: `{name, email, passwordHash, timestamps}`. Email unique+lowercase. |
| `src/modules/hubs/hub.model.ts` | `Hub`: owner, home, macAddress (unique), deviceSecret, hardwareModel, pairing `{qrNonce, pairingModeEnabledAt/ExpiresAt}`, capabilities `{touchscreen, humiditySensor, co2Sensor, fingerprintSensor}`, status enum, lastSeenAt. |
| `src/modules/sensors/sensor.model.ts` | `Sensor`: hub ref, macAddress (unique), name, type, zone, hardwareModel, status enum, `provisionKey` (nullable, cleared after hub fetches), `provisioning.{hubMacAddress, sensorMacAddress, sharedAt}`, lastActivityAt. Compound index `{hub, macAddress}`. |
| `src/modules/homes/home.model.ts` | `Home`: owner, name, location, hub ref (unique). |
| `src/modules/homes/hub-setup-session.model.ts` | `HubSetupSession`: user, hubMacAddress, homeName, location, provisioningToken, serialNumber, hardwareModel, status enum `{pending, completed, expired}`, expiresAt, completedAt. |
| `src/modules/homes/sensor-pairing-session.model.ts` | `SensorPairingSession`: home, hub, status enum `{active, completed, expired}`, expiresAt, activatedAt, completedAt. |
| `src/modules/notifications/notification.model.ts` | `Notification`: user, hub, sensor (nullable), activityLog ref, eventType, severity, title, message, deliveredAt, readAt. |
| `src/modules/activity/activity-log.model.ts` | `ActivityLog`: user, hub, sensor (nullable), eventType, severity, source enum `{mobile, hub, sensor, system}`, payload (Mixed). |
| `src/modules/auth/auth.service.ts` | `register` (bcrypt hash), `login` (bcrypt compare), `serializeUser`. |
| `src/modules/homes/home.service.ts` | `startHubSetup`, `completeHubRegistration` (upserts Hub+Home, marks session completed), `listHomes`, `getHomeById`, `openSensorPairingMode`, `pairSensorToHome` (generates provisionKey, saves sensor). |
| `src/modules/device/device.service.ts` | `registerHubOverWifi`, `openSensorPairingMode`, `fetchPendingSensorPairing` (one-time key delivery, clears `provisionKey`), `ingestHubEvent` (creates ActivityLog + Notification, publishes SSE). |
| `src/modules/notifications/notification.service.ts` | `listForUser`, `markAsRead`, `publishRealtime`, `serialize`. |

---

## API Endpoints

All routes are under `/api`.

### Auth (`/api/auth`)
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | `/register` | None | `{name, email, password}` → `{user}` 201 |
| POST | `/login` | None | `{email, password}` → `{token, user, homes}` 200 |
| GET | `/me` | Bearer | `{user, homes}` 200 |

### Homes (`/api/homes`)
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| POST | `/setup-hub` | Bearer | `{hubMacAddress, homeName, location, serialNumber?, hardwareModel?}` → `{setupSession}` 201. Expires old pending sessions for same hub+user. |
| GET | `/` | Bearer | `{homes}` 200 |
| GET | `/:homeId` | Bearer | `{home}` 200 |
| POST | `/:homeId/sensors/pair` | Bearer | `{sensorMacAddress, name?, type?, zone?, hardwareModel?}` → `{home, sensor, provisioning}` 201. Generates `provisionKey`. **Does not check for active SensorPairingSession.** |

### Device (`/api/device`) — requires `X-Device-Api-Key` header
| Method | Path | Additional Auth | Notes |
|--------|------|----------------|-------|
| POST | `/hubs/register` | None beyond device key | `{hubMacAddress, provisioningToken}` → `{home, hubSecret}` 201. `home` is nested object (not flat like Python mock). |
| POST | `/hubs/sensor-pairing-mode` | `X-Hub-Mac-Address` + `X-Hub-Secret` | → `{sensorPairingSession}` 201 |
| GET | `/hubs/pending-sensor` | `X-Hub-Mac-Address` + `X-Hub-Secret` | → `{sensorMacAddress, provisionKey}` 200. Clears `provisionKey` on sensor after fetch (one-time). |
| POST | `/hubs/events` | `X-Hub-Mac-Address` + `X-Hub-Secret` (in headers or body) | `{sensorMacAddress?, eventType, severity?, payload?}` → `{activityLogId, notification}` 201 |

### Notifications (`/api/notifications`)
| Method | Path | Auth | Notes |
|--------|------|------|-------|
| GET | `/` | Bearer | `{notifications}` sorted newest-first |
| PATCH | `/:notificationId/read` | Bearer | Sets `readAt`. Returns `{notification}`. |
| GET | `/stream` | Bearer | SSE. Sends `event: ready` on connect, `event: notification` on new events, `event: ping` every 15 s. |

---

## Conventions and Patterns

- **All controller methods use `asyncHandler`** — no try/catch in controllers; errors thrown
  as `ApiError` or unhandled async errors are caught by the wrapper and passed to `next`.
- **`ApiError(statusCode, message)`** is the only error type that propagates intentionally.
  Generic errors become 500s in `errorMiddleware`.
- **`normalizeMacAddress`** is called on every MAC input in services. Input can be any format
  (with or without colons/hyphens); output is always `AA:BB:CC:DD:EE:FF`.
- **`req.user` is set by `authMiddleware`** — it is a full Mongoose document (`IUserDocument`).
  Controllers access `req.user!.id` (the Mongoose `.id` virtual, not `._id`).
- **Services return plain DTOs** — never return raw Mongoose documents from service methods;
  use `serializeUser`, `serializeHub`, `serializeSensor`, etc.
- **`provisionKey` one-time delivery** — set on sensor during `/sensors/pair`, cleared to
  `null` by `fetchPendingSensorPairing` after the hub's first successful GET. Second GET
  returns 404.
- **`HubSetupSession` status flow**: `pending` → `completed` (on successful `/register`) or
  `expired` (on new session for same hub, via `updateMany`).

---

## Known Quirks

- **`SensorPairingSession` is created but not enforced** — `openSensorPairingMode` creates
  one, but `pairSensorToHome` does not check for an active session. Sensors can be paired
  at any time without the hub being in pairing mode. The session model exists but is
  currently just for logging/audit purposes.
- **`package.json` has duplicate `devDependencies`** — two keys at the same level. The
  second block (lines 34–41, with older versions like `typescript ^5.9.3`) silently
  overwrites the first (with newer versions like `typescript ^6.0.2`). The effective
  versions are the older ones from the second block.
- **Hub capabilities** (`touchscreen`, `humiditySensor`, `co2Sensor`, `fingerprintSensor`)
  all default to `true` in the schema but nothing currently reads or sets them via the API.
- **`pairing.qrNonce`** field on Hub model exists but is not populated by any current code path.
- **`ingestHubEvent`** accepts `hubMacAddress` and `hubSecret` from either headers or request
  body (`req.body.hubMacAddress || req.headers[...]`). Hub firmware sends them as headers.
- **`NotificationService.serialize`** uses `any` type for the notification parameter — typed
  loosely because the method handles both populated and unpopulated Mongoose documents.

---

## What NOT to Touch or Auto-Modify

- **`src/config/env.ts` default values** — `deviceApiKey` default `"glazia-device-dev-key"`
  must match hub firmware. `port` default `3000` must match hub firmware `SERVER_PORT`.
- **`normalizeMacAddress`** output format — produces colon-separated uppercase. Stored in DB
  in this format. All queries use this normalized form. Changing the format breaks lookups.
- **NVS key naming on hub** is the other end of this — hub sends `AA:BB:CC:DD:EE:FF` over
  HTTP; server normalizes and stores it. Round-trip is safe as long as `normalizeMacAddress`
  stays consistent.
- **`src/common/lib/notification-broker.ts`** — singleton exported as `notificationBroker`.
  Do not instantiate additional `NotificationBroker` instances; all SSE subscribers must use
  the singleton or they won't receive events published by `DeviceService`.
- **Mongoose model names** (`"User"`, `"Hub"`, `"Home"`, `"Sensor"`, `"HubSetupSession"`,
  `"SensorPairingSession"`, `"Notification"`, `"ActivityLog"`) — used by Mongoose's registry
  for `.populate()` refs. Changing a model name requires updating all `ref:` fields that
  point to it.
- **`src/app.ts` factory pattern** — tests create isolated app instances with
  `mongodb-memory-server`. Do not add module-level side effects to `app.ts`; keep it pure.
