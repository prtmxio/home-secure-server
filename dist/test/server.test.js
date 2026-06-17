"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const http_1 = __importDefault(require("http"));
const events_1 = require("events");
const mongoose_1 = __importDefault(require("mongoose"));
const mongodb_memory_server_1 = require("mongodb-memory-server");
const supertest_1 = __importDefault(require("supertest"));
const ws_1 = __importDefault(require("ws"));
const app_1 = require("../src/app");
const database_1 = require("../src/config/database");
const hub_control_ws_1 = require("../src/modules/device-control/hub-control-ws");
const hub_model_1 = require("../src/modules/hubs/hub.model");
const live_feed_server_1 = require("../src/modules/live-feed/live-feed.server");
let mongoServer;
let app;
let realtimeServices;
let httpServer;
let httpServerUrl;
let testConfig;
node_test_1.default.before(async () => {
    mongoServer = await mongodb_memory_server_1.MongoMemoryServer.create();
    await (0, database_1.connectDatabase)(mongoServer.getUri());
    testConfig = {
        nodeEnv: "test",
        port: 0,
        mongodbUri: mongoServer.getUri(),
        jwtSecret: "test-secret",
        jwtExpiresIn: "1d",
        deviceApiKey: "device-test-key",
        pairingSessionTtlSeconds: 60,
        projectRoot: process.cwd(),
    };
    realtimeServices = (0, app_1.createRealtimeServices)();
    app = (0, app_1.createApp)(testConfig, realtimeServices);
    httpServer = http_1.default.createServer(app);
    (0, hub_control_ws_1.attachHubControlWebSocket)(httpServer, testConfig, realtimeServices.doorLockService);
    (0, live_feed_server_1.attachLiveFeedServer)(httpServer, testConfig, {
        isDeviceConnected: hub_control_ws_1.isHubControlConnected,
        sendToDevice: hub_control_ws_1.sendLiveFeedSignalToHub,
    });
    httpServer.listen(0, "127.0.0.1");
    await (0, events_1.once)(httpServer, "listening");
    const address = httpServer.address();
    strict_1.default.ok(address && typeof address === "object");
    httpServerUrl = `http://127.0.0.1:${address.port}`;
});
node_test_1.default.after(async () => {
    httpServer.close();
    await (0, events_1.once)(httpServer, "close");
    await (0, database_1.disconnectDatabase)();
    await mongoServer.stop();
});
node_test_1.default.afterEach(async () => {
    const collections = mongoose_1.default.connection.collections;
    for (const name of Object.keys(collections)) {
        await collections[name].deleteMany({});
    }
});
(0, node_test_1.default)("user can onboard a hub over BLE setup, pair a door sensor through the hub pairing window, and receive notifications", async () => {
    const registerResponse = await (0, supertest_1.default)(app).post("/api/auth/register").send({
        name: "Riya",
        email: "riya@example.com",
        password: "secret123",
    });
    strict_1.default.equal(registerResponse.status, 201);
    const loginResponse = await (0, supertest_1.default)(app).post("/api/auth/login").send({
        email: "riya@example.com",
        password: "secret123",
    });
    strict_1.default.equal(loginResponse.status, 200);
    const token = loginResponse.body.token;
    strict_1.default.ok(token);
    const setupResponse = await (0, supertest_1.default)(app)
        .post("/api/homes/setup-hub")
        .set("Authorization", `Bearer ${token}`)
        .send({
        hubMacAddress: "AA:BB:CC:DD:EE:FF",
        homeName: "Riya Apartment",
        location: "Tower 2, Flat 904",
    });
    strict_1.default.equal(setupResponse.status, 201);
    strict_1.default.equal(setupResponse.body.setupSession.hubMacAddress, "AA:BB:CC:DD:EE:FF");
    const hubRegisterResponse = await (0, supertest_1.default)(app)
        .post("/api/device/hubs/register")
        .set("x-device-api-key", "device-test-key")
        .send({
        hubMacAddress: "AA:BB:CC:DD:EE:FF",
        provisioningToken: setupResponse.body.setupSession.provisioningToken,
    });
    strict_1.default.equal(hubRegisterResponse.status, 201);
    const homeId = hubRegisterResponse.body.home.id;
    const hubId = hubRegisterResponse.body.home.hub.id;
    const homesResponse = await (0, supertest_1.default)(app)
        .get("/api/homes")
        .set("Authorization", `Bearer ${token}`);
    strict_1.default.equal(homesResponse.status, 200);
    strict_1.default.equal(homesResponse.body.homes.length, 1);
    const currentHub = await hub_model_1.HubModel.findOne({ macAddress: "AA:BB:CC:DD:EE:FF" });
    strict_1.default.ok(currentHub);
    const finalSensorPairingResponse = await (0, supertest_1.default)(app)
        .post("/api/device/hubs/sensor-pairing-mode")
        .set("x-device-api-key", "device-test-key")
        .set("x-hub-mac-address", "AA:BB:CC:DD:EE:FF")
        .set("x-hub-secret", currentHub.deviceSecret);
    strict_1.default.equal(finalSensorPairingResponse.status, 201);
    const sensorClaimResponse = await (0, supertest_1.default)(app)
        .post(`/api/homes/${homeId}/sensors/pair`)
        .set("Authorization", `Bearer ${token}`)
        .send({
        sensorMacAddress: "11:22:33:44:55:66",
        name: "Front Door Frame Sensor",
        type: "contact",
        zone: "Front Door Frame",
    });
    strict_1.default.equal(sensorClaimResponse.status, 201);
    strict_1.default.equal(sensorClaimResponse.body.provisioning.sensor.targetHubMacAddress, "AA:BB:CC:DD:EE:FF");
    const finalEventResponse = await (0, supertest_1.default)(app)
        .post("/api/device/hubs/events")
        .set("x-device-api-key", "device-test-key")
        .set("x-hub-mac-address", "AA:BB:CC:DD:EE:FF")
        .set("x-hub-secret", currentHub.deviceSecret)
        .send({
        sensorMacAddress: "11:22:33:44:55:66",
        eventType: "motion_detected",
        severity: "critical",
        payload: {
            co2Ppm: 610,
            humidity: 54,
        },
    });
    strict_1.default.equal(finalEventResponse.status, 201);
    strict_1.default.equal(finalEventResponse.body.notification.eventType, "motion_detected");
    const homeDetailsResponse = await (0, supertest_1.default)(app)
        .get(`/api/homes/${homeId}`)
        .set("Authorization", `Bearer ${token}`);
    strict_1.default.equal(homeDetailsResponse.status, 200);
    strict_1.default.equal(homeDetailsResponse.body.home.hub.id, hubId);
    strict_1.default.equal(homeDetailsResponse.body.home.sensors.length, 1);
    const notificationsResponse = await (0, supertest_1.default)(app)
        .get("/api/notifications")
        .set("Authorization", `Bearer ${token}`);
    strict_1.default.equal(notificationsResponse.status, 200);
    strict_1.default.equal(notificationsResponse.body.notifications.length, 1);
    strict_1.default.equal(notificationsResponse.body.notifications[0].severity, "critical");
});
(0, node_test_1.default)("otp flow registers first-time users and authenticates existing users", async () => {
    const requestOtpResponse = await (0, supertest_1.default)(app).post("/api/auth/otp/request").send({
        phoneNumber: "+919999999999",
    });
    strict_1.default.equal(requestOtpResponse.status, 200);
    strict_1.default.equal(requestOtpResponse.body.otp, "123456");
    const firstVerifyResponse = await (0, supertest_1.default)(app).post("/api/auth/otp/verify").send({
        phoneNumber: "+919999999999",
        otp: "123456",
    });
    strict_1.default.equal(firstVerifyResponse.status, 200);
    strict_1.default.equal(firstVerifyResponse.body.status, "registration_required");
    strict_1.default.ok(firstVerifyResponse.body.otpSessionId);
    const completeResponse = await (0, supertest_1.default)(app).post("/api/auth/otp/register").send({
        otpSessionId: firstVerifyResponse.body.otpSessionId,
        name: "ABC User",
        email: "abc@gmail.com",
        phoneNumber: "+919999999999",
    });
    strict_1.default.equal(completeResponse.status, 201);
    strict_1.default.ok(completeResponse.body.token);
    strict_1.default.equal(completeResponse.body.user.email, "abc@gmail.com");
    await (0, supertest_1.default)(app).post("/api/auth/otp/request").send({
        phoneNumber: "+919999999999",
    });
    const secondVerifyResponse = await (0, supertest_1.default)(app).post("/api/auth/otp/verify").send({
        phoneNumber: "+919999999999",
        otp: "123456",
    });
    strict_1.default.equal(secondVerifyResponse.status, 200);
    strict_1.default.equal(secondVerifyResponse.body.status, "authenticated");
    strict_1.default.ok(secondVerifyResponse.body.token);
});
(0, node_test_1.default)("hub can upload camera frames and user can mint a short-lived stream token", async () => {
    const { token, homeId, hubSecret } = await onboardHub("Camera User", "camera@example.com", "AA:BB:CC:DD:EE:10");
    const frame = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0xff, 0xd9]);
    const uploadResponse = await (0, supertest_1.default)(app)
        .post("/api/device/hubs/camera/frame")
        .set("x-device-api-key", "device-test-key")
        .set("x-hub-mac-address", "AA:BB:CC:DD:EE:10")
        .set("x-hub-secret", hubSecret)
        .set("Content-Type", "image/jpeg")
        .send(frame);
    strict_1.default.equal(uploadResponse.status, 202);
    strict_1.default.equal(uploadResponse.body.accepted, true);
    strict_1.default.equal(uploadResponse.body.bytes, frame.length);
    const tokenResponse = await (0, supertest_1.default)(app)
        .post(`/api/homes/${homeId}/camera/stream-token`)
        .set("Authorization", `Bearer ${token}`);
    strict_1.default.equal(tokenResponse.status, 201);
    strict_1.default.match(tokenResponse.body.streamPath, /^\/api\/camera\/streams\//);
    const deniedUpload = await (0, supertest_1.default)(app)
        .post("/api/device/hubs/camera/frame")
        .set("x-device-api-key", "device-test-key")
        .set("x-hub-mac-address", "AA:BB:CC:DD:EE:10")
        .set("x-hub-secret", "wrong")
        .set("Content-Type", "image/jpeg")
        .send(frame);
    strict_1.default.equal(deniedUpload.status, 401);
});
(0, node_test_1.default)("user lock command is pushed to the hub over WebSocket and ACK updates status", async () => {
    const { token, homeId, hubSecret } = await onboardHub("Lock User", "lock@example.com", "AA:BB:CC:DD:EE:20");
    const ws = openHubControlSocket("AA:BB:CC:DD:EE:20", hubSecret);
    try {
        await waitWsOpen(ws);
        const commandPromise = nextWsJsonOfType(ws, "door_lock_command");
        const commandResponse = await (0, supertest_1.default)(app)
            .post(`/api/homes/${homeId}/door-lock/open`)
            .set("Authorization", `Bearer ${token}`);
        strict_1.default.equal(commandResponse.status, 201);
        const command = await commandPromise;
        strict_1.default.equal(command.type, "door_lock_command");
        strict_1.default.equal(command.mode, "auto_lock");
        strict_1.default.equal(command.action, "open");
        strict_1.default.equal(command.durationMs, 3000);
        const ackPromise = nextWsJsonOfType(ws, "door_lock_ack_received");
        ws.send(JSON.stringify({
            type: "door_lock_ack",
            commandId: command.commandId,
            status: "executed",
            lockState: "locked",
        }));
        const ack = await ackPromise;
        strict_1.default.equal(ack.type, "door_lock_ack_received");
        strict_1.default.equal(ack.status, "executed");
        const lockResponse = await (0, supertest_1.default)(app)
            .get(`/api/homes/${homeId}/door-lock`)
            .set("Authorization", `Bearer ${token}`);
        strict_1.default.equal(lockResponse.status, 200);
        strict_1.default.equal(lockResponse.body.command.status, "executed");
        strict_1.default.equal(lockResponse.body.command.lockState, "locked");
    }
    finally {
        ws.close();
    }
});
(0, node_test_1.default)("door lock toggle rejects unsafe durations", async () => {
    const { token, homeId } = await onboardHub("Limit User", "limit@example.com", "AA:BB:CC:DD:EE:30");
    const response = await (0, supertest_1.default)(app)
        .post(`/api/homes/${homeId}/door-lock/toggle`)
        .set("Authorization", `Bearer ${token}`)
        .send({ state: "on", durationMs: 10001 });
    strict_1.default.equal(response.status, 400);
});
(0, node_test_1.default)("webRTC live feed signaling uses the existing hub control WebSocket", async () => {
    const { token, hubId, hubSecret } = await onboardHub("Door Viewer", "door-viewer@example.com", "AA:BB:CC:DD:EE:01");
    const hubWs = openHubControlSocket("AA:BB:CC:DD:EE:01", hubSecret);
    const viewerWs = new ws_1.default(`${httpServerUrl.replace("http://", "ws://")}/ws/live-feed?role=viewer&mode=webrtc&token=${token}&hubId=${hubId}`);
    try {
        await waitWsOpen(hubWs);
        await waitWsOpen(viewerWs);
        const viewerReady = await nextWsJsonOfType(viewerWs, "ready");
        strict_1.default.equal(viewerReady.role, "viewer");
        strict_1.default.equal(viewerReady.mode, "webrtc");
        strict_1.default.equal(viewerReady.status, "live");
        viewerWs.send(JSON.stringify({ type: "viewer-ready" }));
        const viewerReadyForHub = await nextWsJsonOfType(hubWs, "viewer-ready");
        strict_1.default.equal(viewerReadyForHub.hubId, hubId);
        hubWs.send(JSON.stringify({
            type: "offer",
            sdp: { type: "offer", sdp: "device-offer-sdp" },
        }));
        const offer = await nextWsJsonOfType(viewerWs, "offer");
        strict_1.default.equal(offer.hubId, hubId);
        strict_1.default.deepEqual(offer.sdp, { type: "offer", sdp: "device-offer-sdp" });
        viewerWs.send(JSON.stringify({
            type: "answer",
            sdp: { type: "answer", sdp: "mobile-answer-sdp" },
        }));
        const answer = await nextWsJsonOfType(hubWs, "answer");
        strict_1.default.equal(answer.hubId, hubId);
        strict_1.default.deepEqual(answer.sdp, { type: "answer", sdp: "mobile-answer-sdp" });
    }
    finally {
        viewerWs.close();
        hubWs.close();
    }
});
async function onboardHub(name, email, hubMacAddress) {
    const registerResponse = await (0, supertest_1.default)(app).post("/api/auth/register").send({
        name,
        email,
        password: "secret123",
    });
    strict_1.default.equal(registerResponse.status, 201);
    const loginResponse = await (0, supertest_1.default)(app).post("/api/auth/login").send({
        email,
        password: "secret123",
    });
    strict_1.default.equal(loginResponse.status, 200);
    const token = loginResponse.body.token;
    const setupResponse = await (0, supertest_1.default)(app)
        .post("/api/homes/setup-hub")
        .set("Authorization", `Bearer ${token}`)
        .send({
        hubMacAddress,
        homeName: `${name} Home`,
        location: "Test",
    });
    strict_1.default.equal(setupResponse.status, 201);
    const hubRegisterResponse = await (0, supertest_1.default)(app)
        .post("/api/device/hubs/register")
        .set("x-device-api-key", "device-test-key")
        .send({
        hubMacAddress,
        provisioningToken: setupResponse.body.setupSession.provisioningToken,
    });
    strict_1.default.equal(hubRegisterResponse.status, 201);
    const hub = await hub_model_1.HubModel.findOne({ macAddress: hubMacAddress });
    strict_1.default.ok(hub);
    return {
        token,
        homeId: hubRegisterResponse.body.home.id,
        hubId: hub.id,
        hubSecret: hub.deviceSecret,
    };
}
function openHubControlSocket(hubMacAddress, hubSecret) {
    return new ws_1.default(`${httpServerUrl.replace("http://", "ws://")}/api/device/hubs/control/ws`, {
        headers: {
            "x-device-api-key": "device-test-key",
            "x-hub-mac-address": hubMacAddress,
            "x-hub-secret": hubSecret,
        },
    });
}
async function nextWsJson(ws) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            cleanup();
            reject(new Error("Timed out waiting for WebSocket message"));
        }, 5000);
        const onMessage = (data) => {
            cleanup();
            resolve(JSON.parse(data.toString()));
        };
        const onError = (error) => {
            cleanup();
            reject(error);
        };
        const onClose = (code, reason) => {
            cleanup();
            reject(new Error(`WebSocket closed before message: ${code} ${reason.toString()}`));
        };
        const cleanup = () => {
            clearTimeout(timeout);
            ws.off("message", onMessage);
            ws.off("error", onError);
            ws.off("close", onClose);
        };
        ws.once("message", onMessage);
        ws.once("error", onError);
        ws.once("close", onClose);
    });
}
async function nextWsJsonOfType(ws, type) {
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline) {
        const message = await nextWsJson(ws);
        if (message.type === type) {
            return message;
        }
    }
    throw new Error(`Timed out waiting for WebSocket message type ${type}`);
}
async function waitWsOpen(ws) {
    if (ws.readyState === ws_1.default.OPEN)
        return;
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => {
            cleanup();
            reject(new Error(`Timed out waiting for WebSocket open; state=${ws.readyState}`));
        }, 5000);
        const onOpen = () => {
            cleanup();
            resolve();
        };
        const onError = (error) => {
            cleanup();
            reject(error);
        };
        const onClose = (code, reason) => {
            cleanup();
            reject(new Error(`WebSocket closed before open: ${code} ${reason.toString()}`));
        };
        const cleanup = () => {
            clearTimeout(timeout);
            ws.off("open", onOpen);
            ws.off("error", onError);
            ws.off("close", onClose);
        };
        ws.once("open", onOpen);
        ws.once("error", onError);
        ws.once("close", onClose);
    });
}
