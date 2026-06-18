"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HubSetupSessionModel = void 0;
const mongoose_1 = require("mongoose");
const hubSetupSessionSchema = new mongoose_1.Schema({
    user: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    hubMacAddress: { type: String, required: true, index: true },
    homeName: { type: String, required: true, trim: true },
    location: { type: String, default: "", trim: true },
    provisioningToken: { type: String, required: true, index: true },
    hardwareModel: { type: String, default: "ESP32-S3" },
    status: { type: String, enum: ["pending", "completed", "expired"], default: "pending" },
    expiresAt: { type: Date, required: true, index: true },
    completedAt: { type: Date, default: null },
}, { timestamps: true });
exports.HubSetupSessionModel = (0, mongoose_1.model)("HubSetupSession", hubSetupSessionSchema);
