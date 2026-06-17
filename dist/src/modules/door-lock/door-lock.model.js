"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DoorLockCommandModel = void 0;
const mongoose_1 = require("mongoose");
const doorLockCommandSchema = new mongoose_1.Schema({
    home: { type: mongoose_1.Schema.Types.ObjectId, ref: "Home", required: true, index: true },
    hub: { type: mongoose_1.Schema.Types.ObjectId, ref: "Hub", required: true, index: true },
    requestedBy: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", required: true, index: true },
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
}, { timestamps: true });
doorLockCommandSchema.index({ hub: 1, status: 1, createdAt: 1 });
exports.DoorLockCommandModel = (0, mongoose_1.model)("DoorLockCommand", doorLockCommandSchema);
