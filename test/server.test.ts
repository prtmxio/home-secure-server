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
import { connectDatabase, disconnectDatabase } from "../src/config/database";
import {
  attachHubControlWebSocket,
  isHubControlConnected,
  sendLiveFeedSignalToHub,
} from "../src/modules/device-control/hub-control-ws";
import { HubModel } from "../src/modules/hubs/hub.model";
import { attachLiveFeedServer } from "../src/modules/live-feed/live-feed.server";

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
    metaWhatsappPhoneNumberId: "",
    metaWhatsappToken: "",
    metaWhatsappApiVersion: "v22.0",
    whatsappOtpTemplateName: "login_otp",
    whatsappCountryCode: "91",
    firebaseServiceAccountJson: "",
    firebaseProjectId: "",
    firebaseClientEmail: "",
    firebasePrivateKey: "",
    projectRoot: process.cwd(),
  };
  realtimeServices = createRealtimeServices();
  app = createApp(testConfig, realtimeServices);
  httpServer = http.createServer(app);
  attachHubControlWebSocket(
    httpServer,
    testConfig,
    realtimeServices.doorLockService,
    realtimeServices.ingestHubEvent,
  );
  attachLiveFeedServer(httpServer, testConfig, {
    isDeviceConnected: isHubControlConnected,
    sendToDevice: sendLiveFeedSignalToHub,
  });
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

  const pendingHomeDetailsResponse = await request(app)
    .get(`/api/homes/${homeId}`)
    .set("Authorization", `Bearer ${token}`);
  assert.equal(pendingHomeDetailsResponse.status, 200);
  assert.equal(pendingHomeDetailsResponse.body.home.sensors.length, 0);

  const pendingHubSensorsResponse = await request(app)
    .get("/api/device/hubs/sensors")
    .set("x-device-api-key", "device-test-key")
    .set("x-hub-mac-address", "AA:BB:CC:DD:EE:FF")
    .set("x-hub-secret", currentHub!.deviceSecret);
  assert.equal(pendingHubSensorsResponse.status, 200);
  assert.equal(pendingHubSensorsResponse.body.sensors.length, 0);

  const preConfirmEventResponse = await request(app)
    .post("/api/device/hubs/events")
    .set("x-device-api-key", "device-test-key")
    .set("x-hub-mac-address", "AA:BB:CC:DD:EE:FF")
    .set("x-hub-secret", currentHub!.deviceSecret)
    .send({
      sensorMacAddress: "11:22:33:44:55:66",
      eventType: "motion_detected",
    });
  assert.equal(preConfirmEventResponse.status, 409);

  const confirmSensorResponse = await request(app)
    .post("/api/device/hubs/sensors/confirm")
    .set("x-device-api-key", "device-test-key")
    .set("x-hub-mac-address", "AA:BB:CC:DD:EE:FF")
    .set("x-hub-secret", currentHub!.deviceSecret)
    .send({
      sensorMacAddress: "11:22:33:44:55:66",
    });
  assert.equal(confirmSensorResponse.status, 200);
  assert.equal(confirmSensorResponse.body.paired, true);

  const finalEventResponse = await request(app)
    .post("/api/device/hubs/events")
    .set("x-device-api-key", "device-test-key")
    .set("x-hub-mac-address", "AA:BB:CC:DD:EE:FF")
    .set("x-hub-secret", currentHub!.deviceSecret)
    .send({
      sensorMacAddress: "11:22:33:44:55:66",
      eventType: "door_opened",
      payload: {
        module: "magnetic_reed",
        reedState: "open",
      },
    });
  assert.equal(finalEventResponse.status, 201);
  assert.equal(finalEventResponse.body.notification.eventType, "door_opened");
  assert.equal(finalEventResponse.body.notification.title, "Door opened");
  assert.equal(finalEventResponse.body.notification.severity, "critical");

  const shockEventResponse = await request(app)
    .post("/api/device/hubs/events")
    .set("x-device-api-key", "device-test-key")
    .set("x-hub-mac-address", "AA:BB:CC:DD:EE:FF")
    .set("x-hub-secret", currentHub!.deviceSecret)
    .send({
      sensorMacAddress: "11:22:33:44:55:66",
      eventType: "shock_detected",
      payload: {
        module: "vibration",
        shockFound: true,
      },
    });
  assert.equal(shockEventResponse.status, 201);
  assert.equal(shockEventResponse.body.notification.eventType, "shock_detected");
  assert.equal(shockEventResponse.body.notification.title, "Shock detected");
  assert.equal(shockEventResponse.body.notification.severity, "critical");

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
  assert.equal(notificationsResponse.body.notifications.length, 2);
  assert.equal(notificationsResponse.body.notifications[0].severity, "critical");
});

test("otp flow registers first-time users and authenticates existing users", async () => {
  const requestOtpResponse = await request(app).post("/api/auth/otp/request").send({
    phoneNumber: "+919999999999",
  });
  assert.equal(requestOtpResponse.status, 200);
  assert.match(requestOtpResponse.body.otp, /^\d{6}$/);

  const firstVerifyResponse = await request(app).post("/api/auth/otp/verify").send({
    phoneNumber: "+919999999999",
    otp: requestOtpResponse.body.otp,
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

  const secondRequestOtpResponse = await request(app).post("/api/auth/otp/request").send({
    phoneNumber: "+919999999999",
  });
  assert.equal(secondRequestOtpResponse.status, 200);
  assert.match(secondRequestOtpResponse.body.otp, /^\d{6}$/);
  const secondVerifyResponse = await request(app).post("/api/auth/otp/verify").send({
    phoneNumber: "+919999999999",
    otp: secondRequestOtpResponse.body.otp,
  });
  assert.equal(secondVerifyResponse.status, 200);
  assert.equal(secondVerifyResponse.body.status, "authenticated");
  assert.ok(secondVerifyResponse.body.token);
});

test("authenticated users can register mobile push tokens", async () => {
  const { token } = await onboardHub("Push User", "push@example.com", "AA:BB:CC:DD:EE:11");

  const response = await request(app)
    .post("/api/notifications/push-token")
    .set("Authorization", `Bearer ${token}`)
    .send({
      token: "fcm-test-token",
      platform: "android",
    });

  assert.equal(response.status, 200);
  assert.equal(response.body.registered, true);
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

  const ws = openHubControlSocket("AA:BB:CC:DD:EE:20", hubSecret);

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

test("deleting sensors and hubs sends cleanup commands over hub WebSocket", async () => {
  const { token, homeId, hubSecret } = await onboardHub("Delete User", "delete@example.com", "AA:BB:CC:DD:EE:40");

  const pairResponse = await request(app)
    .post(`/api/homes/${homeId}/sensors/pair`)
    .set("Authorization", `Bearer ${token}`)
    .send({
      sensorMacAddress: "11:22:33:44:55:77",
      name: "Balcony Sensor",
      type: "contact",
      zone: "Balcony",
    });
  assert.equal(pairResponse.status, 201);
  const sensorId = pairResponse.body.sensor.id as string;

  const confirmResponse = await request(app)
    .post("/api/device/hubs/sensors/confirm")
    .set("x-device-api-key", "device-test-key")
    .set("x-hub-mac-address", "AA:BB:CC:DD:EE:40")
    .set("x-hub-secret", hubSecret)
    .send({ sensorMacAddress: "11:22:33:44:55:77" });
  assert.equal(confirmResponse.status, 200);

  const ws = openHubControlSocket("AA:BB:CC:DD:EE:40", hubSecret);

  try {
    await waitWsOpen(ws);

    const sensorDeletePromise = nextWsJsonOfType(ws, "sensor_delete_command");
    const deleteSensorResponse = await request(app)
      .delete(`/api/homes/${homeId}/sensors/${sensorId}`)
      .set("Authorization", `Bearer ${token}`);
    assert.equal(deleteSensorResponse.status, 200);
    assert.equal(deleteSensorResponse.body.deleted, true);
    assert.equal(deleteSensorResponse.body.commandSent, true);

    const sensorDeleteCommand = await sensorDeletePromise;
    assert.equal(sensorDeleteCommand.type, "sensor_delete_command");
    assert.equal(sensorDeleteCommand.sensorMacAddress, "11:22:33:44:55:77");

    const hubResetPromise = nextWsJsonOfType(ws, "hub_reset_command");
    const deleteHubResponse = await request(app)
      .delete(`/api/homes/${homeId}`)
      .set("Authorization", `Bearer ${token}`);
    assert.equal(deleteHubResponse.status, 200);
    assert.equal(deleteHubResponse.body.deleted, true);
    assert.equal(deleteHubResponse.body.commandSent, true);

    const hubResetCommand = await hubResetPromise;
    assert.equal(hubResetCommand.type, "hub_reset_command");
    assert.equal(hubResetCommand.action, "format_and_reset");
    assert.equal(hubResetCommand.reason, "hub_deleted");
    assert.equal(hubResetCommand.hubMacAddress, "AA:BB:CC:DD:EE:40");
  } finally {
    ws.close();
  }
});

test("sensor manual toggle sends enable and disable commands over hub WebSocket", async () => {
  const { token, homeId, hubSecret } = await onboardHub(
    "Toggle Sensor User",
    "toggle-sensor@example.com",
    "AA:BB:CC:DD:EE:45",
  );

  const pairResponse = await request(app)
    .post(`/api/homes/${homeId}/sensors/pair`)
    .set("Authorization", `Bearer ${token}`)
    .send({
      sensorMacAddress: "11:22:33:44:55:45",
      name: "Bedroom Sensor",
      type: "contact",
      zone: "Bedroom",
    });
  assert.equal(pairResponse.status, 201);
  const sensorId = pairResponse.body.sensor.id as string;

  const confirmResponse = await request(app)
    .post("/api/device/hubs/sensors/confirm")
    .set("x-device-api-key", "device-test-key")
    .set("x-hub-mac-address", "AA:BB:CC:DD:EE:45")
    .set("x-hub-secret", hubSecret)
    .send({ sensorMacAddress: "11:22:33:44:55:45" });
  assert.equal(confirmResponse.status, 200);

  const ws = openHubControlSocket("AA:BB:CC:DD:EE:45", hubSecret);
  try {
    await waitWsOpen(ws);

    const disablePromise = nextWsJsonOfType(ws, "sensor_toggle_command");
    const disableResponse = await request(app)
      .patch(`/api/homes/${homeId}/sensors/${sensorId}/enabled`)
      .set("Authorization", `Bearer ${token}`)
      .send({ enabled: false });
    assert.equal(disableResponse.status, 200);
    assert.equal(disableResponse.body.commandSent, true);

    const disableCommand = await disablePromise;
    assert.equal(disableCommand.sensorMacAddress, "11:22:33:44:55:45");
    assert.equal(disableCommand.enabled, false);
    assert.equal(disableCommand.action, "disable");

    const enablePromise = nextWsJsonOfType(ws, "sensor_toggle_command");
    const enableResponse = await request(app)
      .patch(`/api/homes/${homeId}/sensors/${sensorId}/enabled`)
      .set("Authorization", `Bearer ${token}`)
      .send({ enabled: true });
    assert.equal(enableResponse.status, 200);
    assert.equal(enableResponse.body.commandSent, true);

    const enableCommand = await enablePromise;
    assert.equal(enableCommand.sensorMacAddress, "11:22:33:44:55:45");
    assert.equal(enableCommand.enabled, true);
    assert.equal(enableCommand.action, "enable");
  } finally {
    ws.close();
  }
});

test("hub control WebSocket events create user notifications", async () => {
  const { token, homeId, hubSecret } = await onboardHub(
    "Socket Event User",
    "socket-event@example.com",
    "AA:BB:CC:DD:EE:55",
  );

  const pairResponse = await request(app)
    .post(`/api/homes/${homeId}/sensors/pair`)
    .set("Authorization", `Bearer ${token}`)
    .send({
      sensorMacAddress: "11:22:33:44:55:88",
      name: "Main Door Sensor",
      type: "contact",
      zone: "Main Door",
    });
  assert.equal(pairResponse.status, 201);

  const confirmResponse = await request(app)
    .post("/api/device/hubs/sensors/confirm")
    .set("x-device-api-key", "device-test-key")
    .set("x-hub-mac-address", "AA:BB:CC:DD:EE:55")
    .set("x-hub-secret", hubSecret)
    .send({ sensorMacAddress: "11:22:33:44:55:88" });
  assert.equal(confirmResponse.status, 200);

  const ws = openHubControlSocket("AA:BB:CC:DD:EE:55", hubSecret);
  try {
    await waitWsOpen(ws);

    ws.send(JSON.stringify({
      type: "sensor_event",
      eventType: "door_opened",
      sensorMacAddress: "11:22:33:44:55:88",
      payload: { reedState: "open" },
    }));

    const ack = await nextWsJsonOfType(ws, "hub_event_ack");
    assert.equal(ack.eventType, "door_opened");
    assert.equal((ack.notification as { eventType?: string }).eventType, "door_opened");

    const notificationsResponse = await request(app)
      .get("/api/notifications")
      .set("Authorization", `Bearer ${token}`);
    assert.equal(notificationsResponse.status, 200);
    assert.equal(notificationsResponse.body.notifications.length, 1);
    assert.equal(notificationsResponse.body.notifications[0].eventType, "door_opened");
    assert.equal(notificationsResponse.body.notifications[0].title, "Door opened");
  } finally {
    ws.close();
  }
});

test("webRTC live feed signaling uses the existing hub control WebSocket", async () => {
  const { token, hubId, hubSecret } = await onboardHub("Door Viewer", "door-viewer@example.com", "AA:BB:CC:DD:EE:01");

  const hubWs = openHubControlSocket("AA:BB:CC:DD:EE:01", hubSecret);
  let viewerWs: WebSocket | undefined;

  try {
    await waitWsOpen(hubWs);
    const viewerReadyForHubPromise = nextWsJsonOfType(hubWs, "viewer-ready");
    viewerWs = new WebSocket(
      `${httpServerUrl.replace("http://", "ws://")}/ws/live-feed?role=viewer&mode=webrtc&token=${token}&hubId=${hubId}`,
    );
    await waitWsOpen(viewerWs);

    const viewerReady = await nextWsJsonOfType(viewerWs, "ready");
    assert.equal(viewerReady.role, "viewer");
    assert.equal(viewerReady.mode, "webrtc");
    assert.equal(viewerReady.status, "live");

    const viewerReadyForHub = await viewerReadyForHubPromise;
    assert.equal(viewerReadyForHub.hubId, hubId);

    hubWs.send(JSON.stringify({
      type: "offer",
      sdp: { type: "offer", sdp: "device-offer-sdp" },
    }));

    const offer = await nextWsJsonOfType(viewerWs, "offer");
    assert.equal(offer.hubId, hubId);
    assert.deepEqual(offer.sdp, { type: "offer", sdp: "device-offer-sdp" });

    viewerWs.send(JSON.stringify({
      type: "answer",
      sdp: { type: "answer", sdp: "mobile-answer-sdp" },
    }));

    const answer = await nextWsJsonOfType(hubWs, "answer");
    assert.equal(answer.hubId, hubId);
    assert.deepEqual(answer.sdp, { type: "answer", sdp: "mobile-answer-sdp" });
  } finally {
    viewerWs?.close();
    hubWs.close();
  }
});

test("webRTC live feed signaling sends one viewer-ready while a viewer is active", async () => {
  const { token, hubId, hubSecret } = await onboardHub("Single Viewer", "single-viewer@example.com", "AA:BB:CC:DD:EE:02");

  const hubWs = openHubControlSocket("AA:BB:CC:DD:EE:02", hubSecret);
  let firstViewerWs: WebSocket | undefined;
  let secondViewerWs: WebSocket | undefined;

  try {
    await waitWsOpen(hubWs);
    const firstViewerReadyForHubPromise = nextWsJsonOfType(hubWs, "viewer-ready");
    firstViewerWs = new WebSocket(
      `${httpServerUrl.replace("http://", "ws://")}/ws/live-feed?role=viewer&mode=webrtc&token=${token}&hubId=${hubId}`,
    );
    await waitWsOpen(firstViewerWs);
    assert.equal((await nextWsJsonOfType(firstViewerWs, "ready")).status, "live");
    assert.equal((await firstViewerReadyForHubPromise).hubId, hubId);

    secondViewerWs = new WebSocket(
      `${httpServerUrl.replace("http://", "ws://")}/ws/live-feed?role=viewer&mode=webrtc&token=${token}&hubId=${hubId}`,
    );
    await waitWsOpen(secondViewerWs);
    assert.equal((await nextWsJsonOfType(secondViewerWs, "ready")).status, "live");
    await assertNoWsJsonOfType(hubWs, "viewer-ready");
  } finally {
    secondViewerWs?.close();
    firstViewerWs?.close();
    hubWs.close();
  }
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
    hubId: hub.id,
    hubSecret: hub.deviceSecret,
  };
}

function openHubControlSocket(hubMacAddress: string, hubSecret: string): WebSocket {
  return new WebSocket(`${httpServerUrl.replace("http://", "ws://")}/api/device/hubs/control/ws`, {
    headers: {
      "x-device-api-key": "device-test-key",
      "x-hub-mac-address": hubMacAddress,
      "x-hub-secret": hubSecret,
    },
  });
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

async function assertNoWsJsonOfType(ws: WebSocket, type: string): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      resolve();
    }, 250);

    const onMessage = (data: RawData) => {
      const message = JSON.parse(data.toString()) as Record<string, unknown>;
      if (message.type === type) {
        cleanup();
        reject(new Error(`Unexpected WebSocket message type ${type}`));
      }
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const onClose = () => {
      cleanup();
      resolve();
    };
    const cleanup = () => {
      clearTimeout(timeout);
      ws.off("message", onMessage);
      ws.off("error", onError);
      ws.off("close", onClose);
    };

    ws.on("message", onMessage);
    ws.once("error", onError);
    ws.once("close", onClose);
  });
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
