"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createDeviceRoutes = createDeviceRoutes;
const express_1 = require("express");
function createDeviceRoutes(deviceController, deviceMiddleware) {
    const router = (0, express_1.Router)();
    router.use(deviceMiddleware);
    router.post("/hubs/register", deviceController.registerHubOverWifi);
    router.post("/hubs/sensor-pairing-mode", deviceController.openSensorPairingMode);
    router.get("/hubs/pending-sensor", deviceController.fetchPendingSensorPairing);
    router.post("/hubs/events", deviceController.ingestHubEvent);
    return router;
}
