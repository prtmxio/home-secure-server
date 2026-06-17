"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeviceController = void 0;
const async_handler_1 = require("../../common/utils/async-handler");
class DeviceController {
    deviceService;
    constructor(deviceService) {
        this.deviceService = deviceService;
    }
    registerHubOverWifi = (0, async_handler_1.asyncHandler)(async (req, res) => {
        const { home, hubSecret } = await this.deviceService.registerHubOverWifi(req.body);
        res.status(201).json({ home, hubSecret });
    });
    openSensorPairingMode = (0, async_handler_1.asyncHandler)(async (req, res) => {
        const session = await this.deviceService.openSensorPairingMode({
            hubMacAddress: (req.headers["x-hub-mac-address"] || req.body.hubMacAddress),
            hubSecret: (req.headers["x-hub-secret"] || req.body.hubSecret),
        });
        res.status(201).json({ sensorPairingSession: session });
    });
    fetchPendingSensorPairing = (0, async_handler_1.asyncHandler)(async (req, res) => {
        const result = await this.deviceService.fetchPendingSensorPairing({
            hubMacAddress: (req.headers["x-hub-mac-address"] || ""),
            hubSecret: (req.headers["x-hub-secret"] || ""),
        });
        res.status(200).json(result);
    });
    fetchHubSensors = (0, async_handler_1.asyncHandler)(async (req, res) => {
        const result = await this.deviceService.fetchHubSensors({
            hubMacAddress: (req.headers["x-hub-mac-address"] || ""),
            hubSecret: (req.headers["x-hub-secret"] || ""),
        });
        res.status(200).json(result);
    });
    ingestCameraFrame = (0, async_handler_1.asyncHandler)(async (req, res) => {
        const result = await this.deviceService.ingestCameraFrame({
            hubMacAddress: (req.headers["x-hub-mac-address"] || ""),
            hubSecret: (req.headers["x-hub-secret"] || ""),
            contentType: req.headers["content-type"],
            frame: req.body,
        });
        res.status(202).json(result);
    });
    ingestHubEvent = (0, async_handler_1.asyncHandler)(async (req, res) => {
        const result = await this.deviceService.ingestHubEvent({
            ...req.body,
            hubMacAddress: req.headers["x-hub-mac-address"] || req.body.hubMacAddress,
            hubSecret: req.headers["x-hub-secret"] || req.body.hubSecret,
        });
        res.status(201).json(result);
    });
}
exports.DeviceController = DeviceController;
