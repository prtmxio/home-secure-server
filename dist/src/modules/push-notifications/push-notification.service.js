"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.PushNotificationService = void 0;
const app_1 = require("firebase-admin/app");
const messaging_1 = require("firebase-admin/messaging");
class PushNotificationService {
    config;
    initialized = false;
    constructor(config) {
        this.config = config;
        this.initialize();
    }
    isConfigured() {
        return this.initialized;
    }
    async sendToTokens(payload) {
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
        const response = await (0, messaging_1.getMessaging)().sendEachForMulticast({
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
            const errors = response.responses
                .filter((item) => !item.success)
                .map((item) => item.error?.message || "Unknown FCM error");
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
                .filter((item) => !item.success)
                .map((item) => item.error?.message || "Unknown FCM error"),
        };
    }
    initialize() {
        if ((0, app_1.getApps)().length) {
            this.initialized = true;
            return;
        }
        const credential = this.credentialFromConfig();
        if (!credential) {
            console.warn("[PUSH] Firebase Admin credentials are not configured");
            return;
        }
        (0, app_1.initializeApp)({ credential });
        this.initialized = true;
        console.info("[PUSH] Firebase Admin initialized");
    }
    credentialFromConfig() {
        if (this.config.firebaseServiceAccountJson) {
            const serviceAccount = JSON.parse(this.config.firebaseServiceAccountJson);
            return (0, app_1.cert)(serviceAccount);
        }
        if (this.config.firebaseProjectId &&
            this.config.firebaseClientEmail &&
            this.config.firebasePrivateKey) {
            return (0, app_1.cert)({
                projectId: this.config.firebaseProjectId,
                clientEmail: this.config.firebaseClientEmail,
                privateKey: this.config.firebasePrivateKey.replace(/\\n/g, "\n"),
            });
        }
        return null;
    }
}
exports.PushNotificationService = PushNotificationService;
