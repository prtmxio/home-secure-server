"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.UserModel = void 0;
const mongoose_1 = require("mongoose");
const userSchema = new mongoose_1.Schema({
    name: { type: String, required: true, trim: true },
    email: { type: String, required: true, unique: true, lowercase: true, trim: true },
    phoneNumber: { type: String, default: "", trim: true, index: true },
    passwordHash: { type: String, required: true },
    pushTokens: [
        {
            token: { type: String, required: true },
            platform: { type: String, default: "unknown" },
            updatedAt: { type: Date, default: Date.now },
            createdAt: { type: Date, default: Date.now },
        },
    ],
}, { timestamps: true });
exports.UserModel = (0, mongoose_1.model)("User", userSchema);
