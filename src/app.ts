import express, { Express } from "express";
import { env, AppConfig } from "./config/env";
import { createAuthMiddleware } from "./common/middlewares/auth.middleware";
import { createDeviceMiddleware } from "./common/middlewares/device.middleware";
import { errorMiddleware } from "./common/middlewares/error.middleware";
import { notFoundMiddleware } from "./common/middlewares/not-found.middleware";
import { createApiRouter } from "./routes";
import { AuthController } from "./modules/auth/auth.controller";
import { AuthService } from "./modules/auth/auth.service";
import { DeviceController } from "./modules/device/device.controller";
import { DeviceService } from "./modules/device/device.service";
import { HomeController } from "./modules/homes/home.controller";
import { HomeService } from "./modules/homes/home.service";
import { NotificationController } from "./modules/notifications/notification.controller";
import { NotificationService } from "./modules/notifications/notification.service";

export function createApp(config: AppConfig = env): Express {
  const app = express();

  const authService = new AuthService(config);
  const homeService = new HomeService(config);
  const notificationService = new NotificationService();
  const deviceService = new DeviceService(notificationService, homeService);

  const authController = new AuthController(authService, homeService);
  const homeController = new HomeController(homeService);
  const deviceController = new DeviceController(deviceService);
  const notificationController = new NotificationController(notificationService);

  const authMiddleware = createAuthMiddleware(config);
  const deviceMiddleware = createDeviceMiddleware(config);

  app.use(express.json());
  app.use(express.urlencoded({ extended: false }));

  app.use(
    "/api",
    createApiRouter({
      controllers: {
        authController,
        homeController,
        deviceController,
        notificationController,
      },
      middlewares: {
        authMiddleware,
        deviceMiddleware,
      },
    }),
  );

  app.use(notFoundMiddleware);
  app.use(errorMiddleware);

  return app;
}
