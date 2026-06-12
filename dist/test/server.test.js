"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const node_test_1 = __importDefault(require("node:test"));
const strict_1 = __importDefault(require("node:assert/strict"));
const node_http_1 = require("node:http");
const mongoose_1 = __importDefault(require("mongoose"));
const mongodb_memory_server_1 = require("mongodb-memory-server");
const supertest_1 = __importDefault(require("supertest"));
const ws_1 = __importDefault(require("ws"));
const app_1 = require("../src/app");
const database_1 = require("../src/config/database");
const hub_model_1 = require("../src/modules/hubs/hub.model");
const live_feed_server_1 = require("../src/modules/live-feed/live-feed.server");
let mongoServer;
let app;
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
    app = (0, app_1.createApp)(testConfig);
});
node_test_1.default.after(async () => {
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
(0, node_test_1.default)("esp32 and mobile viewer can exchange WebRTC signaling for the main door feed", async () => {
    const registerResponse = await (0, supertest_1.default)(app).post("/api/auth/register").send({
        name: "Door Viewer",
        email: "door-viewer@example.com",
        password: "secret123",
    });
    strict_1.default.equal(registerResponse.status, 201);
    const loginResponse = await (0, supertest_1.default)(app).post("/api/auth/login").send({
        email: "door-viewer@example.com",
        password: "secret123",
    });
    strict_1.default.equal(loginResponse.status, 200);
    const token = loginResponse.body.token;
    const setupResponse = await (0, supertest_1.default)(app)
        .post("/api/homes/setup-hub")
        .set("Authorization", `Bearer ${token}`)
        .send({
        hubMacAddress: "AA:BB:CC:DD:EE:01",
        homeName: "Door Home",
        location: "Front Door",
    });
    strict_1.default.equal(setupResponse.status, 201);
    const hubRegisterResponse = await (0, supertest_1.default)(app)
        .post("/api/device/hubs/register")
        .set("x-device-api-key", "device-test-key")
        .send({
        hubMacAddress: "AA:BB:CC:DD:EE:01",
        provisioningToken: setupResponse.body.setupSession.provisioningToken,
    });
    strict_1.default.equal(hubRegisterResponse.status, 201);
    const hub = await hub_model_1.HubModel.findOne({ macAddress: "AA:BB:CC:DD:EE:01" });
    strict_1.default.ok(hub);
    const server = (0, node_http_1.createServer)(app);
    (0, live_feed_server_1.attachLiveFeedServer)(server, testConfig);
    await new Promise((resolve) => server.listen(0, resolve));
    const address = server.address();
    const wsBaseUrl = `ws://127.0.0.1:${address.port}/ws/live-feed`;
    const viewer = new ws_1.default(`${wsBaseUrl}?role=viewer&mode=webrtc&token=${token}&hubId=${hub.id}`);
    const device = new ws_1.default(`${wsBaseUrl}?role=device&mode=webrtc&deviceApiKey=device-test-key&hubMacAddress=AA:BB:CC:DD:EE:01&hubSecret=${hub.deviceSecret}`);
    try {
        const viewerReady = await nextJsonMessage(viewer);
        strict_1.default.equal(viewerReady.type, "ready");
        strict_1.default.equal(viewerReady.role, "viewer");
        strict_1.default.equal(viewerReady.mode, "webrtc");
        const deviceReady = await nextJsonMessage(device);
        strict_1.default.equal(deviceReady.type, "ready");
        strict_1.default.equal(deviceReady.role, "device");
        strict_1.default.equal(deviceReady.mode, "webrtc");
        viewer.send(JSON.stringify({ type: "viewer-ready" }));
        const viewerReadyForDevice = await nextJsonMessage(device, "viewer-ready");
        strict_1.default.equal(viewerReadyForDevice.hubId, hub.id);
        device.send(JSON.stringify({
            type: "offer",
            sdp: { type: "offer", sdp: "device-offer-sdp" },
        }));
        const offer = await nextJsonMessage(viewer, "offer");
        strict_1.default.equal(offer.hubId, hub.id);
        strict_1.default.deepEqual(offer.sdp, { type: "offer", sdp: "device-offer-sdp" });
        viewer.send(JSON.stringify({
            type: "answer",
            sdp: { type: "answer", sdp: "mobile-answer-sdp" },
        }));
        const answer = await nextJsonMessage(device, "answer");
        strict_1.default.equal(answer.hubId, hub.id);
        strict_1.default.deepEqual(answer.sdp, { type: "answer", sdp: "mobile-answer-sdp" });
    }
    finally {
        viewer.close();
        device.close();
        await new Promise((resolve) => server.close(() => resolve()));
    }
});
function nextJsonMessage(socket, expectedType) {
    return new Promise((resolve, reject) => {
        const timeout = setTimeout(() => reject(new Error("Timed out waiting for WebSocket message")), 2000);
        const onMessage = (data) => {
            const message = JSON.parse(data.toString());
            if (expectedType && message.type !== expectedType) {
                socket.once("message", onMessage);
                return;
            }
            clearTimeout(timeout);
            socket.off("error", onError);
            resolve(message);
        };
        const onError = (error) => {
            clearTimeout(timeout);
            socket.off("message", onMessage);
            reject(error);
        };
        socket.once("message", onMessage);
        socket.once("error", onError);
    });
}
