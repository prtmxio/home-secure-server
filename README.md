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
```

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

Example:

```bash
curl -X POST http://localhost:3000/api/device/hubs/events \
  -H "X-Device-Api-Key: <DEVICE_API_KEY>" \
  -H "X-Hub-Mac-Address: AA:BB:CC:DD:EE:FF" \
  -H "X-Hub-Secret: <HUB_DEVICE_SECRET>" \
  -H "Content-Type: application/json" \
  -d '{
    "sensorMacAddress":"11:22:33:44:55:66",
    "eventType":"motion_detected",
    "severity":"critical",
    "payload":{
      "humidity":54,
      "co2Ppm":610
    }
  }'
```

The backend:

- validates hub credentials
- finds the home hub
- finds the sensor under that hub
- stores an activity log
- creates a user notification

## Step 12. Mobile app receives notifications

For history:

- `GET /api/notifications`

For real-time stream:

- `GET /api/notifications/stream`

To mark read:

- `PATCH /api/notifications/:notificationId/read`

This allows the app to show:

- live alerts when a door or window sensor is triggered
- previous notifications
- read/unread state

## Step 13. ESP32 streams main door live feed with WebRTC

The hub or ESP32 camera sends the actual camera media over WebRTC. The backend
does not relay video frames. It only authenticates both sides and relays WebRTC
signaling messages over WebSocket.

This is the intended flow:

```text
ESP32 camera/hub
  -> WebSocket signaling
  -> Backend auth + signaling relay
  -> WebSocket signaling
  -> Flutter app

ESP32 camera/hub
  -> WebRTC media track
  -> Flutter app
```

The WebSocket is only for signaling. The camera video itself should travel as
WebRTC media.

Signaling WebSocket endpoint:

- `ws://localhost:3000/ws/live-feed`
- `wss://your-domain.com/ws/live-feed` in production behind TLS

Device signaling query params:

- `role=device`
- `mode=webrtc`
- `deviceApiKey=<DEVICE_API_KEY>`
- `hubMacAddress=<HUB_MAC_ADDRESS>`
- `hubSecret=<HUB_DEVICE_SECRET>`

Example device URL:

```text
ws://localhost:3000/ws/live-feed?role=device&mode=webrtc&deviceApiKey=<DEVICE_API_KEY>&hubMacAddress=AA:BB:CC:DD:EE:FF&hubSecret=<HUB_DEVICE_SECRET>
```

When the ESP32 connects successfully, the backend returns:

```json
{
  "type": "ready",
  "role": "device",
  "hubId": "<HUB_ID>",
  "mode": "webrtc"
}
```

If a mobile viewer is already waiting, the backend also sends:

```json
{
  "type": "viewer-ready",
  "hubId": "<HUB_ID>"
}
```

The ESP32 should start its WebRTC offer when it receives `viewer-ready`, or when
it already knows the camera screen is being opened by the app.

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
   ws://.../ws/live-feed?role=device&mode=webrtc&deviceApiKey=...&hubMacAddress=...&hubSecret=...

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
- open the signaling WebSocket as `role=device&mode=webrtc`
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
