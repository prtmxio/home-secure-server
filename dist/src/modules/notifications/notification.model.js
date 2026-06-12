"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NotificationModel = void 0;
const mongoose_1 = require("mongoose");
const notificationSchema = new mongoose_1.Schema({
    user: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    hub: { type: mongoose_1.Schema.Types.ObjectId, ref: "Hub", required: true },
    sensor: { type: mongoose_1.Schema.Types.ObjectId, ref: "Sensor", default: null },
    activityLog: { type: mongoose_1.Schema.Types.ObjectId, ref: "ActivityLog", required: true },
    eventType: { type: String, required: true },
    severity: { type: String, default: "info" },
    title: { type: String, required: true },
    message: { type: String, required: true },
    deliveredAt: { type: Date, default: null },
    readAt: { type: Date, default: null },
}, { timestamps: true });
exports.NotificationModel = (0, mongoose_1.model)("Notification", notificationSchema);
