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
    async sendToTokens(payload) {
        const tokens = [...new Set(payload.tokens.filter(Boolean))];
        if (!tokens.length)
            return;
        if (!this.initialized) {
            console.warn("[PUSH] Firebase is not configured; skipping push send");
            return;
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
            console.warn("[PUSH] Some push notifications failed", {
                successCount: response.successCount,
                failureCount: response.failureCount,
                errors: response.responses
                    .filter((item) => !item.success)
                    .map((item) => item.error?.message),
            });
        }
    }
    initialize() {
        if ((0, app_1.getApps)().length) {
            this.initialized = true;
            return;
        }
        const credential = this.credentialFromConfig();
        if (!credential)
            return;
        (0, app_1.initializeApp)({ credential });
        this.initialized = true;
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
