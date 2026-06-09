import test from "node:test";
import assert from "node:assert/strict";
import http from "http";
import { once } from "events";
import mongoose from "mongoose";
import { MongoMemoryServer } from "mongodb-memory-server";
import request from "supertest";
import WebSocket, { RawData } from "ws";
import { AppConfig } from "../src/config/env";
import { createApp, createRealtimeServices, RealtimeServices } from "../src/app";
import { attachHubControlWebSocket } from "../src/modules/device-control/hub-control-ws";
import { connectDatabase, disconnectDatabase } from "../src/config/database";
import { HubModel } from "../src/modules/hubs/hub.model";

let mongoServer: MongoMemoryServer;
let app: ReturnType<typeof createApp>;
let realtimeServices: RealtimeServices;
let httpServer: http.Server;
let httpServerUrl: string;

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
  realtimeServices = createRealtimeServices();
  app = createApp(testConfig, realtimeServices);
  httpServer = http.createServer(app);
  attachHubControlWebSocket(httpServer, testConfig, realtimeServices.doorLockService);
  httpServer.listen(0, "127.0.0.1");
  await once(httpServer, "listening");
  const address = httpServer.address();
  assert.ok(address && typeof address === "object");
  httpServerUrl = `http://127.0.0.1:${address.port}`;
});

test.after(async () => {
  httpServer.close();
  await once(httpServer, "close");
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

test("hub can upload camera frames and user can mint a short-lived stream token", async () => {
  const { token, homeId, hubSecret } = await onboardHub("Camera User", "camera@example.com", "AA:BB:CC:DD:EE:10");

  const frame = Buffer.from([0xff, 0xd8, 0xff, 0xdb, 0x00, 0x43, 0xff, 0xd9]);
  const uploadResponse = await request(app)
    .post("/api/device/hubs/camera/frame")
    .set("x-device-api-key", "device-test-key")
    .set("x-hub-mac-address", "AA:BB:CC:DD:EE:10")
    .set("x-hub-secret", hubSecret)
    .set("Content-Type", "image/jpeg")
    .send(frame);

  assert.equal(uploadResponse.status, 202);
  assert.equal(uploadResponse.body.accepted, true);
  assert.equal(uploadResponse.body.bytes, frame.length);

  const tokenResponse = await request(app)
    .post(`/api/homes/${homeId}/camera/stream-token`)
    .set("Authorization", `Bearer ${token}`);
  assert.equal(tokenResponse.status, 201);
  assert.match(tokenResponse.body.streamPath, /^\/api\/camera\/streams\//);

  const deniedUpload = await request(app)
    .post("/api/device/hubs/camera/frame")
    .set("x-device-api-key", "device-test-key")
    .set("x-hub-mac-address", "AA:BB:CC:DD:EE:10")
    .set("x-hub-secret", "wrong")
    .set("Content-Type", "image/jpeg")
    .send(frame);
  assert.equal(deniedUpload.status, 401);
});

test("user lock command is pushed to the hub over WebSocket and ACK updates status", async () => {
  const { token, homeId, hubSecret } = await onboardHub("Lock User", "lock@example.com", "AA:BB:CC:DD:EE:20");

  const ws = new WebSocket(httpServerUrl.replace("http://", "ws://") + "/api/device/hubs/control/ws", {
    headers: {
      "x-device-api-key": "device-test-key",
      "x-hub-mac-address": "AA:BB:CC:DD:EE:20",
      "x-hub-secret": hubSecret,
    },
  });

  try {
    await waitWsOpen(ws);
    const commandPromise = nextWsJsonOfType(ws, "door_lock_command");
    const commandResponse = await request(app)
      .post(`/api/homes/${homeId}/door-lock/open`)
      .set("Authorization", `Bearer ${token}`);
    assert.equal(commandResponse.status, 201);

    const command = await commandPromise;
    assert.equal(command.type, "door_lock_command");
    assert.equal(command.mode, "auto_lock");
    assert.equal(command.action, "open");
    assert.equal(command.durationMs, 3000);

    const ackPromise = nextWsJsonOfType(ws, "door_lock_ack_received");
    ws.send(JSON.stringify({
      type: "door_lock_ack",
      commandId: command.commandId,
      status: "executed",
      lockState: "locked",
    }));

    const ack = await ackPromise;
    assert.equal(ack.type, "door_lock_ack_received");
    assert.equal(ack.status, "executed");

    const lockResponse = await request(app)
      .get(`/api/homes/${homeId}/door-lock`)
      .set("Authorization", `Bearer ${token}`);
    assert.equal(lockResponse.status, 200);
    assert.equal(lockResponse.body.command.status, "executed");
    assert.equal(lockResponse.body.command.lockState, "locked");
  } finally {
    ws.close();
  }
});

test("door lock toggle rejects unsafe durations", async () => {
  const { token, homeId } = await onboardHub("Limit User", "limit@example.com", "AA:BB:CC:DD:EE:30");

  const response = await request(app)
    .post(`/api/homes/${homeId}/door-lock/toggle`)
    .set("Authorization", `Bearer ${token}`)
    .send({ state: "on", durationMs: 10001 });

  assert.equal(response.status, 400);
});

async function onboardHub(name: string, email: string, hubMacAddress: string) {
  const registerResponse = await request(app).post("/api/auth/register").send({
    name,
    email,
    password: "secret123",
  });
  assert.equal(registerResponse.status, 201);

  const loginResponse = await request(app).post("/api/auth/login").send({
    email,
    password: "secret123",
  });
  assert.equal(loginResponse.status, 200);
  const token = loginResponse.body.token as string;

  const setupResponse = await request(app)
    .post("/api/homes/setup-hub")
    .set("Authorization", `Bearer ${token}`)
    .send({
      hubMacAddress,
      homeName: `${name} Home`,
      location: "Test",
    });
  assert.equal(setupResponse.status, 201);

  const hubRegisterResponse = await request(app)
    .post("/api/device/hubs/register")
    .set("x-device-api-key", "device-test-key")
    .send({
      hubMacAddress,
      provisioningToken: setupResponse.body.setupSession.provisioningToken,
    });
  assert.equal(hubRegisterResponse.status, 201);

  const hub = await HubModel.findOne({ macAddress: hubMacAddress });
  assert.ok(hub);

  return {
    token,
    homeId: hubRegisterResponse.body.home.id as string,
    hubSecret: hub.deviceSecret,
  };
}

async function nextWsJson(ws: WebSocket): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for WebSocket message"));
    }, 5000);

    const onMessage = (data: RawData) => {
      cleanup();
      resolve(JSON.parse(data.toString()) as Record<string, unknown>);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onClose = (code: number, reason: Buffer) => {
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

async function nextWsJsonOfType(ws: WebSocket, type: string): Promise<Record<string, unknown>> {
  const deadline = Date.now() + 5000;
  while (Date.now() < deadline) {
    const message = await nextWsJson(ws);
    if (message.type === type) {
      return message;
    }
  }
  throw new Error(`Timed out waiting for WebSocket message type ${type}`);
}

async function waitWsOpen(ws: WebSocket): Promise<void> {
  if (ws.readyState === WebSocket.OPEN) return;
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out waiting for WebSocket open; state=${ws.readyState}`));
    }, 5000);
    const onOpen = () => {
      cleanup();
      resolve();
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onClose = (code: number, reason: Buffer) => {
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
