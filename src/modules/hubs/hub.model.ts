import { HydratedDocument, Model, Schema, Types, model } from "mongoose";

export interface IHub {
  owner: Types.ObjectId | null;
  home: Types.ObjectId | null;
  macAddress: string;
  serialNumber: string | null;
  name: string;
  location: string;
  hardwareModel: string;
  deviceSecret: string;
  pairing: {
    qrNonce: string | null;
    pairingModeEnabledAt: Date | null;
    pairingModeExpiresAt: Date | null;
  };
  capabilities: {
    touchscreen: boolean;
    humiditySensor: boolean;
    co2Sensor: boolean;
    fingerprintSensor: boolean;
  };
  status: "unpaired" | "paired" | "offline" | "online";
  lastSeenAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const hubSchema = new Schema<IHub>(
  {
    owner: { type: Schema.Types.ObjectId, ref: "User", default: null },
    home: { type: Schema.Types.ObjectId, ref: "Home", default: null, unique: true, sparse: true },
    macAddress: { type: String, required: true, unique: true, index: true },
    serialNumber: { type: String, default: null, trim: true },
    name: { type: String, required: true, trim: true },
    location: { type: String, default: "", trim: true },
    hardwareModel: { type: String, default: "ESP32-S3" },
    deviceSecret: { type: String, required: true },
    pairing: {
      qrNonce: { type: String, default: null },
      pairingModeEnabledAt: { type: Date, default: null },
      pairingModeExpiresAt: { type: Date, default: null },
    },
    capabilities: {
      touchscreen: { type: Boolean, default: true },
      humiditySensor: { type: Boolean, default: true },
      co2Sensor: { type: Boolean, default: true },
      fingerprintSensor: { type: Boolean, default: true },
    },
    status: {
      type: String,
      enum: ["unpaired", "paired", "offline", "online"],
      default: "unpaired",
    },
    lastSeenAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export type IHubDocument = HydratedDocument<IHub>;
export const HubModel: Model<IHub> = model<IHub>("Hub", hubSchema);
