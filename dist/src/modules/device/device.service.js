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
    cameraRelay;
    cameraFrameLogCounts = new Map();
    constructor(notificationService, homeService, cameraRelay) {
        this.notificationService = notificationService;
        this.homeService = homeService;
        this.cameraRelay = cameraRelay;
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
    async confirmSensorPairing(payload) {
        const hub = await this.authenticateHub(payload);
        const sensorMacAddress = (0, mac_address_1.normalizeMacAddress)(payload.sensorMacAddress);
        const sensor = await sensor_model_1.SensorModel.findOne({
            hub: hub._id,
            macAddress: sensorMacAddress,
        });
        if (!sensor) {
            throw new api_error_1.ApiError(404, "Sensor not found for this hub");
        }
        const wasProvisioning = sensor.status === "provisioning";
        sensor.status = "paired";
        sensor.provisionKey = null;
        sensor.lastActivityAt = new Date();
        await sensor.save();
        hub.lastSeenAt = new Date();
        hub.status = "online";
        await hub.save();
        if (wasProvisioning) {
            await activity_log_model_1.ActivityLogModel.create({
                user: hub.owner,
                hub: hub._id,
                sensor: sensor._id,
                eventType: "sensor_paired",
                severity: "info",
                source: "hub",
                payload: {
                    hubMacAddress: hub.macAddress,
                    sensorMacAddress,
                },
            });
        }
        return {
            paired: true,
            sensor: {
                sensorMacAddress: sensor.macAddress,
                name: sensor.name,
                type: sensor.type,
                zone: sensor.zone,
                status: sensor.status,
            },
        };
    }
    async fetchHubSensors(payload) {
        const hub = await this.authenticateHub(payload);
        const sensors = await sensor_model_1.SensorModel.find({
            hub: hub._id,
            status: { $ne: "provisioning" },
        }).sort({ createdAt: 1 });
        return {
            sensors: sensors.map((sensor) => ({
                sensorMacAddress: sensor.macAddress,
                name: sensor.name,
                type: sensor.type,
                zone: sensor.zone,
                status: sensor.status,
            })),
        };
    }
    async ingestCameraFrame(payload) {
        if (!payload.contentType?.toLowerCase().startsWith("image/jpeg")) {
            console.warn(`[CAMERA] Rejected frame hub_mac=${payload.hubMacAddress || "missing"} reason=bad_content_type content_type=${payload.contentType || "missing"}`);
            throw new api_error_1.ApiError(415, "Camera frame must be image/jpeg");
        }
        if (!Buffer.isBuffer(payload.frame) || payload.frame.length === 0) {
            console.warn(`[CAMERA] Rejected frame hub_mac=${payload.hubMacAddress || "missing"} reason=empty_body`);
            throw new api_error_1.ApiError(400, "Camera frame body is required");
        }
        const hub = await this.authenticateHub(payload);
        this.cameraRelay.publishFrame(hub.home.toString(), payload.frame);
        const frameCount = (this.cameraFrameLogCounts.get(hub.id) || 0) + 1;
        this.cameraFrameLogCounts.set(hub.id, frameCount);
        if (frameCount === 1 || frameCount % 30 === 0) {
            console.info(`[CAMERA] Accepted frame hub=${hub.id} mac=${hub.macAddress} home=${hub.home.toString()} bytes=${payload.frame.length} count=${frameCount}`);
        }
        hub.lastSeenAt = new Date();
        hub.status = "online";
        await hub.save();
        return { accepted: true, bytes: payload.frame.length, capturedAt: new Date() };
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
            if (sensor.status === "provisioning") {
                throw new api_error_1.ApiError(409, "Sensor pairing has not been confirmed by the hub");
            }
            sensor.lastActivityAt = new Date();
            sensor.status = "online";
            await sensor.save();
        }
        hub.lastSeenAt = new Date();
        hub.status = "online";
        await hub.save();
        const severity = payload.severity || this.defaultSeverityForEvent(payload.eventType);
        const notificationContent = this.notificationContentForEvent({
            hubName: hub.name,
            sensorName: sensor?.name || "",
            sensorZone: sensor?.zone || "",
            eventType: payload.eventType,
        });
        const activityLog = await activity_log_model_1.ActivityLogModel.create({
            user: hub.owner,
            hub: hub._id,
            sensor: sensor?._id || null,
            eventType: payload.eventType,
            severity,
            source: sensor ? "sensor" : "hub",
            payload: payload.payload || {},
        });
        const notification = await notification_model_1.NotificationModel.create({
            user: hub.owner,
            hub: hub._id,
            sensor: sensor?._id || null,
            activityLog: activityLog._id,
            eventType: payload.eventType,
            severity,
            title: notificationContent.title,
            message: notificationContent.message,
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
    defaultSeverityForEvent(eventType) {
        if (eventType === "door_opened" || eventType === "shock_detected") {
            return "critical";
        }
        return "info";
    }
    notificationContentForEvent(payload) {
        const sensorLabel = payload.sensorName
            ? `${payload.sensorName}${payload.sensorZone ? ` (${payload.sensorZone})` : ""}`
            : payload.hubName;
        if (payload.eventType === "door_opened") {
            return {
                title: "Door opened",
                message: `${sensorLabel} magnetic reed sensor detected door opening.`,
            };
        }
        if (payload.eventType === "shock_detected") {
            return {
                title: "Shock detected",
                message: `${sensorLabel} vibration sensor detected shock.`,
            };
        }
        return {
            title: `${payload.hubName}: ${payload.eventType}`,
            message: payload.sensorName
                ? `${sensorLabel} reported ${payload.eventType}`
                : `${payload.hubName} reported ${payload.eventType}`,
        };
    }
    async authenticateHub(payload) {
        const hubMacAddress = (0, mac_address_1.normalizeMacAddress)(payload.hubMacAddress);
        const hubSecret = String(payload.hubSecret || "");
        const hub = await hub_model_1.HubModel.findOne({ macAddress: hubMacAddress });
        if (!hub)
            throw new api_error_1.ApiError(404, "Hub not found");
        if (hub.deviceSecret !== hubSecret)
            throw new api_error_1.ApiError(401, "Invalid hub secret");
        if (!hub.owner || !hub.home)
            throw new api_error_1.ApiError(409, "Hub is not registered to any home");
        return hub;
    }
}
exports.DeviceService = DeviceService;
