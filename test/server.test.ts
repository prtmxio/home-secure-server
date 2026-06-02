import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import { createApp } from "../src/app";
import { connectDatabase, disconnectDatabase } from "../src/config/database";
import { HubModel } from "../src/modules/hubs/hub.model";

let mongoServer: MongoMemoryServer;
let app: ReturnType<typeof createApp>;

test.before(async () => {
  mongoServer = await MongoMemoryServer.create();
  await connectDatabase(mongoServer.getUri());
  app = createApp({
    nodeEnv: "test",
    port: 0,
    mongodbUri: mongoServer.getUri(),
    jwtSecret: "test-secret",
    jwtExpiresIn: "1d",
    deviceApiKey: "device-test-key",
    pairingSessionTtlSeconds: 60,
    projectRoot: process.cwd(),
  });
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
