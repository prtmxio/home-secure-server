"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DoorLockService = void 0;
const events_1 = require("events");
const mongoose_1 = require("mongoose");
const api_error_1 = require("../../common/errors/api-error");
const mac_address_1 = require("../../common/utils/mac-address");
const activity_log_model_1 = require("../activity/activity-log.model");
const home_model_1 = require("../homes/home.model");
const hub_model_1 = require("../hubs/hub.model");
const door_lock_model_1 = require("./door-lock.model");
const AUTO_LOCK_DURATION_MS = 3000;
const MAX_TOGGLE_DURATION_MS = 10000;
class DoorLockService {
    events = new events_1.EventEmitter();
    async createAutoLockCommand(userId, homeId) {
        const { home, hub } = await this.getOwnedHomeAndHub(userId, homeId);
        return this.createCommand({
            userId,
            homeId: home._id,
            hubId: hub._id,
            mode: "auto_lock",
            action: "open",
            durationMs: AUTO_LOCK_DURATION_MS,
        });
    }
    async createToggleCommand(userId, homeId, payload) {
        const state = String(payload.state || "").toLowerCase();
        if (state !== "on" && state !== "off") {
            throw new api_error_1.ApiError(400, "state must be 'on' or 'off'");
        }
        let durationMs = 0;
        if (state === "on") {
            durationMs = payload.durationMs === undefined ? MAX_TOGGLE_DURATION_MS : Number(payload.durationMs);
            if (!Number.isInteger(durationMs) || durationMs <= 0 || durationMs > MAX_TOGGLE_DURATION_MS) {
                throw new api_error_1.ApiError(400, "durationMs for toggle on must be between 1 and 10000");
            }
        }
        const { home, hub } = await this.getOwnedHomeAndHub(userId, homeId);
        return this.createCommand({
            userId,
            homeId: home._id,
            hubId: hub._id,
            mode: "toggle",
            action: state,
            durationMs,
        });
    }
    async getLatestForHome(userId, homeId) {
        const { hub } = await this.getOwnedHomeAndHub(userId, homeId);
        const command = await door_lock_model_1.DoorLockCommandModel.findOne({ hub: hub._id }).sort({ createdAt: -1 });
        return command ? this.serialize(command) : null;
    }
    async authenticateHub(payload) {
        const hubMacAddress = (0, mac_address_1.normalizeMacAddress)(payload.hubMacAddress);
        const hubSecret = String(payload.hubSecret || "");
        const hub = await hub_model_1.HubModel.findOne({ macAddress: hubMacAddress });
        if (!hub)
            throw new api_error_1.ApiError(404, "Hub not found");
        if (hub.deviceSecret !== hubSecret)
            throw new api_error_1.ApiError(401, "Invalid hub secret");
        if (!hub.home || !hub.owner)
            throw new api_error_1.ApiError(409, "Hub is not registered to any home");
        return hub;
    }
    async getQueuedForHub(hubId) {
        const command = await door_lock_model_1.DoorLockCommandModel.findOne({ hub: hubId, status: "queued" }).sort({ createdAt: -1 });
        if (!command)
            return null;
        return this.markDelivered(command.id, hubId);
    }
    async markDelivered(commandId, hubId) {
        const command = await door_lock_model_1.DoorLockCommandModel.findOne({ _id: commandId, hub: hubId });
        if (!command)
            throw new api_error_1.ApiError(404, "Door lock command not found for this hub");
        if (command.status === "queued") {
            command.status = "delivered";
            command.deliveredAt = new Date();
            await command.save();
        }
        return this.serialize(command);
    }
    async ackHubCommand(hubId, payload) {
        const command = await door_lock_model_1.DoorLockCommandModel.findOne({ _id: payload.commandId, hub: hubId });
        if (!command)
            throw new api_error_1.ApiError(404, "Door lock command not found for this hub");
        if (command.status === "superseded")
            throw new api_error_1.ApiError(409, "Door lock command was superseded");
        const now = new Date();
        if (payload.status === "executed") {
            command.status = "executed";
            command.executedAt = now;
            command.failedAt = null;
            command.error = null;
        }
        else if (payload.status === "failed") {
            command.status = "failed";
            command.failedAt = now;
            command.error = String(payload.error || "Hub failed to execute lock command").slice(0, 300);
        }
        else {
            throw new api_error_1.ApiError(400, "status must be 'executed' or 'failed'");
        }
        if (payload.lockState === "locked" || payload.lockState === "unlocked") {
            command.lockState = payload.lockState;
        }
        await command.save();
        await activity_log_model_1.ActivityLogModel.create({
            user: command.requestedBy,
            hub: command.hub,
            sensor: null,
            eventType: `door_lock_${command.status}`,
            severity: command.status === "failed" ? "warning" : "info",
            source: "hub",
            payload: {
                commandId: command.id,
                mode: command.mode,
                action: command.action,
                durationMs: command.durationMs,
                lockState: command.lockState,
                error: command.error,
            },
        });
        return this.serialize(command);
    }
    onCommand(handler) {
        this.events.on("command", handler);
        return () => this.events.off("command", handler);
    }
    async createCommand(payload) {
        await door_lock_model_1.DoorLockCommandModel.updateMany({ hub: payload.hubId, status: { $in: ["queued", "delivered"] } }, { $set: { status: "superseded" } });
        const command = await door_lock_model_1.DoorLockCommandModel.create({
            home: payload.homeId,
            hub: payload.hubId,
            requestedBy: new mongoose_1.Types.ObjectId(String(payload.userId)),
            mode: payload.mode,
            action: payload.action,
            durationMs: payload.durationMs,
            status: "queued",
        });
        await activity_log_model_1.ActivityLogModel.create({
            user: new mongoose_1.Types.ObjectId(String(payload.userId)),
            hub: payload.hubId,
            sensor: null,
            eventType: "door_lock_command_queued",
            severity: "info",
            source: "mobile",
            payload: {
                commandId: command.id,
                mode: command.mode,
                action: command.action,
                durationMs: command.durationMs,
            },
        });
        const dto = this.serialize(command);
        this.events.emit("command", dto);
        return dto;
    }
    async getOwnedHomeAndHub(userId, homeId) {
        const home = await home_model_1.HomeModel.findOne({ _id: homeId, owner: userId });
        if (!home)
            throw new api_error_1.ApiError(404, "Home not found");
        const hub = await hub_model_1.HubModel.findOne({ _id: home.hub, owner: userId });
        if (!hub)
            throw new api_error_1.ApiError(404, "Hub not found for this home");
        return { home, hub };
    }
    serialize(command) {
        return {
            id: command.id || String(command._id),
            homeId: command.home.toString(),
            hubId: command.hub.toString(),
            mode: command.mode,
            action: command.action,
            durationMs: command.durationMs,
            status: command.status,
            deliveredAt: command.deliveredAt,
            executedAt: command.executedAt,
            failedAt: command.failedAt,
            error: command.error,
            lockState: command.lockState,
            createdAt: command.createdAt,
            updatedAt: command.updatedAt,
        };
    }
}
exports.DoorLockService = DoorLockService;
