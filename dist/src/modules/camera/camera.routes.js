"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.createCameraRoutes = createCameraRoutes;
const express_1 = require("express");
function createCameraRoutes(cameraController) {
    const router = (0, express_1.Router)();
    router.get("/streams/:token", cameraController.streamByToken);
    return router;
}
