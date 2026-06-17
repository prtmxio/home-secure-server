import { EventEmitter } from "events";
import { Types } from "mongoose";
import { ApiError } from "../../common/errors/api-error";
import { normalizeMacAddress } from "../../common/utils/mac-address";
import { ActivityLogModel } from "../activity/activity-log.model";
import { HomeModel } from "../homes/home.model";
import { HubModel } from "../hubs/hub.model";
import { DoorLockCommandModel, IDoorLockCommand } from "./door-lock.model";
import { DoorLockAckInput, DoorLockCommandDto } from "./door-lock.types";

const AUTO_LOCK_DURATION_MS = 3000;
const MAX_TOGGLE_DURATION_MS = 10000;

export class DoorLockService {
  private readonly events = new EventEmitter();

  async createAutoLockCommand(userId: string | Types.ObjectId, homeId: string): Promise<DoorLockCommandDto> {
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

  async createToggleCommand(
    userId: string | Types.ObjectId,
    homeId: string,
    payload: { state?: string; durationMs?: number },
  ): Promise<DoorLockCommandDto> {
    const state = String(payload.state || "").toLowerCase();
    if (state !== "on" && state !== "off") {
      throw new ApiError(400, "state must be 'on' or 'off'");
    }

    let durationMs = 0;
    if (state === "on") {
      durationMs = payload.durationMs === undefined ? MAX_TOGGLE_DURATION_MS : Number(payload.durationMs);
      if (!Number.isInteger(durationMs) || durationMs <= 0 || durationMs > MAX_TOGGLE_DURATION_MS) {
        throw new ApiError(400, "durationMs for toggle on must be between 1 and 10000");
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

  async getLatestForHome(userId: string | Types.ObjectId, homeId: string): Promise<DoorLockCommandDto | null> {
    const { hub } = await this.getOwnedHomeAndHub(userId, homeId);
    const command = await DoorLockCommandModel.findOne({ hub: hub._id }).sort({ createdAt: -1 });
    return command ? this.serialize(command) : null;
  }

  async authenticateHub(payload: { hubMacAddress: string; hubSecret: string }) {
    const hubMacAddress = normalizeMacAddress(payload.hubMacAddress);
    const hubSecret = String(payload.hubSecret || "");
    const hub = await HubModel.findOne({ macAddress: hubMacAddress });
    if (!hub) throw new ApiError(404, "Hub not found");
    if (hub.deviceSecret !== hubSecret) throw new ApiError(401, "Invalid hub secret");
    if (!hub.home || !hub.owner) throw new ApiError(409, "Hub is not registered to any home");
    return hub;
  }

  async getQueuedForHub(hubId: string | Types.ObjectId): Promise<DoorLockCommandDto | null> {
    const command = await DoorLockCommandModel.findOne({ hub: hubId, status: "queued" }).sort({ createdAt: -1 });
    if (!command) return null;

    return this.markDelivered(command.id, hubId);
  }

  async markDelivered(commandId: string, hubId: string | Types.ObjectId): Promise<DoorLockCommandDto> {
    const command = await DoorLockCommandModel.findOne({ _id: commandId, hub: hubId });
    if (!command) throw new ApiError(404, "Door lock command not found for this hub");
    if (command.status === "queued") {
      command.status = "delivered";
      command.deliveredAt = new Date();
      await command.save();
    }
    return this.serialize(command);
  }

  async ackHubCommand(hubId: string | Types.ObjectId, payload: DoorLockAckInput): Promise<DoorLockCommandDto> {
    const command = await DoorLockCommandModel.findOne({ _id: payload.commandId, hub: hubId });
    if (!command) throw new ApiError(404, "Door lock command not found for this hub");
    if (command.status === "superseded") throw new ApiError(409, "Door lock command was superseded");

    const now = new Date();
    if (payload.status === "executed") {
      command.status = "executed";
      command.executedAt = now;
      command.failedAt = null;
      command.error = null;
    } else if (payload.status === "failed") {
      command.status = "failed";
      command.failedAt = now;
      command.error = String(payload.error || "Hub failed to execute lock command").slice(0, 300);
    } else {
      throw new ApiError(400, "status must be 'executed' or 'failed'");
    }

    if (payload.lockState === "locked" || payload.lockState === "unlocked") {
      command.lockState = payload.lockState;
    }
    await command.save();

    await ActivityLogModel.create({
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

  onCommand(handler: (command: DoorLockCommandDto) => void): () => void {
    this.events.on("command", handler);
    return () => this.events.off("command", handler);
  }

  private async createCommand(payload: {
    userId: string | Types.ObjectId;
    homeId: Types.ObjectId;
    hubId: Types.ObjectId;
    mode: "auto_lock" | "toggle";
    action: "open" | "on" | "off";
    durationMs: number;
  }) {
    await DoorLockCommandModel.updateMany(
      { hub: payload.hubId, status: { $in: ["queued", "delivered"] } },
      { $set: { status: "superseded" } },
    );

    const command = await DoorLockCommandModel.create({
      home: payload.homeId,
      hub: payload.hubId,
      requestedBy: new Types.ObjectId(String(payload.userId)),
      mode: payload.mode,
      action: payload.action,
      durationMs: payload.durationMs,
      status: "queued",
    });

    await ActivityLogModel.create({
      user: new Types.ObjectId(String(payload.userId)),
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

  private async getOwnedHomeAndHub(userId: string | Types.ObjectId, homeId: string) {
    const home = await HomeModel.findOne({ _id: homeId, owner: userId });
    if (!home) throw new ApiError(404, "Home not found");

    const hub = await HubModel.findOne({ _id: home.hub, owner: userId });
    if (!hub) throw new ApiError(404, "Hub not found for this home");

    return { home, hub };
  }

  private serialize(command: IDoorLockCommand & { _id?: Types.ObjectId; id?: string }): DoorLockCommandDto {
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
