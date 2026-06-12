"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.HomeService = void 0;
const crypto_1 = __importDefault(require("crypto"));
const mongoose_1 = require("mongoose");
const api_error_1 = require("../../common/errors/api-error");
const mac_address_1 = require("../../common/utils/mac-address");
const activity_log_model_1 = require("../activity/activity-log.model");
const hub_model_1 = require("../hubs/hub.model");
const sensor_model_1 = require("../sensors/sensor.model");
const home_model_1 = require("./home.model");
const hub_setup_session_model_1 = require("./hub-setup-session.model");
const sensor_pairing_session_model_1 = require("./sensor-pairing-session.model");
class HomeService {
    config;
    constructor(config) {
        this.config = config;
    }
    async startHubSetup(userId, payload) {
        if (!payload.homeName) {
            throw new api_error_1.ApiError(400, "homeName is required");
        }
        const hubMacAddress = (0, mac_address_1.normalizeMacAddress)(payload.hubMacAddress);
        const now = new Date();
        const expiresAt = new Date(now.getTime() + this.config.pairingSessionTtlSeconds * 1000);
        const provisioningToken = crypto_1.default.randomBytes(24).toString("hex");
        await hub_setup_session_model_1.HubSetupSessionModel.updateMany({ user: userId, hubMacAddress, status: "pending" }, { $set: { status: "expired", expiresAt: now } });
        const session = await hub_setup_session_model_1.HubSetupSessionModel.create({
            user: new mongoose_1.Types.ObjectId(String(userId)),
            hubMacAddress,
            homeName: payload.homeName.trim(),
            location: String(payload.location || "").trim(),
            provisioningToken,
            serialNumber: payload.serialNumber || null,
            hardwareModel: payload.hardwareModel || "ESP32-S3",
            status: "pending",
            expiresAt,
        });
        return {
            setupSessionId: session.id,
            hubMacAddress,
            provisioningToken,
            expiresAt,
            bleProvisioning: {
                hubMacAddress,
                provisioningToken,
            },
        };
    }
    async completeHubRegistration(payload) {
        const hubMacAddress = (0, mac_address_1.normalizeMacAddress)(payload.hubMacAddress);
        const provisioningToken = String(payload.provisioningToken || "").trim();
        const session = await hub_setup_session_model_1.HubSetupSessionModel.findOne({
            hubMacAddress,
            provisioningToken,
            status: "pending",
            expiresAt: { $gt: new Date() },
        });
        if (!session) {
            throw new api_error_1.ApiError(400, "No active BLE setup session found for this hub");
        }
        let hub = await hub_model_1.HubModel.findOne({ macAddress: hubMacAddress });
        if (hub && hub.owner && hub.owner.toString() !== session.user.toString()) {
            throw new api_error_1.ApiError(409, "This hub is already registered to another user");
        }
        if (!hub) {
            hub = await hub_model_1.HubModel.create({
                owner: session.user,
                macAddress: hubMacAddress,
                serialNumber: session.serialNumber,
                name: `${session.homeName} Hub`,
                location: session.location,
                hardwareModel: session.hardwareModel,
                deviceSecret: crypto_1.default.randomBytes(24).toString("hex"),
                status: "online",
                lastSeenAt: new Date(),
            });
        }
        else {
            hub.owner = session.user;
            hub.name = `${session.homeName} Hub`;
            hub.location = session.location;
            hub.serialNumber = session.serialNumber;
            hub.hardwareModel = session.hardwareModel;
            hub.status = "online";
            hub.lastSeenAt = new Date();
            await hub.save();
        }
        let home = await home_model_1.HomeModel.findOne({ hub: hub._id });
        if (!home) {
            home = await home_model_1.HomeModel.create({
                owner: session.user,
                name: session.homeName,
                location: session.location,
                hub: hub._id,
            });
        }
        else {
            home.owner = session.user;
            home.name = session.homeName;
            home.location = session.location;
            await home.save();
        }
        hub.home = home._id;
        await hub.save();
        session.status = "completed";
        session.completedAt = new Date();
        await session.save();
        await activity_log_model_1.ActivityLogModel.create({
            user: session.user,
            hub: hub._id,
            eventType: "hub_registered_over_ble",
            severity: "info",
            source: "system",
            payload: {
                homeId: home._id.toString(),
                hubMacAddress,
            },
        });
        return {
            home: await this.getHomeById(session.user, home.id),
            hubSecret: hub.deviceSecret,
        };
    }
    async listHomes(userId) {
        const homes = await home_model_1.HomeModel.find({ owner: userId })
            .populate("hub")
            .sort({ createdAt: -1 });
        return Promise.all(homes.map((home) => this.buildHomeDto(home)));
    }
    async getHomeById(userId, homeId) {
        const home = await home_model_1.HomeModel.findOne({
            _id: homeId,
            owner: userId,
        }).populate("hub");
        if (!home) {
            throw new api_error_1.ApiError(404, "Home not found");
        }
        return this.buildHomeDto(home);
    }
    async openSensorPairingMode(hubId) {
        const home = await home_model_1.HomeModel.findOne({ hub: hubId });
        if (!home) {
            throw new api_error_1.ApiError(404, "Home not found for this hub");
        }
        const now = new Date();
        const expiresAt = new Date(now.getTime() + this.config.pairingSessionTtlSeconds * 1000);
        await sensor_pairing_session_model_1.SensorPairingSessionModel.updateMany({ hub: hubId, status: "active" }, { $set: { status: "expired", expiresAt: now } });
        const session = await sensor_pairing_session_model_1.SensorPairingSessionModel.create({
            home: home._id,
            hub: hubId,
            status: "active",
            activatedAt: now,
            expiresAt,
        });
        return {
            sensorPairingSessionId: session.id,
            homeId: home.id,
            hubId: String(hubId),
            activatedAt: now,
            expiresAt,
        };
    }
    async pairSensorToHome(userId, homeId, payload) {
        const home = await home_model_1.HomeModel.findOne({
            _id: homeId,
            owner: userId,
        }).populate("hub");
        if (!home || !home.hub) {
            throw new api_error_1.ApiError(404, "Home not found");
        }
        const hub = home.hub;
        const sensorMacAddress = (0, mac_address_1.normalizeMacAddress)(payload.sensorMacAddress);
        const existingSensor = await sensor_model_1.SensorModel.findOne({
            macAddress: sensorMacAddress,
        });
        if (existingSensor && existingSensor.hub.toString() !== hub.id) {
            throw new api_error_1.ApiError(409, "This sensor is already paired with another hub");
        }
        if (!existingSensor) {
            const sensorCount = await sensor_model_1.SensorModel.countDocuments({ hub: hub._id });
            if (sensorCount >= 20) {
                throw new api_error_1.ApiError(409, "Hub has reached the maximum number of paired sensors (20)");
            }
        }
        const sensor = existingSensor ??
            new sensor_model_1.SensorModel({ macAddress: sensorMacAddress, hub: hub._id });
        sensor.name =
            payload.name || sensor.name || `Sensor ${sensorMacAddress.slice(-5)}`;
        sensor.type = payload.type || sensor.type || "contact";
        sensor.zone = payload.zone || sensor.zone || "";
        sensor.hardwareModel =
            payload.hardwareModel || sensor.hardwareModel || "ESP32-C3 Mini";
        // Generate a 16-byte provision key (= ESP-NOW LMK).
        // Returned to the phone so it can push the key to the sensor over BLE.
        // Cleared on the server once the hub has fetched it (one-time delivery).
        const provisionKey = crypto_1.default.randomBytes(16).toString("hex");
        sensor.provisionKey = provisionKey;
        sensor.status = "provisioning";
        sensor.provisioning = {
            hubMacAddress: hub.macAddress,
            sensorMacAddress,
            sharedAt: new Date(),
        };
        sensor.status = "paired";
        await sensor.save();
        await activity_log_model_1.ActivityLogModel.create({
            user: new mongoose_1.Types.ObjectId(String(userId)),
            hub: hub._id,
            sensor: sensor._id,
            eventType: "sensor_paired",
            severity: "info",
            source: "mobile",
            payload: {
                homeId,
                hubMacAddress: hub.macAddress,
                sensorMacAddress,
            },
        });
        return {
            home: await this.getHomeById(userId, homeId),
            sensor: this.serializeSensor(sensor),
            provisioning: {
                hub: {
                    hubMacAddress: hub.macAddress,
                    pairedSensorMacAddress: sensor.macAddress,
                },
                sensor: {
                    sensorMacAddress: sensor.macAddress,
                    targetHubMacAddress: hub.macAddress,
                },
            },
        };
    }
    async buildHomeDto(home) {
        const hub = home.hub;
        const sensors = await sensor_model_1.SensorModel.find({ hub: hub._id })
            .sort({ createdAt: 1 })
            .lean();
        return {
            id: home.id || String(home._id),
            name: home.name,
            location: home.location,
            createdAt: home.createdAt,
            updatedAt: home.updatedAt,
            hub: this.serializeHub(hub),
            sensors: sensors.map((sensor) => this.serializeSensor(sensor)),
        };
    }
    serializeHub(hub) {
        return {
            id: hub.id || String(hub._id),
            name: hub.name,
            location: hub.location,
            macAddress: hub.macAddress,
            serialNumber: hub.serialNumber,
            hardwareModel: hub.hardwareModel,
            status: hub.status,
            lastSeenAt: hub.lastSeenAt,
            createdAt: hub.createdAt,
            updatedAt: hub.updatedAt,
        };
    }
    serializeSensor(sensor) {
        return {
            id: sensor.id || String(sensor._id),
            hubId: sensor.hub.toString(),
            macAddress: sensor.macAddress,
            name: sensor.name,
            type: sensor.type,
            zone: sensor.zone,
            hardwareModel: sensor.hardwareModel,
            status: sensor.status,
            lastActivityAt: sensor.lastActivityAt,
            provisioning: {
                hubMacAddress: sensor.provisioning.hubMacAddress,
                sensorMacAddress: sensor.provisioning.sensorMacAddress,
                provisionKey: sensor.provisionKey ?? null,
                sharedAt: sensor.provisioning.sharedAt,
            },
            createdAt: sensor.createdAt,
            updatedAt: sensor.updatedAt,
        };
    }
}
exports.HomeService = HomeService;
