import { Types } from "mongoose";
import { ApiError } from "../../common/errors/api-error";
import { normalizeMacAddress } from "../../common/utils/mac-address";
import { ActivityLogModel } from "../activity/activity-log.model";
import { CameraRelay } from "../camera/camera-relay";
import { HubModel } from "../hubs/hub.model";
import { HomeService } from "../homes/home.service";
import { NotificationModel } from "../notifications/notification.model";
import { NotificationService } from "../notifications/notification.service";
import { SensorModel } from "../sensors/sensor.model";
import { CompleteHubRegistrationInput, DeviceEventInput } from "./device.types";

export class DeviceService {
  private readonly cameraFrameLogCounts = new Map<string, number>();

  constructor(
    private readonly notificationService: NotificationService,
    private readonly homeService: HomeService,
    private readonly cameraRelay: CameraRelay,
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

  async fetchPendingSensorPairing(payload: { hubMacAddress: string; hubSecret: string }) {
    const hubMacAddress = normalizeMacAddress(payload.hubMacAddress);
    const hubSecret = String(payload.hubSecret || "");

    const hub = await HubModel.findOne({ macAddress: hubMacAddress });
    if (!hub) throw new ApiError(404, "Hub not found");
    if (hub.deviceSecret !== hubSecret) throw new ApiError(401, "Invalid hub secret");

    // Find the oldest sensor for this hub that still has an undelivered provision key
    const sensor = await SensorModel.findOne({
      hub: hub._id,
      provisionKey: { $ne: null },
    }).sort({ createdAt: 1 });

    if (!sensor) throw new ApiError(404, "No pending sensor pairing for this hub");

    const { macAddress: sensorMacAddress, provisionKey } = sensor;

    // One-time delivery — clear the key so a second fetch returns nothing
    sensor.provisionKey = null;
    await sensor.save();

    return { sensorMacAddress, provisionKey };
  }

  async fetchHubSensors(payload: { hubMacAddress: string; hubSecret: string }) {
    const hub = await this.authenticateHub(payload);
    const sensors = await SensorModel.find({ hub: hub._id }).sort({ createdAt: 1 });

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

  async ingestCameraFrame(payload: { hubMacAddress: string; hubSecret: string; frame: Buffer; contentType?: string }) {
    if (!payload.contentType?.toLowerCase().startsWith("image/jpeg")) {
      console.warn(`[CAMERA] Rejected frame hub_mac=${payload.hubMacAddress || "missing"} reason=bad_content_type content_type=${payload.contentType || "missing"}`);
      throw new ApiError(415, "Camera frame must be image/jpeg");
    }
    if (!Buffer.isBuffer(payload.frame) || payload.frame.length === 0) {
      console.warn(`[CAMERA] Rejected frame hub_mac=${payload.hubMacAddress || "missing"} reason=empty_body`);
      throw new ApiError(400, "Camera frame body is required");
    }

    const hub = await this.authenticateHub(payload);
    this.cameraRelay.publishFrame(hub.home!.toString(), payload.frame);

    const frameCount = (this.cameraFrameLogCounts.get(hub.id) || 0) + 1;
    this.cameraFrameLogCounts.set(hub.id, frameCount);
    if (frameCount === 1 || frameCount % 30 === 0) {
      console.info(`[CAMERA] Accepted frame hub=${hub.id} mac=${hub.macAddress} home=${hub.home!.toString()} bytes=${payload.frame.length} count=${frameCount}`);
    }

    hub.lastSeenAt = new Date();
    hub.status = "online";
    await hub.save();

    return { accepted: true, bytes: payload.frame.length, capturedAt: new Date() };
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

  private async authenticateHub(payload: { hubMacAddress: string; hubSecret: string }) {
    const hubMacAddress = normalizeMacAddress(payload.hubMacAddress);
    const hubSecret = String(payload.hubSecret || "");
    const hub = await HubModel.findOne({ macAddress: hubMacAddress });
    if (!hub) throw new ApiError(404, "Hub not found");
    if (hub.deviceSecret !== hubSecret) throw new ApiError(401, "Invalid hub secret");
    if (!hub.owner || !hub.home) throw new ApiError(409, "Hub is not registered to any home");
    return hub;
  }
}
