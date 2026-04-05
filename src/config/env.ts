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
  projectRoot: path.resolve(__dirname, "..", ".."),
};
