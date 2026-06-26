# Glazia Home Secure Backend

TypeScript backend for the Glazia Home Secure system.

The system has four actors:

- `Mobile app`
- `Backend server`
- `Home hub` (`ESP32-S3`)
- `Frame sensors` (`ESP32-C3 Mini`) placed on door frames and window frames

## Core model

The backend now follows this rule:

- one `home` has exactly one `hub`
- one `home` can have multiple `sensors`
- all sensors in a home belong to that home’s single hub

So the hierarchy is:

```text
User
  -> Home
    -> Hub
    -> Sensors[]
```

## What each actor does

### Mobile app

- registers and logs in the user
- connects to the hub over BLE during first-time setup
- sends Wi-Fi SSID and password to the hub over BLE
- starts the home setup session with the backend
- scans sensor QR codes
- sends sensor pairing requests to the backend
- shows homes, hub details, sensors, and notifications

### Backend server

- authenticates users
- stores homes, hubs, sensors, setup sessions, activity logs, and notifications
- creates a temporary BLE setup session for onboarding the hub
- completes hub registration only when the hub connects over Wi-Fi
- allows sensor pairing only when the hub has enabled pairing mode
- stores notifications when hub events arrive
- streams real-time notifications to the mobile app

### Hub

- exposes BLE during initial setup
- receives Wi-Fi credentials from the mobile app over BLE
- connects to Wi-Fi
- registers itself with the backend using a provisioning token
- enables sensor pairing mode when the pair button is pressed
- sends activity events to the backend

### Sensor

- has a QR code with its MAC address
- is physically installed on a door frame or window frame
- is paired only while the hub pairing mode is active
- receives the hub MAC address after pairing

## Tech stack

- Express
- TypeScript
- MongoDB with Mongoose
- JWT for mobile authentication
- Server-Sent Events for live notifications
- WebSocket relay for main door live camera feed

## Environment

Create a `.env` file:

```bash
PORT=3000
MONGODB_URI=mongodb://127.0.0.1:27017/glazia-home-secure
JWT_SECRET=replace-this
JWT_EXPIRES_IN=7d
DEVICE_API_KEY=replace-this-too
PAIRING_SESSION_TTL_SECONDS=60
META_WHATSAPP_PHONE_NUMBER_ID=your-meta-phone-number-id
META_WHATSAPP_TOKEN=your-meta-permanent-or-temporary-access-token
META_WHATSAPP_API_VERSION=v22.0
WHATSAPP_OTP_TEMPLATE_NAME=login_otp
WHATSAPP_COUNTRY_CODE=91
FIREBASE_SERVICE_ACCOUNT_JSON=
FIREBASE_PROJECT_ID=
FIREBASE_CLIENT_EMAIL=
FIREBASE_PRIVATE_KEY=
```

OTP login generates a fresh six digit OTP for every request. In production the
server sends it through the Meta WhatsApp Cloud API using the `login_otp`
template. In non-production, the OTP is also returned in the API response so
local tests and development can verify login without WhatsApp credentials.

For mobile push notifications, configure Firebase Admin using either:

- `FIREBASE_SERVICE_ACCOUNT_JSON`: full Firebase service account JSON string
- or `FIREBASE_PROJECT_ID`, `FIREBASE_CLIENT_EMAIL`, and `FIREBASE_PRIVATE_KEY`

If Firebase credentials are missing, the backend still stores in-app
notifications but skips OS-level push delivery.

## Run

```bash
npm install
npm start
```

For development, run:

```bash
npm run dev
```

By default the server tries to connect to `mongodb://127.0.0.1:27017/glazia-home-secure`. If local MongoDB is not running in `NODE_ENV=development`, the server falls back to an in-memory MongoDB instance so the API can still boot. That fallback data is temporary and is deleted when the server stops.

Useful scripts:

- `npm run dev`
- `npm run typecheck`
- `npm test`

## Step-by-step flow

## Step 1. User signs up and logs in

Mobile app calls:

- `POST /api/auth/register`
- `POST /api/auth/login`

After login, the backend returns:

- user details
- JWT token
- user homes with their hub and sensors

## Step 2. User starts adding a new home

The user opens the app and chooses to add a new home.

At this stage the app asks for:

- home name
- location or address

Example:

- `Skyline Apartment`
- `Tower 2, Flat 904`

This is important because the home owns the hub. The hub is not the primary top-level object anymore. The home is.

## Step 3. Mobile app connects to the hub over BLE

During the first-time setup:

- the mobile app discovers the `ESP32-S3` hub over BLE
- the mobile app connects to the hub over BLE
- the user selects Wi-Fi SSID and enters Wi-Fi password in the app

The mobile app sends over BLE:

- Wi-Fi SSID
- Wi-Fi password
- provisioning token received from backend

BLE wire format:

```json
{
  "type": "hub_wifi_provision",
  "ssid": "<WIFI_SSID>",
  "passwd": "<WIFI_PASSWORD>",
  "token": "<PROVISIONING_TOKEN>"
}
```

The Flutter app writes this as UTF-8 JSON followed by `\n`. It may arrive in
multiple BLE chunks, so ESP32 firmware should append incoming bytes until it
receives newline, then parse the complete JSON object.

The backend does not need the Wi-Fi password. That stays between the mobile app and the hub.

## Step 4. Mobile app starts a temporary BLE setup session with backend

Before or during BLE provisioning, the mobile app opens a backend setup session:

- `POST /api/homes/setup-hub`

Example:

```bash
curl -X POST http://localhost:3000/api/homes/setup-hub \
  -H "Authorization: Bearer <USER_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "hubMacAddress":"AA:BB:CC:DD:EE:FF",
    "homeName":"Skyline Apartment",
    "location":"Tower 2, Flat 904"
  }'
```

The backend creates a short-lived setup session and returns:

- `setupSessionId`
- `hubMacAddress`
- `provisioningToken`
- `expiresAt`

The app then passes that `provisioningToken` to the hub over BLE together with Wi-Fi credentials.

## Step 5. Hub connects to Wi-Fi and completes registration

After receiving Wi-Fi credentials and provisioning token over BLE:

- the hub connects to the internet
- the hub calls the backend itself

Device-side API:

- `POST /api/device/hubs/register`

Example:

```bash
curl -X POST http://localhost:3000/api/device/hubs/register \
  -H "X-Device-Api-Key: <DEVICE_API_KEY>" \
  -H "Content-Type: application/json" \
  -d '{
    "hubMacAddress":"AA:BB:CC:DD:EE:FF",
    "provisioningToken":"<PROVISIONING_TOKEN>"
  }'
```

This is the important rule change:

- the mobile app starts the setup
- the hub finishes the registration
- only when the hub comes online over Wi-Fi does it get attached to the user’s home

The backend then:

- validates the provisioning token
- creates or updates the hub
- creates the home
- links the home to the hub
- assigns ownership to the user
- generates or keeps the hub secret for later authenticated device calls

## Step 6. Mobile app loads homes

After successful registration the app can fetch homes:

- `GET /api/homes`
- `GET /api/homes/:homeId`
- `GET /api/auth/me`

Each home response includes:

- home information
- exactly one hub
- all paired sensors for that home

## Step 7. User wants to add a door or window sensor

Sensors are expected to be mounted on:

- front door frames
- back door frames
- balcony doors
- bedroom windows
- kitchen windows

Typical zones can be:

- `Front Door Frame`
- `Living Room Window Frame`
- `Kitchen Window Frame`

## Step 8. User presses pair button on the hub

Before a sensor can be added:

- the user presses the pair button on the hub
- the hub enters sensor pairing mode for a short time

The hub then informs the backend:

- `POST /api/device/hubs/sensor-pairing-mode`

Example:

```bash
curl -X POST http://localhost:3000/api/device/hubs/sensor-pairing-mode \
  -H "X-Device-Api-Key: <DEVICE_API_KEY>" \
  -H "X-Hub-Mac-Address: AA:BB:CC:DD:EE:FF" \
  -H "X-Hub-Secret: <HUB_DEVICE_SECRET>"
```

The backend creates a short-lived active pairing window for that home’s hub.

Important rule:

- sensor pairing should fail if hub pairing mode is not active

## Step 9. Mobile app scans sensor QR

The user then scans the QR code printed on the `ESP32-C3 Mini` sensor.

That QR contains:

- sensor MAC address

The mobile app sends the scanned sensor details to the backend:

- `POST /api/homes/:homeId/sensors/pair`

Example:

```bash
curl -X POST http://localhost:3000/api/homes/<HOME_ID>/sensors/pair \
  -H "Authorization: Bearer <USER_TOKEN>" \
  -H "Content-Type: application/json" \
  -d '{
    "sensorMacAddress":"11:22:33:44:55:66",
    "name":"Front Door Frame Sensor",
    "type":"contact",
    "zone":"Front Door Frame"
  }'
```

The backend checks:

- the home belongs to the logged-in user
- the home has a hub
- the hub has an active sensor pairing session
- the sensor is not already paired to another hub

Then the backend:

- creates or updates the sensor
- links the sensor to the home’s hub
- marks the pairing session completed
- stores an activity log

## Step 10. Backend returns mutual MAC provisioning payload

When sensor pairing succeeds, the backend returns provisioning data for both devices.

That response contains:

- hub MAC address for the sensor
- sensor MAC address for the hub

Meaning:

- the sensor learns which hub it belongs to
- the hub learns which sensor has been added

This matches your required rule:

- share the hub MAC to the sensor
- share the sensor MAC to the hub

## Step 11. Hub reports activity events

When the hub or one of its frame sensors detects activity, the hub sends an event:

- `POST /api/device/hubs/events`

Magnetic reed module example for door opening:

```bash
curl -X POST http://localhost:3000/api/device/hubs/events \
  -H "X-Device-Api-Key: <DEVICE_API_KEY>" \
  -H "X-Hub-Mac-Address: AA:BB:CC:DD:EE:FF" \
  -H "X-Hub-Secret: <HUB_DEVICE_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{
    "sensorMacAddress":"11:22:33:44:55:66",
    "eventType":"door_opened",
    "payload":{
      "module":"magnetic_reed",
      "reedState":"open"
    }
  }'
```

Vibration module example for shock found:

```bash
curl -X POST http://localhost:3000/api/device/hubs/events \
  -H "X-Device-Api-Key: <DEVICE_API_KEY>" \
  -H "X-Hub-Mac-Address: AA:BB:CC:DD:EE:FF" \
  -H "X-Hub-Secret: <HUB_DEVICE_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{
    "sensorMacAddress":"11:22:33:44:55:66",
    "eventType":"shock_detected",
    "payload":{
      "module":"vibration",
      "shockFound":true
    }
  }'
```

The backend:

- validates hub credentials
- finds the home hub
- finds the sensor under that hub
- stores an activity log
- creates a realtime user notification in the mobile app

Known sensor event types:

- `door_opened`: magnetic reed module detected door opening. Defaults to
  `critical` severity.
- `shock_detected`: vibration module detected shock. Defaults to `critical`
  severity.

## Step 12. Mobile app receives notifications

For history:

- `GET /api/notifications`

For real-time stream:

- `GET /api/notifications/stream`

For mobile push notifications, the Flutter app registers its Firebase Cloud
Messaging token after login/session restore:

```http
POST /api/notifications/push-token
Authorization: Bearer <USER_JWT>
Content-Type: application/json
```

Request:

```json
{
  "token": "<FCM_DEVICE_TOKEN>",
  "platform": "android"
}
```

To verify push setup for the logged-in user:

```http
GET /api/notifications/push-status
Authorization: Bearer <USER_JWT>
```

Response:

```json
{
  "firebaseConfigured": true,
  "tokenCount": 1,
  "platforms": ["android"]
}
```

To send a manual test push to the logged-in user's registered devices:

```http
POST /api/notifications/test-push
Authorization: Bearer <USER_JWT>
```

If `firebaseConfigured` is `false`, add Firebase Admin credentials to backend
`.env`. If `tokenCount` is `0`, log out and log in again from the mobile app so
the app can register its FCM token.

When the user logs out, the app removes the current device token from that
user:

```http
DELETE /api/notifications/push-token
Authorization: Bearer <USER_JWT>
Content-Type: application/json
```

Request:

```json
{
  "token": "<FCM_DEVICE_TOKEN>"
}
```

To mark read:

- `PATCH /api/notifications/:notificationId/read`

To delete alerts:

- `DELETE /api/notifications/:notificationId`
- `DELETE /api/notifications`

Both delete endpoints are authenticated and only affect alerts belonging to the
current user.

This allows the app to show:

- live alerts when a door or window sensor is triggered
- previous notifications
- read/unread state
- clear all alerts and swipe-to-delete single alerts
- OS-level push popups when the app is closed or in background, if Firebase is
  configured

Firebase mobile setup required:

- Android app must include `android/app/google-services.json`.
- Android Gradle should apply the Google Services plugin after the Firebase
  file is added.
- Backend must have Firebase Admin credentials in `.env`.
- Events like `door_opened` and `shock_detected` create both in-app
  notifications and FCM push notifications.

## Step 13. ESP32 streams main door live feed with WebRTC

The hub or ESP32 camera sends the actual camera media over WebRTC. The backend
does not relay video frames. It only authenticates both sides and relays WebRTC
signaling messages over WebSocket.

This is the intended flow:

```text
ESP32 camera/hub
  -> Hub control WebSocket
  -> Backend auth + signaling relay
  -> Viewer WebSocket signaling
  -> Flutter app

ESP32 camera/hub
  -> WebRTC media track
  -> Flutter app
```

The hub should keep one device WebSocket open for door-lock commands, sensor
alerts, camera start/stop commands, and WebRTC live-feed signaling. The camera
video itself should travel as WebRTC media.

Hub device WebSocket endpoint:

- `ws://localhost:3000/api/device/hubs/control/ws`
- `wss://your-domain.com/api/device/hubs/control/ws` in production behind TLS

Device WebSocket auth headers:

- `x-device-api-key: <DEVICE_API_KEY>`
- `x-hub-mac-address: <HUB_MAC_ADDRESS>`
- `x-hub-secret: <HUB_DEVICE_SECRET>`

Example device URL:

```text
ws://localhost:3000/api/device/hubs/control/ws
```

When the ESP32 connects successfully, the backend returns:

```json
{
  "type": "ready"
}
```

If a mobile viewer is already waiting, the backend also sends:

```json
{
  "type": "viewer-ready",
  "hubId": "<HUB_ID>"
}
```

The ESP32 should start its WebRTC offer when it receives `viewer-ready` on the
same hub control WebSocket. That socket is also used for messages like
`door_lock_command`, `door_lock_ack`, `sensor_event`, `camera_stream_command`,
and `camera_stream_status`.

ESP32 sends an SDP offer:

```json
{
  "type": "offer",
  "sdp": {
    "type": "offer",
    "sdp": "<DEVICE_SDP>"
  }
}
```

ESP32 sends ICE candidates as they are discovered:

```json
{
  "type": "ice-candidate",
  "candidate": {
    "candidate": "candidate:...",
    "sdpMid": "0",
    "sdpMLineIndex": 0
  }
}
```

Mobile viewer query params:

- `role=viewer`
- `mode=webrtc`
- `token=<USER_JWT>`
- `hubId=<HUB_ID>`

Example viewer URL:

```text
ws://localhost:3000/ws/live-feed?role=viewer&mode=webrtc&token=<USER_JWT>&hubId=<HUB_ID>
```

When the app opens the hub live feed page, it connects to this WebSocket. When
the mobile viewer connects successfully, the backend returns:

```json
{
  "type": "ready",
  "role": "viewer",
  "hubId": "<HUB_ID>",
  "mode": "webrtc",
  "status": "waiting"
}
```

The Flutter app then tells the ESP32 that a viewer is ready:

```json
{
  "type": "viewer-ready"
}
```

The backend forwards this to connected ESP32 device clients for the same hub.

Mobile app returns an SDP answer:

```json
{
  "type": "answer",
  "sdp": {
    "type": "answer",
    "sdp": "<MOBILE_SDP>"
  }
}
```

Mobile app also sends ICE candidates as they are discovered:

```json
{
  "type": "ice-candidate",
  "candidate": {
    "candidate": "<ICE_CANDIDATE>",
    "sdpMid": "0",
    "sdpMLineIndex": 0
  }
}
```

### WebRTC message sequence

```text
1. ESP32 connects:
   ws://.../api/device/hubs/control/ws
   with x-device-api-key, x-hub-mac-address, and x-hub-secret headers.

2. Backend validates:
   - device API key
   - hub MAC address
   - hub secret

3. App connects:
   ws://.../ws/live-feed?role=viewer&mode=webrtc&token=...&hubId=...

4. Backend validates:
   - user JWT
   - requested hub belongs to user

5. App sends:
   { "type": "viewer-ready" }

6. Backend forwards to ESP32:
   { "type": "viewer-ready", "hubId": "<HUB_ID>" }

7. ESP32 creates WebRTC peer connection:
   - attach camera video track
   - create SDP offer
   - set local description

8. ESP32 sends:
   { "type": "offer", "sdp": { "type": "offer", "sdp": "..." } }

9. Backend forwards offer to app.

10. App creates WebRTC peer connection:
    - set remote description from ESP32 offer
    - create answer
    - set local description

11. App sends:
    { "type": "answer", "sdp": { "type": "answer", "sdp": "..." } }

12. Backend forwards answer to ESP32.

13. ESP32 sets remote description from app answer.

14. Both sides exchange:
    { "type": "ice-candidate", "candidate": { ... } }

15. When ICE connects, app receives remote video track and displays it.
```

### ESP32 side responsibilities

The ESP32/hub firmware must:

- connect to Wi-Fi
- know its `hubMacAddress`
- store its `hubSecret` received during hub registration
- open one hub control WebSocket at `/api/device/hubs/control/ws`
- create a WebRTC peer connection when a viewer is ready
- capture the main door camera stream
- add the camera stream as a WebRTC video track
- send `offer` to backend
- receive `answer` from backend and set it as remote description
- exchange ICE candidates through the backend
- keep the WebSocket alive while the feed is active

Pseudo flow:

```text
connectWebSocket(deviceUrl)
wait for ready
wait for viewer-ready

pc = createPeerConnection(stunTurnConfig)
pc.addTrack(cameraVideoTrack)

pc.onIceCandidate = send { type: "ice-candidate", candidate }

offer = pc.createOffer()
pc.setLocalDescription(offer)
send { type: "offer", sdp: offer }

on message answer:
  pc.setRemoteDescription(answer)

on message ice-candidate:
  pc.addIceCandidate(candidate)
```

### Flutter app side behavior

The Flutter app already opens the live feed from the hub details camera icon.
Internally it:

- opens `role=viewer&mode=webrtc`
- creates an `RTCPeerConnection`
- sends `viewer-ready`
- waits for the ESP32 `offer`
- sets the offer as remote description
- creates and sends an `answer`
- exchanges ICE candidates
- renders the remote video track using `RTCVideoView`

### Signaling message directions

| Message | Sent by | Forwarded to | Purpose |
| --- | --- | --- | --- |
| `ready` | Backend | Device or app | Connection accepted |
| `viewer-ready` | App/backend | Device | Start camera offer |
| `offer` | ESP32 | App | Start WebRTC session |
| `answer` | App | ESP32 | Accept WebRTC session |
| `ice-candidate` | Both | Other peer | NAT traversal |
| `status` | Backend | App | Device live/offline state |
| `error` | Backend | Device or app | Auth/signaling failure |

The backend validates that:

- device publishers have the correct global device API key
- device publishers know the hub MAC address and hub secret
- mobile viewers own the requested hub

The backend relays signaling only. WebRTC media flows peer-to-peer when network
conditions allow it. For production across restrictive NATs, add a TURN server.

Recommended production ICE config:

```json
{
  "iceServers": [
    { "urls": "stun:stun.l.google.com:19302" },
    {
      "urls": "turn:turn.your-domain.com:3478",
      "username": "<TURN_USERNAME>",
      "credential": "<TURN_PASSWORD>"
    }
  ]
}
```

Without TURN, WebRTC may fail on some mobile networks, CGNAT, corporate Wi-Fi,
or symmetric NAT routers.

## ESP32 integration guide

This section is the firmware-side contract. All device APIs require:

- `X-Device-Api-Key: <DEVICE_API_KEY>`

After hub registration, all hub-owned APIs and the hub WebSocket also require:

- `X-Hub-Mac-Address: <HUB_MAC_ADDRESS>`
- `X-Hub-Secret: <HUB_DEVICE_SECRET>`

The hub must keep only one long-running WebSocket open:

```text
ws://localhost:3000/api/device/hubs/control/ws
```

Use `wss://your-domain.com/api/device/hubs/control/ws` in production.

That single socket is used for:

- door lock commands
- door lock ACKs
- camera start/stop commands
- WebRTC live-feed signaling
- camera stream status

### 1. First-time hub registration

The mobile app creates a setup session and sends the returned provisioning token
to the hub over BLE. After the hub connects to Wi-Fi, the hub calls:

```http
POST /api/device/hubs/register
X-Device-Api-Key: <DEVICE_API_KEY>
Content-Type: application/json
```

Request:

```json
{
  "hubMacAddress": "AA:BB:CC:DD:EE:FF",
  "provisioningToken": "<PROVISIONING_TOKEN_FROM_MOBILE_APP>"
}
```

Response:

```json
{
  "home": {
    "id": "<HOME_ID>",
    "name": "Skyline Apartment",
    "hub": {
      "id": "<HUB_ID>",
      "macAddress": "AA:BB:CC:DD:EE:FF"
    },
    "sensors": []
  },
  "hubSecret": "<STORE_THIS_SECRET_ON_ESP32>"
}
```

Firmware rule:

- Store `hubSecret` in NVS/flash securely.
- Use this `hubSecret` for every future hub API and WebSocket connection.
- If the hub loses the secret, it must be reprovisioned.

### 2. Open the hub control WebSocket

After registration, the hub should connect and keep this socket alive:

```text
ws://localhost:3000/api/device/hubs/control/ws
```

Headers:

```http
X-Device-Api-Key: <DEVICE_API_KEY>
X-Hub-Mac-Address: AA:BB:CC:DD:EE:FF
X-Hub-Secret: <HUB_DEVICE_SECRET>
```

On successful connection, backend sends:

```json
{
  "type": "ready"
}
```

Recommended hub behavior:

- reconnect automatically if disconnected
- send ACKs for commands received on this socket
- treat this as the only persistent hub WebSocket
- do not open a separate live-feed WebSocket as the hub
- handle cleanup commands for deleted sensors and deleted hubs

### 3. Door lock command handling

When user triggers door lock action from app, backend sends on the hub control
WebSocket:

```json
{
  "type": "door_lock_command",
  "commandId": "<COMMAND_ID>",
  "mode": "auto_lock",
  "action": "open",
  "durationMs": 3000
}
```

Possible `mode` values:

- `auto_lock`
- `toggle`

Possible `action` values:

- `open`
- `on`
- `off`

Hub should execute the command, then ACK:

```json
{
  "type": "door_lock_ack",
  "commandId": "<COMMAND_ID>",
  "status": "executed",
  "lockState": "locked"
}
```

Failure ACK:

```json
{
  "type": "door_lock_ack",
  "commandId": "<COMMAND_ID>",
  "status": "failed",
  "error": "Motor jammed"
}
```

Backend confirms ACK:

```json
{
  "type": "door_lock_ack_received",
  "commandId": "<COMMAND_ID>",
  "status": "executed"
}
```

### 4. Enable sensor pairing mode

When the physical hub pair button is pressed, call:

```http
POST /api/device/hubs/sensor-pairing-mode
X-Device-Api-Key: <DEVICE_API_KEY>
X-Hub-Mac-Address: AA:BB:CC:DD:EE:FF
X-Hub-Secret: <HUB_DEVICE_SECRET>
```

Response:

```json
{
  "sensorPairingSession": {
    "sensorPairingSessionId": "<SESSION_ID>",
    "hubId": "<HUB_ID>",
    "expiresAt": "2026-06-17T10:00:00.000Z"
  }
}
```

After this, the mobile app can scan a sensor QR and pair it to this hub.

The mobile app then connects to the sensor over BLE and sends:

```json
{
  "type": "sensor_pair",
  "hub_mac": "<HUB_MAC_ADDRESS>",
  "prov_key": "<SENSOR_PROVISION_KEY>"
}
```

The Flutter app writes this as UTF-8 JSON followed by `\n`. It may arrive in
multiple BLE chunks, so sensor firmware should append incoming bytes until it
receives newline, then parse the complete JSON object.

### 5. Fetch pending sensor provisioning

After the mobile app pairs a sensor, the hub can fetch the oldest pending sensor
provisioning payload:

```http
GET /api/device/hubs/pending-sensor
X-Device-Api-Key: <DEVICE_API_KEY>
X-Hub-Mac-Address: AA:BB:CC:DD:EE:FF
X-Hub-Secret: <HUB_DEVICE_SECRET>
```

Response:

```json
{
  "sensorMacAddress": "11:22:33:44:55:66",
  "provisionKey": "<ONE_TIME_SENSOR_PROVISION_KEY>"
}
```

Important:

- `provisionKey` is delivered once.
- Backend clears it after the hub fetches it.
- Hub should send the provisioning data to the sensor over the chosen local
  protocol, for example ESP-NOW.
- The sensor remains pending and hidden from app/hub sensor lists until the hub
  confirms that the sensor connected successfully.

### 6. Confirm sensor connected to hub

After the hub has formed the local connection with the sensor, confirm it:

```http
POST /api/device/hubs/sensors/confirm
X-Device-Api-Key: <DEVICE_API_KEY>
X-Hub-Mac-Address: AA:BB:CC:DD:EE:FF
X-Hub-Secret: <HUB_DEVICE_SECRET>
Content-Type: application/json
```

Request:

```json
{
  "sensorMacAddress": "11:22:33:44:55:66"
}
```

Response:

```json
{
  "paired": true,
  "sensor": {
    "sensorMacAddress": "11:22:33:44:55:66",
    "name": "Front Door Frame Sensor",
    "type": "contact",
    "zone": "Front Door Frame",
    "status": "paired"
  }
}
```

Only after this confirmation will the sensor appear in the mobile app and hub
sensor list. Sensor activity events are rejected until confirmation succeeds.

### 7. Fetch paired sensor list

The hub can fetch all paired sensors:

```http
GET /api/device/hubs/sensors
X-Device-Api-Key: <DEVICE_API_KEY>
X-Hub-Mac-Address: AA:BB:CC:DD:EE:FF
X-Hub-Secret: <HUB_DEVICE_SECRET>
```

Response:

```json
{
  "sensors": [
    {
      "sensorMacAddress": "11:22:33:44:55:66",
      "name": "Front Door Frame Sensor",
      "type": "contact",
      "zone": "Front Door Frame",
      "status": "paired"
    }
  ]
}
```

### 8. Toggle sensor active state

When a user toggles a sensor from the mobile app, the app calls:

```http
PATCH /api/homes/<HOME_ID>/sensors/<SENSOR_ID>/enabled
Authorization: Bearer <USER_JWT>
Content-Type: application/json
```

Request:

```json
{
  "enabled": false
}
```

If the hub control WebSocket is connected, backend sends this message to the
ESP32 hub:

```json
{
  "type": "sensor_toggle_command",
  "sensorMacAddress": "11:22:33:44:55:66",
  "enabled": false,
  "action": "disable"
}
```

For `"enabled": true`, `action` is `"enable"`.

ESP32 behavior must follow the same local ESP-NOW procedure as the hub UI:

- find the local sensor table entry by `sensorMacAddress`
- when disabling: save enabled=false in NVS, delete the ESP-NOW peer, mark the
  sensor unpaired/offline locally, and refresh the display
- when enabling: save enabled=true in NVS, re-add the encrypted ESP-NOW peer
  using the stored LMK/provision key, start HELLO retry/reconnect, and refresh
  the display

If `commandSent` is `false`, the backend accepted the request but the hub was
offline and did not receive the command.

### 9. Delete sensor

When a user deletes a sensor from the mobile app, the app calls:

```http
DELETE /api/homes/<HOME_ID>/sensors/<SENSOR_ID>
Authorization: Bearer <USER_JWT>
```

Response:

```json
{
  "deleted": true,
  "hubId": "<HUB_ID>",
  "hubMacAddress": "AA:BB:CC:DD:EE:FF",
  "sensorMacAddress": "11:22:33:44:55:66",
  "commandSent": true
}
```

If the hub control WebSocket is connected, backend sends this message to the
ESP32 hub:

```json
{
  "type": "sensor_delete_command",
  "sensorMacAddress": "11:22:33:44:55:66"
}
```

ESP32 behavior:

- remove this sensor MAC address from NVS/flash memory
- stop accepting ESP-NOW/local packets from this sensor
- remove any local encryption/provision keys for this sensor
- continue running normally

If `commandSent` is `false`, the sensor is still deleted from the backend, but
the hub was offline and did not receive the cleanup command.

### 10. Delete hub

When a user deletes a hub from the mobile app, the app calls:

```http
DELETE /api/homes/<HOME_ID>
Authorization: Bearer <USER_JWT>
```

Response:

```json
{
  "deleted": true,
  "hubId": "<HUB_ID>",
  "hubMacAddress": "AA:BB:CC:DD:EE:FF",
  "commandSent": true
}
```

If the hub control WebSocket is connected, backend sends this message to the
ESP32 hub:

```json
{
  "type": "hub_reset_command",
  "action": "format_and_reset",
  "reason": "hub_deleted",
  "hubMacAddress": "AA:BB:CC:DD:EE:FF"
}
```

ESP32 behavior:

- erase hub secret from NVS/flash
- erase Wi-Fi credentials if the firmware stores them for this product setup
- erase paired sensors and local provision keys
- clear camera/door-lock runtime state
- restart into factory provisioning mode

If `commandSent` is `false`, the hub/home is still deleted from the backend, but
the hub was offline and did not receive the reset command.

### 11. Send hub or sensor activity events

When the hub or a paired sensor detects activity, send the event on the already
open hub control WebSocket at `/api/device/hubs/control/ws`. Do not open a
second socket and do not call a separate endpoint for normal MVP alerts.

Generic event shape:

```json
{
  "type": "sensor_event",
  "sensorMacAddress": "11:22:33:44:55:66",
  "eventType": "door_opened",
  "payload": {
    "module": "magnetic_reed"
  }
}
```

The backend uses the authenticated socket headers (`x-hub-mac-address` and
`x-hub-secret`) as the hub identity, creates the activity log and notification,
then sends FCM push to the owner of that hub.

The backend replies on the same WebSocket:

```json
{
  "type": "hub_event_ack",
  "eventType": "door_opened",
  "notification": {
    "id": "<NOTIFICATION_ID>",
    "eventType": "door_opened",
    "severity": "critical"
  }
}
```

If the event cannot be stored, the backend replies:

```json
{
  "type": "hub_event_error",
  "eventType": "door_opened",
  "error": "Sensor not found for this hub"
}
```

The older REST endpoint is still available for manual testing:

```http
POST /api/device/hubs/events
X-Device-Api-Key: <DEVICE_API_KEY>
X-Hub-Mac-Address: AA:BB:CC:DD:EE:FF
X-Hub-Secret: <HUB_DEVICE_SECRET>
Content-Type: application/json
```

Hub-level event:

```json
{
  "eventType": "hub_online",
  "severity": "info",
  "payload": {
    "firmwareVersion": "1.0.0"
  }
}
```

Magnetic reed door-open WebSocket event:

```json
{
  "type": "sensor_event",
  "sensorMacAddress": "11:22:33:44:55:66",
  "eventType": "door_opened",
  "payload": {
    "module": "magnetic_reed",
    "reedState": "open",
    "batteryPercent": 91,
    "rssi": -58
  }
}
```

Shortcut form is also accepted:

```json
{
  "type": "door_opened",
  "sensorMacAddress": "11:22:33:44:55:66",
  "payload": {
    "module": "magnetic_reed",
    "reedState": "open"
  }
}
```

Vibration shock WebSocket event:

```json
{
  "type": "sensor_event",
  "sensorMacAddress": "11:22:33:44:55:66",
  "eventType": "shock_detected",
  "payload": {
    "module": "vibration",
    "shockFound": true,
    "batteryPercent": 91,
    "rssi": -58
  }
}
```

Shortcut form is also accepted:

```json
{
  "type": "shock_detected",
  "sensorMacAddress": "11:22:33:44:55:66",
  "payload": {
    "module": "vibration",
    "shockFound": true
  }
}
```

Both `door_opened` and `shock_detected` default to `critical` severity and
create realtime mobile app notifications. The hub may still send an explicit
`severity` if firmware wants to override the default.

Response:

```json
{
  "activityLogId": "<ACTIVITY_LOG_ID>",
  "notification": {
    "id": "<NOTIFICATION_ID>",
    "eventType": "door_opened",
    "severity": "critical"
  }
}
```

### 12. Camera control command

When the first mobile viewer opens the camera stream, backend sends this on the
same hub control WebSocket:

```json
{
  "type": "camera_stream_command",
  "action": "start",
  "streamSessionId": "<STREAM_SESSION_ID>"
}
```

When the last viewer leaves, backend sends:

```json
{
  "type": "camera_stream_command",
  "action": "stop",
  "streamSessionId": "<STREAM_SESSION_ID>"
}
```

Hub should report camera status on the same socket:

```json
{
  "type": "camera_stream_status",
  "streamSessionId": "<STREAM_SESSION_ID>",
  "status": "started"
}
```

Failure example:

```json
{
  "type": "camera_stream_status",
  "streamSessionId": "<STREAM_SESSION_ID>",
  "status": "failed",
  "error": "Camera init failed"
}
```

### 9. WebRTC live-feed signaling

The hub sends and receives WebRTC signaling on the same hub control WebSocket.

When app viewer is ready, backend sends to hub:

```json
{
  "type": "viewer-ready",
  "hubId": "<HUB_ID>"
}
```

Hub should create a WebRTC peer connection, attach the camera track, create an
offer, set it as local description, then send:

```json
{
  "type": "offer",
  "sdp": {
    "type": "offer",
    "sdp": "<DEVICE_SDP>"
  }
}
```

App answers through backend. Hub receives:

```json
{
  "type": "answer",
  "hubId": "<HUB_ID>",
  "sdp": {
    "type": "answer",
    "sdp": "<MOBILE_SDP>"
  }
}
```

Both sides exchange ICE candidates.

Hub sends:

```json
{
  "type": "ice-candidate",
  "candidate": {
    "candidate": "candidate:...",
    "sdpMid": "0",
    "sdpMLineIndex": 0
  }
}
```

Hub receives:

```json
{
  "type": "ice-candidate",
  "hubId": "<HUB_ID>",
  "candidate": {
    "candidate": "candidate:...",
    "sdpMid": "0",
    "sdpMLineIndex": 0
  }
}
```

### 10. Legacy JPEG camera frame upload

For simple MJPEG fallback or diagnostics, the hub can upload individual JPEG
frames over HTTP:

```http
POST /api/device/hubs/camera/frame
X-Device-Api-Key: <DEVICE_API_KEY>
X-Hub-Mac-Address: AA:BB:CC:DD:EE:FF
X-Hub-Secret: <HUB_DEVICE_SECRET>
Content-Type: image/jpeg

<raw jpeg bytes>
```

Response:

```json
{
  "accepted": true,
  "bytes": 8421,
  "capturedAt": "2026-06-17T10:00:00.000Z"
}
```

This endpoint is not the preferred low-latency live feed path. Use WebRTC for
main-door live video.

### ESP32 startup checklist

On every boot:

1. Load Wi-Fi credentials.
2. Connect to Wi-Fi.
3. Load `hubMacAddress` and `hubSecret`.
4. If no `hubSecret`, start BLE provisioning flow.
5. Connect to `/api/device/hubs/control/ws`.
6. Wait for `{ "type": "ready" }`.
7. Process socket messages forever:
   - `door_lock_command`
   - `sensor_toggle_command`
   - `sensor_delete_command`
   - `hub_reset_command`
   - `camera_stream_command`
   - `viewer-ready`
   - `answer`
   - `ice-candidate`
8. Send `sensor_event`, `door_opened`, or `shock_detected` messages on the
   same WebSocket for hub/sensor activity.
9. Reconnect the WebSocket if it closes.

## End-to-end summary

1. User logs in.
2. User starts adding a home in the mobile app.
3. App connects to the hub over BLE.
4. App sends Wi-Fi SSID, password, and backend provisioning token to the hub over BLE.
5. Hub connects to Wi-Fi.
6. Hub calls backend registration API and gets attached to the user’s home.
7. User presses the hub pair button to enable sensor pairing mode.
8. User scans a door/window sensor QR in the app.
9. App sends the sensor MAC to backend for that home.
10. Backend returns hub MAC and sensor MAC provisioning payload.
11. Hub sends activity events to backend.
12. Backend creates logs and notifications.
13. ESP32 camera and Flutter app exchange WebRTC signaling through backend.
14. Mobile app shows live and historical alerts plus the main door live feed.

## Main persisted collections

- `User`
- `Home`
- `Hub`
- `Sensor`
- `HubSetupSession`
- `SensorPairingSession`
- `ActivityLog`
- `Notification`
