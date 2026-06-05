import { HydratedDocument, Model, Schema, Types, model } from "mongoose";

export type DoorLockMode = "auto_lock" | "toggle";
export type DoorLockAction = "open" | "on" | "off";
export type DoorLockCommandStatus = "queued" | "delivered" | "executed" | "failed" | "superseded";

export interface IDoorLockCommand {
  home: Types.ObjectId;
  hub: Types.ObjectId;
  requestedBy: Types.ObjectId;
  mode: DoorLockMode;
  action: DoorLockAction;
  durationMs: number;
  status: DoorLockCommandStatus;
  deliveredAt: Date | null;
  executedAt: Date | null;
  failedAt: Date | null;
  error: string | null;
  lockState: "locked" | "unlocked" | null;
  createdAt: Date;
  updatedAt: Date;
}

const doorLockCommandSchema = new Schema<IDoorLockCommand>(
  {
    home: { type: Schema.Types.ObjectId, ref: "Home", required: true, index: true },
    hub: { type: Schema.Types.ObjectId, ref: "Hub", required: true, index: true },
    requestedBy: { type: Schema.Types.ObjectId, ref: "User", required: true, index: true },
    mode: { type: String, enum: ["auto_lock", "toggle"], required: true },
    action: { type: String, enum: ["open", "on", "off"], required: true },
    durationMs: { type: Number, required: true, min: 0, max: 10000 },
    status: {
      type: String,
      enum: ["queued", "delivered", "executed", "failed", "superseded"],
      default: "queued",
      index: true,
    },
    deliveredAt: { type: Date, default: null },
    executedAt: { type: Date, default: null },
    failedAt: { type: Date, default: null },
    error: { type: String, default: null, trim: true },
    lockState: { type: String, enum: ["locked", "unlocked", null], default: null },
  },
  { timestamps: true },
);

doorLockCommandSchema.index({ hub: 1, status: 1, createdAt: 1 });

export type IDoorLockCommandDocument = HydratedDocument<IDoorLockCommand>;
export const DoorLockCommandModel: Model<IDoorLockCommand> = model<IDoorLockCommand>(
  "DoorLockCommand",
  doorLockCommandSchema,
);
