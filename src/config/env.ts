import path from "path";
import dotenv from "dotenv";

dotenv.config();

export interface AppConfig {
  nodeEnv: string;
  port: number;
  mongodbUri: string;
  jwtSecret: string;
  jwtExpiresIn: string;
  deviceApiKey: string;
  pairingSessionTtlSeconds: number;
  metaWhatsappPhoneNumberId: string;
  metaWhatsappToken: string;
  metaWhatsappApiVersion: string;
  whatsappOtpTemplateName: string;
  whatsappCountryCode: string;
  firebaseServiceAccountJson: string;
  firebaseProjectId: string;
  firebaseClientEmail: string;
  firebasePrivateKey: string;
  projectRoot: string;
}

export const env: AppConfig = {
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
  projectRoot: path.resolve(__dirname, "..", ".."),
};
