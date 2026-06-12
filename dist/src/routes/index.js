"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createApiRouter = createApiRouter;
const express_1 = require("express");
const auth_routes_1 = require("../modules/auth/auth.routes");
const device_routes_1 = require("../modules/device/device.routes");
const home_routes_1 = require("../modules/homes/home.routes");
const notification_routes_1 = require("../modules/notifications/notification.routes");
function createApiRouter({ controllers, middlewares }) {
    const router = (0, express_1.Router)();
    router.get("/health", (req, res) => {
        res.status(200).json({ status: "ok", service: "glazia-home-secure-server" });
    });
    router.use("/auth", (0, auth_routes_1.createAuthRoutes)(controllers.authController, middlewares.authMiddleware));
    router.use("/homes", (0, home_routes_1.createHomeRoutes)(controllers.homeController, middlewares.authMiddleware));
    router.use("/device", (0, device_routes_1.createDeviceRoutes)(controllers.deviceController, middlewares.deviceMiddleware));
    router.use("/notifications", (0, notification_routes_1.createNotificationRoutes)(controllers.notificationController, middlewares.authMiddleware));
    return router;
}
