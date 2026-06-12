"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SensorPairingSessionModel = void 0;
const mongoose_1 = require("mongoose");
const sensorPairingSessionSchema = new mongoose_1.Schema({
    home: { type: mongoose_1.Schema.Types.ObjectId, ref: "Home", required: true, index: true },
    hub: { type: mongoose_1.Schema.Types.ObjectId, ref: "Hub", required: true, index: true },
    status: { type: String, enum: ["active", "completed", "expired"], default: "active" },
    expiresAt: { type: Date, required: true, index: true },
    activatedAt: { type: Date, required: true },
    completedAt: { type: Date, default: null },
}, { timestamps: true });
exports.SensorPairingSessionModel = (0, mongoose_1.model)("SensorPairingSession", sensorPairingSessionSchema);
