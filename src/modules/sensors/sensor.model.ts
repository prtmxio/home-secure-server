import { HydratedDocument, Model, Schema, Types, model } from "mongoose";

export interface ISensor {
  hub: Types.ObjectId;
  macAddress: string;
  name: string;
  type: string;
  zone: string;
  hardwareModel: string;
  status: "provisioning" | "paired" | "offline" | "online";
  provisionKey: string | null;   // 32-char hex (16 bytes); cleared once hub fetches it
  provisioning: {
    hubMacAddress: string;
    sensorMacAddress: string;
    sharedAt: Date;
  };
  lastActivityAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const sensorSchema = new Schema<ISensor>(
  {
    hub: { type: Schema.Types.ObjectId, ref: "Hub", required: true, index: true },
    macAddress: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, required: true, trim: true },
    zone: { type: String, default: "", trim: true },
    hardwareModel: { type: String, default: "ESP32-C3 Mini" },
    status: { type: String, enum: ["provisioning", "paired", "offline", "online"], default: "provisioning" },
    provisionKey: { type: String, default: null },
    provisioning: {
      hubMacAddress: { type: String, required: true },
      sensorMacAddress: { type: String, required: true },
      sharedAt: { type: Date, required: true },
    },
    lastActivityAt: { type: Date, default: null },
  },
  { timestamps: true },
);

sensorSchema.index({ hub: 1, macAddress: 1 }, { unique: true });

export type ISensorDocument = HydratedDocument<ISensor>;
export const SensorModel: Model<ISensor> = model<ISensor>("Sensor", sensorSchema);
