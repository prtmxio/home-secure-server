"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SensorModel = void 0;
const mongoose_1 = require("mongoose");
const sensorSchema = new mongoose_1.Schema({
    hub: { type: mongoose_1.Schema.Types.ObjectId, ref: "Hub", required: true, index: true },
    macAddress: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true, trim: true },
    type: { type: String, required: true, trim: true },
    zone: { type: String, default: "", trim: true },
    hardwareModel: { type: String, default: "ESP32-C3 Mini" },
    status: { type: String, enum: ["provisioning", "paired", "offline", "online"], default: "provisioning" },
    provisionKey: { type: String, default: null },
    provisioning: {
        hubMacAddress: { type: String, required: true },
        sensorMacAddress: { type: String, required: true },
        sharedAt: { type: Date, required: true },
    },
    lastActivityAt: { type: Date, default: null },
}, { timestamps: true });
sensorSchema.index({ hub: 1, macAddress: 1 }, { unique: true });
exports.SensorModel = (0, mongoose_1.model)("Sensor", sensorSchema);
