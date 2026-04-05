import { Types } from "mongoose";
import { ApiError } from "../../common/errors/api-error";
import { normalizeMacAddress } from "../../common/utils/mac-address";
import { ActivityLogModel } from "../activity/activity-log.model";
import { HubModel } from "../hubs/hub.model";
import { HomeService } from "../homes/home.service";
import { NotificationModel } from "../notifications/notification.model";
import { NotificationService } from "../notifications/notification.service";
import { SensorModel } from "../sensors/sensor.model";
import { CompleteHubRegistrationInput, DeviceEventInput } from "./device.types";

export class DeviceService {
  constructor(
    private readonly notificationService: NotificationService,
    private readonly homeService: HomeService,
  ) {}

  async registerHubOverWifi(payload: CompleteHubRegistrationInput) {
    return this.homeService.completeHubRegistration(payload);
  }

  async openSensorPairingMode(payload: { hubMacAddress: string; hubSecret: string }) {
    const hubMacAddress = normalizeMacAddress(payload.hubMacAddress);
    const hubSecret = String(payload.hubSecret || "");
    const hub = await HubModel.findOne({ macAddress: hubMacAddress });

    if (!hub) {
      throw new ApiError(404, "Hub not found");
    }
    if (hub.deviceSecret !== hubSecret) {
      throw new ApiError(401, "Invalid hub secret");
    }
    if (!hub.home) {
      throw new ApiError(409, "Hub is not assigned to a home");
    }

    return this.homeService.openSensorPairingMode(hub._id);
  }

  async ingestHubEvent(payload: DeviceEventInput): Promise<{ activityLogId: string; notification: ReturnType<NotificationService["serialize"]> }> {
    const hubMacAddress = normalizeMacAddress(payload.hubMacAddress);
    const sensorMacAddress = payload.sensorMacAddress ? normalizeMacAddress(payload.sensorMacAddress) : null;
    const hubSecret = String(payload.hubSecret || "");

    const hub = await HubModel.findOne({ macAddress: hubMacAddress });
    if (!hub) {
      throw new ApiError(404, "Hub not found");
    }
    if (hub.deviceSecret !== hubSecret) {
      throw new ApiError(401, "Invalid hub secret");
    }
    if (!hub.owner || !hub.home) {
      throw new ApiError(409, "Hub is not registered to any home");
    }

    let sensor = null;
    if (sensorMacAddress) {
      sensor = await SensorModel.findOne({ hub: hub._id, macAddress: sensorMacAddress });
      if (!sensor) {
        throw new ApiError(404, "Sensor not found for this hub");
      }
      sensor.lastActivityAt = new Date();
      sensor.status = "online";
      await sensor.save();
    }

    hub.lastSeenAt = new Date();
    hub.status = "online";
    await hub.save();

    const activityLog = await ActivityLogModel.create({
      user: hub.owner as Types.ObjectId,
      hub: hub._id,
      sensor: sensor?._id || null,
      eventType: payload.eventType,
      severity: payload.severity || "info",
      source: sensor ? "sensor" : "hub",
      payload: payload.payload || {},
    });

    const notification = await NotificationModel.create({
      user: hub.owner as Types.ObjectId,
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

    const populatedNotification = await NotificationModel.findById(notification._id)
      .populate("hub", "name macAddress")
      .populate("sensor", "name macAddress type zone");

    this.notificationService.publishRealtime(populatedNotification);

    return {
      activityLogId: activityLog.id,
      notification: this.notificationService.serialize(populatedNotification),
    };
  }
}
