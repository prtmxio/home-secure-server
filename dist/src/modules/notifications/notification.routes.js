"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createNotificationRoutes = createNotificationRoutes;
const express_1 = require("express");
function createNotificationRoutes(notificationController, authMiddleware) {
    const router = (0, express_1.Router)();
    router.use(authMiddleware);
    router.get("/", notificationController.listNotifications);
    router.get("/stream", notificationController.streamNotifications);
    router.post("/push-token", notificationController.registerPushToken);
    router.patch("/:notificationId/read", notificationController.markAsRead);
    return router;
}
