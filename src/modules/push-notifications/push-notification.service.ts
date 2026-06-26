import { cert, getApps, initializeApp, type Credential } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { AppConfig } from "../../config/env";

interface PushPayload {
  tokens: string[];
  title: string;
  body: string;
  data?: Record<string, string>;
}

const SECURITY_ALERT_CHANNEL_ID = "glazia_security_alerts";
const SECURITY_ALERT_SOUND = "glazia_siren";

export interface PushSendResult {
  configured: boolean;
  tokenCount: number;
  successCount: number;
  failureCount: number;
  errors: string[];
}

export class PushNotificationService {
  private initialized = false;

  constructor(private readonly config: AppConfig) {
    this.initialize();
  }

  isConfigured(): boolean {
    return this.initialized;
  }

  async sendToTokens(payload: PushPayload): Promise<PushSendResult> {
    const tokens = [...new Set(payload.tokens.filter(Boolean))];
    if (!tokens.length) {
      console.warn("[PUSH] No FCM tokens registered for notification recipient");
      return {
        configured: this.initialized,
        tokenCount: 0,
        successCount: 0,
        failureCount: 0,
        errors: [],
      };
    }
    if (!this.initialized) {
      console.warn("[PUSH] Firebase is not configured; skipping push send");
      return {
        configured: false,
        tokenCount: tokens.length,
        successCount: 0,
        failureCount: tokens.length,
        errors: ["Firebase Admin is not configured"],
      };
    }

    const response = await getMessaging().sendEachForMulticast({
      tokens,
      notification: {
        title: payload.title,
        body: payload.body,
      },
      data: payload.data || {},
      android: {
        priority: "high",
        notification: {
          channelId: SECURITY_ALERT_CHANNEL_ID,
          priority: "high",
          sound: SECURITY_ALERT_SOUND,
        },
      },
      apns: {
        payload: {
          aps: {
            sound: "default",
          },
        },
      },
    });

    if (response.failureCount > 0) {
      const errors = response.responses
        .filter((item: { success: boolean }) => !item.success)
        .map((item: { error?: { message?: string } }) => item.error?.message || "Unknown FCM error");
      console.warn("[PUSH] Some push notifications failed", {
        successCount: response.successCount,
        failureCount: response.failureCount,
        errors,
      });
    }

    return {
      configured: true,
      tokenCount: tokens.length,
      successCount: response.successCount,
      failureCount: response.failureCount,
      errors: response.responses
        .filter((item: { success: boolean }) => !item.success)
        .map((item: { error?: { message?: string } }) => item.error?.message || "Unknown FCM error"),
    };
  }

  private initialize(): void {
    if (getApps().length) {
      this.initialized = true;
      return;
    }

    const credential = this.credentialFromConfig();
    if (!credential) {
      console.warn("[PUSH] Firebase Admin credentials are not configured");
      return;
    }

    initializeApp({ credential });
    this.initialized = true;
    console.info("[PUSH] Firebase Admin initialized");
  }

  private credentialFromConfig(): Credential | null {
    if (this.config.firebaseServiceAccountJson) {
      const serviceAccount = JSON.parse(this.config.firebaseServiceAccountJson);
      return cert(serviceAccount);
    }

    if (
      this.config.firebaseProjectId &&
      this.config.firebaseClientEmail &&
      this.config.firebasePrivateKey
    ) {
      return cert({
        projectId: this.config.firebaseProjectId,
        clientEmail: this.config.firebaseClientEmail,
        privateKey: this.config.firebasePrivateKey.replace(/\\n/g, "\n"),
      });
    }

    return null;
  }
}
