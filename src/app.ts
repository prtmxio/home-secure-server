import express, { Express } from "express";
import { env, AppConfig } from "./config/env";
import { createAuthMiddleware } from "./common/middlewares/auth.middleware";
import { createDeviceMiddleware } from "./common/middlewares/device.middleware";
import { errorMiddleware } from "./common/middlewares/error.middleware";
import { notFoundMiddleware } from "./common/middlewares/not-found.middleware";
import { createApiRouter } from "./routes";
import { AuthController } from "./modules/auth/auth.controller";
import { AuthService } from "./modules/auth/auth.service";
import { CameraController } from "./modules/camera/camera.controller";
import { CameraRelay } from "./modules/camera/camera-relay";
import { DeviceController } from "./modules/device/device.controller";
import { DeviceService } from "./modules/device/device.service";
import { DeviceEventInput } from "./modules/device/device.types";
import { DoorLockService } from "./modules/door-lock/door-lock.service";
import { HomeController } from "./modules/homes/home.controller";
import { HomeService } from "./modules/homes/home.service";
import { sendCameraStreamCommandForHome } from "./modules/device-control/hub-control-ws";
import { NotificationController } from "./modules/notifications/notification.controller";
import { NotificationService } from "./modules/notifications/notification.service";
import { PushNotificationService } from "./modules/push-notifications/push-notification.service";

export interface RealtimeServices {
  cameraRelay: CameraRelay;
  doorLockService: DoorLockService;
  ingestHubEvent?: (payload: DeviceEventInput) => Promise<unknown>;
}

export function createRealtimeServices(): RealtimeServices {
  return {
    cameraRelay: new CameraRelay({
      onFirstViewer: (homeId, streamSessionId) => sendCameraStreamCommandForHome(homeId, "start", streamSessionId),
      onLastViewer: (homeId, streamSessionId) => sendCameraStreamCommandForHome(homeId, "stop", streamSessionId),
    }),
    doorLockService: new DoorLockService(),
  };
}

export function createApp(config: AppConfig = env, realtimeServices: RealtimeServices = createRealtimeServices()): Express {
  const app = express();

  const { cameraRelay, doorLockService } = realtimeServices;
  const pushNotificationService = new PushNotificationService(config);
  const authService = new AuthService(config);
  const homeService = new HomeService(config);
  const notificationService = new NotificationService(pushNotificationService);
  const deviceService = new DeviceService(notificationService, homeService, cameraRelay);
  realtimeServices.ingestHubEvent = (payload) => deviceService.ingestHubEvent(payload);

  const authController = new AuthController(authService, homeService);
  const homeController = new HomeController(homeService, doorLockService, cameraRelay);
  const deviceController = new DeviceController(deviceService);
  const cameraController = new CameraController(cameraRelay);
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
        cameraController,
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
