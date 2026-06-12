"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DeviceService = void 0;
const api_error_1 = require("../../common/errors/api-error");
const mac_address_1 = require("../../common/utils/mac-address");
const activity_log_model_1 = require("../activity/activity-log.model");
const hub_model_1 = require("../hubs/hub.model");
const notification_model_1 = require("../notifications/notification.model");
const sensor_model_1 = require("../sensors/sensor.model");
class DeviceService {
    notificationService;
    homeService;
    constructor(notificationService, homeService) {
        this.notificationService = notificationService;
        this.homeService = homeService;
    }
    async registerHubOverWifi(payload) {
        return this.homeService.completeHubRegistration(payload);
    }
    async openSensorPairingMode(payload) {
        const hubMacAddress = (0, mac_address_1.normalizeMacAddress)(payload.hubMacAddress);
        const hubSecret = String(payload.hubSecret || "");
        const hub = await hub_model_1.HubModel.findOne({ macAddress: hubMacAddress });
        if (!hub) {
            throw new api_error_1.ApiError(404, "Hub not found");
        }
        if (hub.deviceSecret !== hubSecret) {
            throw new api_error_1.ApiError(401, "Invalid hub secret");
        }
        if (!hub.home) {
            throw new api_error_1.ApiError(409, "Hub is not assigned to a home");
        }
        return this.homeService.openSensorPairingMode(hub._id);
    }
    async fetchPendingSensorPairing(payload) {
        const hubMacAddress = (0, mac_address_1.normalizeMacAddress)(payload.hubMacAddress);
        const hubSecret = String(payload.hubSecret || "");
        const hub = await hub_model_1.HubModel.findOne({ macAddress: hubMacAddress });
        if (!hub)
            throw new api_error_1.ApiError(404, "Hub not found");
        if (hub.deviceSecret !== hubSecret)
            throw new api_error_1.ApiError(401, "Invalid hub secret");
        // Find the oldest sensor for this hub that still has an undelivered provision key
        const sensor = await sensor_model_1.SensorModel.findOne({
            hub: hub._id,
            provisionKey: { $ne: null },
        }).sort({ createdAt: 1 });
        if (!sensor)
            throw new api_error_1.ApiError(404, "No pending sensor pairing for this hub");
        const { macAddress: sensorMacAddress, provisionKey } = sensor;
        // One-time delivery — clear the key so a second fetch returns nothing
        sensor.provisionKey = null;
        await sensor.save();
        return { sensorMacAddress, provisionKey };
    }
    async ingestHubEvent(payload) {
        const hubMacAddress = (0, mac_address_1.normalizeMacAddress)(payload.hubMacAddress);
        const sensorMacAddress = payload.sensorMacAddress ? (0, mac_address_1.normalizeMacAddress)(payload.sensorMacAddress) : null;
        const hubSecret = String(payload.hubSecret || "");
        const hub = await hub_model_1.HubModel.findOne({ macAddress: hubMacAddress });
        if (!hub) {
            throw new api_error_1.ApiError(404, "Hub not found");
        }
        if (hub.deviceSecret !== hubSecret) {
            throw new api_error_1.ApiError(401, "Invalid hub secret");
        }
        if (!hub.owner || !hub.home) {
            throw new api_error_1.ApiError(409, "Hub is not registered to any home");
        }
        let sensor = null;
        if (sensorMacAddress) {
            sensor = await sensor_model_1.SensorModel.findOne({ hub: hub._id, macAddress: sensorMacAddress });
            if (!sensor) {
                throw new api_error_1.ApiError(404, "Sensor not found for this hub");
            }
            sensor.lastActivityAt = new Date();
            sensor.status = "online";
            await sensor.save();
        }
        hub.lastSeenAt = new Date();
        hub.status = "online";
        await hub.save();
        const activityLog = await activity_log_model_1.ActivityLogModel.create({
            user: hub.owner,
            hub: hub._id,
            sensor: sensor?._id || null,
            eventType: payload.eventType,
            severity: payload.severity || "info",
            source: sensor ? "sensor" : "hub",
            payload: payload.payload || {},
        });
        const notification = await notification_model_1.NotificationModel.create({
            user: hub.owner,
            hub: hub._id,
            sensor: sensor?._id || null,
            activityLog: activityLog._id,
            eventType: payload.eventType,
            severity: payload.severity || "info",
            title: `${hub.name}: ${payload.eventType}`,
            message: sensor
                ? `${sensor.name}${sensor.zone ? ` (${sensor.zone})` : ""} reported ${payload.eventType}`
                : `${hub.name} reported ${payload.eventType}`,
            deliveredAt: new Date(),
        });
        const populatedNotification = await notification_model_1.NotificationModel.findById(notification._id)
            .populate("hub", "name macAddress")
            .populate("sensor", "name macAddress type zone");
        this.notificationService.publishRealtime(populatedNotification);
        return {
            activityLogId: activityLog.id,
            notification: this.notificationService.serialize(populatedNotification),
        };
    }
}
exports.DeviceService = DeviceService;
