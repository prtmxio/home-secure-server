"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HomeModel = void 0;
const mongoose_1 = require("mongoose");
const homeSchema = new mongoose_1.Schema({
    owner: { type: mongoose_1.Schema.Types.ObjectId, ref: "User", required: true, index: true },
    name: { type: String, required: true, trim: true },
    location: { type: String, default: "", trim: true },
    hub: { type: mongoose_1.Schema.Types.ObjectId, ref: "Hub", required: true, unique: true },
}, { timestamps: true });
exports.HomeModel = (0, mongoose_1.model)("Home", homeSchema);
