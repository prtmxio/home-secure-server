import { cert, getApps, initializeApp, type Credential } from "firebase-admin/app";
import { getMessaging } from "firebase-admin/messaging";
import { AppConfig } from "../../config/env";

interface PushPayload {
  tokens: string[];
  title: string;
  body: string;
  data?: Record<string, string>;
}

export class PushNotificationService {
  private initialized = false;

  constructor(private readonly config: AppConfig) {
    this.initialize();
  }

  async sendToTokens(payload: PushPayload): Promise<void> {
    const tokens = [...new Set(payload.tokens.filter(Boolean))];
    if (!tokens.length) return;
    if (!this.initialized) {
      console.warn("[PUSH] Firebase is not configured; skipping push send");
      return;
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
          priority: "high",
          defaultSound: true,
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
      console.warn("[PUSH] Some push notifications failed", {
        successCount: response.successCount,
        failureCount: response.failureCount,
        errors: response.responses
          .filter((item: { success: boolean }) => !item.success)
          .map((item: { error?: { message?: string } }) => item.error?.message),
      });
    }
  }

  private initialize(): void {
    if (getApps().length) {
      this.initialized = true;
      return;
    }

    const credential = this.credentialFromConfig();
    if (!credential) return;

    initializeApp({ credential });
    this.initialized = true;
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
