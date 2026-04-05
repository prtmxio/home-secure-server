import { RequestHandler, Router } from "express";
import { HomeController } from "./home.controller";

export function createHomeRoutes(homeController: HomeController, authMiddleware: RequestHandler): Router {
  const router = Router();

  router.use(authMiddleware);
  router.post("/setup-hub", homeController.startHubSetup);
  router.get("/", homeController.listHomes);
  router.get("/:homeId", homeController.getHome);
  router.post("/:homeId/sensors/pair", homeController.pairSensor);

  return router;
}
