"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.createRealtimeServices = createRealtimeServices;
exports.createApp = createApp;
const express_1 = __importDefault(require("express"));
const env_1 = require("./config/env");
const auth_middleware_1 = require("./common/middlewares/auth.middleware");
const device_middleware_1 = require("./common/middlewares/device.middleware");
const error_middleware_1 = require("./common/middlewares/error.middleware");
const not_found_middleware_1 = require("./common/middlewares/not-found.middleware");
const routes_1 = require("./routes");
const auth_controller_1 = require("./modules/auth/auth.controller");
const auth_service_1 = require("./modules/auth/auth.service");
const camera_controller_1 = require("./modules/camera/camera.controller");
const camera_relay_1 = require("./modules/camera/camera-relay");
const device_controller_1 = require("./modules/device/device.controller");
const device_service_1 = require("./modules/device/device.service");
const door_lock_service_1 = require("./modules/door-lock/door-lock.service");
const home_controller_1 = require("./modules/homes/home.controller");
const home_service_1 = require("./modules/homes/home.service");
const hub_control_ws_1 = require("./modules/device-control/hub-control-ws");
const notification_controller_1 = require("./modules/notifications/notification.controller");
const notification_service_1 = require("./modules/notifications/notification.service");
function createRealtimeServices() {
    return {
        cameraRelay: new camera_relay_1.CameraRelay({
            onFirstViewer: (homeId, streamSessionId) => (0, hub_control_ws_1.sendCameraStreamCommandForHome)(homeId, "start", streamSessionId),
            onLastViewer: (homeId, streamSessionId) => (0, hub_control_ws_1.sendCameraStreamCommandForHome)(homeId, "stop", streamSessionId),
        }),
        doorLockService: new door_lock_service_1.DoorLockService(),
    };
}
function createApp(config = env_1.env, realtimeServices = createRealtimeServices()) {
    const app = (0, express_1.default)();
    const { cameraRelay, doorLockService } = realtimeServices;
    const authService = new auth_service_1.AuthService(config);
    const homeService = new home_service_1.HomeService(config);
    const notificationService = new notification_service_1.NotificationService();
    const deviceService = new device_service_1.DeviceService(notificationService, homeService, cameraRelay);
    const authController = new auth_controller_1.AuthController(authService, homeService);
    const homeController = new home_controller_1.HomeController(homeService, doorLockService, cameraRelay);
    const deviceController = new device_controller_1.DeviceController(deviceService);
    const cameraController = new camera_controller_1.CameraController(cameraRelay);
    const notificationController = new notification_controller_1.NotificationController(notificationService);
    const authMiddleware = (0, auth_middleware_1.createAuthMiddleware)(config);
    const deviceMiddleware = (0, device_middleware_1.createDeviceMiddleware)(config);
    app.use(express_1.default.json());
    app.use(express_1.default.urlencoded({ extended: false }));
    app.use("/api", (0, routes_1.createApiRouter)({
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
    }));
    app.use(not_found_middleware_1.notFoundMiddleware);
    app.use(error_middleware_1.errorMiddleware);
    return app;
}
