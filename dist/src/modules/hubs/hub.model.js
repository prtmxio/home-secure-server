"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HubModel = void 0;
const mongoose_1 = require("mongoose");
const hubSchema = new mongoose_1.Schema({
    owner: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", default: null },
    home: { type: mongoose_1.Schema.Types.ObjectId, ref: "Home", default: null, unique: true, sparse: true },
    macAddress: { type: String, required: true, unique: true, index: true },
    serialNumber: { type: String, default: null, trim: true },
    name: { type: String, required: true, trim: true },
    location: { type: String, default: "", trim: true },
    hardwareModel: { type: String, default: "ESP32-S3" },
    deviceSecret: { type: String, required: true },
    pairing: {
        qrNonce: { type: String, default: null },
        pairingModeEnabledAt: { type: Date, default: null },
        pairingModeExpiresAt: { type: Date, default: null },
    },
    capabilities: {
        touchscreen: { type: Boolean, default: true },
        humiditySensor: { type: Boolean, default: true },
        co2Sensor: { type: Boolean, default: true },
        fingerprintSensor: { type: Boolean, default: true },
    },
    status: {
        type: String,
        enum: ["unpaired", "paired", "offline", "online"],
        default: "unpaired",
    },
    lastSeenAt: { type: Date, default: null },
}, { timestamps: true });
exports.HubModel = (0, mongoose_1.model)("Hub", hubSchema);
