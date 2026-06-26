import { RequestHandler, Router } from "express";
import { HomeController } from "./home.controller";

export function createHomeRoutes(homeController: HomeController, authMiddleware: RequestHandler): Router {
  const router = Router();

  router.use(authMiddleware);
  router.post("/setup-hub", homeController.startHubSetup);
  router.get("/", homeController.listHomes);
  router.get("/:homeId", homeController.getHome);
  router.post("/:homeId/sensors/pair", homeController.pairSensor);
  router.patch("/:homeId/sensors/:sensorId/enabled", homeController.setSensorEnabled);
  router.delete("/:homeId/sensors/:sensorId", homeController.deleteSensor);
  router.post("/:homeId/door-lock/open", homeController.openDoorLock);
  router.post("/:homeId/door-lock/toggle", homeController.toggleDoorLock);
  router.get("/:homeId/door-lock", homeController.getDoorLock);
  router.get("/:homeId/camera/stream", homeController.streamCamera);
  router.post("/:homeId/camera/stream-token", homeController.createCameraStreamToken);
  router.delete("/:homeId", homeController.deleteHub);

  return router;
}
