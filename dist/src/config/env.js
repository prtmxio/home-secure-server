"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.env = void 0;
const path_1 = __importDefault(require("path"));
const dotenv_1 = __importDefault(require("dotenv"));
dotenv_1.default.config();
exports.env = {
    nodeEnv: process.env.NODE_ENV || "development",
    port: Number(process.env.PORT || 3000),
    mongodbUri: process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/glazia-home-secure",
    jwtSecret: process.env.JWT_SECRET || "glazia-home-secure-dev-secret",
    jwtExpiresIn: process.env.JWT_EXPIRES_IN || "7d",
    deviceApiKey: process.env.DEVICE_API_KEY || "glazia-device-dev-key",
    pairingSessionTtlSeconds: Number(process.env.PAIRING_SESSION_TTL_SECONDS || 60),
    projectRoot: path_1.default.resolve(__dirname, "..", ".."),
};
