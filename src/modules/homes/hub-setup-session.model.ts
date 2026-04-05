import { HydratedDocument, Model, Schema, Types, model } from "mongoose";

export interface IHubSetupSession {
  user: Types.ObjectId;
  hubMacAddress: string;
  homeName: string;
  location: string;
  provisioningToken: string;
  serialNumber: string | null;
  hardwareModel: string;
  status: "pending" | "completed" | "expired";
  expiresAt: Date;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const hubSetupSessionSchema = new Schema<IHubSetupSession>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    hubMacAddress: { type: String, required: true, index: true },
    homeName: { type: String, required: true, trim: true },
    location: { type: String, default: "", trim: true },
    provisioningToken: { type: String, required: true, index: true },
    serialNumber: { type: String, default: null, trim: true },
    hardwareModel: { type: String, default: "ESP32-S3" },
    status: { type: String, enum: ["pending", "completed", "expired"], default: "pending" },
    expiresAt: { type: Date, required: true, index: true },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export type IHubSetupSessionDocument = HydratedDocument<IHubSetupSession>;
export const HubSetupSessionModel: Model<IHubSetupSession> = model<IHubSetupSession>(
  "HubSetupSession",
  hubSetupSessionSchema,
);
