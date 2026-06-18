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
    metaWhatsappPhoneNumberId: process.env.META_WHATSAPP_PHONE_NUMBER_ID || process.env.META_NUMID || "",
    metaWhatsappToken: process.env.META_WHATSAPP_TOKEN || process.env.META_TOKEN || "",
    metaWhatsappApiVersion: process.env.META_WHATSAPP_API_VERSION || "v22.0",
    whatsappOtpTemplateName: process.env.WHATSAPP_OTP_TEMPLATE_NAME || "login_otp",
    whatsappCountryCode: process.env.WHATSAPP_COUNTRY_CODE || "91",
    firebaseServiceAccountJson: process.env.FIREBASE_SERVICE_ACCOUNT_JSON || "",
    firebaseProjectId: process.env.FIREBASE_PROJECT_ID || "",
    firebaseClientEmail: process.env.FIREBASE_CLIENT_EMAIL || "",
    firebasePrivateKey: process.env.FIREBASE_PRIVATE_KEY || "",
    projectRoot: path_1.default.resolve(__dirname, "..", ".."),
};
