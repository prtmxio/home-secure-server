import { RequestHandler, Router } from "express";
import { DeviceController } from "./device.controller";

export function createDeviceRoutes(deviceController: DeviceController, deviceMiddleware: RequestHandler): Router {
  const router = Router();

  router.use(deviceMiddleware);
  router.post("/hubs/register", deviceController.registerHubOverWifi);
  router.post("/hubs/sensor-pairing-mode", deviceController.openSensorPairingMode);
  router.post("/hubs/events", deviceController.ingestHubEvent);

  return router;
}
