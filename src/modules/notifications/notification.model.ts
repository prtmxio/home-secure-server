import { HydratedDocument, Model, Schema, Types, model } from "mongoose";

export interface INotification {
  user: Types.ObjectId;
  hub: Types.ObjectId;
  sensor: Types.ObjectId | null;
  activityLog: Types.ObjectId;
  eventType: string;
  severity: string;
  title: string;
  message: string;
  deliveredAt: Date | null;
  readAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    user: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    hub: { type: Schema.Types.ObjectId, ref: "Hub", required: true },
    sensor: { type: Schema.Types.ObjectId, ref: "Sensor", default: null },
    activityLog: { type: Schema.Types.ObjectId, ref: "ActivityLog", required: true },
    eventType: { type: String, required: true },
    severity: { type: String, default: "info" },
    title: { type: String, required: true },
    message: { type: String, required: true },
    deliveredAt: { type: Date, default: null },
    readAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export type INotificationDocument = HydratedDocument<INotification>;
export const NotificationModel: Model<INotification> = model<INotification>("Notification", notificationSchema);
