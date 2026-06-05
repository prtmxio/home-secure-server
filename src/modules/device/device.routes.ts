import express, { RequestHandler, Router } from "express";
import { DeviceController } from "./device.controller";

export function createDeviceRoutes(deviceController: DeviceController, deviceMiddleware: RequestHandler): Router {
  const router = Router();

  router.use(deviceMiddleware);
  router.post("/hubs/register", deviceController.registerHubOverWifi);
  router.post("/hubs/sensor-pairing-mode", deviceController.openSensorPairingMode);
  router.get("/hubs/pending-sensor", deviceController.fetchPendingSensorPairing);
  router.get("/hubs/sensors", deviceController.fetchHubSensors);
  router.post("/hubs/camera/frame", express.raw({ type: "image/jpeg", limit: "300kb" }), deviceController.ingestCameraFrame);
  router.post("/hubs/events", deviceController.ingestHubEvent);

  return router;
}
