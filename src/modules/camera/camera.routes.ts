import { Router } from "express";
import { CameraController } from "./camera.controller";

export function createCameraRoutes(cameraController: CameraController): Router {
  const router = Router();

  router.get("/streams/:token", cameraController.streamByToken);

  return router;
}
