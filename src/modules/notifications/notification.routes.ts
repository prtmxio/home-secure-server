import { RequestHandler, Router } from "express";
import { NotificationController } from "./notification.controller";

export function createNotificationRoutes(
  notificationController: NotificationController,
  authMiddleware: RequestHandler,
): Router {
  const router = Router();

  router.use(authMiddleware);
  router.get("/", notificationController.listNotifications);
  router.get("/stream", notificationController.streamNotifications);
  router.post("/push-token", notificationController.registerPushToken);
  router.delete("/push-token", notificationController.unregisterPushToken);
  router.patch("/:notificationId/read", notificationController.markAsRead);

  return router;
}
