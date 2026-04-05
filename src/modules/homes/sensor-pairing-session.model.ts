import { HydratedDocument, Model, Schema, Types, model } from "mongoose";

export interface ISensorPairingSession {
  home: Types.ObjectId;
  hub: Types.ObjectId;
  status: "active" | "completed" | "expired";
  expiresAt: Date;
  activatedAt: Date;
  completedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const sensorPairingSessionSchema = new Schema<ISensorPairingSession>(
  {
    home: { type: Schema.Types.ObjectId, ref: "Home", required: true, index: true },
    hub: { type: Schema.Types.ObjectId, ref: "Hub", required: true, index: true },
    status: { type: String, enum: ["active", "completed", "expired"], default: "active" },
    expiresAt: { type: Date, required: true, index: true },
    activatedAt: { type: Date, required: true },
    completedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export type ISensorPairingSessionDocument = HydratedDocument<ISensorPairingSession>;
export const SensorPairingSessionModel: Model<ISensorPairingSession> = model<ISensorPairingSession>(
  "SensorPairingSession",
  sensorPairingSessionSchema,
);
