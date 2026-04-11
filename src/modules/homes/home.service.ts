import crypto from "crypto";
import { Types } from "mongoose";
import { AppConfig } from "../../config/env";
import { ApiError } from "../../common/errors/api-error";
import { normalizeMacAddress } from "../../common/utils/mac-address";
import { ActivityLogModel } from "../activity/activity-log.model";
import { HubModel, IHub } from "../hubs/hub.model";
import { SensorModel, ISensor } from "../sensors/sensor.model";
import { HomeModel, IHome } from "./home.model";
import { HubSetupSessionModel } from "./hub-setup-session.model";
import { SensorPairingSessionModel } from "./sensor-pairing-session.model";
import {
  CompleteHubRegistrationInput,
  HomeDto,
  HubDto,
  PairHomeSensorInput,
  SensorDto,
  StartHomeSetupInput,
} from "./home.types";

export class HomeService {
  constructor(private readonly config: AppConfig) {}

  async startHubSetup(userId: string | Types.ObjectId, payload: StartHomeSetupInput) {
    if (!payload.homeName) {
      throw new ApiError(400, "homeName is required");
    }

    const hubMacAddress = normalizeMacAddress(payload.hubMacAddress);
    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.pairingSessionTtlSeconds * 1000);
    const provisioningToken = crypto.randomBytes(24).toString("hex");

    await HubSetupSessionModel.updateMany(
      { user: userId, hubMacAddress, status: "pending" },
      { $set: { status: "expired", expiresAt: now } },
    );

    const session = await HubSetupSessionModel.create({
      user: new Types.ObjectId(String(userId)),
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

  async completeHubRegistration(payload: CompleteHubRegistrationInput): Promise<{ home: HomeDto; hubSecret: string }> {
    const hubMacAddress = normalizeMacAddress(payload.hubMacAddress);
    const provisioningToken = String(payload.provisioningToken || "").trim();

    const session = await HubSetupSessionModel.findOne({
      hubMacAddress,
      provisioningToken,
      status: "pending",
      expiresAt: { $gt: new Date() },
    });

    if (!session) {
      throw new ApiError(400, "No active BLE setup session found for this hub");
    }

    let hub = await HubModel.findOne({ macAddress: hubMacAddress });
    if (hub && hub.owner && hub.owner.toString() !== session.user.toString()) {
      throw new ApiError(409, "This hub is already registered to another user");
    }

    if (!hub) {
      hub = await HubModel.create({
        owner: session.user,
        macAddress: hubMacAddress,
        serialNumber: session.serialNumber,
        name: `${session.homeName} Hub`,
        location: session.location,
        hardwareModel: session.hardwareModel,
        deviceSecret: crypto.randomBytes(24).toString("hex"),
        status: "online",
        lastSeenAt: new Date(),
      });
    } else {
      hub.owner = session.user;
      hub.name = `${session.homeName} Hub`;
      hub.location = session.location;
      hub.serialNumber = session.serialNumber;
      hub.hardwareModel = session.hardwareModel;
      hub.status = "online";
      hub.lastSeenAt = new Date();
      await hub.save();
    }

    let home = await HomeModel.findOne({ hub: hub._id });
    if (!home) {
      home = await HomeModel.create({
        owner: session.user,
        name: session.homeName,
        location: session.location,
        hub: hub._id,
      });
    } else {
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

    await ActivityLogModel.create({
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

  async listHomes(userId: string | Types.ObjectId): Promise<HomeDto[]> {
    const homes = await HomeModel.find({ owner: userId }).populate("hub").sort({ createdAt: -1 });
    return Promise.all(homes.map((home) => this.buildHomeDto(home)));
  }

  async getHomeById(userId: string | Types.ObjectId, homeId: string): Promise<HomeDto> {
    const home = await HomeModel.findOne({ _id: homeId, owner: userId }).populate("hub");
    if (!home) {
      throw new ApiError(404, "Home not found");
    }

    return this.buildHomeDto(home);
  }

  async openSensorPairingMode(hubId: string | Types.ObjectId) {
    const home = await HomeModel.findOne({ hub: hubId });
    if (!home) {
      throw new ApiError(404, "Home not found for this hub");
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + this.config.pairingSessionTtlSeconds * 1000);

    await SensorPairingSessionModel.updateMany(
      { hub: hubId, status: "active" },
      { $set: { status: "expired", expiresAt: now } },
    );

    const session = await SensorPairingSessionModel.create({
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

  async pairSensorToHome(
    userId: string | Types.ObjectId,
    homeId: string,
    payload: PairHomeSensorInput,
  ): Promise<{
    home: HomeDto;
    sensor: SensorDto;
    provisioning: {
      hub: { hubMacAddress: string; pairedSensorMacAddress: string };
      sensor: { sensorMacAddress: string; targetHubMacAddress: string };
    };
  }> {
    const home = await HomeModel.findOne({ _id: homeId, owner: userId }).populate("hub");
    if (!home || !home.hub) {
      throw new ApiError(404, "Home not found");
    }

    const hub = home.hub as unknown as IHub & { _id: Types.ObjectId; id: string };
    const session = await SensorPairingSessionModel.findOne({
      home: home._id,
      hub: hub._id,
      status: "active",
      expiresAt: { $gt: new Date() },
    });

    if (!session) {
      throw new ApiError(400, "Hub sensor pairing mode is not active");
    }

    const sensorMacAddress = normalizeMacAddress(payload.sensorMacAddress);
    const existingSensor = await SensorModel.findOne({ macAddress: sensorMacAddress });
    if (existingSensor && existingSensor.hub.toString() !== hub.id) {
      throw new ApiError(409, "This sensor is already paired with another hub");
    }

    const sensor = existingSensor ?? new SensorModel({ macAddress: sensorMacAddress, hub: hub._id });
    sensor.name = payload.name || sensor.name || `Sensor ${sensorMacAddress.slice(-5)}`;
    sensor.type = payload.type || sensor.type || "contact";
    sensor.zone = payload.zone || sensor.zone || "";
    sensor.hardwareModel = payload.hardwareModel || sensor.hardwareModel || "ESP32-C3 Mini";
    sensor.provisioning = {
      hubMacAddress: hub.macAddress,
      sensorMacAddress,
      sharedAt: new Date(),
    };
    sensor.status = "paired";
    await sensor.save();

    session.status = "completed";
    session.completedAt = new Date();
    await session.save();

    await ActivityLogModel.create({
      user: new Types.ObjectId(String(userId)),
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

  private async buildHomeDto(home: IHome & { _id?: Types.ObjectId; id?: string; hub?: unknown }): Promise<HomeDto> {
    const hub = home.hub as unknown as IHub & { _id: Types.ObjectId; id: string };
    const sensors = await SensorModel.find({ hub: hub._id }).sort({ createdAt: 1 }).lean();

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

  private serializeHub(hub: IHub & { _id?: Types.ObjectId; id?: string }): HubDto {
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

  private serializeSensor(sensor: ISensor & { _id?: Types.ObjectId; id?: string }): SensorDto {
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
      provisioning: sensor.provisioning,
      createdAt: sensor.createdAt,
      updatedAt: sensor.updatedAt,
    };
  }
}
