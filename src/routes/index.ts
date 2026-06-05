import { Router, RequestHandler } from "express";
import { AuthController } from "../modules/auth/auth.controller";
import { createAuthRoutes } from "../modules/auth/auth.routes";
import { CameraController } from "../modules/camera/camera.controller";
import { createCameraRoutes } from "../modules/camera/camera.routes";
import { DeviceController } from "../modules/device/device.controller";
import { createDeviceRoutes } from "../modules/device/device.routes";
import { HomeController } from "../modules/homes/home.controller";
import { createHomeRoutes } from "../modules/homes/home.routes";
import { NotificationController } from "../modules/notifications/notification.controller";
import { createNotificationRoutes } from "../modules/notifications/notification.routes";

interface ApiRouterDependencies {
  controllers: {
    authController: AuthController;
    cameraController: CameraController;
    homeController: HomeController;
    deviceController: DeviceController;
    notificationController: NotificationController;
  };
  middlewares: {
    authMiddleware: RequestHandler;
    deviceMiddleware: RequestHandler;
  };
}

export function createApiRouter({ controllers, middlewares }: ApiRouterDependencies): Router {
  const router = Router();

  router.get("/health", (req, res) => {
    res.status(200).json({ status: "ok", service: "glazia-home-secure-server" });
  });

  router.use("/auth", createAuthRoutes(controllers.authController, middlewares.authMiddleware));
  router.use("/camera", createCameraRoutes(controllers.cameraController));
  router.use("/homes", createHomeRoutes(controllers.homeController, middlewares.authMiddleware));
  router.use("/device", createDeviceRoutes(controllers.deviceController, middlewares.deviceMiddleware));
  router.use(
    "/notifications",
    createNotificationRoutes(controllers.notificationController, middlewares.authMiddleware),
  );

  return router;
}
