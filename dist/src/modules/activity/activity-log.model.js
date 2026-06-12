"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.ActivityLogModel = void 0;
const mongoose_1 = require("mongoose");
const activityLogSchema = new mongoose_1.Schema({
    user: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    hub: { type: mongoose_1.Schema.Types.ObjectId, ref: "Hub", required: true, index: true },
    sensor: { type: mongoose_1.Schema.Types.ObjectId, ref: "Sensor", default: null },
    eventType: { type: String, required: true, trim: true },
    severity: { type: String, default: "info", trim: true },
    source: { type: String, enum: ["mobile", "hub", "sensor", "system"], default: "system" },
    payload: { type: mongoose_1.Schema.Types.Mixed, default: {} },
}, { timestamps: true });
exports.ActivityLogModel = (0, mongoose_1.model)("ActivityLog", activityLogSchema);
