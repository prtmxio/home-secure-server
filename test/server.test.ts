import test from "node:test";
import assert from "node:assert/strict";
import { AddressInfo } from "node:net";
import { createServer } from "node:http";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import WebSocket from "ws";
import { createApp } from "../src/app";
import { connectDatabase, disconnectDatabase } from "../src/config/database";
import { AppConfig } from "../src/config/env";
import { HubModel } from "../src/modules/hubs/hub.model";
import { attachLiveFeedServer } from "../src/modules/live-feed/live-feed.server";

let mongoServer: MongoMemoryServer;
let app: ReturnType<typeof createApp>;
let testConfig: AppConfig;

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await connectDatabase(mongoServer.getUri());
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
  app = createApp(testConfig);
});

test.after(async () => {
  await disconnectDatabase();
  await mongoServer.stop();
});

test.afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const name of Object.keys(collections)) {
    await collections[name].deleteMany({});
  }
});

test("user can onboard a hub over BLE setup, pair a door sensor through the hub pairing window, and receive notifications", async () => {
  const registerResponse = await request(app).post("/api/auth/register").send({
    name: "Riya",
    email: "riya@example.com",
    password: "secret123",
  });
  assert.equal(registerResponse.status, 201);

  const loginResponse = await request(app).post("/api/auth/login").send({
    email: "riya@example.com",
    password: "secret123",
  });
  assert.equal(loginResponse.status, 200);
  const token = loginResponse.body.token as string;
  assert.ok(token);

  const setupResponse = await request(app)
    .post("/api/homes/setup-hub")
    .set("Authorization", `Bearer ${token}`)
    .send({
      hubMacAddress: "AA:BB:CC:DD:EE:FF",
      homeName: "Riya Apartment",
      location: "Tower 2, Flat 904",
    });
  assert.equal(setupResponse.status, 201);
  assert.equal(setupResponse.body.setupSession.hubMacAddress, "AA:BB:CC:DD:EE:FF");

  const hubRegisterResponse = await request(app)
    .post("/api/device/hubs/register")
    .set("x-device-api-key", "device-test-key")
    .send({
      hubMacAddress: "AA:BB:CC:DD:EE:FF",
      provisioningToken: setupResponse.body.setupSession.provisioningToken,
    });
  assert.equal(hubRegisterResponse.status, 201);
  const homeId = hubRegisterResponse.body.home.id as string;
  const hubId = hubRegisterResponse.body.home.hub.id as string;

  const homesResponse = await request(app)
    .get("/api/homes")
    .set("Authorization", `Bearer ${token}`);
  assert.equal(homesResponse.status, 200);
  assert.equal(homesResponse.body.homes.length, 1);

  const currentHub = await HubModel.findOne({ macAddress: "AA:BB:CC:DD:EE:FF" });
  assert.ok(currentHub);

  const finalSensorPairingResponse = await request(app)
    .post("/api/device/hubs/sensor-pairing-mode")
    .set("x-device-api-key", "device-test-key")
    .set("x-hub-mac-address", "AA:BB:CC:DD:EE:FF")
    .set("x-hub-secret", currentHub!.deviceSecret);
  assert.equal(finalSensorPairingResponse.status, 201);

  const sensorClaimResponse = await request(app)
    .post(`/api/homes/${homeId}/sensors/pair`)
    .set("Authorization", `Bearer ${token}`)
    .send({
      sensorMacAddress: "11:22:33:44:55:66",
      name: "Front Door Frame Sensor",
      type: "contact",
      zone: "Front Door Frame",
    });
  assert.equal(sensorClaimResponse.status, 201);
  assert.equal(sensorClaimResponse.body.provisioning.sensor.targetHubMacAddress, "AA:BB:CC:DD:EE:FF");

  const finalEventResponse = await request(app)
    .post("/api/device/hubs/events")
    .set("x-device-api-key", "device-test-key")
    .set("x-hub-mac-address", "AA:BB:CC:DD:EE:FF")
    .set("x-hub-secret", currentHub!.deviceSecret)
    .send({
      sensorMacAddress: "11:22:33:44:55:66",
      eventType: "motion_detected",
      severity: "critical",
      payload: {
        co2Ppm: 610,
        humidity: 54,
      },
    });
  assert.equal(finalEventResponse.status, 201);
  assert.equal(finalEventResponse.body.notification.eventType, "motion_detected");

  const homeDetailsResponse = await request(app)
    .get(`/api/homes/${homeId}`)
    .set("Authorization", `Bearer ${token}`);
  assert.equal(homeDetailsResponse.status, 200);
  assert.equal(homeDetailsResponse.body.home.hub.id, hubId);
  assert.equal(homeDetailsResponse.body.home.sensors.length, 1);

  const notificationsResponse = await request(app)
    .get("/api/notifications")
    .set("Authorization", `Bearer ${token}`);
  assert.equal(notificationsResponse.status, 200);
  assert.equal(notificationsResponse.body.notifications.length, 1);
  assert.equal(notificationsResponse.body.notifications[0].severity, "critical");
});

test("otp flow registers first-time users and authenticates existing users", async () => {
  const requestOtpResponse = await request(app).post("/api/auth/otp/request").send({
    phoneNumber: "+919999999999",
  });
  assert.equal(requestOtpResponse.status, 200);
  assert.equal(requestOtpResponse.body.otp, "123456");

  const firstVerifyResponse = await request(app).post("/api/auth/otp/verify").send({
    phoneNumber: "+919999999999",
    otp: "123456",
  });
  assert.equal(firstVerifyResponse.status, 200);
  assert.equal(firstVerifyResponse.body.status, "registration_required");
  assert.ok(firstVerifyResponse.body.otpSessionId);

  const completeResponse = await request(app).post("/api/auth/otp/register").send({
    otpSessionId: firstVerifyResponse.body.otpSessionId,
    name: "ABC User",
    email: "abc@gmail.com",
    phoneNumber: "+919999999999",
  });
  assert.equal(completeResponse.status, 201);
  assert.ok(completeResponse.body.token);
  assert.equal(completeResponse.body.user.email, "abc@gmail.com");

  await request(app).post("/api/auth/otp/request").send({
    phoneNumber: "+919999999999",
  });
  const secondVerifyResponse = await request(app).post("/api/auth/otp/verify").send({
    phoneNumber: "+919999999999",
    otp: "123456",
  });
  assert.equal(secondVerifyResponse.status, 200);
  assert.equal(secondVerifyResponse.body.status, "authenticated");
  assert.ok(secondVerifyResponse.body.token);
});

test("esp32 and mobile viewer can exchange WebRTC signaling for the main door feed", async () => {
  const registerResponse = await request(app).post("/api/auth/register").send({
    name: "Door Viewer",
    email: "door-viewer@example.com",
    password: "secret123",
  });
  assert.equal(registerResponse.status, 201);

  const loginResponse = await request(app).post("/api/auth/login").send({
    email: "door-viewer@example.com",
    password: "secret123",
  });
  assert.equal(loginResponse.status, 200);
  const token = loginResponse.body.token as string;

  const setupResponse = await request(app)
    .post("/api/homes/setup-hub")
    .set("Authorization", `Bearer ${token}`)
    .send({
      hubMacAddress: "AA:BB:CC:DD:EE:01",
      homeName: "Door Home",
      location: "Front Door",
    });
  assert.equal(setupResponse.status, 201);

  const hubRegisterResponse = await request(app)
    .post("/api/device/hubs/register")
    .set("x-device-api-key", "device-test-key")
    .send({
      hubMacAddress: "AA:BB:CC:DD:EE:01",
      provisioningToken: setupResponse.body.setupSession.provisioningToken,
    });
  assert.equal(hubRegisterResponse.status, 201);

  const hub = await HubModel.findOne({ macAddress: "AA:BB:CC:DD:EE:01" });
  assert.ok(hub);

  const server = createServer(app);
  attachLiveFeedServer(server, testConfig);
  await new Promise<void>((resolve) => server.listen(0, resolve));

  const address = server.address() as AddressInfo;
  const wsBaseUrl = `ws://127.0.0.1:${address.port}/ws/live-feed`;
  const viewer = new WebSocket(`${wsBaseUrl}?role=viewer&mode=webrtc&token=${token}&hubId=${hub!.id}`);
  const device = new WebSocket(
    `${wsBaseUrl}?role=device&mode=webrtc&deviceApiKey=device-test-key&hubMacAddress=AA:BB:CC:DD:EE:01&hubSecret=${hub!.deviceSecret}`,
  );

  try {
    const viewerReady = await nextJsonMessage(viewer);
    assert.equal(viewerReady.type, "ready");
    assert.equal(viewerReady.role, "viewer");
    assert.equal(viewerReady.mode, "webrtc");

    const deviceReady = await nextJsonMessage(device);
    assert.equal(deviceReady.type, "ready");
    assert.equal(deviceReady.role, "device");
    assert.equal(deviceReady.mode, "webrtc");

    viewer.send(JSON.stringify({ type: "viewer-ready" }));
    const viewerReadyForDevice = await nextJsonMessage(device, "viewer-ready");
    assert.equal(viewerReadyForDevice.hubId, hub!.id);

    device.send(
      JSON.stringify({
        type: "offer",
        sdp: { type: "offer", sdp: "device-offer-sdp" },
      }),
    );

    const offer = await nextJsonMessage(viewer, "offer");
    assert.equal(offer.hubId, hub!.id);
    assert.deepEqual(offer.sdp, { type: "offer", sdp: "device-offer-sdp" });

    viewer.send(
      JSON.stringify({
        type: "answer",
        sdp: { type: "answer", sdp: "mobile-answer-sdp" },
      }),
    );

    const answer = await nextJsonMessage(device, "answer");
    assert.equal(answer.hubId, hub!.id);
    assert.deepEqual(answer.sdp, { type: "answer", sdp: "mobile-answer-sdp" });
  } finally {
    viewer.close();
    device.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
});

function nextJsonMessage(socket: WebSocket, expectedType?: string): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error("Timed out waiting for WebSocket message")), 2000);

    const onMessage = (data: WebSocket.RawData) => {
      const message = JSON.parse(data.toString()) as Record<string, unknown>;
      if (expectedType && message.type !== expectedType) {
        socket.once("message", onMessage);
        return;
      }
      clearTimeout(timeout);
      socket.off("error", onError);
      resolve(message);
    };

    const onError = (error: Error) => {
      clearTimeout(timeout);
      socket.off("message", onMessage);
      reject(error);
    };

    socket.once("message", onMessage);
    socket.once("error", onError);
  });
}
