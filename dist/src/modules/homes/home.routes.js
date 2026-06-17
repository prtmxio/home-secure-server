"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createHomeRoutes = createHomeRoutes;
const express_1 = require("express");
function createHomeRoutes(homeController, authMiddleware) {
    const router = (0, express_1.Router)();
    router.use(authMiddleware);
    router.post("/setup-hub", homeController.startHubSetup);
    router.get("/", homeController.listHomes);
    router.get("/:homeId", homeController.getHome);
    router.post("/:homeId/sensors/pair", homeController.pairSensor);
    router.post("/:homeId/door-lock/open", homeController.openDoorLock);
    router.post("/:homeId/door-lock/toggle", homeController.toggleDoorLock);
    router.get("/:homeId/door-lock", homeController.getDoorLock);
    router.get("/:homeId/camera/stream", homeController.streamCamera);
    router.post("/:homeId/camera/stream-token", homeController.createCameraStreamToken);
    return router;
}
