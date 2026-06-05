# home-secure-server — Institutional Knowledge

Non-obvious facts, root causes, and decisions that are not derivable from
reading the code alone. Read this before making any changes to `home-secure-server/`.

---

## This Is the Active Server — Python Mock Is Abandoned

`home-secure-server/` is the only server the hub firmware talks to. The Python
mock at `glazia-prototype/server/` is **dead code** — it has multiple blockers
(wrong response shapes, missing endpoints, wrong port) and is not maintained.

Hub firmware `state.h` has `SERVER_PORT 3000` pointing here. Do not attempt to
align this server with the Python mock or vice versa.

---

## Architecture Decisions

### Pure App Factory (`app.ts`) — No Side Effects at Module Level
`app.ts` exports `createApp(config)` as a pure factory. No database connections,
no global singletons initialized at module load time. This is intentional — tests
use `mongodb-memory-server` and call `createApp` with a test config to get a
fresh, isolated app instance per test run. Do not add side effects (file I/O,
DB connections, `setInterval`, etc.) at the module level of `app.ts`.

### `NotificationBroker` Is a Singleton
`src/common/lib/notification-broker.ts` exports `notificationBroker` as a
module-level singleton. All SSE subscribers registered via
`GET /api/notifications/stream` use this singleton. `DeviceService` calls
`notificationBroker.publish(userId, notification)` to fan out to all active
listeners for that user.

Do not instantiate `new NotificationBroker()` elsewhere. If you do, events
published through `DeviceService` will not reach SSE clients subscribed through
the new instance.

### `SensorPairingSession` Is Audit-Only
`openSensorPairingMode` creates a `SensorPairingSession` document, but
`pairSensorToHome` does not check for an active session. Sensors can be paired
at any time, even without a hub button press. The session model exists for
logging and future enforcement, not current access control.

---

## Critical Fixes Applied

### `package.json` Duplicate `devDependencies` (Fixed 2026-04-17)
The file previously had two `"devDependencies"` keys at the same JSON level.
The second block (older versions: `typescript ^5.9.3`, `@types/express ^5.0.3`,
`@types/node ^24.6.0`, `@types/supertest ^6.0.3`, `tsx ^4.20.6`) was silently
overwriting the first block (newer versions). The effective TypeScript was 5.9.3
despite the repo intending to use 6.x.

**Fixed:** Merged into a single block keeping the newer versions:
`typescript ^6.0.2`, `@types/express ^5.0.6`, `@types/node ^25.5.0`,
`@types/supertest ^7.2.0`, `tsx ^4.21.0`, `@types/jsonwebtoken ^9.0.10`.

---

## Non-Obvious Behaviours

### `provisionKey` One-Time Delivery — Cleared After First Hub Fetch
`pairSensorToHome()` in `home.service.ts` generates a 32-char hex `provisionKey`
(`crypto.randomBytes(16).toString("hex")`) and saves it to `Sensor.provisionKey`.

`fetchPendingSensorPairing()` in `device.service.ts` returns the key to the hub,
then immediately sets `provisionKey = null` on the sensor document. A second call
to `GET /api/device/hubs/pending-sensor` returns 404 — the key is gone.

This is intentional: the provision key is the ESP-NOW LMK (encryption key). It
should be delivered exactly once. If re-pairing is needed, the phone must call
`POST /api/homes/:homeId/sensors/pair` again to generate a new key.

### `normalizeMacAddress` Strips All Non-Hex Characters
Input to `normalizeMacAddress` can be any format: `AA:BB:CC:DD:EE:FF`,
`aa-bb-cc-dd-ee-ff`, `AABBCCDDEEFF`, etc. The function:
1. Strips everything that isn't `[0-9a-fA-F]`
2. Validates exactly 12 hex characters remain
3. Reformats as uppercase colon-separated `AA:BB:CC:DD:EE:FF`

All MACs are stored in DB in this format. All queries against MAC fields use
normalized values. Changing the output format of `normalizeMacAddress` would
break all existing DB records and require a migration.

### JWT `type: "user"` Field Is Required
`verifyUserToken` in `jwt.ts` checks `payload.type === "user"`. Auth middleware
rejects tokens where this field is absent or has any other value. Old tokens
signed before this field was added will fail authentication even if the signature
is valid.

### `req.user` Is a Full Mongoose Document
`authMiddleware` sets `req.user` to the result of `UserModel.findById()` — a
full `IUserDocument`, not a plain object. Controllers access `req.user!.id`
(the Mongoose `.id` virtual, which is the `_id` as a string). Do not use
`req.user!._id` directly where a string is expected — use `.id`.

### `ingestHubEvent` Accepts Hub Identity from Headers OR Body
`DeviceController.ingestHubEvent` reads `hubMacAddress` and `hubSecret` from
either `req.headers` or `req.body`. Hub firmware sends them as headers
(`X-Hub-Mac-Address`, `X-Hub-Secret`). The body fallback exists for testing
convenience. Do not rely on the body path in production firmware.

### `HubSetupSession` Expiry on Duplicate Registration
`startHubSetup` in `home.service.ts` calls `HubSetupSessionModel.updateMany`
to set `status: "expired"` on any existing `pending` sessions for the same
`(user, hubMacAddress)` pair before creating a new session. This prevents
stale provisioning tokens from being used after a re-registration attempt.

---

## Security Notes (Development Context)

- `JWT_SECRET` default `"glazia-home-secure-dev-secret"` — change in production
- `DEVICE_API_KEY` default `"glazia-device-dev-key"` — change in production;
  must match hub firmware `DEVICE_API_KEY` in `state.h`
- No rate limiting on auth endpoints
- Provisioning tokens expire after `PAIRING_SESSION_TTL_SECONDS` (default 60 s)
- Sensor `provisionKey` (ESP-NOW LMK) is transmitted in plaintext over HTTP —
  acceptable on a trusted LAN, not acceptable over the public internet without TLS
