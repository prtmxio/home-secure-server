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
13. Mobile app shows live and historical alerts.

## Main persisted collections

- `User`
- `Home`
- `Hub`
- `Sensor`
- `HubSetupSession`
- `SensorPairingSession`
- `ActivityLog`
- `Notification`
