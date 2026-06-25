"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createNotificationRoutes = createNotificationRoutes;
const express_1 = require("express");
function createNotificationRoutes(notificationController, authMiddleware) {
    const router = (0, express_1.Router)();
    router.use(authMiddleware);
    router.get("/", notificationController.listNotifications);
    router.get("/stream", notificationController.streamNotifications);
    router.delete("/", notificationController.clearNotifications);
    router.post("/push-token", notificationController.registerPushToken);
    router.delete("/push-token", notificationController.unregisterPushToken);
    router.delete("/:notificationId", notificationController.deleteNotification);
    router.patch("/:notificationId/read", notificationController.markAsRead);
    return router;
}
