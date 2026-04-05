import { HydratedDocument, Model, Schema, Types, model } from "mongoose";

export interface IActivityLog {
  user: Types.ObjectId;
  hub: Types.ObjectId;
  sensor: Types.ObjectId | null;
  eventType: string;
  severity: string;
  source: "mobile" | "hub" | "sensor" | "system";
  payload: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
}

const activityLogSchema = new Schema<IActivityLog>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    hub: { type: Schema.Types.ObjectId, ref: "Hub", required: true, index: true },
    sensor: { type: Schema.Types.ObjectId, ref: "Sensor", default: null },
    eventType: { type: String, required: true, trim: true },
    severity: { type: String, default: "info", trim: true },
    source: { type: String, enum: ["mobile", "hub", "sensor", "system"], default: "system" },
    payload: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true },
);

export type IActivityLogDocument = HydratedDocument<IActivityLog>;
export const ActivityLogModel: Model<IActivityLog> = model<IActivityLog>("ActivityLog", activityLogSchema);
